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


# ---------- armas ----------

# Recortes de la hoja de objetos (items_board) y del catálogo de armas: (hoja, caja, giro para que apunte a la derecha, espejo).
# Los de la hoja de objetos son diagonales con la punta arriba a la derecha; los del catálogo son verticales con la punta arriba.
ITEMS = 'ashenfall_items_board.webp'
CATALOG = 'ashenfall_weapons_catalog.webp'

# Por arma: (icono, proyectil). Cada uno es (hoja, caja, giro, espejo). El orden es el nivel 0, 1, 2 y 3 de la familia.
UP, DIAG, NONE = -90, -45, 0
AUTO = 'auto'
WEAPON_ART = {
    'dagger': [
        ((ITEMS, (66, 45, 135, 177)), (ITEMS, (66, 45, 135, 177), AUTO, False)),
        ((ITEMS, (432, 42, 514, 186)), (ITEMS, (432, 42, 514, 186), AUTO, False)),
        ((ITEMS, (180, 40, 271, 183)), (ITEMS, (180, 40, 271, 183), AUTO, False)),
        ((ITEMS, (303, 43, 409, 184)), (ITEMS, (303, 43, 409, 184), AUTO, False)),
    ],
    'bow': [
        ((ITEMS, (1312, 198, 1490, 380)), (ITEMS, (30, 222, 152, 346), DIAG, False)),
        ((CATALOG, (226, 272, 312, 444)), (ITEMS, (155, 222, 277, 346), DIAG, False)),
        ((CATALOG, (318, 268, 399, 449)), (ITEMS, (278, 218, 406, 348), DIAG, False)),
        ((CATALOG, (50, 288, 124, 447)), (ITEMS, (407, 216, 520, 350), DIAG, False)),
    ],
    'crossbow': [
        ((ITEMS, (886, 226, 1072, 358)), (ITEMS, (518, 214, 650, 356), DIAG, False)),
        ((ITEMS, (1082, 214, 1292, 356)), (ITEMS, (650, 218, 770, 362), DIAG, False)),
        ((CATALOG, (546, 292, 636, 440)), (ITEMS, (754, 224, 872, 360), DIAG, False)),
        ((CATALOG, (638, 292, 740, 440)), (ITEMS, (407, 216, 520, 350), DIAG, False)),
    ],
    'axe': [
        ((ITEMS, (1032, 45, 1155, 180)), (ITEMS, (1032, 45, 1155, 180), NONE, False)),
        ((ITEMS, (1164, 27, 1302, 183)), (ITEMS, (1164, 27, 1302, 183), NONE, False)),
        ((ITEMS, (1308, 30, 1485, 186)), (ITEMS, (1308, 30, 1485, 186), NONE, False)),
        ((CATALOG, (1024, 286, 1102, 446)), (CATALOG, (1024, 286, 1102, 446), NONE, False)),
    ],
    'sword': [
        ((ITEMS, (663, 42, 751, 189)), (ITEMS, (663, 42, 751, 189), AUTO, False)),
        ((ITEMS, (780, 30, 880, 198)), (ITEMS, (780, 30, 880, 198), AUTO, False)),
        ((ITEMS, (537, 42, 631, 192)), (ITEMS, (537, 42, 631, 192), AUTO, False)),
        ((ITEMS, (518, 214, 650, 356)), (ITEMS, (518, 214, 650, 356), AUTO, False)),
    ],
    'staff': [
        ((ITEMS, (192, 548, 320, 686)), (ITEMS, (192, 548, 320, 686), NONE, False)),
        ((ITEMS, (1230, 544, 1370, 672)), (ITEMS, (1230, 544, 1370, 672), DIAG, False)),
        ((ITEMS, (636, 530, 760, 678)), (ITEMS, (636, 530, 760, 678), NONE, False)),
        ((ITEMS, (36, 544, 194, 670)), (ITEMS, (36, 544, 194, 670), 30, True)),
    ],
    'flask': [
        ((ITEMS, (902, 392, 998, 530)), (ITEMS, (902, 392, 998, 530), NONE, False)),
        ((ITEMS, (182, 374, 284, 526)), (ITEMS, (182, 374, 284, 526), NONE, False)),
        ((ITEMS, (458, 392, 558, 526)), (ITEMS, (458, 392, 558, 526), NONE, False)),
        ((ITEMS, (738, 372, 838, 532)), (ITEMS, (738, 372, 838, 532), NONE, False)),
    ],
    'mace': [
        ((ITEMS, (898, 42, 1024, 180)), (ITEMS, (898, 42, 1024, 180), NONE, False)),
        ((ITEMS, (338, 698, 456, 824)), (ITEMS, (338, 698, 456, 824), NONE, False)),
        ((ITEMS, (644, 694, 752, 820)), (ITEMS, (644, 694, 752, 820), NONE, False)),
        ((ITEMS, (1086, 696, 1220, 826)), (ITEMS, (1086, 696, 1220, 826), NONE, False)),
    ],
}
SUFFIX = ['', '_2', '_3', '_4']
_boards: dict[str, Image.Image] = {}


