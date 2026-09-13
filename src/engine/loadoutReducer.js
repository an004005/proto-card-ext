// 런 시작/출격 준비(로드아웃) 커맨드 — gameReducer.js의 책임 분리(§코드 리뷰) 중 로드아웃
// 묶음. inventoryReducer.js(장착 로직 재사용)와 runEngine.js(refreshLocalObservations)에만
// 의존한다 — facilityReducer.js/combatReducer.js/rewardReducer.js와는 무관하다(순환 없음).
import { createRngState, pick } from './rng.js';
import { generateFacilityGraph } from './facilityGraph.js';
import { createRunState, refreshLocalObservations } from './runEngine.js';
import { offerContracts } from './contractReducer.js';
import { computeCapabilities } from './capabilityEngine.js';
import {
  computeFloorOverload, computeMaxHpBonus, computeInventoryCapacityBonus, computeOverloadGainMultiplier, MAX_DURABILITY,
} from './equipmentEngine.js';
import { createInventory, addItem, removeItem, createItem, addAmmo } from './inventoryEngine.js';
import { WAREHOUSE_STARTING_POOL, FARMING_ONLY_POOL, STARTING_AMMO } from '../data/loadoutPool.js';
import { equipItemFrom, getEquipmentCategory, SLOT_LIMITS } from './inventoryReducer.js';

/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */
/** @typedef {import('./types.js').PlayerState} PlayerState */
/** @typedef {import('./types.js').Loadout} Loadout */
/** @typedef {import('./types.js').Inventory} Inventory */

export const BASE_MAX_HP = 70;
export const BASE_INVENTORY_CAPACITY = 10;
export const CONSUMABLE_SLOT_COUNT = 3;

// 창고 화면은 아무것도 장착되지 않은 상태로 시작한다 — 소유한 장비/소모품은 전부 창고에서
// 시작하고(buildStartingWarehouse), 플레이어가 직접 장비 슬롯으로 옮겨야 덱에 편입된다.
/** @returns {Loadout} */
function defaultLoadout() {
  return {
    weapons: [],
    top: null,
    bottom: null,
    modules: [],
    implantIds: [],
    consumableSlots: new Array(CONSUMABLE_SLOT_COUNT).fill(null),
  };
}

/**
 * 창고(warehouse)는 용량 제한이 없는 홈베이스 보관함 — 장착하지 않은 장비/소모품/탄약은 여기서
 * 시작하며, 인벤토리로 옮겨야("창고 ⇄ 인벤토리" 드래그) 비로소 런에 들고 나갈 짐이 된다.
 * 인벤토리는 빈 채로 시작한다 — 시작 탄환도 플레이어가 직접 인벤토리로 옮겨야 실제 런에
 * 반영된다(§ confirmLoadout은 더 이상 탄약을 자동으로 넣지 않음).
 * @param {Loadout} loadout
 * @returns {Inventory}
 */
function buildStartingWarehouse(loadout) {
  const equippedIds = new Set([
    loadout.top?.equipmentId, loadout.bottom?.equipmentId,
    ...loadout.weapons.map((i) => i.equipmentId), ...loadout.modules.map((i) => i.equipmentId),
    ...loadout.implantIds,
  ].filter(Boolean));
  const allPoolIds = [
    ...WAREHOUSE_STARTING_POOL.weapons, ...WAREHOUSE_STARTING_POOL.tops, ...WAREHOUSE_STARTING_POOL.bottoms,
    ...WAREHOUSE_STARTING_POOL.modules, ...WAREHOUSE_STARTING_POOL.implants,
    ...FARMING_ONLY_POOL.weapons, ...FARMING_ONLY_POOL.tops, ...FARMING_ONLY_POOL.bottoms,
    ...FARMING_ONLY_POOL.modules, ...FARMING_ONLY_POOL.implants,
  ];
  let warehouse = createInventory(Infinity, 'wh-item');
  for (const equipmentId of allPoolIds) {
    if (equippedIds.has(equipmentId)) continue;
    warehouse = addItem(warehouse, createItem('equipment', { equipmentId, durability: MAX_DURABILITY }));
  }
  for (const c of WAREHOUSE_STARTING_POOL.consumables) {
    const entry = typeof c === 'string' ? { defId: c, count: 1 } : c;
    for (let i = 0; i < entry.count; i++) warehouse = addItem(warehouse, createItem('consumable', { defId: entry.defId }));
  }
  warehouse = addAmmo(warehouse, STARTING_AMMO);
  return warehouse;
}

