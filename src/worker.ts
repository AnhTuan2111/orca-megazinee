// The plugin worker. Because the plugin has a status bar item, Orca starts the worker as soon as the plugin is
// enabled and keeps it running. The worker holds one SSH connection to each machine in the `hosts` setting; on that
// connection a small sh loop prints a frame of numbers every few seconds (see streamScript). Each new frame is
// pushed to the panel through machines.update, updates the status bar item, and goes through the alert check.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { OrcaWorkerApi } from 'orca/worker'
import { problemsOf, levelOf, type Level } from './health'
import { asHistory, cpuMinutes, diskHours, diskTrend, emptyHistory, Recorder, type History } from './history'
import {
  applyFrame,
  CONTAINERS_SCRIPT,
  DISK_SCRIPT,
  isContainerName,
  parseContainers,
  parseDisk,
  parseHosts,
  streamScript,
  type Counters
} from './parse'
import type { Machine } from './protocol'

const STATUS_ITEM = 'machines'
/** How long a machine must stay unreachable before we notify, so a short network blip stays quiet. */
const OFFLINE_ALERT_MS = 30_000
/** How long CPU must stay high before we notify. */
const CPU_ALERT_MS = 60_000

type Settings = { hosts: string; sampleSeconds: number; ssh: string; alerts: boolean }

/** Every running connection, so deactivate can close them all when Orca stops the worker. */
const live = new Set<Session>()

/**
 * The ssh program to run. On Windows, the OpenSSH ssh.exe that ships with Windows exits with code 255 right away
 * inside Orca's worker (even `ssh -V`, tested 16/11/2026), while Git for Windows' ssh works, so Git's ssh comes
 * first. The sshCommand setting overrides both.
 */
function sshProgram(override: string): string {
  if (override.trim()) return override.trim()
  const gitSsh = ['C:/Program Files/Git/usr/bin/ssh.exe', 'C:/Program Files (x86)/Git/usr/bin/ssh.exe']
  return gitSsh.find((p) => existsSync(p)) ?? 'ssh'
}

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2']

const lastLine = (text: string) => text.trim().split(/\r?\n/).pop() ?? ''

/**
 * Orca's worker gets a trimmed environment without APPDATA and LOCALAPPDATA, and the orca CLI needs APPDATA to find
 * the running Orca. Fill them in from the home directory, which Node finds even without the variables.
 */
function cliEnv(): Record<string, string | undefined> {
  const home = homedir()
  const env = { ...process.env }
  if (process.platform === 'win32') {
    env.USERPROFILE = env.USERPROFILE ?? home
    env.APPDATA = env.APPDATA ?? `${home}\\AppData\\Roaming`
    env.LOCALAPPDATA = env.LOCALAPPDATA ?? `${home}\\AppData\\Local`
  } else {
    env.HOME = env.HOME ?? home
  }
  return env
}

/**
 * The orca CLI. The plugin API's terminal.create only starts a background terminal with no tab, so Shell and Logs
 * use `orca terminal create --focus`, which opens a visible tab and switches to it. ORCA_CLI_COMMAND wins when Orca
 * sets it; on Windows the CLI ships next to Orca; elsewhere it is on PATH.
 */
function orcaCli(): string | undefined {
  const fromEnv = process.env.ORCA_CLI_COMMAND
  if (fromEnv) return fromEnv
  if (process.platform === 'win32') {
    const local = cliEnv().LOCALAPPDATA
    const exe = `${local}/Programs/orca/resources/bin/orca.exe`
    return existsSync(exe) ? exe : undefined
  }
  return process.platform === 'linux' ? 'orca-ide' : 'orca'
}

/**
 * Opens a visible terminal tab in the given workspace through the orca CLI. Resolves with null on success, or the
 * reason it failed. The workspace is named by path, because `--worktree active` looks at the current directory and
 * the worker runs from Orca's install folder. The CLI can exit 0 and still fail, so the answer is read from its JSON
 * `ok` field.
 */
