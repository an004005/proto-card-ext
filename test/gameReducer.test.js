import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalNodesFor } from '../src/data/facilityLayout.js';
import { gameReducer } from '../src/engine/gameReducer.js';
import { isCardPlayable } from '../src/engine/combatEngine.js';
import { MAP_EQUIP_TIME_COST, MAP_CONSUMABLE_TIME_COST } from '../src/engine/facilityReducer.js';
import { finishTaskSnapshot } from './helpers/finishTask.js';

// 계약 화면이 NEW_RUN과 로드아웃 사이에 낀다(§3단계) — 첫 제안 계약을 그대로 수락해 로드아웃
// 화면까지 진행하는 헬퍼. 계약 자체를 검증하는 테스트는 이 헬퍼를 거치지 않고 NEW_RUN을
// 직접 디스패치한다.
function startLoadout(seed) {
  const offered = finishTaskSnapshot(gameReducer(null, { type: 'NEW_RUN', seed }));
  return finishTaskSnapshot(gameReducer(offered, { type: 'ACCEPT_CONTRACT', contractId: offered.offeredContracts[0].id }));
}

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
    // 공격 카드가 없으면 턴을 넘기기 전에 낼 수 있는 아무 카드나 낸다 — 방어·이동 카드를 그냥
    // 버리면 두 명짜리 무리에도 지는 일이 잦고, 그러면 이 도우미가 "이긴 전투"를 못 만든다.
    const fallback = combat.piles.hand.find((c) => isCardPlayable(combat, c.instanceId));
    if (playable && aliveEnemy) s = finishTaskSnapshot(gameReducer(s, { type: 'PLAY_CARD', instanceId: attack.instanceId, targetId: aliveEnemy.id }));
    else if (fallback && aliveEnemy) s = finishTaskSnapshot(gameReducer(s, { type: 'PLAY_CARD', instanceId: fallback.instanceId, targetId: aliveEnemy.id }));
    else s = finishTaskSnapshot(gameReducer(s, { type: 'END_TURN' }));
    guard += 1;
  }
  return s;
}

// 창고 화면은 아무것도 장착되지 않은 채로 시작하므로(defaultLoadout), 실제 전투를 치러야 하는
// 테스트는 창고에서 기본 세트를 직접 장착시켜야 한다 — 실제 플레이와 동일하게 EQUIP_ITEM_FROM_
// WAREHOUSE로 창고 아이템을 찾아 장착한다(SET_LOADOUT_SLOT은 창고 재고를 건드리지 않아 부적합).
function equipFromWarehouseByEquipmentId(s, equipmentId) {
  const item = s.playerState.warehouse.items.find((i) => i.equipmentId === equipmentId);
  return finishTaskSnapshot(gameReducer(s, { type: 'EQUIP_ITEM_FROM_WAREHOUSE', itemId: item.id }));
}
function equipDefaultLoadout(s) {
  const ids = ['katana', 'dagger', 'light_top', 'tactical_bottom', 'module_neural', 'module_body', 'implant1', 'implant3', 'implant6'];
  return ids.reduce(equipFromWarehouseByEquipmentId, s);
}

// §신규 조우 시스템: 콜리전이 더 이상 즉시 전투를 열지 않고 run.encounter로 선택지를 띄운다.
// 헤드리스 드라이버는 그 선택지를 결정론적으로 해소해야 진행할 수 있다 — 우위면 기습(전투
// 진입, 테스트가 원하는 결과), 열세(행동권 있음)면 안전한 아무 행동(BASIC_RECON)으로 그
// 행동권을 소모, 그래도 안 풀리면(forced) 전투로, 동률이면(무시 불가) 회피로 위협을 떼어낸다.
function resolveEncounterOnce(s) {
  const encounter = s.facilityRunState?.encounter;
  if (!encounter) return s;
  if (encounter.tier === 'advantage') return finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_AMBUSH' }));
  if (encounter.tier === 'forced') return finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_FIGHT' }));
  if (encounter.tier === 'even') return finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_EVADE' }));
  return finishTaskSnapshot(gameReducer(s, { type: 'BASIC_RECON' })); // disadvantage, grace action available
}

// 시설맵엔 "다음 노드"라는 확정 개념이 없다 — 현재 위치의 인접 노드 중 실제로 이동 가능한
// 첫 번째로 이동한다(막힌/일방통행 특수 엣지는 MOVE_TO_NODE가 조용히 no-op하므로 다음 후보로
// 넘어간다). 시간이 흐르며(간선당 ~100) RUN_COLLAPSE_TIME에 도달하면 결국 gameOver로
// 끝나므로, 순수 랜덤워크로도 헤드리스 테스트는 유한 스텝 안에 종결된다.
function driveMapForward(s) {
  if (s.facilityRunState?.encounter) return resolveEncounterOnce(s);
  const run = s.facilityRunState;
  const neighbors = run.graph.edges
    .filter((e) => e.from === run.playerNodeId || e.to === run.playerNodeId)
    .map((e) => (e.from === run.playerNodeId ? e.to : e.from));
  for (const nodeId of neighbors) {
    const next = finishTaskSnapshot(gameReducer(s, { type: 'MOVE_TO_NODE', nodeId }));
    if (next !== s) return next;
  }
  return s;
}

