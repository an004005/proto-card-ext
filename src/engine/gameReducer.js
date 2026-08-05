// Pure command reducer: (GameSnapshot, command) => GameSnapshot. No Preact/DOM dependency —
// the whole run (loadout -> 10 floors -> extraction/death) can be played headlessly with
// `node --test`. state/dispatch.js is the only caller that wires this to signals.
import { createRngState, nextFloat } from './rng.js';
import { applyStatus, applyDamage } from './statusEngine.js';
import { reduceOverload } from './overloadEngine.js';
import {
  createCombatState, beginPlayerFirst, beginEnemyFirst, playCard, advanceTurn, checkWinLoss,
} from './combatEngine.js';
import {
  createStageState, getCurrentStep, advanceStage, resolveUnknownRoomOutcome, pickUnknownRoomMonster,
} from './stageEngine.js';
import { rollBasicDrop, rollFarmLoot } from './dropEngine.js';
import {
  buildDeckFromLoadout, computeFloorOverload, computeMaxHpBonus, computeInventoryCapacityBonus,
  computeOverloadGainMultiplier, getImplantEffect,
} from './equipmentEngine.js';
import { createInventory, addItem, removeItem, createItem, isItemBurdenGivenOrder } from './inventoryEngine.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../data/equipment.js';
import { MODULE_DEFINITIONS } from '../data/modules.js';
import { IMPLANT_DEFINITIONS } from '../data/implants.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { WAREHOUSE_STARTING_POOL, STARTING_AMMO } from '../data/loadoutPool.js';
import { POST_COMBAT_CHOICES } from '../data/dropTables.js';

export const BASE_MAX_HP = 70;
export const BASE_INVENTORY_CAPACITY = 20;
const SLOT_LIMITS = { weaponIds: 2, moduleIds: 2, implantIds: 3 };

export function gameReducer(snapshot, command) {
  switch (command.type) {
    case 'NEW_RUN': return newRun(command.seed);
    case 'SET_LOADOUT_SLOT': return setLoadoutSlot(snapshot, command.slotType, command.id);
    case 'CONFIRM_LOADOUT': return confirmLoadout(snapshot);
    case 'ENTER_STEP': return enterStep(snapshot);
    case 'SKIP_UNKNOWN_ROOM': return skipUnknownRoom(snapshot);
    case 'PLAY_CARD': return playCardCommand(snapshot, command.instanceId, command.targetId);
    case 'END_TURN': return endTurnCommand(snapshot);
    case 'USE_CONSUMABLE': return useConsumable(snapshot, command.defId);
    case 'POST_COMBAT_CHOICE': return postCombatChoice(snapshot, command.choice);
    case 'CONFIRM_LOOT_CHOICE': return confirmLootChoice(snapshot, command.keepIndices);
    default:
      throw new Error(`Unknown command type "${command.type}"`);
  }
}

// ---- run / loadout ----

function defaultLoadout() {
  return {
    weaponIds: [...WAREHOUSE_STARTING_POOL.weapons],
    topId: WAREHOUSE_STARTING_POOL.tops[0],
    bottomId: WAREHOUSE_STARTING_POOL.bottoms[0],
    moduleIds: [...WAREHOUSE_STARTING_POOL.modules],
    implantIds: [...WAREHOUSE_STARTING_POOL.implants],
    consumables: WAREHOUSE_STARTING_POOL.consumables.map((c) => ({ ...c })),
  };
}

function newRun(seed) {
  return {
    currentScreen: 'loadout',
    playerState: {
      hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, ammo: STARTING_AMMO, overload: 0,
      loadout: defaultLoadout(),
      inventory: createInventory(BASE_INVENTORY_CAPACITY),
    },
    stageState: createStageState(),
    activeCombatState: null,
    combatContext: null,
    pendingLoot: null,
    rngState: createRngState(seed),
  };
}

function updateLoadout(snapshot, patch) {
  return { ...snapshot, playerState: { ...snapshot.playerState, loadout: { ...snapshot.playerState.loadout, ...patch } } };
}

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

