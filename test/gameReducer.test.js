import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer } from '../src/engine/gameReducer.js';
import { isCardPlayable } from '../src/engine/combatEngine.js';
import { getAvailableNodeIds } from '../src/engine/mapEngine.js';

function autoPlayCombat(snapshot, guardLimit = 100) {
  let s = snapshot;
  let guard = 0;
  while (s.currentScreen === 'combat' && guard < guardLimit) {
    const combat = s.activeCombatState;
    const aliveEnemy = combat.enemies.find((e) => e.hp > 0);
    const attack = combat.piles.hand.find(
      (c) => c.defId.includes('slash') || c.defId.includes('shot') || c.defId.includes('stab') || c.defId.includes('aim'),
    );
    const playable = attack && isCardPlayable(combat, attack.instanceId);
    if (playable && aliveEnemy) s = gameReducer(s, { type: 'PLAY_CARD', instanceId: attack.instanceId, targetId: aliveEnemy.id });
    else s = gameReducer(s, { type: 'END_TURN' });
    guard += 1;
  }
  return s;
}

// 창고 화면은 아무것도 장착되지 않은 채로 시작하므로(defaultLoadout), 실제 전투를 치러야 하는
// 테스트는 창고에서 기본 세트를 직접 장착시켜야 한다 — 실제 플레이와 동일하게 EQUIP_ITEM_FROM_
// WAREHOUSE로 창고 아이템을 찾아 장착한다(SET_LOADOUT_SLOT은 창고 재고를 건드리지 않아 부적합).
function equipFromWarehouseByEquipmentId(s, equipmentId) {
  const item = s.playerState.warehouse.items.find((i) => i.equipmentId === equipmentId);
  return gameReducer(s, { type: 'EQUIP_ITEM_FROM_WAREHOUSE', itemId: item.id });
}
function equipDefaultLoadout(s) {
  const ids = ['katana', 'dagger', 'light_top', 'tactical_bottom', 'module_neural', 'module_body', 'implant1', 'implant3', 'implant6'];
  return ids.reduce(equipFromWarehouseByEquipmentId, s);
}

function enterFirstAvailableNode(s) {
  const nodeId = getAvailableNodeIds(s.mapState)[0];
  return gameReducer(s, { type: 'ENTER_MAP_NODE', nodeId });
}

// Picks option 0 in every offered reward slot then confirms — mirrors the old "auto-collect"
// behavior for tests that don't care which specific reward they get.
function confirmAllRewards(s) {
  if (s.currentScreen !== 'reward') return s;
  let next = s;
  for (const slot of s.pendingReward.slots) {
    if (slot.options.length === 0) continue;
    next = gameReducer(next, { type: 'SELECT_REWARD', slotKey: slot.key, optionIndex: 0 });
  }
  return gameReducer(next, { type: 'CONFIRM_REWARDS' });
}

// Drives the map screen forward until combat starts (or the run ends), auto-resolving
// rest/unknown-room nodes along the way (unknown room always picks 'farm').
function driveToNextCombatOrEnd(s, guardLimit = 30) {
  let guard = 0;
  while (guard < guardLimit) {
    if (s.currentScreen === 'map') s = enterFirstAvailableNode(s);
    else if (s.currentScreen === 'unknown_room') s = gameReducer(s, { type: 'RESOLVE_UNKNOWN_ROOM_CHOICE', choice: 'farm' });
    else break;
    guard += 1;
  }
  return s;
}

test('NEW_RUN starts on the loadout screen with nothing equipped', () => {
  const s = gameReducer(null, { type: 'NEW_RUN', seed: 1 });
  assert.equal(s.currentScreen, 'loadout');
  assert.deepEqual(s.playerState.loadout.weaponIds, []);
  assert.equal(s.playerState.loadout.topId, null);
  assert.equal(s.playerState.loadout.bottomId, null);
  assert.deepEqual(s.playerState.loadout.moduleIds, []);
  assert.deepEqual(s.playerState.loadout.implantIds, []);
});

