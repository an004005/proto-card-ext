import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer } from '../src/engine/gameReducer.js';
import { isCardPlayable } from '../src/engine/combatEngine.js';

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

// 시설맵엔 "다음 노드"라는 확정 개념이 없다 — 현재 위치의 인접 노드 중 실제로 이동 가능한
// 첫 번째로 이동한다(막힌/일방통행 특수 엣지는 MOVE_TO_NODE가 조용히 no-op하므로 다음 후보로
// 넘어간다). 시간이 흐르며(간선당 ~100) RUN_COLLAPSE_TIME(4000)에 도달하면 결국 gameOver로
// 끝나므로, 순수 랜덤워크로도 헤드리스 테스트는 유한 스텝 안에 종결된다.
function driveMapForward(s) {
  const run = s.facilityRunState;
  const neighbors = run.graph.edges
    .filter((e) => e.from === run.playerNodeId || e.to === run.playerNodeId)
    .map((e) => (e.from === run.playerNodeId ? e.to : e.from));
  for (const nodeId of neighbors) {
    const next = gameReducer(s, { type: 'MOVE_TO_NODE', nodeId });
    if (next !== s) return next;
  }
  return s;
}

function neighborsOf(graph, nodeId) {
  return graph.edges.filter((e) => e.from === nodeId || e.to === nodeId).map((e) => (e.from === nodeId ? e.to : e.from));
}

function bfsWithParents(graph, fromId) {
  const parent = { [fromId]: null };
  const dist = { [fromId]: 0 };
  const queue = [fromId];
  while (queue.length) {
    const node = queue.shift();
    for (const n of neighborsOf(graph, node)) {
      if (parent[n] !== undefined) continue;
      parent[n] = node;
      dist[n] = dist[node] + 1;
      queue.push(n);
    }
  }
  return { parent, dist };
}

function firstHopToward(parent, fromId, toId) {
  let cur = toId;
  if (parent[cur] === undefined) return null;
  while (parent[cur] !== fromId) {
    cur = parent[cur];
    if (cur == null) return null;
  }
  return cur;
}

// 위협을 향해 최단 경로로 걸어가 결정론적으로 combatTrigger를 유발한다 — 순수 랜덤워크는 짧은
// guard 안에 위협과 마주친다는 보장이 없다(시설이 넓고 위협도 각자 순찰하므로).
function moveTowardNearestThreat(s) {
  const run = s.facilityRunState;
  const { parent, dist } = bfsWithParents(run.graph, run.playerNodeId);
  const threatNodeIds = Object.values(run.threats).map((t) => t.nodeId).filter((id) => dist[id] !== undefined);
  if (threatNodeIds.length === 0) return driveMapForward(s);
  threatNodeIds.sort((a, b) => dist[a] - dist[b]);
  const target = threatNodeIds[0];
  if (target === run.playerNodeId) return driveMapForward(s);
  const nextHop = firstHopToward(parent, run.playerNodeId, target);
  if (!nextHop) return driveMapForward(s);
  const next = gameReducer(s, { type: 'MOVE_TO_NODE', nodeId: nextHop });
  return next === s ? driveMapForward(s) : next;
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

// Drives the map screen forward (seeking the nearest threat) until combat starts or the run ends
// (collapse/meltdown -> gameOver).
function driveToNextCombatOrEnd(s, guardLimit = 60) {
  let guard = 0;
  while (guard < guardLimit) {
    if (s.currentScreen === 'map') s = moveTowardNearestThreat(s);
    else break;
    guard += 1;
  }
  return s;
}

test('NEW_RUN starts on the loadout screen with nothing equipped', () => {
  const s = gameReducer(null, { type: 'NEW_RUN', seed: 1 });
  assert.equal(s.currentScreen, 'loadout');
  assert.deepEqual(s.playerState.loadout.weapons, []);
  assert.equal(s.playerState.loadout.top, null);
  assert.equal(s.playerState.loadout.bottom, null);
  assert.deepEqual(s.playerState.loadout.modules, []);
  assert.deepEqual(s.playerState.loadout.implantIds, []);
});

// 무기/상의/하의/모듈은 §신규 인스턴스화 이후 Item 전체를 저장하므로(중복 장착도 허용) defId
// 문자열 토글만 하는 SET_LOADOUT_SLOT으로는 다룰 수 없다 — EQUIP_ITEM(_FROM_WAREHOUSE)/
// UNEQUIP_ITEM으로 일원화됐고, SET_LOADOUT_SLOT은 여전히 defId 문자열인 임플란트 전용으로 축소.
test('SET_LOADOUT_SLOT toggles implant slots (3-limit) and no-ops for non-implant slot types', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 1 });
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant1' }); // add
  assert.deepEqual(s.playerState.loadout.implantIds, ['implant1']);
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant1' }); // toggle off -> remove
  assert.deepEqual(s.playerState.loadout.implantIds, []);
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant1' });
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant3' });
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant5' });
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant6' }); // 4th -> no-op
  assert.equal(s.playerState.loadout.implantIds.length, 3);

  const before = s;
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id: 'katana' });
  assert.equal(s, before); // weapon/top/bottom/module no longer go through this command
});

