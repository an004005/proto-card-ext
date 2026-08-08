// Pure command reducer: (GameSnapshot, command) => GameSnapshot. No Preact/DOM dependency —
// the whole run (loadout -> map -> extraction/death) can be played headlessly with
// `node --test`. state/dispatch.js is the only caller that wires this to signals.
import { createRngState, nextFloat, pick } from './rng.js';
import { applyStatus, applyDamage } from './statusEngine.js';
import { reduceOverload } from './overloadEngine.js';
import {
  createCombatState, beginPlayerFirst, beginEnemyFirst, playCard, advanceTurn, checkWinLoss,
} from './combatEngine.js';
import {
  generateMap, createMapState, getNode, getAvailableNodeIds, markNodeDone, pickAmbushEncounter,
} from './mapEngine.js';
import { rollRewardSlots } from './rewardEngine.js';
import {
  buildDeckFromLoadout, computeFloorOverload, computeMaxHpBonus, computeInventoryCapacityBonus,
  computeOverloadGainMultiplier, getImplantEffect,
} from './equipmentEngine.js';
import {
  createInventory, addItem, removeItem, createItem, isItemBurdenGivenOrder,
  addAmmo, getUsableAmmo, spendAmmo,
} from './inventoryEngine.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../data/equipment.js';
import { MODULE_DEFINITIONS } from '../data/modules.js';
import { IMPLANT_DEFINITIONS } from '../data/implants.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { BURDEN_CARD_DEF_BY_KIND } from '../data/cards.js';
import { WAREHOUSE_STARTING_POOL, FARMING_ONLY_POOL, STARTING_AMMO } from '../data/loadoutPool.js';
import { POST_COMBAT_CHOICES } from '../data/dropTables.js';
import { MAP_REST_HP_RESTORE_PERCENT } from '../data/mapLayout.js';

/** @typedef {import('./types.js').RngState} RngState */
/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */
/** @typedef {import('./types.js').PlayerState} PlayerState */
/** @typedef {import('./types.js').Loadout} Loadout */
/** @typedef {import('./types.js').Inventory} Inventory */

export const BASE_MAX_HP = 70;
export const BASE_INVENTORY_CAPACITY = 10;
const SLOT_LIMITS = { weaponIds: 2, moduleIds: 2, implantIds: 3 };
const CONSUMABLE_SLOT_COUNT = 3;

/**
 * `command` is a discriminated union keyed by `.type` (NEW_RUN, SET_LOADOUT_SLOT, ENTER_MAP_NODE,
 * PLAY_CARD, ...) — each branch destructures different fields, so it's typed loosely here rather
 * than spelled out as a full union.
 * @param {GameSnapshot} snapshot
 * @param {*} command
 * @returns {GameSnapshot}
 */
export function gameReducer(snapshot, command) {
  switch (command.type) {
    case 'NEW_RUN': return newRun(command.seed);
    case 'SET_LOADOUT_SLOT': return setLoadoutSlot(snapshot, command.slotType, command.id);
    case 'CONFIRM_LOADOUT': return confirmLoadout(snapshot);
    case 'AUTO_EQUIP_LOADOUT': return autoEquipLoadout(snapshot);
    case 'ENTER_MAP_NODE': return enterMapNode(snapshot, command.nodeId);
    case 'RESOLVE_UNKNOWN_ROOM_CHOICE': return resolveUnknownRoomChoice(snapshot, command.choice);
    case 'PLAY_CARD': return playCardCommand(snapshot, command.instanceId, command.targetId);
    case 'END_TURN': return endTurnCommand(snapshot);
    case 'USE_CONSUMABLE': return useConsumable(snapshot, command.itemId);
    case 'SELECT_REWARD': return selectReward(snapshot, command.slotKey, command.optionIndex);
    case 'CONFIRM_REWARDS': return confirmRewards(snapshot);
    case 'EQUIP_ITEM': return equipItem(snapshot, command.itemId);
    case 'EQUIP_ITEM_FROM_WAREHOUSE': return equipItemFromWarehouse(snapshot, command.itemId);
    case 'UNEQUIP_ITEM': return unequipItem(snapshot, command.equipmentId);
    case 'UNEQUIP_CONSUMABLE': return unequipConsumable(snapshot, command.itemId);
    case 'MOVE_TO_INVENTORY': return moveItemBetweenCollections(snapshot, command.itemId, 'warehouse', 'inventory');
    case 'MOVE_TO_WAREHOUSE': return moveItemBetweenCollections(snapshot, command.itemId, 'inventory', 'warehouse');
    case 'DISCARD_ITEM': return discardItem(snapshot, command.itemId);
    default:
      throw new Error(`Unknown command type "${command.type}"`);
  }
}