test('SET_LOADOUT_SLOT toggles multi-select slots and respects the 2-weapon limit', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 1 });
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id: 'katana' }); // add
  assert.deepEqual(s.playerState.loadout.weaponIds, ['katana']);
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id: 'katana' }); // toggle off -> remove
  assert.deepEqual(s.playerState.loadout.weaponIds, []);
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id: 'katana' });
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id: 'dagger' });
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id: 'rifle' }); // 3rd -> no-op
  assert.equal(s.playerState.loadout.weaponIds.length, 2);
});

test('CONFIRM_LOADOUT computes maxHp/floor/capacity from equipped implants, seeds starting ammo, and generates the map', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 1 }); // default implants: 1,3,6 -> hp+7, floor 10+5+15=30
  s = equipDefaultLoadout(s);
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  assert.equal(s.currentScreen, 'map');
  assert.equal(s.playerState.maxHp, 77);
  assert.equal(s.playerState.hp, 77);
  assert.equal(s.playerState.overload, 30);
  assert.equal(s.playerState.inventory.capacity, 15);
  // 인벤토리는 완전히 빈 채로 시작 — 장착 안 한 farming-only 장비 10종, 시작 소모품 3개,
  // 시작 탄약(8발, 1스택)까지 전부 창고(무제한, 과적 규칙 미적용)에 남아있다가 플레이어가
  // 직접 인벤토리로 옮겨야 실제 런에 반영된다(옮기지 않으면 탄약 0으로 출격).
  const items = s.playerState.inventory.items;
  assert.equal(items.length, 0);
  const warehouseItems = s.playerState.warehouse.items;
  assert.equal(warehouseItems.filter((i) => i.kind === 'equipment').length, 10);
  assert.equal(warehouseItems.filter((i) => i.kind === 'consumable').length, 3);
  assert.deepEqual(warehouseItems.filter((i) => i.kind === 'ammo').map((i) => i.amount), [8]);
  assert.equal(warehouseItems.length, 14);
  assert.ok(s.mapState.mapData.nodes.length > 0);
  assert.deepEqual(getAvailableNodeIds(s.mapState).sort(), s.mapState.mapData.nodes.filter((n) => n.floor === 1).map((n) => n.id).sort());
});

test('entering a combat/elite map node starts combat; winning it routes to the reward screen', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = equipDefaultLoadout(s);
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = driveToNextCombatOrEnd(s);
  assert.equal(s.currentScreen, 'combat');
  s = autoPlayCombat(s);
  assert.equal(s.currentScreen, 'reward');
  assert.equal(s.pendingReward.slots[0].category, 'equipment');
});

test('CONFIRM_REWARDS applies picked options and returns to the map (or extraction on a boss win)', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = equipDefaultLoadout(s);
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = autoPlayCombat(driveToNextCombatOrEnd(s));
  assert.equal(s.currentScreen, 'reward');
  const invBefore = s.playerState.inventory.items.length;
  s = confirmAllRewards(s);
  assert.ok(['map', 'extractionComplete'].includes(s.currentScreen));
  assert.ok(s.playerState.inventory.items.length >= invBefore); // equipment slot always grants at least one pick
});

test('a full run can be played headlessly from NEW_RUN to either extractionComplete or gameOver', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 42 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });

  let guard = 0;
  while (s.currentScreen !== 'gameOver' && s.currentScreen !== 'extractionComplete' && guard < 400) {
    if (s.currentScreen === 'map') s = enterFirstAvailableNode(s);
    else if (s.currentScreen === 'unknown_room') s = gameReducer(s, { type: 'RESOLVE_UNKNOWN_ROOM_CHOICE', choice: 'farm' });
    else if (s.currentScreen === 'combat') s = autoPlayCombat(s, 1);
    else if (s.currentScreen === 'reward') s = confirmAllRewards(s);
    else break;
    guard += 1;
  }
  assert.ok(
    s.currentScreen === 'extractionComplete' || s.currentScreen === 'gameOver',
    `run did not conclude (stuck on "${s.currentScreen}" after ${guard} steps)`,
  );
});

