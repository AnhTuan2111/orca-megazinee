// The contract between the panel and the worker: src/panel.tsx and src/worker.ts both read this file.
export {}

export type MachineState = 'connecting' | 'online' | 'offline'

export type Machine = {
  name: string
  target: string
  state: MachineState
  /** The last ssh error line, only when state is offline. */
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
  /** Bytes per second received and sent on the network card with the default route. */
  netRxBps?: number
  netTxBps?: number
  /** Missing when the machine has no Docker or docker ps takes over 5 seconds. */
  containers?: { running: number; total: number; unhealthy: number; restarting: number }
  failedUnits?: number
  diskUsedBytes?: number
  /** CPU averaged per minute over the last 30 minutes, oldest first; null is a minute without data. */
  cpuMinutes: (number | null)[]
  /** Disk / percent at the end of each of the last 24 hours; null is an hour when Orca was closed or offline. */
  diskHours: (number | null)[]
  /** Bytes per hour disk / grows, from up to the last 6 hours; missing until there is enough data. */
  diskTrend?: { bytesPerHour: number; windowHours: number }
  /** The latest frame in ms; 0 before the first one. */
  at: number
  /** When the current connection started, or when the machine went offline. */
  since: number
}

export type Container = {
  name: string
  image: string
  /** running, exited, restarting, paused... as in the State column of docker ps. */
  state: string
  /** As in the Status column of docker ps, for example "Up 3 days (healthy)". */
  status: string
  cpuPercent?: number
  memBytes?: number
}

export type DiskReport = {
  at: number
  filesystems: { mount: string; sizeBytes: number; usedBytes: number; percent: number }[]
  /** Each type from docker system df: Images, Containers, Local Volumes, Build Cache. */
  docker?: { type: string; count: number; sizeBytes: number; reclaimableBytes: number }[]
  dockerError?: string
  /** The largest directories, measured with du. */
  dirs: { path: string; bytes: number }[]
  /** du was stopped after 75 seconds in some directory, so dirs is incomplete. */
  dirsPartial: boolean
  /** The largest container logs, only when /var/lib/docker is readable. */
  logs: { container: string; bytes: number }[]
  /** Whether du ran with sudo; without it, directories the SSH user cannot read are undercounted. */
  sudo: boolean
}

declare module 'orca' {
  interface PluginRequests {
    /** The latest numbers of every machine, plus the settings the panel needs for the host editor. */
    'machines.snapshot': { output: { machines: Machine[]; hosts: string; sampleSeconds: number } }
    /** Writes the hosts setting, from the panel or `orca plugin dev request`. */
    'machines.setHosts': { input: { hosts: string }; output: { ok: true } }
    /** Closes every connection and connects again right away. */
    'machines.reconnect': { output: { ok: true } }
    /** Runs docker stats and docker ps over a separate SSH connection. Slow, so only on demand. */
    'machines.containers': { input: { name: string }; output: { at: number; containers: Container[] } }
    /** Measures where disk space goes. Slow, so only on demand. */
    'machines.disk': { input: { name: string }; output: DiskReport }
    /** Opens an Orca terminal running ssh into the machine, or docker logs, docker exec of a container. */
    'machines.terminal': {
      input: { name: string; container?: string; kind: 'shell' | 'logs' }
      /** Set when the orca CLI failed and the terminal runs in the background without a tab: why it failed. */
      output: { ok: true; background?: string }
    }
  }
  interface PluginPanelEvents {
    /** Sent by the worker on every new frame or connection state change. */
    'machines.update': { machines: Machine[] }
  }
}
