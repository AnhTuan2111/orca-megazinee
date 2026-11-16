// Hợp đồng giữa panel và worker: src/panel.tsx và src/worker.ts cùng đọc tệp này.
export {}

export type Machine = {
  name: string
  target: string
  ok: boolean
  /** Lỗi SSH hay lỗi đọc số liệu, chỉ có khi ok = false. */
  error?: string
  hostname?: string
  cpus?: number
  cpuPercent?: number
  memPercent?: number
  memTotalBytes?: number
  diskPercent?: number
  diskTotalBytes?: number
  load?: [number, number, number]
  uptimeSeconds?: number
  /** Không có khi máy không cài Docker hay docker ps quá 5 giây. */
  containers?: { running: number; total: number; unhealthy: number }
  failedUnits?: number
  /** Thời điểm lấy xong số liệu, tính bằng ms. */
  at: number
}

declare module 'orca' {
  interface PluginRequests {
    /** SSH vào từng máy trong setting hosts, trả số liệu của tất cả. */
    'machines.stats': { output: { machines: Machine[]; intervalSeconds: number; hosts: string } }
    /** Ghi setting hosts, dùng khi thêm máy từ panel hay từ `orca plugin dev request`. */
    'machines.setHosts': { input: { hosts: string }; output: { ok: true } }
  }
}
