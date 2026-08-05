// Drop resolution (기획서 §12.1, §14b). Every roll threads rngState explicitly (same rule as
// the rest of the engine) so post-combat drops are reproducible under undo/redo.
import { nextFloat, nextInt, weightedPick } from './rng.js';
import {
  BASIC_DROP_TABLE, CONSUMABLE_DROP_WEIGHTS, FARM_ITEM_COUNT_WEIGHTS, FARM_ROLL_WEIGHTS,
  FARM_JUNK_VALUE, FARM_CURRENCY_VALUE, FARM_AMMO_AMOUNT,
} from '../data/dropTables.js';

function rollChance(rngState, chance) {
  const { value, state } = nextFloat(rngState);
  return { hit: value < chance, state };
}

function rollRange(rngState, min, max) {
  if (min === max) return { value: min, state: rngState };
  const { value, state } = nextInt(rngState, max - min + 1);
  return { value: min + value, state };
}

// result: { ammo: number, currencyValues: number[], equipmentId: string|null, consumableId: string|null }
export function rollBasicDrop(tier, ownedEquipmentIds, allEquipmentIds, rngState) {
  const table = BASIC_DROP_TABLE[tier];
  let rng = rngState;
  const result = { ammo: 0, currencyValues: [], equipmentId: null, consumableId: null };

  if (table.ammo) {
    const chance = rollChance(rng, table.ammo.chance); rng = chance.state;
    if (chance.hit) {
      const amt = rollRange(rng, table.ammo.min, table.ammo.max); rng = amt.state;
      result.ammo = amt.value;
    }
  }
  if (table.currency) {
    const chance = rollChance(rng, table.currency.chance); rng = chance.state;
    if (chance.hit) {
      const count = rollRange(rng, table.currency.countMin, table.currency.countMax); rng = count.state;
      for (let i = 0; i < count.value; i++) {
        const val = rollRange(rng, table.currency.valueMin, table.currency.valueMax); rng = val.state;
        result.currencyValues.push(val.value);
      }
    }
  }
  if (table.equipment) {
    const chance = rollChance(rng, table.equipment.chance); rng = chance.state;
    if (chance.hit) {
      const pool = allEquipmentIds.filter((id) => !ownedEquipmentIds.includes(id));
      if (pool.length > 0) {
        const pick = nextInt(rng, pool.length); rng = pick.state;
        result.equipmentId = pool[pick.value];
      }
    }
  }
  if (table.consumable) {
    const chance = rollChance(rng, table.consumable.chance); rng = chance.state;
    if (chance.hit) {
      const pick = weightedPick(rng, CONSUMABLE_DROP_WEIGHTS); rng = pick.state;
      result.consumableId = pick.value;
    }
  }
  return { result, rngState: rng };
}

// items: [{kind:'junk'|'currency'|'ammo'|'consumable', value?, amount?, defId?}]
export function rollFarmLoot(rngState) {
  let rng = rngState;
  const countPick = weightedPick(rng, FARM_ITEM_COUNT_WEIGHTS); rng = countPick.state;
  const items = [];
  for (let i = 0; i < countPick.value; i++) {
    const kindPick = weightedPick(rng, FARM_ROLL_WEIGHTS); rng = kindPick.state;
    if (kindPick.value === 'junk') {
      items.push({ kind: 'junk', value: FARM_JUNK_VALUE });
    } else if (kindPick.value === 'currency') {
      items.push({ kind: 'currency', value: FARM_CURRENCY_VALUE });
    } else if (kindPick.value === 'ammo') {
      items.push({ kind: 'ammo', amount: FARM_AMMO_AMOUNT });
    } else {
      const consumablePick = weightedPick(rng, CONSUMABLE_DROP_WEIGHTS); rng = consumablePick.state;
      items.push({ kind: 'consumable', defId: consumablePick.value });
    }
  }
  return { items, rngState: rng };
}
