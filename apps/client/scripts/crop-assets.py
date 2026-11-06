#!/usr/bin/env python3
"""Regenera public/art a partir de los moodboards locales (references/ no se versiona).
Uso, desde la raíz del repo: python3 apps/client/scripts/crop-assets.py"""
from PIL import Image, ImageDraw

PITCH = Image.open('references/ashenfall_visual_pitchboard.png').convert('RGB')
PLAY = Image.open('references/ashenfall_gameplay_and_asset_board.png').convert('RGB')
OUT = 'apps/client/public/art/'


def save(image, name, colors=128):
    # Paleta indexada: PNG mucho más ligero sin alterar el aspecto pixel art.
    if image.mode == 'RGBA':
        image.quantize(colors, method=Image.Quantize.FASTOCTREE).save(OUT + name, optimize=True)
    else:
        image.quantize(colors, method=Image.Quantize.MEDIANCUT).save(OUT + name, optimize=True)


def without_card(box):
    """Quita el fondo casi negro de la tarjeta, rellenando desde los bordes."""
    image = PLAY.crop(box).convert('RGBA')
    width, height = image.size
    for seed in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        ImageDraw.floodfill(image, seed, (0, 0, 0, 0), thresh=38)
    return image


save(PITCH.crop((466, 48, 1022, 361)), 'town.png', 192)
save(PLAY.crop((412, 14, 925, 303)), 'castle.png', 160)

logo = PLAY.crop((58, 22, 394, 128)).convert('RGBA')
pixels = logo.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b, _ = pixels[x, y]
        light = max(r, g, b)
        pixels[x, y] = (r, g, b, 0 if light < 42 else min(255, (light - 42) * 4))
logo.save(OUT + 'logo.png', optimize=True)

for name, box in {'edrik': (1172, 70, 1280, 236), 'sylwen': (1290, 70, 1395, 236), 'borgrim': (1400, 100, 1505, 236)}.items():
    without_card(box).save(f'{OUT}body-{name}.png', optimize=True)
for name, box in {'edrik': (1202, 75, 1252, 125), 'sylwen': (1310, 85, 1360, 135), 'borgrim': (1430, 110, 1480, 160)}.items():
    save(PLAY.crop(box), f'portrait-{name}.png', 64)
for name, box in {'whispering_forest': (23, 477, 216, 548), 'frostlands': (224, 477, 415, 548), 'ashen_desert': (423, 477, 606, 548)}.items():
    save(PLAY.crop(box), f'biome-{name}.png', 64)
