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
    id: 'nibbit', name: '니빗', hp: 44, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'headbutt', mapNoise: 1, damage: 12 },
      { id: 'slice', mapNoise: 1, damage: 6, effects: [{ kind: 'block', value: 5, target: 'self' }] },
      { id: 'hiss', mapNoise: 0, damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
    ],
  },
  shrinker_beetle: {
    id: 'shrinker_beetle', name: '자폭충', hp: 39, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'weaken', mapNoise: 0, damage: 0, effects: [{ kind: 'applyStatus', status: 'weak', amount: 1, target: 'player' }] },
      { id: 'bite', mapNoise: 1, damage: 7 },
      { id: 'stomp', mapNoise: 1, damage: 13 },
    ],
  },
  inklet: {
    id: 'inklet', name: '잉클릿', hp: 14, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'jab', mapNoise: 1, damage: 3 },
      { random: [
        { weight: 50, move: { id: 'snipe', mapNoise: 2, damage: 10 } },
        { weight: 50, move: { id: 'whirl', mapNoise: 1, damage: 2, hits: 3 } },
      ] },
    ],
  },
  vine_shambler: {
    id: 'vine_shambler', name: '덩굴 셰임블러', hp: 61, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'push', mapNoise: 1, damage: 6, hits: 2 },
      { id: 'wrap', mapNoise: 1, damage: 8, effects: [{ kind: 'applyStatus', status: 'entangled', amount: 1, target: 'player' }] },
      { id: 'bite', mapNoise: 1, damage: 16 },
    ],
  },
  mawler: {
    id: 'mawler', name: '마울러', hp: 72, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'rip', mapNoise: 1, damage: 4, hits: 2 },
      { random: [
        { weight: 33, move: { id: 'rampage', mapNoise: 1, damage: 14 } },
        { weight: 33, move: { id: 'roar', mapNoise: 0, damage: 0, effects: [{ kind: 'applyStatus', status: 'vulnerable', amount: 3, target: 'player' }] } },
        { weight: 34, move: { id: 'rip2', mapNoise: 1, damage: 4, hits: 2 } },
      ] },
    ],
  },
  fogmog: {
    id: 'fogmog', name: '포그모그', hp: 74, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'spore_summon', mapNoise: 0, damage: 0, summon: 'sawtooth_eye' },
      { random: [
        { weight: 40, move: { id: 'slap', mapNoise: 1, damage: 8, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 1, target: 'self' }] } },
        { weight: 60, move: { id: 'headbutt2', mapNoise: 1, damage: 14 } },
      ] },
    ],
  },
  snapping_jaxfruit: {
    id: 'snapping_jaxfruit', name: '포식성 잭스프루트', hp: 32, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'energy_orb', mapNoise: 2, damage: 3, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
    ],
  },
  slithering_strangler: {
    id: 'slithering_strangler', name: '미끈거리는 교살마', hp: 54, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'constrict_grip', mapNoise: 1, damage: 0, effects: [{ kind: 'applyStatus', status: 'constrict', amount: 3, target: 'player' }] },
      { random: [
        { weight: 50, move: { id: 'coil', mapNoise: 1, damage: 7, effects: [{ kind: 'block', value: 5, target: 'self' }] } },
        { weight: 50, move: { id: 'bite2', mapNoise: 1, damage: 12 } },
      ] },
    ],
  },
  cubex_construct: {
    id: 'cubex_construct', name: '큐브형 구조체', hp: 65, isMachine: true, tier: 'normal', perception: -1,
    startingStatuses: { artifact: 1 },
    sequence: [
      { id: 'charge', mapNoise: 0, damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
      { id: 'burst1', mapNoise: 2, damage: 7, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
      { id: 'burst2', mapNoise: 2, damage: 7, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
      { id: 'release', mapNoise: 2, damage: 5, hits: 2 },
    ],
  },
  flyconid: {
    id: 'flyconid', name: '날개버섯', hp: 48, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { random: [
        { weight: 50, move: { id: 'wither_spore', mapNoise: 1, damage: 8, effects: [{ kind: 'applyStatus', status: 'fragile', amount: 2, target: 'player' }] } },
        { weight: 50, move: { id: 'slap3', mapNoise: 1, damage: 11 } },
      ] },
      { id: 'vulnerable_spore', mapNoise: 1, damage: 0, effects: [{ kind: 'applyStatus', status: 'vulnerable', amount: 2, target: 'player' }] },
    ],
  },
  fuzzy_wurm_crawler: {
    id: 'fuzzy_wurm_crawler', name: '복슬지렁이', hp: 56, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'acid', mapNoise: 1, damage: 4 },
      { id: 'drain', mapNoise: 0, damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 7, target: 'self' }] },
      { id: 'acid2', mapNoise: 1, damage: 4 },
    ],
  },
  leaf_slime_m: {
    id: 'leaf_slime_m', name: '나뭇잎 슬라임', hp: 33, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'goo', mapNoise: 0, damage: 0, insertStatusCard: 'sticky_status_card' },
      { id: 'thorn', mapNoise: 1, damage: 8 },
    ],
  },
  twig_slime_m: {
    id: 'twig_slime_m', name: '가지 슬라임', hp: 27, isMachine: false, tier: 'normal', perception: -1,
    sequence: [
      { id: 'goo2', mapNoise: 0, damage: 0, insertStatusCard: 'sticky_status_card' },
      { random: [
        { weight: 50, move: { id: 'pounce', mapNoise: 1, damage: 11 } },
        { weight: 50, move: { id: 'goo3', mapNoise: 0, damage: 0, insertStatusCard: 'sticky_status_card' } },
      ] },
    ],
  },

  // ---- 엘리트 ----
  bygone_effigy: {
    id: 'bygone_effigy', name: '낡은 석상', hp: 128, isMachine: true, tier: 'elite', perception: 0,
    phaseTransitionHpFraction: 0.5,
    sequence: [
      { id: 'sleep', mapNoise: 0, damage: 0 },
      { id: 'awaken', mapNoise: 0, damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 10, target: 'self' }] },
      { id: 'slash', mapNoise: 1, damage: 13 },
    ],
    phase2Sequence: [
      { id: 'sleep2', mapNoise: 0, damage: 0 },
      { id: 'slash2', mapNoise: 1, damage: 13 },
    ],
  },
  byrdonis: {
    id: 'byrdonis', name: '맹금 바이도니스', hp: 82, isMachine: false, tier: 'elite', perception: 0,
    sequence: [
      { id: 'strike', mapNoise: 1, damage: 17 },
      { id: 'peck', mapNoise: 1, damage: 3, hits: 3 },
    ],
  },
  phrog_parasite: {
    id: 'phrog_parasite', name: '게구리 기생체', hp: 62, isMachine: false, tier: 'elite', perception: 0,
    sequence: [
      { id: 'infect', mapNoise: 0, damage: 0, insertStatusCard: 'infected_status_card' },
      { id: 'smash3', mapNoise: 1, damage: 4, hits: 4 },
    ],
  },

  // 경계도 3단계가 구역에 풀어놓는 개체(ADR-0092). 정예급보다 한 급 위다 — 조우 회피도
  // 속이기도 통하지 않으므로, 만나면 반드시 이 체력을 넘겨야 한다.
  hunter: {
    id: 'hunter', name: '추적자', hp: 55, isMachine: true, tier: 'elite', perception: 3,
    sequence: [
      { id: 'hunter_volley', mapNoise: 2, damage: 9, hits: 2 },
      { id: 'hunter_brace', mapNoise: 0, damage: 0, effects: [{ kind: 'block', value: 8, target: 'self' }] },
      { id: 'hunter_suppress', mapNoise: 1, damage: 6, effects: [{ kind: 'applyStatus', status: 'weak', amount: 2, target: 'player' }] },
    ],
  },

  // ---- 보스 (매 런 무작위 1종, mapLayout.BOSS_ENCOUNTER_TEMPLATES) ----
  ceremonial_beast: {
    id: 'ceremonial_beast', name: '의식의 짐승', hp: 252, isMachine: false, tier: 'boss', perception: 1,
    phaseTransitionHpFraction: 150 / 252,
    sequence: [
      { id: 'stomp_charge', mapNoise: 1, damage: 0, effects: [{ kind: 'block', value: 10, target: 'self' }] },
      { id: 'dig', mapNoise: 1, damage: 18, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
      { id: 'dig2', mapNoise: 1, damage: 18 },
    ],
    phase2Sequence: [
      { id: 'stun_self', mapNoise: 0, damage: 0 },
      { id: 'roar2', mapNoise: 2, damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 1, target: 'self' }] },
      { id: 'stomp2', mapNoise: 1, damage: 15 },
      { id: 'crush', mapNoise: 1, damage: 17, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 3, target: 'self' }] },
    ],
  },
  kin_follower: {
    id: 'kin_follower', name: '혈족 추종자', hp: 58, isMachine: false, tier: 'boss', perception: 1,
    sequence: [
      { id: 'quickstrike', mapNoise: 1, damage: 5 },
      { id: 'boomerang', mapNoise: 1, damage: 2, hits: 2 },
      { id: 'power_dance', mapNoise: 0, damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
    ],
  },
  kin_priest: {
    id: 'kin_priest', name: '혈족 사제', hp: 190, isMachine: false, tier: 'boss', perception: 1,
    sequence: [
      { id: 'frailty_orb', mapNoise: 2, damage: 8, effects: [{ kind: 'applyStatus', status: 'fragile', amount: 2, target: 'player' }] },
      { id: 'weakness_orb', mapNoise: 2, damage: 8, effects: [{ kind: 'applyStatus', status: 'weak', amount: 1, target: 'player' }] },
      { id: 'soul_beam', mapNoise: 2, damage: 3, hits: 3 },
      { id: 'dark_ritual', mapNoise: 0, damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
    ],
  },
  vantom: {
    id: 'vantom', name: '밴텀', hp: 173, isMachine: false, tier: 'boss', perception: 1,
    sequence: [
      { id: 'ink_throw', mapNoise: 1, damage: 7 },
      { id: 'ink_spear', mapNoise: 1, damage: 6, hits: 2 },
      { id: 'dismember', mapNoise: 1, damage: 26, effects: [{ kind: 'applyStatus', status: 'vulnerable', amount: 1, target: 'player' }] },
      { id: 'prepare', mapNoise: 0, damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
    ],
  },

  // ---- 하수인 (다른 몬스터의 move.summon으로만 등장, 맵 노드에 직접 배정되지 않음) ----
  sawtooth_eye: {
    id: 'sawtooth_eye', name: '톱니눈', hp: 6, isMachine: false, tier: 'minion', perception: -1,
    sequence: [
      { id: 'dizzy_spores', mapNoise: 1, damage: 0, insertStatusCard: 'dizziness_status_card', insertStatusCardCount: 2 },
    ],
  },
};
