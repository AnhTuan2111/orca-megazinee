// The Machines panel. The worker pushes numbers through machines.update on every new frame; the panel never
// polls. On top is a compact host list, one row per machine; the selected machine's details sit below it in three
// tabs: Overview, Containers, Disk. So many hosts add rows, not whole cards. Containers and Disk ask the worker only
// when opened, because docker stats and du are slow.
//
// Visual language, matching Orca's own status bar item: bars are rows of block characters (▰ filled, ▱ empty)
// coloured by level, numbers are plain coloured text, and every box the plugin draws is a square-cornered outline on
// a black background. Controls that Orca draws rounded (buttons) are used in their borderless ghost form.
import {
  atom,
  Box,
  Button,
  Callout,
  EmptyState,
  Grid,
  Heading,
  IconButton,
  Input,
  KeyValue,
  Link,
  plugin,
  read,
  Row,
  set,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Text,
  Textarea,
  Tree,
  type IconName,
  type OrcaNode,
  type PanelContext,
  type Tone,
  type TreeItem
} from 'orca'
import { levelOf, percentLevel, type Level } from './health'
import type { Container, DiskReport, Machine } from './protocol'

type TabId = 'overview' | 'containers' | 'disk'
type Loaded<T> = { loading: boolean; error?: string; data?: T }
type ContainerData = { at: number; containers: Container[] }
type SortKey = 'cpu' | 'mem' | 'name'

const machines = atom<Machine[] | null>(null)
const savedHosts = atom('')
/** The host editor's text; null means unedited, showing the saved setting. */
const draft = atom<string | null>(null)
const editing = atom(false)
const notice = atom<{ tone: Tone; text: string } | null>(null)
/** The machine whose details are open, kept across panel reopens. */
const selectedHost = atom<string | null>('selectedHost', null, { persist: 'plugin' })
/** The open tab of each machine, kept across panel reopens. */
const tabs = atom<Record<string, TabId>>('tabs', {}, { persist: 'plugin' })
const containersBy = atom<Record<string, Loaded<ContainerData>>>({})
const diskBy = atom<Record<string, Loaded<DiskReport>>>({})
const containerSort = atom<SortKey>('containerSort', 'cpu', { persist: 'plugin' })
const containerFilter = atom('')
const selectedContainer = atom<Record<string, string | null>>({})
const showAllContainers = atom<Record<string, boolean>>({})

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function loadSnapshot(): Promise<void> {
  try {
    const answer = await plugin.request('machines.snapshot')
    set(machines, answer.machines)
    set(savedHosts, answer.hosts)
    // A Containers or Disk tab left open last time loads right away.
    const m = current(answer.machines)
    const tab = m ? read(tabs)[m.name] : undefined
    if (m && m.state === 'online' && tab && tab !== 'overview') void loadTab(m.name, tab)
  } catch (e) {
    set(notice, { tone: 'danger', text: message(e) })
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('machines.update', (p) => set(machines, p.machines)))
  void loadSnapshot()
}

async function run(action: () => Promise<unknown>, done?: string): Promise<void> {
  try {
    await action()
    set(notice, done ? { tone: 'success', text: done } : null)
  } catch (e) {
    set(notice, { tone: 'danger', text: message(e) })
  }
}

async function saveHosts(): Promise<void> {
  const text = read(draft) ?? read(savedHosts)
  await run(async () => {
    await plugin.request('machines.setHosts', { hosts: text })
    set(draft, null)
    set(editing, false)
    await loadSnapshot()
  })
}

async function loadContainers(name: string): Promise<void> {
  set(containersBy, { ...read(containersBy), [name]: { loading: true, data: read(containersBy)[name]?.data } })
  try {
    const data = await plugin.request('machines.containers', { name }, { timeoutMs: 60_000 })
    set(containersBy, { ...read(containersBy), [name]: { loading: false, data } })
  } catch (e) {
    set(containersBy, { ...read(containersBy), [name]: { loading: false, error: message(e) } })
  }
}

async function loadDisk(name: string): Promise<void> {
  set(diskBy, { ...read(diskBy), [name]: { loading: true, data: read(diskBy)[name]?.data } })
  try {
    const data = await plugin.request('machines.disk', { name }, { timeoutMs: 120_000 })
    set(diskBy, { ...read(diskBy), [name]: { loading: false, data } })
  } catch (e) {
    set(diskBy, { ...read(diskBy), [name]: { loading: false, error: message(e) } })
  }
}

