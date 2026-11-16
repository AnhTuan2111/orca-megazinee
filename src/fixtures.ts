// Sample data for tests, `orca plugin check` and `orca plugin shot --scenario`: a Docker server slowly filling
// up, to preview the panel without SSH. Container names and paths are generic examples.
import type { Container, DiskReport, Machine } from './protocol'

const GIB = 1024 ** 3
const now = Date.now()

/** 30 minutes of CPU: around 20%, one 6 minute spike, and a few empty minutes from when Orca just opened. */
const cpuMinutes = [
  null, null, null, 18, 21, 19, 24, 22, 20, 26, 31, 28, 25, 22, 64, 88, 93, 91, 76, 58, 33, 27, 24, 21, 23, 26, 22, 19, 25, 27
]
/** 24 hours of disk: steadily from 74% to 81%, with two hours when Orca was closed. */
const diskHours = [
  74.1, 74.3, 74.6, 74.9, null, null, 75.8, 76.0, 76.4, 76.9, 77.2, 77.5, 77.9, 78.2, 78.6, 78.9, 79.3, 79.6, 79.9, 80.2, 80.4,
  80.7, 80.9, 81.1
]

export const machine: Machine = {
  name: 'web-01',
  target: 'ubuntu@10.0.0.1',
  state: 'online',
  hostname: 'app-01',
  cpus: 16,
  cpuPercent: 27.4,
  memPercent: 70.8,
  memTotalBytes: 47 * GIB,
  diskPercent: 81.1,
  diskTotalBytes: 194 * GIB,
  diskUsedBytes: 157 * GIB,
  load: [4.97, 4.81, 4.75],
  uptimeSeconds: 56 * 86_400 + 3_600,
  netRxBps: 23_800,
  netTxBps: 15_200,
  containers: { running: 15, total: 17, unhealthy: 1, restarting: 0 },
  failedUnits: 1,
  cpuMinutes,
  diskHours,
  diskTrend: { bytesPerHour: Math.round(0.62 * GIB), windowHours: 6 },
  at: now,
  since: now - 3_600_000
}

export const offline: Machine = {
  name: 'db-01',
  target: 'deploy@db.example.com',
  state: 'offline',
  error: 'ssh: connect to host db.example.com port 22: Connection timed out',
  cpuMinutes: [],
  diskHours: [],
  at: 0,
  since: now - 4 * 60_000
}

const c = (name: string, image: string, cpu: number, memGib: number, status = 'Up 8 weeks (healthy)', state = 'running'): Container => ({
  name,
  image,
  state,
  status,
  cpuPercent: cpu,
  memBytes: Math.round(memGib * GIB)
})

export const containers: { at: number; containers: Container[] } = {
  at: now - 20_000,
  containers: [
    c('kafka', 'apache/kafka:4.0.0', 93.2, 1.4),
    c('postgres', 'postgres:17', 22.5, 2.6),
    c('pgvector', 'pgvector/pgvector:pg18', 15.1, 0.9),
    c('elasticsearch', 'elasticsearch:8.15.0', 8.4, 3.1),
    c('app-api', 'registry.example.com/app/api:1.8.2', 6.2, 1.1),
    c('app-worker', 'registry.example.com/app/worker:1.8.2', 4.9, 0.7, 'Up 2 hours (unhealthy)'),
    c('redis', 'redis:7.4', 1.2, 0.2),
    c('nginx', 'nginx:1.27', 0.6, 0.05, 'Up 8 weeks'),
    c('grafana', 'grafana/grafana:11.2.0', 0.4, 0.15, 'Up 8 weeks'),
    c('prometheus', 'prom/prometheus:v2.54.0', 2.1, 0.6, 'Up 8 weeks'),
    c('gitlab-runner', 'gitlab/gitlab-runner:v17.4.0', 0.3, 0.08, 'Up 8 weeks'),
    c('nexus', 'sonatype/nexus3:3.72.0', 1.5, 2.2),
    c('minio', 'minio/minio:RELEASE.2024-09', 0.8, 0.3),
    c('app-web', 'registry.example.com/app/web:1.8.2', 0.2, 0.1, 'Up 3 days'),
    c('kafka-ui', 'provectuslabs/kafka-ui:v0.7.2', 0.9, 0.4, 'Up 8 weeks'),
    {
      name: 'runner-build-cache-1',
      image: 'gitlab/gitlab-runner-helper:x86_64-v17.4.0',
      state: 'exited',
      status: 'Exited (0) 11 hours ago'
    },
    { name: 'old-migration', image: 'registry.example.com/app/migrate:1.7.0', state: 'exited', status: 'Exited (1) 5 weeks ago' }
  ]
}

export const disk: DiskReport = {
  at: now - 40_000,
  filesystems: [
    { mount: '/', sizeBytes: 194 * GIB, usedBytes: 157 * GIB, percent: 81.1 },
    { mount: '/boot/efi', sizeBytes: 0.1 * GIB, usedBytes: 0.006 * GIB, percent: 5.8 }
  ],
  docker: [
    { type: 'Images', count: 78, sizeBytes: 81.2e9, reclaimableBytes: 75.2e9 },
    { type: 'Containers', count: 17, sizeBytes: 1.8e9, reclaimableBytes: 0.1e9 },
    { type: 'Local Volumes', count: 72, sizeBytes: 39.4e9, reclaimableBytes: 4e9 },
    { type: 'Build Cache', count: 518, sizeBytes: 37.3e9, reclaimableBytes: 6.3e9 }
  ],
  dirs: [
    { path: '/var', bytes: 24.6 * GIB },
    { path: '/var/lib', bytes: 18.9 * GIB },
    { path: '/var/lib/containerd', bytes: 12.4 * GIB },
    { path: '/var/lib/kubelet', bytes: 4.1 * GIB },
    { path: '/var/backups', bytes: 4.9 * GIB },
    { path: '/var/log', bytes: 0.4 * GIB },
    { path: '/home', bytes: 17.1 * GIB },
    { path: '/home/ubuntu', bytes: 14.9 * GIB },
    { path: '/home/ubuntu/deploy', bytes: 9.8 * GIB },
    { path: '/home/runner', bytes: 1.3 * GIB },
    { path: '/opt', bytes: 12.2 * GIB },
    { path: '/opt/actions-runner', bytes: 11.5 * GIB },
    { path: '/usr', bytes: 4.1 * GIB }
  ],
  dirsPartial: false,
  logs: [
    { container: 'elasticsearch', bytes: 54 * 1024 ** 2 },
    { container: 'postgres', bytes: 52 * 1024 ** 2 },
    { container: 'kafka-ui', bytes: 31 * 1024 ** 2 },
    { container: 'nexus', bytes: 25 * 1024 ** 2 }
  ],
  sudo: true
}
