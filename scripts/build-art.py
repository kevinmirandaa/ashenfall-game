#!/usr/bin/env python3
"""
Genera el arte del cliente (apps/client/public/art) a partir de las referencias de la carpeta references/.

- Personajes: se recortan de ashenfall_characters_board.webp y se les quita el fondo.
- Arenas: se recortan de ashenfall_biomes_board.webp, un panel por bioma.
- Proyectiles e iconos de armas: se dibujan aquí, píxel a píxel.

Uso: python3 scripts/build-art.py   (requiere Pillow)
"""
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
REFS = ROOT / 'references'
OUT = ROOT / 'apps' / 'client' / 'public' / 'art'

# ---------- personajes ----------

# Orden de la hoja de referencia: fila superior y fila inferior, de izquierda a derecha.
CHARACTERS = ['edrik', 'sylwen', 'borgrim', 'aldric', 'vaela', 'corvus', 'anselmo', 'mirelle', 'morveth', 'rurik']
# Altura en el juego: el enano es más bajo, el resto casi igual para que la escala sea coherente.
HEIGHTS = {'borgrim': 134, 'corvus': 156, 'aldric': 156, 'morveth': 152}
DEFAULT_HEIGHT = 148


def remove_background(image: Image.Image, tolerance: int = 22) -> Image.Image:
    """Quita el fondo casi negro de la hoja: inunda desde los bordes con el color de las esquinas."""
    rgb = image.convert('RGB')
    width, height = rgb.size
    px = rgb.load()
    corners = [px[0, 0], px[width - 1, 0], px[0, height - 1], px[width - 1, height - 1]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))

    def is_bg(x: int, y: int) -> bool:
        r, g, b = px[x, y]
        return abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) <= tolerance

    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        queue.extend([(x, 0), (x, height - 1)])
    for y in range(height):
        queue.extend([(0, y), (width - 1, y)])
    while queue:
        x, y = queue.popleft()
        if x < 0 or y < 0 or x >= width or y >= height or seen[y * width + x] or not is_bg(x, y):
            continue
        seen[y * width + x] = 1
        queue.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    alpha = Image.new('L', (width, height), 255)
    ap = alpha.load()
    for y in range(height):
        for x in range(width):
            if seen[y * width + x]:
                ap[x, y] = 0
    # Suaviza el borde un píxel para que no quede un halo oscuro.
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    out = rgb.convert('RGBA')
    out.putalpha(alpha)
    return out


