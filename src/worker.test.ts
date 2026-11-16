// The parts of the worker that need no SSH: status bar text, alerts and the handlers.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as worker from './worker'
import { AlertTracker, statusFor } from './worker'
import type { Machine } from './protocol'

const base: Machine = {
  name: 'web-01',
  target: 'ubuntu@10.0.0.1',
  state: 'online',
  cpuPercent: 12.4,
  memPercent: 60.2,
  memTotalBytes: 50 * 1024 ** 3,
  diskPercent: 75.4,
  diskTotalBytes: 194 * 1024 ** 3,
  containers: { running: 76, total: 77, unhealthy: 0, restarting: 0 },
  cpuMinutes: [],
  diskHours: [],
  at: 1,
  since: 0
}

test('the status bar shows the worst machine with its level colour', () => {
  const one = statusFor([base])
  assert.equal(one.text, 'web-01 disk ▰▰▰▰▰▰▱▱ 75% · CPU 12%')
  assert.equal(one.tone, 'warning')
  assert.equal(statusFor([{ ...base, diskPercent: 82 }]).tone, 'danger')
  assert.equal(statusFor([{ ...base, diskPercent: 40, memPercent: 30 }]).tone, 'success')
  const two = statusFor([base, { ...base, name: 'db', state: 'offline', error: 'Connection timed out' }])
  assert.equal(two.text, '1/2 · db offline')
  assert.equal(two.tone, 'danger')
  assert.ok(two.tooltip.includes('web-01: CPU 12%'))
  assert.equal(statusFor([]).visible, false)
})

test('each crossing notifies once, and again only after it clears', () => {
  const t = new AlertTracker()
  assert.deepEqual(t.check(base, 0), [])
  const full = { ...base, diskPercent: 85 }
  assert.equal(t.check(full, 1).length, 1)
  assert.equal(t.check(full, 2).length, 0)
  assert.equal(t.check(base, 3).length, 0)
  assert.equal(t.check(full, 4).length, 1)
})

test('high CPU must last a minute and offline 30 seconds before a notification', () => {
  const t = new AlertTracker()
  const hot = { ...base, cpuPercent: 97 }
  assert.equal(t.check(hot, 0).length, 0)
  assert.equal(t.check(hot, 59_000).length, 0)
  assert.equal(t.check(hot, 60_000).length, 1)
  const off: Machine = { ...base, state: 'offline', error: 'timeout', since: 100_000 }
  assert.equal(t.check(off, 110_000).length, 0)
  const sent = t.check(off, 131_000)
  assert.equal(sent[0].title, 'web-01: offline')
  assert.equal(t.check({ ...base, since: 140_000 }, 140_000)[0].title, 'web-01: back online')
})

test('with no machines the snapshot is empty and the status bar item hidden', async () => {
  const host = mockHost({ capabilities: ['settings:own', 'storage:own', 'notifications:show', 'workspace:read', 'terminal:send'] })
  const w = await mountWorker(worker, { host })
  const snap = await w.request('machines.snapshot')
  assert.deepEqual(snap.machines, [])
  await new Promise((r) => setTimeout(r, 600))
  const last = host.calls.filter((c) => c.method === 'statusBar.update').at(-1)
  assert.equal((last?.params as { visible?: boolean } | undefined)?.visible, false)
  await w.deactivate()
})

test('an odd container name opens no terminal', async () => {
  const host = mockHost({
    capabilities: ['settings:own', 'workspace:read', 'terminal:send'],
    settings: { hosts: 'x=127.0.0.1' },
    results: { 'workspace.list': { workspaces: [], truncated: false } }
  })
  const w = await mountWorker(worker, { host })
  await assert.rejects(w.request('machines.terminal', { name: 'x', kind: 'logs', container: 'a; rm -rf /' }), /unexpected characters/)
  await w.deactivate()
})
