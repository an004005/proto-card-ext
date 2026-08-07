// Pure helpers for building the loadout/equipment display shapes shared between the warehouse
// screen and anywhere else that needs to show "what's equipped and what it adds to the deck"
// (e.g. the in-combat inventory popup).
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from './equipment.js';
import { MODULE_DEFINITIONS } from './modules.js';
import { IMPLANT_DEFINITIONS } from './implants.js';
import { CARD_DEFINITIONS } from './cards.js';
import { WAREHOUSE_STARTING_POOL, FARMING_ONLY_POOL } from './loadoutPool.js';

/** @typedef {import('../engine/types.js').Loadout} Loadout */

export const CATEGORIES = [
  { key: 'weapon', label: '무기', defs: WEAPON_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.weapons, ...FARMING_ONLY_POOL.weapons], slotType: 'weapon', max: 2, iconColor: 'var(--color-accent)' },
  { key: 'top', label: '상의', defs: ARMOR_TOP_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.tops, ...FARMING_ONLY_POOL.tops], slotType: 'top', max: 1, iconColor: 'var(--color-neutral-700)' },
  { key: 'bottom', label: '하의', defs: ARMOR_BOTTOM_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.bottoms, ...FARMING_ONLY_POOL.bottoms], slotType: 'bottom', max: 1, iconColor: 'var(--color-neutral-700)' },
  { key: 'module', label: '모듈', defs: MODULE_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.modules, ...FARMING_ONLY_POOL.modules], slotType: 'module', max: 2, iconColor: 'var(--color-accent-2-700)' },
  { key: 'implant', label: '임플란트', defs: IMPLANT_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.implants, ...FARMING_ONLY_POOL.implants], slotType: 'implant', max: 3, iconColor: 'var(--color-accent-2-700)' },
  { key: 'consumable', label: '소모품', defs: null, pool: null, slotType: null, max: null, iconColor: 'var(--color-neutral-700)' },
];

/**
 * @param {Loadout} loadout
 * @param {Object} cat
 * @returns {string[]}
 */
export function getSelectedIds(loadout, cat) {
  if (cat.key === 'weapon') return loadout.weaponIds;
  if (cat.key === 'top') return loadout.topId ? [loadout.topId] : [];
  if (cat.key === 'bottom') return loadout.bottomId ? [loadout.bottomId] : [];
  if (cat.key === 'module') return loadout.moduleIds;
  if (cat.key === 'implant') return loadout.implantIds;
  return [];
}

/**
 * @param {?{cardList?: {defId: string, count: number}[]}} def
 * @returns {number|undefined}
 */
export function cardCountOf(def) {
  if (!def || !def.cardList) return undefined;
  return def.cardList.reduce((s, e) => s + e.count, 0);
}

/**
 * @param {Object} cat
 * @param {Loadout} loadout
 * @returns {Object[]}
 */
export function buildSlots(cat, loadout) {
  const ids = getSelectedIds(loadout, cat);
  const slots = [];
  for (let i = 0; i < cat.max; i++) {
    const id = ids[i];
    const def = id ? cat.defs[id] : null;
    slots.push({
      key: `${cat.key}${i}`,
      catKey: cat.key,
      equipmentId: id || null,
      category: cat.max > 1 ? `${cat.label}${i + 1}` : cat.label,
      filled: !!def,
      name: def?.name,
      cardCount: cardCountOf(def),
      floorOverload: def?.floorOverload,
      description: def?.description,
      cardList: def?.cardList,
    });
  }
  return slots;
}

/** @param {Loadout} loadout @returns {Object[]} */
export function buildAllEquipSlots(loadout) {
  return [
    ...buildSlots(CATEGORIES[0], loadout),
    ...buildSlots(CATEGORIES[1], loadout),
    ...buildSlots(CATEGORIES[2], loadout),
    ...buildSlots(CATEGORIES[3], loadout),
    ...buildSlots(CATEGORIES[4], loadout),
  ];
}

/**
 * @param {Loadout} loadout
 * @returns {{name: string, color: string, cards: {name: string, defId: string}[]}[]}
 */
export function buildDeckGroups(loadout) {
  const groups = [];
  const pushGroup = (name, color, cardList) => {
    if (!cardList) return;
    const cards = [];
    for (const entry of cardList) {
      const cardDef = CARD_DEFINITIONS[entry.defId];
      if (cardDef.requiresWeapon && !loadout.weaponIds.includes(cardDef.requiresWeapon)) continue;
      for (let i = 0; i < entry.count; i++) cards.push({ name: cardDef.name, defId: entry.defId });
    }
    if (cards.length) groups.push({ name, color, cards });
  };
  loadout.weaponIds.forEach((id) => WEAPON_DEFINITIONS[id] && pushGroup(WEAPON_DEFINITIONS[id].name, 'var(--color-accent)', WEAPON_DEFINITIONS[id].cardList));
  if (loadout.topId) pushGroup(ARMOR_TOP_DEFINITIONS[loadout.topId].name, 'var(--color-neutral-700)', ARMOR_TOP_DEFINITIONS[loadout.topId].cardList);
  if (loadout.bottomId) pushGroup(ARMOR_BOTTOM_DEFINITIONS[loadout.bottomId].name, 'var(--color-neutral-700)', ARMOR_BOTTOM_DEFINITIONS[loadout.bottomId].cardList);
  loadout.moduleIds.forEach((id) => MODULE_DEFINITIONS[id] && pushGroup(MODULE_DEFINITIONS[id].name, 'var(--color-accent-2-700)', MODULE_DEFINITIONS[id].cardList));
  return groups;
}
