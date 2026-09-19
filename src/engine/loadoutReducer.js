// 런 시작/출격 준비(로드아웃) 커맨드 — gameReducer.js의 책임 분리(§코드 리뷰) 중 로드아웃
// 묶음. inventoryReducer.js(장착 로직 재사용)와 runEngine.js(refreshLocalObservations)에만
// 의존한다 — facilityReducer.js/combatReducer.js/rewardReducer.js와는 무관하다(순환 없음).
import { createRngState, pick } from './rng.js';
import { generateFacilityGraph } from './facilityGraph.js';
import { createRunState, refreshLocalObservations } from './runEngine.js';
import { offerContracts } from './contractReducer.js';
import { computeCapabilities } from './capabilityEngine.js';
import {
  computeMaxHpBonus, computeInventoryCapacityBonus, MAX_DURABILITY,
} from './equipmentEngine.js';
import { createInventory, addItem, removeItem, createItem, addAmmo } from './inventoryEngine.js';
import { WAREHOUSE_STARTING_POOL, FARMING_ONLY_POOL, STARTING_AMMO } from '../data/loadoutPool.js';
import { getLoadoutPreset, presetEquipmentIds } from '../data/loadoutPresets.js';
import { equipItemFrom, getEquipmentCategory, SLOT_LIMITS } from './inventoryReducer.js';

/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */
/** @typedef {import('./types.js').PlayerState} PlayerState */
/** @typedef {import('./types.js').Loadout} Loadout */
/** @typedef {import('./types.js').Inventory} Inventory */

export const BASE_MAX_HP = 40;