// 잠긴 엣지는 길로 치지 않는다 — 여기서 세면 MOVE_TO_NODE가 거부하는 경로를 따라가느라
// 헬퍼가 제자리를 맴돈다.
function neighborsOf(graph, nodeId) {
  return graph.edges
    .filter((e) => (e.from === nodeId || e.to === nodeId) && !e.features.includes('blocked'))
    .map((e) => (e.from === nodeId ? e.to : e.from));
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
function moveTowardNearestThreat(s, skipThreatIds = new Set()) {
  if (s.facilityRunState?.encounter) return resolveEncounterOnce(s);
  const run = s.facilityRunState;
  const { parent, dist } = bfsWithParents(run.graph, run.playerNodeId);
  // 가장 작은 무리부터 고른다 — "가장 가까운" 것만 보면 어느 무리를 먼저 만나는지가 평면도
  // 생성 규칙이 바뀔 때마다 달라지고, 그 자리에 여섯 명짜리 무리가 서 있으면 아래 자동 전투가
  // 진다. 무리 크기로 먼저 고르면 "이길 수 있는 전투 하나"라는 이 도우미의 뜻이 도면과 무관하게
  // 유지된다. 같은 크기면 가까운 쪽, 그다음은 id로 갈라 결정론을 지킨다.
  const candidates = Object.values(run.threats)
    .filter((t) => !skipThreatIds.has(t.id) && dist[t.nodeId] !== undefined);
  if (candidates.length === 0) return driveMapForward(s);
  candidates.sort((a, b) => (a.size || 0) - (b.size || 0) || dist[a.nodeId] - dist[b.nodeId] || (a.id < b.id ? -1 : 1));
  const target = candidates[0].nodeId;
  if (target === run.playerNodeId) return driveMapForward(s);
  const nextHop = firstHopToward(parent, run.playerNodeId, target);
  if (!nextHop) return driveMapForward(s);
  const next = finishTaskSnapshot(gameReducer(s, { type: 'MOVE_TO_NODE', nodeId: nextHop }));
  return next === s ? driveMapForward(s) : next;
}

// Picks option 0 in every offered reward slot then confirms — mirrors the old "auto-collect"
// behavior for tests that don't care which specific reward they get.
function confirmAllRewards(s) {
  if (s.currentScreen !== 'reward') return s;
  let next = s;
  for (const slot of s.pendingReward.slots) {
    if (slot.options.length === 0) continue;
    next = finishTaskSnapshot(gameReducer(next, { type: 'SELECT_REWARD', slotKey: slot.key, optionIndex: 0 }));
  }
  return finishTaskSnapshot(gameReducer(next, { type: 'CONFIRM_REWARDS' }));
}

// Drives the map screen forward (seeking the nearest threat) until combat starts or the run ends
// (collapse/meltdown -> gameOver).
function driveToNextCombatOrEnd(s, guardLimit = 60) {
  // 동률 조우는 회피밖에 없고, 회피해도 위협은 그 자리에 남는다 — 같은 위협을 계속 쫓으면
  // 조우와 회피를 무한히 반복한다. 한 번 회피한 위협은 목표에서 뺀다.
  const evaded = new Set();
  let guard = 0;
  while (guard < guardLimit) {
    if (s.currentScreen !== 'map') break;
    const encounter = s.facilityRunState?.encounter;
    if (encounter && encounter.tier === 'even') evaded.add(encounter.threatId);
    s = moveTowardNearestThreat(s, evaded);
    guard += 1;
  }
  return s;
}

test('NEW_RUN offers 3 contracts (one per type); accepting one reaches the loadout screen with nothing equipped', () => {
  const offered = finishTaskSnapshot(gameReducer(null, { type: 'NEW_RUN', seed: 1 }));
  assert.equal(offered.currentScreen, 'contract');
  assert.equal(offered.offeredContracts.length, 3);
  assert.deepEqual(offered.offeredContracts.map((c) => c.type).sort(), ['destroy', 'intel', 'retrieval']);

  const s = startLoadout(1);
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
  let s = startLoadout(1);
  s = finishTaskSnapshot(gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant1' })); // add
  assert.deepEqual(s.playerState.loadout.implantIds, ['implant1']);
  s = finishTaskSnapshot(gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant1' })); // toggle off -> remove
  assert.deepEqual(s.playerState.loadout.implantIds, []);
  s = finishTaskSnapshot(gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant1' }));
  s = finishTaskSnapshot(gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant3' }));
  s = finishTaskSnapshot(gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant4' }));
  s = finishTaskSnapshot(gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'implant', id: 'implant6' })); // 4th -> no-op
  assert.equal(s.playerState.loadout.implantIds.length, 3);

  const before = s;
  s = finishTaskSnapshot(gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id: 'katana' }));
  assert.equal(s, before); // weapon/top/bottom/module no longer go through this command
});

test('CONFIRM_LOADOUT computes maxHp/capacity from equipped implants, seeds starting ammo, and generates the facility map', () => {
  let s = startLoadout(1); // default implants: 1,3,6 -> hp+7, 인벤토리 +5
  s = equipDefaultLoadout(s);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  assert.equal(s.currentScreen, 'map');
  assert.equal(s.playerState.maxHp, 47); // BASE_MAX_HP 40 + 임플란트 +7
  assert.equal(s.playerState.hp, 47);
  assert.equal(s.playerState.inventory.capacity, 15);
  // 인벤토리는 계약 선불 재화 1개만 갖고 시작한다 — 장착 안 한 farming-only 장비 18종(임플란트⑦
  // 지도가 창고 시작 풀에 추가됨), 시작 소모품 3개, 시작 탄약(16발 = 10발 스택 + 6발 스택,
  // C1)까지 전부 창고(무제한, 과적 규칙 미적용)에 남아있다가 플레이어가 직접 인벤토리로 옮겨야
  // 실제 런에 반영된다(옮기지 않으면 탄약 0으로 출격).
  const items = s.playerState.inventory.items;
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'currency');
  const warehouseItems = s.playerState.warehouse.items;
  assert.equal(warehouseItems.filter((i) => i.kind === 'equipment').length, 17);
  assert.equal(warehouseItems.filter((i) => i.kind === 'consumable').length, 3);
  assert.deepEqual(warehouseItems.filter((i) => i.kind === 'ammo').map((i) => i.amount), [10, 6]);
  assert.equal(warehouseItems.length, 22);
  assert.equal(s.facilityRunState.graph.nodes.length, totalNodesFor(s.facilityRunState.graph.sectorIds));
  assert.equal(s.facilityRunState.playerNodeId, s.facilityRunState.graph.startNodeId);
});

test('moving into a threat triggers combat; winning it routes to the reward screen', () => {
  let s = startLoadout(2);
  s = equipDefaultLoadout(s);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  s = driveToNextCombatOrEnd(s);
  assert.equal(s.currentScreen, 'combat');
  assert.ok(s.combatContext.threatId);
  s = autoPlayCombat(s);
  assert.equal(s.currentScreen, 'reward');
  assert.equal(s.pendingReward.slots[0].category, 'equipment');
});

test('DEBUG_WIN_COMBAT는 정상 승리와 같은 자리에 도착한다 — 보상 화면, 시체, 격퇴 처리까지', () => {
  let s = startLoadout(2);
  s = equipDefaultLoadout(s);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  const atCombat = driveToNextCombatOrEnd(s);
  assert.equal(atCombat.currentScreen, 'combat');
  const threatId = atCombat.combatContext.threatId;

  const debugWon = finishTaskSnapshot(gameReducer(atCombat, { type: 'DEBUG_WIN_COMBAT' }));
  const played = autoPlayCombat(atCombat);

  assert.equal(debugWon.currentScreen, 'reward');
  assert.equal(debugWon.currentScreen, played.currentScreen, '정상 승리와 같은 화면으로 간다');
  assert.equal(debugWon.activeCombatState, null);
  assert.equal(debugWon.combatContext, null);
  // 보상 구성은 RNG가 정하므로 정상 승리와 슬롯 수까지 같지는 않다(같은 전투라도 몇 라운드를
  // 썼는지가 다르다). 같아야 하는 것은 "보상이 같은 규칙으로 생성됐다"는 사실이다.
  assert.ok(debugWon.pendingReward, '보상이 정상 승리와 같이 생성된다');
  assert.equal(debugWon.pendingReward.slots[0].category, played.pendingReward.slots[0].category);
  assert.ok(debugWon.pendingReward.slots.every((slot) => slot.options.length > 0));
  assert.equal(debugWon.facilityRunState.threats[threatId], undefined, '이긴 위협은 격퇴된다');
  assert.ok(debugWon.facilityRunState.corpses.some((c) => c.id.includes(threatId)), '그 자리에 시체가 남는다');

  // 전투 화면이 아니거나 이미 끝난 전투에서는 아무 일도 하지 않는다.
  assert.equal(finishTaskSnapshot(gameReducer(debugWon, { type: 'DEBUG_WIN_COMBAT' })), debugWon);
});

test('CONFIRM_REWARDS applies picked options and returns to the map', () => {
  let s = startLoadout(2);
  s = equipDefaultLoadout(s);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  s = autoPlayCombat(driveToNextCombatOrEnd(s));
  assert.equal(s.currentScreen, 'reward');
  const invBefore = s.playerState.inventory.items.length;
  s = confirmAllRewards(s);
  assert.equal(s.currentScreen, 'map');
  assert.ok(s.playerState.inventory.items.length >= invBefore); // equipment slot always grants at least one pick
});

test('a full run can be played headlessly from NEW_RUN to either extractionComplete or gameOver', () => {
  let s = startLoadout(42);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));

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
    let s = startLoadout(seed);
    s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
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
  let s = startLoadout(6);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  s = driveToNextCombatOrEnd(s);
  const before = s;
  const after = finishTaskSnapshot(gameReducer(before, { type: 'PLAY_CARD', instanceId: 'nope', targetId: null }));
  assert.equal(after, before);
});

