#!/usr/bin/env python3
"""
Construye el pueblo del cliente a partir de la imagen de referencia del menú (references/ashenfall_town_menu.webp, 1556×1011).

La referencia no es 16:9, así que se amplía a los lados con un degradado oscuro de sus bordes (sin tocar ningún elemento) y
se reduce a 1280×720 con la misma escala en los dos ejes. Se conserva todo lo de la referencia salvo lo que cambia con la
cuenta: se borran el nombre, el nivel con su barra y el número de monedas, que el cliente escribe encima con los datos reales.
La barra inferior sale como pieza aparte (dock.webp) para poder arrastrarla; el suelo que deja se rellena con adoquines del propio pueblo.

Uso: python3 scripts/build-town.py   (requiere Pillow)
Imprime las posiciones finales (a 1280×720) que usa main.ts.
"""
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'apps' / 'client' / 'public' / 'art'
ref = Image.open(ROOT / 'references' / 'ashenfall_town_menu.webp').convert('RGB')
RW, RH = ref.size
random.seed(11)

# --- 16:9 sin deformar: se añade a cada lado el degradado de los bordes, oscurecido hacia fuera ---
TARGET_W = round(RH * 16 / 9)
PAD = (TARGET_W - RW) // 2
canvas = Image.new('RGB', (RW + 2 * PAD, RH))
canvas.paste(ref, (PAD, 0))
for side in ('left', 'right'):
    # Se estira la columna del borde (sin elementos de interfaz), se difumina y se oscurece hacia fuera.
    edge = ref.crop((0, 0, 6, RH)) if side == 'left' else ref.crop((RW - 6, 0, RW, RH))
    strip = edge.resize((PAD, RH), Image.BICUBIC).filter(ImageFilter.GaussianBlur(5))
    ramp = Image.linear_gradient('L').rotate(90 if side == 'left' else -90).resize(strip.size)  # 0 en el borde exterior
    shade = Image.composite(strip, Image.new('RGB', strip.size, (4, 3, 8)), ramp.point(lambda v: int(70 + v * 0.72)))
    canvas.paste(shade, (0 if side == 'left' else RW + PAD, 0))
SCALE = 1280 / canvas.width


def p(x: float, y: float) -> tuple[int, int]:
    """Posición de la referencia en la imagen ya ampliada."""
    return round(x + PAD), round(y)


def feather(size, inset, blur):
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).rectangle((inset, inset, size[0] - inset - 1, size[1] - inset - 1), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur))


def patch(dst, src, inset=6, blur=5):
    """Tapa `dst` con un trozo de `src` de la misma imagen (coordenadas de la referencia)."""
    (dx0, dy0), (dx1, dy1) = p(dst[0], dst[1]), p(dst[2], dst[3])
    (sx0, sy0), (sx1, sy1) = p(src[0], src[1]), p(src[2], src[3])
    piece = canvas.crop((sx0, sy0, sx1, sy1)).resize((dx1 - dx0, dy1 - dy0))
    canvas.paste(piece, (dx0, dy0), feather(piece.size, inset, blur))


def mean(box):
    (x0, y0), (x1, y1) = p(box[0], box[1]), p(box[2], box[3])
    px = list(canvas.crop((x0, y0, x1, y1)).getdata())
    return tuple(int(sum(c[i] for c in px) / len(px)) for i in range(3))


# --- nombre, nivel y barra de experiencia (a la izquierda del avatar) y número de monedas ---
patch((212, 40, 470, 126), (300, 0, 558, 86))
ImageDraw.Draw(canvas).rectangle((*p(1331, 56), *p(1405, 94)), fill=mean((1296, 66, 1326, 86)))

# --- barra inferior: se saca como pieza aparte y el suelo se rellena con adoquines del propio pueblo ---
BAR = (452, 846, 1128, 968)
bx0, by0 = p(BAR[0], BAR[1])
bx1, by1 = p(BAR[2], BAR[3])
dock_full = canvas.crop((bx0, by0, bx1, by1)).convert('RGBA')
dock_mask = Image.new('L', dock_full.size, 0)
ImageDraw.Draw(dock_mask).rounded_rectangle((4, 4, dock_full.width - 5, dock_full.height - 5), radius=18, fill=255)
dock_full.putalpha(dock_mask.filter(ImageFilter.GaussianBlur(4)))

ground = canvas.crop((*p(560, 700), *p(690, 740)))
gw, gh = ground.size
fx0, fy0, fx1, fy1 = bx0 - 14, by0 - 16, bx1 + 14, by1 + 10
fill = Image.new('RGB', (fx1 - fx0, fy1 - fy0))
row = 0
for ty in range(0, fill.height, gh):
    shift = (row % 2) * (gw // 2) - gw
    for tx in range(shift, fill.width, gw):
        fill.paste(ground if row % 2 == 0 else ImageOps.mirror(ground), (tx, ty))
    row += 1
fill = Image.composite(Image.new('RGB', fill.size, (8, 8, 14)), fill, Image.linear_gradient('L').resize(fill.size).point(lambda v: int(v * 0.35)))
mask = Image.new('L', fill.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((12, 12, fill.width - 13, fill.height - 13), radius=24, fill=255)
canvas.paste(fill, (fx0, fy0), mask.filter(ImageFilter.GaussianBlur(10)))

final = canvas.resize((1280, 720), Image.LANCZOS)
final.save(OUT / 'town.webp', quality=92, method=6)
dock = dock_full.resize((round(dock_full.width * SCALE), round(dock_full.height * SCALE)), Image.LANCZOS)
dock.save(OUT / 'dock.webp', lossless=True)


def f(x: float, y: float) -> tuple[int, int]:
    """De la referencia a la imagen final de 1280×720."""
    return round((x + PAD) * SCALE), round(y * SCALE)


print('escala', round(SCALE, 5), 'relleno lateral', PAD)
print('dock', dock.size, 'posición', f(BAR[0], BAR[1]))
for name, (x0, y0, x1, y1) in {
    'personajes': (473, 858, 680, 958), 'jugar': (693, 855, 880, 958), 'perfil': (893, 855, 1100, 958),
    'arsenal': (165, 240, 665, 650), 'historial': (36, 833, 134, 944), 'ajustes': (1460, 44, 1526, 106),
    'anillo': (35, 22, 195, 178), 'moneda': (1245, 50, 1435, 100),
}.items():
    a, b = f(x0, y0), f(x1, y1)
    print(f'{name}: [{a[0]}, {a[1]}, {b[0] - a[0]}, {b[1] - a[1]}]')
