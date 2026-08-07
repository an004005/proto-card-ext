// Procedural branching map (replaces the old fixed 10-floor linear STAGE_STEPS). 8 floors:
// 1~7 are player-chosen node graphs, 8 is a single boss node. Node types stay fully visible
// (no fog of war) — only reachability (available vs not) changes as the player advances.
export const MAP_FLOOR_COUNT = 8;
export const NODES_PER_FLOOR_MIN = 2;
export const NODES_PER_FLOOR_MAX = 4;

/** @type {{value: string, weight: number}[]} */
export const NODE_TYPE_WEIGHTS = [
  { value: 'combat', weight: 55 },
  { value: 'unknown', weight: 20 },
  { value: 'rest', weight: 15 },
  { value: 'elite', weight: 10 },
];

// Floor-level constraints (1-indexed floors, applied to floors 1..7 — floor 8 is boss-only).
export const ELITE_MIN_FLOOR = 3;
export const ELITE_MAX_FLOOR = 6;
export const ELITE_MAX_PER_FLOOR = 1;
export const UNKNOWN_MAX_PER_FLOOR = 1;
export const REST_MAX_PER_FLOOR = 1;

// Encounter templates — 1막 과성장지 로스터(§ monsters.js) 조합. tier 'normal' -> combat 노드,
// 'elite' -> elite 노드. 미끈거리는 교살마는 포식성 잭스프루트와만 짝지어 등장(사용자 지정).
/** @type {{normal: string[][], elite: string[][]}} */
export const MAP_ENCOUNTER_TEMPLATES = {
  normal: [
    ['nibbit', 'nibbit'],
    ['inklet', 'inklet', 'inklet'],
    ['shrinker_beetle'],
    ['shrinker_beetle', 'fuzzy_wurm_crawler'],
    ['mawler'],
    ['vine_shambler'],
    ['fogmog'],
    ['slithering_strangler', 'snapping_jaxfruit'],
    ['flyconid', 'leaf_slime_m'],
    ['leaf_slime_m', 'twig_slime_m'],
    ['cubex_construct'],
  ],
  elite: [
    ['bygone_effigy'],
    ['byrdonis'],
    ['phrog_parasite'],
  ],
};

// 매 런 보스 노드 생성 시 이 중 하나를 무작위로 선택(mapEngine.generateMap).
/** @type {string[][]} */
export const BOSS_ENCOUNTER_TEMPLATES = [
  ['ceremonial_beast'],
  ['kin_follower', 'kin_priest'],
  ['vantom'],
];

// 맵의 휴식 노드 (§1 항목 1) — 미지의 방 안 휴식(10%)보다 더 후한, 안전한 목적지형 휴식.
export const MAP_REST_HP_RESTORE_PERCENT = 0.3;
