// Loadout -> deck / stat derivation (docs/game-rules.md).
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../data/equipment.js';
import { MODULE_DEFINITIONS } from '../data/modules.js';
import { IMPLANT_DEFINITIONS } from '../data/implants.js';
import { CARD_DEFINITIONS } from '../data/cards.js';

/** @typedef {import('./types.js').Loadout} Loadout */
/** @typedef {import('./types.js').Item} Item */

export const MAX_WEAPON_SLOTS = 2;
export const EMPTY_SLOT_FILLER_COUNT = 3;

// 장비 내구도(§신규): 최대 10, 드랍 시 3~9 랜덤(rewardEngine.rollLootDurability), 시작 장비는
// 항상 10. (4-내구도) >= 1 이면 그만큼 손상 상태이상 카드가 그 전투에만 삽입된다.
export const MAX_DURABILITY = 10;
const DAMAGED_STATUS_CARD_THRESHOLD = 4;
const DAMAGED_STATUS_CARD_DEF_ID = 'equipment_damaged_status_card';

/**
 * @param {{defId: string, count: number}[]} cardList
 * @param {?string} equipmentInstanceId source Item.id, so combatEngine can attribute decay checks
 * @returns {{defId: string, equipmentInstanceId?: string}[]}
 */
function expandCardList(cardList, equipmentInstanceId) {
  const entries = [];
  for (const entry of cardList) {
    for (let i = 0; i < entry.count; i++) {
      entries.push(equipmentInstanceId ? { defId: entry.defId, equipmentInstanceId } : { defId: entry.defId });
    }
  }
  return entries;
}

/**
 * @param {Loadout} loadout
 * @returns {{defId: string, equipmentInstanceId?: string}[]} equipment cards (each tagged with
 *   the source instance) plus filler cards for empty slots (untagged)
 */
export function buildDeckFromLoadout(loadout) {
  const weapons = loadout.weapons || [];
  const entries = [];
  for (const item of weapons) {
    const def = WEAPON_DEFINITIONS[item.equipmentId];
    if (def) entries.push(...expandCardList(def.cardList, item.id));
  }
  // 무기·모듈과 같은 가드다 — 카탈로그에 없는 equipmentId(옛 세이브, 손으로 만든 스냅샷)가
  // 오면 덱 구성이 통째로 터지는 대신 그 칸만 비운다.
  const topDef = loadout.top ? ARMOR_TOP_DEFINITIONS[loadout.top.equipmentId] : null;
  if (topDef) entries.push(...expandCardList(topDef.cardList, loadout.top.id));
  const bottomDef = loadout.bottom ? ARMOR_BOTTOM_DEFINITIONS[loadout.bottom.equipmentId] : null;
  if (bottomDef) entries.push(...expandCardList(bottomDef.cardList, loadout.bottom.id));
  for (const item of loadout.modules || []) {
    const def = MODULE_DEFINITIONS[item.equipmentId];
    if (!def) continue;
    for (const cardEntry of def.cardList) {
      const cardDef = CARD_DEFINITIONS[cardEntry.defId];
      // 돌진 베기: 카타나 장착 시에만 덱에 추가.
      if (cardDef.requiresWeapon && !weapons.some((w) => w.equipmentId === cardDef.requiresWeapon)) continue;
      for (let i = 0; i < cardEntry.count; i++) entries.push({ defId: cardEntry.defId, equipmentInstanceId: item.id });
    }
  }

  // 무기 미장착 슬롯 1칸당 맨손공격 3장, 상의/하의 미장착 슬롯 1칸당 어설픈 회피 3장을 보충한다.
  const emptyWeaponSlots = Math.max(0, MAX_WEAPON_SLOTS - weapons.length);
  for (let i = 0; i < emptyWeaponSlots * EMPTY_SLOT_FILLER_COUNT; i++) entries.push({ defId: 'bare_hands_attack' });
  const emptyArmorSlots = (loadout.top ? 0 : 1) + (loadout.bottom ? 0 : 1);
  for (let i = 0; i < emptyArmorSlots * EMPTY_SLOT_FILLER_COUNT; i++) entries.push({ defId: 'clumsy_dodge' });

  return entries;
}

