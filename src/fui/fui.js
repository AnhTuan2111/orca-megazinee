// Megazinee FUI panel: the same features as the components panel (src/panel.tsx), drawn as an HTML page so it can
// use augmented-ui cut frames and CSS charge gauges. It talks to the same worker through orca.plugin.request and
// hears its pushes through orca.plugin.on. Each part of the page has its own render function, so the 2 second
// updates redraw the host list and the Overview only, never an input you are typing in.

const app = {
  machines: null,
  hosts: '',
  selected: null,
  tabs: {},
  containers: {},
  disk: {},
  sort: 'cpu',
  filter: '',
  picked: {},
  showAll: {},
  editing: false,
  draft: null,
  notice: null,
  /** Gauges charge cell by cell until this time, so they animate when a view opens, not on every update. */
  chargeUntil: 0,
  openDirs: new Set()
}

const $ = (id) => document.getElementById(id)

/** Line icons drawn as SVG paths, so no symbol falls back to an emoji glyph. */
const ICON = {
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  terminal: '<path d="M4 6l6 6-6 6M12 18h8"/>',
  logs: '<path d="M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  layers: '<path d="M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  hammer: '<path d="M14 6l4 4M3 21l9-9M13 3l8 8-3 3-8-8z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  package: '<path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/>'
}
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const num = (x, d = 1) => Number(x).toFixed(d)
const clock = (at) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const NB = ' '

function bytes(b) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = Math.abs(b)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${b < 0 ? '-' : ''}${num(v, v >= 100 || i === 0 ? 0 : 1)}${NB}${units[i]}`
}

/** Four colours from calm to urgent, the same thresholds as health.ts. */
function tone(percent) {
  if (percent >= 80) return 'red'
  if (percent >= 70) return 'yellow'
  if (percent >= 50) return 'blue'
  return 'green'
}

function uptime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((seconds % 3600) / 60)}m`
}

const share = (part, whole) => (whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0)

/** A charge gauge: slanted cells, filled ones in their part's colour. */
function gauge(parts, cells = 10, label = '') {
  let used = 0
  let html = ''
  for (const p of parts) {
    const end = Math.min(cells, Math.round((p.share + used / cells) * cells))
    for (; used < end; used++) html += `<i class="cell on t-${p.tone}" style="--i:${used}"></i>`
  }
  for (; used < cells; used++) html += '<i class="cell"></i>'
  const charge = Date.now() < app.chargeUntil ? ' charge' : ''
  return `<span class="gauge${charge}" role="img" aria-label="${esc(label)}">${html}</span>`
}

const chip = (text, t) => `<span class="chip${t ? ` t-${t}` : ''}" data-augmented-ui="tl-clip br-clip border">${esc(text)}</span>`

async function request(name, input, timeoutMs) {
  return orca.plugin.request(name, input, timeoutMs ? { timeoutMs } : undefined)
}

function notify(t, text) {
  app.notice = text ? { tone: t, text } : null
  renderNotice()
}

// ----- data -----

async function loadSnapshot() {
  try {
    const answer = await request('machines.snapshot')
    app.machines = answer.machines
    app.hosts = answer.hosts
    renderAll()
    const m = current()
    if (m && m.state === 'online') openTab(m.name, app.tabs[m.name] || 'overview', true)
  } catch (e) {
    notify('red', e.message || String(e))
  }
}

function current() {
  const list = app.machines || []
  return list.find((m) => m.name === app.selected) || list.find((m) => m.state === 'offline') || list[0]
}

async function fromCache(name) {
  if (app.containers[name]?.data && app.disk[name]?.data) return
  const cached = await request('machines.cached', { name }).catch(() => null)
  if (!cached) return
  if (cached.containers && !app.containers[name]?.data) app.containers[name] = { ...app.containers[name], data: cached.containers }
  if (cached.disk && !app.disk[name]?.data) app.disk[name] = { ...app.disk[name], data: cached.disk }
}