test('junk and currency items only enter the deck as status cards once they are burden (past capacity)', () => {
  let s = startLoadout(2);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
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
  let s = startLoadout(2);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  s = {
    ...s,
    playerState: {
      ...s.playerState,
      inventory: { ...s.playerState.inventory, items: [...s.playerState.inventory.items, { id: 'item-rifle', kind: 'equipment', equipmentId: 'rifle', durability: 10 }] },
      loadout: { ...s.playerState.loadout, weapons: [{ id: 'item-katana', kind: 'equipment', equipmentId: 'katana', durability: 10 }] },
    },
  };

  s = finishTaskSnapshot(gameReducer(s, { type: 'EQUIP_ITEM', itemId: 'item-rifle' }));
  assert.deepEqual(s.playerState.loadout.weapons.map((w) => w.equipmentId).sort(), ['katana', 'rifle']);
  assert.ok(!s.playerState.inventory.items.some((i) => i.id === 'item-rifle'));

  const equippedRifleId = s.playerState.loadout.weapons.find((w) => w.equipmentId === 'rifle').id;
  s = finishTaskSnapshot(gameReducer(s, { type: 'UNEQUIP_ITEM', itemId: equippedRifleId }));
  assert.deepEqual(s.playerState.loadout.weapons.map((w) => w.equipmentId), ['katana']);
  assert.ok(s.playerState.inventory.items.some((i) => i.kind === 'equipment' && i.equipmentId === 'rifle' && i.durability === 10));

  // "blocked mid-combat" only needs any combat snapshot with an equipped weapon — drive from a
  // fresh loadout-confirmed state rather than `s`, since MAP_EQUIP_TIME_COST above already
  // advanced facilityRunState.time/threat positions in a way that isn't relevant here.
  let fresh = startLoadout(2);
  fresh = finishTaskSnapshot(gameReducer(fresh, { type: 'CONFIRM_LOADOUT' }));
  fresh = {
    ...fresh,
    playerState: { ...fresh.playerState, loadout: { ...fresh.playerState.loadout, weapons: [{ id: 'item-katana', kind: 'equipment', equipmentId: 'katana', durability: 10 }] } },
  };
  const midCombat = driveToNextCombatOrEnd(fresh);
  assert.equal(midCombat.currentScreen, 'combat');
  const equippedKatanaId = midCombat.playerState.loadout.weapons[0].id;
  const blocked = finishTaskSnapshot(gameReducer(midCombat, { type: 'UNEQUIP_ITEM', itemId: equippedKatanaId }));
  assert.equal(blocked, midCombat); // guarded to currentScreen === 'map', no-op mid-combat
});

