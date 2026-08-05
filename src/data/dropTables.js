// Drop tables (기획서 §12.1, §14b).
export const BASIC_DROP_TABLE = {
  normal: {
    ammo: { chance: 1.0, min: 2, max: 4 },
    currency: { chance: 0.6, countMin: 1, countMax: 1, valueMin: 10, valueMax: 20 },
    equipment: { chance: 0.08 },
    consumable: { chance: 0.35 },
  },
  elite: {
    ammo: { chance: 1.0, min: 4, max: 6 },
    currency: { chance: 1.0, countMin: 1, countMax: 2, valueMin: 20, valueMax: 40 },
    equipment: { chance: 0.5 },
    consumable: { chance: 0.6 },
  },
  boss: {
    currency: { chance: 1.0, countMin: 3, countMax: 3, valueMin: 40, valueMax: 40 },
    equipment: { chance: 1.0 },
  },
};

export const CONSUMABLE_DROP_WEIGHTS = [
  { value: 'stabilizer', weight: 0.4 },
  { value: 'bandage', weight: 0.3 },
  { value: 'flashbang', weight: 0.2 },
  { value: 'grenade', weight: 0.1 },
];

// 추가 파밍 (선택 시, 30% 기습): 개수 분포 + 개당 롤.
export const FARM_ITEM_COUNT_WEIGHTS = [
  { value: 2, weight: 0.6 },
  { value: 3, weight: 0.4 },
];
export const FARM_ROLL_WEIGHTS = [
  { value: 'junk', weight: 0.45 },
  { value: 'currency', weight: 0.30 },
  { value: 'ammo', weight: 0.15 },
  { value: 'consumable', weight: 0.10 },
];
export const FARM_JUNK_VALUE = 5;
export const FARM_CURRENCY_VALUE = 15;
export const FARM_AMMO_AMOUNT = 3;

// 전투 후 3택 (§12.2).
export const POST_COMBAT_CHOICES = {
  farm: { ambushChance: 0.3 },
  rest: { ambushChance: 0.15, hpRestorePercent: 0.1, overloadReduce: 30 },
  move: { ambushChance: 0 },
};
