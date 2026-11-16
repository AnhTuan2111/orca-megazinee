// History behind the two charts on a machine card: CPU averaged per minute over 30 minutes, and disk / per hour
// over 24 hours. The worker saves it in the plugin's storage, so it survives an Orca restart; while Orca is closed
// nobody measures, and the charts leave those minutes and hours empty.

export type History = {
  /** CPU averaged over each minute; t is the start of the minute in ms. */
  cpu: { t: number; v: number }[]
  /** Disk / used, recorded every 10 minutes. */
  disk: { t: number; used: number; total: number }[]
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DISK_EVERY = 10 * MINUTE
/** How far back the disk trend looks. */
const TREND_WINDOW = 6 * HOUR

export const emptyHistory = (): History => ({ cpu: [], disk: [] })

/** Validates what storage returns, since an older version or a person may have left malformed data. */
export function asHistory(value: unknown): History {
  const h = emptyHistory()
  if (!value || typeof value !== 'object') return h
  const v = value as Partial<History>
  if (Array.isArray(v.cpu)) h.cpu = v.cpu.filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.v))
  if (Array.isArray(v.disk)) {
    h.disk = v.disk.filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.used) && p.total > 0)
  }
  return h
}

/** Folds the CPU samples of a minute into one point, and records disk every 10 minutes. */
export class Recorder {
  private minute = -1
  private sum = 0
  private count = 0

  constructor(readonly history: History) {}

  /** Returns true when a new point was added, so the worker knows to save storage. */
  add(now: number, cpu: number | undefined, diskUsed: number | undefined, diskTotal: number | undefined): boolean {
    let changed = false
    const minute = Math.floor(now / MINUTE) * MINUTE
    if (this.minute !== minute) {
      if (this.count > 0) {
        this.history.cpu.push({ t: this.minute, v: Math.round((this.sum / this.count) * 10) / 10 })
        changed = true
      }
      this.minute = minute
      this.sum = 0
      this.count = 0
    }
    if (cpu !== undefined) {
      this.sum += cpu
      this.count += 1
    }
    const last = this.history.disk.at(-1)
    if (diskUsed !== undefined && diskTotal && (!last || now - last.t >= DISK_EVERY)) {
      this.history.disk.push({ t: now, used: diskUsed, total: diskTotal })
      changed = true
    }
    if (changed) {
      this.history.cpu = this.history.cpu.filter((p) => now - p.t <= HOUR)
      this.history.disk = this.history.disk.filter((p) => now - p.t <= 25 * HOUR)
    }
    return changed
  }
}

/** CPU averages of the last 30 complete minutes, oldest first. */
export function cpuMinutes(h: History, now: number): (number | null)[] {
  const current = Math.floor(now / MINUTE) * MINUTE
  const byMinute = new Map(h.cpu.map((p) => [p.t, p.v]))
  return Array.from({ length: 30 }, (_, i) => byMinute.get(current - (30 - i) * MINUTE) ?? null)
}

/** The last disk percent recorded in each of the last 24 hours, current hour last. */
export function diskHours(h: History, now: number, latest?: number): (number | null)[] {
  const current = Math.floor(now / HOUR) * HOUR
  const out: (number | null)[] = Array(24).fill(null)
  for (const p of h.disk) {
    const slot = 23 - Math.round((current - Math.floor(p.t / HOUR) * HOUR) / HOUR)
    if (slot >= 0 && slot < 24) out[slot] = Math.round((p.used / p.total) * 1000) / 10
  }
  if (latest !== undefined) out[23] = latest
  return out
}

/**
 * How many bytes per hour disk grows, from the least squares line through the points of the last 6 hours at most.
 * Needs at least 3 points spanning 50 minutes; with fewer, one large log write would skew the trend.
 */
export function diskTrend(h: History, now: number): { bytesPerHour: number; windowHours: number } | undefined {
  const points = h.disk.filter((p) => now - p.t <= TREND_WINDOW)
  if (points.length < 3) return undefined
  const span = points.at(-1)!.t - points[0].t
  if (span < 50 * MINUTE) return undefined
  const xs = points.map((p) => (p.t - points[0].t) / HOUR)
  const ys = points.map((p) => p.used)
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  if (den === 0) return undefined
  return { bytesPerHour: Math.round(num / den), windowHours: Math.round((span / HOUR) * 10) / 10 }
}
