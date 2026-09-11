// Card definitions for the Card Extraction ruleset (docs/card-extraction-reference.xlsx 카드 일람).
// Numbers are the 0단계 기준 values; scaling is applied at resolution time
// by overloadEngine.applyStageScale(), never baked into these numbers.
//
// Shape (plain cards): { id, name, type, attackKind, cost, ammoCost, exhausts,
//   scalesWithStage, overloadGain, effects: [...], description }
// Shape (module cards with a per-stage table): { id, name, type, attackKind, exhausts,
//   overloadGain, powerKind: 'variable'|'fixed'|null, stageTable: [ {cost, effects}×4 ],
//   requiresWeapon?, description }
//
// effect kinds: damage, block, applyStatus, applyStun, draw, discardRandomFromHand,
// activatePower, activateFixedPower, grantNextRangedBonus.

/** @typedef {import('../engine/types.js').CardDef} CardDef */

/** @type {Object.<string, CardDef>} */
export const CARD_DEFINITIONS = {
  // ---- 카타나 ----
  katana_slash: {
    id: 'katana_slash', name: '베기', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 6, attackKind: 'melee' }],
    description: '피해 6.',
    mapTags: { noise: 1, traits: ['melee'], disengageProgress: 0 },
  },
  katana_parry: {
    id: 'katana_parry', name: '튕겨내기', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [
      { kind: 'block', value: 8 },
      { kind: 'applyStatus', status: 'reflect', amount: 3, target: 'self' },
    ],
    description: '방어 8. 공격받으면 3 반사.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },

  // ---- 라이플 ----
  rifle_aim: {
    id: 'rifle_aim', name: '사격', type: 'attack', attackKind: 'ranged',
    cost: 0, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [{ kind: 'damage', value: 8, attackKind: 'ranged' }],
    description: '피해 8. 총알 1 소모.',
    mapTags: { noise: 2, traits: ['firearm'], disengageProgress: 0 },
  },
  rifle_suppress: {
    id: 'rifle_suppress', name: '제압사격', type: 'attack', attackKind: 'ranged',
    cost: 1, ammoCost: 3, exhausts: false, scalesWithStage: true, overloadGain: 10,
    effects: [{ kind: 'damage', value: 3, hits: 3, attackKind: 'ranged', target: 'all_enemies' }],
    description: '모든 적에게 피해 3을 3회. 총알 3 소모.',
    mapTags: { noise: 2, traits: ['firearm'], disengageProgress: 0 },
  },
  rifle_buttstock: {
    id: 'rifle_buttstock', name: '개머리판 타격', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 5, attackKind: 'melee' }, { kind: 'reload', count: 1 }],
    description: '피해 5. 1발 장전.',
    mapTags: { noise: 1, traits: ['melee'], disengageProgress: 0 },
  },

  // ---- 단검 ----
  rifle_tactical_reload: {
    id: 'rifle_tactical_reload', name: '전술 재장전', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'reload' }, { kind: 'draw', count: 1 }],
    description: '최대 장전량까지 재장전하고 카드 1장 드로우.',
    mapTags: { noise: 1, traits: ['firearm'], disengageProgress: 0 },
  },

  dagger_weak_slash: {
    id: 'dagger_weak_slash', name: '약한 베기', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 4, attackKind: 'melee' }],
    description: '피해 4.',
    mapTags: { noise: 0, traits: ['melee', 'assassination'], disengageProgress: 0 },
  },
  dagger_stab: {
    id: 'dagger_stab', name: '찌르기', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [
      { kind: 'damage', value: 9, attackKind: 'melee' },
      { kind: 'applyStatus', status: 'vulnerable', amount: 1, target: 'self' },
    ],
    description: '피해 9. 자신에게 취약 1턴.',
    mapTags: { noise: 0, traits: ['melee', 'assassination'], disengageProgress: 0 },
  },

  // ---- 권총 ----
  pistol_shot: {
    id: 'pistol_shot', name: '단발사격', type: 'attack', attackKind: 'ranged',
    cost: 0, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 6, attackKind: 'ranged' }],
    description: '피해 6. 총알 1 소모.',
    mapTags: { noise: 1, traits: ['firearm'], disengageProgress: 0 },
  },

  // ---- 공용 (총기 전용, §신규 재장전) ----
  // ---- 자동권총 ----
  auto_pistol_shot: {
    id: 'auto_pistol_shot', name: '사격', type: 'attack', attackKind: 'ranged',
    cost: 0, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 5, attackKind: 'ranged' }],
    description: '피해 5. 총알 1 소모.', mapTags: { noise: 1, traits: ['firearm'], disengageProgress: 0 },
  },
  auto_pistol_mozambique: {
    id: 'auto_pistol_mozambique', name: '모잠비크 드릴', type: 'attack', attackKind: 'ranged',
    cost: 1, ammoCost: 3, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [{ kind: 'damage', value: 4, hits: 3, attackKind: 'ranged' }],
    description: '피해 4를 3회. 총알 3 소모.', mapTags: { noise: 2, traits: ['firearm'], disengageProgress: 0 },
  },

  // ---- 리볼버 ----
  revolver_headshot: {
    id: 'revolver_headshot', name: '헤드샷', type: 'attack', attackKind: 'ranged',
    cost: 1, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [{ kind: 'damage', value: 12, attackKind: 'ranged', ignoresBlock: true }],
    description: '방어도를 무시하고 피해 12. 총알 1 소모.', mapTags: { noise: 1, traits: ['firearm'], disengageProgress: 0 },
  },
  revolver_last_round: {
    id: 'revolver_last_round', name: '마지막 한 발', type: 'attack', attackKind: 'ranged',
    cost: 1, ammoCost: 1, requiresLoadedAtMost: 1, exhausts: false, scalesWithStage: true, overloadGain: 10,
    effects: [{ kind: 'damage', value: 20, attackKind: 'ranged', ignoresBlock: true }],
    description: '장전된 총알이 정확히 1발 이하일 때만 사용. 방어도를 무시하고 피해 20.', mapTags: { noise: 2, traits: ['firearm'], disengageProgress: 0 },
  },
  revolver_quickdraw: {
    id: 'revolver_quickdraw', name: '퀵드로우', type: 'attack', attackKind: 'ranged',
    cost: 0, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 6, attackKind: 'ranged' }, { kind: 'reload', count: 1 }, { kind: 'draw', count: 1 }],
    description: '피해 6. 총알 1 소모 후 1발 장전하고 카드 1장 드로우.', mapTags: { noise: 1, traits: ['firearm'], disengageProgress: 0 },
  },

  // ---- 샷건 ----
  shotgun_birdshot: {
    id: 'shotgun_birdshot', name: '버드샷', type: 'attack', attackKind: 'ranged',
    cost: 0, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 3, hits: 4, attackKind: 'ranged' }],
    description: '피해 3을 4회. 총알 1 소모.', mapTags: { noise: 2, traits: ['firearm'], disengageProgress: 0 },
  },
  shotgun_buckshot: {
    id: 'shotgun_buckshot', name: '벅샷', type: 'attack', attackKind: 'ranged',
    cost: 1, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [{ kind: 'damage', value: 7, hits: 2, attackKind: 'ranged' }],
    description: '피해 7을 2회. 총알 1 소모.', mapTags: { noise: 2, traits: ['firearm'], disengageProgress: 0 },
  },
  shotgun_slugshot: {
    id: 'shotgun_slugshot', name: '슬러그샷', type: 'attack', attackKind: 'ranged',
    cost: 1, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [{ kind: 'damage', value: 16, attackKind: 'ranged' }],
    description: '피해 16. 총알 1 소모.', mapTags: { noise: 2, traits: ['firearm'], disengageProgress: 0 },
  },

  // ---- 로켓런처 / 저격총 ----
  rocket_launch: {
    id: 'rocket_launch', name: '로켓 발사', type: 'attack', attackKind: 'ranged',
    cost: 2, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 15,
    effects: [{ kind: 'damage', value: 30, target: 'all_enemies', attackKind: 'ranged', scalesBy: 'loadedAmmo', scalesByAmount: -2 }],
    description: '모든 적에게 피해 30. 발사 뒤 남은 장전 탄약 1발당 피해가 2 감소. 총알 1 소모.', mapTags: { noise: 3, traits: ['firearm', 'explosive'], disengageProgress: 0 },
  },
  sniper_aim: {
    id: 'sniper_aim', name: '조준', type: 'skill', attackKind: null,
    cost: 0, exhausts: false, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'grantNextRangedBonus', amount: 8, ignoresBlock: true }],
    description: '다음 원거리 공격의 피해 +8, 방어도 무시.', mapTags: { noise: 0, traits: ['firearm'], disengageProgress: 0 },
  },
  sniper_shot: {
    id: 'sniper_shot', name: '정밀 사격', type: 'attack', attackKind: 'ranged',
    cost: 1, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [{ kind: 'damage', value: 16, attackKind: 'ranged' }],
    description: '피해 16. 총알 1 소모.', mapTags: { noise: 2, traits: ['firearm'], disengageProgress: 0 },
  },

  // ---- 사이버웨어 ----
  sandevistan_overclock: {
    id: 'sandevistan_overclock', name: '산데비스탄 가속', type: 'power', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: false, overloadGain: 10,
    effects: [{ kind: 'activatePower', power: 'sandevistan' }],
    description: '전투 중 지속. 매 턴 에너지 +1.', mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  mantis_blades_deploy: {
    id: 'mantis_blades_deploy', name: '맨티스 블레이드 전개', type: 'power', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: false, overloadGain: 5,
    effects: [{ kind: 'activatePower', power: 'mantisBlades' }],
    description: '전투 중 지속. 매 턴 시작 시 0코스트 맨티스 블레이드 베기를 패에 추가.', mapTags: { noise: 0, traits: ['melee'], disengageProgress: 0 },
  },
  mantis_blade_slash: {
    id: 'mantis_blade_slash', name: '맨티스 블레이드 베기', type: 'attack', attackKind: 'melee',
    cost: 0, exhausts: true, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 9, attackKind: 'melee' }],
    description: '피해 9. 사용 후 소멸.', mapTags: { noise: 1, traits: ['melee'], disengageProgress: 0 },
  },

  reload: {
    id: 'reload', name: '재장전', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'reload' }],
    description: '예비 탄약에서 최대 장전수까지 장전.',
    mapTags: { noise: 1, traits: ['firearm'], disengageProgress: 0 },
  },

  // ---- 중갑상의 ----
  heavy_top_dodge: {
    id: 'heavy_top_dodge', name: '회피', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 6 }],
    description: '방어 6.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  heavy_top_block: {
    id: 'heavy_top_block', name: '막기', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 9 }],
    description: '방어 9.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  heavy_top_status_card: {
    id: 'heavy_top_status_card', name: '과적', type: 'status_card', attackKind: null,
    cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '1코 소멸 (효과 없음). 이 전투에서만 제외 — 다음 전투에 복귀.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },

  // ---- 경갑상의 ----
  light_top_dodge: {
    id: 'light_top_dodge', name: '회피', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 6 }],
    description: '방어 6.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  light_top_deflect: {
    id: 'light_top_deflect', name: '흘려내기', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 8 }, { kind: 'draw', count: 1 }],
    description: '방어 8. 카드 1장 드로우.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },

  // ---- 전술하의 ----
  tactical_bottom_feint: {
    id: 'tactical_bottom_feint', name: '기만', type: 'attack', attackKind: null,
    cost: 0, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [
      { kind: 'damage', value: 3, attackKind: null },
      { kind: 'applyStatus', status: 'weak', amount: 1, target: 'enemy' },
    ],
    description: '피해 3, 약화 1턴 부여.',
    mapTags: { noise: 0, traits: ['deception'], disengageProgress: 1 },
  },
  tactical_bottom_dash: {
    id: 'tactical_bottom_dash', name: '질주', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'discardRandomFromHand' }, { kind: 'block', value: 9 }],
    description: '무작위로 1장 버리고 방어 9.',
    mapTags: { noise: 0, traits: ['escape'], disengageProgress: 1 },
  },
  tactical_bottom_dodge: {
    id: 'tactical_bottom_dodge', name: '회피', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 6 }],
    description: '방어 6.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },

  // ---- 중장하의 ----
  heavy_bottom_support: {
    id: 'heavy_bottom_support', name: '지지', type: 'skill', attackKind: null,
    cost: 2, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [{ kind: 'block', value: 16 }],
    description: '방어 16.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  heavy_bottom_shove: {
    id: 'heavy_bottom_shove', name: '밀쳐내기', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 5 }, { kind: 'damage', value: 5, attackKind: 'melee' }],
    description: '방어 5, 피해 5.',
    mapTags: { noise: 1, traits: ['melee', 'escape'], disengageProgress: 1 },
  },
  heavy_bottom_status_card: {
    id: 'heavy_bottom_status_card', name: '과적', type: 'status_card', attackKind: null,
    cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '1코 소멸 (효과 없음). 이 전투에서만 제외 — 다음 전투에 복귀.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },

  // ---- 모듈 1: 신경 강화 (파워·가변) ----
  module_neural_boost: {
    id: 'module_neural_boost', name: '신경 강화', type: 'power', attackKind: null,
    cost: 1, exhausts: false, overloadGain: 10, powerKind: 'variable', power: 'neuralBoost',
    effects: [{ kind: 'activatePower', power: 'neuralBoost' }],
    description: '방어력 버프 활성화 (매턴 현재 과부화 단계 기준으로 재계산).',
    mapTags: { noise: 0, traits: ['electronic'], disengageProgress: 0 },
  },

  // ---- 모듈 2: 신체 강화 (파워·가변 + 돌진 베기 고정) ----
  module_body_boost: {
    id: 'module_body_boost', name: '신체 강화', type: 'power', attackKind: null,
    cost: 1, exhausts: false, overloadGain: 10, powerKind: 'variable', power: 'bodyBoost',
    effects: [{ kind: 'activatePower', power: 'bodyBoost' }],
    description: '근접 공격력 버프 활성화 (매턴 현재 과부화 단계 기준으로 재계산).',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  module_charge_slash: {
    id: 'module_charge_slash', name: '돌진 베기', type: 'attack', attackKind: 'melee',
    exhausts: false, overloadGain: 10, requiresWeapon: 'katana',
    stageTable: [
      { cost: 2, effects: [{ kind: 'damage', value: 10, attackKind: 'melee' }, { kind: 'block', value: 10 }] },
      { cost: 2, effects: [{ kind: 'damage', value: 15, attackKind: 'melee' }, { kind: 'block', value: 15 }] },
      { cost: 3, effects: [{ kind: 'damage', value: 15, attackKind: 'melee' }, { kind: 'block', value: 15 }] },
      { cost: 3, effects: [{ kind: 'damage', value: 10, attackKind: 'melee' }, { kind: 'block', value: 10 }] },
    ],
    description: '카타나 장착 시에만 덱에 추가. 단계별 코스트/수치 상이.',
    mapTags: { noise: 2, traits: ['melee', 'escape'], disengageProgress: 1 },
  },

  // ---- 모듈 3: 역장 강화 (파워·고정 + 역장 방출 고정) ----
  module_forcefield_defense: {
    id: 'module_forcefield_defense', name: '역장 방어', type: 'power', attackKind: null,
    exhausts: false, overloadGain: 10, powerKind: 'fixed', power: 'forcefieldDefense',
    stageTable: [
      { cost: 1, armorPerTurn: 4 },
      { cost: 1, armorPerTurn: 6 },
      { cost: 2, armorPerTurn: 8 },
      { cost: 2, armorPerTurn: 4 },
    ],
    description: '사용 시점 단계로 고정된 만큼 갑옷을 즉시 1회 획득 (턴 종료 시 방어도로 전환).',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  module_forcefield_blast: {
    id: 'module_forcefield_blast', name: '역장 방출', type: 'attack', attackKind: null,
    exhausts: true, overloadGain: 15,
    stageTable: [
      { cost: 0, effects: [{ kind: 'damage', value: 8, target: 'all_enemies' }, { kind: 'applyStatus', status: 'vulnerable', amount: 1, target: 'all_enemies' }, { kind: 'applyStatus', status: 'weak', amount: 1, target: 'all_enemies' }] },
      { cost: 0, effects: [{ kind: 'damage', value: 10, target: 'all_enemies' }, { kind: 'applyStatus', status: 'vulnerable', amount: 2, target: 'all_enemies' }, { kind: 'applyStatus', status: 'weak', amount: 2, target: 'all_enemies' }] },
      { cost: 1, effects: [{ kind: 'damage', value: 10, target: 'all_enemies' }, { kind: 'applyStatus', status: 'vulnerable', amount: 2, target: 'all_enemies' }, { kind: 'applyStatus', status: 'weak', amount: 2, target: 'all_enemies' }] },
      { cost: 1, effects: [{ kind: 'damage', value: 8, target: 'all_enemies' }, { kind: 'applyStatus', status: 'vulnerable', amount: 1, target: 'all_enemies' }, { kind: 'applyStatus', status: 'weak', amount: 1, target: 'all_enemies' }] },
    ],
    description: '전투당 1회(소멸). 단계별 코스트/수치 상이.',
    mapTags: { noise: 3, traits: ['explosive'], disengageProgress: 0 },
  },

  // ---- 모듈 4: 공간 지각 (파워·가변 + 투시 고정) ----
  module_spatial_awareness: {
    id: 'module_spatial_awareness', name: '공간 지각', type: 'power', attackKind: null,
    cost: 1, exhausts: false, overloadGain: 10, powerKind: 'variable', power: 'spatialAwareness',
    effects: [{ kind: 'activatePower', power: 'spatialAwareness' }],
    description: '원거리 공격력 버프 활성화 (매턴 현재 과부화 단계 기준으로 재계산).',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  module_xray_vision: {
    id: 'module_xray_vision', name: '투시', type: 'skill', attackKind: null,
    exhausts: false, overloadGain: 10,
    stageTable: [
      { cost: 1, effects: [{ kind: 'grantNextRangedBonus', amount: 3, ignoresBlock: false }] },
      { cost: 0, effects: [{ kind: 'grantNextRangedBonus', amount: 6, ignoresBlock: true }] },
      { cost: 1, effects: [{ kind: 'grantNextRangedBonus', amount: 6, ignoresBlock: false }] },
      { cost: 1, effects: [{ kind: 'grantNextRangedBonus', amount: 3, ignoresBlock: false }] },
    ],
    description: '다음 원거리 공격에 피해 보너스 부여. 1단계에서는 방어 무시.',
    mapTags: { noise: 0, traits: ['perception', 'electronic'], disengageProgress: 0 },
  },

  // ---- 모듈 5: 전자기 간섭 ----
  // ---- 과적(짐) 상태이상 카드 (잡템/환금템/미장착 장비·소모품/탄약이 과적 상태로 넘어가면
  // 덱에 삽입, §6). 상태이상 카드(status_card)와 구분되는 별도 type: 'burden' — 페널티가
  // 아니라 "짊어진 짐" 그 자체를 나타낸다. 평소엔 unplayable(과적 아님). 소지 아이템이
  // 과적(짐)으로 넘어가면 combatEngine이 카드 인스턴스의 itemId를 통해 동적으로 playable
  // 처리 — 이 defId 자체는 항상 unplayable.
  junk_item: {
    id: 'junk_item', name: '잡템', type: 'burden', attackKind: null,
    unplayable: true, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'removeInventoryItem' }],
    description: '평소 사용 불가. 과적(짐) 상태일 때만 1코로 사용해 영구 소멸.',
  },
  currency_item: {
    id: 'currency_item', name: '환금템', type: 'burden', attackKind: null,
    unplayable: true, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'removeInventoryItem' }],
    description: '평소 사용 불가. 과적(짐) 상태일 때만 1코로 사용해 영구 소멸.',
  },
  equipment_item: {
    id: 'equipment_item', name: '미장착 장비', type: 'burden', attackKind: null,
    unplayable: true, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'removeInventoryItem' }],
    description: '평소 사용 불가. 과적(짐) 상태일 때만 1코로 사용해 영구 소멸.',
  },
  ammo_item: {
    id: 'ammo_item', name: '탄약 더미', type: 'burden', attackKind: null,
    unplayable: true, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'removeInventoryItem' }],
    description: '평소 사용 불가. 과적(짐) 상태일 때만 1코로 사용해 영구 소멸.',
  },
  consumable_item: {
    id: 'consumable_item', name: '미장착 소모품', type: 'burden', attackKind: null,
    unplayable: true, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'removeInventoryItem' }],
    description: '평소 사용 불가. 과적(짐) 상태일 때만 1코로 사용해 영구 소멸.',
  },
  contract_goods_item: {
    id: 'contract_goods_item', name: '계약 물품', type: 'burden', attackKind: null,
    unplayable: true, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'removeInventoryItem' }],
    description: '평소 사용 불가. 과적(짐) 상태일 때만 1코로 사용해 영구 소멸 — 버리면 회수 계약이 실패한다.',
  },

  // ---- 몬스터 삽입 상태이상 카드 (전투 한정) ----
  sticky_status_card: {
    id: 'sticky_status_card', name: '점액투성이', type: 'status_card', attackKind: null,
    unplayable: false, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '아무 효과 없음. 1코로 사용해 소멸.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  // 장비 내구도가 4 미만이면 (4-내구도)장만큼 전투 시작 시 이 카드가 덱에 삽입됨(§신규 내구도).
  // 어느 장비 손상인지는 구분하지 않는 범용 카드 — sticky_status_card와 동일 패턴, 소지 아이템과
  // 연결되지 않으므로 equipmentInstanceId가 없어 스스로는 내구도 감소 판정 대상이 아님.
  equipment_damaged_status_card: {
    id: 'equipment_damaged_status_card', name: '손상된 장비', type: 'status_card', attackKind: null,
    unplayable: false, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '아무 효과 없음. 1코로 사용해 소멸. 장비 내구도 저하로 이번 전투에만 발생.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  // 과부화가 100을 넘으면 초과분(10당 1장, 올림)만큼 삽입됨(§과부화 3단계 개편) — equipment_damaged_status_card와
  // 동일 패턴의 범용 카드, 이번 전투에만 존재하고 다음 전투로 넘어가지 않는다.
  overload_status_card: {
    id: 'overload_status_card', name: '과부화 잔여', type: 'status_card', attackKind: null,
    unplayable: false, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '아무 효과 없음. 1코로 사용해 소멸. 과부화가 100을 넘어 이번 전투에만 발생.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
  infected_status_card: {
    id: 'infected_status_card', name: '감염', type: 'status_card', attackKind: null,
    unplayable: true, exhausts: false, scalesWithStage: false, overloadGain: 0,
    damagePerTurnHeld: 3,
    effects: [],
    description: '사용 불가. 턴 종료 시 손패에 있으면 장당 3의 피해(방어도로 막을 수 있음).',
  },
  wound_status_card: {
    id: 'wound_status_card', name: '부상', type: 'status_card', attackKind: null,
    unplayable: true, exhausts: false, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '사용 불가. 그 외엔 아무 효과 없음.',
  },
  dizziness_status_card: {
    id: 'dizziness_status_card', name: '어지러움', type: 'status_card', attackKind: null,
    unplayable: true, exhausts: false, scalesWithStage: false, overloadGain: 0,
    volatile: true,
    effects: [],
    description: '사용 불가. 턴 종료 시 손패에 있으면 소멸(휘발성).',
  },

  // ---- 몬스터 삽입 상태이상 카드 (전투 한정, 다음 전투에 복귀하지 않음) ----
  mucus_status_card: {
    id: 'mucus_status_card', name: '점액', type: 'status_card', attackKind: null,
    unplayable: true, exhausts: false, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '사용 불가. 전투 종료 시 소멸 (다음 전투에 복귀하지 않음).',
  },
  offering_status_card: {
    id: 'offering_status_card', name: '공물', type: 'status_card', attackKind: null,
    unplayable: true, exhausts: false, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '사용 불가. 전투 종료 시 소멸 (다음 전투에 복귀하지 않음).',
  },

  module_hack: {
    id: 'module_hack', name: '해킹', type: 'skill', attackKind: null,
    cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 15,
    effects: [{ kind: 'applyStun', target: 'enemy', amount: 1 }],
    description: '적 대상(기계 아니어도) 스턴 1턴. 소멸. 과부화 +15 (단계 무관).',
    mapTags: { noise: 0, traits: ['hack'], disengageProgress: 1 },
  },

  // ---- 미장착 슬롯 보충 카드 (§ 무기/상의/하의 빈 칸당 자동 편입, equipmentEngine 참고) ----
  bare_hands_attack: {
    id: 'bare_hands_attack', name: '맨손공격', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 3, attackKind: 'melee' }],
    description: '피해 3. 무기 미장착 슬롯 1칸당 3장씩 덱에 자동 편입.',
    mapTags: { noise: 1, traits: ['melee'], disengageProgress: 0 },
  },
  clumsy_dodge: {
    id: 'clumsy_dodge', name: '어설픈 회피', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 3 }],
    description: '방어 3. 상의/하의 미장착 슬롯 1칸당 3장씩 덱에 자동 편입.',
    mapTags: { noise: 0, traits: [], disengageProgress: 0 },
  },
};

/** 인벤토리 아이템 kind -> 그 아이템이 과적(짐) 상태일 때 덱에 들어가는 status 카드 defId. */
export const BURDEN_CARD_DEF_BY_KIND = {
  junk: 'junk_item', currency: 'currency_item', equipment: 'equipment_item', ammo: 'ammo_item', consumable: 'consumable_item',
  contractGoods: 'contract_goods_item',
};
