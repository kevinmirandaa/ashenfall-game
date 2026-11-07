#!/usr/bin/env python3
"""
Construye el pueblo del cliente a partir de la imagen de referencia del menú (references/ashenfall_town_menu.webp).

La imagen conserva todo lo de la referencia salvo lo que el juego ya no tiene: se borran el mensaje de bienvenida, el «+» de las
monedas, el botón de salir, los rótulos de la Taberna y del Alquimista y el bloque «Perfil» de la izquierda (queda «Historial»).
La barra inferior sale como pieza aparte (dock.webp) para poder arrastrarla; su tercer botón pasa de «Gremio» a «Perfil».

Uso: python3 scripts/build-town.py   (requiere Pillow)
"""
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'apps' / 'client' / 'public' / 'art'
base = Image.open(ROOT / 'references' / 'ashenfall_town_menu.webp').convert('RGB').resize((1280, 720), Image.LANCZOS)
canvas = base.copy()
random.seed(11)


def feather_mask(size, inset, blur):
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).rectangle((inset, inset, size[0] - inset - 1, size[1] - inset - 1), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur))


def paste_patch(dst, src, inset=3, blur=2):
    w, h = dst[2] - dst[0], dst[3] - dst[1]
    patch = canvas.crop(src).resize((w, h))
    canvas.paste(patch, (dst[0], dst[1]), feather_mask((w, h), inset, blur))


def mean(box):
    px = list(canvas.crop(box).get_flattened_data()) if hasattr(Image.Image, 'get_flattened_data') else list(canvas.crop(box).getdata())
    return tuple(sum(c[i] for c in px) / len(px) for i in range(3))


def gradient_fill(box, top, bottom, noise=2, inset=5, blur=3):
    """Rellena con un degradado vertical entre dos colores y un poco de ruido: sirve para cielo o fondo oscuro."""
    w, h = box[2] - box[0], box[3] - box[1]
    flat = Image.new('RGB', (w, h))
    fp = flat.load()
    for y in range(h):
        t = y / max(1, h - 1)
        row = [top[i] * (1 - t) + bottom[i] * t for i in range(3)]
        for x in range(w):
            n = random.randint(-noise, noise)
            fp[x, y] = tuple(int(max(0, min(255, row[i] + n))) for i in range(3))
    canvas.paste(flat, (box[0], box[1]), feather_mask((w, h), inset, blur))


def side_fill(box, left_x, right_x):
    """Rellena una franja interpolando, fila a fila, entre los colores a su izquierda y a su derecha."""
    x0, y0, x1, y1 = box
    px = canvas.load()
    out = Image.new('RGB', (x1 - x0, y1 - y0))
    op = out.load()
    for y in range(y0, y1):
        a = [sum(px[x, y][i] for x in range(left_x - 3, left_x)) / 3 for i in range(3)]
        b = [sum(px[x, y][i] for x in range(right_x, right_x + 3)) / 3 for i in range(3)]
        for x in range(x0, x1):
            t = (x - x0) / max(1, x1 - x0 - 1)
            op[x - x0, y - y0] = tuple(int(max(0, min(255, a[i] * (1 - t) + b[i] * t + random.randint(-3, 3)))) for i in range(3))
    # Un desenfoque quita las rayas horizontales que deja interpolar fila a fila.
    out = out.filter(ImageFilter.GaussianBlur(3))
    canvas.paste(out, (x0, y0), feather_mask(out.size, 4, 3))


# --- barra inferior: se saca como pieza aparte y el suelo se rellena con adoquines del propio pueblo ---
BAR = (355, 575, 930, 695)

# El tercer botón pasa de «Gremio» a «Perfil»: se borra su icono y su rótulo sobre la propia imagen y se pone el trofeo y el texto nuevos.
side_fill((762, 597, 846, 680), 748, 862)
trophy = base.crop((46, 511, 86, 551)).convert('RGBA')
alpha = trophy.convert('L').point(lambda v: 0 if v < 46 else 255).filter(ImageFilter.GaussianBlur(0.8))
trophy.putalpha(alpha)
canvas.paste(trophy, (783, 603), trophy)
font = ImageFont.truetype('/System/Library/Fonts/Palatino.ttc', 21)
draw = ImageDraw.Draw(canvas)
label = 'Perfil'
draw.text((803 - draw.textlength(label, font=font) / 2, 653), label, font=font, fill=(236, 226, 204))
dock = canvas.crop(BAR).convert('RGBA')
dock_mask = Image.new('L', dock.size, 0)
ImageDraw.Draw(dock_mask).rounded_rectangle((6, 6, dock.width - 7, dock.height - 7), radius=18, fill=255)
dock.putalpha(dock_mask.filter(ImageFilter.GaussianBlur(5)))
dock.save(OUT / 'dock.webp', lossless=True)

ground = canvas.crop((770, 530, 880, 558))
gw, gh = ground.size
fx0, fy0, fx1, fy1 = BAR[0] - 12, BAR[1] - 18, BAR[2] + 12, BAR[3] + 8
fill = Image.new('RGB', (fx1 - fx0, fy1 - fy0))
row = 0
for ty in range(0, fill.height, gh):
    shift = (row % 2) * (gw // 2) - gw
    for tx in range(shift, fill.width, gw):
        fill.paste(ground if row % 2 == 0 else ImageOps.mirror(ground), (tx, ty))
    row += 1
ramp = Image.linear_gradient('L').resize(fill.size)
fill = Image.composite(Image.new('RGB', fill.size, (8, 8, 14)), fill, ramp.point(lambda v: int(v * 0.35)))
mask = Image.new('L', fill.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((10, 10, fill.width - 11, fill.height - 11), radius=22, fill=255)
canvas.paste(fill, (fx0, fy0), mask.filter(ImageFilter.GaussianBlur(9)))

# --- carteles: solo se conserva el del Arsenal ---
def clone(region, source):
    w, h = region[2] - region[0], region[3] - region[1]
    patch = canvas.crop(source).resize((w, h))
    canvas.paste(patch, (region[0], region[1]), feather_mask((w, h), 4, 3))


clone((1030, 316, 1160, 356), (1030, 372, 1160, 412))   # Taberna: placa
clone((1058, 260, 1132, 322), (1130, 222, 1204, 284))   # Taberna: icono
clone((792, 326, 912, 364), (792, 384, 912, 422))       # Alquimista: placa
clone((810, 270, 886, 334), (900, 236, 976, 300))       # Alquimista: icono

# --- esquina superior derecha: sin «+», sin salir y sin mensaje de bienvenida ---
# El saldo y el nombre se dibujan encima con los datos reales: se borran los de la imagen.
pill = tuple(int(c) for c in mean((1032, 33, 1046, 55)))
ImageDraw.Draw(canvas).rectangle((1048, 32, 1137, 57), fill=pill)
paste_patch((148, 24, 360, 100), (150, 0, 362, 28), 6, 4)
gradient_fill((1206, 11, 1270, 73), mean((1215, 3, 1262, 11)), mean((1215, 72, 1262, 80)))
side_fill((976, 102, 1276, 176), 968, 1277)

# --- izquierda: sin «Perfil»; «Historial» queda con su propio borde superior ---
border = canvas.crop((25, 493, 108, 503))
side_fill((20, 488, 114, 583), 14, 116)
canvas.paste(border, (25, 575))

canvas.save(OUT / 'town.webp', quality=92, method=6)
print('pueblo listo')
