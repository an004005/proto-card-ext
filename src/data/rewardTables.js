// Post-combat reward roll (replaces BASIC_DROP_TABLE/rollBasicDrop's auto-grant model).
// 장비 슬롯은 매 전투 승리 시 항상 1개 고정 등장. 추가로 2회, 각각 게이트 확률을 굴려
// 통과하면 카테고리(소모품/환금템/잡템) 하나를 뽑아 슬롯을 추가한다. 각 슬롯은 3종 후보 중 1택.
/** @type {Object.<string, number>} */
export const REWARD_GATE_CHANCE = { normal: 0.6, elite: 0.9, boss: 1.0 };
export const REWARD_GATE_ROLLS = 2;

/** @type {{value: 'consumable'|'currency'|'junk', weight: number}[]} */
export const REWARD_CATEGORY_WEIGHTS = [
  { value: 'consumable', weight: 2 },
  { value: 'currency', weight: 4 },
  { value: 'junk', weight: 4 },
];

export const REWARD_OPTIONS_PER_SLOT = 3;

// 환금템/잡템 카테고리의 3종 후보를 뽑을 때, 그 아이템 자체(환금템/잡템) 대 총알 비중.
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
 * 환금템(currency) 값 범위 — 기존 BASIC_DROP_TABLE의 값 그대로 재사용.
 * @type {Object.<string, {min: number, max: number}>}
 */
export const REWARD_CURRENCY_VALUE_RANGE = {
  normal: { min: 10, max: 20 },
  elite: { min: 20, max: 40 },
  boss: { min: 40, max: 40 },
};

/**
 * 잡템(junk) 값 범위 — 기존 FARM_JUNK_VALUE(5)와 정합성 맞춘 신규 상수.
 * @type {Object.<string, {min: number, max: number}>}
 */
export const REWARD_JUNK_VALUE_RANGE = {
  normal: { min: 5, max: 15 },
  elite: { min: 15, max: 30 },
  boss: { min: 30, max: 30 },
};

// 소모품 카테고리 후보 — 기존 CONSUMABLE_DROP_WEIGHTS 재사용 (dropTables.js에서 import).

/**
 * 보급품(supply) 파밍 1회가 내놓는 카테고리 가중치.
 *
 * 보급품은 구역마다 널려 있는 "자원 보급"이다 — 장비 한 벌을 고르는 자리는 확보 대상(prize)이고,
 * 보급품까지 매번 장비를 뱉으면 확보 대상을 찾아갈 이유가 사라진다. 그래서 여기서는 탄약·소모품·
 * 재화·잡템이 주력이고 장비는 낮은 확률의 덤이다. elite는 장비 확률과 소모품 비중이 올라간다.
 * @type {Object.<string, {value: string, weight: number}[]>}
 */
export const SUPPLY_CATEGORY_WEIGHTS = {
  normal: [
    { value: 'ammo', weight: 34 },
    { value: 'consumable', weight: 18 },
    { value: 'currency', weight: 20 },
    { value: 'junk', weight: 22 },
    { value: 'equipment', weight: 6 },
  ],
  elite: [
    { value: 'ammo', weight: 26 },
    { value: 'consumable', weight: 26 },
    { value: 'currency', weight: 24 },
    { value: 'junk', weight: 10 },
    { value: 'equipment', weight: 14 },
  ],
};

/**
 * 보급품에서 나오는 탄약 수 — 전투 보상보다 폭이 넓고 등급을 탄다.
 * @type {Object.<string, {min: number, max: number}>}
 */
export const SUPPLY_AMMO_RANGE = {
  normal: { min: 4, max: 8 },
  elite: { min: 8, max: 14 },
};
