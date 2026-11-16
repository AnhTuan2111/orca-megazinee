# Draws the README images: the hero (title beside the panel and the status bar item), the three tabs, and the
# colour scale. Colours approximate Orca's dark theme; block cells are parallelograms like the ▰ character.
# Run: python docs/make_svgs.py
import os

OUT = os.path.dirname(os.path.abspath(__file__))

BG = '#07080a'
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


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;')


def text(x, y, s, size=13, color=TEXT, weight=400, anchor='start'):
    return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{esc(s)}</text>'


def spans(x, y, parts, size=13, anchor='start'):
    inner = ''.join(f'<tspan fill="{c}" font-weight="{w}">{esc(s)}</tspan>' for s, c, w in parts)
    return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" text-anchor="{anchor}" xml:space="preserve">{inner}</text>'


def rect(x, y, w, h, stroke=LINE, fill='none'):
    return f'<rect x="{x + 0.5}" y="{y + 0.5}" width="{w}" height="{h}" fill="{fill}" stroke="{stroke}" stroke-width="1"/>'


def cells(x, y, parts, total, cw=11, ch=12, gap=2.5, slant=3):
    """A block gauge: parts is a list of (colour, count); the rest of `total` cells are empty outlines."""
    out, i = [], 0

    def poly(i):
        cx = x + i * (cw + gap)
        return f'{cx + slant},{y} {cx + cw},{y} {cx + cw - slant},{y + ch} {cx},{y + ch}'

    for color, n in parts:
        for _ in range(n):
            out.append(f'<polygon points="{poly(i)}" fill="{color}"/>')
            i += 1
    while i < total:
        out.append(f'<polygon points="{poly(i)}" fill="none" stroke="{MUTED}" stroke-width="1"/>')
        i += 1
    return ''.join(out)


def chip(x, y, label, color, size=11):
    w = int(len(label) * size * 0.6) + 12
    return rect(x, y, w, 18, stroke=color) + text(x + 6, y + 13, label, size, color, 500)


def chart(x, y, w, h, values, lo, hi):
    out = [rect(x, y, w, h)]
    gap = 3
    bw = (w - 8 - gap * (len(values) - 1)) / len(values)
    for i, v in enumerate(values):
        bx = x + 4 + i * (bw + gap)
        if v is None:
            out.append(f'<rect x="{bx:.1f}" y="{y + h - 6}" width="{bw:.1f}" height="2" fill="{LINE}"/>')
            continue
        bh = max(3, (min(max(v, lo), hi) - lo) / (hi - lo) * (h - 10))
        col = paint(v)
        out.append(f'<rect x="{bx:.1f}" y="{y + h - 4 - bh:.1f}" width="{bw:.1f}" height="{bh:.1f}" fill="{col}" fill-opacity="0.18" stroke="{col}" stroke-width="1"/>')
    return ''.join(out)


def meters(x, y, rows, right):
    out = []
    for label, p in rows:
        col = paint(p)
        out.append(text(x, y + 11, label, 13, col if p >= 70 else MUTED, 500 if p >= 70 else 400))
        out.append(cells(x + 56, y, [(col, round(p / 10))], 10))
        out.append(text(right, y + 11, f'{p:.1f}%', 13, col, 600, 'end'))
        y += 24
    return ''.join(out), y