test('CONFIRM_LOADOUT computes maxHp/floor/capacity from equipped implants, seeds starting ammo, and generates the facility map', () => {
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
  assert.equal(s.facilityRunState.graph.nodes.length, 160);
  assert.equal(s.facilityRunState.playerNodeId, s.facilityRunState.graph.startNodeId);
});

test('moving into a threat triggers combat; winning it routes to the reward screen', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = equipDefaultLoadout(s);
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = driveToNextCombatOrEnd(s);
  assert.equal(s.currentScreen, 'combat');
  assert.ok(s.combatContext.threatId);
  s = autoPlayCombat(s);
  assert.equal(s.currentScreen, 'reward');
  assert.equal(s.pendingReward.slots[0].category, 'equipment');
});

test('CONFIRM_REWARDS applies picked options and returns to the map', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = equipDefaultLoadout(s);
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = autoPlayCombat(driveToNextCombatOrEnd(s));
  assert.equal(s.currentScreen, 'reward');
  const invBefore = s.playerState.inventory.items.length;
  s = confirmAllRewards(s);
  assert.equal(s.currentScreen, 'map');
  assert.ok(s.playerState.inventory.items.length >= invBefore); // equipment slot always grants at least one pick
});

test('a full run can be played headlessly from NEW_RUN to either extractionComplete or gameOver', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 42 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });

  let guard = 0;
  while (s.currentScreen !== 'gameOver' && s.currentScreen !== 'extractionComplete' && guard < 400) {
    if (s.currentScreen === 'map') s = driveMapForward(s);
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
      if (s.currentScreen === 'map') s = driveMapForward(s);
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

test('EQUIP_ITEM/UNEQUIP_ITEM move gear (by instance itemId) between the loadout and the inventory, and are blocked mid-combat', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = {
    ...s,
    playerState: {
      ...s.playerState,
      inventory: { ...s.playerState.inventory, items: [...s.playerState.inventory.items, { id: 'item-rifle', kind: 'equipment', equipmentId: 'rifle', durability: 10 }] },
      loadout: { ...s.playerState.loadout, weapons: [{ id: 'item-katana', kind: 'equipment', equipmentId: 'katana', durability: 10 }] },
    },
  };

  s = gameReducer(s, { type: 'EQUIP_ITEM', itemId: 'item-rifle' });
  assert.deepEqual(s.playerState.loadout.weapons.map((w) => w.equipmentId).sort(), ['katana', 'rifle']);
  assert.ok(!s.playerState.inventory.items.some((i) => i.id === 'item-rifle'));

  const equippedRifleId = s.playerState.loadout.weapons.find((w) => w.equipmentId === 'rifle').id;
  s = gameReducer(s, { type: 'UNEQUIP_ITEM', itemId: equippedRifleId });
  assert.deepEqual(s.playerState.loadout.weapons.map((w) => w.equipmentId), ['katana']);
  assert.ok(s.playerState.inventory.items.some((i) => i.kind === 'equipment' && i.equipmentId === 'rifle' && i.durability === 10));

  const midCombat = driveToNextCombatOrEnd(s);
  assert.equal(midCombat.currentScreen, 'combat');
  const equippedKatanaId = midCombat.playerState.loadout.weapons[0].id;
  const blocked = gameReducer(midCombat, { type: 'UNEQUIP_ITEM', itemId: equippedKatanaId });
  assert.equal(blocked, midCombat); // guarded to currentScreen === 'map', no-op mid-combat
});

