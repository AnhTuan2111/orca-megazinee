// The contract between the panel (src/fui/fui.js) and the worker (src/worker.ts): requests, outputs and pushed events.
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
  /** Bytes of images no container uses, counted from docker images and the containers' image ids. */
  unusedImageBytes?: number
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
    /** The last Containers and Disk results kept in storage, so a tab shows something at once. */
    'machines.cached': {
      input: { name: string }
      output: { containers: { at: number; containers: Container[] } | null; disk: DiskReport | null }
    }
    /** Measures where disk space goes. Slow (du), so the worker also runs it in the background once an hour. */
    'machines.disk': { input: { name: string }; output: DiskReport }
    /** Opens an Orca terminal running ssh into the machine, or docker logs, docker exec of a container. */
    'machines.terminal': {
      input: { name: string; container?: string; kind: 'shell' | 'logs' }
      /** Set when the orca CLI failed and the terminal runs in the background without a tab: why it failed. */
      output: { ok: true; background?: string }
    }
    /** Starts following a container's logs; lines arrive as machines.logLines posts to the asking panel. */
    'machines.logs.start': {
      input: { name: string; container: string; tail: number; timestamps: boolean }
      output: { streamId: string }
    }
    /** Keeps a log stream alive; one the panel stops pinging for 45 seconds is closed. */
    'machines.logs.ping': { input: { streamId: string }; output: { alive: boolean } }
    'machines.logs.stop': { input: { streamId: string }; output: { ok: true } }
  }
  interface PluginPanelEvents {
    /** Sent by the worker on every new frame or connection state change. */
    'machines.update': { machines: Machine[] }
    /** A disk report the worker measured in the background. */
    'machines.diskReport': { name: string; report: DiskReport }
    /** New log lines of a stream; ended is set once the stream stops, with error when ssh or docker failed. */
    'machines.logLines': { streamId: string; lines: string[]; ended?: boolean; error?: string }
  }
}