async function loadContainers(name) {
  app.containers[name] = { ...app.containers[name], loading: true, error: null }
  await fromCache(name)
  renderDetail()
  try {
    const data = await request('machines.containers', { name }, 60000)
    app.containers[name] = { loading: false, data }
  } catch (e) {
    app.containers[name] = { ...app.containers[name], loading: false, error: e.message || String(e) }
  }
  renderDetail()
}

async function loadDisk(name, force = false) {
  await fromCache(name)
  const have = app.disk[name]?.data
  if (!force && have && Date.now() - have.at < 3600000) return renderDetail()
  app.disk[name] = { ...app.disk[name], loading: true, error: null }
  renderDetail()
  try {
    const data = await request('machines.disk', { name }, 120000)
    app.disk[name] = { loading: false, data }
  } catch (e) {
    app.disk[name] = { ...app.disk[name], loading: false, error: e.message || String(e) }
  }
  renderDetail()
}

function openTab(name, tab, first = false) {
  app.tabs[name] = tab
  app.chargeUntil = Date.now() + 900
  saveView()
  renderDetail()
  if (tab === 'containers' && !app.containers[name]?.loading) loadContainers(name)
  if (tab === 'disk' && !app.disk[name]?.loading) loadDisk(name)
  if (first) return
}

async function terminal(name, kind, container) {
  try {
    const answer = await request('machines.terminal', container ? { name, kind, container } : { name, kind })
    notify(answer.background ? 'yellow' : null, answer.background ? `Started in the background without a tab, because ${answer.background}.` : null)
  } catch (e) {
    notify('red', e.message || String(e))
  }
}

async function saveView() {
  try {
    await orca.storage.set('fui.view', { selected: app.selected, tabs: app.tabs, sort: app.sort })
  } catch {}
}

async function loadView() {
  try {
    const v = await orca.storage.get('fui.view')
    if (v && typeof v === 'object') Object.assign(app, { selected: v.selected ?? null, tabs: v.tabs ?? {}, sort: v.sort ?? 'cpu' })
  } catch {}
}

// ----- render -----

function renderAll() {
  renderTop()
  renderNotice()
  renderEditor()
  renderHosts()
  renderDetail()
}

function renderTop() {
  const list = app.machines || []
  const online = list.filter((m) => m.state === 'online').length
  const t = !list.length ? '' : online === list.length ? 'green' : list.some((m) => m.state === 'offline') ? 'red' : 'gray'
  $('top').innerHTML = `
    <div class="brand"><h1>Megazinee</h1>${list.length ? chip(`${online}/${list.length} online`, t) : ''}</div>
    <div>
      <button class="icon-btn" data-act="reconnect" title="Reconnect every machine" aria-label="Reconnect every machine">${icon('refresh')}</button>
      <button class="icon-btn" data-act="edit" title="Edit machines" aria-label="Edit machines">${icon('gear')}</button>
    </div>`
}

function renderNotice() {
  const n = app.notice
  $('notice').innerHTML = n
    ? `<div class="callout t-${n.tone}"><span>${esc(n.text)}</span><button class="icon-btn" data-act="dismiss" aria-label="Dismiss">${icon('close')}</button></div>`
    : ''
}

function renderEditor() {
  const show = app.editing || (app.machines && !app.machines.length)
  if (!show) {
    $('editor').innerHTML = ''
    return
  }
  if ($('hosts-text')) return
  $('editor').innerHTML = `
    <div class="frame stack" data-augmented-ui="tl-clip br-clip border">
      <strong>Machines to watch</strong>
      <textarea id="hosts-text" rows="4" placeholder="web-01=ubuntu@10.0.0.1" aria-label="Machines to watch">${esc(app.draft ?? app.hosts)}</textarea>
      <div>
        <button class="btn" data-act="save-hosts" data-augmented-ui="tl-clip br-clip border">Save</button>
        ${app.machines?.length ? '<button class="btn" data-act="close-editor" data-augmented-ui="tl-clip br-clip border">Close</button>' : ''}
        <span class="muted" title="One machine per line as name=ssh-target, for example web-01=ubuntu@10.0.0.1, or ubuntu@10.0.0.1:2222 for another port. Key login only.">${icon('info')} one per line, name=user@host:port</span>
      </div>
    </div>`
}

