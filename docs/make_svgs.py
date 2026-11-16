# Draws the README images: the panel, the status bar item, the colour scale and container tiles.
# Colours approximate Orca's dark theme; block cells are drawn as parallelograms like the ▰ character.
import os
OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

BG = '#07080a'
PANEL = '#0c0e11'
LINE = '#262a31'
TEXT = '#e8eaed'
MUTED = '#8f969e'
C = {'green': '#4ade80', 'blue': '#4f9cf9', 'yellow': '#f5b400', 'red': '#f25f5c'}
FONT = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif"


def paint(p):
    if p >= 80:
        return C['red']
    if p >= 70:
        return C['yellow']
    if p >= 50:
        return C['blue']
    return C['green']


def text(x, y, s, size=13, color=TEXT, weight=400, anchor='start'):
    s = s.replace('&', '&amp;').replace('<', '&lt;')
    return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{s}</text>'


def spans(x, y, parts, size=13, anchor='start'):
    inner = ''.join(f'<tspan fill="{c}" font-weight="{w}">{s}</tspan>' for s, c, w in parts)
    return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" text-anchor="{anchor}" xml:space="preserve">{inner}</text>'


def rect(x, y, w, h, stroke=LINE, fill='none', sw=1):
    return f'<rect x="{x + 0.5}" y="{y + 0.5}" width="{w}" height="{h}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def gauge(x, y, filled, total, color, cw=11, ch=12, gap=2.5, slant=3):
    out = []
    for i in range(total):
        cx = x + i * (cw + gap)
        pts = f'{cx + slant},{y} {cx + cw},{y} {cx + cw - slant},{y + ch} {cx},{y + ch}'
        if i < filled:
            out.append(f'<polygon points="{pts}" fill="{color}"/>')
        else:
            out.append(f'<polygon points="{pts}" fill="none" stroke="{MUTED}" stroke-width="1"/>')
    return ''.join(out)


def multi_gauge(x, y, parts, total, cw=11, ch=12, gap=2.5, slant=3):
    out, i = [], 0
    for color, n in parts:
        for _ in range(n):
            cx = x + i * (cw + gap)
            pts = f'{cx + slant},{y} {cx + cw},{y} {cx + cw - slant},{y + ch} {cx},{y + ch}'
            out.append(f'<polygon points="{pts}" fill="{color}"/>')
            i += 1
    for _ in range(total - i):
        cx = x + i * (cw + gap)
        pts = f'{cx + slant},{y} {cx + cw},{y} {cx + cw - slant},{y + ch} {cx},{y + ch}'
        out.append(f'<polygon points="{pts}" fill="none" stroke="{MUTED}" stroke-width="1"/>')
        i += 1
    return ''.join(out)


def chip(x, y, label, color, size=11):
    w = int(len(label) * size * 0.6) + 12
    return rect(x, y, w, 18, stroke=color) + text(x + 6, y + 13, label, size, color, 500), w


def chart(x, y, w, h, values, lo, hi):
    out = [rect(x, y, w, h)]
    n = len(values)
    gap = 3
    bw = (w - 8 - gap * (n - 1)) / n
    for i, v in enumerate(values):
        bx = x + 4 + i * (bw + gap)
        if v is None:
            out.append(f'<rect x="{bx:.1f}" y="{y + h - 6}" width="{bw:.1f}" height="2" fill="{LINE}"/>')
            continue
        bh = max(3, (min(max(v, lo), hi) - lo) / (hi - lo) * (h - 10))
        col = paint(v)
        out.append(f'<rect x="{bx:.1f}" y="{y + h - 4 - bh:.1f}" width="{bw:.1f}" height="{bh:.1f}" fill="{col}" fill-opacity="0.18" stroke="{col}" stroke-width="1"/>')
    return ''.join(out)


def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">' + f'<rect width="{w}" height="{h}" fill="{BG}"/>' + body + '</svg>\n'


# 1. The panel
W = 460
b = []
b.append(text(20, 34, 'Machines', 16, TEXT, 700))
c, cw = chip(108, 20, '2/3 online', C['red'])
b.append(c)
hosts = [('web-01', 27, 71, 82, True), ('db-01', 12, 44, 38, False)]
y = 54
for name, cpu, ram, disk, sel in hosts:
    b.append(rect(20, y, W - 40, 30, stroke=C['blue'] if sel else LINE))
    b.append(text(34, y + 20, name, 13, TEXT, 600))
    b.append(spans(W - 32, y + 20, [('CPU ', MUTED, 400), (f'{cpu}%', paint(cpu), 500), ('   RAM ', MUTED, 400), (f'{ram}%', paint(ram), 500), ('   Disk ', MUTED, 400), (f'{disk}%', paint(disk), 500)], 12, 'end'))
    y += 36
