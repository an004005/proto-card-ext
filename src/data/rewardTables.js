// Post-combat reward roll (replaces BASIC_DROP_TABLE/rollBasicDrop's auto-grant model).
// 장비 슬롯은 매 전투 승리 시 항상 1개 고정 등장. 추가로 2회, 각각 게이트 확률을 굴려
// 통과하면 카테고리(소모품/환급/재료) 하나를 뽑아 슬롯을 추가한다. 각 슬롯은 3종 후보 중 1택.
/** @type {Object.<string, number>} */
export const REWARD_GATE_CHANCE = { normal: 0.6, elite: 0.9, boss: 1.0 };
export const REWARD_GATE_ROLLS = 2;

/** @type {{value: string, weight: number}[]} */
export const REWARD_CATEGORY_WEIGHTS = [
  { value: 'consumable', weight: 2 },
  { value: 'currency', weight: 4 },
  { value: 'junk', weight: 4 },
];

export const REWARD_OPTIONS_PER_SLOT = 3;

// 환급/재료 카테고리의 3종 후보를 뽑을 때, 그 아이템 자체(환금템/잡템) 대 총알 비중.
/** @type {{value: string, weight: number}[]} */
export const CURRENCY_SLOT_ITEM_WEIGHTS = [
  { value: 'currencyItem', weight: 70 },
  { value: 'ammo', weight: 30 },
];
/** @type {{value: string, weight: number}[]} */
export const JUNK_SLOT_ITEM_WEIGHTS = [
  { value: 'junkItem', weight: 70 },
  { value: 'ammo', weight: 30 },
];

export const REWARD_AMMO_MIN = 3;
export const REWARD_AMMO_MAX = 7;

/**
 * 환급템(currency) 값 범위 — 기존 BASIC_DROP_TABLE의 값 그대로 재사용.
 * @type {Object.<string, {min: number, max: number}>}
 */
export const REWARD_CURRENCY_VALUE_RANGE = {
  normal: { min: 10, max: 20 },
  elite: { min: 20, max: 40 },
  boss: { min: 40, max: 40 },
};

/**
 * 재료(잡템) 값 범위 — 기존 FARM_JUNK_VALUE(5)와 정합성 맞춘 신규 상수.
 * @type {Object.<string, {min: number, max: number}>}
 */
export const REWARD_JUNK_VALUE_RANGE = {
  normal: { min: 5, max: 15 },
  elite: { min: 15, max: 30 },
  boss: { min: 30, max: 30 },
};

// 소모품 카테고리 후보 — 기존 CONSUMABLE_DROP_WEIGHTS 재사용 (dropTables.js에서 import).
