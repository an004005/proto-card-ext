// Post-combat reward roll (replaces dropEngine.js's rollBasicDrop/rollFarmLoot auto-grant
// model). Every combat win produces a fixed 장비 slot plus 0-2 gated bonus slots; each slot
// carries REWARD_OPTIONS_PER_SLOT concrete options for the player to pick one of (or skip).
import { nextFloat, nextInt, weightedPick } from './rng.js';
import {
  REWARD_GATE_CHANCE, REWARD_GATE_ROLLS, REWARD_CATEGORY_WEIGHTS, REWARD_OPTIONS_PER_SLOT,
  CURRENCY_SLOT_ITEM_WEIGHTS, JUNK_SLOT_ITEM_WEIGHTS, REWARD_AMMO_MIN, REWARD_AMMO_MAX,
  REWARD_CURRENCY_VALUE_RANGE, REWARD_JUNK_VALUE_RANGE,
} from '../data/rewardTables.js';
import { CONSUMABLE_DROP_WEIGHTS } from '../data/dropTables.js';

/** @typedef {import('./types.js').RngState} RngState */
/** @typedef {import('./types.js').RewardOption} RewardOption */
/** @typedef {import('./types.js').RewardSlot} RewardSlot */

/**
 * @param {RngState} rngState
 * @param {number} min
 * @param {number} max
 * @returns {{value: number, state: RngState}}
 */
export function rollRange(rngState, min, max) {
  if (min === max) return { value: min, state: rngState };
  const { value, state } = nextInt(rngState, max - min + 1);
  return { value: min + value, state };
}

// 장비 내구도(§신규): 드랍된 장비는 3~9 사이 랜덤 내구도로 시작(시작 장비는 별도로 항상 최대치).
export const LOOT_DURABILITY_MIN = 3;
export const LOOT_DURABILITY_MAX = 9;

/** @param {RngState} rngState @returns {{value: number, state: RngState}} */
export function rollLootDurability(rngState) {
  return rollRange(rngState, LOOT_DURABILITY_MIN, LOOT_DURABILITY_MAX);
}

/**
 * 이미 소유한 장비도 다시 드랍될 수 있다(§신규 장비 인스턴스화 — 같은 종류 중복 소유 허용).
 *
 * 후보는 3개뿐인데 예전에는 카탈로그 전체(27종)를 셔플해 앞의 셋만 썼다 — 후보 하나당 난수를
 * 아홉 번씩 태우는 셈이고, 장비가 늘 때마다 같은 시드의 결과가 통째로 달라졌다. 지금은
 * 필요한 만큼만 뽑는다: 남은 풀에서 하나씩 꺼내 되돌리지 않는다(부분 셔플).
 * @param {string[]} allEquipmentIds
 * @param {RngState} rngState
 * @returns {{options: RewardOption[], state: RngState}}
 */
export function rollEquipmentOptions(allEquipmentIds, rngState) {
  const pool = allEquipmentIds.slice();
  let rng = rngState;
  const options = [];
  const count = Math.min(REWARD_OPTIONS_PER_SLOT, pool.length);
  for (let i = 0; i < count; i++) {
    const picked = nextInt(rng, pool.length);
    rng = picked.state;
    const [id] = pool.splice(picked.value, 1);
    options.push({ kind: 'equipment', equipmentId: id });
  }
  return { options, state: rng };
}

/**
 * @param {RngState} rngState
 * @returns {{options: RewardOption[], state: RngState}}
 */
export function rollConsumableOptions(rngState) {
  let rng = rngState;
  const options = [];
  const used = new Set();
  let attempts = 0;
  while (options.length < REWARD_OPTIONS_PER_SLOT && attempts < 12) {
    attempts += 1;
    const picked = weightedPick(rng, CONSUMABLE_DROP_WEIGHTS);
    rng = picked.state;
    if (used.has(picked.value) && used.size < CONSUMABLE_DROP_WEIGHTS.length) continue;
    used.add(picked.value);
    options.push({ kind: 'consumable', defId: picked.value });
  }
  return { options, state: rng };
}

/**
 * @param {'normal'|'elite'|'boss'} tier
 * @param {{value: string, weight: number}[]} itemWeights
 * @param {'currency'|'junk'} itemKind
 * @param {Object.<string, {min: number, max: number}>} valueRange
 * @param {RngState} rngState
 * @returns {{options: RewardOption[], state: RngState}}
 */
export function rollCurrencyOrJunkOptions(tier, itemWeights, itemKind, valueRange, rngState) {
  let rng = rngState;
  const range = valueRange[tier];
  const options = [];
  for (let i = 0; i < REWARD_OPTIONS_PER_SLOT; i++) {
    const itemPick = weightedPick(rng, itemWeights);
    rng = itemPick.state;
    if (itemPick.value === 'ammo') {
      const amt = rollRange(rng, REWARD_AMMO_MIN, REWARD_AMMO_MAX);
      rng = amt.state;
      options.push({ kind: 'ammo', amount: amt.value });
    } else {
      const val = rollRange(rng, range.min, range.max);
      rng = val.state;
      options.push({ kind: itemKind, value: val.value });
    }
  }
  return { options, state: rng };
}

/**
 * @param {'normal'|'elite'|'boss'} tier
 * @param {string[]} allEquipmentIds
 * @param {RngState} rngState
 * @returns {{slots: RewardSlot[], rngState: RngState}}
 */
export function rollRewardSlots(tier, allEquipmentIds, rngState) {
  let rng = rngState;
  const slots = [];

  const equipRoll = rollEquipmentOptions(allEquipmentIds, rng);
  rng = equipRoll.state;
  slots.push({ key: 'slot-equipment', category: 'equipment', options: equipRoll.options });

  const gateChance = REWARD_GATE_CHANCE[tier];
  for (let g = 0; g < REWARD_GATE_ROLLS; g++) {
    const gate = nextFloat(rng);
    rng = gate.state;
    if (gate.value >= gateChance) continue;

    const catPick = weightedPick(rng, REWARD_CATEGORY_WEIGHTS);
    rng = catPick.state;

    let rolled;
    if (catPick.value === 'consumable') rolled = rollConsumableOptions(rng);
    else if (catPick.value === 'currency') rolled = rollCurrencyOrJunkOptions(tier, CURRENCY_SLOT_ITEM_WEIGHTS, 'currency', REWARD_CURRENCY_VALUE_RANGE, rng);
    else rolled = rollCurrencyOrJunkOptions(tier, JUNK_SLOT_ITEM_WEIGHTS, 'junk', REWARD_JUNK_VALUE_RANGE, rng);
    rng = rolled.state;

    slots.push({ key: `slot-${catPick.value}-${g}`, category: catPick.value, options: rolled.options });
  }

  return { slots, rngState: rng };
}
