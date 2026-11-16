// Scripts that run on the target and the code that reads their output. Kept apart from the worker so it can be tested without SSH.
import type { Container, DiskReport, Machine } from './protocol'

/**
 * Runs for the whole SSH connection through `ssh <target> sh -s`. It first prints what never changes (hostname,
 * CPU count, the network card with the default route), then every `sampleSeconds` seconds prints a frame of
 * key=value lines ending with a `tick` line. Disk changes slowly, so it is read every 5 frames; docker ps and
 * systemctl are heavier, so about every 15 seconds. When the connection closes, the next echo hits SIGPIPE and
 * the loop exits, leaving nothing on the machine.
 */
export function streamScript(sampleSeconds: number): string {
  const every = Math.max(1, Math.round(15 / sampleSeconds))
  return [
    'iface=$(awk \'$2=="00000000"{print $1; exit}\' /proc/net/route 2>/dev/null)',
    'echo "hostname=$(hostname)"',
    'echo "cpus=$(nproc)"',
    'i=0',
    'while :; do',
    '  echo "cpu=$(head -1 /proc/stat)"',
    '  awk \'/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print "mem=" t " " a}\' /proc/meminfo',
    '  echo "load=$(cut -d" " -f1-3 /proc/loadavg)"',
    '  echo "uptime=$(cut -d" " -f1 /proc/uptime)"',
    '  [ -n "$iface" ] && sed "s/:/ /" /proc/net/dev | awk -v i="$iface" \'$1==i{print "net=" $2 " " $10}\'',
    '  if [ $((i % 5)) -eq 0 ]; then df -P -k / | awk \'NR==2{print "disk=" $3 " " $4}\'; fi',
    `  if [ $((i % ${every})) -eq 0 ]; then`,
    '    if command -v docker >/dev/null 2>&1; then',
    '      ps=$(timeout 5 docker ps -a --format "{{.State}}|{{.Status}}" 2>/dev/null) &&',
    '      printf "%s\\n" "$ps" | awk -F"|" \'NF>1{t++} $1=="running"{r++} $1=="restarting"{b++} $2~/unhealthy/{u++} END{print "docker=" r+0 " " t+0 " " u+0 " " b+0}\'',
    '    fi',
    '    command -v systemctl >/dev/null 2>&1 && echo "failed=$(systemctl --failed --no-legend --plain 2>/dev/null | grep -c .)"',
    '  fi',
    '  echo tick',
    '  i=$((i + 1))',
    `  sleep ${sampleSeconds}`,
    'done',
    ''
  ].join('\n')
}

/** Cumulative counters from the previous frame, to compute CPU percent and network rates from the difference. */
export type Counters = {
  cpu?: { idle: number; total: number }
  net?: { rx: number; tx: number; at: number }
}

function cpuTimes(line: string): { idle: number; total: number } | null {
  const parts = line.trim().split(/\s+/)
  if (parts[0] !== 'cpu') return null
  const n = parts.slice(1).map(Number)
  if (n.length < 4 || n.some((x) => !Number.isFinite(x))) return null
  // idle + iowait is time the CPU sat idle; guest is already counted in user, so only the first 8 columns add up.
  const total = n.slice(0, 8).reduce((s, x) => s + x, 0)
  return { idle: n[3] + (n[4] ?? 0), total }
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)
const numbers = (text: string | undefined) => (text ?? '').trim().split(/\s+/).map(Number)