/** @param {number} seed @returns {GameSnapshot} */
export function newRun(seed) {
  const loadout = defaultLoadout();
  const rngState = createRngState(seed);
  const offered = offerContracts(rngState);
  return {
    currentScreen: 'contract',
    playerState: {
      hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, overload: 0,
      loadout,
      inventory: createInventory(BASE_INVENTORY_CAPACITY),
      warehouse: buildStartingWarehouse(loadout),
    },
    facilityRunState: null,
    activeCombatState: null,
    combatContext: null,
    pendingReward: null,
    combatSummary: null,
    rngState: offered.rngState,
    offeredContracts: offered.contracts,
    activeContract: null,
  };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {Partial<Loadout>} patch
 * @returns {GameSnapshot}
 */
function updateLoadout(snapshot, patch) {
  return { ...snapshot, playerState: { ...snapshot.playerState, loadout: { ...snapshot.playerState.loadout, ...patch } } };
}

/**
 * 임플란트 전용 — 무기/상의/하의/모듈은 인스턴스화(§신규) 이후 Item 전체를 저장하므로 defId
 * 문자열 토글만 하는 이 커맨드로는 다룰 수 없어져, EQUIP_ITEM(_FROM_WAREHOUSE)/UNEQUIP_ITEM
 * 경로로 일원화했다. 임플란트만 여전히 defId 문자열이라 이 경로가 남아 있다.
 * @param {GameSnapshot} snapshot
 * @param {'weapon'|'top'|'bottom'|'module'|'implant'} slotType
 * @param {string} id
 * @returns {GameSnapshot}
 */
export function setLoadoutSlot(snapshot, slotType, id) {
  if (snapshot.currentScreen !== 'loadout') return snapshot;
  if (slotType !== 'implant') return snapshot;
  const loadout = snapshot.playerState.loadout;
  const current = loadout.implantIds;
  if (current.includes(id)) return updateLoadout(snapshot, { implantIds: current.filter((x) => x !== id) });
  if (current.length >= SLOT_LIMITS.implantIds) return snapshot;
  return updateLoadout(snapshot, { implantIds: [...current, id] });
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function confirmLoadout(snapshot) {
  if (snapshot.currentScreen !== 'loadout') return snapshot;
  const loadout = snapshot.playerState.loadout;
  const maxHp = BASE_MAX_HP + computeMaxHpBonus(loadout);
  const floor = computeFloorOverload(loadout);
  const capacity = BASE_INVENTORY_CAPACITY + computeInventoryCapacityBonus(loadout);
  // 인벤토리로 옮겨둔 아이템(탄약 포함)은 그대로 런으로 이어간다 — 새로 만드는 건 용량 갱신뿐.
  // 탄약은 더 이상 여기서 자동 지급되지 않는다 — 창고에서 인벤토리로 직접 옮겨온 만큼만 시작 탄약이 된다.
  const inventory = { ...snapshot.playerState.inventory, capacity };
  const playerState = { ...snapshot.playerState, hp: maxHp, maxHp, overload: floor, inventory };
  const seed = snapshot.rngState;
  const { graph, rngState } = generateFacilityGraph(seed);
  const contract = snapshot.activeContract;
  const facilityRunState = refreshLocalObservations(createRunState(graph, seed, {
    overloadFloor: floor, overloadGainMultiplier: computeOverloadGainMultiplier(loadout),
    contract, revealLandmarkSectorIds: contract ? [contract.sectorId] : [],
  }), computeCapabilities(loadout).perception);
  return {
    ...snapshot, playerState, facilityRunState, rngState,
    currentScreen: 'map',
    // 계약 진행 상태는 이제 facilityRunState.contract가 유일한 소스다 — 죽은 스냅샷 필드를 남기지 않는다.
    activeContract: null,
  };
}

/**
 * Whether this stored item can fill a currently empty loadout slot.  Existing gear is never
 * displaced by auto-equip; the command only fills gaps.
 * @param {Loadout} loadout
 * @param {import('./types.js').Item} item
 */
function canFillEmptyLoadoutSlot(loadout, item) {
  if (item.kind === 'consumable') return loadout.consumableSlots.includes(null);
  if (item.kind !== 'equipment') return false;
  const category = getEquipmentCategory(item.equipmentId);
  if (category === 'top' || category === 'bottom') return !loadout[category];
  if (category === 'weapon') return loadout.weapons.length < SLOT_LIMITS.weapons;
  if (category === 'module') return loadout.modules.length < SLOT_LIMITS.modules;
  // 임플란트는 여전히 defId 중복 불가(같은 패시브 두 번 장착 방지) — 무기/모듈은 §신규
  // 인스턴스화로 중복 소유·장착이 허용되므로 여기서 dedup하지 않는다.
  if (category === 'implant') return loadout.implantIds.length < SLOT_LIMITS.implantIds && !loadout.implantIds.includes(item.equipmentId);
  return false;
}

/**
 * Fill every available empty loadout slot.  Inventory is always preferred; warehouse gear is
 * first transferred to inventory so it follows the normal inventory-equipping lifecycle.
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
export function autoEquipLoadout(snapshot) {
  if (snapshot.currentScreen !== 'loadout') return snapshot;
  let s = snapshot;
  while (true) {
    const ps = s.playerState;
    let source = 'inventory';
    let candidates = ps.inventory.items.filter((item) => canFillEmptyLoadoutSlot(ps.loadout, item));
    if (candidates.length === 0) {
      source = 'warehouse';
      candidates = ps.warehouse.items.filter((item) => canFillEmptyLoadoutSlot(ps.loadout, item));
    }
    if (candidates.length === 0) return s;

    const selected = pick(s.rngState, candidates);
    s = { ...s, rngState: selected.state };
    // 창고에서 온 물건은 인벤토리 id 규칙을 새로 받는다(addItem이 넘겨받은 id를 버린다) —
    // 그러니 장착할 때는 창고 시절 id가 아니라 방금 발급된 id를 써야 한다.
    let itemId = selected.value.id;
    if (source === 'warehouse') {
      const current = s.playerState;
      const inventory = addItem(current.inventory, selected.value);
      itemId = inventory.items[inventory.items.length - 1].id;
      s = {
        ...s,
        playerState: { ...current, inventory, warehouse: removeItem(current.warehouse, selected.value.id) },
      };
    }
    s = equipItemFrom(s, 'inventory', itemId);
  }
}
