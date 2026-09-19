// Shared display info for inventory items (잡템/환금템/장비) — used anywhere an item needs a
// name/sub-label/color, independent of whether it's still "pending" loot or already stored.
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from './equipment.js';
import { MODULE_DEFINITIONS } from './modules.js';
import { IMPLANT_DEFINITIONS } from './implants.js';
import { CONSUMABLE_DEFINITIONS } from './consumables.js';
import { MAX_DURABILITY } from '../engine/equipmentEngine.js';
import { CONTRACT_DEFS } from './contracts.js';

/** @typedef {import('../engine/types.js').Item} Item */

export const EQUIPMENT_DEFS = {
  ...WEAPON_DEFINITIONS, ...ARMOR_TOP_DEFINITIONS, ...ARMOR_BOTTOM_DEFINITIONS, ...MODULE_DEFINITIONS, ...IMPLANT_DEFINITIONS,
};

/** equipmentId -> 카테고리 한글 라벨 (미장착 장비 아이템의 sub 표시용).
 * @type {Object.<string, string>} */
const EQUIPMENT_CATEGORY_LABEL = {};
for (const id of Object.keys(WEAPON_DEFINITIONS)) EQUIPMENT_CATEGORY_LABEL[id] = '무기';
for (const id of Object.keys(ARMOR_TOP_DEFINITIONS)) EQUIPMENT_CATEGORY_LABEL[id] = '상의';
for (const id of Object.keys(ARMOR_BOTTOM_DEFINITIONS)) EQUIPMENT_CATEGORY_LABEL[id] = '하의';
for (const id of Object.keys(MODULE_DEFINITIONS)) EQUIPMENT_CATEGORY_LABEL[id] = '모듈';
for (const id of Object.keys(IMPLANT_DEFINITIONS)) EQUIPMENT_CATEGORY_LABEL[id] = '임플란트';

/**
 * @param {Item} item
 * @returns {{name: string, sub: string, color: string}}
 */
export function describeItem(item) {
  if (item.kind === 'junk') return { name: '잡템', sub: `환금 가치 ${item.value}cr`, color: 'var(--color-neutral-500)' };
  if (item.kind === 'currency') return { name: '환금템', sub: `가치 ${item.value}cr`, color: 'var(--color-accent-2-700)' };
  if (item.kind === 'ammo') return { name: '탄약 더미', sub: `${item.amount}발`, color: 'var(--color-accent-2-700)' };
  if (item.kind === 'contractGoods') {
    const contract = CONTRACT_DEFS.find((c) => c.id === item.contractId);
    return { name: contract?.name || '계약 물품', sub: `계약 회수품 · 가치 ${item.value}cr`, color: 'var(--color-accent-2-700)' };
  }
  if (item.kind === 'consumable') return { name: CONSUMABLE_DEFINITIONS[item.defId ?? '']?.name || item.defId || '', sub: '미장착 소모품', color: 'var(--color-neutral-700)' };

  // 임플란트는 §신규 내구도 시스템 대상이 아니므로(카드가 없어 닳지 않음) 내구도를 표시하지 않는다.
  const category = EQUIPMENT_CATEGORY_LABEL[item.equipmentId ?? ''] || '미장착 장비';
  const durability = item.durability;
  const showsDurability = category !== '임플란트' && durability !== undefined;
  const broken = showsDurability && durability <= 0;
  return {
    name: EQUIPMENT_DEFS[item.equipmentId ?? '']?.name || item.equipmentId || '',
    sub: showsDurability ? `${category} · 내구도 ${item.durability}/${MAX_DURABILITY}${broken ? ' (파손)' : ''}` : category,
    color: broken ? 'var(--color-neutral-500)' : 'var(--color-accent)',
  };
}

