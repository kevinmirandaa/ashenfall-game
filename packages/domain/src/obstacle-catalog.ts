// GENERADO por scripts/build-obstacles.py a partir de references/ashenfall_obstacles_board.webp. No editar a mano.
import type { ArenaId } from './arenas.js';

export const OBSTACLE_IDS = ['arch_steps', 'pillar_a', 'rubble_a', 'rubble_stub', 'pillar_b', 'rubble_b', 'angel', 'arch_gate', 'tower_pillar', 'tomb_a', 'tomb_b', 'deadtree_purple', 'tomb_c', 'cross_stone', 'castle_ruin', 'wall_slab', 'banner_cross', 'shrine_small', 'gallows_pole', 'torch_sign', 'crates_barrels', 'oak_a', 'oak_b', 'bush_a', 'bush_b', 'deadtree_twisted', 'spruce_dark', 'spruce_light', 'oak_c', 'bush_c', 'fence_spiked', 'boulder_pile', 'stump', 'bush_d', 'fence_dead', 'watchtower', 'mound_grass', 'rocks_mossy', 'well', 'cart_ruin', 'arch_big', 'barrel', 'log_fallen', 'roots_stump', 'wood_frame', 'cactus_a', 'cactus_b', 'cactus_c', 'rocks_desert', 'ribs_skull', 'mesa', 'arch_desert', 'banner_desert', 'deadtree_desert', 'tower_desert_a', 'tower_desert_b', 'rock_slab', 'rock_big', 'gallows_desert', 'steps_desert', 'spruce_snow_a', 'deadtree_snow_a', 'wall_stairs_snow', 'pines_snow_pair', 'spruce_snow_b', 'mound_snow', 'arch_snow', 'tomb_snow', 'crate_snow', 'deadtree_snow_b', 'spruce_snow_c', 'pine_cluster_snow', 'sapling_snow', 'pillar_snow', 'gallows_snow', 'fence_snow', 'deadtree_fog', 'shrine_gothic', 'tomb_tall', 'pine_frost', 'angel_dark', 'tombs_pair', 'gate_spiked', 'banner_dark', 'arch_dark', 'lamp_post', 'chapel_lit', 'wood_stand', 'flame_pedestal', 'cross_big', 'gate_wide', 'cliff_snow_small', 'banner_red', 'gallows_cage', 'crates_stack', 'cage_hanger', 'rock_golem'] as const;
export type PropId = (typeof OBSTACLE_IDS)[number];

/** Altura de la colisión: baja (< 70), media o alta (≥ 130). Decide dónde puede ir cada obstáculo. */
export type PropTier = 'low' | 'mid' | 'tall';

export interface PropSpec {
  readonly id: PropId;
  /** Rectángulo de colisión, en unidades de mundo. */
  readonly width: number;
  readonly height: number;
  /** Tamaño del dibujo; la colisión se apoya en su base. */
  readonly drawWidth: number;
  readonly drawHeight: number;
  /** Fracción horizontal del dibujo donde cae el centro de la colisión. */
  readonly cx: number;
  readonly tier: PropTier;
  readonly biomes: readonly ArenaId[];
}