// 오버라이드 칩 시작 개수. 지도와 전투가 같은 통을 쓰므로(ADR-0086) 이 하나가 두 화면의
// 예산 전부다 — 런당 세 번의 "지금 밀어붙인다"다(처음 안 5개에서 밸런스로 내렸다 — ADR-0086).
export const START_OVERRIDE_CHIPS = 3;
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
  // 제안은 여덟 구역 전부에서 유형별 한 장씩 나온다(ADR-0083). 구역 추첨은 제안마다 여기서
  // 함께 돌아(ADR-0089) 각 제안의 `sectorIds`에 적힌다 — 계약 화면이 "이 계약을 고르면 이런
  // 시설"을 미리 보여줄 수 있어야 하기 때문이다. 스냅샷의 runSectorIds는 아직 null이고,
  // ACCEPT_CONTRACT가 고른 제안의 목록을 그대로 옮겨 담는다.
  const offered = offerContracts(createRngState(seed));
  return {
    currentScreen: 'contract',
    playerState: {
      hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, overloadActive: false,
      overrideChips: START_OVERRIDE_CHIPS,
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
    runSectorIds: null,
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
  const capacity = BASE_INVENTORY_CAPACITY + computeInventoryCapacityBonus(loadout);
  // 인벤토리로 옮겨둔 아이템(탄약 포함)은 그대로 런으로 이어간다 — 새로 만드는 건 용량 갱신뿐.
  // 탄약은 더 이상 여기서 자동 지급되지 않는다 — 창고에서 인벤토리로 직접 옮겨온 만큼만 시작 탄약이 된다.
  const inventory = { ...snapshot.playerState.inventory, capacity };
  const playerState = { ...snapshot.playerState, hp: maxHp, maxHp, inventory };
  const seed = snapshot.rngState;
  const contract = snapshot.activeContract;
  const { graph, rngState } = generateFacilityGraph(seed, snapshot.runSectorIds ?? undefined, contract?.sectorId);
  const facilityRunState = refreshLocalObservations(createRunState(graph, seed, {
    contract, revealLandmarkSectorIds: contract ? [contract.sectorId] : [],
  }), computeCapabilities(loadout).perception);
  return {
    ...snapshot, playerState, facilityRunState, rngState,
    currentScreen: 'map',
    // 계약 진행 상태는 이제 facilityRunState.contract가 유일한 소스다 — 죽은 스냅샷 필드를 남기지 않는다.
    activeContract: null,
  };
}

// ---- 역할군 프리셋 (data/loadoutPresets.js) ----

/**
 * 장착된 것을 전부 창고로 되돌린다. 해제(unequipItem)가 인벤토리로 보내는 것과 다른 점이 여기다 —
 * 프리셋은 "지금 짠 구성을 갈아엎는" 행동이므로, 밀려난 장비가 인벤토리에 쌓여 용량을 먹으면
 * 프리셋을 눌러 볼수록 짐이 늘어난다. 창고는 용량이 없으니 몇 번을 눌러도 상태가 같다.
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
function returnLoadoutToWarehouse(snapshot) {
  const ps = snapshot.playerState;
  const loadout = ps.loadout;
  let warehouse = ps.warehouse;
  // 창고로 넘어가는 물건은 창고 id를 새로 발급받는다(addItem이 넘겨받은 id를 버린다).
  const store = (item) => { const { id, ...rest } = item; warehouse = addItem(warehouse, rest); };
  for (const weapon of loadout.weapons) store(weapon);
  if (loadout.top) store(loadout.top);
  if (loadout.bottom) store(loadout.bottom);
  for (const moduleItem of loadout.modules) store(moduleItem);
  // 임플란트만은 로드아웃에 defId 문자열로 사는지라(§신규 인스턴스화 제외 대상) 새로 만든다.
  for (const equipmentId of loadout.implantIds) {
    warehouse = addItem(warehouse, createItem('equipment', { equipmentId, durability: MAX_DURABILITY }));
  }
  for (const slot of loadout.consumableSlots) {
    if (slot) warehouse = addItem(warehouse, createItem('consumable', { defId: slot.defId }));
  }
  return { ...snapshot, playerState: { ...ps, warehouse, loadout: defaultLoadout() } };
}

/**
 * 창고에서 이 정의의 물건을 하나 집어 장착한다. 없으면 스냅샷을 그대로 돌려준다.
 * @param {GameSnapshot} snapshot
 * @param {(item: import('./types.js').Item) => boolean} matches
 * @returns {GameSnapshot}
 */
function equipFirstFromWarehouse(snapshot, matches) {
  const item = snapshot.playerState.warehouse.items.find(matches);
  if (!item) return snapshot;
  return equipItemFrom(snapshot, 'warehouse', item.id);
}

/**
 * 역할군 프리셋을 통째로 적용한다 — 화면은 dispatch를 한 번만 쏘고, 되돌리기도 한 칸이다.
 *
 * 순서는 (1) 장착된 것을 전부 창고로 되돌리고 (2) 프리셋 목록을 적힌 순서대로 장착이다. 순서가
 * 중요한 이유는 슬롯 정원을 넘기면 equipItemFrom이 가장 오래된 것을 밀어내기 때문이다 — 먼저
 * 비워 두면 밀려나는 일 자체가 없고, 그래서 두 번 눌러도 결과가 같다.
 *
 * 창고에 없는 항목은 건너뛰고 `appliedLoadoutPreset.missing`에 남긴다. 조용히 빠지면 플레이어는
 * 프리셋이 약속한 Capability와 실제 수치가 왜 다른지 알 수 없다.
 * @param {GameSnapshot} snapshot
 * @param {string} presetId
 * @returns {GameSnapshot}
 */
export function applyLoadoutPreset(snapshot, presetId) {
  if (snapshot.currentScreen !== 'loadout') return snapshot;
  const preset = getLoadoutPreset(presetId);
  if (!preset) return snapshot;

  let s = returnLoadoutToWarehouse(snapshot);
  /** @type {string[]} */
  const missing = [];

  for (const equipmentId of presetEquipmentIds(preset)) {
    const next = equipFirstFromWarehouse(s, (item) => item.kind === 'equipment' && item.equipmentId === equipmentId && item.durability > 0);
    if (next === s) missing.push(equipmentId);
    s = next;
  }
  for (const defId of preset.consumables) {
    const next = equipFirstFromWarehouse(s, (item) => item.kind === 'consumable' && item.defId === defId);
    if (next === s) missing.push(defId);
    s = next;
  }

  return { ...s, appliedLoadoutPreset: { presetId: preset.id, missing } };
}

/**
 * `appliedLoadoutPreset`은 "지금 장착된 것이 그 프리셋 그대로"라는 뜻이다 — 장비를 하나라도
 * 손대면 더 이상 참이 아니므로 표시를 내린다. 남겨 두면 프리셋 버튼이 계속 눌린 채로 보이고
 * 「창고에 없음」 줄도 더는 맞지 않는 목록을 가리킨다.
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
export function clearAppliedLoadoutPreset(snapshot) {
  if (!snapshot || !snapshot.appliedLoadoutPreset) return snapshot;
  const { appliedLoadoutPreset, ...rest } = snapshot;
  return rest;
}

/**
 * 이 프리셋을 그대로 장착했을 때의 여섯 Capability — 버튼의 미리보기가 읽는 값이다. 창고 사정을
 * 보지 않는 "정의상의 값"이므로, 실제 적용 결과와는 빠진 항목만큼 달라질 수 있다(그래서 화면이
 * 「창고에 없음」을 함께 적는다).
 * @param {import('../data/loadoutPresets.js').LoadoutPreset} preset
 * @returns {import('./types.js').CapabilityValues}
 */
export function previewPresetCapabilities(preset) {
  return computeCapabilities({
    weapons: preset.weapons.map((equipmentId) => ({ equipmentId })),
    top: preset.top ? { equipmentId: preset.top } : null,
    bottom: preset.bottom ? { equipmentId: preset.bottom } : null,
    modules: preset.modules.map((equipmentId) => ({ equipmentId })),
    implantIds: preset.implants,
    consumableSlots: [],
  });
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
