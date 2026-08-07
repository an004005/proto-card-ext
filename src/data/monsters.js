// Monster definitions — 1막 과성장지 로스터. Move shape mirrors card effects: { id, damage,
// effects: [...] }. `effects` reuse the same interpreter as cards (target 'self'|'player').
// A sequence entry may instead be `{ random: [{ weight, move }, ...] }` — resolved once (see
// monsterAI.js) so the displayed intent always matches what actually executes.
// tier: 'normal' | 'elite' | 'boss' | 'minion'. 'minion' monsters are never assigned to a map
// node directly — they only ever appear via another monster's `move.summon`.

/** @typedef {import('../engine/types.js').MonsterDef} MonsterDef */

/** @type {Object.<string, MonsterDef>} */
export const MONSTER_DEFINITIONS = {
  // ---- 일반 ----
  nibbit: {
    id: 'nibbit', name: '니빗', hp: 44, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'headbutt', damage: 12 },
      { id: 'slice', damage: 6, effects: [{ kind: 'block', value: 5, target: 'self' }] },
      { id: 'hiss', damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
    ],
  },
  shrinker_beetle: {
    id: 'shrinker_beetle', name: '자폭충', hp: 39, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'weaken', damage: 0, effects: [{ kind: 'applyStatus', status: 'weak', amount: 1, target: 'player' }] },
      { id: 'bite', damage: 7 },
      { id: 'stomp', damage: 13 },
    ],
  },
  inklet: {
    id: 'inklet', name: '잉클릿', hp: 14, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'jab', damage: 3 },
      { random: [
        { weight: 50, move: { id: 'snipe', damage: 10 } },
        { weight: 50, move: { id: 'whirl', damage: 2, hits: 3 } },
      ] },
    ],
  },
  vine_shambler: {
    id: 'vine_shambler', name: '덩굴 셰임블러', hp: 61, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'push', damage: 6, hits: 2 },
      { id: 'wrap', damage: 8, effects: [{ kind: 'applyStatus', status: 'entangled', amount: 1, target: 'player' }] },
      { id: 'bite', damage: 16 },
    ],
  },
  mawler: {
    id: 'mawler', name: '마울러', hp: 72, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'rip', damage: 4, hits: 2 },
      { random: [
        { weight: 33, move: { id: 'rampage', damage: 14 } },
        { weight: 33, move: { id: 'roar', damage: 0, effects: [{ kind: 'applyStatus', status: 'vulnerable', amount: 3, target: 'player' }] } },
        { weight: 34, move: { id: 'rip2', damage: 4, hits: 2 } },
      ] },
    ],
  },
  fogmog: {
    id: 'fogmog', name: '포그모그', hp: 74, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'spore_summon', damage: 0, summon: 'sawtooth_eye' },
      { random: [
        { weight: 40, move: { id: 'slap', damage: 8, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 1, target: 'self' }] } },
        { weight: 60, move: { id: 'headbutt2', damage: 14 } },
      ] },
    ],
  },
  snapping_jaxfruit: {
    id: 'snapping_jaxfruit', name: '포식성 잭스프루트', hp: 32, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'energy_orb', damage: 3, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
    ],
  },
  slithering_strangler: {
    id: 'slithering_strangler', name: '미끈거리는 교살마', hp: 54, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'constrict_grip', damage: 0, effects: [{ kind: 'applyStatus', status: 'constrict', amount: 1, target: 'player' }] },
      { random: [
        { weight: 50, move: { id: 'coil', damage: 7, effects: [{ kind: 'block', value: 5, target: 'self' }] } },
        { weight: 50, move: { id: 'bite2', damage: 12 } },
      ] },
    ],
  },
  cubex_construct: {
    id: 'cubex_construct', name: '큐브형 구조체', hp: 65, isMachine: true, tier: 'normal',
    sequence: [
      { id: 'charge', damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
      { id: 'burst1', damage: 7, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
      { id: 'burst2', damage: 7, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
      { id: 'release', damage: 5, hits: 2 },
    ],
  },
  flyconid: {
    id: 'flyconid', name: '날개버섯', hp: 48, isMachine: false, tier: 'normal',
    sequence: [
      { random: [
        { weight: 50, move: { id: 'wither_spore', damage: 8, effects: [{ kind: 'applyStatus', status: 'fragile', amount: 2, target: 'player' }] } },
        { weight: 50, move: { id: 'slap3', damage: 11 } },
      ] },
      { id: 'vulnerable_spore', damage: 0, effects: [{ kind: 'applyStatus', status: 'vulnerable', amount: 2, target: 'player' }] },
    ],
  },
  fuzzy_wurm_crawler: {
    id: 'fuzzy_wurm_crawler', name: '복슬지렁이', hp: 56, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'acid', damage: 4 },
      { id: 'drain', damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 7, target: 'self' }] },
      { id: 'acid2', damage: 4 },
    ],
  },
  leaf_slime_m: {
    id: 'leaf_slime_m', name: '나뭇잎 슬라임', hp: 33, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'goo', damage: 0, insertCurse: 'sticky_curse' },
      { id: 'thorn', damage: 8 },
    ],
  },
  twig_slime_m: {
    id: 'twig_slime_m', name: '가지 슬라임', hp: 27, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'goo2', damage: 0, insertCurse: 'sticky_curse' },
      { random: [
        { weight: 50, move: { id: 'pounce', damage: 11 } },
        { weight: 50, move: { id: 'goo3', damage: 0, insertCurse: 'sticky_curse' } },
      ] },
    ],
  },

  // ---- 엘리트 ----
  bygone_effigy: {
    id: 'bygone_effigy', name: '낡은 석상', hp: 128, isMachine: true, tier: 'elite',
    phaseTransitionHpFraction: 0.5,
    sequence: [
      { id: 'sleep', damage: 0 },
      { id: 'awaken', damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 10, target: 'self' }] },
      { id: 'slash', damage: 13 },
    ],
    phase2Sequence: [
      { id: 'sleep2', damage: 0 },
      { id: 'slash2', damage: 13 },
    ],
  },
  byrdonis: {
    id: 'byrdonis', name: '맹금 바이도니스', hp: 82, isMachine: false, tier: 'elite',
    sequence: [
      { id: 'strike', damage: 17 },
      { id: 'peck', damage: 3, hits: 3 },
    ],
  },
  phrog_parasite: {
    id: 'phrog_parasite', name: '게구리 기생체', hp: 62, isMachine: false, tier: 'elite',
    sequence: [
      { id: 'infect', damage: 0, insertCurse: 'infected_curse' },
      { id: 'smash3', damage: 4, hits: 4 },
    ],
  },

  // ---- 보스 (매 런 무작위 1종, mapLayout.BOSS_ENCOUNTER_TEMPLATES) ----
  ceremonial_beast: {
    id: 'ceremonial_beast', name: '의식의 짐승', hp: 252, isMachine: false, tier: 'boss',
    phaseTransitionHpFraction: 150 / 252,
    sequence: [
      { id: 'stomp_charge', damage: 0, effects: [{ kind: 'block', value: 10, target: 'self' }] },
      { id: 'dig', damage: 18, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
      { id: 'dig2', damage: 18 },
    ],
    phase2Sequence: [
      { id: 'stun_self', damage: 0 },
      { id: 'roar2', damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 1, target: 'self' }] },
      { id: 'stomp2', damage: 15 },
      { id: 'crush', damage: 17, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 3, target: 'self' }] },
    ],
  },
  kin_follower: {
    id: 'kin_follower', name: '혈족 추종자', hp: 58, isMachine: false, tier: 'boss',
    sequence: [
      { id: 'quickstrike', damage: 5 },
      { id: 'boomerang', damage: 2, hits: 2 },
      { id: 'power_dance', damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
    ],
  },
  kin_priest: {
    id: 'kin_priest', name: '혈족 사제', hp: 190, isMachine: false, tier: 'boss',
    sequence: [
      { id: 'frailty_orb', damage: 8, effects: [{ kind: 'applyStatus', status: 'fragile', amount: 2, target: 'player' }] },
      { id: 'weakness_orb', damage: 8, effects: [{ kind: 'applyStatus', status: 'weak', amount: 1, target: 'player' }] },
      { id: 'soul_beam', damage: 3, hits: 3 },
      { id: 'dark_ritual', damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
    ],
  },
  vantom: {
    id: 'vantom', name: '밴텀', hp: 173, isMachine: false, tier: 'boss',
    sequence: [
      { id: 'ink_throw', damage: 7 },
      { id: 'ink_spear', damage: 6, hits: 2 },
      { id: 'dismember', damage: 26, effects: [{ kind: 'applyStatus', status: 'vulnerable', amount: 1, target: 'player' }] },
      { id: 'prepare', damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
    ],
  },

  // ---- 하수인 (다른 몬스터의 move.summon으로만 등장, 맵 노드에 직접 배정되지 않음) ----
  sawtooth_eye: {
    id: 'sawtooth_eye', name: '톱니눈', hp: 6, isMachine: false, tier: 'minion',
    sequence: [
      { id: 'dizzy_spores', damage: 0, insertCurse: 'dizziness_curse', insertCurseCount: 2 },
    ],
  },
};