function confirmLoadout(snapshot) {
  if (snapshot.currentScreen !== 'loadout') return snapshot;
  const loadout = snapshot.playerState.loadout;
  const maxHp = BASE_MAX_HP + computeMaxHpBonus(loadout);
  const floor = computeFloorOverload(loadout);
  const capacity = BASE_INVENTORY_CAPACITY + computeInventoryCapacityBonus(loadout);
  const playerState = {
    ...snapshot.playerState, hp: maxHp, maxHp, ammo: STARTING_AMMO, overload: floor,
    inventory: createInventory(capacity),
  };
  return { ...snapshot, playerState, stageState: createStageState(), currentScreen: 'stage' };
}

// ---- deck / combat setup ----

function getAllEquipmentIds() {
  return [
    ...Object.keys(WEAPON_DEFINITIONS), ...Object.keys(ARMOR_TOP_DEFINITIONS), ...Object.keys(ARMOR_BOTTOM_DEFINITIONS),
    ...Object.keys(MODULE_DEFINITIONS), ...Object.keys(IMPLANT_DEFINITIONS),
  ];
}

function getOwnedEquipmentIds(loadout) {
  return [loadout.topId, loadout.bottomId, ...loadout.weaponIds, ...loadout.moduleIds, ...loadout.implantIds].filter(Boolean);
}

export function getDeckEntries(playerState) {
  const equipmentEntries = buildDeckFromLoadout(playerState.loadout).map((defId) => ({ defId }));
  const inv = playerState.inventory;
  const orderedIds = inv.items.map((i) => i.id);
  // 잡템·환금템 모두 과적(짐) 상태로 넘어간 것만 저주 카드로 덱에 들어간다.
  const lootEntries = inv.items
    .filter((i) => (i.kind === 'junk' || i.kind === 'currency') && isItemBurdenGivenOrder(orderedIds, [], inv.capacity, i.id))
    .map((i) => ({ defId: i.kind === 'junk' ? 'junk_item' : 'currency_item', itemId: i.id }));
  return [...equipmentEntries, ...lootEntries];
}