const loadTab = (name: string, tab: TabId) =>
  tab === 'containers' ? loadContainers(name) : tab === 'disk' ? loadDisk(name) : Promise.resolve()

function openTab(name: string, tab: TabId): void {
  set(tabs, { ...read(tabs), [name]: tab })
  const loaded = tab === 'containers' ? read(containersBy)[name] : tab === 'disk' ? read(diskBy)[name] : undefined
  if (tab !== 'overview' && !loaded?.data && !loaded?.loading) void loadTab(name, tab)
}

function selectHost(m: Machine): void {
  set(selectedHost, m.name)
  const tab = read(tabs)[m.name]
  if (m.state === 'online' && tab && tab !== 'overview') openTab(m.name, tab)
}

/** The machine whose details show: the one picked last, or the first offline one, or the first. */
function current(list: Machine[]): Machine | undefined {
  const picked = read(selectedHost)
  return list.find((m) => m.name === picked) ?? list.find((m) => m.state === 'offline') ?? list[0]
}

// Leave a missing field out of the input entirely: Orca rejects input carrying an undefined value.
async function terminal(name: string, kind: 'shell' | 'logs', container?: string): Promise<void> {
  try {
    const answer = await plugin.request('machines.terminal', container ? { name, kind, container } : { name, kind })
    const what = container ? `${kind === 'logs' ? 'the logs of' : 'a shell in'} ${container}` : `an SSH session to ${name}`
    set(
      notice,
      answer.background
        ? { tone: 'warning', text: `Started ${what} in the background without a tab, because ${answer.background}.` }
        : null
    )
  } catch (e) {
    set(notice, { tone: 'danger', text: message(e) })
  }
}

const num = (x: number, digits = 1) => x.toFixed(digits)

function bytes(b: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = Math.abs(b)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  // A non-breaking space keeps "1.4" and "GiB" on one line in a narrow sidebar.
  return `${b < 0 ? '-' : ''}${num(v, v >= 100 || i === 0 ? 0 : 1)}\u00a0${units[i]}`
}

const rate = (bps: number) => `${bytes(bps)}/s`
const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