// ---- run / loadout ----

// 창고 화면은 아무것도 장착되지 않은 상태로 시작한다 — 소유한 장비/소모품은 전부 창고에서
// 시작하고(buildStartingWarehouse), 플레이어가 직접 장비 슬롯으로 옮겨야 덱에 편입된다.
/** @returns {Loadout} */
function defaultLoadout() {
  return {
    weaponIds: [],
    topId: null,
    bottomId: null,
    moduleIds: [],
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
  const equippedIds = new Set([loadout.topId, loadout.bottomId, ...loadout.weaponIds, ...loadout.moduleIds, ...loadout.implantIds].filter(Boolean));
  const allPoolIds = [
    ...WAREHOUSE_STARTING_POOL.weapons, ...WAREHOUSE_STARTING_POOL.tops, ...WAREHOUSE_STARTING_POOL.bottoms,
    ...WAREHOUSE_STARTING_POOL.modules, ...WAREHOUSE_STARTING_POOL.implants,
    ...FARMING_ONLY_POOL.weapons, ...FARMING_ONLY_POOL.tops, ...FARMING_ONLY_POOL.bottoms,
    ...FARMING_ONLY_POOL.modules, ...FARMING_ONLY_POOL.implants,
  ];
  let warehouse = createInventory(Infinity, 'wh-item');
  for (const equipmentId of allPoolIds) {
    if (equippedIds.has(equipmentId)) continue;
    warehouse = addItem(warehouse, createItem('equipment', { equipmentId }));
  }
  for (const c of WAREHOUSE_STARTING_POOL.consumables) {
    const entry = typeof c === 'string' ? { defId: c, count: 1 } : c;
    for (let i = 0; i < entry.count; i++) warehouse = addItem(warehouse, createItem('consumable', { defId: entry.defId }));
  }
  warehouse = addAmmo(warehouse, STARTING_AMMO);
  return warehouse;
}

/** @param {number} seed @returns {GameSnapshot} */
function newRun(seed) {
  const loadout = defaultLoadout();
  return {
    currentScreen: 'loadout',
    playerState: {
      hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, overload: 0,
      loadout,
      inventory: createInventory(BASE_INVENTORY_CAPACITY),
      warehouse: buildStartingWarehouse(loadout),
    },
    mapState: null,
    activeCombatState: null,
    combatContext: null,
    pendingReward: null,
    pendingUnknownNodeId: null,
    rngState: createRngState(seed),
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
 * @param {GameSnapshot} snapshot
 * @param {'weapon'|'top'|'bottom'|'module'|'implant'} slotType
 * @param {string} id
 * @returns {GameSnapshot}
 */
function setLoadoutSlot(snapshot, slotType, id) {
  if (snapshot.currentScreen !== 'loadout') return snapshot;
  const loadout = snapshot.playerState.loadout;
  if (slotType === 'top' || slotType === 'bottom') {
    const key = `${slotType}Id`;
    if (loadout[key] === id) return snapshot;
    return updateLoadout(snapshot, { [key]: id });
  }
  const key = `${slotType}Ids`;
  const current = loadout[key];
  if (!current) return snapshot;
  if (current.includes(id)) return updateLoadout(snapshot, { [key]: current.filter((x) => x !== id) });
  if (current.length >= SLOT_LIMITS[key]) return snapshot;
  return updateLoadout(snapshot, { [key]: [...current, id] });
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
function confirmLoadout(snapshot) {
  if (snapshot.currentScreen !== 'loadout') return snapshot;
  const loadout = snapshot.playerState.loadout;
  const maxHp = BASE_MAX_HP + computeMaxHpBonus(loadout);
  const floor = computeFloorOverload(loadout);
  const capacity = BASE_INVENTORY_CAPACITY + computeInventoryCapacityBonus(loadout);
  // 인벤토리로 옮겨둔 아이템(탄약 포함)은 그대로 런으로 이어간다 — 새로 만드는 건 용량 갱신뿐.
  // 탄약은 더 이상 여기서 자동 지급되지 않는다 — 창고에서 인벤토리로 직접 옮겨온 만큼만 시작 탄약이 된다.
  const inventory = { ...snapshot.playerState.inventory, capacity };
  const playerState = { ...snapshot.playerState, hp: maxHp, maxHp, overload: floor, inventory };
  const mapGen = generateMap(snapshot.rngState);
  return {
    ...snapshot, playerState, mapState: createMapState(mapGen.mapData), rngState: mapGen.rngState,
    currentScreen: 'map',
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
  if (category === 'top' || category === 'bottom') return !loadout[`${category}Id`];
  if (!category) return false;
  const key = `${category}Ids`;
  return loadout[key].length < SLOT_LIMITS[key] && !loadout[key].includes(item.equipmentId);
}

/**
 * Fill every available empty loadout slot.  Inventory is always preferred; warehouse gear is
 * first transferred to inventory so it follows the normal inventory-equipping lifecycle.
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
function autoEquipLoadout(snapshot) {
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
    if (source === 'warehouse') {
      const current = s.playerState;
      s = {
        ...s,
        playerState: {
          ...current,
          inventory: addItem(current.inventory, selected.value),
          warehouse: removeItem(current.warehouse, selected.value.id),
        },
      };
    }
    s = equipItemFrom(s, 'inventory', selected.value.id);
  }
}

// ---- deck / combat setup ----

/** @returns {string[]} */
function getAllEquipmentIds() {
  return [
    ...Object.keys(WEAPON_DEFINITIONS), ...Object.keys(ARMOR_TOP_DEFINITIONS), ...Object.keys(ARMOR_BOTTOM_DEFINITIONS),
    ...Object.keys(MODULE_DEFINITIONS), ...Object.keys(IMPLANT_DEFINITIONS),
  ];
}

/** @param {Loadout} loadout @returns {string[]} */
function getOwnedEquipmentIds(loadout) {
  return [loadout.topId, loadout.bottomId, ...loadout.weaponIds, ...loadout.moduleIds, ...loadout.implantIds].filter(Boolean);
}

/**
 * Reward equipment pool excludes anything already equipped OR sitting unequipped in inventory
 * (avoids handing out duplicate copies of gear the player already owns).
 * @param {PlayerState} ps
 * @returns {string[]}
 */
function getAllOwnedEquipmentIds(ps) {
  const equipped = getOwnedEquipmentIds(ps.loadout);
  const stored = ps.inventory.items.filter((i) => i.kind === 'equipment').map((i) => i.equipmentId);
  return [...equipped, ...stored];
}

/**
 * @param {string} equipmentId
 * @returns {?('weapon'|'top'|'bottom'|'module'|'implant')}
 */
function getEquipmentCategory(equipmentId) {
  if (WEAPON_DEFINITIONS[equipmentId]) return 'weapon';
  if (ARMOR_TOP_DEFINITIONS[equipmentId]) return 'top';
  if (ARMOR_BOTTOM_DEFINITIONS[equipmentId]) return 'bottom';
  if (MODULE_DEFINITIONS[equipmentId]) return 'module';
  if (IMPLANT_DEFINITIONS[equipmentId]) return 'implant';
  return null;
}

/**
 * @param {PlayerState} playerState
 * @returns {{defId: string, itemId?: string}[]}
 */
export function getDeckEntries(playerState) {
  const equipmentEntries = buildDeckFromLoadout(playerState.loadout).map((defId) => ({ defId }));
  const inv = playerState.inventory;
  const orderedIds = inv.items.map((i) => i.id);
  // 잡템·환금템·미장착 장비·탄약 모두 과적(짐) 상태로 넘어간 것만 저주 카드로 덱에 들어간다.
  const lootEntries = inv.items
    .filter((i) => BURDEN_CARD_DEF_BY_KIND[i.kind] && isItemBurdenGivenOrder(orderedIds, [], inv.capacity, i.id))
    .map((i) => ({ defId: BURDEN_CARD_DEF_BY_KIND[i.kind], itemId: i.id }));
  return [...equipmentEntries, ...lootEntries];
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string[]} monsterIds
 * @param {number|undefined} hpMultiplier
 * @param {boolean} isAmbush
 * @param {Object} context
 * @returns {GameSnapshot}
 */
function startCombat(snapshot, monsterIds, hpMultiplier, isAmbush, context) {
  const ps = snapshot.playerState;
  const loadout = ps.loadout;
  const extraDrawImplant = getImplantEffect(loadout, 'extraDrawPerTurn');
  const aoeImplant = getImplantEffect(loadout, 'turnStartAoeDamage');
  const usableAmmo = getUsableAmmo(ps.inventory);

  let combat = createCombatState({
    deckEntries: getDeckEntries(ps), monsterIds, hpMultiplier,
    playerHp: ps.hp, playerMaxHp: ps.maxHp, ammo: usableAmmo,
    overload: ps.overload, overloadFloor: computeFloorOverload(loadout),
    overloadGainMultiplier: computeOverloadGainMultiplier(loadout),
    extraDrawPerTurn: extraDrawImplant ? extraDrawImplant.amount : 0,
    turnStartAoeDamage: aoeImplant ? aoeImplant.amount : 0,
    inventoryItemIdsInOrder: ps.inventory.items.map((i) => i.id),
    inventoryCapacity: ps.inventory.capacity,
    hasBurdenItems: ps.inventory.items.length > ps.inventory.capacity,
    rngState: snapshot.rngState,
  });

  const debuff = getImplantEffect(loadout, 'combatStartDebuffAll');
  if (debuff) {
    combat = {
      ...combat,
      enemies: combat.enemies.map((e) => ({
        ...e,
        statuses: applyStatus(applyStatus(e.statuses, 'vulnerable', debuff.vulnerable), 'weak', debuff.weak),
      })),
    };
  }

  combat = isAmbush ? beginEnemyFirst(combat) : beginPlayerFirst(combat);
  return {
    ...snapshot, activeCombatState: combat, currentScreen: 'combat', rngState: combat.rngState,
    combatContext: { ...context, ammoAtStart: usableAmmo },
  };
}

// ---- map progression ----

/**
 * @param {GameSnapshot} snapshot
 * @param {string} nodeId
 * @returns {GameSnapshot}
 */
function enterMapNode(snapshot, nodeId) {
  if (snapshot.currentScreen !== 'map') return snapshot;
  const available = getAvailableNodeIds(snapshot.mapState);
  if (!available.includes(nodeId)) return snapshot;
  const node = getNode(snapshot.mapState, nodeId);
  if (!node) return snapshot;

  if (node.type === 'combat' || node.type === 'elite' || node.type === 'boss') {
    return startCombat(snapshot, node.encounter.monsterIds, undefined, false, { kind: 'map_node', nodeId, tier: node.encounter.tier });
  }

  if (node.type === 'rest') {
    const ps = snapshot.playerState;
    const hp = Math.min(ps.maxHp, ps.hp + Math.round(ps.maxHp * MAP_REST_HP_RESTORE_PERCENT));
    const mapState = markNodeDone(snapshot.mapState, nodeId);
    return { ...snapshot, playerState: { ...ps, hp }, mapState };
  }

  // unknown
  return { ...snapshot, currentScreen: 'unknown_room', pendingUnknownNodeId: nodeId };
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
function applyRest(snapshot) {
  const ps = snapshot.playerState;
  const rules = POST_COMBAT_CHOICES.rest;
  const hp = Math.min(ps.maxHp, ps.hp + Math.round(ps.maxHp * rules.hpRestorePercent));
  const overload = reduceOverload(ps.overload, rules.overloadReduce, computeFloorOverload(ps.loadout));
  return { ...snapshot, playerState: { ...ps, hp, overload } };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {'rest'|'farm'} choice
 * @returns {GameSnapshot}
 */
function resolveUnknownRoomChoice(snapshot, choice) {
  if (snapshot.currentScreen !== 'unknown_room') return snapshot;
  const rules = POST_COMBAT_CHOICES[choice];
  if (!rules) return snapshot;
  const nodeId = snapshot.pendingUnknownNodeId;

  let s = choice === 'rest' ? applyRest(snapshot) : snapshot;

  const ambushRoll = nextFloat(s.rngState);
  s = { ...s, rngState: ambushRoll.state };
  if (ambushRoll.value < rules.ambushChance) {
    const picked = pickAmbushEncounter(s.rngState);
    s = { ...s, rngState: picked.rngState };
    return startCombat(s, [picked.monsterIds[0]], undefined, true, { kind: 'ambush', nodeId, tier: 'normal' });
  }

  const mapState = markNodeDone(s.mapState, nodeId);
  return { ...s, mapState, pendingUnknownNodeId: null, currentScreen: 'map' };
}

// ---- combat actions ----

/**
 * @param {GameSnapshot} snapshot
 * @param {string} instanceId
 * @param {?string} targetId
 * @returns {GameSnapshot}
 */
function playCardCommand(snapshot, instanceId, targetId) {
  if (!snapshot.activeCombatState) return snapshot;
  const combat = playCard(snapshot.activeCombatState, instanceId, targetId);
  if (combat === snapshot.activeCombatState) return snapshot;
  return finalizeIfCombatEnded({ ...snapshot, activeCombatState: combat });
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
function endTurnCommand(snapshot) {
  if (!snapshot.activeCombatState) return snapshot;
  const combat = advanceTurn(snapshot.activeCombatState);
  return finalizeIfCombatEnded({ ...snapshot, activeCombatState: combat });
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
function useConsumable(snapshot, itemId) {
  if (!snapshot.activeCombatState) return snapshot;
  const ps = snapshot.playerState;
  const slotIndex = ps.loadout.consumableSlots.findIndex((it) => it?.id === itemId);
  if (slotIndex === -1) return snapshot;
  const def = CONSUMABLE_DEFINITIONS[ps.loadout.consumableSlots[slotIndex].defId];
  let combat = snapshot.activeCombatState;

  if (def.effect.kind === 'healPercent') {
    const heal = Math.round(combat.player.maxHp * def.effect.amount);
    combat = { ...combat, player: { ...combat.player, hp: Math.min(combat.player.maxHp, combat.player.hp + heal) } };
  } else if (def.effect.kind === 'reduceOverload') {
    combat = { ...combat, overload: reduceOverload(combat.overload, def.effect.amount, combat.overloadFloor) };
  } else if (def.effect.kind === 'aoeDamage') {
    combat = { ...combat, enemies: combat.enemies.map((e) => (e.hp > 0 ? applyDamage(e, def.effect.amount, false) : e)) };
  } else if (def.effect.kind === 'aoeDebuff') {
    combat = {
      ...combat,
      enemies: combat.enemies.map((e) => (e.hp > 0
        ? { ...e, statuses: applyStatus(applyStatus(e.statuses, 'vulnerable', def.effect.vulnerable), 'weak', def.effect.weak) }
        : e)),
    };
  }
  combat = checkWinLoss(combat);

  const consumableSlots = ps.loadout.consumableSlots.map((it, i) => (i === slotIndex ? null : it));
  const loadout = { ...ps.loadout, consumableSlots };
  return finalizeIfCombatEnded({ ...snapshot, activeCombatState: combat, playerState: { ...ps, loadout } });
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
function finalizeIfCombatEnded(snapshot) {
  const combat = snapshot.activeCombatState;
  if (!combat || (combat.phase !== 'victory' && combat.phase !== 'defeat')) return snapshot;

  if (combat.phase === 'defeat') {
    return { ...snapshot, activeCombatState: null, currentScreen: 'gameOver', combatContext: null };
  }

  const ps = snapshot.playerState;
  let inventory = ps.inventory;
  for (const itemId of combat.player.removedItemIds) inventory = removeItem(inventory, itemId);
  const ammoAtStart = (snapshot.combatContext && snapshot.combatContext.ammoAtStart) || 0;
  const ammoSpent = Math.max(0, ammoAtStart - combat.player.ammo);
  if (ammoSpent > 0) inventory = spendAmmo(inventory, ammoSpent);
  const playerState = { ...ps, hp: combat.player.hp, overload: combat.overload, inventory };
  const s = { ...snapshot, playerState, activeCombatState: null };

  const context = snapshot.combatContext;
  const tier = context && context.kind === 'ambush' ? 'normal' : ((context && context.tier) || 'normal');
  const nodeId = context && context.nodeId;
  return startReward(s, tier, nodeId);
}

// ---- post-combat reward screen (§신규, replaces the old 3택1 post_combat screen) ----

/**
 * @param {GameSnapshot} snapshot
 * @param {'normal'|'elite'|'boss'} tier
 * @param {?string} nodeId
 * @returns {GameSnapshot}
 */
function startReward(snapshot, tier, nodeId) {
  const ps = snapshot.playerState;
  const owned = getAllOwnedEquipmentIds(ps);
  const { slots, rngState } = rollRewardSlots(tier, owned, getAllEquipmentIds(), snapshot.rngState);
  return {
    ...snapshot, rngState,
    pendingReward: { slots, selections: {}, nodeId, tier },
    combatContext: null,
    currentScreen: 'reward',
  };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} slotKey
 * @param {number} optionIndex
 * @returns {GameSnapshot}
 */
function selectReward(snapshot, slotKey, optionIndex) {
  if (snapshot.currentScreen !== 'reward' || !snapshot.pendingReward) return snapshot;
  const selections = { ...snapshot.pendingReward.selections };
  if (selections[slotKey] === optionIndex) delete selections[slotKey];
  else selections[slotKey] = optionIndex;
  return { ...snapshot, pendingReward: { ...snapshot.pendingReward, selections } };
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
function confirmRewards(snapshot) {
  if (snapshot.currentScreen !== 'reward' || !snapshot.pendingReward) return snapshot;
  const { slots, selections, nodeId, tier } = snapshot.pendingReward;
  let ps = snapshot.playerState;
  let inventory = ps.inventory;

  for (const slot of slots) {
    const idx = selections[slot.key];
    if (idx === undefined) continue;
    const opt = slot.options[idx];
    if (!opt) continue;
    if (opt.kind === 'equipment') inventory = addItem(inventory, createItem('equipment', { equipmentId: opt.equipmentId }));
    else if (opt.kind === 'currency') inventory = addItem(inventory, createItem('currency', { value: opt.value }));
    else if (opt.kind === 'junk') inventory = addItem(inventory, createItem('junk', { value: opt.value }));
    else if (opt.kind === 'ammo') inventory = addAmmo(inventory, opt.amount);
    else if (opt.kind === 'consumable') inventory = addItem(inventory, createItem('consumable', { defId: opt.defId }));
  }

  ps = { ...ps, inventory };
  const s = { ...snapshot, playerState: ps, pendingReward: null };

  if (tier === 'boss') return { ...s, currentScreen: 'extractionComplete' };

  const mapState = markNodeDone(s.mapState, nodeId);
  return { ...s, mapState, currentScreen: 'map' };
}

// ---- 장비 교체 / 아이템 정리 (창고·맵 화면에서만 — 전투 중엔 불가) ----

const EQUIP_ALLOWED_SCREENS = ['loadout', 'map'];

/**
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
function equipItem(snapshot, itemId) {
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
function equipItemFromWarehouse(snapshot, itemId) {
  return equipItemFrom(snapshot, 'warehouse', itemId);
}

/**
 * @param {GameSnapshot} snapshot
 * @param {'inventory'|'warehouse'} fromKey
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
function equipItemFrom(snapshot, fromKey, itemId) {
  if (!EQUIP_ALLOWED_SCREENS.includes(snapshot.currentScreen)) return snapshot;
  const ps = snapshot.playerState;
  const item = ps[fromKey].items.find((i) => i.id === itemId);
  if (!item) return snapshot;
  if (item.kind === 'consumable') return equipConsumableFrom(snapshot, fromKey, item);
  if (item.kind !== 'equipment') return snapshot;
  const equipmentId = item.equipmentId;
  const category = getEquipmentCategory(equipmentId);
  if (!category) return snapshot;

  let loadout = ps.loadout;
  let inventory = fromKey === 'inventory' ? removeItem(ps.inventory, itemId) : ps.inventory;
  const warehouse = fromKey === 'warehouse' ? removeItem(ps.warehouse, itemId) : ps.warehouse;
  /** @param {string} bumpedEquipmentId */
  const bumpToInventory = (bumpedEquipmentId) => { inventory = addItem(inventory, createItem('equipment', { equipmentId: bumpedEquipmentId })); };

  if (category === 'top' || category === 'bottom') {
    const key = `${category}Id`;
    const prevId = loadout[key];
    if (prevId) bumpToInventory(prevId);
    loadout = { ...loadout, [key]: equipmentId };
  } else {
    const key = `${category}Ids`;
    let ids = loadout[key];
    if (ids.includes(equipmentId)) return snapshot;
    if (ids.length >= SLOT_LIMITS[key]) {
      bumpToInventory(ids[0]);
      ids = ids.slice(1);
    }
    loadout = { ...loadout, [key]: [...ids, equipmentId] };
  }

  return { ...snapshot, playerState: { ...ps, loadout, inventory, warehouse } };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} equipmentId
 * @returns {GameSnapshot}
 */
function unequipItem(snapshot, equipmentId) {
  if (!EQUIP_ALLOWED_SCREENS.includes(snapshot.currentScreen)) return snapshot;
  const ps = snapshot.playerState;
  const category = getEquipmentCategory(equipmentId);
  if (!category) return snapshot;
  let loadout = ps.loadout;

  if (category === 'top' || category === 'bottom') {
    const key = `${category}Id`;
    if (loadout[key] !== equipmentId) return snapshot;
    loadout = { ...loadout, [key]: null };
  } else {
    const key = `${category}Ids`;
    if (!loadout[key].includes(equipmentId)) return snapshot;
    loadout = { ...loadout, [key]: loadout[key].filter((id) => id !== equipmentId) };
  }

  const inventory = addItem(ps.inventory, createItem('equipment', { equipmentId }));
  return { ...snapshot, playerState: { ...ps, loadout, inventory } };
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
function equipConsumableFrom(snapshot, fromKey, item) {
  const ps = snapshot.playerState;
  let inventory = fromKey === 'inventory' ? removeItem(ps.inventory, item.id) : ps.inventory;
  const warehouse = fromKey === 'warehouse' ? removeItem(ps.warehouse, item.id) : ps.warehouse;
  let slots = ps.loadout.consumableSlots;
  const emptyIndex = slots.indexOf(null);
  if (emptyIndex !== -1) {
    slots = slots.map((s, i) => (i === emptyIndex ? item : s));
  } else {
    inventory = addItem(inventory, createItem('consumable', { defId: slots[0].defId }));
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
function unequipConsumable(snapshot, itemId) {
  if (!EQUIP_ALLOWED_SCREENS.includes(snapshot.currentScreen)) return snapshot;
  const ps = snapshot.playerState;
  const slotIndex = ps.loadout.consumableSlots.findIndex((it) => it?.id === itemId);
  if (slotIndex === -1) return snapshot;
  const item = ps.loadout.consumableSlots[slotIndex];
  const consumableSlots = ps.loadout.consumableSlots.map((it, i) => (i === slotIndex ? null : it));
  const loadout = { ...ps.loadout, consumableSlots };
  const inventory = addItem(ps.inventory, createItem('consumable', { defId: item.defId }));
  return { ...snapshot, playerState: { ...ps, loadout, inventory } };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
function discardItem(snapshot, itemId) {
  if (!EQUIP_ALLOWED_SCREENS.includes(snapshot.currentScreen)) return snapshot;
  const ps = snapshot.playerState;
  if (ps.inventory.items.some((i) => i.id === itemId)) {
    return { ...snapshot, playerState: { ...ps, inventory: removeItem(ps.inventory, itemId) } };
  }
  if (ps.warehouse.items.some((i) => i.id === itemId)) {
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
function moveItemBetweenCollections(snapshot, itemId, fromKey, toKey) {
  if (snapshot.currentScreen !== 'loadout') return snapshot;
  const ps = snapshot.playerState;
  const item = ps[fromKey].items.find((i) => i.id === itemId);
  if (!item) return snapshot;
  const { id, ...rest } = item;
  const from = removeItem(ps[fromKey], itemId);
  const to = addItem(ps[toKey], rest);
  return { ...snapshot, playerState: { ...ps, [fromKey]: from, [toKey]: to } };
}