test('EQUIP_ITEM on the map costs MAP_EQUIP_TIME_COST (3칸) and is free/instant during loadout prep', () => {
  let s = startLoadout(3);
  // Free/instant during loadout prep — no facilityRunState to advance yet.
  const rifle = s.playerState.warehouse.items.find((i) => i.equipmentId === 'rifle');
  s = finishTaskSnapshot(gameReducer(s, { type: 'EQUIP_ITEM_FROM_WAREHOUSE', itemId: rifle.id }));
  assert.deepEqual(s.playerState.loadout.weapons.map((w) => w.equipmentId), ['rifle']);

  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  const timeBefore = s.facilityRunState.time;
  s = {
    ...s,
    playerState: {
      ...s.playerState,
      inventory: { ...s.playerState.inventory, items: [...s.playerState.inventory.items, { id: 'item-katana', kind: 'equipment', equipmentId: 'katana', durability: 10 }] },
    },
  };
  s = finishTaskSnapshot(gameReducer(s, { type: 'EQUIP_ITEM', itemId: 'item-katana' }));
  assert.equal(s.facilityRunState.time, timeBefore + MAP_EQUIP_TIME_COST);
  assert.deepEqual(s.playerState.loadout.weapons.map((w) => w.equipmentId).sort(), ['katana', 'rifle']);
});

test('EQUIP_ITEM refuses to (re-)equip a broken (durability 0) item', () => {
  let s = startLoadout(2);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  s = {
    ...s,
    playerState: {
      ...s.playerState,
      inventory: { ...s.playerState.inventory, items: [...s.playerState.inventory.items, { id: 'item-broken', kind: 'equipment', equipmentId: 'rifle', durability: 0 }] },
    },
  };
  const after = finishTaskSnapshot(gameReducer(s, { type: 'EQUIP_ITEM', itemId: 'item-broken' }));
  assert.equal(after, s); // no-op — broken gear can't be re-equipped (no repair system yet)
});

