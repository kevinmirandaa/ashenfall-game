#!/usr/bin/env python3
"""
Genera el arte de la interfaz que no sale de los otros scripts: fondo de acceso (castle), logo e iconos
de la interfaz (moneda, engranaje, trofeo, espadas, visto, cruz y pergamino), recortados de las referencias.

Personajes, arenas, armas y proyectiles: scripts/build-art.py. Pueblo: scripts/build-town.py.
Obstáculos y terreno: scripts/build-obstacles.py.

Uso, desde la raíz del repo: python3 scripts/build-ui.py   (requiere Pillow y la carpeta references/)
"""
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
REFS = ROOT / 'references'
OUT = ROOT / 'apps' / 'client' / 'public' / 'art'
PITCH = Image.open(REFS / 'ashenfall_visual_pitchboard.png').convert('RGB')
PLAY = Image.open(REFS / 'ashenfall_gameplay_and_asset_board.png').convert('RGB')


def webp(image, name, colors=96):
    """Pixel art nítido: paleta limitada, transparencia sin medios tonos y sin pérdida."""
    if image.mode == 'RGBA':
        alpha = image.getchannel('A').point(lambda v: 255 if v > 110 else 0)
        flat = image.convert('RGB').quantize(colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGBA')
        flat.putalpha(alpha)
    else:
        flat = image.quantize(colors * 2, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
    flat.save(OUT / f'{name}.webp', lossless=True, method=6)


def cut_out(source, box, tolerance=15, seeds=()):
    """Quita el fondo liso de la hoja rellenando desde los bordes, y suaviza el recorte."""
    image = source.crop(box).convert('RGB')
    w, h = image.size
    px = image.load()
    bg = px[1, 1]
    seen = bytearray(w * h)
    queue = deque()
    for x in range(w):
        queue.extend(((x, 0), (x, h - 1)))
    for y in range(h):
        queue.extend(((0, y), (w - 1, y)))
    queue.extend(seeds)
    mask = Image.new('L', (w, h), 255)
    m = mask.load()
    while queue:
        x, y = queue.popleft()
        if not (0 <= x < w and 0 <= y < h) or seen[y * w + x]:
            continue
        seen[y * w + x] = 1
        if max(abs(a - b) for a, b in zip(px[x, y], bg)) > tolerance:
            continue
        m[x, y] = 0
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    # Solo la pieza mayor: la hoja deja trozos de objetos vecinos en el recorte.
    seen = bytearray(w * h)
    best = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx] or m[sx, sy] == 0:
                continue
            piece = []
            stack = [(sx, sy)]
            seen[sy * w + sx] = 1
            while stack:
                x, y = stack.pop()
                piece.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and m[nx, ny]:
                        seen[ny * w + nx] = 1
                        stack.append((nx, ny))
            if len(piece) > len(best):
                best = piece
    keep = set(best)
    for y in range(h):
        for x in range(w):
            if (x, y) not in keep:
                m[x, y] = 0
    out = image.convert('RGBA')
    out.putalpha(mask)
    return out.crop(mask.point(lambda v: 255 if v > 24 else 0).getbbox())

# ---------- Fondo de acceso y logo ----------
webp(PLAY.crop((412, 14, 925, 303)), 'castle')
logo = PLAY.crop((58, 22, 394, 128)).convert('RGBA')
pixels = logo.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b, _ = pixels[x, y]
        light = max(r, g, b)
        pixels[x, y] = (r, g, b, 0 if light < 42 else min(255, (light - 42) * 4))
webp(logo, 'logo')

# ---------- Iconos de la interfaz ----------
ICONS = {
    'coin': (PITCH, (1343, 520, 1378, 554)), 'gear': (PITCH, (1435, 520, 1470, 554)), 'trophy': (PITCH, (1435, 571, 1470, 605)),
    'cross': (PITCH, (1390, 618, 1424, 650)), 'scroll': (PITCH, (1482, 618, 1516, 650)),
    'swords': (PLAY, (78, 368, 118, 406)), 'check': (PLAY, (1062, 886, 1084, 905)),
}
for name, (source, box) in ICONS.items():
    webp(cut_out(source, box, 20).resize((64, round(64 * (box[3] - box[1]) / (box[2] - box[0]))), Image.NEAREST), f'icon-{name}')