function openTab(workspacePath: string, title: string, command: string): Promise<string | null> {
  const cli = orcaCli()
  if (!cli) return Promise.resolve('the orca CLI was not found')
  return new Promise((resolve) => {
    const args = ['terminal', 'create', '--worktree', `path:${workspacePath}`, '--title', title, '--command', command, '--focus', '--json']
    const child = spawn(cli, args, {
      windowsHide: true,
      env: cliEnv()
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve('the orca CLI did not answer within 15 seconds')
    }, 15_000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve(e.message)
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const answer = JSON.parse(out) as { ok?: boolean; error?: { message?: string } }
        resolve(answer.ok ? null : (answer.error?.message ?? 'the orca CLI failed'))
      } catch {
        resolve(lastLine(err) || 'the orca CLI gave no answer')
      }
    })
  })
}

/** A long-lived SSH connection to one machine that reconnects when it drops. */
class Session {
  readonly machine: Machine
  private counters: Counters = {}
  private child?: ChildProcess
  private frame = new Map<string, string>()
  private buffer = ''
  private stderr = ''
  private failures = 0
  private stopped = false
  private retryTimer?: ReturnType<typeof setTimeout>
  private watchdog?: ReturnType<typeof setTimeout>
  readonly recorder: Recorder
  /** The history got a new point that is not in storage yet. */
  historyDirty = false

  constructor(
    name: string,
    readonly target: string,
    history: History,
    private readonly settings: Settings,
    private readonly changed: () => void
  ) {
    const now = Date.now()
    this.recorder = new Recorder(history)
    this.machine = { name, target, state: 'connecting', cpuMinutes: [], diskHours: [], at: 0, since: now }
    this.refreshTrends(now)
  }

  /** Rebuilds both charts and the disk trend from history; also called while offline so the charts move with time. */
  refreshTrends(now: number): void {
    const h = this.recorder.history
    const latest = this.machine.state === 'online' ? this.machine.diskPercent : undefined
    this.machine.cpuMinutes = cpuMinutes(h, now)
    this.machine.diskHours = diskHours(h, now, latest)
    const trend = diskTrend(h, now)
    if (trend) this.machine.diskTrend = trend
    else delete this.machine.diskTrend
  }

  start(): void {
    if (this.stopped) return
    live.add(this)
    this.frame.clear()
    this.buffer = ''
    this.stderr = ''
    this.counters = {}
    const child = spawn(sshProgram(this.settings.ssh), [...SSH_OPTIONS, this.target, 'sh', '-s'], { windowsHide: true })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.onData(chunk))
    child.stderr.on('data', (chunk) => (this.stderr = (this.stderr + chunk).slice(-2000)))
    child.stdin.on('error', () => {})
    child.on('error', (e) => this.onClose(e.message))
    child.on('close', (code) => this.onClose(lastLine(this.stderr) || `ssh exited with code ${code}.`))
    child.stdin.end(streamScript(this.settings.sampleSeconds))
    this.armWatchdog()
  }

  stop(): void {
    this.stopped = true
    live.delete(this)
    clearTimeout(this.retryTimer)
    clearTimeout(this.watchdog)
    this.child?.kill()
    this.child = undefined
  }

  /** No frame within three periods plus 20 seconds means the connection hangs; close it so it reconnects. */
  private armWatchdog(): void {
    clearTimeout(this.watchdog)
    const ms = this.settings.sampleSeconds * 3_000 + 20_000
    this.watchdog = setTimeout(() => {
      this.stderr += `\nNo data for ${Math.round(ms / 1000)} seconds.`
      this.child?.kill()
    }, ms)
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      if (line === 'tick') this.onTick()
      else {
        const i = line.indexOf('=')
        if (i > 0) this.frame.set(line.slice(0, i), line.slice(i + 1))
      }
    }
  }

  private onTick(): void {
    const now = Date.now()
    applyFrame(this.machine, this.counters, this.frame, now)
    this.frame.clear()
    const m = this.machine
    if (this.recorder.add(now, m.cpuPercent, m.diskUsedBytes, m.diskTotalBytes)) this.historyDirty = true
    if (m.state !== 'online') {
      m.state = 'online'
      m.since = now
      delete m.error
    }
    this.failures = 0
    this.armWatchdog()
    this.changed()
  }

  private onClose(error: string): void {
    if (!this.child) return
    this.child = undefined
    clearTimeout(this.watchdog)
    if (this.stopped) return
    if (this.machine.state !== 'offline') this.machine.since = Date.now()
    this.machine.state = 'offline'
    this.machine.error = error
    this.changed()
    // Reconnect after 2, 4, 8, 16, then every 30 seconds.
    const delay = Math.min(30_000, 2_000 * 2 ** this.failures)
    this.failures += 1
    this.retryTimer = setTimeout(() => this.start(), delay)
  }
}

