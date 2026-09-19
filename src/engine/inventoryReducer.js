// 장비 교체 / 아이템 정리 커맨드 (창고·맵 화면에서만 — 전투 중엔 불가) — gameReducer.js의
// 책임 분리(§코드 리뷰) 중 인벤토리/장비 묶음. Equipment 카탈로그 조회(getAllEquipmentIds/
// getEquipmentCategory)와 슬롯 정원(SLOT_LIMITS)도 여기 둔다 — loadoutReducer.js(자동 장착)와
// rewardReducer.js/facilityReducer.js(파밍/보상 롤)가 공통으로 가져다 쓴다.
import {
  addItem, removeItem, createItem,
} from './inventoryEngine.js';
import { MAX_DURABILITY } from './equipmentEngine.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../data/equipment.js';
import { MODULE_DEFINITIONS } from '../data/modules.js';
import { IMPLANT_DEFINITIONS } from '../data/implants.js';

/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */

export const SLOT_LIMITS = { weapons: 2, modules: 2, implantIds: 3 };

const EQUIP_ALLOWED_SCREENS = ['loadout', 'map'];

/** @returns {string[]} */
export function getAllEquipmentIds() {
  return [
    ...Object.keys(WEAPON_DEFINITIONS), ...Object.keys(ARMOR_TOP_DEFINITIONS), ...Object.keys(ARMOR_BOTTOM_DEFINITIONS),
    ...Object.keys(MODULE_DEFINITIONS), ...Object.keys(IMPLANT_DEFINITIONS),
  ];
}

/**
 * @param {string} equipmentId
 * @returns {?('weapon'|'top'|'bottom'|'module'|'implant')}
 */
export function getEquipmentCategory(equipmentId) {
  if (WEAPON_DEFINITIONS[equipmentId]) return 'weapon';
  if (ARMOR_TOP_DEFINITIONS[equipmentId]) return 'top';
  if (ARMOR_BOTTOM_DEFINITIONS[equipmentId]) return 'bottom';
  if (MODULE_DEFINITIONS[equipmentId]) return 'module';
  if (IMPLANT_DEFINITIONS[equipmentId]) return 'implant';
  return null;
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
export function equipItem(snapshot, itemId) {
  return equipItemFrom(snapshot, 'inventory', itemId);
}

/**
 * 창고 아이템을 장비 슬롯으로 바로 드래그하면 인벤토리를 거치지 않고 곧장 장착된다(짐을 지지
 * 않고 바로 장착하는 지름길). 밀려나는 기존 장비/소모품은 항상 인벤토리로 들어간다 — 이미
 * 런에 들고 나가는 중이던 것이므로 창고로 되돌리지 않는다.
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
export function equipItemFromWarehouse(snapshot, itemId) {
  // 창고는 홈베이스다 — 맵에 나가 있는 동안에는 손이 닿지 않는다. 이 경로만 화면 제한이
  // 빠져 있어서 맵에서 창고 장비를 시간 0칸에 꺼내 장착할 수 있었다(리뷰 A7).
  // moveItemBetweenCollections와 같은 규칙으로 맞춘다.
  if (snapshot.currentScreen !== 'loadout') return snapshot;
  return equipItemFrom(snapshot, 'warehouse', itemId);
}

/**
 * @param {GameSnapshot} snapshot
 * @param {'inventory'|'warehouse'} fromKey
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
export function equipItemFrom(snapshot, fromKey, itemId) {
  if (!EQUIP_ALLOWED_SCREENS.includes(snapshot.currentScreen)) return snapshot;
  const ps = snapshot.playerState;
  const item = ps[fromKey].items.find((i) => i.id === itemId);
  if (!item) return snapshot;
  if (item.kind === 'consumable') return equipConsumableFrom(snapshot, fromKey, item);
  if (item.kind !== 'equipment') return snapshot;
  // 파손(내구도 0) 장비는 수리 시스템이 아직 없어 재장착 불가(§신규 내구도).
  // 장비 Item은 생성 때 언제나 durability/equipmentId를 받는다(equipmentEngine) — 아래 두
  // 기본값은 타입만 좁힌다.
  if ((item.durability ?? MAX_DURABILITY) <= 0) return snapshot;
  const equipmentId = item.equipmentId ?? '';
  const category = getEquipmentCategory(equipmentId);
  if (!category) return snapshot;

  let loadout = ps.loadout;
  let inventory = fromKey === 'inventory' ? removeItem(ps.inventory, itemId) : ps.inventory;
  const warehouse = fromKey === 'warehouse' ? removeItem(ps.warehouse, itemId) : ps.warehouse;
  // 밀려나는 무기/상의/하의/모듈은 인스턴스 전체(내구도 포함)를 그대로 인벤토리로 되돌린다.
  /** @param {import('./types.js').Item} bumpedItem */
  const bumpItemToInventory = (bumpedItem) => { const { id, ...rest } = bumpedItem; inventory = addItem(inventory, rest); };
  // 임플란트는 여전히 defId 문자열로만 로드아웃에 저장되므로(§신규 인스턴스화 제외 대상),
  // 밀려날 때 새 인스턴스로 재생성한다 — 내구도는 원래 무의미하므로 손실이 아니다.
  /** @param {string} bumpedEquipmentId */
  const bumpImplantToInventory = (bumpedEquipmentId) => { inventory = addItem(inventory, createItem('equipment', { equipmentId: bumpedEquipmentId, durability: MAX_DURABILITY })); };

  if (category === 'implant') {
    if (loadout.implantIds.includes(equipmentId)) return snapshot;
    let ids = loadout.implantIds;
    if (ids.length >= SLOT_LIMITS.implantIds) {
      bumpImplantToInventory(ids[0]);
      ids = ids.slice(1);
    }
    loadout = { ...loadout, implantIds: [...ids, equipmentId] };
  } else if (category === 'top' || category === 'bottom') {
    const prev = loadout[category];
    if (prev) bumpItemToInventory(prev);
    loadout = { ...loadout, [category]: item };
  } else {
    // 무기/모듈은 §신규 인스턴스화로 같은 종류 중복 장착도 허용된다.
    const key = category === 'weapon' ? 'weapons' : 'modules';
    let items = loadout[key];
    if (items.length >= SLOT_LIMITS[key]) {
      bumpItemToInventory(items[0]);
      items = items.slice(1);
    }
    loadout = { ...loadout, [key]: [...items, item] };
  }

  return { ...snapshot, playerState: { ...ps, loadout, inventory, warehouse } };
}

