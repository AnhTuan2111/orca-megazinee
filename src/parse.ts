// Đọc output của REMOTE_SCRIPT thành số liệu. Tách khỏi worker để test được mà không cần SSH.
import type { Machine } from './protocol'

/**
 * Script chạy trên máy đích qua `ssh <đích> sh -s`. Mỗi dòng in ra một cặp khoá=giá trị. Dòng đầu
 * /proc/stat được in hai lần cách nhau 1 giây, vì phần trăm CPU phải tính từ chênh lệch giữa hai lần.
 * docker ps có timeout 5 giây để dockerd đang bận không làm treo cả lần lấy số liệu.
 */
export const REMOTE_SCRIPT = [
  'echo "stat1=$(head -1 /proc/stat)"',
  'echo "hostname=$(hostname)"',
  'echo "cpus=$(nproc)"',
  'echo "load=$(cut -d" " -f1-3 /proc/loadavg)"',
  'echo "uptime=$(cut -d" " -f1 /proc/uptime)"',
  'awk \'/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print "mem=" t " " a}\' /proc/meminfo',
  'df -P -k / | awk \'NR==2{print "disk=" $3 " " $4}\'',
  'if command -v docker >/dev/null 2>&1; then',
  '  r=$(timeout 5 docker ps -q 2>/dev/null) && a=$(timeout 5 docker ps -aq 2>/dev/null) && u=$(timeout 5 docker ps -q --filter health=unhealthy 2>/dev/null) &&',
  '  echo "docker=$(printf "%s" "$r" | grep -c .) $(printf "%s" "$a" | grep -c .) $(printf "%s" "$u" | grep -c .)"',
  'fi',
  'command -v systemctl >/dev/null 2>&1 && echo "failed=$(systemctl --failed --no-legend --plain 2>/dev/null | grep -c .)"',
  'sleep 1',
  'echo "stat2=$(head -1 /proc/stat)"',
  ''
].join('\n')

function cpuTimes(line: string): { idle: number; total: number } | null {
  const parts = line.trim().split(/\s+/)
  if (parts[0] !== 'cpu') return null
  const n = parts.slice(1).map(Number)
  if (n.length < 4 || n.some((x) => !Number.isFinite(x))) return null
  // idle + iowait là thời gian CPU ngồi không; guest đã tính trong user nên bỏ hai cột cuối.
  const fields = n.slice(0, 8)
  const total = fields.reduce((s, x) => s + x, 0)
  const idle = n[3] + (n[4] ?? 0)
  return { idle, total }
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)

export function parseStats(name: string, target: string, output: string, at: number): Machine {
  const kv = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1))
  }
  const m: Machine = { name, target, ok: true, at }

  const s1 = cpuTimes(kv.get('stat1') ?? '')
  const s2 = cpuTimes(kv.get('stat2') ?? '')
  if (s1 && s2 && s2.total > s1.total) {
    const busy = s2.total - s1.total - (s2.idle - s1.idle)
    m.cpuPercent = pct(busy, s2.total - s1.total)
  }

  const host = kv.get('hostname')
  if (host) m.hostname = host
  const cpus = Number(kv.get('cpus'))
  if (cpus > 0) m.cpus = cpus

  const load = (kv.get('load') ?? '').split(' ').map(Number)
  if (load.length === 3 && load.every(Number.isFinite)) m.load = [load[0], load[1], load[2]]

  const up = Number(kv.get('uptime'))
  if (Number.isFinite(up) && up > 0) m.uptimeSeconds = Math.floor(up)

  const [memTotal, memAvail] = (kv.get('mem') ?? '').split(' ').map(Number)
  if (memTotal > 0 && Number.isFinite(memAvail)) {
    m.memTotalBytes = memTotal * 1024
    m.memPercent = pct(memTotal - memAvail, memTotal)
  }

  // Như cột Use% của df: phần đã dùng trên phần đã dùng cộng phần người thường còn được ghi.
  const [used, avail] = (kv.get('disk') ?? '').split(' ').map(Number)
  if (used >= 0 && avail >= 0 && used + avail > 0) {
    m.diskTotalBytes = (used + avail) * 1024
    m.diskPercent = pct(used, used + avail)
  }

  const docker = (kv.get('docker') ?? '').split(' ').map(Number)
  if (docker.length === 3 && docker.every(Number.isFinite)) {
    m.containers = { running: docker[0], total: docker[1], unhealthy: docker[2] }
  }

  const failed = Number(kv.get('failed'))
  if (kv.has('failed') && Number.isFinite(failed)) m.failedUnits = failed

  if (m.cpuPercent === undefined && m.memPercent === undefined) {
    m.ok = false
    m.error = 'Máy trả về output không đọc được.'
  }
  return m
}

/** Đọc setting hosts: mỗi dòng `tên=đích`, dòng không có dấu = thì lấy đích làm tên. */
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