function renderHosts() {
  const list = app.machines || []
  const picked = current()
  $('hosts').innerHTML = list
    .map((m) => {
      let stats
      if (m.state === 'offline') stats = `<span class="tone t-red">offline since ${clock(m.since)}</span>`
      else if (m.state === 'connecting' || !m.at) stats = '<span class="muted">connecting</span>'
      else
        stats = ['CPU', 'RAM', 'Disk']
          .map((k, i) => {
            const v = [m.cpuPercent, m.memPercent, m.diskPercent][i] ?? 0
            return `<span><span class="muted">${k}</span> <span class="num tone t-${tone(v)}">${num(v, 0)}%</span></span>`
          })
          .join('')
      return `<button class="host frame${m === picked ? ' lit' : ''}" data-augmented-ui="tl-clip br-clip border" data-act="select" data-name="${esc(m.name)}">
        <span class="name">${esc(m.name)}</span><span class="stats">${stats}</span></button>`
    })
    .join('')
}

function renderDetail() {
  const m = current()
  if (!m) {
    $('detail').innerHTML = app.machines ? '' : '<div class="skeleton" data-augmented-ui="tl-clip br-clip"></div>'
    return
  }
  const sub = [m.target, m.hostname && m.hostname !== m.name ? m.hostname : '', m.state === 'online' && m.uptimeSeconds !== undefined ? `up ${uptime(m.uptimeSeconds)}` : '']
    .filter(Boolean)
    .join(', ')
  const tab = app.tabs[m.name] || 'overview'
  let body
  if (m.state === 'offline') body = `<p class="tone t-red">Offline since ${clock(m.since)}: ${esc(m.error || 'unknown error')}</p>`
  else if (m.state === 'connecting' || !m.at) body = '<div class="skeleton"></div>'
  else
    body = `<div class="tabs" role="tablist">
        ${['overview', 'containers', 'disk']
          .map((t) => `<button class="tab" role="tab" aria-selected="${t === tab}" data-act="tab" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`)
          .join('')}
      </div>
      <div id="tab-body">${tab === 'overview' ? overview(m) : tab === 'containers' ? containersTab(m) : diskTab(m)}</div>`
  const keepFilter = tab === 'containers' && document.activeElement?.id === 'filter'
  $('detail').innerHTML = `<div class="frame" data-augmented-ui="tl-clip br-clip border">
    <div class="detail-head">
      <div><h2>${esc(m.name)}</h2><p class="muted">${esc(sub)}</p></div>
      <button class="btn" data-act="shell" data-augmented-ui="tl-clip br-clip border" title="Open an Orca terminal running ssh to this machine">${icon('terminal')} Shell</button>
    </div>${body}</div>`
  if (keepFilter) {
    const f = $('filter')
    f.focus()
    f.setSelectionRange(f.value.length, f.value.length)
  }
}

function meter(label, v) {
  if (v === undefined) return `<div class="meter"><span class="label muted">${label}</span><span></span><span class="value muted">n/a</span></div>`
  const t = tone(v)
  const alert = v >= 70
  return `<div class="meter t-${t}"><span class="label${alert ? ' alert' : ' muted'}">${label}</span>${gauge([{ tone: t, share: v / 100 }], 10, `${label} ${num(v)}%`)}<span class="value num tone">${num(v)}%</span></div>`
}

function chart(title, summary, values, lo, hi, from, to) {
  const cols = values
    .map((v) => {
      if (v === null) return '<i class="col empty"></i>'
      const h = Math.max(3, Math.round(((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo || 1)) * 86))
      return `<i class="col t-${tone(v)}" style="height:${h}px"></i>`
    })
    .join('')
  return `<div>
    <div class="chart-head">${esc(title)}<span class="muted">${esc(summary || '')}</span></div>
    <div class="chart frame" data-augmented-ui="tl-clip br-clip border">${cols}</div>
    <div class="chart-foot muted"><span>${from}</span><span>${to}</span></div></div>`
}