def board(name: str) -> Image.Image:
    if name not in _boards:
        _boards[name] = Image.open(REFS / name).convert('RGB')
    return _boards[name]


def auto_turn(sprite: Image.Image) -> Image.Image:
    """Gira el arma para que quede horizontal con la punta (el extremo más fino) a la derecha."""
    alpha = sprite.getchannel('A').point(lambda v: 255 if v > 60 else 0)
    ap = alpha.load()
    pts = [(x, y) for y in range(alpha.height) for x in range(alpha.width) if ap[x, y]]
    if len(pts) < 10:
        return sprite
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts) / len(pts)
    syy = sum((p[1] - my) ** 2 for p in pts) / len(pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts) / len(pts)
    import math
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)  # eje mayor, en coordenadas de imagen (y hacia abajo)
    turned = sprite.rotate(math.degrees(angle), expand=True, resample=Image.BICUBIC)
    bbox = turned.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    if bbox is not None:
        turned = turned.crop(bbox)
    # El extremo con menos masa en su cuarto final es la punta.
    a2 = turned.getchannel('A').point(lambda v: 255 if v > 60 else 0)
    p2 = a2.load()
    quarter = max(1, turned.width // 4)
    left = sum(1 for y in range(a2.height) for x in range(quarter) if p2[x, y])
    right = sum(1 for y in range(a2.height) for x in range(turned.width - quarter, turned.width) if p2[x, y])
    return turned.transpose(Image.FLIP_LEFT_RIGHT) if right > left else turned


def cut_item(name: str, box: tuple[int, int, int, int], turn: float | str = 0, mirror: bool = False) -> Image.Image:
    # Los objetos del catálogo están sobre un panel casi igual de oscuro que ellos: tolerancia baja para no borrarlos.
    sprite = remove_background(board(name).crop(box), tolerance=44 if name == ITEMS else 14)
    bbox = sprite.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    if bbox is None:
        raise SystemExit(f'Recorte vacío: {name} {box}')
    sprite = sprite.crop(bbox)
    if mirror:
        sprite = sprite.transpose(Image.FLIP_LEFT_RIGHT)
    if turn == AUTO:
        return auto_turn(sprite)
    if turn:
        sprite = sprite.rotate(float(turn), expand=True, resample=Image.BICUBIC)
        bbox = sprite.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
        if bbox is not None:
            sprite = sprite.crop(bbox)
    return sprite


def fit(sprite: Image.Image, longest: int) -> Image.Image:
    scale = longest / max(sprite.size)
    return sprite.resize((max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))), Image.LANCZOS)


