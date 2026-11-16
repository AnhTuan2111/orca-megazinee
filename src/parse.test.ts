// Đọc một output thật của REMOTE_SCRIPT (lấy từ một server Ubuntu, đã bớt số) thành số liệu.
import { assert, test } from 'orca/testing'
import { parseHosts, parseStats } from './parse'

const OUTPUT = [
  'stat1=cpu  1000 0 500 8000 100 0 0 0 0 0',
  'hostname=app-01',
  'cpus=15',
  'load=4.25 4.58 4.46',
  'uptime=4825440.12',
  'mem=49325000 13631488',
  'disk=164626432 38797312',
  'docker=76 77 0',
  'failed=1',
  'stat2=cpu  1300 0 600 8550 150 0 0 0 0 0'
].join('\n')

test('đọc CPU, RAM, disk, load, container', () => {
  const m = parseStats('server', 'u@h', OUTPUT, 1)
  assert.equal(m.ok, true)
  // 1000 tick trôi qua, 600 tick ngồi không (550 idle + 50 iowait), nên 40% bận.
  assert.equal(m.cpuPercent, 40)
  assert.equal(m.memPercent, 72.4)
  assert.equal(m.diskPercent, 80.9)
  assert.deepEqual(m.load, [4.25, 4.58, 4.46])
  assert.deepEqual(m.containers, { running: 76, total: 77, unhealthy: 0 })
  assert.equal(m.failedUnits, 1)
  assert.equal(m.uptimeSeconds, 4825440)
  assert.equal(m.hostname, 'app-01')
})

test('output rác thì báo lỗi', () => {
  const m = parseStats('x', 'u@h', 'Welcome to Ubuntu', 1)
  assert.equal(m.ok, false)
})

test('đọc danh sách máy', () => {
  assert.deepEqual(parseHosts('web-01=ubuntu@10.0.0.1\n\n# ghi chú\nu@h2'), [
    { name: 'web-01', target: 'ubuntu@10.0.0.1' },
    { name: 'u@h2', target: 'u@h2' }
  ])
})
