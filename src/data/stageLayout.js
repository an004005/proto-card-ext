// Fixed 10-floor stage structure (기획서 §13, §14 층별 배치, 13전투). Unlike the old
// mapEngine's branching graph, floors here are a straight linear sequence — the only player
// choice is whether to step into an optional "미지의 방" (unknown room) at floors 3/6/9.
// No RNG needed to build this: it's identical every run.
export const STAGE_STEPS = [
  { floor: 1, type: 'combat', monsterIds: ['nibbit', 'nibbit'] },
  { floor: 2, type: 'combat', monsterIds: ['shrinker_beetle'] },
  { floor: 2, type: 'combat', monsterIds: ['inklet', 'inklet', 'inklet'] },
  { floor: 3, type: 'unknown_room' },
  { floor: 3, type: 'combat', monsterIds: ['raider'] },
  { floor: 4, type: 'combat', monsterIds: ['vine_shambler'] },
  { floor: 5, type: 'combat', monsterIds: ['bygone_effigy'], tier: 'elite' },
  { floor: 6, type: 'unknown_room' },
  { floor: 6, type: 'combat', monsterIds: ['inklet', 'inklet', 'inklet', 'shrinker_beetle'] },
  { floor: 6, type: 'combat', monsterIds: ['vine_shambler'] },
  { floor: 7, type: 'combat', monsterIds: ['mawler'] },
  { floor: 7, type: 'combat', monsterIds: ['byrdonis'], tier: 'elite' },
  { floor: 8, type: 'unknown_room' },
  { floor: 8, type: 'combat', monsterIds: ['fogmog'] },
  { floor: 9, type: 'combat', monsterIds: ['bygone_effigy'], tier: 'elite', hpMultiplier: 1.1 },
  { floor: 10, type: 'combat', monsterIds: ['ceremonial_beast'], tier: 'boss' },
];

// 미지의 방 결과 분포 (§13.1): 전투 30% / 휴식 30% / 빈 방 40%.
export const UNKNOWN_ROOM_OUTCOME_WEIGHTS = [
  { value: 'combat', weight: 0.3 },
  { value: 'rest', weight: 0.3 },
  { value: 'empty', weight: 0.4 },
];