def svg(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<rect width="{w}" height="{h}" fill="{BG}"/>{body}</svg>\n')


DISK_HOURS = [74.1, 74.3, 74.6, 74.9, None, None, 75.8, 76.0, 76.4, 76.9, 77.2, 77.5, 77.9, 78.2, 78.6, 78.9, 79.3,
              79.6, 79.9, 80.2, 80.6, 81.1, 81.8, 82.4]
CPU_MINUTES = [18, 21, 19, 24, 22, 20, 26, 31, 28, 25, 22, 54, 72, 86, 81, 64, 33, 27, 24, 21, 23, 26, 22, 19, 25, 27,
               30, 26, 23, 28]


def panel(W=440):
    """The Machines panel as it looks in Orca's sidebar, at width W. Returns the body and its height."""
    b = [text(20, 34, 'Machines', 16, TEXT, 700), chip(108, 20, '2/3 online', C['red'])]
    y = 54
    for name, cpu, ram, disk, sel in [('web-01', 27, 71, 82, True), ('db-01', 12, 44, 38, False)]:
        b.append(rect(20, y, W - 40, 30, stroke=C['blue'] if sel else LINE))
        b.append(text(34, y + 20, name, 13, TEXT, 600))
        b.append(spans(W - 32, y + 20, [('CPU ', MUTED, 400), (f'{cpu}%', paint(cpu), 500), ('   RAM ', MUTED, 400),
                                         (f'{ram}%', paint(ram), 500), ('   Disk ', MUTED, 400), (f'{disk}%', paint(disk), 500)], 12, 'end'))
        y += 36
    b.append(rect(20, y, W - 40, 30))
    b.append(text(34, y + 20, 'cache-01', 13, TEXT, 600))
    b.append(text(W - 32, y + 20, 'offline since 17:20', 12, C['red'], 500, 'end'))
    y += 48
    top = y
    b.append(text(36, y + 22, 'web-01', 14, TEXT, 700))
    b.append(text(36, y + 40, 'ubuntu@10.0.0.1, up 56 days', 11, MUTED))
    b.append(text(W - 40, y + 26, '>_  Shell', 13, TEXT, 600, 'end'))
    y += 66
    b.append(text(36, y, 'Overview', 13, TEXT, 600))
    b.append(f'<rect x="32" y="{y + 8}" width="74" height="2" fill="{TEXT}"/>')
    b.append(text(124, y, 'Containers', 13, MUTED))
    b.append(text(214, y, 'Disk', 13, MUTED))
    m, y = meters(36, y + 30, [('CPU', 27), ('RAM', 71), ('Disk', 82)], W - 40)
    b.append(m)
    y += 12
    b.append(text(36, y, 'Disk / in 24 hours', 13, TEXT, 600))
    b.append(chart(36, y + 10, W - 76, 84, DISK_HOURS, 72, 84))
    b.append(text(36, y + 110, '24 hours ago', 11, MUTED))
    b.append(text(W - 40, y + 110, 'now', 11, MUTED, 400, 'end'))
    y += 140
    b.append(text(36, y, 'CPU in 30 minutes', 13, TEXT, 600))
    b.append(chart(36, y + 10, W - 76, 84, CPU_MINUTES, 0, 90))
    b.append(text(36, y + 110, '30 minutes ago', 11, MUTED))
    b.append(text(W - 40, y + 110, 'last minute', 11, MUTED, 400, 'end'))
    y += 128
    b.insert(0, rect(20, top, W - 40, y - top))
    return ''.join(b), y + 16


def status_item(x, y):
    red = C['red']
    return (f'<rect x="{x}" y="{y}" width="300" height="30" fill="#0b0c0f" stroke="{LINE}"/>'
            f'<circle cx="{x + 18}" cy="{y + 15}" r="6" fill="none" stroke="{red}" stroke-width="1.6"/>'
            f'<path d="M{x + 18} {y + 15} L{x + 21} {y + 11}" stroke="{red}" stroke-width="1.6"/>'
            + text(x + 32, y + 20, 'web-01 disk', 13, red, 500)
            + cells(x + 112, y + 9, [(red, 7)], 8, cw=10, ch=12)
            + text(x + 216, y + 20, '82%  CPU 25%', 13, red, 500))


# 1. Hero: the title and one sentence on the left, the panel on the right, the status bar item under the words.
body, ph = panel()
HW, HH = 920, 520
scale = (HH - 40) / ph
h = [f'<g transform="translate({HW - 440 * scale - 30:.1f},20) scale({scale:.4f})">{body}</g>']
h.append(text(48, 150, 'Machines', 56, TEXT, 800))
h.append(text(50, 200, 'Your servers, live in Orca.', 24, TEXT, 500))
h.append(text(50, 236, 'One SSH connection per server. Nothing installed on it.', 15, MUTED))
h.append(cells(50, 272, [(C['green'], 3), (C['blue'], 2), (C['yellow'], 2), (C['red'], 2)], 10, cw=16, ch=18, gap=4, slant=4))
h.append(text(50, 340, 'In the status bar, the machine that needs you:', 13, MUTED))
h.append(status_item(50, 354))
open(f'{OUT}/hero.svg', 'w', encoding='utf-8', newline='\n').write(svg(HW, HH, ''.join(h)))

# 2. The three tabs side by side.
TW, TH = 920, 330
t = []
cols = [30, 330, 630]
titles = [('Overview', 'Gauges, 24 hour disk, 30 minute CPU.'), ('Containers', 'State, CPU, RAM. Logs and Shell.'),
          ('Disk', 'Where the space went, what to free.')]
for x, (title, line) in zip(cols, titles):
    t.append(text(x, 36, title, 18, TEXT, 700))
    t.append(text(x, 58, line, 12, MUTED))
    t.append(rect(x, 74, 270, 236))
# Overview
m, _ = meters(44, 92, [('CPU', 27), ('RAM', 71), ('Disk', 82)], 286)
t.append(m)
t.append(chart(44, 176, 242, 112, DISK_HOURS, 72, 84))
# Containers
y = 90
for name, state, scol, cpu, ram in [('kafka', 'healthy', C['green'], 93.2, 1.4), ('postgres', 'healthy', C['green'], 22.5, 2.6),
                                    ('app-worker', 'unhealthy', C['red'], 4.9, 0.7), ('nginx', 'running', C['green'], 0.6, 0.1)]:
    t.append(rect(344, y, 242, 50))
    t.append(text(354, y + 18, name, 12, TEXT, 600))
    t.append(chip(354, y + 26, state, scol, 10))
    t.append(chip(424, y + 26, f'CPU {cpu}%', paint(cpu), 10))
    t.append(chip(500, y + 26, f'RAM {ram} GiB', MUTED, 10))
    y += 54
# Disk
t.append(text(644, 106, '82.4%', 14, C['red'], 700))
t.append(text(886, 106, '157 of 194 GiB', 11, MUTED, 400, 'end'))
t.append(cells(644, 118, [(C['blue'], 10), (C['green'], 2), ('#6b7280', 1)], 16, cw=12, ch=14, gap=3, slant=3.5))
t.append(spans(644, 152, [('▰ ', C['blue'], 400), ('Docker  ', MUTED, 400), ('▰ ', C['green'], 400), ('/var  ', MUTED, 400),
                          ('▰ ', '#6b7280', 400), ('other', MUTED, 400)], 11))
t.append(rect(644, 166, 242, 34, stroke=C['green']))
t.append(text(656, 188, 'About 80 GiB can be freed', 12, C['green'], 600))
for i, (label, size) in enumerate([('/var', '24.6 GiB'), ('  lib', '18.9 GiB'), ('    containerd', '12.4 GiB'), ('/home', '17.1 GiB')]):
    t.append(f'<text x="654" y="{226 + i * 20}" font-family="{FONT}" font-size="12" fill="{TEXT}" xml:space="preserve">{esc(label)}</text>')
    t.append(text(876, 226 + i * 20, size, 12, MUTED, 400, 'end'))
open(f'{OUT}/tabs.svg', 'w', encoding='utf-8', newline='\n').write(svg(TW, TH, ''.join(t)))

# 3. The colour scale.
CW, CH = 920, 120
k = []
x = 30
for name, rng, word, n in [('green', 'below 50%', 'fine', 3), ('blue', '50 to 69%', 'busy', 6),
                           ('yellow', '70 to 79%', 'warning', 7), ('red', '80% and up', 'alert', 9)]:
    col = C[name]
    k.append(rect(x, 16, 200, 88, stroke=col))
    k.append(text(x + 16, 46, rng, 16, col, 700))
    k.append(text(x + 16, 66, word, 12, MUTED))
    k.append(cells(x + 16, 78, [(col, n)], 10, cw=13, ch=14, gap=3, slant=3.5))
    x += 218
open(f'{OUT}/colors.svg', 'w', encoding='utf-8', newline='\n').write(svg(CW, CH, ''.join(k)))
print('ok', sorted(f for f in os.listdir(OUT) if f.endswith('.svg')))