function overview(m) {
  const cpu = m.cpuMinutes.filter((v) => v !== null)
  const disk = m.diskHours.filter((v) => v !== null)
  const dmin = disk.length ? Math.max(0, Math.floor(Math.min(...disk)) - 2) : 0
  const dmax = disk.length ? Math.min(100, Math.ceil(Math.max(...disk)) + 1) : 100
  const cmax = cpu.length ? Math.min(100, Math.max(20, Math.ceil((Math.max(...cpu) + 5) / 10) * 10)) : 100
  const rows = []
  if (m.load) rows.push(['Load avg', `${m.load.map((x) => num(x, 2)).join('  ')}${m.cpus ? ` / ${m.cpus} CPU` : ''}`])
  if (m.netRxBps !== undefined) rows.push(['Network', `in ${bytes(m.netRxBps)}/s, out ${bytes(m.netTxBps)}/s`])
  if (m.containers) {
    const c = m.containers
    const bad = [c.unhealthy ? `${c.unhealthy} unhealthy` : '', c.restarting ? `${c.restarting} restarting` : ''].filter(Boolean).join(', ')
    rows.push(['Containers', `${c.running}/${c.total} running${bad ? `, ${bad}` : ''}`])
  }
  if (m.failedUnits !== undefined) rows.push(['Failed units', String(m.failedUnits)])
  if (m.memTotalBytes && m.diskTotalBytes) rows.push(['Capacity', `RAM ${bytes(m.memTotalBytes)}, disk ${bytes(m.diskTotalBytes)}`])
  return `<div class="stack">
    <div class="stack" style="gap:6px">${meter('CPU', m.cpuPercent)}${meter('RAM', m.memPercent)}${meter('Disk', m.diskPercent)}</div>
    ${chart('Disk / in 24 hours', disk.length ? `${num(Math.min(...disk))}% to ${num(Math.max(...disk))}%` : '', m.diskHours, dmin, dmax, '24 hours ago', 'now')}
    ${chart('CPU in 30 minutes', cpu.length ? `avg ${num(cpu.reduce((a, b) => a + b, 0) / cpu.length, 0)}%, peak ${num(Math.max(...cpu), 0)}%` : 'not a full minute yet', m.cpuMinutes, 0, cmax, '30 minutes ago', 'last minute')}
    <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
  </div>`
}

function containerIcon(c) {
  const s = `${c.name} ${c.image.split('/').pop() || ''}`.toLowerCase()
  if (/postgres|pgvector|mysql|mariadb|oracle|mongo|redis|valkey|elastic|opensearch|clickhouse|influx|cassandra|etcd|patroni|minio/.test(s)) return 'database'
  if (/kafka|rabbit|nats|zookeeper|activemq|pulsar|redpanda/.test(s)) return 'layers'
  if (/nginx|traefik|caddy|haproxy|envoy|httpd|apache/.test(s)) return 'globe'
  if (/runner|jenkins|gitlab|sonar|nexus|registry|argocd|drone/.test(s)) return 'hammer'
  if (/grafana|prometheus|loki|kibana|exporter|cadvisor|zabbix|uptime|alertmanager|jaeger|tempo/.test(s)) return 'chart'
  return 'package'
}

function containerState(c) {
  if (/unhealthy/.test(c.status)) return ['unhealthy', 'red']
  if (c.state === 'restarting') return ['restarting', 'red']
  if (c.state === 'running') return [/healthy/.test(c.status) ? 'healthy' : 'running', 'green']
  if (c.state === 'paused') return ['paused', 'yellow']
  return [c.state === 'exited' ? 'exited' : c.state, null]
}