test('BEGIN_DISENGAGE/RESOLVE_DISENGAGE lets the player retreat from combat back to the map without a reward', () => {
  let s = startLoadout(2);
  s = equipDefaultLoadout(s);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  s = driveToNextCombatOrEnd(s);
  assert.equal(s.currentScreen, 'combat');

  s = finishTaskSnapshot(gameReducer(s, { type: 'BEGIN_DISENGAGE' }));
  assert.equal(s.combatContext.disengage.escapeIntent, true);
  // not enough progress yet -> resolving is a no-op
  const blocked = finishTaskSnapshot(gameReducer(s, { type: 'RESOLVE_DISENGAGE' }));
  assert.equal(blocked, s);

  s = { ...s, combatContext: { ...s.combatContext, disengage: { escapeIntent: true, disengageProgress: 2 } } };
  s = finishTaskSnapshot(gameReducer(s, { type: 'RESOLVE_DISENGAGE' }));
  assert.equal(s.currentScreen, 'map');
  assert.equal(s.activeCombatState, null);
  assert.equal(s.pendingReward, null);
});

test('extraction is automatic: landing on an already-open standard exit ends the run without a separate confirm command', () => {
  let s = startLoadout(2);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
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
  s = finishTaskSnapshot(gameReducer(s, { type: 'MOVE_TO_NODE', nodeId: neighborId }));
  assert.equal(s.currentScreen, 'extractionComplete');
});

test('extraction is automatic: landing on the key exit while it is discovered ends the run', () => {
  let s = startLoadout(2);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  const run = s.facilityRunState;
  const neighborId = run.graph.edges.find((e) => e.from === run.playerNodeId)?.to
    || run.graph.edges.find((e) => e.to === run.playerNodeId)?.from;
  assert.ok(neighborId, 'start node should have at least one edge');

  s = {
    ...s,
    facilityRunState: { ...run, exits: { ...run.exits, key: { kind: 'key', nodeId: neighborId } }, keyDiscovered: true },
  };
  s = finishTaskSnapshot(gameReducer(s, { type: 'MOVE_TO_NODE', nodeId: neighborId }));
  assert.equal(s.currentScreen, 'extractionComplete');
});

test('a threat wandering onto the player mid-action (not just mid-move) forces combat too', () => {
  let s = startLoadout(2);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  const run = s.facilityRunState;
  const neighborId = run.graph.edges.find((e) => e.from === run.playerNodeId)?.to
    || run.graph.edges.find((e) => e.to === run.playerNodeId)?.from;
  assert.ok(neighborId, 'start node should have at least one edge');

  // Park a threat one hop away with its very next patrol stop set to the player's *current*
  // node, due to move within the BASIC_RECON_TIME(4칸) 정찰 도중.
  const [threatId, threat] = Object.entries(run.threats)[0];
  // alert 3 + a rigged boss roster guarantees perception 4, comfortably above the default
  // (unequipped) loadout's stealth 0 — so this collision is deterministically tier 'disadvantage'
  // on first judgment.
  const rigged = {
    ...threat, nodeId: neighborId, patrolRoute: [run.playerNodeId], patrolIndex: 0, mode: 'patrol',
    nextMoveAt: run.time + 1, alert: 3, size: 4, monsterIds: ['ceremonial_beast'],
    target: null, investigationMemory: null, lastKnownPlayerNodeId: null, pursuitStrength: 0,
  };
  s = { ...s, facilityRunState: { ...run, threats: { ...run.threats, [threatId]: rigged } } };

  s = finishTaskSnapshot(gameReducer(s, { type: 'BASIC_RECON' }));
  assert.equal(s.facilityRunState.encounter?.threatId, threatId);
  assert.equal(s.facilityRunState.encounter?.tier, 'disadvantage');
  assert.equal(s.currentScreen, 'map'); // no longer instant combat — the collision opens a choice instead

  // spend the one grace action (still co-located, still same perception/stealth) -> forced, then fight.
  s = finishTaskSnapshot(gameReducer(s, { type: 'BASIC_RECON' }));
  assert.equal(s.facilityRunState.encounter?.tier, 'forced');
  s = finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_FIGHT' }));
  assert.equal(s.currentScreen, 'combat');
  assert.equal(s.combatContext.threatId, threatId);
});