def build_characters() -> None:
    board = Image.open(REFS / 'ashenfall_characters_board.webp').convert('RGB')
    width, height = board.size
    cell_w = width / 5
    split_y = height // 2
    for index, name in enumerate(CHARACTERS):
        col, row = index % 5, index // 5
        box = (int(col * cell_w), 0 if row == 0 else split_y, int((col + 1) * cell_w), split_y if row == 0 else height)
        cut = remove_background(board.crop(box))
        bbox = cut.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
        if bbox is None:
            raise SystemExit(f'No se encontró a {name} en la hoja')
        sprite = cut.crop(bbox)
        target = HEIGHTS.get(name, DEFAULT_HEIGHT)
        scale = target / sprite.height
        body = sprite.resize((max(1, round(sprite.width * scale)), target), Image.LANCZOS)
        body.save(OUT / f'body-{name}.webp', quality=95, method=6)
        # Retrato: cuadrado centrado en la cabeza (mitad superior del personaje), de 100 px.
        side = int(sprite.height * 0.5)
        left = max(0, min(sprite.width - side, (sprite.width - side) // 2)) if sprite.width >= side else 0
        head = sprite.crop((left, 0, left + min(side, sprite.width), side))
        square = Image.new('RGB', (side, side), (16, 14, 22))
        square.paste(head.convert('RGB'), ((side - head.width) // 2, 0), head.getchannel('A'))
        square.resize((100, 100), Image.LANCZOS).save(OUT / f'portrait-{name}.webp', quality=92)
        print('personaje', name, body.size)


# ---------- arenas ----------

# (id, columnas, filas) de los paneles de la hoja de arenas; el último ocupa todo el ancho.
PANELS = [
    ('hamlet_ruins', (0, 835), (0, 231)),
    ('graveyard', (837, 1672), (0, 231)),
    ('ember_desert', (0, 835), (237, 452)),
    ('misty_pines', (837, 1672), (237, 452)),
    ('frozen_bridge', (0, 835), (458, 687)),
    ('blood_keep', (837, 1672), (458, 687)),
    ('fog_ruins', (0, 1672), (692, 932)),
]


def build_biomes() -> None:
    board = Image.open(REFS / 'ashenfall_biomes_board.webp').convert('RGB')
    for name, (x0, x1), (y0, y1) in PANELS:
        panel = board.crop((x0 + 3, y0 + 3, x1 - 2, y1 - 2))
        panel.save(OUT / f'biome-{name}.webp', quality=94, method=6)
        print('arena', name, panel.size)


# ---------- proyectiles e iconos de armas ----------

PALETTE = {
    'steel': (200, 204, 212),
    'dark': (118, 126, 140),
    'edge': (240, 244, 250),
    'wood': (122, 82, 51),
    'darkwood': (74, 50, 32),
    'leather': (91, 64, 48),
    'gold': (201, 160, 90),
    'red': (163, 62, 54),
    'bone': (232, 221, 200),
    'green': (111, 191, 74),
    'darkgreen': (56, 110, 48),
    'purple': (138, 90, 216),
    'lilac': (200, 160, 255),
    'glass': (159, 216, 232),
    'fire': (242, 150, 60),
    'ember': (251, 229, 138),
    'ink': (21, 16, 26),
}


def sprite(width: int, height: int, paint) -> Image.Image:
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(image)

    def px(color: str, *points: tuple[int, int]) -> None:
        for point in points:
            d.point(point, fill=PALETTE[color] + (255,))

    def rect(color: str, x0: int, y0: int, x1: int, y1: int) -> None:
        d.rectangle((x0, y0, x1, y1), fill=PALETTE[color] + (255,))

    def poly(color: str, points: list[tuple[int, int]]) -> None:
        d.polygon(points, fill=PALETTE[color] + (255,))

    def line(color: str, a: tuple[int, int], b: tuple[int, int]) -> None:
        d.line((a, b), fill=PALETTE[color] + (255,))

    paint(px, rect, poly, line)
    return image


def paint_dagger(px, rect, poly, line):
    rect('gold', 0, 3, 1, 5)
    rect('leather', 2, 3, 4, 5)
    rect('gold', 5, 1, 6, 7)
    poly('steel', [(7, 2), (21, 4), (7, 6)])
    line('edge', (7, 3), (20, 4))
    line('dark', (7, 5), (19, 5))


def paint_arrow(px, rect, poly, line):
    line('wood', (3, 4), (26, 4))
    line('darkwood', (3, 5), (26, 5))
    poly('steel', [(26, 1), (33, 4), (26, 7)])
    line('edge', (27, 3), (31, 4))
    poly('red', [(0, 1), (5, 4), (0, 7)])
    line('bone', (1, 2), (3, 4))


def paint_bolt(px, rect, poly, line):
    rect('darkwood', 2, 3, 15, 5)
    rect('wood', 2, 3, 15, 3)
    poly('steel', [(15, 1), (22, 4), (15, 7)])
    line('edge', (16, 3), (20, 4))
    rect('leather', 0, 2, 3, 6)


def paint_axe(px, rect, poly, line):
    rect('wood', 11, 3, 13, 27)
    rect('darkwood', 13, 3, 13, 27)
    poly('steel', [(13, 3), (26, 1), (28, 10), (26, 18), (13, 15)])
    line('edge', (14, 4), (25, 3))
    line('dark', (14, 14), (26, 17))
    rect('gold', 10, 24, 14, 26)


def paint_sword(px, rect, poly, line):
    rect('gold', 0, 3, 2, 6)
    rect('leather', 3, 4, 6, 5)
    rect('gold', 7, 1, 8, 8)
    poly('steel', [(9, 3), (30, 5), (9, 7)])
    line('edge', (9, 4), (29, 5))
    line('dark', (9, 6), (27, 6))


def paint_orb(px, rect, poly, line):
    d_glow = [(10, 10, 9, (138, 90, 216, 60)), (10, 10, 7, (138, 90, 216, 120))]
    # El brillo se pinta aparte para poder mezclarlo con transparencia.
    return d_glow


def paint_flask(px, rect, poly, line):
    rect('glass', 8, 6, 12, 8)
    rect('darkwood', 9, 3, 11, 6)
    poly('glass', [(8, 8), (13, 8), (17, 17), (15, 22), (5, 22), (3, 17)])
    poly('green', [(5, 15), (15, 15), (16, 18), (15, 21), (5, 21), (4, 18)])
    line('edge', (6, 11), (5, 16))
    rect('ink', 5, 22, 15, 22)


def paint_mace(px, rect, poly, line):
    rect('wood', 11, 12, 13, 29)
    rect('darkwood', 13, 12, 13, 29)
    poly('dark', [(12, 1), (19, 4), (22, 11), (19, 18), (12, 20), (5, 18), (2, 11), (5, 4)])
    poly('steel', [(12, 3), (18, 5), (20, 11), (12, 11), (4, 11), (6, 5)])
    px('edge', (10, 5), (11, 5), (9, 6))
    for point in [(12, 0), (23, 11), (1, 11), (12, 21), (21, 3), (3, 3), (21, 19), (3, 19)]:
        px('gold', point)
    rect('gold', 10, 27, 14, 29)


SPRITES = {
    'dagger': (22, 9, paint_dagger),
    'bow': (34, 9, paint_arrow),
    'crossbow': (23, 9, paint_bolt),
    'axe': (30, 30, paint_axe),
    'sword': (31, 10, paint_sword),
    'flask': (20, 24, paint_flask),
    'mace': (25, 31, paint_mace),
}


def draw_orb() -> Image.Image:
    image = Image.new('RGBA', (22, 22), (0, 0, 0, 0))
    glow = Image.new('RGBA', (22, 22), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((0, 0, 21, 21), fill=PALETTE['purple'] + (70,))
    g.ellipse((3, 3, 18, 18), fill=PALETTE['purple'] + (130,))
    image.alpha_composite(glow)
    d = ImageDraw.Draw(image)
    d.ellipse((6, 6, 15, 15), fill=PALETTE['purple'] + (255,))
    d.ellipse((8, 8, 12, 12), fill=PALETTE['lilac'] + (255,))
    d.point((9, 9), fill=(255, 255, 255, 255))
    return image


def build_weapons() -> None:
    for family, (w, h, paint) in SPRITES.items():
        art = sprite(w, h, paint)
        big = art.resize((art.width * 3, art.height * 3), Image.NEAREST)
        big.save(OUT / f'proj-{family}.webp', lossless=True)
        # Icono cuadrado con margen para menús y tiendas.
        side = max(big.size) + 12
        icon = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        icon.alpha_composite(big, ((side - big.width) // 2, (side - big.height) // 2))
        icon.save(OUT / f'icon-{family}.webp', lossless=True)
    orb = draw_orb()
    big = orb.resize((orb.width * 3, orb.height * 3), Image.NEAREST)
    big.save(OUT / 'proj-staff.webp', lossless=True)
    icon = Image.new('RGBA', (big.width + 12, big.height + 12), (0, 0, 0, 0))
    icon.alpha_composite(big, (6, 6))
    icon.save(OUT / 'icon-staff.webp', lossless=True)
    print('armas', ', '.join([*SPRITES, 'staff']))


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    build_characters()
    build_biomes()
    build_weapons()
