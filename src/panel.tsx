// Panel Machines: mỗi máy một thẻ CPU, RAM, disk, load, container. Panel hỏi worker theo chu kỳ
// intervalSeconds, chỉ khi panel đang hiện trên màn hình.
import {
  atom,
  Badge,
  Box,
  Button,
  Card,
  Collapsible,
  EmptyState,
  Grid,
  Heading,
  IconButton,
  KeyValue,
  plugin,
  Progress,
  read,
  RelativeTime,
  Row,
  set,
  Spinner,
  Stack,
  Text,
  Textarea,
  type PanelContext,
  type Tone
} from 'orca'
import type { Machine } from './protocol'

const machines = atom<Machine[] | null>(null)
const loading = atom(false)
const failure = atom<string | null>(null)
/** Nội dung ô sửa danh sách máy; null là chưa sửa, đang hiện đúng setting. */
const draft = atom<string | null>(null)
const savedHosts = atom('')
const intervalMs = atom(30_000)

async function refresh(): Promise<void> {
  set(loading, true)
  try {
    const answer = await plugin.request('machines.stats', undefined, { timeoutMs: 60_000 })
    set(machines, answer.machines)
    set(savedHosts, answer.hosts)
    set(intervalMs, Math.max(10, answer.intervalSeconds) * 1000)
    set(failure, null)
  } catch (e) {
    set(failure, e instanceof Error ? e.message : String(e))
  } finally {
    set(loading, false)
  }
}

async function saveHosts(): Promise<void> {
  const text = read(draft) ?? read(savedHosts)
  await plugin.request('machines.setHosts', { hosts: text })
  set(draft, null)
  await refresh()
}

export function setup(ctx: PanelContext): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const loop = async () => {
    if (ctx.signal.aborted) return
    if (read(ctx.visible) && !read(loading)) await refresh()
    if (!ctx.signal.aborted) timer = setTimeout(loop, read(intervalMs))
  }
  void loop()
  ctx.signal.addEventListener('abort', () => clearTimeout(timer))
}

const num = (x: number, digits = 1) => x.toFixed(digits).replace('.', ',')

function levelTone(percent: number): Tone {
  if (percent >= 90) return 'danger'
  if (percent >= 70) return 'warning'
  return 'success'
}

function uptimeText(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  if (days > 0) return `${days} ngày ${hours} giờ`
  return `${hours} giờ ${Math.floor((seconds % 3_600) / 60)} phút`
}

const gib = (bytes: number) => `${num(bytes / 1024 ** 3, 0)} GiB`

function Meter(props: { label: string; percent?: number }) {
  const { label, percent } = props
  return (
    <Row gap="sm" align="center">
      <Box width={56}>
        <Text muted size="sm">
          {label}
        </Text>
      </Box>
      <Box grow>
        <Progress label={label} labelHidden value={percent ?? 0} />
      </Box>
      <Box width={64}>
        {percent === undefined ? (
          <Text muted size="sm">
            không rõ
          </Text>
        ) : (
          <Badge tone={levelTone(percent)}>{`${num(percent)}%`}</Badge>
        )}
      </Box>
    </Row>
  )
}

