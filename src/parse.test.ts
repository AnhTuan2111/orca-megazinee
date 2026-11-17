// Reads real script output (from an Ubuntu server, numbers trimmed) into numbers.
import { assert, test } from 'orca/testing'
import { applyFrame, parseContainers, parseDisk, parseHosts, parseSize, sshTargetArgs, type Counters } from './parse'
import type { Machine } from './protocol'

const frame = (lines: string[]) => new Map(lines.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const fresh = (): Machine => ({ name: 'server', target: 'u@h', state: 'online', cpuMinutes: [], diskHours: [], at: 0, since: 0 })

test('two frames give CPU, network, RAM, disk and containers', () => {
  const m = fresh()
  const c: Counters = {}
  applyFrame(m, c, frame(['hostname=app-01', 'cpus=15', 'cpu=cpu  1000 0 500 8000 100 0 0 0 0 0', 'net=1000 5000', 'disk=164626432 38797312']), 1_000)
  // The first frame has nothing to compare with, so there is no CPU or network rate yet.
  assert.equal(m.cpuPercent, undefined)
  assert.equal(m.diskPercent, 80.9)
  applyFrame(
    m,
    c,
    frame([
      'cpu=cpu  1300 0 600 8550 150 0 0 0 0 0',
      'mem=49325000 13631488',
      'load=4.25 4.58 4.46',
      'uptime=4825440.12',
      'net=3000 6000',
      'docker=76 77 1 0',
      'failed=1'
    ]),
    3_000
  )
  // 1000 ticks passed, 600 idle (550 idle + 50 iowait), so 40% busy.
  assert.equal(m.cpuPercent, 40)
  assert.equal(m.netRxBps, 1000)
  assert.equal(m.netTxBps, 500)
  assert.equal(m.memPercent, 72.4)
  assert.equal(m.diskPercent, 80.9)
  assert.deepEqual(m.load, [4.25, 4.58, 4.46])
  assert.deepEqual(m.containers, { running: 76, total: 77, unhealthy: 1, restarting: 0 })
  assert.equal(m.failedUnits, 1)
  assert.equal(m.uptimeSeconds, 4825440)
  assert.equal(m.hostname, 'app-01')
  assert.equal(m.at, 3_000)
})

test('reads the host list', () => {
  assert.deepEqual(parseHosts('web-01=ubuntu@10.0.0.1\n\n# comment\nu@h2'), [
    { name: 'web-01', target: 'ubuntu@10.0.0.1' },
    { name: 'u@h2', target: 'u@h2' }
  ])
})

test('a target may carry a port as user@host:port', () => {
  assert.deepEqual(sshTargetArgs('quantri@203.0.113.9:9290'), ['-p', '9290', 'quantri@203.0.113.9'])
  assert.deepEqual(sshTargetArgs('ubuntu@10.0.0.1'), ['ubuntu@10.0.0.1'])
  assert.deepEqual(sshTargetArgs('web-01'), ['web-01'])
})

test('reads Docker sizes', () => {
  assert.equal(parseSize('1.5GiB'), 1.5 * 1024 ** 3)
  assert.equal(parseSize('12.3GB'), 12.3e9)
  assert.equal(parseSize('0B'), 0)
  assert.equal(parseSize('abc'), undefined)
})

test('joins docker stats with docker ps', () => {
  const out = [
    'kafka\t93.20%\t2.1GiB / 50GiB',
    'web\t0.50%\t120MiB / 50GiB',
    '@@ps',
    'kafka\trunning\tUp 3 days (healthy)\tbitnami/kafka:3.7',
    'web\trunning\tUp 2 hours (unhealthy)\tnginx:1.27',
    'old\texited\tExited (0) 5 weeks ago\tbusybox'
  ].join('\n')
  const list = parseContainers(out)
  assert.equal(list.length, 3)
  assert.equal(list[0].cpuPercent, 93.2)
  assert.equal(list[0].memBytes, Math.round(2.1 * 1024 ** 3))
  assert.equal(list[1].status, 'Up 2 hours (unhealthy)')
  assert.equal(list[2].cpuPercent, undefined)
})

test('reads the disk report', () => {
  const id = 'a'.repeat(64)
  const out = [
    'sudo=1',
    'F\t/boot\t1000000\t200000\t700000',
    'F\t/\t203000000\t164626432\t38797312',
    'D\t9000000\t/home',
    'DRC\t0\t/home',
    'K\tImages\t120\t85.2GB\t40.1GB (47%)',
    'K\tBuild Cache\t300\t12GB\t12GB',
    'N\t' + id + '\tkafka',
    'D\t150000000\t/var',
    'D\t140000000\t/var/lib',
    'DRC\t0\t/var',
    'L\t3000000\t/var/lib/docker/containers/' + id + '/' + id + '-json.log',
    'I\tsha256:aaa\t1.2GB',
    'I\tsha256:bbb\t300MB',
    'U\tsha256:aaa'
  ].join('\n')
  const r = parseDisk(out, 5)
  assert.equal(r.sudo, true)
  assert.equal(r.filesystems[0].mount, '/')
  assert.equal(r.filesystems[0].percent, 80.9)
  assert.deepEqual(r.dirs.map((d) => d.path), ['/var', '/var/lib', '/home'])
  assert.equal(r.dirsPartial, false)
  assert.deepEqual(r.logs, [{ container: 'kafka', bytes: 3000000 * 1024 }])
  // Only bbb has no container; Docker's own 40.1GB reclaimable for Images is replaced by that.
  assert.equal(r.unusedImageBytes, 300e6)
  assert.equal(r.docker?.[0].reclaimableBytes, 300e6)
})

test('a docker system df timeout is an error, a du timeout marks the dirs incomplete', () => {
  const r = parseDisk(['KERR\ttimeout', 'D\t5\t/var', 'DRC\t124\t/var'].join('\n'), 1)
  assert.equal(r.docker, undefined)
  assert.equal(r.dockerError, 'docker system df took more than 20 seconds.')
  assert.equal(r.dirsPartial, true)
})
