// `orca plugin check` renders the panel once per scenario; `orca plugin shot <dir> --scenario <name>` captures one.
// The worker is replaced by the sample answers in src/fixtures.ts, so nothing connects over SSH.
import { defineCheck } from 'orca/testing'
import { containers, disk, machine, offline } from './fixtures'

const requests = {
  'machines.snapshot': () => ({ machines: [machine, offline], hosts: 'web-01=ubuntu@10.0.0.1', sampleSeconds: 2 }),
  'machines.containers': () => containers,
  'machines.disk': () => disk,
  'machines.cached': () => ({ containers: null, disk: null })
}

export default defineCheck({
  empty: {},
  overview: { requests },
  containers: { requests, persisted: { plugin: { tabs: { 'web-01': 'containers' } } } },
  disk: { requests, persisted: { plugin: { tabs: { 'web-01': 'disk' } } } }
})