// §신규 조우 시스템 전용 테스트 — 위협 하나를 플레이어 인접 노드에 놓고 지정한 alert/size로
// 고정한 뒤 BASIC_RECON 한 번으로 결정론적 콜리전을 일으켜, 원하는 tier의 run.encounter를 얻는다.
function riggedEncounterState(seed, { alert, size, monsterIds, equip = false }) {
  let s = startLoadout(seed);
  if (equip) s = equipFromWarehouseByEquipmentId(s, 'katana');
  if (equip) s = equipFromWarehouseByEquipmentId(s, 'rifle');
  if (equip) s = equipFromWarehouseByEquipmentId(s, 'light_top');
  if (equip) s = equipFromWarehouseByEquipmentId(s, 'tactical_bottom');
  if (equip) s = equipFromWarehouseByEquipmentId(s, 'module_body');
  if (equip) s = equipFromWarehouseByEquipmentId(s, 'module_neural');
  if (equip) s = equipFromWarehouseByEquipmentId(s, 'implant1');
  if (equip) s = equipFromWarehouseByEquipmentId(s, 'implant3');
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  // 조우 단계는 실효 Stealth로 갈리고, 실효 Stealth에는 서 있는 방의 상황 보정이 들어간다 —
  // 대공간 −1과 살아 있는 카메라 −1이다. 여기서 보려는 것은 단계별 선택지이지 시작 방이 어떤
  // 방이었나가 아니므로, 그 두 보정을 지워 장비 합만 남긴다(구역이 런마다 뽑히므로 시작 방의
  // 성격은 시드마다 다르다).
  const neutral = s.facilityRunState;
  s = {
    ...s,
    facilityRunState: {
      ...neutral,
      graph: {
        ...neutral.graph,
        nodes: neutral.graph.nodes.map((n) => (n.id === neutral.playerNodeId && n.type === 'hall' ? { ...n, type: 'corridor' } : n)),
        cameras: neutral.graph.cameras.filter((c) => c.nodeId !== neutral.playerNodeId),
      },
    },
  };
  const run = s.facilityRunState;
  const neighborId = run.graph.edges.find((e) => e.from === run.playerNodeId)?.to
    || run.graph.edges.find((e) => e.to === run.playerNodeId)?.from;
  const [threatId, threat] = Object.entries(run.threats)[0];
  const rigged = {
    ...threat, nodeId: neighborId, patrolRoute: [run.playerNodeId], patrolIndex: 0, mode: 'patrol',
    nextMoveAt: run.time + 1, alert, size, monsterIds: monsterIds ?? threat.monsterIds,
    target: null, investigationMemory: null, lastKnownPlayerNodeId: null, pursuitStrength: 0,
  };
  s = { ...s, facilityRunState: { ...run, threats: { ...run.threats, [threatId]: rigged } } };
  s = finishTaskSnapshot(gameReducer(s, { type: 'BASIC_RECON' }));
  return { s, threatId };
}

test('encounter tier advantage: ambush stuns every enemy and keeps player-first turn order; ignore is available; other map actions are not blocked', () => {
  const { s, threatId } = riggedEncounterState(10, { alert: 0, size: 2, monsterIds: ['nibbit'], equip: true }); // stealth 1 > perception -1 (alert 0 + normal -1)
  assert.equal(s.facilityRunState.encounter?.tier, 'advantage');
  assert.equal(s.currentScreen, 'map');

  // not blocked: a normal map action still works at 'advantage' (re-judges, doesn't force anything)
  const reconAgain = finishTaskSnapshot(gameReducer(s, { type: 'BASIC_RECON' }));
  assert.notEqual(reconAgain, s);

  const ambushed = finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_AMBUSH' }));
  assert.equal(ambushed.currentScreen, 'combat');
  assert.equal(ambushed.combatContext.threatId, threatId);
  assert.equal(ambushed.activeCombatState.turn, 1); // beginPlayerFirst, not beginEnemyFirst
  assert.ok(ambushed.activeCombatState.enemies.every((e) => e.statuses.stun === 1));

  const ignored = finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_IGNORE' }));
  assert.equal(ignored.currentScreen, 'map');
  assert.equal(ignored.facilityRunState.encounter, null);
});

test('encounter tier even: ignore is refused (무시 불가), evade works and resets the threat to patrol, other map actions are blocked until resolved', () => {
  // C4로 기본 로드아웃의 실효 Stealth가 2에서 1로 내려갔다 — 동률을 만들려면 경계도도 한 칸 낮춘다.
  const { s, threatId } = riggedEncounterState(10, { alert: 0, size: 4, monsterIds: ['ceremonial_beast'], equip: true }); // stealth 1 === perception 1 (alert 0 + boss 1)
  assert.equal(s.facilityRunState.encounter?.tier, 'even');

  const ignoreAttempt = finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_IGNORE' }));
  assert.equal(ignoreAttempt, s); // refused

  const blockedRecon = finishTaskSnapshot(gameReducer(s, { type: 'BASIC_RECON' }));
  assert.equal(blockedRecon, s); // blocked while tier === 'even'

  const evaded = finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_EVADE' }));
  assert.equal(evaded.facilityRunState.encounter, null);
  assert.equal(evaded.facilityRunState.threats[threatId].mode, 'patrol');
  assert.equal(evaded.facilityRunState.threats[threatId].lastKnownPlayerNodeId, null);
});

