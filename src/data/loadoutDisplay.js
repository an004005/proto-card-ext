// Pure helpers for building the loadout/equipment display shapes shared between the warehouse
// screen and anywhere else that needs to show "what's equipped and what it adds to the deck"
// (e.g. the in-combat inventory popup).
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from './equipment.js';
import { MODULE_DEFINITIONS } from './modules.js';
import { IMPLANT_DEFINITIONS } from './implants.js';
import { CARD_DEFINITIONS, BURDEN_CARD_DEF_BY_KIND } from './cards.js';
import { CONSUMABLE_DEFINITIONS } from './consumables.js';
import { WAREHOUSE_STARTING_POOL, FARMING_ONLY_POOL } from './loadoutPool.js';
import { getBurdenItems } from '../engine/inventoryEngine.js';
import { MAX_WEAPON_SLOTS, EMPTY_SLOT_FILLER_COUNT } from '../engine/equipmentEngine.js';

/** @typedef {import('../engine/types.js').Loadout} Loadout */
/** @typedef {import('../engine/types.js').Inventory} Inventory */

export const CATEGORIES = [
  { key: 'weapon', label: '무기', defs: WEAPON_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.weapons, ...FARMING_ONLY_POOL.weapons], slotType: 'weapon', max: 2, iconColor: 'var(--color-accent)' },
  { key: 'top', label: '상의', defs: ARMOR_TOP_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.tops, ...FARMING_ONLY_POOL.tops], slotType: 'top', max: 1, iconColor: 'var(--color-neutral-700)' },
  { key: 'bottom', label: '하의', defs: ARMOR_BOTTOM_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.bottoms, ...FARMING_ONLY_POOL.bottoms], slotType: 'bottom', max: 1, iconColor: 'var(--color-neutral-700)' },
  { key: 'module', label: '모듈', defs: MODULE_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.modules, ...FARMING_ONLY_POOL.modules], slotType: 'module', max: 2, iconColor: 'var(--color-accent-2-700)' },
  { key: 'implant', label: '임플란트', defs: IMPLANT_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.implants, ...FARMING_ONLY_POOL.implants], slotType: 'implant', max: 3, iconColor: 'var(--color-accent-2-700)' },
  { key: 'consumable', label: '소모품', defs: null, pool: null, slotType: null, max: null, iconColor: 'var(--color-neutral-700)' },
];

/**
 * weapon/top/bottom/module은 §신규 인스턴스화로 Item 전체를 반환하고(내구도 포함), 임플란트만
 * 여전히 defId 문자열을 반환한다(인스턴스화 대상 제외).
 * @param {Loadout} loadout
 * @param {Object} cat
 * @returns {(import('../engine/types.js').Item|string)[]}
 */
export function getSelectedIds(loadout, cat) {
  if (cat.key === 'weapon') return loadout.weapons;
  if (cat.key === 'top') return loadout.top ? [loadout.top] : [];
  if (cat.key === 'bottom') return loadout.bottom ? [loadout.bottom] : [];
  if (cat.key === 'module') return loadout.modules;
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
  const entries = getSelectedIds(loadout, cat);
  const isImplant = cat.key === 'implant';
  const slots = [];
  for (let i = 0; i < cat.max; i++) {
    const entry = entries[i];
    const equipmentId = isImplant ? entry : entry?.equipmentId;
    const def = equipmentId ? cat.defs[equipmentId] : null;
    slots.push({
      key: `${cat.key}${i}`,
      catKey: cat.key,
      equipmentId: equipmentId || null,
      itemId: isImplant ? null : (entry?.id || null),
      durability: isImplant ? undefined : entry?.durability,
      category: cat.max > 1 ? `${cat.label}${i + 1}` : cat.label,
      filled: !!def,
      name: def?.name,
      cardCount: cardCountOf(def),
      description: def?.description,
      cardList: def?.cardList,
    });
  }
  return slots;
}

/**
 * 소모품 퀵슬롯(고정 3칸)은 다른 장비 슬롯과 달리 defId가 아니라 인벤토리 itemId로 식별된다
 * (같은 소모품을 여러 개 동시 장착할 수 있어서 defId만으로는 구분이 안 됨).
 * @param {Loadout} loadout
 * @returns {Object[]}
 */
