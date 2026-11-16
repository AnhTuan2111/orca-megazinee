// `orca plugin test .` runs this file in Node, with the worker replaced by the sample answers in src/fixtures.ts.
import { assert, mockHost, mount, test } from 'orca/testing'
import { containers, disk, machine, offline } from './fixtures'
import * as panel from './panel'
import type { Machine } from './protocol'

/** Every machines.terminal input the panel sent, newest last. */
const sent: unknown[] = []

const hostWith = (machines: Machine[]) =>
  mockHost({
    requests: {
      'machines.snapshot': () => ({ machines, hosts: 'web-01=ubuntu@10.0.0.1', sampleSeconds: 2 }),
      'machines.containers': () => containers,
      'machines.disk': () => disk,
      'machines.terminal': (input: unknown) => {
        // Orca rejects input with a field set to undefined; the panel must leave the field out.
        assert.ok(!Object.values(input as object).includes(undefined), JSON.stringify(input))
        sent.push(input)
        return { ok: true, background: false }
      }
    }
  })

const NBSP = String.fromCharCode(160)

test('the host list opens the offline machine first, and a row press shows its Overview', async () => {
  const view = await mount(panel, { host: hostWith([machine, offline]) })
  const first = JSON.stringify(view.tree())
  assert.ok(first.includes('1/2 online'), first)
  assert.ok(first.includes('Connection timed out'), 'the offline machine is not open first')
  await view.press({ text: 'web-01' })
  const text = JSON.stringify(view.tree())
  assert.ok(text.includes('▰'), 'no block gauge')
  assert.ok(text.includes('Disk / in 24 hours'))
  assert.ok(text.includes('CPU in 30 minutes'))
  assert.ok(text.includes('peak 93%'))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('a new frame from the worker updates the card', async () => {
  const view = await mount(panel, { host: hostWith([machine]) })
  await view.post('machines.update', { machines: [{ ...machine, cpuPercent: 64.5 }] })
  assert.ok(JSON.stringify(view.tree()).includes('64.5%'))
  await view.unmount()
})

test('Shell sends input without undefined fields', async () => {
  const view = await mount(panel, { host: hostWith([machine]) })
  await view.press({ text: 'Shell' })
  assert.deepEqual(sent.at(-1), { name: 'web-01', kind: 'shell' })
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the Containers tab shows tiles with icons, and a selected one gets Logs', async () => {
  const view = await mount(panel, { host: hostWith([machine]) })
  await view.select({ label: 'View web-01' }, 'containers')
  const text = JSON.stringify(view.tree())
  assert.ok(text.includes('"icon":"database"'), 'no database icon')
  assert.ok(text.includes('Show 5 more'))
  await view.press({ text: 'kafka' })
  await view.press({ text: 'Logs' })
  assert.deepEqual(sent.at(-1), { name: 'web-01', kind: 'logs', container: 'kafka' })
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the Disk tab has the disk map, what can be freed and the directory tree', async () => {
  const view = await mount(panel, { host: hostWith([machine]) })
  await view.select({ label: 'View web-01' }, 'disk')
  const text = JSON.stringify(view.tree())
  assert.ok(text.includes('can be freed'), text)
  assert.ok(text.includes('/var/lib/containerd'))
  assert.ok(text.includes(`37.0${NBSP}GiB free`), 'no free space')
  assert.ok(text.includes('"type":"Tree"'), 'no directory tree')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('with no machines the host editor shows', async () => {
  const view = await mount(panel, { host: hostWith([]) })
  const tree = JSON.stringify(view.tree())
  assert.ok(tree.includes('No machines yet'))
  assert.ok(view.find({ label: 'How to list machines' }), 'no tooltip icon')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
