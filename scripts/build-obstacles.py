#!/usr/bin/env python3
"""
Recorta los obstáculos de references/ashenfall_obstacles_board.webp y genera:

- apps/client/public/art/obs-atlas.webp y obs-atlas.json   todos los obstáculos, sin fondo, en un solo atlas de Phaser
- apps/client/public/art/terrain-<id>.webp   los bloques de tierra con los que se arman plataformas y gradas
- packages/domain/src/obstacle-catalog.ts   dimensiones de colisión y dibujo, y en qué biomas puede aparecer cada uno

La hoja es la fuente de verdad: cada entrada de ITEMS es un recuadro de la hoja. Las dimensiones lógicas
(las que usa el servidor) se derivan del tamaño real del sprite, así que dibujo y colisión no se separan.

Uso: python3 scripts/build-obstacles.py   (requiere Pillow)
"""
import json
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BOARD = ROOT / 'references' / 'ashenfall_obstacles_board.webp'
OUT = ROOT / 'apps' / 'client' / 'public' / 'art'
CATALOG = ROOT / 'packages' / 'domain' / 'src' / 'obstacle-catalog.ts'

# Franjas de la hoja (y inicial, y final) por fila.
BANDS = [(8, 200), (200, 392), (392, 536), (536, 672), (672, 826), (826, 932)]

H, G, D, M, F, B, R = 'hamlet_ruins', 'graveyard', 'ember_desert', 'misty_pines', 'frozen_bridge', 'blood_keep', 'fog_ruins'

# Escala por defecto en unidades de mundo por píxel de la hoja y altura máxima de dibujo.
DEFAULT_SCALE = 1.15
MAX_DRAW_HEIGHT = 215

# Colisión como fracción del dibujo (ancho, alto) y posición horizontal de su centro (cx).
SOLID = (0.8, 0.95)   # bloque de piedra, torre, roca
FULL = (0.9, 1.0)     # arcos, muros: el rectángulo entero
TREE = (0.16, 0.5)    # solo el tronco: la copa se atraviesa
BUSH = (0.7, 0.7)
THIN = (0.55, 1.0)    # columnas, farolas, banderas
LOW = (0.8, 0.9)