/** Runs a script once on the target over its own SSH connection and returns stdout. */
function runOnce(ssh: string, target: string, script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ssh, [...SSH_OPTIONS, target, 'sh', '-s'], { windowsHide: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Did not finish within ${timeoutMs / 1000} seconds.`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.stdin.on('error', () => {})
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(lastLine(err) || `ssh exited with code ${code}.`))
    })
    child.stdin.end(script)
  })
}

const round = (x: number | undefined) => (x === undefined ? '?' : `${Math.round(x)}%`)

/** One summary line per machine, for the status bar tooltip and notifications. */
function summary(m: Machine): string {
  if (m.state === 'offline') return `${m.name}: offline (${m.error ?? 'unknown error'})`
  if (m.state === 'connecting' || !m.at) return `${m.name}: connecting`
  const parts = [`CPU ${round(m.cpuPercent)}`, `RAM ${round(m.memPercent)}`, `disk ${round(m.diskPercent)}`]
  if (m.containers) parts.push(`${m.containers.running}/${m.containers.total} containers running`)
  return `${m.name}: ${parts.join(', ')}`
}

/**
 * An 8-cell bar made of block characters, because a plugin status bar item can only show text and an icon. Disk is
 * the number most worth watching, so it gets the bar; CPU and RAM of every machine are in the tooltip.
 */
export function gauge(percent: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * 8)
  return '▰'.repeat(filled) + '▱'.repeat(8 - filled)
}

// The status bar is where a glance should catch trouble, so anything past the first threshold shows red there.
const toneOf: Record<Level, 'neutral' | 'warning' | 'danger'> = { ok: 'neutral', warning: 'danger', danger: 'danger' }

/** The status bar item shows the worst machine: offline first, then over a threshold, then the first one. */
export function statusFor(machines: Machine[]): { text: string; tone: 'neutral' | 'warning' | 'danger'; tooltip: string; visible: boolean } {
  if (!machines.length) return { text: 'Machines', tone: 'neutral', tooltip: 'No machines yet.', visible: false }
  const rank = (m: Machine) => (m.state === 'offline' ? 3 : { ok: 0, warning: 1, danger: 2 }[levelOf(m)])
  const worst = machines.reduce((a, b) => (rank(b) > rank(a) ? b : a))
  let text: string
  if (worst.state === 'offline') text = `${worst.name} offline`
  else if (worst.state === 'connecting' || !worst.at) text = `${worst.name} connecting`
  else text = `${worst.name} disk ${gauge(worst.diskPercent ?? 0)} ${round(worst.diskPercent)} · CPU ${round(worst.cpuPercent)}`
  const online = machines.filter((m) => m.state === 'online').length
  if (machines.length > 1) text = `${online}/${machines.length} · ${text}`
  const tooltip = machines.map(summary).join('\n')
  const level: Level = worst.state === 'offline' ? 'danger' : levelOf(worst)
  return { text, tone: toneOf[level], tooltip, visible: true }
}

/** Remembers which alerts went out, so each crossing notifies once and only notifies again after it clears. */
export class AlertTracker {
  private notified = new Map<string, Set<string>>()
  private firstSeen = new Map<string, number>()

  /** The notifications to show for this machine at `now`. */
  check(m: Machine, now: number): { title: string; body: string }[] {
    const out: { title: string; body: string }[] = []
    const done = this.notified.get(m.name) ?? new Set<string>()
    this.notified.set(m.name, done)
    const current = problemsOf(m).filter((p) => p.level === 'danger')
    const keys = new Set(current.map((p) => p.key))

    for (const p of current) {
      const id = `${m.name}/${p.key}`
      if (!this.firstSeen.has(id)) this.firstSeen.set(id, now)
      const wait = p.key === 'offline' ? OFFLINE_ALERT_MS : p.key === 'cpu' ? CPU_ALERT_MS : 0
      const since = p.key === 'offline' ? m.since : (this.firstSeen.get(id) ?? now)
      if (done.has(p.key) || now - since < wait) continue
      done.add(p.key)
      out.push({
        title: `${m.name}: ${p.key === 'offline' ? 'offline' : p.text}`,
        body: p.key === 'offline' ? p.text : 'Open the Machines panel for details.'
      })
    }
    for (const key of [...done]) {
      if (keys.has(key)) continue
      done.delete(key)
      if (key === 'offline' && m.state === 'online') out.push({ title: `${m.name}: back online`, body: summary(m) })
    }
    for (const id of [...this.firstSeen.keys()]) {
      const [name, key] = id.split('/')
      if (name === m.name && !keys.has(key)) this.firstSeen.delete(id)
    }
    return out
  }

  forget(name: string): void {
    this.notified.delete(name)
  }
}

/** Characters allowed in an SSH target, so it can go into a terminal command without opening the door to other commands. */
const isTarget = (target: string) => /^[A-Za-z0-9_.@:[\]-]+$/.test(target)

export default function activate(orca: OrcaWorkerApi): void {
  let settings: Settings = { hosts: '', sampleSeconds: 2, ssh: '', alerts: true }
  let sessions: Session[] = []
  const alerts = new AlertTracker()
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let lastStatus = ''
  /** History per machine name, read from storage when the worker starts. */
  const histories: Record<string, History> = {}

  const machines = () => sessions.map((s) => s.machine)

  // Batch changes within half a second into one push, since several machines report frames at nearly the same time.
  const changed = () => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      const now = Date.now()
      for (const s of sessions) s.refreshTrends(now)
      if (sessions.some((s) => s.historyDirty)) {
        for (const s of sessions) s.historyDirty = false
        orca.storage.set('history', histories).catch((e) => orca.log(`storage.set: ${e}`))
      }
      const list = machines()
      orca.panels.post('machines.update', { machines: list })
      const status = statusFor(list)
      const key = JSON.stringify(status)
      if (key !== lastStatus) {
        lastStatus = key
        orca.host.call('statusBar.update', { id: STATUS_ITEM, ...status }).catch((e) => orca.log(`statusBar.update: ${e}`))
      }
      if (!settings.alerts) return
      for (const m of list) {
        for (const n of alerts.check(m, now)) {
          orca.host.call('notifications.show', n).catch((e) => orca.log(`notifications.show: ${e}`))
        }
      }
    }, 500)
  }

  const readSettings = async (): Promise<Settings> => ({
    hosts: String((await orca.settings.get('hosts')) ?? ''),
    sampleSeconds: Math.min(60, Math.max(1, Number(await orca.settings.get('sampleSeconds')) || 2)),
    ssh: String((await orca.settings.get('sshCommand')) ?? ''),
    alerts: (await orca.settings.get('alerts')) !== false
  })

  /** Re-reads settings; a machine with the same name and target keeps its connection unless the period or ssh changed. */
  const reload = async (force = false) => {
    const next = await readSettings()
    const restartAll = force || next.sampleSeconds !== settings.sampleSeconds || next.ssh !== settings.ssh
    settings = next
    const old = new Map(sessions.map((s) => [`${s.machine.name}\n${s.target}`, s]))
    const fresh: Session[] = []
    for (const h of parseHosts(next.hosts)) {
      const key = `${h.name}\n${h.target}`
      const keep = old.get(key)
      if (keep && !restartAll) {
        old.delete(key)
        fresh.push(keep)
      } else {
        histories[h.name] = histories[h.name] ?? emptyHistory()
        const s = new Session(h.name, h.target, histories[h.name], settings, changed)
        fresh.push(s)
        s.start()
      }
    }
    for (const s of old.values()) {
      s.stop()
      alerts.forget(s.machine.name)
    }
    // Drop the history of machines no longer in the list.
    const names = new Set(fresh.map((s) => s.machine.name))
    for (const name of Object.keys(histories)) if (!names.has(name)) delete histories[name]
    sessions = fresh
    changed()
  }

  const find = async (name: string) => {
    await ready
    const s = sessions.find((x) => x.machine.name === name)
    if (!s) throw Object.assign(new Error(`No machine named ${name}.`), { code: 'invalid_params' })
    return s
  }

  /** Where to open a terminal: the focused workspace if it is on this computer, else the first local one. */
  const pickWorkspace = async (): Promise<{ id: string; path: string }> => {
    const { workspaces } = await orca.host.call('workspace.list')
    const context = await orca.host.call('workspace.readContext').catch(() => null)
    const local = workspaces.filter((w) => !w.hostId)
    const pool = local.length ? local : workspaces
    const focused = context ? pool.find((w) => w.name === context.displayName) : undefined
    const chosen = focused ?? pool[0]
    if (!chosen) throw Object.assign(new Error('Orca has no workspace to open a terminal in.'), { code: 'action_failed' })
    return { id: chosen.id, path: chosen.path }
  }

  orca.settings.onDidChange(() => void reload())
  // Handlers that need the machine list wait for the first settings read, so an early panel request is not empty.
  const ready = (async () => {
    const stored = await orca.storage.get('history').catch(() => null)
    if (stored && typeof stored === 'object') {
      for (const [name, h] of Object.entries(stored as Record<string, unknown>)) histories[name] = asHistory(h)
    }
    await reload()
  })()

  orca.panels.handle('machines.snapshot', async () => {
    await ready
    return { machines: machines(), hosts: settings.hosts, sampleSeconds: settings.sampleSeconds }
  })

  orca.panels.handle('machines.setHosts', async ({ hosts }) => {
    await orca.settings.set('hosts', hosts)
    await reload()
    return { ok: true as const }
  })

  orca.panels.handle('machines.reconnect', async () => {
    await reload(true)
    return { ok: true as const }
  })

  orca.panels.handle('machines.containers', async ({ name }) => {
    const s = await find(name)
    const out = await runOnce(sshProgram(settings.ssh), s.target, CONTAINERS_SCRIPT, 55_000)
    return { at: Date.now(), containers: parseContainers(out) }
  })

  orca.panels.handle('machines.disk', async ({ name }) => {
    const s = await find(name)
    return parseDisk(await runOnce(sshProgram(settings.ssh), s.target, DISK_SCRIPT, 110_000), Date.now())
  })

  orca.panels.handle('machines.terminal', async ({ name, container, kind }) => {
    const s = await find(name)
    if (!isTarget(s.target)) throw Object.assign(new Error(`SSH target "${s.target}" has unexpected characters.`), { code: 'invalid_params' })
    if (container !== undefined && !isContainerName(container)) {
      throw Object.assign(new Error(`Container name "${container}" has unexpected characters.`), { code: 'invalid_params' })
    }
    let command = `ssh -t ${s.target}`
    let title = s.machine.name
    if (container && kind === 'logs') {
      command += ` docker logs -f --tail 200 ${container}`
      title = `logs ${container}`
    } else if (container) {
      command += ` docker exec -it ${container} sh`
      title = `${container} @ ${s.machine.name}`
    }
    const workspace = await pickWorkspace()
    const failure = await openTab(workspace.path, title, command)
    if (!failure) return { ok: true as const }
    // Without the CLI the terminal still starts, but in the background: Orca's plugin API gives it no tab.
    orca.log(`orca terminal create: ${failure}`)
    await orca.host.call('terminal.create', { workspaceId: workspace.id, title, command })
    return { ok: true as const, background: failure }
  })
}

/** Closes every ssh connection. Once a connection closes, the loop on the target hits SIGPIPE and exits. */
export function deactivate(): void {
  for (const s of [...live]) s.stop()
}
