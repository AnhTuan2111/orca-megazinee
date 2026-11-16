// Thresholds and problem texts shared by the panel, the status bar and notifications, so all three agree.
import type { Machine } from './protocol'

export type Level = 'ok' | 'warning' | 'danger'

export const WARN_PERCENT = 70
export const DANGER_PERCENT = 90

export function percentLevel(percent: number | undefined): Level {
  if (percent === undefined) return 'ok'
  if (percent >= DANGER_PERCENT) return 'danger'
  if (percent >= WARN_PERCENT) return 'warning'
  return 'ok'
}

const rank: Record<Level, number> = { ok: 0, warning: 1, danger: 2 }
export const worse = (a: Level, b: Level): Level => (rank[a] >= rank[b] ? a : b)

export type Problem = { key: string; level: Level; text: string }

const num = (x: number) => x.toFixed(1)

/** What is wrong with the machine right now, worst first. */
export function problemsOf(m: Machine): Problem[] {
  if (m.state === 'offline') return [{ key: 'offline', level: 'danger', text: m.error || 'SSH connection lost.' }]
  const out: Problem[] = []
  const pct = (key: string, label: string, value: number | undefined) => {
    const level = percentLevel(value)
    if (level !== 'ok' && value !== undefined) out.push({ key, level, text: `${label} ${num(value)}%` })
  }
  pct('disk', 'Disk / used', m.diskPercent)
  pct('mem', 'RAM used', m.memPercent)
  pct('cpu', 'CPU busy', m.cpuPercent)
  const c = m.containers
  if (c?.unhealthy) out.push({ key: 'unhealthy', level: 'danger', text: `${c.unhealthy} unhealthy container${c.unhealthy > 1 ? 's' : ''}` })
  if (c?.restarting) out.push({ key: 'restarting', level: 'danger', text: `${c.restarting} container${c.restarting > 1 ? 's' : ''} restarting` })
  if (m.failedUnits) out.push({ key: 'failed', level: 'warning', text: `${m.failedUnits} failed systemd unit${m.failedUnits > 1 ? 's' : ''}` })
  if (m.load && m.cpus && m.load[0] / m.cpus >= 1) {
    out.push({ key: 'load', level: 'warning', text: `Load ${num(m.load[0])} above CPU count (${m.cpus})` })
  }
  return out.sort((a, b) => rank[b.level] - rank[a.level])
}

export function levelOf(m: Machine): Level {
  return problemsOf(m).reduce<Level>((acc, p) => worse(acc, p.level), 'ok')
}