/**
 * 무기/상의/하의/모듈 전용 — §신규 인스턴스화 이후 같은 종류를 중복 장착할 수 있어 defId만으론
 * 어느 걸 해제할지 특정할 수 없으므로, 인스턴스 id(itemId) 기준으로 식별한다. 임플란트는
 * unequipImplant를 사용.
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
export function unequipItem(snapshot, itemId) {
  if (!EQUIP_ALLOWED_SCREENS.includes(snapshot.currentScreen)) return snapshot;
  const ps = snapshot.playerState;
  let loadout = ps.loadout;
  let removed = null;

  if (loadout.top && loadout.top.id === itemId) { removed = loadout.top; loadout = { ...loadout, top: null }; }
  else if (loadout.bottom && loadout.bottom.id === itemId) { removed = loadout.bottom; loadout = { ...loadout, bottom: null }; }
  else if (loadout.weapons.some((w) => w.id === itemId)) { removed = loadout.weapons.find((w) => w.id === itemId); loadout = { ...loadout, weapons: loadout.weapons.filter((w) => w.id !== itemId) }; }
  else if (loadout.modules.some((m) => m.id === itemId)) { removed = loadout.modules.find((m) => m.id === itemId); loadout = { ...loadout, modules: loadout.modules.filter((m) => m.id !== itemId) }; }
  else return snapshot;

  if (!removed) return snapshot; // 위 분기가 이미 찾아낸 항목이라 실제로는 걸리지 않는다.
  const { id, ...rest } = removed;
  const inventory = addItem(ps.inventory, rest);
  return { ...snapshot, playerState: { ...ps, loadout, inventory } };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} equipmentId
 * @returns {GameSnapshot}
 */
export function unequipImplant(snapshot, equipmentId) {
  if (!EQUIP_ALLOWED_SCREENS.includes(snapshot.currentScreen)) return snapshot;
  const ps = snapshot.playerState;
  const loadout = ps.loadout;
  if (!loadout.implantIds.includes(equipmentId)) return snapshot;
  const newLoadout = { ...loadout, implantIds: loadout.implantIds.filter((id) => id !== equipmentId) };
  const inventory = addItem(ps.inventory, createItem('equipment', { equipmentId, durability: MAX_DURABILITY }));
  return { ...snapshot, playerState: { ...ps, loadout: newLoadout, inventory } };
}