test('the same seed reproduces an identical run outcome (deterministic headless replay)', () => {
  function playSeed(seed) {
    let s = gameReducer(null, { type: 'NEW_RUN', seed });
    s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
    let guard = 0;
    while (s.currentScreen !== 'gameOver' && s.currentScreen !== 'extractionComplete' && guard < 400) {
      if (s.currentScreen === 'map') s = enterFirstAvailableNode(s);
      else if (s.currentScreen === 'unknown_room') s = gameReducer(s, { type: 'RESOLVE_UNKNOWN_ROOM_CHOICE', choice: 'farm' });
      else if (s.currentScreen === 'combat') s = autoPlayCombat(s, 1);
      else if (s.currentScreen === 'reward') s = confirmAllRewards(s);
      else break;
      guard += 1;
    }
    return s;
  }
  const a = playSeed(123);
  const b = playSeed(123);
  assert.deepEqual(a, b);
});

test('PLAY_CARD with an invalid instanceId is a full no-op snapshot', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 6 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = driveToNextCombatOrEnd(s);
  const before = s;
  const after = gameReducer(before, { type: 'PLAY_CARD', instanceId: 'nope', targetId: null });
  assert.equal(after, before);
});

test('junk and currency items only enter the deck as curse cards once they are burden (past capacity)', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  const capacity = s.playerState.inventory.capacity;
  const items = [{ id: 'item-junk', kind: 'junk', value: 5 }];
  for (let i = 0; i < capacity + 2; i++) items.push({ id: `item-cur-${i}`, kind: 'currency', value: 15 });
  s = { ...s, playerState: { ...s.playerState, inventory: { ...s.playerState.inventory, items } } };

  s = driveToNextCombatOrEnd(s);
  assert.equal(s.currentScreen, 'combat');
  const combat = s.activeCombatState;
  const deckDefIds = [...combat.piles.drawPile, ...combat.piles.hand].map((c) => c.defId);
  const junkCount = deckDefIds.filter((id) => id === 'junk_item').length;
  const currencyCount = deckDefIds.filter((id) => id === 'currency_item').length;

  assert.equal(junkCount, 0); // the junk item sits at index 0 -> well within capacity, not burden
  assert.equal(currencyCount, items.length - capacity); // only the currency items past capacity (burden) are included
});

test('EQUIP_ITEM/UNEQUIP_ITEM move gear between the loadout and the inventory, and are blocked mid-combat', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = {
    ...s,
    playerState: {
      ...s.playerState,
      inventory: { ...s.playerState.inventory, items: [...s.playerState.inventory.items, { id: 'item-rifle', kind: 'equipment', equipmentId: 'rifle' }] },
      loadout: { ...s.playerState.loadout, weaponIds: ['katana'] },
    },
  };

  s = gameReducer(s, { type: 'EQUIP_ITEM', itemId: 'item-rifle' });
  assert.deepEqual(s.playerState.loadout.weaponIds.sort(), ['katana', 'rifle']);
  assert.ok(!s.playerState.inventory.items.some((i) => i.id === 'item-rifle'));

  s = gameReducer(s, { type: 'UNEQUIP_ITEM', equipmentId: 'rifle' });
  assert.deepEqual(s.playerState.loadout.weaponIds, ['katana']);
  assert.ok(s.playerState.inventory.items.some((i) => i.kind === 'equipment' && i.equipmentId === 'rifle'));

  const midCombat = driveToNextCombatOrEnd(s);
  assert.equal(midCombat.currentScreen, 'combat');
  const blocked = gameReducer(midCombat, { type: 'UNEQUIP_ITEM', equipmentId: 'katana' });
  assert.equal(blocked, midCombat); // guarded to currentScreen === 'map', no-op mid-combat
});