# id, fila, x0, x1, y0|None, y1|None, colisión, biomas, escala opcional, cx opcional
ITEMS: list[tuple] = [
    # --- fila 1: ruinas, cementerio ---
    ('arch_steps', 0, 12, 172, None, None, FULL, (H, R, G), None, 0.5),
    ('pillar_a', 0, 205, 262, None, None, THIN, (H, G, R, B), None, 0.5),
    ('rubble_a', 0, 176, 206, 110, 200, LOW, (H, G, R), None, 0.5),
    ('rubble_stub', 0, 255, 302, None, None, SOLID, (H, G, R, B), None, 0.5),
    ('pillar_b', 0, 302, 362, None, None, THIN, (H, G, R, B), None, 0.5),
    ('rubble_b', 0, 365, 417, None, None, SOLID, (H, G, R), None, 0.5),
    ('angel', 0, 420, 504, None, None, SOLID, (G, B, R), None, 0.5),
    ('arch_gate', 0, 504, 656, None, None, FULL, (G, B, R), None, 0.5),
    ('tower_pillar', 0, 667, 727, None, None, THIN, (H, G, R, B), None, 0.5),
    ('tomb_a', 0, 719, 757, None, None, SOLID, (G, B, R), None, 0.5),
    ('tomb_b', 0, 762, 800, None, None, SOLID, (G, B, R), None, 0.5),
    ('deadtree_purple', 0, 745, 912, None, None, TREE, (G, B, H), None, 0.5),
    ('tomb_c', 0, 862, 903, None, None, SOLID, (G, B, R), None, 0.5),
    ('cross_stone', 0, 902, 946, None, None, THIN, (G, B, R), None, 0.5),
    ('castle_ruin', 0, 938, 1166, None, None, FULL, (H, B, R), None, 0.5),
    ('wall_slab', 0, 1186, 1364, 16, 86, FULL, (H, B, R), 1.0, 0.5),
    ('banner_cross', 0, 1414, 1470, None, None, THIN, (H, G, B, R), None, 0.5),
    ('shrine_small', 0, 1468, 1518, None, None, THIN, (G, B, R), None, 0.5),
    ('gallows_pole', 0, 1508, 1556, None, None, THIN, (H, B, M), None, 0.5),
    ('torch_sign', 0, 1581, 1651, 25, 140, THIN, (H, B), None, 0.5),
    ('crates_barrels', 0, 1581, 1651, 147, 199, SOLID, (H, B, F), None, 0.5),
    # --- fila 2: bosque, aldea ---
    ('oak_a', 1, 13, 143, None, None, TREE, (H, M), None, 0.5),
    ('oak_b', 1, 143, 270, 200, 340, TREE, (H, M), None, 0.5),
    ('bush_a', 1, 113, 178, 318, 385, BUSH, (H, M), None, 0.5),
    ('bush_b', 1, 222, 273, 330, 385, BUSH, (H, M), None, 0.5),
    ('deadtree_twisted', 1, 267, 373, None, None, TREE, (H, M, G), None, 0.5),
    ('spruce_dark', 1, 362, 448, None, None, TREE, (M, H), None, 0.5),
    ('spruce_light', 1, 452, 533, None, None, TREE, (M, H), None, 0.5),
    ('oak_c', 1, 530, 658, None, None, TREE, (H, M), None, 0.5),
    ('bush_c', 1, 605, 685, 302, 385, BUSH, (H, M), None, 0.5),
    ('fence_spiked', 1, 672, 805, 225, 292, LOW, (H, M, G), None, 0.5),
    ('boulder_pile', 1, 687, 783, 300, 377, SOLID, (H, M, D), None, 0.5),
    ('stump', 1, 836, 893, 250, 291, LOW, (H, M), None, 0.5),
    ('bush_d', 1, 896, 1024, 212, 291, BUSH, (M, H), None, 0.5),
    ('fence_dead', 1, 1031, 1113, 225, 346, LOW, (H, M, G), None, 0.5),
    ('watchtower', 1, 1126, 1211, None, None, THIN, (M, H), None, 0.5),
    ('mound_grass', 1, 1223, 1301, 215, 255, LOW, (M, H), None, 0.5),
    ('rocks_mossy', 1, 1308, 1456, 210, 263, LOW, (M, H, R), None, 0.5),
    ('well', 1, 1373, 1466, 280, 383, SOLID, (H, M), None, 0.5),
    ('cart_ruin', 1, 1211, 1366, 283, 383, SOLID, (H, M), None, 0.5),
    ('arch_big', 1, 1478, 1651, None, None, FULL, (H, R, M), None, 0.5),
    ('barrel', 1, 1561, 1591, 335, 379, LOW, (H, M, F), None, 0.5),
    ('log_fallen', 1, 946, 1116, 310, 375, LOW, (M, H), None, 0.5),
    ('roots_stump', 1, 836, 881, 312, 375, LOW, (M, H, G), None, 0.5),
    ('wood_frame', 1, 883, 931, 326, 383, LOW, (H, M), None, 0.5),
    # --- fila 3: desierto ---
    ('cactus_a', 2, 20, 85, None, None, (0.45, 0.95), (D,), None, 0.5),
    ('cactus_b', 2, 107, 163, None, None, (0.45, 0.95), (D,), None, 0.5),
    ('cactus_c', 2, 175, 215, None, None, (0.45, 0.95), (D,), None, 0.5),
    ('rocks_desert', 2, 295, 372, 420, 512, SOLID, (D, H), None, 0.5),
    ('ribs_skull', 2, 255, 335, 480, 513, LOW, (D,), None, 0.5),
    ('mesa', 2, 372, 525, 398, 513, (0.7, 0.95), (D,), None, 0.5),
    ('arch_desert', 2, 565, 705, None, None, FULL, (D,), None, 0.5),
    ('banner_desert', 2, 727, 772, None, None, THIN, (D,), None, 0.5),
    ('deadtree_desert', 2, 836, 956, None, None, TREE, (D,), None, 0.5),
    ('tower_desert_a', 2, 978, 1038, None, None, THIN, (D,), None, 0.5),
    ('tower_desert_b', 2, 1063, 1126, None, None, THIN, (D,), None, 0.5),
    ('rock_slab', 2, 1136, 1278, 398, 445, LOW, (D,), None, 0.5),
    ('rock_big', 2, 1156, 1276, 462, 519, SOLID, (D,), None, 0.5),
    ('gallows_desert', 2, 1296, 1341, 405, 519, THIN, (D,), None, 0.5),
    # Escalera de piedra: solo bloquea su parte alta, la derecha; los escalones bajos son adorno.
    ('steps_desert', 2, 1331, 1395, 462, 519, (0.55, 1.0), (D, H), None, 0.78),
    # --- fila 4: nieve ---
    ('spruce_snow_a', 3, 15, 108, None, None, TREE, (F,), None, 0.5),
    ('deadtree_snow_a', 3, 112, 218, None, None, TREE, (F,), None, 0.5),
    ('wall_stairs_snow', 3, 228, 330, None, None, (0.6, 1.0), (F, R), None, 0.3),
    ('pines_snow_pair', 3, 322, 368, None, None, TREE, (F,), None, 0.5),
    ('spruce_snow_b', 3, 365, 425, None, None, TREE, (F,), None, 0.5),
    ('mound_snow', 3, 410, 530, None, None, SOLID, (F,), None, 0.5),
    ('arch_snow', 3, 530, 660, None, None, FULL, (F,), None, 0.5),
    ('tomb_snow', 3, 668, 710, None, None, SOLID, (F, G), None, 0.5),
    ('crate_snow', 3, 718, 760, None, None, SOLID, (F,), None, 0.5),
    ('deadtree_snow_b', 3, 760, 836, None, None, TREE, (F,), None, 0.5),
    ('spruce_snow_c', 3, 851, 896, None, None, TREE, (F,), None, 0.5),
    ('pine_cluster_snow', 3, 881, 968, None, None, TREE, (F,), None, 0.5),
    ('sapling_snow', 3, 971, 1008, None, None, BUSH, (F,), None, 0.5),
    ('pillar_snow', 3, 1011, 1056, None, None, THIN, (F,), None, 0.5),
    ('gallows_snow', 3, 1058, 1143, None, None, FULL, (F,), None, 0.5),
    ('fence_snow', 3, 1161, 1256, None, None, LOW, (F, M), None, 0.5),
    # --- fila 5: brumas y fortaleza ---
    ('deadtree_fog', 4, 15, 180, None, None, TREE, (B, R, G), None, 0.5),
    ('shrine_gothic', 4, 232, 295, None, None, SOLID, (B, G, R), None, 0.5),
    ('tomb_tall', 4, 307, 345, None, None, SOLID, (B, G, R), None, 0.5),
    ('pine_frost', 4, 370, 412, None, None, TREE, (B, R, F), None, 0.5),
    ('angel_dark', 4, 427, 488, None, None, SOLID, (B, G, R), None, 0.5),
    ('tombs_pair', 4, 487, 567, None, None, SOLID, (B, G, R), None, 0.5),
    ('gate_spiked', 4, 575, 720, None, None, FULL, (B, R), None, 0.5),
    ('banner_dark', 4, 730, 772, None, None, THIN, (B, R), None, 0.5),
    ('arch_dark', 4, 795, 893, None, None, FULL, (B, R, G), None, 0.5),
    ('lamp_post', 4, 931, 973, None, None, THIN, (B, R, H), None, 0.5),
    ('chapel_lit', 4, 983, 1141, None, None, FULL, (B, R), None, 0.5),
    ('wood_stand', 4, 1153, 1206, 705, 826, LOW, (B, R), None, 0.5),
    ('flame_pedestal', 4, 1231, 1271, 700, 826, THIN, (B, R, G), None, 0.5),
    ('cross_big', 4, 1282, 1324, None, None, THIN, (B, G, R), None, 0.5),
    ('gate_wide', 4, 1333, 1538, None, None, FULL, (B, R), None, 0.5),
    ('cliff_snow_small', 4, 1543, 1658, None, None, SOLID, (F, R), None, 0.5),
    # --- fila 6: utilería ---
    ('banner_red', 5, 996, 1028, None, None, THIN, (B, H, R), None, 0.5),
    ('gallows_cage', 5, 1048, 1136, None, None, FULL, (B, R), None, 0.5),
    ('crates_stack', 5, 1183, 1256, None, None, SOLID, (B, H, R, F), None, 0.5),
    ('cage_hanger', 5, 1268, 1316, None, None, THIN, (B, R), None, 0.5),
    ('rock_golem', 5, 1333, 1448, 826, 878, SOLID, (R, B), None, 0.5),
]