function containersTab(m) {
  const loaded = app.containers[m.name]
  const data = loaded?.data
  if (!data) return loaded?.error ? `<p class="tone t-red">${esc(loaded.error)}</p>` : '<div class="skeleton"></div>'
  const f = app.filter.trim().toLowerCase()
  const list = data.containers.filter((c) => !f || c.name.toLowerCase().includes(f) || c.image.toLowerCase().includes(f))
  list.sort((a, b) =>
    app.sort === 'name' ? a.name.localeCompare(b.name) : app.sort === 'mem' ? (b.memBytes ?? -1) - (a.memBytes ?? -1) : (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)
  )
  const all = data.containers
  const running = all.filter((c) => c.state === 'running').length
  const bad = all.filter((c) => containerState(c)[1] === 'red').length
  const showAll = app.showAll[m.name] || !!f
  const shown = showAll ? list : list.slice(0, 12)
  const picked = app.picked[m.name]
  const tiles = shown
    .map((c) => {
      const [label, t] = containerState(c)
      const cpu = c.cpuPercent === undefined ? undefined : c.cpuPercent / (m.cpus || 1)
      return `<button class="ctile frame${picked === c.name ? ' lit' : ''}" data-augmented-ui="tl-clip br-clip border" data-act="pick" data-c="${esc(c.name)}" title="${esc(c.image)}">
        <span class="cname">${icon(containerIcon(c))}${esc(c.name)}</span>
        <span class="ccols"><span>${chip(label, t)}</span><span>${cpu === undefined ? '' : chip(`CPU ${num(cpu)}%`, tone(cpu))}</span><span>${c.memBytes === undefined ? '' : chip(`RAM ${num(c.memBytes / 1073741824)} GiB`)}</span></span>
      </button>`
    })
    .join('')
  return `<div class="stack">
    <div class="toolbar">
      <span>${chip(`${running} running`, 'green')} ${bad ? chip(`${bad} failing`, 'red') : ''} ${all.length - running ? chip(`${all.length - running} stopped`) : ''}</span>
      <span class="sort"><span class="muted">Sort</span>${[
        ['cpu', 'CPU'],
        ['mem', 'RAM'],
        ['name', 'Name']
      ]
        .map(([k, l]) => `<button aria-pressed="${app.sort === k}" data-act="sort" data-sort="${k}">${l}</button>`)
        .join('')}</span>
    </div>
    <input id="filter" type="search" placeholder="Filter" aria-label="Filter containers" value="${esc(app.filter)}" />
    ${
      picked
        ? `<div class="picked frame lit" data-augmented-ui="tl-clip br-clip border"><strong>${esc(picked)}</strong>
            <button class="btn" data-act="logs" data-augmented-ui="tl-clip br-clip border" title="Follow this container's logs">${icon('logs')} Logs</button>
            <button class="btn" data-act="cshell" data-augmented-ui="tl-clip br-clip border" title="Open a shell inside this container. exit to close.">${icon('terminal')} Shell</button></div>`
        : ''
    }
    <div class="grid">${tiles}</div>
    ${!showAll && list.length > 12 ? `<button class="btn" data-act="more" data-augmented-ui="tl-clip br-clip border">Show ${list.length - 12} more</button>` : ''}
    ${!list.length ? '<p class="muted">No container matches.</p>' : ''}
    <div class="foot muted"><span>measured ${clock(data.at)}${loaded.loading ? ', updating' : ''}</span>
      <button class="btn" data-act="refresh-containers" ${loaded.loading ? 'disabled' : ''}>Refresh</button></div>
  </div>`
}

function dirTree(dirs, size) {
  const sorted = [...dirs].sort((a, b) => a.path.split('/').length - b.path.split('/').length || b.bytes - a.bytes)
  const nodes = new Map()
  const roots = []
  for (const d of sorted) {
    const node = { ...d, children: [] }
    let parent
    for (const p of nodes.keys()) if (d.path.startsWith(`${p}/`) && (!parent || p.length > parent.length)) parent = p
    if (parent) nodes.get(parent).children.push(node)
    else roots.push(node)
    nodes.set(d.path, node)
  }
  const item = (n, top) => {
    const label = top ? n.path : n.path.split('/').pop()
    const meta = `<span class="num muted">${bytes(n.bytes)}, ${Math.round(share(n.bytes, size) * 100)}%</span>`
    if (!n.children.length) return `<li><div class="leaf"><span>${esc(label)}</span>${meta}</div></li>`
    const open = app.openDirs.has(n.path) ? ' open' : ''
    return `<li><details${open} data-path="${esc(n.path)}"><summary><span>${esc(label)}</span>${meta}</summary><ul>${n.children.map((c) => item(c, false)).join('')}</ul></details></li>`
  }
  return `<ul class="tree">${roots.map((r) => item(r, true)).join('')}</ul>`
}

