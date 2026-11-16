// `orca plugin test .` chạy tệp này trong Node, worker được thay bằng câu trả lời giả.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

const machine = {
  name: 'web-01',
  target: 'ubuntu@10.0.0.1',
  ok: true,
  hostname: 'app-01',
  cpus: 15,
  cpuPercent: 31.2,
  memPercent: 72.4,
  memTotalBytes: 50 * 1024 ** 3,
  diskPercent: 80.9,
  diskTotalBytes: 194 * 1024 ** 3,
  load: [4.25, 4.58, 4.46] as [number, number, number],
  uptimeSeconds: 4825440,
  containers: { running: 76, total: 77, unhealthy: 0 },
  failedUnits: 1,
  at: Date.now()
}

test('vẽ thẻ máy với số liệu worker trả về', async () => {
  const host = mockHost({
    requests: {
      'machines.stats': () => ({ machines: [machine, { name: 'hỏng', target: 'u@x', ok: false, error: 'Connection timed out', at: Date.now() }], intervalSeconds: 30, hosts: 'web-01=ubuntu@10.0.0.1' })
    }
  })
  const view = await mount(panel, { host })
  const text = JSON.stringify(view.tree())
  assert.ok(text.includes('1/2 online'), text)
  assert.ok(text.includes('80,9%'), text)
  assert.ok(text.includes('76 chạy / 77'), text)
  assert.ok(text.includes('Connection timed out'), text)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('chưa có máy thì hiện ô thêm máy', async () => {
  const host = mockHost({
    requests: { 'machines.stats': () => ({ machines: [], intervalSeconds: 30, hosts: '' }) }
  })
  const view = await mount(panel, { host })
  const tree = JSON.stringify(view.tree())
  assert.ok(tree.includes('Chưa có máy nào'))
  // Hướng dẫn ghi máy nằm trong tooltip của icon, không hiện thành chữ trên ô nhập.
  assert.ok(view.find({ label: 'Cách ghi danh sách máy' }), 'thiếu icon tooltip')
  assert.ok(tree.includes('dạng tên=đích SSH'), 'tooltip mất nội dung')
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