export function buildConsumableSlots(loadout) {
  return loadout.consumableSlots.map((item, i) => {
    const def = item ? CONSUMABLE_DEFINITIONS[item.defId ?? ''] : null;
    return {
      key: `consumable${i}`,
      catKey: 'consumable',
      itemId: item?.id || null,
      defId: item?.defId || null,
      category: '소모품',
      filled: !!item,
      name: def?.name,
      description: def?.description,
    };
  });
}

/** @param {Loadout} loadout @returns {Object[]} */
export function buildAllEquipSlots(loadout) {
  return [
    ...buildSlots(CATEGORIES[0], loadout),
    ...buildSlots(CATEGORIES[1], loadout),
    ...buildSlots(CATEGORIES[2], loadout),
    ...buildSlots(CATEGORIES[3], loadout),
    ...buildSlots(CATEGORIES[4], loadout),
    ...buildConsumableSlots(loadout),
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
      if (cardDef.requiresWeapon && !loadout.weapons.some((w) => w.equipmentId === cardDef.requiresWeapon)) continue;
      for (let i = 0; i < entry.count; i++) cards.push({ name: cardDef.name, defId: entry.defId });
    }
    if (cards.length) groups.push({ name, color, cards });
  };
  loadout.weapons.forEach((item) => WEAPON_DEFINITIONS[item.equipmentId] && pushGroup(WEAPON_DEFINITIONS[item.equipmentId].name, 'var(--color-accent)', WEAPON_DEFINITIONS[item.equipmentId].cardList));
  if (loadout.top) pushGroup(ARMOR_TOP_DEFINITIONS[loadout.top.equipmentId].name, 'var(--color-neutral-700)', ARMOR_TOP_DEFINITIONS[loadout.top.equipmentId].cardList);
  if (loadout.bottom) pushGroup(ARMOR_BOTTOM_DEFINITIONS[loadout.bottom.equipmentId].name, 'var(--color-neutral-700)', ARMOR_BOTTOM_DEFINITIONS[loadout.bottom.equipmentId].cardList);
  loadout.modules.forEach((item) => MODULE_DEFINITIONS[item.equipmentId] && pushGroup(MODULE_DEFINITIONS[item.equipmentId].name, 'var(--color-accent-2-700)', MODULE_DEFINITIONS[item.equipmentId].cardList));

  // 무기/상의/하의 미장착 슬롯 보충 카드(맨손공격/어설픈 회피) — equipmentEngine.buildDeckFromLoadout과 동일 규칙.
  const emptyWeaponSlots = Math.max(0, MAX_WEAPON_SLOTS - loadout.weapons.length);
  if (emptyWeaponSlots > 0) pushGroup('맨손 (미장착 무기)', 'var(--color-neutral-500)', [{ defId: 'bare_hands_attack', count: emptyWeaponSlots * EMPTY_SLOT_FILLER_COUNT }]);
  const emptyArmorSlots = (loadout.top ? 0 : 1) + (loadout.bottom ? 0 : 1);
  if (emptyArmorSlots > 0) pushGroup('맨몸 (미장착 상/하의)', 'var(--color-neutral-500)', [{ defId: 'clumsy_dodge', count: emptyArmorSlots * EMPTY_SLOT_FILLER_COUNT }]);

  return groups;
}

/**
 * 과적(짐) 상태 아이템이 덱에 편입하는 status 카드 — kind별로 묶어서 보여준다. 각 카드에
 * 연결된 원본 Item을 함께 실어, 툴팁에서 "어떤 아이템 때문에 생긴 카드인지" 보여줄 수 있게 한다.
 * @param {?Inventory} inventory
 * @returns {{name: string, color: string, cards: {name: string, defId: string, item: import('../engine/types.js').Item}[]}[]}
 */
export function buildBurdenGroups(inventory) {
  if (!inventory) return [];
  /** @type {Object.<string, import('../engine/types.js').Item[]>} */
  const byKind = {};
  for (const item of getBurdenItems(inventory)) {
    const defId = BURDEN_CARD_DEF_BY_KIND[item.kind];
    if (!defId) continue;
    (byKind[defId] ||= []).push(item);
  }
  return Object.entries(byKind).map(([defId, items]) => {
    const def = CARD_DEFINITIONS[defId];
    return {
      name: `[짐] ${def.name}`, color: 'var(--color-neutral-600)',
      cards: items.map((item) => ({ name: def.name, defId, item })),
    };
  });
}
