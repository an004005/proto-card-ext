// Card definitions for the Card Extraction ruleset (기획서 §8 카드 일람, §9 모듈).
// Numbers are the "0단계 기준" values from the doc; scaling is applied at resolution time
// by overloadEngine.applyStageScale(), never baked into these numbers.
//
// Shape (plain cards): { id, name, type, attackKind, cost, ammoCost, exhausts,
//   scalesWithStage, overloadGain, effects: [...], description }
// Shape (module cards with a per-stage table, §9): { id, name, type, attackKind, exhausts,
//   overloadGain, powerKind: 'variable'|'fixed'|null, stageTable: [ {cost, effects}×4 ],
//   requiresWeapon?, description }
//
// effect kinds: damage, block, applyStatus, applyStun, draw, discardRandomFromHand,
// activatePower, activateFixedPower, grantNextRangedBonus.

export const CARD_DEFINITIONS = {
  // ---- 카타나 ----
  katana_slash: {
    id: 'katana_slash', name: '베기', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 6, attackKind: 'melee' }],
    description: '피해 6.',
  },
  katana_parry: {
    id: 'katana_parry', name: '튕겨내기', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [
      { kind: 'block', value: 8 },
      { kind: 'applyStatus', status: 'reflect', amount: 3, target: 'self' },
    ],
    description: '방어 8. 공격받으면 3 반사.',
  },

  // ---- 라이플 ----
  rifle_aim: {
    id: 'rifle_aim', name: '조준사격', type: 'attack', attackKind: 'ranged',
    cost: 0, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [{ kind: 'damage', value: 8, attackKind: 'ranged' }],
    description: '피해 8. 총알 1 소모.',
  },
  rifle_suppress: {
    id: 'rifle_suppress', name: '제압사격', type: 'attack', attackKind: 'ranged',
    cost: 1, ammoCost: 3, exhausts: false, scalesWithStage: true, overloadGain: 10,
    effects: [{ kind: 'damage', value: 10, attackKind: 'ranged', target: 'all_enemies' }],
    description: '광역 피해 10. 총알 3 소모.',
  },
  rifle_buttstock: {
    id: 'rifle_buttstock', name: '개머리판 타격', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 5, attackKind: 'melee' }],
    description: '피해 5 (총알 무소모 예비 수단).',
  },

  // ---- 단검 ----
  dagger_weak_slash: {
    id: 'dagger_weak_slash', name: '약한 베기', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 4, attackKind: 'melee' }],
    description: '피해 4.',
  },
  dagger_stab: {
    id: 'dagger_stab', name: '찌르기', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [
      { kind: 'damage', value: 9, attackKind: 'melee' },
      { kind: 'applyStatus', status: 'vulnerable', amount: 1, target: 'self' },
    ],
    description: '피해 9. 자신에게 취약 1턴.',
  },

  // ---- 권총 ----
  pistol_shot: {
    id: 'pistol_shot', name: '단발사격', type: 'attack', attackKind: 'ranged',
    cost: 0, ammoCost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'damage', value: 6, attackKind: 'ranged' }],
    description: '피해 6. 총알 1 소모.',
  },

  // ---- 중갑상의 ----
  heavy_top_dodge: {
    id: 'heavy_top_dodge', name: '회피', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 6 }],
    description: '방어 6.',
  },
  heavy_top_block: {
    id: 'heavy_top_block', name: '막기', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 9 }],
    description: '방어 9.',
  },
  heavy_top_curse: {
    id: 'heavy_top_curse', name: '무게 저주', type: 'curse', attackKind: null,
    cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '1코 소멸 (효과 없음). 이 전투에서만 제외 — 다음 전투에 복귀.',
  },

  // ---- 경갑상의 ----
  light_top_dodge: {
    id: 'light_top_dodge', name: '회피', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 6 }],
    description: '방어 6.',
  },
  light_top_deflect: {
    id: 'light_top_deflect', name: '흘려내기', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 8 }, { kind: 'draw', count: 1 }],
    description: '방어 8. 카드 1장 드로우.',
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
  },
  tactical_bottom_dash: {
    id: 'tactical_bottom_dash', name: '질주', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'discardRandomFromHand' }, { kind: 'block', value: 9 }],
    description: '무작위로 1장 버리고 방어 9.',
  },
  tactical_bottom_dodge: {
    id: 'tactical_bottom_dodge', name: '회피', type: 'skill', attackKind: null,
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 6 }],
    description: '방어 6.',
  },

  // ---- 중장하의 ----
  heavy_bottom_support: {
    id: 'heavy_bottom_support', name: '지지', type: 'skill', attackKind: null,
    cost: 2, exhausts: false, scalesWithStage: true, overloadGain: 5,
    effects: [{ kind: 'block', value: 16 }],
    description: '방어 16.',
  },
  heavy_bottom_shove: {
    id: 'heavy_bottom_shove', name: '밀쳐내기', type: 'attack', attackKind: 'melee',
    cost: 1, exhausts: false, scalesWithStage: true, overloadGain: 0,
    effects: [{ kind: 'block', value: 5 }, { kind: 'damage', value: 5, attackKind: 'melee' }],
    description: '방어 5, 피해 5.',
  },
  heavy_bottom_curse: {
    id: 'heavy_bottom_curse', name: '무게 저주', type: 'curse', attackKind: null,
    cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '1코 소멸 (효과 없음). 이 전투에서만 제외 — 다음 전투에 복귀.',
  },

  // ---- 모듈 1: 신경 강화 (파워·가변) ----
  module_neural_boost: {
    id: 'module_neural_boost', name: '신경 강화', type: 'power', attackKind: null,
    cost: 1, exhausts: false, overloadGain: 10, powerKind: 'variable', power: 'neuralBoost',
    effects: [{ kind: 'activatePower', power: 'neuralBoost' }],
    description: '방어력 버프 활성화 (매턴 현재 과부화 단계 기준으로 재계산).',
  },

  // ---- 모듈 2: 신체 강화 (파워·가변 + 돌진 베기 고정) ----
  module_body_boost: {
    id: 'module_body_boost', name: '신체 강화', type: 'power', attackKind: null,
    cost: 1, exhausts: false, overloadGain: 10, powerKind: 'variable', power: 'bodyBoost',
    effects: [{ kind: 'activatePower', power: 'bodyBoost' }],
    description: '근접 공격력 버프 활성화 (매턴 현재 과부화 단계 기준으로 재계산).',
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
  },

  // ---- 모듈 4: 공간 지각 (파워·가변 + 투시 고정) ----
  module_spatial_awareness: {
    id: 'module_spatial_awareness', name: '공간 지각', type: 'power', attackKind: null,
    cost: 1, exhausts: false, overloadGain: 10, powerKind: 'variable', power: 'spatialAwareness',
    effects: [{ kind: 'activatePower', power: 'spatialAwareness' }],
    description: '원거리 공격력 버프 활성화 (매턴 현재 과부화 단계 기준으로 재계산).',
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
  },

  // ---- 모듈 5: 전자기 간섭 ----
  // ---- 루팅 저주 (잡템/환금템 습득 시 덱에 삽입, §6) ----
  // 평소엔 unplayable(과적 아님). 소지 아이템이 과적(짐)으로 넘어가면 combatEngine이
  // 카드 인스턴스의 itemId를 통해 동적으로 playable 처리 — 이 defId 자체는 항상 unplayable.
  junk_item: {
    id: 'junk_item', name: '잡템', type: 'curse', attackKind: null,
    unplayable: true, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'removeInventoryItem' }],
    description: '평소 사용 불가. 과적(짐) 상태일 때만 1코로 사용해 영구 소멸.',
  },
  currency_item: {
    id: 'currency_item', name: '환금템', type: 'curse', attackKind: null,
    unplayable: true, cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 0,
    effects: [{ kind: 'removeInventoryItem' }],
    description: '평소 사용 불가. 과적(짐) 상태일 때만 1코로 사용해 영구 소멸.',
  },

  // ---- 몬스터 삽입 저주 (전투 한정, 다음 전투에 복귀하지 않음) ----
  mucus_curse: {
    id: 'mucus_curse', name: '점액', type: 'curse', attackKind: null,
    unplayable: true, exhausts: false, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '사용 불가. 전투 종료 시 소멸 (다음 전투에 복귀하지 않음).',
  },
  offering_curse: {
    id: 'offering_curse', name: '공물', type: 'curse', attackKind: null,
    unplayable: true, exhausts: false, scalesWithStage: false, overloadGain: 0,
    effects: [],
    description: '사용 불가. 전투 종료 시 소멸 (다음 전투에 복귀하지 않음).',
  },

  module_hack: {
    id: 'module_hack', name: '해킹', type: 'skill', attackKind: null,
    cost: 1, exhausts: true, scalesWithStage: false, overloadGain: 15,
    effects: [{ kind: 'applyStun', target: 'machine_enemy', amount: 1 }],
    description: '기계 대상 스턴 1턴. 소멸. 단계 무관.',
  },
};