/**
 * 장착된 무기/상의/하의/모듈 중 내구도 4 미만인 것마다 (4-내구도)장의 범용 "손상된 장비"
 * 상태이상 카드를 만든다 — 전투 시작 시 덱에만 삽입되고 인벤토리엔 남지 않는다(§신규 내구도).
 * 임플란트는 cardList가 없어 대상에서 제외.
 * @param {Loadout} loadout
 * @returns {{defId: string}[]}
 */
export function computeDamagedStatusCardEntries(loadout) {
  const instances = [
    ...(loadout.weapons || []), loadout.top, loadout.bottom, ...(loadout.modules || []),
  ].filter(Boolean);
  const entries = [];
  for (const item of instances) {
    const count = Math.max(0, DAMAGED_STATUS_CARD_THRESHOLD - item.durability);
    for (let i = 0; i < count; i++) entries.push({ defId: DAMAGED_STATUS_CARD_DEF_ID });
  }
  return entries;
}

/**
 * 전투 중 축적된 내구도 감소 판정(equipmentInstanceId별 카운트)을 로드아웃에 실제로 적용.
 * 0이 된 장비는 슬롯에서 자동 해제되어 destroyedItems로 반환된다(호출자가 인벤토리에 되돌림 —
 * 파괴됐지만 삭제되진 않음, 수리 시스템 없음이라 재장착만 막힘).
 * @param {Loadout} loadout
 * @param {string[]} decayInstanceIds durabilityDecayInstanceIds — 반복 가능(인스턴스당 1개씩 누적)
 * @returns {{loadout: Loadout, destroyedItems: Item[], changes: {itemId: string, equipmentId: string, from: number, to: number}[]}}
 */
export function applyDurabilityDecay(loadout, decayInstanceIds) {
  if (!decayInstanceIds || decayInstanceIds.length === 0) return { loadout, destroyedItems: [], changes: [] };

  const decayCounts = new Map();
  for (const id of decayInstanceIds) decayCounts.set(id, (decayCounts.get(id) || 0) + 1);

  const destroyedItems = [];
  const changes = [];
  /** @param {Item} item @returns {?Item} null if destroyed */
  const decay = (item) => {
    const loss = decayCounts.get(item.id);
    if (!loss) return item;
    const to = Math.max(0, item.durability - loss);
    changes.push({ itemId: item.id, equipmentId: item.equipmentId, from: item.durability, to });
    if (to <= 0) { destroyedItems.push({ ...item, durability: 0 }); return null; }
    return { ...item, durability: to };
  };

  const weapons = (loadout.weapons || []).map(decay).filter(Boolean);
  const modules = (loadout.modules || []).map(decay).filter(Boolean);
  const top = loadout.top ? decay(loadout.top) : loadout.top;
  const bottom = loadout.bottom ? decay(loadout.bottom) : loadout.bottom;

  return { loadout: { ...loadout, weapons, top, bottom, modules }, destroyedItems, changes };
}

/**
 * 장착된 무기들의 maxLoadBonus 합산 — 통합 장전 풀(§신규 재장전)의 최대치.
 * @param {Loadout} loadout
 * @returns {number}
 */
export function computeMaxLoadBonus(loadout) {
  return (loadout.weapons || []).reduce((sum, item) => sum + (WEAPON_DEFINITIONS[item.equipmentId]?.maxLoadBonus || 0), 0);
}

/**
 * @param {Loadout} loadout
 * @returns {Object[]} the `effect` object of each equipped implant
 */
function implantEffects(loadout) {
  return (loadout.implantIds || []).map((id) => IMPLANT_DEFINITIONS[id]).filter(Boolean).flatMap((d) => d.effects);
}

/** @param {Loadout} loadout @returns {number} */
export function computeMaxHpBonus(loadout) {
  return implantEffects(loadout).filter((e) => e.kind === 'maxHpBonus').reduce((s, e) => s + e.amount, 0);
}

/** @param {Loadout} loadout @returns {number} */
export function computeInventoryCapacityBonus(loadout) {
  return implantEffects(loadout).filter((e) => e.kind === 'inventoryBonus').reduce((s, e) => s + e.amount, 0);
}

/**
 * @param {Loadout} loadout
 * @param {string} kind
 * @returns {?Object}
 */
export function getImplantEffect(loadout, kind) {
  return implantEffects(loadout).find((e) => e.kind === kind) || null;
}