function MachineCard(props: { m: Machine }) {
  const { m } = props
  if (!m.ok) {
    return (
      <Card title={m.name} description={m.target}>
        <Stack gap="sm">
          <Row justify="between">
            <Badge tone="danger">Không lấy được số liệu</Badge>
            <RelativeTime at={m.at} muted />
          </Row>
          <Text tone="danger" size="sm">
            {m.error ?? 'Lỗi không rõ.'}
          </Text>
        </Stack>
      </Card>
    )
  }
  const items = []
  if (m.load) {
    const perCpu = m.cpus ? m.load[0] / m.cpus : 0
    items.push({
      label: 'Load avg',
      value: `${m.load.map((x) => num(x, 2)).join(' / ')}${m.cpus ? ` trên ${m.cpus} CPU` : ''}`,
      tone: perCpu >= 1 ? ('danger' as Tone) : perCpu >= 0.7 ? ('warning' as Tone) : undefined
    })
  }
  if (m.containers) {
    const c = m.containers
    items.push({
      label: 'Container',
      value: `${c.running} chạy / ${c.total}${c.unhealthy ? `, ${c.unhealthy} unhealthy` : ''}`,
      tone: c.unhealthy ? ('danger' as Tone) : undefined
    })
  }
  if (m.failedUnits !== undefined) {
    items.push({
      label: 'Unit failed',
      value: m.failedUnits,
      tone: m.failedUnits ? ('warning' as Tone) : undefined
    })
  }
  if (m.memTotalBytes && m.diskTotalBytes) {
    items.push({ label: 'Dung lượng', value: `RAM ${gib(m.memTotalBytes)}, disk ${gib(m.diskTotalBytes)}` })
  }
  if (m.uptimeSeconds !== undefined) items.push({ label: 'Uptime', value: uptimeText(m.uptimeSeconds) })
  return (
    <Card title={m.name} description={m.target}>
      <Stack gap="sm">
        <Row justify="between">
          <Badge tone="success">Online</Badge>
          <RelativeTime at={m.at} muted />
        </Row>
        <Meter label="CPU" percent={m.cpuPercent} />
        <Meter label="RAM" percent={m.memPercent} />
        <Meter label="Disk /" percent={m.diskPercent} />
        <KeyValue items={items} />
      </Stack>
    </Card>
  )
}

function HostsEditor(props: { open: boolean }) {
  const value = read(draft) ?? read(savedHosts)
  const editor = (
    <Stack gap="sm">
      <Textarea
        label="Danh sách máy"
        labelHidden
        value={value}
        placeholder="web-01=ubuntu@10.0.0.1"
        rows={4}
        onChange={(v) => set(draft, v)}
      />
      <Row gap="xs" align="center">
        <Button icon="check" onPress={saveHosts} disabled={read(draft) === null}>
          Lưu
        </Button>
        <IconButton
          icon="info"
          label="Cách ghi danh sách máy"
          tooltip="Mỗi dòng một máy, dạng tên=đích SSH, ví dụ: web-01=ubuntu@10.0.0.1"
          variant="ghost"
          size="sm"
        />
        <Text muted size="xs">
          Máy phải SSH được bằng khoá, không hỏi mật khẩu.
        </Text>
      </Row>
    </Stack>
  )
  if (props.open) return editor
  return (
    <Collapsible title="Sửa danh sách máy" defaultOpen={false}>
      {editor}
    </Collapsible>
  )
}

export default function Panel() {
  const list = read(machines)
  const busy = read(loading)
  const error = read(failure)
  const online = list ? list.filter((m) => m.ok).length : 0
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Row gap="sm" align="center">
          <Heading level={2}>Machines</Heading>
          {list && list.length ? <Text muted>{`${online}/${list.length} online`}</Text> : null}
        </Row>
        <Row gap="xs" align="center">
          {busy ? <Spinner label="Đang lấy số liệu" labelHidden /> : null}
          <IconButton icon="refresh" label="Lấy lại số liệu" onPress={refresh} disabled={busy} />
        </Row>
      </Row>
      {error ? (
        <Text tone="danger" size="sm">
          {error}
        </Text>
      ) : null}
      {list === null ? (
        <Spinner label="Đang SSH vào các máy" />
      ) : list.length === 0 ? (
        <Stack gap="md">
          <EmptyState icon="gauge" title="Chưa có máy nào" description="Thêm máy vào ô dưới rồi bấm Lưu." />
          <HostsEditor open />
        </Stack>
      ) : (
        <Stack gap="md">
          <Grid minItemWidth="md" gap="md">
            {list.map((m) => (
              <MachineCard m={m} />
            ))}
          </Grid>
          <HostsEditor open={false} />
        </Stack>
      )}
    </Stack>
  )
}