function diskTab(m) {
  const loaded = app.disk[m.name]
  const r = loaded?.data
  if (!r) return loaded?.error ? `<p class="tone t-red">${esc(loaded.error)}</p>` : '<p class="muted">Measuring disk, this can take a minute.</p><div class="skeleton"></div>'
  const root = r.filesystems.find((f) => f.mount === '/') || r.filesystems[0]
  const docker = r.docker || []
  const size = root?.sizeBytes || 0
  const used = root?.usedBytes || 0
  const tops = r.dirs.filter((d) => d.path.split('/').length === 2).slice(0, 1)
  const topBytes = tops.reduce((a, d) => a + d.bytes, 0)
  const dockerBytes = Math.min(docker.reduce((a, d) => a + d.sizeBytes, 0), Math.max(0, used - topBytes))
  const other = Math.max(0, used - dockerBytes - topBytes)
  const parts = [
    dockerBytes > 0 ? { tone: 'blue', share: share(dockerBytes, size), label: `Docker ${bytes(dockerBytes)}` } : null,
    ...tops.map((d) => ({ tone: 'green', share: share(d.bytes, size), label: `${d.path} ${bytes(d.bytes)}` })),
    { tone: 'gray', share: share(other, size), label: `Other ${bytes(other)}` }
  ].filter((p) => p && p.share > 0)
  const freed = docker.filter((d) => d.type !== 'Local Volumes').reduce((a, d) => a + d.reclaimableBytes, 0)
  const loose = docker.find((d) => d.type === 'Local Volumes')?.reclaimableBytes || 0
  const dmax = Math.max(1, ...docker.map((d) => d.sizeBytes))
  const label = { Images: 'Images', Containers: 'Containers', 'Local Volumes': 'Volumes', 'Build Cache': 'Build cache' }
  return `<div class="stack">
    ${
      root
        ? `<div class="stack" style="gap:6px">
        <div class="chart-head"><span class="num tone t-${tone(root.percent)}" style="font-size:14px;font-weight:700">${num(root.percent)}%</span><span class="muted">${bytes(used)} of ${bytes(size)}, ${bytes(size - used)} free</span></div>
        ${gauge(parts, 16, 'Disk map')}
        <div class="legend">${parts.map((p) => `<span class="t-${p.tone}"><span class="swatch"></span>${esc(p.label)}</span>`).join('')}</div></div>`
        : ''
    }
    ${freed > 0 ? `<div class="callout t-green"><span class="freed">About ${bytes(freed)} can be freed: images no container uses and build cache.</span></div>` : ''}
    ${loose > 0 ? `<p class="muted" style="margin:0;font-size:11px">${bytes(loose)} sit in volumes no container uses. They can hold data, so check each one before deleting.</p>` : ''}
    <div><h3 class="section-title">Docker</h3>
      ${
        docker.length
          ? `<div class="docker-grid">${docker
              .map(
                (d) => `<div class="frame stack" style="gap:6px" data-augmented-ui="tl-clip br-clip border">
              <div class="chart-head">${label[d.type] || d.type} (${d.count})<span class="num">${bytes(d.sizeBytes)}</span></div>
              ${gauge(
                [
                  { tone: 'blue', share: share(d.sizeBytes - d.reclaimableBytes, dmax) },
                  { tone: 'green', share: share(d.reclaimableBytes, dmax) }
                ],
                12,
                d.type
              )}
              <span class="muted" style="font-size:11px">${bytes(d.sizeBytes - d.reclaimableBytes)} in use, ${bytes(d.reclaimableBytes)} ${d.type === 'Local Volumes' ? 'not attached' : 'reclaimable'}</span></div>`
              )
              .join('')}</div>`
          : `<p class="muted">${esc(r.dockerError || 'No Docker on this machine.')}</p>`
      }</div>
    <div><h3 class="section-title">Largest directories</h3>${r.dirsPartial ? '<p class="tone t-yellow" style="font-size:11px">du stopped after 75 seconds in some directories, so these numbers are short.</p>' : ''}${dirTree(r.dirs, size)}</div>
    ${r.logs.length ? `<div><h3 class="section-title">Largest container logs</h3><dl class="kv">${r.logs.map((l) => `<dt>${esc(l.container)}</dt><dd class="num">${bytes(l.bytes)}</dd>`).join('')}</dl></div>` : ''}
    <div class="foot muted"><span>measured ${clock(r.at)}${loaded.loading ? ', scanning again' : ''}</span>
      <button class="btn" data-act="refresh-disk" ${loaded.loading ? 'disabled' : ''}>Refresh</button></div>
  </div>`
}

