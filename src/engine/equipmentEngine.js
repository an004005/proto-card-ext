// Loadout -> deck / stat derivation (기획서 §5, §10, §16 "덱빌딩 = 로드아웃 구성").
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../data/equipment.js';
import { MODULE_DEFINITIONS } from '../data/modules.js';
import { IMPLANT_DEFINITIONS } from '../data/implants.js';
import { CARD_DEFINITIONS } from '../data/cards.js';

/** @typedef {import('./types.js').Loadout} Loadout */

/**
 * @param {{defId: string, count: number}[]} cardList
 * @returns {string[]}
 */
function expandCardList(cardList) {
  const defIds = [];
  for (const entry of cardList) {
    for (let i = 0; i < entry.count; i++) defIds.push(entry.defId);
  }
  return defIds;
}

/**
 * @param {Loadout} loadout
 * @returns {string[]} flat list of card defIds (with duplicates for multi-count entries)
 */
export function buildDeckFromLoadout(loadout) {
  const weaponIds = loadout.weaponIds || [];
  const defIds = [];
  for (const id of weaponIds) {
    const def = WEAPON_DEFINITIONS[id];
    if (def) defIds.push(...expandCardList(def.cardList));
  }
  if (loadout.topId) defIds.push(...expandCardList(ARMOR_TOP_DEFINITIONS[loadout.topId].cardList));
  if (loadout.bottomId) defIds.push(...expandCardList(ARMOR_BOTTOM_DEFINITIONS[loadout.bottomId].cardList));
  for (const id of loadout.moduleIds || []) {
    const def = MODULE_DEFINITIONS[id];
    if (!def) continue;
    for (const entry of def.cardList) {
      const cardDef = CARD_DEFINITIONS[entry.defId];
      // 돌진 베기: 카타나 장착 시에만 덱에 추가 (기획서 §9 모듈2).
      if (cardDef.requiresWeapon && !weaponIds.includes(cardDef.requiresWeapon)) continue;
      for (let i = 0; i < entry.count; i++) defIds.push(entry.defId);
    }
  }
  return defIds;
}

/**
 * @param {Loadout} loadout
 * @returns {Object[]} the `effect` object of each equipped implant
 */
function implantEffects(loadout) {
  return (loadout.implantIds || []).map((id) => IMPLANT_DEFINITIONS[id]).filter(Boolean).map((d) => d.effect);
}

/** @param {Loadout} loadout @returns {number} */
export function computeFloorOverload(loadout) {
  return (loadout.implantIds || []).reduce((sum, id) => sum + (IMPLANT_DEFINITIONS[id]?.floorOverload || 0), 0);
}

/** @param {Loadout} loadout @returns {number} */
export function computeMaxHpBonus(loadout) {
  return implantEffects(loadout).filter((e) => e.kind === 'maxHpBonus').reduce((s, e) => s + e.amount, 0);
}

/** @param {Loadout} loadout @returns {number} */
export function computeInventoryCapacityBonus(loadout) {
  return implantEffects(loadout).filter((e) => e.kind === 'inventoryBonus').reduce((s, e) => s + e.amount, 0);
}

/** @param {Loadout} loadout @returns {number} */
export function computeOverloadGainMultiplier(loadout) {
  return implantEffects(loadout).filter((e) => e.kind === 'overloadGainMultiplier').reduce((m, e) => m * e.multiplier, 1);
}

/**
 * @param {Loadout} loadout
 * @param {string} kind
 * @returns {?Object}
 */
export function getImplantEffect(loadout, kind) {
  return implantEffects(loadout).find((e) => e.kind === kind) || null;
}