function startCombat(snapshot, monsterIds, hpMultiplier, isAmbush, context) {
  const ps = snapshot.playerState;
  const loadout = ps.loadout;
  const extraDrawImplant = getImplantEffect(loadout, 'extraDrawPerTurn');
  const aoeImplant = getImplantEffect(loadout, 'turnStartAoeDamage');

  let combat = createCombatState({
    deckEntries: getDeckEntries(ps), monsterIds, hpMultiplier,
    playerHp: ps.hp, playerMaxHp: ps.maxHp, ammo: ps.ammo,
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
  return { ...snapshot, activeCombatState: combat, currentScreen: 'combat', rngState: combat.rngState, combatContext: context };
}

// ---- stage progression ----

function enterStep(snapshot) {
  if (snapshot.currentScreen !== 'stage') return snapshot;
  const step = getCurrentStep(snapshot.stageState);
  if (!step) return snapshot;

  if (step.type === 'combat') {
    return startCombat(snapshot, step.monsterIds, step.hpMultiplier, false, { kind: 'step', tier: step.tier || 'normal' });
  }

  // unknown_room (§13.1): 전투 30% / 휴식 30% / 빈 방 40%.
  const roll = resolveUnknownRoomOutcome(snapshot.rngState);
  let s = { ...snapshot, rngState: roll.state };
  if (roll.value === 'empty') return { ...s, stageState: advanceStage(s.stageState) };
  if (roll.value === 'rest') return { ...applyRest(s), stageState: advanceStage(s.stageState) };

  const picked = pickUnknownRoomMonster(step.floor, s.rngState);
  s = { ...s, rngState: picked.rngState };
  return startCombat(s, [picked.monsterId], undefined, false, { kind: 'unknown_room', tier: 'normal' });
}

function skipUnknownRoom(snapshot) {
  if (snapshot.currentScreen !== 'stage') return snapshot;
  const step = getCurrentStep(snapshot.stageState);
  if (!step || step.type !== 'unknown_room') return snapshot;
  return { ...snapshot, stageState: advanceStage(snapshot.stageState) };
}

// ---- combat actions ----

function playCardCommand(snapshot, instanceId, targetId) {
  if (!snapshot.activeCombatState) return snapshot;
  const combat = playCard(snapshot.activeCombatState, instanceId, targetId);
  if (combat === snapshot.activeCombatState) return snapshot;
  return finalizeIfCombatEnded({ ...snapshot, activeCombatState: combat });
}

function endTurnCommand(snapshot) {
  if (!snapshot.activeCombatState) return snapshot;
  const combat = advanceTurn(snapshot.activeCombatState);
  return finalizeIfCombatEnded({ ...snapshot, activeCombatState: combat });
}

function useConsumable(snapshot, defId) {
  if (!snapshot.activeCombatState) return snapshot;
  const ps = snapshot.playerState;
  const owned = ps.loadout.consumables.find((c) => c.defId === defId);
  if (!owned || owned.count <= 0) return snapshot;
  const def = CONSUMABLE_DEFINITIONS[defId];
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

  const loadout = {
    ...ps.loadout,
    consumables: ps.loadout.consumables
      .map((c) => (c.defId === defId ? { ...c, count: c.count - 1 } : c))
      .filter((c) => c.count > 0),
  };
  return finalizeIfCombatEnded({ ...snapshot, activeCombatState: combat, playerState: { ...ps, loadout } });
}

function finalizeIfCombatEnded(snapshot) {
  const combat = snapshot.activeCombatState;
  if (!combat || (combat.phase !== 'victory' && combat.phase !== 'defeat')) return snapshot;

  if (combat.phase === 'defeat') {
    return { ...snapshot, activeCombatState: null, currentScreen: 'gameOver', combatContext: null };
  }

  const ps = snapshot.playerState;
  let inventory = ps.inventory;
  for (const itemId of combat.player.removedItemIds) inventory = removeItem(inventory, itemId);
  const playerState = { ...ps, hp: combat.player.hp, overload: combat.overload, ammo: combat.player.ammo, inventory };
  let s = { ...snapshot, playerState, activeCombatState: null, combatContext: null };

  const context = snapshot.combatContext;
  if (context && context.kind === 'ambush') {
    return applyBasicDrop(s, 'normal', { kind: 'advance_stage' });
  }

  const tier = (context && context.tier) || 'normal';
  const next = tier === 'boss' ? { kind: 'extractionComplete' } : { kind: 'post_combat' };
  return applyBasicDrop(s, tier, next);
}

// ---- loot pickup choice (전투/파밍에서 나온 잡템·환금템·장비는 개별로 습득 여부 선택) ----

function startLootChoice(snapshot, items, next) {
  if (items.length === 0) return resolveLootNext(snapshot, next);
  return { ...snapshot, pendingLoot: { items, next }, currentScreen: 'loot_choice' };
}

function confirmLootChoice(snapshot, keepIndices) {
  if (snapshot.currentScreen !== 'loot_choice' || !snapshot.pendingLoot) return snapshot;
  const { items, next } = snapshot.pendingLoot;
  let inv = snapshot.playerState.inventory;
  for (const idx of keepIndices) {
    const item = items[idx];
    if (!item) continue;
    if (item.kind === 'junk') inv = addItem(inv, createItem('junk', { value: item.value }));
    else if (item.kind === 'currency') inv = addItem(inv, createItem('currency', { value: item.value }));
    else if (item.kind === 'equipment') inv = addItem(inv, createItem('equipment', { equipmentId: item.equipmentId }));
  }
  const s = { ...snapshot, playerState: { ...snapshot.playerState, inventory: inv }, pendingLoot: null };
  return resolveLootNext(s, next);
}

function resolveLootNext(snapshot, next) {
  if (next.kind === 'post_combat') return { ...snapshot, currentScreen: 'post_combat' };
  if (next.kind === 'extractionComplete') return { ...snapshot, currentScreen: 'extractionComplete' };
  if (next.kind === 'advance_stage') return { ...snapshot, stageState: advanceStage(snapshot.stageState), currentScreen: 'stage' };
  if (next.kind === 'ambush_check') {
    const ambushRoll = nextFloat(snapshot.rngState);
    let s = { ...snapshot, rngState: ambushRoll.state };
    if (ambushRoll.value < next.ambushChance) {
      const floor = getCurrentStep(s.stageState).floor;
      const picked = pickUnknownRoomMonster(floor, s.rngState);
      s = { ...s, rngState: picked.rngState };
      return startCombat(s, [picked.monsterId], undefined, true, { kind: 'ambush' });
    }
    return { ...s, stageState: advanceStage(s.stageState), currentScreen: 'stage' };
  }
  return snapshot;
}

// ---- post-combat 3-choice (§12.2) ----

function applyRest(snapshot) {
  const ps = snapshot.playerState;
  const rules = POST_COMBAT_CHOICES.rest;
  const hp = Math.min(ps.maxHp, ps.hp + Math.round(ps.maxHp * rules.hpRestorePercent));
  const overload = reduceOverload(ps.overload, rules.overloadReduce, computeFloorOverload(ps.loadout));
  return { ...snapshot, playerState: { ...ps, hp, overload } };
}

function addConsumableToLoadout(loadout, defId, count) {
  const existing = loadout.consumables.find((c) => c.defId === defId);
  if (existing) {
    return { ...loadout, consumables: loadout.consumables.map((c) => (c.defId === defId ? { ...c, count: c.count + count } : c)) };
  }
  return { ...loadout, consumables: [...loadout.consumables, { defId, count }] };
}

// Ammo/consumables never occupy an inventory slot, so they're auto-collected. Junk/currency
// (and, from the basic drop, equipment) do occupy a slot, so the player picks which to keep.
function applyFarm(snapshot, next) {
  const roll = rollFarmLoot(snapshot.rngState);
  let ps = snapshot.playerState;
  let ammo = ps.ammo;
  let loadout = ps.loadout;
  const lootItems = [];
  for (const item of roll.items) {
    if (item.kind === 'junk') lootItems.push({ kind: 'junk', value: item.value });
    else if (item.kind === 'currency') lootItems.push({ kind: 'currency', value: item.value });
    else if (item.kind === 'ammo') ammo += item.amount;
    else if (item.kind === 'consumable') loadout = addConsumableToLoadout(loadout, item.defId, 1);
  }
  const s = { ...snapshot, rngState: roll.rngState, playerState: { ...ps, ammo, loadout } };
  return startLootChoice(s, lootItems, next);
}

function applyBasicDrop(snapshot, tier, next) {
  const ps = snapshot.playerState;
  const owned = getOwnedEquipmentIds(ps.loadout);
  const { result, rngState } = rollBasicDrop(tier, owned, getAllEquipmentIds(), snapshot.rngState);
  let loadout = ps.loadout;
  if (result.consumableId) loadout = addConsumableToLoadout(loadout, result.consumableId, 1);
  const ammo = ps.ammo + result.ammo;
  const s = { ...snapshot, rngState, playerState: { ...ps, ammo, loadout } };

  const lootItems = [
    ...result.currencyValues.map((value) => ({ kind: 'currency', value })),
    ...(result.equipmentId ? [{ kind: 'equipment', equipmentId: result.equipmentId }] : []),
  ];
  return startLootChoice(s, lootItems, next);
}

function postCombatChoice(snapshot, choice) {
  if (snapshot.currentScreen !== 'post_combat') return snapshot;
  const rules = POST_COMBAT_CHOICES[choice];
  if (!rules) return snapshot;

  if (choice === 'move') return { ...snapshot, stageState: advanceStage(snapshot.stageState), currentScreen: 'stage' };
  if (choice === 'rest') return resolveLootNext(applyRest(snapshot), { kind: 'ambush_check', ambushChance: rules.ambushChance });
  return applyFarm(snapshot, { kind: 'ambush_check', ambushChance: rules.ambushChance }); // 'farm'
}
