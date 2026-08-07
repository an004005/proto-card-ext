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
function rollRange(rngState, min, max) {
  if (min === max) return { value: min, state: rngState };
  const { value, state } = nextInt(rngState, max - min + 1);
  return { value: min + value, state };
}

/**
 * @template T
 * @param {RngState} rngState
 * @param {T[]} array
 * @returns {{value: T[], state: RngState}}
 */
function shuffle(rngState, array) {
  const result = array.slice();
  let s = rngState;
  for (let i = result.length - 1; i > 0; i--) {
    const j = nextInt(s, i + 1);
    s = j.state;
    [result[i], result[j.value]] = [result[j.value], result[i]];
  }
  return { value: result, state: s };
}

/**
 * @param {string[]} ownedEquipmentIds
 * @param {string[]} allEquipmentIds
 * @param {RngState} rngState
 * @returns {{options: RewardOption[], state: RngState}}
 */
function rollEquipmentOptions(ownedEquipmentIds, allEquipmentIds, rngState) {
  const pool = allEquipmentIds.filter((id) => !ownedEquipmentIds.includes(id));
  const shuffled = shuffle(rngState, pool);
  const options = shuffled.value.slice(0, REWARD_OPTIONS_PER_SLOT).map((id) => ({ kind: 'equipment', equipmentId: id }));
  return { options, state: shuffled.state };
}

/**
 * @param {RngState} rngState
 * @returns {{options: RewardOption[], state: RngState}}
 */
function rollConsumableOptions(rngState) {
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
function rollCurrencyOrJunkOptions(tier, itemWeights, itemKind, valueRange, rngState) {
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
 * @param {string[]} ownedEquipmentIds
 * @param {string[]} allEquipmentIds
 * @param {RngState} rngState
 * @returns {{slots: RewardSlot[], rngState: RngState}}
 */
export function rollRewardSlots(tier, ownedEquipmentIds, allEquipmentIds, rngState) {
  let rng = rngState;
  const slots = [];

  const equipRoll = rollEquipmentOptions(ownedEquipmentIds, allEquipmentIds, rng);
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
