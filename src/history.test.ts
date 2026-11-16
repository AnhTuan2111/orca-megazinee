// CPU folded per minute, disk per hour, and the disk growth trend.
import { assert, test } from 'orca/testing'
import { cpuMinutes, diskHours, diskTrend, emptyHistory, Recorder } from './history'

const MIN = 60_000
const HOUR = 60 * MIN
const GIB = 1024 ** 3

test('the CPU samples of a minute fold into one average point', () => {
  const r = new Recorder(emptyHistory())
  const t0 = 100 * MIN
  r.add(t0, 10, undefined, undefined)
  r.add(t0 + 20_000, 30, undefined, undefined)
  // A minute is recorded only once the next one starts.
  assert.equal(r.add(t0 + MIN, 50, undefined, undefined), true)
  assert.deepEqual(r.history.cpu, [{ t: t0, v: 20 }])
  const minutes = cpuMinutes(r.history, t0 + MIN + 5_000)
  assert.equal(minutes.length, 30)
  assert.equal(minutes[29], 20)
  assert.equal(minutes[28], null)
})

test('disk is recorded every 10 minutes and lands in its hour', () => {
  const r = new Recorder(emptyHistory())
  const t0 = 1000 * HOUR
  r.add(t0, undefined, 50 * GIB, 100 * GIB)
  r.add(t0 + 5 * MIN, undefined, 51 * GIB, 100 * GIB)
  assert.equal(r.history.disk.length, 1)
  r.add(t0 + HOUR, undefined, 52 * GIB, 100 * GIB)
  const hours = diskHours(r.history, t0 + HOUR, 52.5)
  assert.equal(hours[22], 50)
  assert.equal(hours[23], 52.5)
  assert.equal(hours[0], null)
})

test('disk growing 1 GiB an hour gives a trend of 1 GiB an hour', () => {
  const h = emptyHistory()
  const t0 = 1000 * HOUR
  for (let i = 0; i <= 6; i++) h.disk.push({ t: t0 + i * HOUR, used: (50 + i) * GIB, total: 100 * GIB })
  const trend = diskTrend(h, t0 + 6 * HOUR)
  assert.equal(trend?.bytesPerHour, GIB)
  assert.equal(trend?.windowHours, 6)
  // Fewer than three points give no trend.
  assert.equal(diskTrend({ cpu: [], disk: h.disk.slice(0, 2) }, t0 + HOUR), undefined)
})