def build_weapons() -> None:
    for family, tiers in WEAPON_ART.items():
        for tier, (icon_ref, proj_ref) in enumerate(tiers):
            weapon_id = f'{family}{SUFFIX[tier]}'
            projectile = fit(cut_item(proj_ref[0], proj_ref[1], proj_ref[2], proj_ref[3]), 64 if family in ('dagger', 'bow', 'crossbow', 'sword') else 50)
            projectile.save(OUT / f'proj-{weapon_id}.webp', lossless=True)
            icon = fit(cut_item(icon_ref[0], icon_ref[1]), 80)
            canvas = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
            canvas.alpha_composite(icon, ((96 - icon.width) // 2, (96 - icon.height) // 2))
            canvas.save(OUT / f'icon-{weapon_id}.webp', lossless=True)
    print('armas', sum(len(t) for t in WEAPON_ART.values()))


# Frascos de la hoja de objetos para las cuatro pociones.
POTION_ART = {
    'vital': (ITEMS, (45, 375, 148, 525)),
    'ward': (ITEMS, (600, 394, 692, 530)),
    'fury': (ITEMS, (325, 384, 422, 526)),
    'focus': (ITEMS, (183, 374, 284, 526)),
}


def build_potions() -> None:
    for name, (sheet, box) in POTION_ART.items():
        icon = fit(cut_item(sheet, box), 80)
        canvas = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
        canvas.alpha_composite(icon, ((96 - icon.width) // 2, (96 - icon.height) // 2))
        canvas.save(OUT / f'potion-{name}.webp', lossless=True)
    print('pociones', len(POTION_ART))


# ---------- monstruos ----------

# Orden de los monstruos en la hoja: fila superior (vampiro, licántropo, bruja, espectro), araña en medio y fila inferior.
MONSTERS = ['vampire', 'werewolf', 'witch', 'specter', 'spider', 'skeleton', 'dark_knight', 'treant', 'wraith', 'golem']
MONSTER_HEIGHT = {'vampire': 150, 'werewolf': 162, 'witch': 148, 'specter': 160, 'spider': 118, 'skeleton': 150, 'dark_knight': 168, 'treant': 176, 'wraith': 160, 'golem': 176}


def label_regions(image: Image.Image, thresh: int = 30, grow: int = 7) -> tuple[list[int], int, int, int]:
    """Etiqueta las siluetas de la hoja: dilata para unir las partes de un mismo monstruo y numera cada una."""
    gray = image.convert('L').point(lambda v: 255 if v > thresh else 0).filter(ImageFilter.MaxFilter(grow * 2 + 1))
    width, height = gray.size
    step = 3
    small = gray.resize((width // step, height // step))
    sp = small.load()
    sw, sh = small.size
    labels = [0] * (sw * sh)
    count = 0
    for y in range(sh):
        for x in range(sw):
            if sp[x, y] and not labels[y * sw + x]:
                count += 1
                queue: deque[tuple[int, int]] = deque([(x, y)])
                labels[y * sw + x] = count
                while queue:
                    a, b = queue.popleft()
                    for c, d in ((a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)):
                        if 0 <= c < sw and 0 <= d < sh and sp[c, d] and not labels[d * sw + c]:
                            labels[d * sw + c] = count
                            queue.append((c, d))
    return labels, sw, sh, step


def build_monsters() -> None:
    sheet = Image.open(REFS / 'ashenfall_monsters_board.webp').convert('RGB')
    labels, sw, sh, step = label_regions(sheet)
    boxes: dict[int, list[int]] = {}
    for y in range(sh):
        for x in range(sw):
            k = labels[y * sw + x]
            if k:
                b = boxes.setdefault(k, [x, y, x, y])
                b[0], b[1], b[2], b[3] = min(b[0], x), min(b[1], y), max(b[2], x), max(b[3], y)
    big = [(k, b) for k, b in boxes.items() if (b[2] - b[0]) * (b[3] - b[1]) > 400]
    if len(big) != len(MONSTERS):
        raise SystemExit(f'Se esperaban {len(MONSTERS)} monstruos y hay {len(big)}')
    # Orden: fila superior (sin la araña), araña, fila inferior; dentro de cada fila, de izquierda a derecha.
    def center_y(item: tuple[int, list[int]]) -> float:
        return (item[1][1] + item[1][3]) / 2

    ordered = sorted(big, key=center_y)
    top = sorted([it for it in ordered if center_y(it) * step < 330], key=lambda it: it[1][0])
    middle = [it for it in ordered if 330 <= center_y(it) * step < 480]
    bottom = sorted([it for it in ordered if center_y(it) * step >= 480], key=lambda it: it[1][0])
    sequence = top + middle + bottom
    pixels = sheet.load()
    for name, (label, box) in zip(MONSTERS, sequence):
        x0, y0, x1, y1 = box[0] * step, box[1] * step, box[2] * step + step, box[3] * step + step
        crop = sheet.crop((x0, y0, x1, y1))
        # La máscara es la silueta de este monstruo y solo de este: así no entran trozos de los vecinos.
        mask = Image.new('L', crop.size, 0)
        mp = mask.load()
        for yy in range(crop.height):
            for xx in range(crop.width):
                sx, sy = min(sw - 1, (x0 + xx) // step), min(sh - 1, (y0 + yy) // step)
                r, g, b = pixels[x0 + xx, y0 + yy]
                if labels[sy * sw + sx] == label and r + g + b > 60:
                    mp[xx, yy] = 255
        mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
        sprite = crop.convert('RGBA')
        sprite.putalpha(mask)
        bbox = mask.point(lambda v: 255 if v > 40 else 0).getbbox()
        if bbox is None:
            raise SystemExit(f'Sin silueta para {name}')
        sprite = sprite.crop(bbox)
        target = MONSTER_HEIGHT[name]
        scale = target / sprite.height
        body = sprite.resize((max(1, round(sprite.width * scale)), target), Image.LANCZOS)
        body.save(OUT / f'body-{name}.webp', quality=95, method=6)
        side = int(sprite.height * 0.5)
        head = sprite.crop((max(0, (sprite.width - side) // 2), 0, min(sprite.width, max(0, (sprite.width - side) // 2) + side), min(sprite.height, side)))
        square = Image.new('RGB', (side, side), (16, 14, 22))
        square.paste(head.convert('RGB'), ((side - head.width) // 2, 0), head.getchannel('A'))
        square.resize((100, 100), Image.LANCZOS).save(OUT / f'portrait-{name}.webp', quality=92)
        print('monstruo', name, body.size)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    build_characters()
    build_biomes()
    build_weapons()
    build_potions()
    build_monsters()