/** Applies one frame (the key=value lines before a tick) to the machine. Missing keys keep their old value. */
export function applyFrame(m: Machine, c: Counters, kv: Map<string, string>, now: number): void {
  const host = kv.get('hostname')
  if (host) m.hostname = host
  const cpus = Number(kv.get('cpus'))
  if (cpus > 0) m.cpus = cpus

  const cpu = cpuTimes(kv.get('cpu') ?? '')
  if (cpu) {
    if (c.cpu && cpu.total > c.cpu.total) {
      const span = cpu.total - c.cpu.total
      m.cpuPercent = pct(span - (cpu.idle - c.cpu.idle), span)
    }
    c.cpu = cpu
  }

  const [memTotal, memAvail] = numbers(kv.get('mem'))
  if (memTotal > 0 && Number.isFinite(memAvail)) {
    m.memTotalBytes = memTotal * 1024
    m.memPercent = pct(memTotal - memAvail, memTotal)
  }

  const load = numbers(kv.get('load'))
  if (load.length === 3 && load.every(Number.isFinite)) m.load = [load[0], load[1], load[2]]

  const up = Number(kv.get('uptime'))
  if (Number.isFinite(up) && up > 0) m.uptimeSeconds = Math.floor(up)

  const [rx, tx] = numbers(kv.get('net'))
  if (Number.isFinite(rx) && Number.isFinite(tx) && kv.has('net')) {
    if (c.net && now > c.net.at && rx >= c.net.rx && tx >= c.net.tx) {
      const seconds = (now - c.net.at) / 1000
      m.netRxBps = Math.round((rx - c.net.rx) / seconds)
      m.netTxBps = Math.round((tx - c.net.tx) / seconds)
    }
    c.net = { rx, tx, at: now }
  }

  // Like df's Use% column: used over used plus what a normal user can still write.
  const [used, avail] = numbers(kv.get('disk'))
  if (used >= 0 && avail >= 0 && used + avail > 0) {
    m.diskTotalBytes = (used + avail) * 1024
    m.diskUsedBytes = used * 1024
    m.diskPercent = pct(used, used + avail)
  }

  const docker = numbers(kv.get('docker'))
  if (docker.length === 4 && docker.every(Number.isFinite)) {
    m.containers = { running: docker[0], total: docker[1], unhealthy: docker[2], restarting: docker[3] }
  }

  const failed = Number(kv.get('failed'))
  if (kv.has('failed') && Number.isFinite(failed)) m.failedUnits = failed

  if (kv.has('cpu')) m.at = now
}

/** Reads the hosts setting: one `name=target` per line; a line without = uses the target as the name. */
export function parseHosts(text: string): { name: string; target: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=')
      if (i < 0) return { name: line, target: line }
      return { name: line.slice(0, i).trim() || line.slice(i + 1).trim(), target: line.slice(i + 1).trim() }
    })
    .filter((h) => h.target)
}

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4
}

/** Reads a size as Docker prints it: "1.5GiB" (docker stats) or "12.3GB" (docker system df). */
export function parseSize(text: string): number | undefined {
  const match = /^\s*([\d.]+)\s*([a-z]+)\s*/i.exec(text)
  if (!match) return undefined
  const unit = UNITS[match[2].toLowerCase()]
  const value = Number(match[1])
  return unit && Number.isFinite(value) ? Math.round(value * unit) : undefined
}

/** Container names are letters, digits, underscore, dot and dash only, so they go into a shell command unquoted. */
export const isContainerName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)

export const CONTAINERS_SCRIPT = [
  'timeout 30 docker stats --no-stream --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null',
  'echo @@ps',
  'timeout 10 docker ps -a --format "{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Image}}"',
  ''
].join('\n')

export function parseContainers(output: string): Container[] {
  const [statsPart, psPart = ''] = output.split(/^@@ps$/m)
  const stats = new Map<string, { cpu?: number; mem?: number }>()
  for (const line of statsPart.split(/\r?\n/)) {
    const [name, cpu, mem] = line.split('\t')
    if (!name || cpu === undefined) continue
    const cpuValue = Number.parseFloat(cpu)
    stats.set(name, {
      cpu: Number.isFinite(cpuValue) ? cpuValue : undefined,
      mem: parseSize((mem ?? '').split('/')[0])
    })
  }
  const out: Container[] = []
  for (const line of psPart.split(/\r?\n/)) {
    const [name, state, status, image] = line.split('\t')
    if (!name || !state) continue
    const s = stats.get(name)
    const c: Container = { name, state, status: status ?? '', image: image ?? '' }
    if (s?.cpu !== undefined) c.cpuPercent = s.cpu
    if (s?.mem !== undefined) c.memBytes = s.mem
    out.push(c)
  }
  return out
}

/**
 * Measures disk once. Each line starts with a letter for its kind: F filesystem, K docker system df, D directory,
 * L container log, N container name. du scans each top-level directory in parallel, two levels deep, at most 75
 * seconds each, because on a server with many files one pass over / takes minutes; /var/lib/docker is skipped since
 * docker system df covers it. du and the log read use sudo when the SSH user has passwordless sudo, since many
 * directories are root-only; timeout must come after sudo, before it cannot stop du. The script only reads.
 */
