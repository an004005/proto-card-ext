// Shared display info for inventory items (잡템/환금템/장비) — used anywhere an item needs a
// name/sub-label/color, independent of whether it's still "pending" loot or already stored.
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from './equipment.js';
import { MODULE_DEFINITIONS } from './modules.js';
import { IMPLANT_DEFINITIONS } from './implants.js';

/** @typedef {import('../engine/types.js').Item} Item */

const EQUIPMENT_DEFS = {
  ...WEAPON_DEFINITIONS, ...ARMOR_TOP_DEFINITIONS, ...ARMOR_BOTTOM_DEFINITIONS, ...MODULE_DEFINITIONS, ...IMPLANT_DEFINITIONS,
};

/**
 * @param {Item} item
 * @returns {{name: string, sub: string, color: string}}
 */
export function describeItem(item) {
  if (item.kind === 'junk') return { name: '잡템', sub: `환금 가치 ${item.value}cr`, color: 'var(--color-neutral-500)' };
  if (item.kind === 'currency') return { name: '환금템', sub: `가치 ${item.value}cr`, color: 'var(--color-accent-2-700)' };
  if (item.kind === 'ammo') return { name: '탄약 더미', sub: `${item.amount}발`, color: 'var(--color-accent-2-700)' };
  return { name: EQUIPMENT_DEFS[item.equipmentId]?.name || item.equipmentId, sub: '미장착 장비', color: 'var(--color-accent)' };
}
