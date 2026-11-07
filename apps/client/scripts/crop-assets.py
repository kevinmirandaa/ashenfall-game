#!/usr/bin/env python3
"""Regenera public/art a partir de las referencias locales (references/ no se versiona).
Uso, desde la raíz del repo: python3 apps/client/scripts/crop-assets.py"""
from collections import deque
from PIL import Image, ImageDraw, ImageFilter

R = 'references/'
PITCH = Image.open(R + 'ashenfall_visual_pitchboard.png').convert('RGB')
PLAY = Image.open(R + 'ashenfall_gameplay_and_asset_board.png').convert('RGB')
HUB = Image.open(R + 'Ashenfall Moonlit Village Hub.png').convert('RGB')
REF = Image.open(R + 'ashenfall_visual_reference_board.png').convert('RGB')
OUT = 'apps/client/public/art/'


def webp(image, name, quality=None, colors=96):
    """Pixel art nítido: paleta limitada, transparencia sin medios tonos y sin pérdida."""
    if image.mode == 'RGBA':
        alpha = image.getchannel('A').point(lambda v: 255 if v > 110 else 0)
        flat = image.convert('RGB').quantize(colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGBA')
        flat.putalpha(alpha)
    else:
        flat = image.quantize(colors * 2, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
    flat.save(f'{OUT}{name}.webp', lossless=True, method=6)


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


def scaled(image, height):
    return image.resize((round(image.width * height / image.height), height), Image.LANCZOS)


def patch(image, dst, src):
    """Tapa una zona con otra parecida de la misma imagen, con el borde difuminado."""
    w, h = dst[2] - dst[0], dst[3] - dst[1]
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rectangle((8, 8, w - 9, h - 9), fill=255)
    image.paste(image.crop((src[0], src[1], src[0] + w, src[1] + h)), dst[:2], mask.filter(ImageFilter.GaussianBlur(5)))


# ---------- Pueblo: se retiran los datos fijos de la imagen; los pone la interfaz ----------
town = HUB.copy()
patch(town, (195, 30, 460, 122), (195, 122))  # nombre y nivel
ImageDraw.Draw(town).rectangle((1350, 38, 1450, 76), fill=town.getpixel((1345, 57)))  # monedas
patch(town, (778, 545, 890, 625), (620, 620))  # figura central
patch(town, (778, 620, 890, 680), (650, 660))
webp(town.resize((1280, 720), Image.LANCZOS), 'town', colors=128)

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

# ---------- Personajes ----------
BODY = {'edrik': 146, 'sylwen': 144, 'borgrim': 128}
for name, box in {'edrik': (1172, 70, 1280, 236), 'sylwen': (1290, 70, 1395, 236), 'borgrim': (1400, 100, 1505, 236)}.items():
    webp(scaled(cut_out(PLAY, box, 7), BODY[name]), f'body-{name}')
for name, box in {'edrik': (1202, 75, 1252, 125), 'sylwen': (1310, 85, 1360, 135), 'borgrim': (1430, 110, 1480, 160)}.items():
    webp(PLAY.crop(box).resize((100, 100), Image.NEAREST), f'portrait-{name}')

# Biomas: solo las referencias, sin rótulo. Se muestran ampliados por un factor entero.
BIOMES = {'whispering_forest': (REF, (24, 652, 452, 826)), 'frostlands': (PITCH, (1044, 203, 1288, 303)), 'ashen_desert': (PITCH, (1044, 345, 1288, 442))}
for name, (source, box) in BIOMES.items():
    webp(source.crop(box), f'biome-{name}', colors=48)

WEAPON_LENGTH = {'bow': 112, 'spear': 150, 'axe': 104, 'dagger': 58}
# ---------- Armas: se giran para apuntar a +x; `angle` compensa su inclinación en la hoja ----------
for name, box, angle, seeds in (('bow', (630, 358, 695, 430), -45, ((30, 25), (25, 30), (20, 20), (38, 40), (30, 45), (45, 30), (35, 55), (50, 35))), ('spear', (720, 353, 780, 430), -45, ()), ('axe', (810, 353, 868, 434), -85, ()), ('dagger', (898, 358, 955, 430), -48, ())):
    art = cut_out(PLAY, box, 9, seeds)
    webp(art, f'icon-{name}')
    # El arco se voltea: su vientre debe mirar hacia el blanco, con la cuerda del lado del tirador.
    aimed = art.transpose(Image.FLIP_LEFT_RIGHT) if name == 'bow' else art
    turned = aimed.rotate(angle, expand=True, resample=Image.NEAREST)
    turned = turned.crop(turned.getbbox())
    length = WEAPON_LENGTH[name]
    size = (round(turned.width * length / turned.height), length) if name == 'bow' else (length, round(turned.height * length / turned.width))
    webp(turned.resize(size, Image.LANCZOS), f'weapon-{name}')

# ---------- Iconos y efectos ----------
ICONS = {
    'coin': (PITCH, (1343, 520, 1378, 554)), 'pouch': (PITCH, (1390, 520, 1424, 554)), 'gear': (PITCH, (1435, 520, 1470, 554)),
    'shield': (PITCH, (1343, 571, 1378, 605)), 'crown': (PITCH, (1390, 571, 1424, 605)), 'trophy': (PITCH, (1435, 571, 1470, 605)),
    'star': (PITCH, (1343, 618, 1378, 650)), 'cross': (PITCH, (1390, 618, 1424, 650)), 'heart': (PITCH, (1343, 663, 1378, 697)),
    'swords': (PLAY, (78, 368, 118, 406)), 'potion': (PLAY, (1012, 358, 1060, 432)), 'helm': (PLAY, (1295, 366, 1333, 406)),
    'hood': (PLAY, (1345, 366, 1385, 406)), 'cloak': (PLAY, (1296, 418, 1334, 460)), 'emblem': (PLAY, (1296, 466, 1334, 512)),
    'scroll': (PITCH, (1482, 618, 1516, 650)), 'check': (PLAY, (1062, 886, 1084, 905)),
}
for name, (source, box) in ICONS.items():
    webp(cut_out(source, box, 20).resize((64, round(64 * (box[3] - box[1]) / (box[2] - box[0]))), Image.NEAREST), f'icon-{name}')
webp(cut_out(PLAY, (1015, 660, 1062, 676), 25), 'fx-arrow')
