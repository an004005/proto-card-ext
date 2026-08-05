// Monster definitions (기획서 §14). Unlike the old STS-style AI, none of these patterns are
// described as random in the doc — every monster is a fixed, looping scripted sequence, and
// HP values are single fixed numbers (no range), so monster spawning needs no RNG at all.
//
// Move shape mirrors card effects: { id, damage, effects: [...] }. `effects` reuse the same
// interpreter as cards (target 'self'|'player'). Special per-monster mechanics (armor floor,
// double action, phase transition) are flagged on the definition and handled in combatEngine.

export const MONSTER_DEFINITIONS = {
  nibbit: {
    id: 'nibbit', name: '니빗', hp: 13, isMachine: false, tier: 'normal',
    // 개체별 교대: 한 마리가 물 때 다른 한 마리는 웅크림 — pairIndex controls starting phase.
    sequence: [
      { id: 'bite', damage: 6 },
      { id: 'curl', damage: 0, effects: [{ kind: 'block', value: 5, target: 'self' }] },
    ],
  },
  shrinker_beetle: {
    id: 'shrinker_beetle', name: '자폭충', hp: 16, isMachine: false, tier: 'normal',
    // 2턴 격파 퍼즐: 부풀기 -> 방3 -> 폭발(자멸). explode 이후 자멸하므로 sequence는 반복하지 않음.
    sequence: [
      { id: 'puff', damage: 0, effects: [{ kind: 'block', value: 3, target: 'self' }] },
      { id: 'inflate', damage: 0, effects: [{ kind: 'block', value: 3, target: 'self' }] },
      { id: 'explode', damage: 18, selfDestruct: true },
    ],
    loop: false,
  },
  inklet: {
    id: 'inklet', name: '잉클릿', hp: 10, isMachine: false, tier: 'normal',
    // 달라붙기(공격) 또는 오염(점액 저주 카드를 상대 버림더미에 삽입) 교대.
    sequence: [
      { id: 'cling', damage: 3 },
      { id: 'infect', damage: 0, insertCurse: 'mucus_curse' },
    ],
  },
  raider: {
    id: 'raider', name: '좀도둑', hp: 22, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'stab', damage: 7 },
      { id: 'pickpocket', damage: 0, stealCurrency: true },
      { id: 'flee', damage: 0, flee: true },
    ],
    loop: false,
  },
  vine_shambler: {
    id: 'vine_shambler', name: '덩굴 셰임블러', hp: 48, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'wrap', damage: 8 },
      { id: 'spore', damage: 0, effects: [{ kind: 'applyStatus', status: 'weak', amount: 1, target: 'player' }] },
      { id: 'smash', damage: 12 },
    ],
  },
  mawler: {
    id: 'mawler', name: '마울러', hp: 65, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'bite', damage: 12 },
      { id: 'grind_teeth', damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 2, target: 'self' }] },
      { id: 'swallow', damage: 16 },
    ],
  },
  fogmog: {
    id: 'fogmog', name: '포그모그', hp: 70, isMachine: false, tier: 'normal',
    sequence: [
      { id: 'fog', damage: 0, effects: [{ kind: 'applyStatus', status: 'weak', amount: 2, target: 'player' }] },
      { id: 'sit', damage: 6, effects: [{ kind: 'block', value: 8, target: 'self' }] },
      { id: 'smash', damage: 14 },
    ],
  },
  bygone_effigy: {
    id: 'bygone_effigy', name: '낡은 석상', hp: 90, isMachine: true, tier: 'elite', standingArmor: 3,
    sequence: [
      { id: 'grasp', damage: 14 },
      { id: 'gaze', damage: 0, effects: [{ kind: 'applyStatus', status: 'vulnerable', amount: 2, target: 'player' }] },
      { id: 'guard', damage: 0, effects: [{ kind: 'block', value: 12, target: 'self' }] },
    ],
  },
  byrdonis: {
    id: 'byrdonis', name: '맹금 바이도니스', hp: 80, isMachine: false, tier: 'elite',
    doubleActionIfPlayerHasBurden: true,
    sequence: [
      { id: 'dive', damage: 9 },
      { id: 'peck', damage: 5, hits: 2 },
      { id: 'glide', damage: 0, effects: [{ kind: 'block', value: 8, target: 'self' }] },
    ],
  },
  ceremonial_beast: {
    id: 'ceremonial_beast', name: '의식의 짐승', hp: 170, isMachine: false, tier: 'boss',
    phaseTransitionHpFraction: 0.5, phaseTransitionInsertCurse: 'offering_curse', phaseTransitionInsertCount: 3,
    sequence: [
      { id: 'smash', damage: 14 },
      { id: 'roar', damage: 0, effects: [{ kind: 'applyStatus', status: 'atkBonus', amount: 3, target: 'self' }] },
      { id: 'guard', damage: 0, effects: [{ kind: 'block', value: 12, target: 'self' }] },
    ],
    phase2Sequence: [
      { id: 'smash2', damage: 18 },
      { id: 'double_strike', damage: 8, hits: 2 },
    ],
  },
};