// ----- events -----

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]')
  if (!el) return
  const m = current()
  const act = el.dataset.act
  if (act === 'select') {
    app.selected = el.dataset.name
    app.chargeUntil = Date.now() + 900
    saveView()
    renderHosts()
    const sel = current()
    if (sel && sel.state === 'online') openTab(sel.name, app.tabs[sel.name] || 'overview')
    else renderDetail()
  } else if (act === 'tab' && m) openTab(m.name, el.dataset.tab)
  else if (act === 'shell' && m) terminal(m.name, 'shell')
  else if (act === 'pick' && m) {
    app.picked[m.name] = app.picked[m.name] === el.dataset.c ? null : el.dataset.c
    renderDetail()
  } else if (act === 'logs' && m) terminal(m.name, 'logs', app.picked[m.name])
  else if (act === 'cshell' && m) terminal(m.name, 'shell', app.picked[m.name])
  else if (act === 'sort') {
    app.sort = el.dataset.sort
    saveView()
    renderDetail()
  } else if (act === 'more' && m) {
    app.showAll[m.name] = true
    renderDetail()
  } else if (act === 'refresh-containers' && m) loadContainers(m.name)
  else if (act === 'refresh-disk' && m) loadDisk(m.name, true)
  else if (act === 'reconnect') request('machines.reconnect').catch((e) => notify('red', e.message))
  else if (act === 'edit') {
    app.editing = !app.editing
    app.draft = null
    $('editor').innerHTML = ''
    renderEditor()
  } else if (act === 'close-editor') {
    app.editing = false
    app.draft = null
    renderEditor()
  } else if (act === 'save-hosts') {
    const text = $('hosts-text')?.value ?? app.hosts
    request('machines.setHosts', { hosts: text })
      .then(() => {
        app.editing = false
        app.draft = null
        $('editor').innerHTML = ''
        return loadSnapshot()
      })
      .catch((e) => notify('red', e.message))
  } else if (act === 'dismiss') notify(null, null)
})

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'filter') {
    app.filter = ev.target.value
    renderDetail()
  } else if (ev.target.id === 'hosts-text') app.draft = ev.target.value
})

document.addEventListener(
  'toggle',
  (ev) => {
    const d = ev.target
    if (d.tagName !== 'DETAILS' || !d.dataset.path) return
    if (d.open) app.openDirs.add(d.dataset.path)
    else app.openDirs.delete(d.dataset.path)
  },
  true
)

orca.plugin.on('machines.update', (p) => {
  app.machines = p.machines
  renderTop()
  renderHosts()
  const m = current()
  // The Overview follows every frame; the other tabs keep their own data and are left alone while you work in them.
  if (!m || m.state !== 'online' || (app.tabs[m.name] || 'overview') === 'overview' || !document.querySelector('#tab-body')) renderDetail()
})

orca.plugin.on('machines.diskReport', (p) => {
  app.disk[p.name] = { loading: false, data: p.report }
  const m = current()
  if (m && m.name === p.name && app.tabs[m.name] === 'disk') renderDetail()
})

loadView().then(loadSnapshot)