b.append(rect(20, y, W - 40, 30))
b.append(text(34, y + 20, 'cache-01', 13, TEXT, 600))
b.append(text(W - 32, y + 20, 'offline since 17:20', 12, C['red'], 500, 'end'))
y += 48
top = y
b.append(text(36, y + 22, 'web-01', 14, TEXT, 700))
b.append(text(36, y + 40, 'ubuntu@10.0.0.1 · up 56d 1h', 11, MUTED))
b.append(text(W - 40, y + 26, '>_  Shell', 13, TEXT, 600, 'end'))
y += 66
b.append(text(36, y, 'Overview', 13, TEXT, 600))
b.append(f'<rect x="32" y="{y + 8}" width="74" height="2" fill="{TEXT}"/>')
b.append(text(124, y, 'Containers', 13, MUTED))
b.append(text(214, y, 'Disk', 13, MUTED))
y += 30
for label, p in [('CPU', 27), ('RAM', 71), ('Disk', 82)]:
    col = paint(p)
    b.append(text(36, y + 11, label, 13, col if p >= 70 else MUTED, 500 if p >= 70 else 400))
    b.append(gauge(92, y, round(p / 10), 10, col))
    b.append(text(W - 40, y + 11, f'{p:.1f}%', 13, col, 600, 'end'))
    y += 24
y += 12
b.append(text(36, y, 'Disk / in 24 hours', 13, TEXT, 600))
b.append(text(W - 40, y, '74.1% to 82.4%', 11, MUTED, 400, 'end'))
disk_hours = [74.1, 74.3, 74.6, 74.9, None, None, 75.8, 76.0, 76.4, 76.9, 77.2, 77.5, 77.9, 78.2, 78.6, 78.9, 79.3, 79.6, 79.9, 80.2, 80.6, 81.1, 81.8, 82.4]
b.append(chart(36, y + 10, W - 76, 84, disk_hours, 72, 84))
b.append(text(36, y + 110, '24 hours ago', 11, MUTED))
b.append(text(W - 40, y + 110, 'now', 11, MUTED, 400, 'end'))
y += 140
b.append(text(36, y, 'CPU in 30 minutes', 13, TEXT, 600))
b.append(text(W - 40, y, 'avg 31% · peak 86%', 11, MUTED, 400, 'end'))
cpu_minutes = [18, 21, 19, 24, 22, 20, 26, 31, 28, 25, 22, 54, 72, 86, 81, 64, 33, 27, 24, 21, 23, 26, 22, 19, 25, 27, 30, 26, 23, 28]
b.append(chart(36, y + 10, W - 76, 84, cpu_minutes, 0, 90))
b.append(text(36, y + 110, '30 minutes ago', 11, MUTED))
b.append(text(W - 40, y + 110, 'last minute', 11, MUTED, 400, 'end'))
y += 128
b.insert(0, rect(20, top, W - 40, y - top))
open(f'{OUT}/panel.svg', 'w', encoding='utf-8', newline='\n').write(svg(W, y + 20, ''.join(b)))

# 2. The status bar item
W2, H2 = 330, 34
s = [f'<rect width="{W2}" height="{H2}" fill="#0b0c0f"/>']
red = C['red']
s.append(f'<circle cx="22" cy="17" r="6" fill="none" stroke="{red}" stroke-width="1.6"/><path d="M22 17 L25 13" stroke="{red}" stroke-width="1.6"/>')
s.append(text(36, 22, 'web-01 disk', 13, red, 500))
s.append(gauge(118, 11, 7, 8, red, cw=10, ch=12, gap=2.5))
s.append(text(222, 22, '82% · CPU 25%', 13, red, 500))
open(f'{OUT}/statusbar.svg', 'w', encoding='utf-8', newline='\n').write(svg(W2, H2, ''.join(s)))

# 3. The colour scale
W3, H3 = 520, 92
k = []
cells = [('green', 'below 50%', 'fine', 3), ('blue', '50 to 69%', 'busy', 6), ('yellow', '70 to 79%', 'warning', 7), ('red', '80% and up', 'alert', 9)]
x = 16
for name, rng, word, n in cells:
    col = C[name]
    k.append(rect(x, 14, 116, 64, stroke=col))
    k.append(text(x + 10, 34, rng, 12, col, 600))
    k.append(text(x + 10, 50, word, 11, MUTED))
    k.append(gauge(x + 10, 58, round(n * 0.8), 8, col, cw=9, ch=10, gap=2.2, slant=2.5))
    x += 124
open(f'{OUT}/colors.svg', 'w', encoding='utf-8', newline='\n').write(svg(W3, H3, ''.join(k)))

# 4. Container tiles with aligned chip columns
W4 = 620
t = []
tiles = [('kafka', 'healthy', C['green'], 93.2, 1.4), ('postgres', 'healthy', C['green'], 22.5, 2.6),
         ('app-worker', 'unhealthy', C['red'], 4.9, 0.7), ('elasticsearch', 'healthy', C['green'], 8.4, 3.1),
         ('nginx', 'running', C['green'], 0.6, 0.1), ('grafana', 'running', C['green'], 0.4, 0.2)]
for i, (name, state, scol, cpu, ram) in enumerate(tiles):
    col, row = i % 2, i // 2
    x, y = 16 + col * 300, 14 + row * 66
    t.append(rect(x, y, 290, 58))
    t.append(text(x + 12, y + 22, name, 13, TEXT, 600))
    c1, _ = chip(x + 12, y + 32, state, scol)
    c2, _ = chip(x + 92, y + 32, f'CPU {cpu}%', paint(cpu))
    c3, _ = chip(x + 172, y + 32, f'RAM {ram} GiB', MUTED)
    t.extend([c1, c2, c3])
open(f'{OUT}/containers.svg', 'w', encoding='utf-8', newline='\n').write(svg(W4, 14 + 3 * 66 + 6, ''.join(t)))
print('ok', os.listdir(OUT))