test('EQUIP_ITEM refuses to (re-)equip a broken (durability 0) item', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = {
    ...s,
    playerState: {
      ...s.playerState,
      inventory: { ...s.playerState.inventory, items: [...s.playerState.inventory.items, { id: 'item-broken', kind: 'equipment', equipmentId: 'rifle', durability: 0 }] },
    },
  };
  const after = gameReducer(s, { type: 'EQUIP_ITEM', itemId: 'item-broken' });
  assert.equal(after, s); // no-op — broken gear can't be re-equipped (no repair system yet)
});

test('BEGIN_DISENGAGE/RESOLVE_DISENGAGE lets the player retreat from combat back to the map without a reward', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = equipDefaultLoadout(s);
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = driveToNextCombatOrEnd(s);
  assert.equal(s.currentScreen, 'combat');

  s = gameReducer(s, { type: 'BEGIN_DISENGAGE' });
  assert.equal(s.combatContext.disengage.escapeIntent, true);
  // not enough progress yet -> resolving is a no-op
  const blocked = gameReducer(s, { type: 'RESOLVE_DISENGAGE' });
  assert.equal(blocked, s);

  s = { ...s, combatContext: { ...s.combatContext, disengage: { escapeIntent: true, disengageProgress: 2 } } };
  s = gameReducer(s, { type: 'RESOLVE_DISENGAGE' });
  assert.equal(s.currentScreen, 'map');
  assert.equal(s.activeCombatState, null);
  assert.equal(s.pendingReward, null);
});

test('extraction is automatic: landing on an already-open standard exit ends the run without a separate confirm command', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  const run = s.facilityRunState;
  const neighborId = run.graph.edges.find((e) => e.from === run.playerNodeId)?.to
    || run.graph.edges.find((e) => e.to === run.playerNodeId)?.from;
  assert.ok(neighborId, 'start node should have at least one edge');

  // Force exit A open at the neighboring node, as if a REQUEST_EXTRACTION had already resolved.
  s = {
    ...s,
    facilityRunState: {
      ...run,
      exits: { ...run.exits, A: { ...run.exits.A, nodeId: neighborId, status: 'open', openEndsAt: run.time + 1000 } },
    },
  };
  s = gameReducer(s, { type: 'MOVE_TO_NODE', nodeId: neighborId });
  assert.equal(s.currentScreen, 'extractionComplete');
});

test('extraction is automatic: landing on the key exit while it is discovered ends the run', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  const run = s.facilityRunState;
  const neighborId = run.graph.edges.find((e) => e.from === run.playerNodeId)?.to
    || run.graph.edges.find((e) => e.to === run.playerNodeId)?.from;
  assert.ok(neighborId, 'start node should have at least one edge');

  s = {
    ...s,
    facilityRunState: { ...run, exits: { ...run.exits, key: { kind: 'key', nodeId: neighborId } }, keyDiscovered: true },
  };
  s = gameReducer(s, { type: 'MOVE_TO_NODE', nodeId: neighborId });
  assert.equal(s.currentScreen, 'extractionComplete');
});

test('a threat wandering onto the player mid-action (not just mid-move) forces combat too', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  const run = s.facilityRunState;
  const neighborId = run.graph.edges.find((e) => e.from === run.playerNodeId)?.to
    || run.graph.edges.find((e) => e.to === run.playerNodeId)?.from;
  assert.ok(neighborId, 'start node should have at least one edge');

  // Park a threat one hop away with its very next patrol stop set to the player's *current*
  // node, due to move within the 80-time-unit basic recon (well past the next 10-point tick).
  const [threatId, threat] = Object.entries(run.threats)[0];
  const rigged = {
    ...threat, nodeId: neighborId, patrolRoute: [run.playerNodeId], patrolIndex: 0, mode: 'patrol',
    nextMoveAt: run.time + 10, alert: 0, target: null, investigationMemory: null, lastKnownPlayerNodeId: null, pursuitStrength: 0,
  };
  s = { ...s, facilityRunState: { ...run, threats: { ...run.threats, [threatId]: rigged } } };

  s = gameReducer(s, { type: 'BASIC_RECON' });
  assert.equal(s.currentScreen, 'combat');
  assert.equal(s.combatContext.threatId, threatId);
});