test('encounter tier disadvantage: grace action allowed once, then forced with no evade/ignore, and entering combat always applies enemy-first ambush', () => {
  const { s, threatId } = riggedEncounterState(11, { alert: 3, size: 4, monsterIds: ['ceremonial_beast'] }); // stealth 0 < perception 4 (alert 3 + boss 1), no equip
  assert.equal(s.facilityRunState.encounter?.tier, 'disadvantage');
  assert.equal(s.facilityRunState.encounter?.graceUsed, false);

  // no evade/ambush available at disadvantage
  assert.equal(finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_EVADE' })), s);
  assert.equal(finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_AMBUSH' })), s);
  assert.equal(finishTaskSnapshot(gameReducer(s, { type: 'ENCOUNTER_FIGHT' })), s); // not forced yet

  const afterGrace = finishTaskSnapshot(gameReducer(s, { type: 'BASIC_RECON' })); // the one allowed action
  assert.equal(afterGrace.facilityRunState.encounter?.tier, 'forced');

  const blockedMove = finishTaskSnapshot(gameReducer(afterGrace, { type: 'BASIC_RECON' }));
  assert.equal(blockedMove, afterGrace); // blocked while forced

  const fought = finishTaskSnapshot(gameReducer(afterGrace, { type: 'ENCOUNTER_FIGHT' }));
  assert.equal(fought.currentScreen, 'combat');
  assert.equal(fought.combatContext.threatId, threatId);
  assert.equal(fought.activeCombatState.turn, 2); // beginEnemyFirst ran one enemy turn first
});

test('USE_MAP_CONSUMABLE heals from inventory or quickslot, costs MAP_CONSUMABLE_TIME_COST (2칸), and only accepts healing consumables', () => {
  let s = startLoadout(4);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  s = { ...s, playerState: { ...s.playerState, hp: Math.round(s.playerState.maxHp * 0.5) } };

  // from inventory
  s = {
    ...s,
    playerState: {
      ...s.playerState,
      inventory: { ...s.playerState.inventory, items: [...s.playerState.inventory.items, { id: 'item-bandage', kind: 'consumable', defId: 'bandage' }] },
    },
  };
  const hpBefore = s.playerState.hp;
  const timeBefore = s.facilityRunState.time;
  s = finishTaskSnapshot(gameReducer(s, { type: 'USE_MAP_CONSUMABLE', itemId: 'item-bandage' }));
  assert.equal(s.playerState.hp, Math.min(s.playerState.maxHp, hpBefore + Math.round(s.playerState.maxHp * 0.2)));
  assert.equal(s.facilityRunState.time, timeBefore + MAP_CONSUMABLE_TIME_COST);
  assert.ok(!s.playerState.inventory.items.some((i) => i.id === 'item-bandage'));

  // from a quickslot
  s = {
    ...s,
    playerState: {
      ...s.playerState,
      hp: Math.round(s.playerState.maxHp * 0.5),
      loadout: { ...s.playerState.loadout, consumableSlots: [{ id: 'item-bandage-2', defId: 'bandage' }, null, null] },
    },
  };
  const hpBefore2 = s.playerState.hp;
  s = finishTaskSnapshot(gameReducer(s, { type: 'USE_MAP_CONSUMABLE', itemId: 'item-bandage-2' }));
  assert.equal(s.playerState.hp, hpBefore2 + Math.round(s.playerState.maxHp * 0.2));
  assert.equal(s.playerState.loadout.consumableSlots[0], null);

  // non-healing consumable (grenade) is refused
  s = {
    ...s,
    playerState: {
      ...s.playerState,
      inventory: { ...s.playerState.inventory, items: [...s.playerState.inventory.items, { id: 'item-stab', kind: 'consumable', defId: 'grenade' }] },
    },
  };
  const refused = finishTaskSnapshot(gameReducer(s, { type: 'USE_MAP_CONSUMABLE', itemId: 'item-stab' }));
  assert.equal(refused, s);
});

test('USE_MAP_CONSUMABLE is a no-op outside the map screen (e.g. mid-combat)', () => {
  let s = startLoadout(4);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  assert.equal(s.currentScreen, 'map');
  const notOnMap = { ...s, currentScreen: 'combat' };
  assert.equal(finishTaskSnapshot(gameReducer(notOnMap, { type: 'USE_MAP_CONSUMABLE', itemId: 'nope' })), notOnMap);
});

// 회귀(코드 리뷰): refreshLocalObservations는 모든 시설 커맨드 뒤에 현재·인접 노드의 관측을
// 갱신한다. 예전에는 관측 객체를 통째로 교체해, 정찰이 적어둔 concealment가 바로 다음
// 행동에서 지워졌다 — 기본 정찰 4칸의 산출이 0이 되고 은엄폐 버튼(scouted 조건)이 UI에
// 영영 뜨지 않는 결함이었다. 엔진 층이 아니라 **리듀서 층**에서 잡아야 하는 회귀다.
test('정찰이 기록한 concealment는 이후 시설 커맨드의 관측 갱신에도 살아남는다', () => {
  let s = startLoadout(4);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  assert.equal(s.currentScreen, 'map');

  // 은엄폐가 있는 노드에 서서 정찰한다 — 시작 노드에 은엄폐가 있으리란 보장이 없으므로
  // 위치만 옮겨 둔다(다른 상태는 실제 런 그대로).
  const run = s.facilityRunState;
  const concealedNodeId = Object.keys(run.graph.concealmentByNodeId)[0];
  // 은엄폐 값은 Perception 2부터 읽힌다(정보 깊이 표) — 공간 지각 모듈을 얹어 그 깊이를 만든다.
  s = {
    ...s,
    playerState: {
      ...s.playerState,
      loadout: { ...s.playerState.loadout, modules: [...(s.playerState.loadout.modules || []), { id: 'spatial_test', equipmentId: 'module_spatial', durability: 10 }] },
    },
    facilityRunState: { ...run, playerNodeId: concealedNodeId },
  };

  s = finishTaskSnapshot(gameReducer(s, { type: 'BASIC_RECON' }));
  const scouted = s.facilityRunState.observations[concealedNodeId];
  assert.equal(scouted.concealment, run.graph.concealmentByNodeId[concealedNodeId]);

  // 그 뒤 아무 커맨드나(유료 대기) 한 번 — 관측은 새 시각으로 갱신되지만 정찰 산출은 남는다.
  const observedAt = scouted.observedAt;
  s = finishTaskSnapshot(gameReducer(s, { type: 'WAIT', ticks: 1 }));
  const after = s.facilityRunState.observations[concealedNodeId];
  assert.equal(after.concealment, run.graph.concealmentByNodeId[concealedNodeId]);
  assert.ok(after.observedAt >= observedAt);
});

// ---- 창고는 홈베이스에서만 (리뷰 A7) ----

test('맵에서는 창고 장비를 바로 장착할 수 없다 — 출격 준비 화면에서만 된다', () => {
  let s = startLoadout(3);
  const rifle = s.playerState.warehouse.items.find((i) => i.equipmentId === 'rifle');
  const equipped = finishTaskSnapshot(gameReducer(s, { type: 'EQUIP_ITEM_FROM_WAREHOUSE', itemId: rifle.id }));
  assert.deepEqual(equipped.playerState.loadout.weapons.map((w) => w.equipmentId), ['rifle'], '출격 준비에서는 장착된다');

  s = equipDefaultLoadout(s);
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  assert.equal(s.currentScreen, 'map');
  const stillInWarehouse = s.playerState.warehouse.items.find((i) => i.equipmentId === 'rifle');
  const blocked = finishTaskSnapshot(gameReducer(s, { type: 'EQUIP_ITEM_FROM_WAREHOUSE', itemId: stillInWarehouse.id }));
  assert.equal(blocked, s, '맵에서는 창고에 손이 닿지 않으므로 스냅샷이 그대로여야 한다');
  assert.equal(blocked.facilityRunState.time, s.facilityRunState.time, '시간도 흐르지 않는다');
});

test('맵에서는 창고 아이템을 버릴 수 없지만 인벤토리 아이템은 버릴 수 있다', () => {
  let s = equipDefaultLoadout(startLoadout(3));
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  const warehouseItem = s.playerState.warehouse.items[0];
  assert.equal(finishTaskSnapshot(gameReducer(s, { type: 'DISCARD_ITEM', itemId: warehouseItem.id })), s, '맵에서 창고 아이템 폐기는 무시된다');

  s = {
    ...s,
    playerState: {
      ...s.playerState,
      inventory: { ...s.playerState.inventory, items: [...s.playerState.inventory.items, { id: 'item-junk-x', kind: 'junk', value: 5 }] },
    },
  };
  const discarded = finishTaskSnapshot(gameReducer(s, { type: 'DISCARD_ITEM', itemId: 'item-junk-x' }));
  assert.ok(!discarded.playerState.inventory.items.some((i) => i.id === 'item-junk-x'));
});

// ---- 과부화 토글 (ADR-0080) ----

test('TOGGLE_OVERLOAD는 지도에서 자유롭게 켜고 끄며, 시간을 쓰지 않는다', () => {
  let s = equipDefaultLoadout(startLoadout(3));
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  assert.equal(s.playerState.overloadActive, false, '런은 꺼진 채로 시작한다');
  const timeBefore = s.facilityRunState.time;

  s = finishTaskSnapshot(gameReducer(s, { type: 'TOGGLE_OVERLOAD' }));
  assert.equal(s.playerState.overloadActive, true);
  assert.equal(s.facilityRunState.time, timeBefore, '대가가 없으므로 시계도 흐르지 않는다');

  s = finishTaskSnapshot(gameReducer(s, { type: 'TOGGLE_OVERLOAD' }));
  assert.equal(s.playerState.overloadActive, false, '다시 끌 수 있다');
});

test('TOGGLE_OVERLOAD는 전투 플레이어 턴에서 전투 상태까지 함께 뒤집고, 적 턴에는 거부된다', () => {
  let s = equipDefaultLoadout(startLoadout(3));
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  s = driveToNextCombatOrEnd(s);
  assert.equal(s.currentScreen, 'combat', '이 시드는 전투까지 간다');
  assert.equal(s.activeCombatState.phase, 'player_turn');
  s = finishTaskSnapshot(gameReducer(s, { type: 'TOGGLE_OVERLOAD' }));
  assert.equal(s.playerState.overloadActive, true);
  assert.equal(s.activeCombatState.overloadActive, true, '전투 상태도 같은 값을 든다');

  // 적 행동 재생 중(enemy_turn)에는 받지 않는다 — 이미 계산이 시작된 인텐트와 어긋난다.
  const duringEnemyTurn = {
    ...s,
    activeCombatState: { ...s.activeCombatState, phase: 'enemy_turn' },
  };
  assert.equal(finishTaskSnapshot(gameReducer(duringEnemyTurn, { type: 'TOGGLE_OVERLOAD' })), duringEnemyTurn);
});