export const PROPS: Readonly<Record<PropId, PropSpec>> = {
  arch_steps: { id: 'arch_steps', width: 165, height: 192, drawWidth: 183, drawHeight: 192, cx: 0.5, tier: 'tall', biomes: ['hamlet_ruins', 'fog_ruins', 'graveyard'] },
  pillar_a: { id: 'pillar_a', width: 32, height: 183, drawWidth: 59, drawHeight: 183, cx: 0.5, tier: 'tall', biomes: ['hamlet_ruins', 'graveyard', 'fog_ruins', 'blood_keep'] },
  rubble_a: { id: 'rubble_a', width: 27, height: 57, drawWidth: 34, drawHeight: 63, cx: 0.5, tier: 'low', biomes: ['hamlet_ruins', 'graveyard', 'fog_ruins'] },
  rubble_stub: { id: 'rubble_stub', width: 43, height: 92, drawWidth: 54, drawHeight: 97, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'graveyard', 'fog_ruins', 'blood_keep'] },
  pillar_b: { id: 'pillar_b', width: 38, height: 179, drawWidth: 69, drawHeight: 179, cx: 0.5, tier: 'tall', biomes: ['hamlet_ruins', 'graveyard', 'fog_ruins', 'blood_keep'] },
  rubble_b: { id: 'rubble_b', width: 48, height: 71, drawWidth: 60, drawHeight: 75, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'graveyard', 'fog_ruins'] },
  angel: { id: 'angel', width: 62, height: 175, drawWidth: 77, drawHeight: 184, cx: 0.5, tier: 'tall', biomes: ['graveyard', 'blood_keep', 'fog_ruins'] },
  arch_gate: { id: 'arch_gate', width: 158, height: 197, drawWidth: 175, drawHeight: 197, cx: 0.5, tier: 'tall', biomes: ['graveyard', 'blood_keep', 'fog_ruins'] },
  tower_pillar: { id: 'tower_pillar', width: 38, height: 189, drawWidth: 69, drawHeight: 189, cx: 0.5, tier: 'tall', biomes: ['hamlet_ruins', 'graveyard', 'fog_ruins', 'blood_keep'] },
  tomb_a: { id: 'tomb_a', width: 35, height: 66, drawWidth: 44, drawHeight: 70, cx: 0.5, tier: 'low', biomes: ['graveyard', 'blood_keep', 'fog_ruins'] },
  tomb_b: { id: 'tomb_b', width: 35, height: 188, drawWidth: 44, drawHeight: 198, cx: 0.5, tier: 'tall', biomes: ['graveyard', 'blood_keep', 'fog_ruins'] },
  deadtree_purple: { id: 'deadtree_purple', width: 31, height: 101, drawWidth: 192, drawHeight: 202, cx: 0.5, tier: 'mid', biomes: ['graveyard', 'blood_keep', 'hamlet_ruins'] },
  tomb_c: { id: 'tomb_c', width: 38, height: 183, drawWidth: 47, drawHeight: 193, cx: 0.5, tier: 'tall', biomes: ['graveyard', 'blood_keep', 'fog_ruins'] },
  cross_stone: { id: 'cross_stone', width: 28, height: 100, drawWidth: 51, drawHeight: 100, cx: 0.5, tier: 'mid', biomes: ['graveyard', 'blood_keep', 'fog_ruins'] },
  castle_ruin: { id: 'castle_ruin', width: 236, height: 202, drawWidth: 262, drawHeight: 202, cx: 0.5, tier: 'tall', biomes: ['hamlet_ruins', 'blood_keep', 'fog_ruins'] },
  wall_slab: { id: 'wall_slab', width: 160, height: 70, drawWidth: 178, drawHeight: 70, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'blood_keep', 'fog_ruins'] },
  banner_cross: { id: 'banner_cross', width: 34, height: 193, drawWidth: 61, drawHeight: 193, cx: 0.5, tier: 'tall', biomes: ['hamlet_ruins', 'graveyard', 'blood_keep', 'fog_ruins'] },
  shrine_small: { id: 'shrine_small', width: 31, height: 129, drawWidth: 57, drawHeight: 129, cx: 0.5, tier: 'mid', biomes: ['graveyard', 'blood_keep', 'fog_ruins'] },
  gallows_pole: { id: 'gallows_pole', width: 30, height: 197, drawWidth: 55, drawHeight: 197, cx: 0.5, tier: 'tall', biomes: ['hamlet_ruins', 'blood_keep', 'misty_pines'] },
  torch_sign: { id: 'torch_sign', width: 38, height: 115, drawWidth: 70, drawHeight: 115, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'blood_keep'] },
  crates_barrels: { id: 'crates_barrels', width: 64, height: 57, drawWidth: 80, drawHeight: 60, cx: 0.5, tier: 'low', biomes: ['hamlet_ruins', 'blood_keep', 'frozen_bridge'] },
  oak_a: { id: 'oak_a', width: 24, height: 106, drawWidth: 148, drawHeight: 212, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'misty_pines'] },
  oak_b: { id: 'oak_b', width: 24, height: 73, drawWidth: 146, drawHeight: 146, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'misty_pines'] },
  bush_a: { id: 'bush_a', width: 52, height: 52, drawWidth: 75, drawHeight: 75, cx: 0.5, tier: 'low', biomes: ['hamlet_ruins', 'misty_pines'] },
  bush_b: { id: 'bush_b', width: 41, height: 43, drawWidth: 59, drawHeight: 61, cx: 0.5, tier: 'low', biomes: ['hamlet_ruins', 'misty_pines'] },
  deadtree_twisted: { id: 'deadtree_twisted', width: 24, height: 102, drawWidth: 122, drawHeight: 205, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'misty_pines', 'graveyard'] },
  spruce_dark: { id: 'spruce_dark', width: 24, height: 104, drawWidth: 99, drawHeight: 207, cx: 0.5, tier: 'mid', biomes: ['misty_pines', 'hamlet_ruins'] },
  spruce_light: { id: 'spruce_light', width: 24, height: 100, drawWidth: 93, drawHeight: 199, cx: 0.5, tier: 'mid', biomes: ['misty_pines', 'hamlet_ruins'] },
  oak_c: { id: 'oak_c', width: 24, height: 104, drawWidth: 147, drawHeight: 209, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'misty_pines'] },
  bush_c: { id: 'bush_c', width: 64, height: 65, drawWidth: 92, drawHeight: 93, cx: 0.5, tier: 'low', biomes: ['hamlet_ruins', 'misty_pines'] },
  fence_spiked: { id: 'fence_spiked', width: 122, height: 62, drawWidth: 153, drawHeight: 69, cx: 0.5, tier: 'low', biomes: ['hamlet_ruins', 'misty_pines', 'graveyard'] },
  boulder_pile: { id: 'boulder_pile', width: 88, height: 85, drawWidth: 110, drawHeight: 89, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'misty_pines', 'ember_desert'] },
  stump: { id: 'stump', width: 53, height: 36, drawWidth: 66, drawHeight: 40, cx: 0.5, tier: 'low', biomes: ['hamlet_ruins', 'misty_pines'] },
  bush_d: { id: 'bush_d', width: 102, height: 59, drawWidth: 146, drawHeight: 85, cx: 0.5, tier: 'low', biomes: ['misty_pines', 'hamlet_ruins'] },
  fence_dead: { id: 'fence_dead', width: 75, height: 118, drawWidth: 94, drawHeight: 131, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'misty_pines', 'graveyard'] },
  watchtower: { id: 'watchtower', width: 54, height: 194, drawWidth: 98, drawHeight: 194, cx: 0.5, tier: 'tall', biomes: ['misty_pines', 'hamlet_ruins'] },
  mound_grass: { id: 'mound_grass', width: 72, height: 37, drawWidth: 90, drawHeight: 41, cx: 0.5, tier: 'low', biomes: ['misty_pines', 'hamlet_ruins'] },
  rocks_mossy: { id: 'rocks_mossy', width: 136, height: 53, drawWidth: 170, drawHeight: 59, cx: 0.5, tier: 'low', biomes: ['misty_pines', 'hamlet_ruins', 'fog_ruins'] },
  well: { id: 'well', width: 86, height: 112, drawWidth: 107, drawHeight: 118, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'misty_pines'] },
  cart_ruin: { id: 'cart_ruin', width: 142, height: 107, drawWidth: 178, drawHeight: 113, cx: 0.5, tier: 'mid', biomes: ['hamlet_ruins', 'misty_pines'] },
  arch_big: { id: 'arch_big', width: 179, height: 190, drawWidth: 199, drawHeight: 190, cx: 0.5, tier: 'tall', biomes: ['hamlet_ruins', 'fog_ruins', 'misty_pines'] },
  barrel: { id: 'barrel', width: 27, height: 46, drawWidth: 34, drawHeight: 51, cx: 0.5, tier: 'low', biomes: ['hamlet_ruins', 'misty_pines', 'frozen_bridge'] },
  log_fallen: { id: 'log_fallen', width: 156, height: 68, drawWidth: 195, drawHeight: 75, cx: 0.5, tier: 'low', biomes: ['misty_pines', 'hamlet_ruins'] },
  roots_stump: { id: 'roots_stump', width: 42, height: 62, drawWidth: 52, drawHeight: 69, cx: 0.5, tier: 'low', biomes: ['misty_pines', 'hamlet_ruins', 'graveyard'] },
  wood_frame: { id: 'wood_frame', width: 44, height: 59, drawWidth: 55, drawHeight: 66, cx: 0.5, tier: 'low', biomes: ['hamlet_ruins', 'misty_pines'] },
  cactus_a: { id: 'cactus_a', width: 34, height: 141, drawWidth: 75, drawHeight: 148, cx: 0.5, tier: 'tall', biomes: ['ember_desert'] },
  cactus_b: { id: 'cactus_b', width: 29, height: 126, drawWidth: 64, drawHeight: 133, cx: 0.5, tier: 'mid', biomes: ['ember_desert'] },
  cactus_c: { id: 'cactus_c', width: 24, height: 88, drawWidth: 46, drawHeight: 93, cx: 0.5, tier: 'mid', biomes: ['ember_desert'] },
  rocks_desert: { id: 'rocks_desert', width: 71, height: 101, drawWidth: 89, drawHeight: 106, cx: 0.5, tier: 'mid', biomes: ['ember_desert', 'hamlet_ruins'] },
  ribs_skull: { id: 'ribs_skull', width: 74, height: 34, drawWidth: 92, drawHeight: 38, cx: 0.5, tier: 'low', biomes: ['ember_desert'] },
  mesa: { id: 'mesa', width: 123, height: 124, drawWidth: 176, drawHeight: 131, cx: 0.5, tier: 'mid', biomes: ['ember_desert'] },
  arch_desert: { id: 'arch_desert', width: 145, height: 156, drawWidth: 161, drawHeight: 156, cx: 0.5, tier: 'tall', biomes: ['ember_desert'] },
  banner_desert: { id: 'banner_desert', width: 29, height: 153, drawWidth: 52, drawHeight: 153, cx: 0.5, tier: 'tall', biomes: ['ember_desert'] },
  deadtree_desert: { id: 'deadtree_desert', width: 24, height: 74, drawWidth: 138, drawHeight: 147, cx: 0.5, tier: 'mid', biomes: ['ember_desert'] },
  tower_desert_a: { id: 'tower_desert_a', width: 38, height: 131, drawWidth: 69, drawHeight: 131, cx: 0.5, tier: 'tall', biomes: ['ember_desert'] },
  tower_desert_b: { id: 'tower_desert_b', width: 40, height: 112, drawWidth: 72, drawHeight: 112, cx: 0.5, tier: 'mid', biomes: ['ember_desert'] },
  rock_slab: { id: 'rock_slab', width: 130, height: 48, drawWidth: 163, drawHeight: 53, cx: 0.5, tier: 'low', biomes: ['ember_desert'] },
  rock_big: { id: 'rock_big', width: 110, height: 60, drawWidth: 138, drawHeight: 63, cx: 0.5, tier: 'low', biomes: ['ember_desert'] },
  gallows_desert: { id: 'gallows_desert', width: 29, height: 128, drawWidth: 52, drawHeight: 128, cx: 0.5, tier: 'mid', biomes: ['ember_desert'] },
  steps_desert: { id: 'steps_desert', width: 41, height: 66, drawWidth: 74, drawHeight: 66, cx: 0.78, tier: 'low', biomes: ['ember_desert', 'hamlet_ruins'] },
  spruce_snow_a: { id: 'spruce_snow_a', width: 24, height: 70, drawWidth: 107, drawHeight: 141, cx: 0.5, tier: 'mid', biomes: ['frozen_bridge'] },
  deadtree_snow_a: { id: 'deadtree_snow_a', width: 24, height: 68, drawWidth: 122, drawHeight: 135, cx: 0.5, tier: 'low', biomes: ['frozen_bridge'] },
  wall_stairs_snow: { id: 'wall_stairs_snow', width: 70, height: 110, drawWidth: 117, drawHeight: 110, cx: 0.3, tier: 'mid', biomes: ['frozen_bridge', 'fog_ruins'] },
  pines_snow_pair: { id: 'pines_snow_pair', width: 24, height: 57, drawWidth: 53, drawHeight: 114, cx: 0.5, tier: 'low', biomes: ['frozen_bridge'] },
  spruce_snow_b: { id: 'spruce_snow_b', width: 24, height: 68, drawWidth: 69, drawHeight: 136, cx: 0.5, tier: 'low', biomes: ['frozen_bridge'] },
  mound_snow: { id: 'mound_snow', width: 110, height: 87, drawWidth: 138, drawHeight: 92, cx: 0.5, tier: 'mid', biomes: ['frozen_bridge'] },
  arch_snow: { id: 'arch_snow', width: 135, height: 133, drawWidth: 150, drawHeight: 133, cx: 0.5, tier: 'tall', biomes: ['frozen_bridge'] },
  tomb_snow: { id: 'tomb_snow', width: 38, height: 78, drawWidth: 48, drawHeight: 82, cx: 0.5, tier: 'mid', biomes: ['frozen_bridge', 'graveyard'] },
  crate_snow: { id: 'crate_snow', width: 38, height: 51, drawWidth: 48, drawHeight: 54, cx: 0.5, tier: 'low', biomes: ['frozen_bridge'] },
  deadtree_snow_b: { id: 'deadtree_snow_b', width: 24, height: 64, drawWidth: 87, drawHeight: 128, cx: 0.5, tier: 'low', biomes: ['frozen_bridge'] },
  spruce_snow_c: { id: 'spruce_snow_c', width: 24, height: 74, drawWidth: 52, drawHeight: 147, cx: 0.5, tier: 'mid', biomes: ['frozen_bridge'] },
  pine_cluster_snow: { id: 'pine_cluster_snow', width: 24, height: 72, drawWidth: 100, drawHeight: 143, cx: 0.5, tier: 'mid', biomes: ['frozen_bridge'] },
  sapling_snow: { id: 'sapling_snow', width: 30, height: 64, drawWidth: 43, drawHeight: 92, cx: 0.5, tier: 'low', biomes: ['frozen_bridge'] },
  pillar_snow: { id: 'pillar_snow', width: 29, height: 107, drawWidth: 52, drawHeight: 107, cx: 0.5, tier: 'mid', biomes: ['frozen_bridge'] },
  gallows_snow: { id: 'gallows_snow', width: 88, height: 128, drawWidth: 98, drawHeight: 128, cx: 0.5, tier: 'mid', biomes: ['frozen_bridge'] },
  fence_snow: { id: 'fence_snow', width: 87, height: 67, drawWidth: 109, drawHeight: 74, cx: 0.5, tier: 'low', biomes: ['frozen_bridge', 'misty_pines'] },
  deadtree_fog: { id: 'deadtree_fog', width: 30, height: 80, drawWidth: 190, drawHeight: 161, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'fog_ruins', 'graveyard'] },
  shrine_gothic: { id: 'shrine_gothic', width: 58, height: 118, drawWidth: 72, drawHeight: 124, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'graveyard', 'fog_ruins'] },
  tomb_tall: { id: 'tomb_tall', width: 35, height: 115, drawWidth: 44, drawHeight: 121, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'graveyard', 'fog_ruins'] },
  pine_frost: { id: 'pine_frost', width: 24, height: 75, drawWidth: 48, drawHeight: 150, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'fog_ruins', 'frozen_bridge'] },
  angel_dark: { id: 'angel_dark', width: 56, height: 142, drawWidth: 70, drawHeight: 150, cx: 0.5, tier: 'tall', biomes: ['blood_keep', 'graveyard', 'fog_ruins'] },
  tombs_pair: { id: 'tombs_pair', width: 74, height: 120, drawWidth: 92, drawHeight: 126, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'graveyard', 'fog_ruins'] },
  gate_spiked: { id: 'gate_spiked', width: 150, height: 139, drawWidth: 167, drawHeight: 139, cx: 0.5, tier: 'tall', biomes: ['blood_keep', 'fog_ruins'] },
  banner_dark: { id: 'banner_dark', width: 26, height: 146, drawWidth: 48, drawHeight: 146, cx: 0.5, tier: 'tall', biomes: ['blood_keep', 'fog_ruins'] },
  arch_dark: { id: 'arch_dark', width: 102, height: 146, drawWidth: 113, drawHeight: 146, cx: 0.5, tier: 'tall', biomes: ['blood_keep', 'fog_ruins', 'graveyard'] },
  lamp_post: { id: 'lamp_post', width: 26, height: 121, drawWidth: 48, drawHeight: 121, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'fog_ruins', 'hamlet_ruins'] },
  chapel_lit: { id: 'chapel_lit', width: 164, height: 159, drawWidth: 182, drawHeight: 159, cx: 0.5, tier: 'tall', biomes: ['blood_keep', 'fog_ruins'] },
  wood_stand: { id: 'wood_stand', width: 49, height: 119, drawWidth: 61, drawHeight: 132, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'fog_ruins'] },
  flame_pedestal: { id: 'flame_pedestal', width: 25, height: 137, drawWidth: 46, drawHeight: 137, cx: 0.5, tier: 'tall', biomes: ['blood_keep', 'fog_ruins', 'graveyard'] },
  cross_big: { id: 'cross_big', width: 26, height: 92, drawWidth: 48, drawHeight: 92, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'graveyard', 'fog_ruins'] },
  gate_wide: { id: 'gate_wide', width: 212, height: 150, drawWidth: 236, drawHeight: 150, cx: 0.5, tier: 'tall', biomes: ['blood_keep', 'fog_ruins'] },
  cliff_snow_small: { id: 'cliff_snow_small', width: 106, height: 132, drawWidth: 132, drawHeight: 139, cx: 0.5, tier: 'tall', biomes: ['frozen_bridge', 'fog_ruins'] },
  banner_red: { id: 'banner_red', width: 24, height: 102, drawWidth: 37, drawHeight: 102, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'hamlet_ruins', 'fog_ruins'] },
  gallows_cage: { id: 'gallows_cage', width: 91, height: 87, drawWidth: 101, drawHeight: 87, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'fog_ruins'] },
  crates_stack: { id: 'crates_stack', width: 66, height: 66, drawWidth: 83, drawHeight: 70, cx: 0.5, tier: 'low', biomes: ['blood_keep', 'hamlet_ruins', 'fog_ruins', 'frozen_bridge'] },
  cage_hanger: { id: 'cage_hanger', width: 30, height: 89, drawWidth: 55, drawHeight: 89, cx: 0.5, tier: 'mid', biomes: ['blood_keep', 'fog_ruins'] },
  rock_golem: { id: 'rock_golem', width: 101, height: 50, drawWidth: 126, drawHeight: 53, cx: 0.5, tier: 'low', biomes: ['fog_ruins', 'blood_keep'] },
};

/** Bloque de tierra con el que cada bioma arma sus plataformas y gradas. */
export const TERRAIN_OF: Readonly<Record<ArenaId, 'dark' | 'desert' | 'grass' | 'snow'>> = {
  hamlet_ruins: 'grass',
  graveyard: 'grass',
  ember_desert: 'desert',
  misty_pines: 'grass',
  frozen_bridge: 'snow',
  blood_keep: 'dark',
  fog_ruins: 'dark',
};