# Bloques de tierra: plataformas, gradas y desniveles. Se estiran por rebanadas, sin deformar los píxeles.
# bioma: (x0, x1, y0, y1)
TERRAIN = {
    'grass': (1186, 1411, 95, 193),
    'desert': (1390, 1520, 440, 520),
    'snow': (1266, 1408, 568, 652),
    'dark': (1333, 1448, 873, 923),
}
# Qué bloque usa cada bioma.
TERRAIN_OF = {H: 'grass', G: 'grass', D: 'desert', M: 'grass', F: 'snow', B: 'dark', R: 'dark'}


def clean(image: Image.Image, holes: bool = True) -> Image.Image:
    """Quita el fondo casi negro, también el que queda encerrado dentro de arcos y ventanas."""
    rgb = image.convert('RGB')
    width, height = rgb.size
    px = rgb.load()
    bg = (2, 1, 8)
    near = bytearray(width * height)
    for y in range(height):
        for x in range(width):
            r, g, b = px[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) <= 18:
                near[y * width + x] = 1
    seen = bytearray(width * height)
    alpha = Image.new('L', (width, height), 255)
    ap = alpha.load()
    for start in range(width * height):
        if not near[start] or seen[start]:
            continue
        queue = deque([start])
        seen[start] = 1
        component = [start]
        touches_edge = False
        while queue:
            i = queue.popleft()
            x, y = i % width, i // width
            if x in (0, width - 1) or y in (0, height - 1):
                touches_edge = True
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < width and 0 <= ny < height:
                    j = ny * width + nx
                    if near[j] and not seen[j]:
                        seen[j] = 1
                        queue.append(j)
                        component.append(j)
        # Fondo exterior, o huecos encerrados lo bastante grandes como para ser el interior de un arco.
        if touches_edge or (holes and len(component) >= 350):
            for i in component:
                ap[i % width, i // width] = 0
    out = rgb.convert('RGBA')
    out.putalpha(alpha)
    return out


def drop_specks(image: Image.Image) -> Image.Image:
    """Quita motas, ramitas y restos sueltos de otros dibujos: cualquier pieza mucho menor que la principal."""
    alpha = image.getchannel('A')
    width, height = alpha.size
    ap = alpha.load()
    seen = bytearray(width * height)
    pieces: list[list[int]] = []
    for start in range(width * height):
        if ap[start % width, start // width] <= 40 or seen[start]:
            continue
        queue = deque([start])
        seen[start] = 1
        piece = [start]
        while queue:
            i = queue.popleft()
            x, y = i % width, i // width
            for nx in range(x - 2, x + 3):
                for ny in range(y - 2, y + 3):
                    if 0 <= nx < width and 0 <= ny < height:
                        j = ny * width + nx
                        if not seen[j] and ap[nx, ny] > 40:
                            seen[j] = 1
                            queue.append(j)
                            piece.append(j)
        pieces.append(piece)
    if not pieces:
        return image
    biggest = max(len(piece) for piece in pieces)
    out = image.copy()
    op = out.load()
    for piece in pieces:
        if len(piece) < biggest * 0.08:
            for i in piece:
                r, g, b, _ = op[i % width, i // width]
                op[i % width, i // width] = (r, g, b, 0)
    return out


def trim(image: Image.Image) -> Image.Image:
    box = image.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    return image.crop(box) if box else image


def crop(board: Image.Image, row: int, x0: int, x1: int, y0: int | None, y1: int | None) -> Image.Image:
    band = BANDS[row]
    return trim(drop_specks(clean(board.crop((x0, y0 if y0 is not None else band[0], x1, y1 if y1 is not None else band[1])))))


def pack_atlas(sprites: list[tuple[str, Image.Image]]) -> None:
    """Empaqueta todos los sprites por filas en un atlas con formato JSON Hash de Phaser."""
    pad, atlas_w = 2, 1536
    x = y = row_h = 0
    placed: list[tuple[str, Image.Image, int, int]] = []
    for ident, sprite in sorted(sprites, key=lambda item: -item[1].height):
        if x + sprite.width + pad > atlas_w:
            x, y, row_h = 0, y + row_h + pad, 0
        placed.append((ident, sprite, x, y))
        x += sprite.width + pad
        row_h = max(row_h, sprite.height)
    atlas_h = y + row_h + pad
    atlas = Image.new('RGBA', (atlas_w, atlas_h), (0, 0, 0, 0))
    frames = {}
    for ident, sprite, px, py in placed:
        atlas.paste(sprite, (px, py))
        w, h = sprite.size
        frames[ident] = {'frame': {'x': px, 'y': py, 'w': w, 'h': h}, 'rotated': False, 'trimmed': False,
                         'spriteSourceSize': {'x': 0, 'y': 0, 'w': w, 'h': h}, 'sourceSize': {'w': w, 'h': h}}
    # Con pérdida (q90) y alfa exacto: pesa un 64 % menos que sin pérdida y la diferencia media es de
    # unos 2,6/255 por canal (PSNR ~37 dB); las siluetas no cambian. Ver docs/optimizacion.md.
    atlas.save(OUT / 'obs-atlas.webp', quality=90, alpha_quality=100, method=6)
    (OUT / 'obs-atlas.json').write_text(json.dumps({'frames': frames, 'meta': {'image': 'obs-atlas.webp', 'format': 'RGBA8888', 'size': {'w': atlas_w, 'h': atlas_h}, 'scale': 1}}, separators=(',', ':')))
    print('atlas', atlas.size, len(frames), 'sprites')


def tier_of(height: float) -> str:
    return 'low' if height < 70 else 'mid' if height < 130 else 'tall'


def main() -> None:
    board = Image.open(BOARD).convert('RGB')
    rows: list[str] = []
    sprites: list[tuple[str, Image.Image]] = []
    for ident, row, x0, x1, y0, y1, (cw, ch), biomes, scale, cx in ITEMS:
        sprite = crop(board, row, x0, x1, y0, y1)
        sprites.append((ident, sprite))
        width, height = sprite.size
        k = scale if scale is not None else DEFAULT_SCALE
        k = min(k, MAX_DRAW_HEIGHT / height)
        draw_w, draw_h = round(width * k), round(height * k)
        col_w = max(24, round(draw_w * cw))
        col_h = max(24, round(draw_h * ch))
        rows.append(
            f"  {ident}: {{ id: '{ident}', width: {col_w}, height: {col_h}, drawWidth: {draw_w}, drawHeight: {draw_h}, cx: {cx}, tier: '{tier_of(col_h)}', biomes: [{', '.join(repr(b) for b in biomes)}] }},"
        )
    for name, (x0, x1, y0, y1) in TERRAIN.items():
        piece = trim(clean(board.crop((x0, y0, x1, y1)), holes=False))
        piece.save(OUT / f'terrain-{name}.webp', lossless=True)
        print('terreno', name, piece.size)

    pack_atlas(sprites)
    ids = [row.split(':')[0].strip() for row in rows]
    biome_ids = [H, G, D, M, F, B, R]
    CATALOG.write_text(
        '// GENERADO por scripts/build-obstacles.py a partir de references/ashenfall_obstacles_board.webp. No editar a mano.\n'
        "import type { ArenaId } from './arenas.js';\n\n"
        f"export const OBSTACLE_IDS = [{', '.join(repr(i) for i in ids)}] as const;\n"
        'export type PropId = (typeof OBSTACLE_IDS)[number];\n\n'
        "/** Altura de la colisión: baja (< 70), media o alta (≥ 130). Decide dónde puede ir cada obstáculo. */\n"
        "export type PropTier = 'low' | 'mid' | 'tall';\n\n"
        'export interface PropSpec {\n'
        '  readonly id: PropId;\n'
        '  /** Rectángulo de colisión, en unidades de mundo. */\n'
        '  readonly width: number;\n'
        '  readonly height: number;\n'
        '  /** Tamaño del dibujo; la colisión se apoya en su base. */\n'
        '  readonly drawWidth: number;\n'
        '  readonly drawHeight: number;\n'
        '  /** Fracción horizontal del dibujo donde cae el centro de la colisión. */\n'
        '  readonly cx: number;\n'
        '  readonly tier: PropTier;\n'
        '  readonly biomes: readonly ArenaId[];\n'
        '}\n\n'
        'export const PROPS: Readonly<Record<PropId, PropSpec>> = {\n' + '\n'.join(rows) + '\n};\n\n'
        f"/** Bloque de tierra con el que cada bioma arma sus plataformas y gradas. */\n"
        'export const TERRAIN_OF: Readonly<Record<ArenaId, ' + ' | '.join(repr(t) for t in sorted(set(TERRAIN_OF.values()))) + '>> = {\n'
        + '\n'.join(f"  {b}: '{TERRAIN_OF[b]}'," for b in biome_ids)
        + '\n};\n'
    )
    print(len(rows), 'obstáculos')


if __name__ == '__main__':
    main()