export const DISK_SCRIPT = String.raw`S=""; sudo -n true 2>/dev/null && S="sudo -n"
[ -n "$S" ] && echo "sudo=1"
df -P -k -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs 2>/dev/null | awk 'NR>1{print "F\t" $6 "\t" $2 "\t" $3 "\t" $4}'
for d in /*; do
  [ -d "$d" ] && [ ! -L "$d" ] || continue
  case $d in /proc|/sys|/dev|/run) continue;; esac
  (
    r=$($S timeout 75 du -xk -d 2 --exclude=/var/lib/docker "$d" 2>/dev/null; echo "rc=$?")
    rc=$(printf "%s\n" "$r" | tail -1 | cut -d= -f2)
    top=$(printf "%s\n" "$r" | sed '$d' | sort -rn | head -8 | sed "s/^/D\t/")
    printf "%s\nDRC\t%s\t%s\n" "$top" "$rc" "$d"
  ) &
done
if command -v docker >/dev/null 2>&1; then
  out=$(timeout 20 docker system df --format "{{.Type}}\t{{.TotalCount}}\t{{.Size}}\t{{.Reclaimable}}" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then printf "%s\n" "$out" | sed "s/^/K\t/"
  elif [ $rc -eq 124 ]; then printf "KERR\ttimeout\n"
  else printf "KERR\t%s\n" "$(printf "%s" "$out" | tail -1)"; fi
  timeout 10 docker ps -a --no-trunc --format "{{.ID}}\t{{.Names}}" 2>/dev/null | sed "s/^/N\t/"
fi
$S timeout 10 sh -c 'du -k /var/lib/docker/containers/*/*-json.log 2>/dev/null' | sort -rn | head -5 | sed "s/^/L\t/"
wait
`

export function parseDisk(output: string, at: number): DiskReport {
  const report: DiskReport = { at, filesystems: [], dirs: [], logs: [], sudo: false, dirsPartial: false }
  const names = new Map<string, string>()
  const logs: { id: string; bytes: number }[] = []
  for (const line of output.split(/\r?\n/)) {
    if (line === 'sudo=1') report.sudo = true
    const [kind, ...f] = line.split('\t')
    if (kind === 'F') {
      const [s, u, a] = f.slice(1, 4).map(Number)
      if (f[0] && s > 0 && Number.isFinite(u) && Number.isFinite(a)) {
        report.filesystems.push({ mount: f[0], sizeBytes: s * 1024, usedBytes: u * 1024, percent: pct(u, u + a) })
      }
    } else if (kind === 'K') {
      const sizeBytes = parseSize(f[2] ?? '')
      if (f[0] && sizeBytes !== undefined) {
        report.docker = report.docker ?? []
        report.docker.push({ type: f[0], count: Number(f[1]) || 0, sizeBytes, reclaimableBytes: parseSize(f[3] ?? '') ?? 0 })
      }
    } else if (kind === 'KERR') {
      report.dockerError = f[0] === 'timeout' ? 'docker system df took more than 20 seconds.' : f.join(' ')
    } else if (kind === 'D') {
      const kb = Number(f[0])
      if (f[1] && kb >= 0) report.dirs.push({ path: f[1], bytes: kb * 1024 })
    } else if (kind === 'DRC') {
      if (f[0] === '124') report.dirsPartial = true
    } else if (kind === 'N') {
      if (f[0] && f[1]) names.set(f[0], f[1])
    } else if (kind === 'L') {
      const id = /containers\/([0-9a-f]{64})\//.exec(f[1] ?? '')?.[1]
      if (id) logs.push({ id, bytes: Number(f[0]) * 1024 })
    }
  }
  report.filesystems.sort((a, b) => b.sizeBytes - a.sizeBytes)
  report.dirs = report.dirs.sort((a, b) => b.bytes - a.bytes).slice(0, 12)
  report.logs = logs.map((l) => ({ container: names.get(l.id) ?? l.id.slice(0, 12), bytes: l.bytes }))
  return report
}