function uptimeText(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h ${Math.floor((seconds % 3_600) / 60)}m`
}

const toneOf = (level: Level): Tone => (level === 'ok' ? 'success' : level)
/** Colour of bars, columns and numbers: blue when fine, yellow and red past the thresholds. */
function barTone(percent: number): Tone {
  const level = percentLevel(percent)
  return level === 'ok' ? 'accent' : level
}
const share = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0)

/** A chip: square-cornered coloured outline and text on a black background. */
function Chip(props: { tone?: Tone; children: string }) {
  const tone = props.tone ?? 'neutral'
  const plain = tone === 'neutral'
  return (
    <Box direction="row" align="center" paddingX="xs" radius="none" border={plain ? true : tone}>
      <Text size="xs" weight="medium" tone={plain ? undefined : tone} muted={plain} truncate>
        {props.children}
      </Text>
    </Box>
  )
}

/** A square-cornered outlined box, used for every panel the plugin draws itself. */
function Frame(props: { children: OrcaNode; tone?: Tone; padding?: 'xs' | 'sm' | 'md' }) {
  return (
    <Box padding={props.padding ?? 'sm'} radius="none" border={props.tone ?? true} gap="xs">
      {props.children}
    </Box>
  )
}

/**
 * A bar of block characters split into coloured parts, like the gauge in the status bar. Each part takes cells in
 * proportion to its share; the remaining cells are empty (▱).
 */
function Gauge(props: { parts: { tone: Tone; share: number }[]; cells?: number }) {
  const cells = props.cells ?? 16
  let used = 0
  const filled = props.parts.map((p) => {
    // Round the running total, not each part, so the parts never add up to more cells than the bar has.
    const end = Math.min(cells, Math.round((p.share + used / cells) * cells))
    const n = Math.max(0, end - used)
    used += n
    return { tone: p.tone, text: '▰'.repeat(n) }
  })
  return (
    <Text size="sm" truncate>
      {filled.filter((f) => f.text).map((f) => (
        <Text tone={f.tone}>{f.text}</Text>
      ))}
      <Text muted>{'▱'.repeat(cells - used)}</Text>
    </Text>
  )
}

/** A percentage as coloured text, or n/a. */
function Pct(props: { value?: number; size?: 'xs' | 'sm' }) {
  const { value } = props
  return (
    <Text size={props.size ?? 'sm'} weight="medium" tone={value === undefined ? undefined : barTone(value)} muted={value === undefined}>
      {value === undefined ? 'n/a' : `${num(value)}%`}
    </Text>
  )
}

function Meter(props: { label: string; percent?: number }) {
  const { label, percent } = props
  // Past a threshold the label takes the bar's colour too, so the whole row reads as a warning.
  const alert = percent !== undefined && percentLevel(percent) !== 'ok'
  return (
    <Row gap="sm" align="center">
      <Box width={44}>
        <Text size="sm" muted={!alert} tone={alert ? barTone(percent) : undefined} weight={alert ? 'medium' : undefined}>
          {label}
        </Text>
      </Box>
      <Box grow>
        <Gauge parts={percent === undefined ? [] : [{ tone: barTone(percent), share: percent / 100 }]} cells={10} />
      </Box>
      <Box width={52} direction="row" justify="end">
        <Pct value={percent} />
      </Box>
    </Row>
  )
}

/** A column chart: each column's height follows its value within [min, max]; a thin stub means no data. */
function Chart(props: {
  title: string
  summary?: string
  values: (number | null)[]
  min?: number
  max?: number
  from: string
  to: string
}) {
  const HEIGHT = 44
  const min = props.min ?? 0
  const max = props.max ?? 100
  const height = (v: number) => Math.max(3, Math.round(((Math.min(Math.max(v, min), max) - min) / (max - min || 1)) * (HEIGHT - 8)))
  return (
    <Stack gap="xs">
      <Row justify="between" align="center">
        <Text size="sm" weight="medium">
          {props.title}
        </Text>
        {props.summary ? (
          <Text muted size="xs">
            {props.summary}
          </Text>
        ) : null}
      </Row>
      <Box direction="row" align="end" gap="xs" height={HEIGHT} padding="xs" border radius="none">
        {props.values.map((v) =>
          v === null ? (
            <Box grow height={2} background="muted" radius="none" />
          ) : (
            <Box grow height={height(v)} background={barTone(v)} border={barTone(v)} radius="none" />
          )
        )}
      </Box>
      <Row justify="between">
        <Text muted size="xs">
          {props.from}
        </Text>
        <Text muted size="xs">
          {props.to}
        </Text>
      </Row>
    </Stack>
  )
}

/** A colour key for a multi-part gauge. */
function Legend(props: { items: { tone: Tone; label: string }[] }) {
  return (
    <Row gap="sm" wrap>
      {props.items.map((i) => (
        <Text size="xs">
          <Text tone={i.tone}>▰ </Text>
          <Text muted>{i.label}</Text>
        </Text>
      ))}
    </Row>
  )
}

/**
 * One row of the host list: the name, then CPU, RAM and disk as coloured numbers, or why it is not online. The
 * selected row has a blue outline.
 */
function HostRow(props: { m: Machine; selected: boolean }) {
  const { m, selected } = props
  return (
    <Box direction="row" align="center" justify="between" gap="xs" paddingX="xs" radius="none" border={selected ? 'accent' : true} wrap>
      <Button size="sm" variant="ghost" icon="gauge" onPress={() => selectHost(m)}>
        {m.name}
      </Button>
      {m.state === 'offline' ? (
        <Text size="xs" tone="danger">{`offline since ${clock(m.since)}`}</Text>
      ) : m.state === 'connecting' || !m.at ? (
        <Text size="xs" muted>
          connecting
        </Text>
      ) : (
        <Text size="xs">
          <Text muted>CPU </Text>
          <Text tone={barTone(m.cpuPercent ?? 0)}>{`${num(m.cpuPercent ?? 0, 0)}%`}</Text>
          <Text muted>{'  RAM '}</Text>
          <Text tone={barTone(m.memPercent ?? 0)}>{`${num(m.memPercent ?? 0, 0)}%`}</Text>
          <Text muted>{'  Disk '}</Text>
          <Text tone={barTone(m.diskPercent ?? 0)}>{`${num(m.diskPercent ?? 0, 0)}%`}</Text>
        </Text>
      )}
    </Box>
  )
}

function OverviewTab(props: { m: Machine }) {
  const { m } = props
  const items = []
  if (m.load) {
    const perCpu = m.cpus ? m.load[0] / m.cpus : 0
    items.push({
      label: 'Load avg',
      value: `${m.load.map((x) => num(x, 2)).join('  ')}${m.cpus ? ` / ${m.cpus} CPU` : ''}`,
      tone: perCpu >= 1 ? ('danger' as Tone) : perCpu >= 0.7 ? ('warning' as Tone) : undefined
    })
  }
  if (m.netRxBps !== undefined && m.netTxBps !== undefined) {
    items.push({ label: 'Network', value: `in ${rate(m.netRxBps)}, out ${rate(m.netTxBps)}` })
  }
  if (m.containers) {
    const c = m.containers
    const bad = [c.unhealthy ? `${c.unhealthy} unhealthy` : '', c.restarting ? `${c.restarting} restarting` : '']
      .filter(Boolean)
      .join(', ')
    items.push({ label: 'Containers', value: `${c.running}/${c.total} running${bad ? `, ${bad}` : ''}`, tone: bad ? ('danger' as Tone) : undefined })
  }
  if (m.failedUnits !== undefined) {
    items.push({ label: 'Failed units', value: m.failedUnits, tone: m.failedUnits ? ('warning' as Tone) : undefined })
  }
  if (m.memTotalBytes && m.diskTotalBytes) {
    items.push({ label: 'Capacity', value: `RAM ${bytes(m.memTotalBytes)}, disk ${bytes(m.diskTotalBytes)}` })
  }

  const cpu = m.cpuMinutes.filter((v): v is number => v !== null)
  const cpuSummary = cpu.length
    ? `avg ${num(cpu.reduce((a, b) => a + b, 0) / cpu.length, 0)}% · peak ${num(Math.max(...cpu), 0)}%`
    : 'not a full minute yet'
  // Disk moves a few percent a day; on a 0-100% scale every column looks the same, so zoom into the real range.
  const diskValues = m.diskHours.filter((v): v is number => v !== null)
  const diskMin = diskValues.length ? Math.max(0, Math.floor(Math.min(...diskValues)) - 2) : 0
  const diskMax = diskValues.length ? Math.min(100, Math.ceil(Math.max(...diskValues)) + 1) : 100
  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Meter label="CPU" percent={m.cpuPercent} />
        <Meter label="RAM" percent={m.memPercent} />
        <Meter label="Disk" percent={m.diskPercent} />
      </Stack>
      <Chart
        title="Disk / in 24 hours"
        summary={diskValues.length ? `${num(Math.min(...diskValues))}% to ${num(Math.max(...diskValues))}%` : undefined}
        values={m.diskHours}
        min={diskMin}
        max={diskMax}
        from="24 hours ago"
        to="now"
      />
      <Chart title="CPU in 30 minutes" summary={cpuSummary} values={m.cpuMinutes} from="30 minutes ago" to="last minute" />
      <KeyValue items={items} />
    </Stack>
  )
}

/** An icon by the kind of software in the image, so databases, queues, proxies and CI stand out in the list. */
function containerIcon(c: Container): IconName {
  // Only the container name and the last part of the image count, so an image on a private registry is not taken for a registry.
  const s = `${c.name} ${c.image.split('/').pop() ?? ''}`.toLowerCase()
  if (/postgres|pgvector|mysql|mariadb|oracle|mongo|redis|valkey|elastic|opensearch|clickhouse|influx|cassandra|etcd|patroni|minio/.test(s)) return 'database'
  if (/kafka|rabbit|nats|zookeeper|activemq|pulsar|redpanda/.test(s)) return 'layers'
  if (/nginx|traefik|caddy|haproxy|envoy|httpd|apache/.test(s)) return 'globe'
  if (/runner|jenkins|gitlab|sonar|nexus|registry|argocd|drone/.test(s)) return 'hammer'
  if (/grafana|prometheus|loki|kibana|exporter|cadvisor|zabbix|uptime|alertmanager|jaeger|tempo/.test(s)) return 'bar-chart-3'
  return 'package'
}

function containerState(c: Container): { label: string; tone: Tone } {
  if (/unhealthy/.test(c.status)) return { label: 'unhealthy', tone: 'danger' }
  if (c.state === 'restarting') return { label: 'restarting', tone: 'danger' }
  if (c.state === 'running') return /healthy/.test(c.status) ? { label: 'healthy', tone: 'success' } : { label: 'running', tone: 'success' }
  if (c.state === 'paused') return { label: 'paused', tone: 'warning' }
  if (c.state === 'exited') return { label: 'exited', tone: 'neutral' }
  return { label: c.state, tone: 'neutral' }
}

const CONTAINER_PAGE = 12

/**
 * A container tile laid out like a table row: the name on top, then three fixed-width chip columns, so the chips
 * line up across every tile, one column wide or in a grid. RAM is always in GiB so its chips are one width. In a very
 * narrow sidebar the chips wrap, column by column.
 */
function ContainerTile(props: { name: string; c: Container; selected: boolean }) {
  const { name, c, selected } = props
  const state = containerState(c)
  return (
    <Box gap="xs" padding="xs" radius="none" border={selected ? 'accent' : true} align="start">
      <Button
        size="sm"
        variant="ghost"
        icon={containerIcon(c)}
        tooltip={c.image}
        onPress={() => set(selectedContainer, { ...read(selectedContainer), [name]: selected ? null : c.name })}
      >
        {c.name}
      </Button>
      <Box direction="row" align="center" gap="xs" wrap>
        <Box direction="row" width={72}>
          <Chip tone={state.tone}>{state.label}</Chip>
        </Box>
        <Box direction="row" width={76}>
          {c.cpuPercent !== undefined ? <Chip tone={barTone(c.cpuPercent)}>{`CPU\u00a0${num(c.cpuPercent)}%`}</Chip> : null}
        </Box>
        <Box direction="row" width={84}>
          {c.memBytes !== undefined ? <Chip>{`RAM\u00a0${num(c.memBytes / 1024 ** 3)}\u00a0GiB`}</Chip> : null}
        </Box>
      </Box>
    </Box>
  )
}

/** Sort choices as plain text links, so no rounded dropdown appears; the active one is plain bold text. */
function SortLinks() {
  const sort = read(containerSort)
  const options: { value: SortKey; label: string }[] = [
    { value: 'cpu', label: 'CPU' },
    { value: 'mem', label: 'RAM' },
    { value: 'name', label: 'Name' }
  ]
  return (
    <Row gap="sm" align="center">
      <Text muted size="xs">
        Sort
      </Text>
      {options.map((o) =>
        o.value === sort ? (
          <Text size="xs" weight="semibold">
            {o.label}
          </Text>
        ) : (
          <Text size="xs">
            <Link onPress={() => set(containerSort, o.value)}>{o.label}</Link>
          </Text>
        )
      )}
    </Row>
  )
}

function ContainersTab(props: { m: Machine }) {
  const { name } = props.m
  const loaded = read(containersBy)[name]
  const data = loaded?.data
  if (!data) {
    if (loaded?.error) {
      return (
        <Callout tone="danger" title="Could not list containers">
          <Text size="sm">{loaded.error}</Text>
        </Callout>
      )
    }
    return <Skeleton lines={5} label="Running docker stats" />
  }

  const sort = read(containerSort)
  const filter = read(containerFilter).trim().toLowerCase()
  const all = data.containers
  const list = all.filter((c) => !filter || c.name.toLowerCase().includes(filter) || c.image.toLowerCase().includes(filter))
  list.sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : sort === 'mem'
        ? (b.memBytes ?? -1) - (a.memBytes ?? -1)
        : (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)
  )
  const showAll = read(showAllContainers)[name] || !!filter
  const shown = showAll ? list : list.slice(0, CONTAINER_PAGE)
  const selected = read(selectedContainer)[name] ?? null
  const bad = all.filter((c) => containerState(c).tone === 'danger')
  const running = all.filter((c) => c.state === 'running').length

  return (
    <Stack gap="sm">
      <Row justify="between" align="center" wrap>
        <Row gap="xs" align="center" wrap>
          <Chip tone="success">{`${running} running`}</Chip>
          {bad.length ? <Chip tone="danger">{`${bad.length} failing`}</Chip> : null}
          {all.length - running ? <Chip>{`${all.length - running} stopped`}</Chip> : null}
        </Row>
        <SortLinks />
      </Row>
      <Input
        label="Filter containers"
        labelHidden
        type="search"
        placeholder="Filter"
        value={read(containerFilter)}
        onChange={(v) => set(containerFilter, v)}
      />
      {selected ? (
        <Box direction="row" gap="xs" align="center" paddingX="xs" radius="none" border="accent" wrap>
          <Box grow>
            <Text size="sm" weight="medium" truncate>
              {selected}
            </Text>
          </Box>
          <Button size="sm" variant="ghost" icon="file-text" onPress={() => terminal(name, 'logs', selected)}>
            Logs
          </Button>
          <Button size="sm" variant="ghost" icon="terminal" onPress={() => terminal(name, 'shell', selected)}>
            Shell
          </Button>
        </Box>
      ) : null}
      <Grid minItemWidth="lg" gap="xs">
        {shown.map((c) => (
          <ContainerTile name={name} c={c} selected={selected === c.name} />
        ))}
      </Grid>
      {!showAll && list.length > CONTAINER_PAGE ? (
        <Button variant="ghost" size="sm" icon="expand" onPress={() => set(showAllContainers, { ...read(showAllContainers), [name]: true })}>
          {`Show ${list.length - CONTAINER_PAGE} more`}
        </Button>
      ) : null}
      {!list.length ? (
        <Text muted size="sm">
          No container matches.
        </Text>
      ) : null}
      <Row justify="between" align="center">
        <Text muted size="xs">{`measured ${clock(data.at)}`}</Text>
        <Button variant="ghost" size="sm" icon="refresh" disabled={!!loaded?.loading} onPress={() => loadContainers(name)}>
          Refresh
        </Button>
      </Row>
    </Stack>
  )
}

const DOCKER_ICON: Record<string, IconName> = {
  Images: 'layers',
  Containers: 'package',
  'Local Volumes': 'database',
  'Build Cache': 'hammer'
}
const DOCKER_LABEL: Record<string, string> = {
  Images: 'Images',
  Containers: 'Containers',
  'Local Volumes': 'Volumes',
  'Build Cache': 'Build cache'
}

function SectionTitle(props: { children: string }) {
  return (
    <Text size="sm" weight="semibold">
      {props.children}
    </Text>
  )
}

/** Builds a directory tree from du's paths: a directory's parent is the longest path that contains it. */
export function dirTree(dirs: { path: string; bytes: number }[], diskBytes: number): TreeItem[] {
  const sorted = [...dirs].sort((a, b) => a.path.split('/').length - b.path.split('/').length || b.bytes - a.bytes)
  const nodes = new Map<string, TreeItem & { children: TreeItem[] }>()
  const roots: TreeItem[] = []
  for (const d of sorted) {
    const node = {
      key: d.path,
      label: d.path.split('/').pop() || d.path,
      description: `${bytes(d.bytes)} · ${Math.round(share(d.bytes, diskBytes) * 100)}%`,
      icon: 'folder' as IconName,
      children: [] as TreeItem[]
    }
    let parent: string | undefined
    for (const p of nodes.keys()) if (d.path.startsWith(`${p}/`) && (!parent || p.length > parent.length)) parent = p
    if (parent) nodes.get(parent)!.children.push(node)
    else roots.push({ ...node, label: d.path })
    nodes.set(d.path, node)
  }
  const strip = (items: readonly TreeItem[]): TreeItem[] =>
    items.map((i) => (i.children?.length ? { ...i, children: strip(i.children) } : { key: i.key, label: i.label, description: i.description, icon: i.icon }))
  return strip(roots)
}

// Red is kept for alerts, so the disk map uses blue for Docker and green and yellow for the two largest directories.
const MAP_TONES: Tone[] = ['success', 'warning']

function DiskTab(props: { m: Machine }) {
  const { name } = props.m
  const loaded = read(diskBy)[name]
  const report = loaded?.data
  if (!report || loaded?.loading) {
    if (loaded?.error && !loaded.loading) {
      return (
        <Callout tone="danger" title="Could not measure disk">
          <Text size="sm">{loaded.error}</Text>
        </Callout>
      )
    }
    return <Skeleton lines={6} label="Measuring disk, this can take a minute" />
  }

  const root = report.filesystems.find((f) => f.mount === '/') ?? report.filesystems[0]
  const docker = report.docker ?? []
  const reclaimable = docker.reduce((a, d) => a + d.reclaimableBytes, 0)
  const dockerMax = Math.max(1, ...docker.map((d) => d.sizeBytes))
  const size = root?.sizeBytes ?? 0
  const used = root?.usedBytes ?? 0

  // The disk map: Docker (du skips /var/lib/docker), the two largest top-level directories, the rest, free space.
  const tops = report.dirs.filter((d) => d.path.split('/').length === 2).slice(0, 2)
  const topBytes = tops.reduce((a, d) => a + d.bytes, 0)
  const dockerBytes = Math.min(docker.reduce((a, d) => a + d.sizeBytes, 0), Math.max(0, used - topBytes))
  const other = Math.max(0, used - dockerBytes - topBytes)
  const parts = [
    ...(dockerBytes > 0 ? [{ tone: 'accent' as Tone, share: share(dockerBytes, size), label: `Docker ${bytes(dockerBytes)}` }] : []),
    ...tops.map((d, i) => ({ tone: MAP_TONES[i], share: share(d.bytes, size), label: `${d.path} ${bytes(d.bytes)}` })),
    { tone: 'neutral' as Tone, share: share(other, size), label: `Other ${bytes(other)}` }
  ].filter((p) => p.share > 0)
  const tree = dirTree(report.dirs, size)

  return (
    <Stack gap="md">
      {root ? (
        <Stack gap="xs">
          <Row justify="between" align="center">
            <Pct value={root.percent} />
            <Text muted size="xs">{`${bytes(used)} of ${bytes(size)}, ${bytes(size - used)} free`}</Text>
          </Row>
          <Gauge parts={parts} />
          <Legend items={parts} />
        </Stack>
      ) : null}

      {reclaimable > 0 ? (
        <Callout tone="success" title={`About ${bytes(reclaimable)} can be freed`} icon="check">
          <Text size="sm">Old images, build cache and volumes no container uses.</Text>
        </Callout>
      ) : null}

      <Stack gap="xs">
        <SectionTitle>Docker</SectionTitle>
        {docker.length ? (
          <Grid minItemWidth="lg" gap="xs">
            {docker.map((d) => (
              <Frame>
                <Row justify="between" align="center">
                  <Button size="sm" variant="ghost" icon={DOCKER_ICON[d.type] ?? 'package'}>
                    {`${DOCKER_LABEL[d.type] ?? d.type} (${d.count})`}
                  </Button>
                  <Text size="sm" weight="medium">
                    {bytes(d.sizeBytes)}
                  </Text>
                </Row>
                <Gauge
                  cells={12}
                  parts={[
                    { tone: 'accent', share: share(d.sizeBytes - d.reclaimableBytes, dockerMax) },
                    { tone: 'success', share: share(d.reclaimableBytes, dockerMax) }
                  ]}
                />
                <Text muted size="xs">{`${bytes(d.sizeBytes - d.reclaimableBytes)} in use, ${bytes(d.reclaimableBytes)} reclaimable`}</Text>
              </Frame>
            ))}
          </Grid>
        ) : (
          <Text muted size="sm">
            {report.dockerError ?? 'No Docker on this machine.'}
          </Text>
        )}
      </Stack>

      <Stack gap="xs">
        <SectionTitle>Largest directories</SectionTitle>
        {report.dirsPartial ? (
          <Text tone="warning" size="xs">
            du stopped after 75 seconds in some directories, so these numbers are short.
          </Text>
        ) : null}
        <Tree label="Largest directories" items={tree} defaultExpanded={tree.slice(0, 1).map((t) => t.key)} />
      </Stack>

      {report.logs.length ? (
        <Stack gap="xs">
          <SectionTitle>Largest container logs</SectionTitle>
          <KeyValue items={report.logs.map((l) => ({ label: l.container, value: bytes(l.bytes) }))} />
        </Stack>
      ) : null}

      <Row justify="between" align="center">
        <Text muted size="xs">{`measured ${clock(report.at)}`}</Text>
        <Button variant="ghost" size="sm" icon="refresh" onPress={() => loadDisk(name)}>
          Refresh
        </Button>
      </Row>
    </Stack>
  )
}

/** The selected machine: name and Shell on one line, the SSH target and uptime under it, then the tabs. */
function MachineDetail(props: { m: Machine }) {
  const { m } = props
  const subtitle = [m.target, m.hostname && m.hostname !== m.name ? m.hostname : '', m.state === 'online' && m.uptimeSeconds !== undefined ? `up ${uptimeText(m.uptimeSeconds)}` : '']
    .filter(Boolean)
    .join(' · ')
  const tab = read(tabs)[m.name] ?? 'overview'
  return (
    <Frame padding="md">
      <Row justify="between" align="center">
        <Stack gap="none">
          <Text weight="semibold">{m.name}</Text>
          <Text muted size="xs">
            {subtitle}
          </Text>
        </Stack>
        <Button size="sm" variant="ghost" icon="terminal" tooltip={`Open an Orca terminal running ssh -t ${m.target}`} onPress={() => terminal(m.name, 'shell')}>
          Shell
        </Button>
      </Row>
      {m.state === 'offline' ? (
        <Text tone="danger" size="sm">{`Offline since ${clock(m.since)}: ${m.error ?? 'unknown error'}`}</Text>
      ) : m.state === 'connecting' || !m.at ? (
        <Skeleton lines={3} label="Connecting over SSH" />
      ) : (
        <Tabs label={`View ${m.name}`} value={tab} onChange={(v) => openTab(m.name, v as TabId)}>
          <Tab value="overview" label="Overview">
            {tab === 'overview' ? <OverviewTab m={m} /> : null}
          </Tab>
          <Tab value="containers" label="Containers">
            {tab === 'containers' ? <ContainersTab m={m} /> : null}
          </Tab>
          <Tab value="disk" label="Disk">
            {tab === 'disk' ? <DiskTab m={m} /> : null}
          </Tab>
        </Tabs>
      )}
    </Frame>
  )
}

function HostsEditor() {
  const value = read(draft) ?? read(savedHosts)
  return (
    <Frame padding="md">
      <Text weight="semibold">Machines to watch</Text>
      <Textarea
        label="Machines to watch"
        labelHidden
        value={value}
        placeholder="web-01=ubuntu@10.0.0.1"
        rows={4}
        onChange={(v) => set(draft, v)}
      />
      <Row gap="xs" align="center">
        <Button size="sm" variant="ghost" icon="check" onPress={saveHosts} disabled={read(draft) === null}>
          Save
        </Button>
        {read(machines)?.length ? (
          <Button
            size="sm"
            variant="ghost"
            icon="close"
            onPress={() => {
              set(draft, null)
              set(editing, false)
            }}
          >
            Close
          </Button>
        ) : null}
        <IconButton
          icon="info"
          label="How to list machines"
          tooltip="One machine per line as name=ssh-target, for example web-01=ubuntu@10.0.0.1. The target can also be a Host from ~/.ssh/config. The machine must accept your SSH key without a password prompt."
          variant="ghost"
          size="sm"
        />
      </Row>
    </Frame>
  )
}

export default function Panel() {
  const all = read(machines)
  const list = all ?? []
  const note = read(notice)
  const online = list.filter((m) => m.state === 'online').length
  const picked = current(list)
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Row gap="sm" align="center">
          <Heading level={2}>Machines</Heading>
          {list.length ? (
            <Chip tone={online === list.length ? 'success' : list.some((m) => m.state === 'offline') ? 'danger' : 'neutral'}>
              {`${online}/${list.length} online`}
            </Chip>
          ) : null}
        </Row>
        <Row gap="xs" align="center">
          <IconButton icon="refresh" label="Reconnect every machine" variant="ghost" onPress={() => run(() => plugin.request('machines.reconnect'))} />
          <IconButton icon="settings" label="Edit machines" variant="ghost" onPress={() => set(editing, !read(editing))} />
        </Row>
      </Row>
      {note ? (
        <Callout tone={note.tone}>
          <Row justify="between" align="center">
            <Text size="sm">{note.text}</Text>
            <IconButton icon="close" label="Dismiss" variant="ghost" size="xs" onPress={() => set(notice, null)} />
          </Row>
        </Callout>
      ) : null}
      {all === null ? (
        <Skeleton lines={6} label="Asking the worker" />
      ) : !list.length ? (
        <Stack gap="md">
          <EmptyState icon="gauge" title="No machines yet" description="Add machines below and press Save." />
          <HostsEditor />
        </Stack>
      ) : (
        <Stack gap="md">
          {read(editing) ? <HostsEditor /> : null}
          <Stack gap="xs">
            {list.map((m) => (
              <HostRow m={m} selected={m === picked} />
            ))}
          </Stack>
          {picked ? <MachineDetail m={picked} /> : null}
        </Stack>
      )}
    </Stack>
  )
}