/**
 * 퀵슬롯(고정 3칸)에 소모품 아이템을 장착 — 원본 Item을 통째로 빼내 슬롯에 넣는다(itemId
 * 보존). 슬롯이 다 찼으면 가장 오래 장착된 것을 인벤토리로 되돌린다(창고에서 바로 장착한
 * 경우도 밀려나는 소모품은 인벤토리로 — 이미 런에 들고 나가는 중이던 것이므로).
 * @param {GameSnapshot} snapshot
 * @param {'inventory'|'warehouse'} fromKey
 * @param {import('./types.js').Item} item
 * @returns {GameSnapshot}
 */
export function equipConsumableFrom(snapshot, fromKey, item) {
  const ps = snapshot.playerState;
  let inventory = fromKey === 'inventory' ? removeItem(ps.inventory, item.id) : ps.inventory;
  const warehouse = fromKey === 'warehouse' ? removeItem(ps.warehouse, item.id) : ps.warehouse;
  let slots = ps.loadout.consumableSlots;
  const emptyIndex = slots.indexOf(null);
  if (emptyIndex !== -1) {
    slots = slots.map((s, i) => (i === emptyIndex ? item : s));
  } else {
    // emptyIndex가 -1이므로 0번 칸은 비어 있지 않다 — 옵셔널 체이닝은 타입만 좁힌다.
    inventory = addItem(inventory, createItem('consumable', { defId: slots[0]?.defId }));
    slots = [...slots.slice(1), item];
  }
  const loadout = { ...ps.loadout, consumableSlots: slots };
  return { ...snapshot, playerState: { ...ps, loadout, inventory, warehouse } };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
export function unequipConsumable(snapshot, itemId) {
  if (!EQUIP_ALLOWED_SCREENS.includes(snapshot.currentScreen)) return snapshot;
  const ps = snapshot.playerState;
  const slotIndex = ps.loadout.consumableSlots.findIndex((it) => it?.id === itemId);
  if (slotIndex === -1) return snapshot;
  const item = ps.loadout.consumableSlots[slotIndex];
  const consumableSlots = ps.loadout.consumableSlots.map((it, i) => (i === slotIndex ? null : it));
  const loadout = { ...ps.loadout, consumableSlots };
  const inventory = addItem(ps.inventory, createItem('consumable', { defId: item?.defId }));
  return { ...snapshot, playerState: { ...ps, loadout, inventory } };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
export function discardItem(snapshot, itemId) {
  if (!EQUIP_ALLOWED_SCREENS.includes(snapshot.currentScreen)) return snapshot;
  const ps = snapshot.playerState;
  if (ps.inventory.items.some((i) => i.id === itemId)) {
    return { ...snapshot, playerState: { ...ps, inventory: removeItem(ps.inventory, itemId) } };
  }
  // 창고 물건 버리기도 홈베이스에서만 — 맵에서는 창고 자체에 접근할 수 없다(리뷰 A7).
  if (snapshot.currentScreen === 'loadout' && ps.warehouse.items.some((i) => i.id === itemId)) {
    return { ...snapshot, playerState: { ...ps, warehouse: removeItem(ps.warehouse, itemId) } };
  }
  return snapshot;
}

/**
 * 창고(무제한) ⇄ 인벤토리(용량 제한) 간 아이템 이동 — 창고 화면에서만 가능(맵/전투 중엔
 * 홈베이스에 접근할 수 없음). 이동한 아이템은 새 컬렉션의 id를 새로 발급받는다(장비
 * 장착/해제와 동일한 관례).
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @param {'inventory'|'warehouse'} fromKey
 * @param {'inventory'|'warehouse'} toKey
 * @returns {GameSnapshot}
 */
export function moveItemBetweenCollections(snapshot, itemId, fromKey, toKey) {
  if (snapshot.currentScreen !== 'loadout') return snapshot;
  const ps = snapshot.playerState;
  const item = ps[fromKey].items.find((i) => i.id === itemId);
  if (!item) return snapshot;
  const { id, ...rest } = item;
  const from = removeItem(ps[fromKey], itemId);
  const to = addItem(ps[toKey], rest);
  return { ...snapshot, playerState: { ...ps, [fromKey]: from, [toKey]: to } };
}
