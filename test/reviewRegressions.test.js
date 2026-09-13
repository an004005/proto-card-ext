// 코드 리뷰에서 확인된 결함들의 회귀 테스트. 전부 "순수 계산과 상태 반영 사이의 접합부"에서
// 나온 것이라, 계산 모듈만 보는 기존 테스트로는 잡히지 않았다 — 여기서는 반드시 커맨드(리듀서)
// 경로나 실제 틱 진행을 거쳐서 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer } from '../src/engine/gameReducer.js';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  createRunState, advanceTime, useOpportunity, applyCapabilityCost, scheduleTask, basicRecon,
  refreshLocalObservations, observationSuspended, prizeGradeKnown, waitOneTick, moveToAdjacentNode,
} from '../src/engine/runEngine.js';
import { bfsHopDistances } from '../src/engine/graphUtils.js';
import { forecastAction, forecastUnknownPrizeFarm } from '../src/engine/actionCosts.js';
import { createCombatState, beginPlayerFirst } from '../src/engine/combatEngine.js';
import { broadcastFalseTarget } from '../src/engine/recovery.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';
import {
  ADJACENT_SECTOR_IDS, RUN_COLLAPSE_TIME, COMBAT_ROUND_TIME_COST, BASIC_RECON_TIME,
  FALSE_BROADCAST_TIME, FALSE_BROADCAST_DURATION_BY_STEP, BASIC_RECON_HOP_RANGE,
  INVESTIGATION_MEMORY_DURATION,
} from '../src/data/facilityLayout.js';

/** 플레이어 노드에서 잠기지 않은 통로로 이어진 이웃 하나. */
function openNeighborOf(run, nodeId) {
  const from = nodeId || run.playerNodeId;
  const edge = run.graph.edges.find((e) => (e.from === from || e.to === from)
    && !e.features.includes('blocked') && !e.features.includes('highGround') && !e.features.includes('oneWay'));
  return edge.from === from ? edge.to : edge.from;
}

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed);
}

function snapshotOf(run, playerState = {}) {
  return {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    playerState: {
      hp: 50, maxHp: 50, overloadActive: false, loadout: {}, inventory: { items: [], ammo: 0, capacity: 12 }, ...playerState,
    },
  };
}

test('a retrieval contract is not completed by acting at the objective — only by reaching an open exit', () => {
  const base = makeRun(7);
  const contract = CONTRACT_DEFS.find((c) => c.type === 'retrieval');
  const landmark = base.graph.landmarks.find((l) => l.sectorId === contract.sectorId);
  const goods = Array.from({ length: contract.goodsSlots }, (_, i) => ({
    id: `g${i}`, kind: 'contractGoods', contractId: contract.id, value: contract.goodsValuePerSlot,
  }));
  const run = {
    ...base,
    playerNodeId: landmark.nodeId,
    contract: { ...contract, status: 'acquired', acquiredAt: base.time },
  };
  const held = snapshotOf(run, { inventory: { items: goods, ammo: 0, capacity: 12 } });

  // 물건을 들고 목표부에 서서 아무 행동이나 해도 계약은 완료되지 않는다 — 들고 나가야 한다.
  const after = gameReducer(held, { type: 'BASIC_RECON' });
  assert.equal(after.facilityRunState.contract.status, 'acquired', '목표부에서 정찰만으로 계약이 끝나면 마지막 장이 사라진다');
  assert.equal(after.currentScreen, 'map');

  // 출구를 밟는 순간에만 완료된다.
  const edge = base.graph.edges.find((e) => e.from === landmark.nodeId || e.to === landmark.nodeId);
  const neighborId = edge.from === landmark.nodeId ? edge.to : edge.from;
  const opened = {
    ...after,
    facilityRunState: {
      ...after.facilityRunState,
      exits: { ...after.facilityRunState.exits, A: { ...after.facilityRunState.exits.A, nodeId: neighborId, status: 'open', openEndsAt: after.facilityRunState.time + 1000 } },
    },
  };
  const extracted = gameReducer(opened, { type: 'MOVE_TO_NODE', nodeId: neighborId });
  assert.equal(extracted.currentScreen, 'extractionComplete');
  assert.equal(extracted.facilityRunState.contract.status, 'completed');
});

test('a discovery is reported to the sector it happened in, not to the finder’s home sector', () => {
  const base = makeRun(1);
  // 본적이 다른 구역인 위협을 데려와, 남의 구역 노드에 있는 시체를 밟게 한다.
  const visitor = Object.values(base.threats).find((t) => t.sectorId !== 'labs');
  assert.ok(visitor, 'fixture should contain a threat from another sector');
  const labsNodes = base.graph.nodes.filter((n) => n.sectorId === 'labs').slice(0, 2);
  const to = labsNodes[1] || labsNodes[0];

  const state = {
    ...base,
    playerNodeId: null,
    corpses: [{ id: 'c1', nodeId: to.id, sectorId: 'labs', createdAt: 0 }],
    threats: {
      ...base.threats,
      // 순찰 목표를 자기가 선 자리로 두면 다음 틱에 그 자리를 다시 '밟아' 발견 판정이 돈다
      // (reinforcement.test.js와 같은 방식).
      [visitor.id]: { ...visitor, nodeId: to.id, patrolRoute: [to.id], patrolIndex: 0, nextMoveAt: base.time, mode: 'patrol' },
    },
  };
  const after = advanceTime(state, state.time + 1);

  assert.equal(after.corpses.length, 0, '시체는 신고되어 사라진다');
  assert.equal(after.sectorAlerts.labs.level, 1, '시체가 있던 구역의 경계도가 오른다');
  assert.equal(after.sectorAlerts[visitor.sectorId].level, 0, '발견자의 본적 구역은 오르지 않는다');
  // 이중계산 방지 등록도 같은 구역에 들어가야 한다 — 그러지 않으면 조사하러 온 위협이 허탕치며
  // 한 번 더 올려 시체 하나가 두 단계를 만든다.
  const investigation = after.noiseEvents[after.noiseEvents.length - 1];
  assert.ok(after.sectorAlerts.labs.resolvedEventIds.includes(investigation.id), '조사 소음은 그 구역에서 이미 처리된 것으로 등록된다');
});

test('a false broadcast cannot dump alert into a sector that is already at maximum', () => {
  const base = makeRun(1);
  const entry = base.graph.accessInterfaces[0];
  const sectorId = entry.nodeId.split('_')[0];
  const neighborId = ADJACENT_SECTOR_IDS[sectorId][0];
  const state = {
    ...base,
    playerNodeId: entry.nodeId,
    sectorAlerts: {
      ...base.sectorAlerts,
      [sectorId]: { level: 3, resolvedEventIds: [] },
      [neighborId]: { level: 3, resolvedEventIds: [] },
    },
  };
  // 상한에 찬 곳으로 넘기면 +1이 잘려 사라진다 — 옮기는 수단이 지우는 수단이 되므로 막는다.
  assert.throws(() => broadcastFalseTarget(state, 3, neighborId), /maximum/);
  assert.equal(state.sectorAlerts[sectorId].level, 3, '실패한 시도는 아무것도 바꾸지 않는다');
});

test('an ambushed prize grants nothing — the ambush is the cost of rushing it', () => {
  const base = makeRun(3);
  const nodeId = base.playerNodeId;
  const threat = Object.values(base.threats)[0];
  // 옆 노드에서 추적해 들어오는 위협을 세운다 — 파밍이 끝나기 전에 **도착**해야 중단이다
  // (시작 때 이미 같은 노드에 있던 위협은 그 조우가 이미 열린 것이라 중단 사유가 아니다).
  const neighbor = base.graph.edges.find((e) => e.from === nodeId || e.to === nodeId);
  const approachNodeId = neighbor.from === nodeId ? neighbor.to : neighbor.from;
  const run = {
    ...base,
    graph: { ...base.graph, opportunities: [{ id: 'p1', nodeId, keyEligible: false, usesRemaining: 1, grade: 'prize', tier: 'elite', axis: 'combat' }] },
    threats: {
      [threat.id]: {
        ...threat,
        nodeId: approachNodeId,
        mode: 'pursuit',
        alert: 3,
        pursuitStrength: 3,
        lastKnownPlayerNodeId: nodeId,
        target: { kind: 'player', nodeId },
        nextMoveAt: base.time + 1,
      },
    },
  };
  const after = gameReducer(snapshotOf(run), { type: 'USE_OPPORTUNITY', opportunityId: 'p1', mode: 'rush' });

  assert.equal(after.facilityRunState.lastTaskOutcome.status, 'interrupted', '적이 도착하면 파밍이 중단된다');
  assert.equal(after.playerState.inventory.items.length, 0, '매복당한 확보 대상이 보급품 보상으로 새면 안 된다');
  assert.equal(after.playerState.inventory.ammo, 0);
  assert.equal(after.facilityRunState.pendingFarmChoice, null, '고를 틈도 없다');
  assert.equal(after.facilityRunState.graph.opportunities[0].usesRemaining, 1, '기회도 소모되지 않는다');
});

test('a supply farm still grants while a prize choice is pending — and a second prize cannot overwrite the standing options', () => {
  const base = makeRun(3);
  const nodeId = base.playerNodeId;
  const run = {
    ...base,
    // 이 테스트가 보는 것은 후보 대기의 장부이지 중단 규칙이 아니다 — 위협을 비워 둔다.
    threats: {},
    graph: {
      ...base.graph,
      opportunities: [
        { id: 'p1', nodeId, keyEligible: false, usesRemaining: 1, grade: 'prize', tier: 'normal', axis: 'resource' },
        { id: 'p2', nodeId, keyEligible: false, usesRemaining: 1, grade: 'prize', tier: 'elite', axis: 'combat' },
        { id: 's1', nodeId, keyEligible: false, usesRemaining: 1, grade: 'supply' },
      ],
    },
  };
  const farmed = gameReducer(snapshotOf(run), { type: 'USE_OPPORTUNITY', opportunityId: 'p1', mode: 'normal' });
  const standing = farmed.facilityRunState.pendingFarmChoice;
  assert.ok(standing, '확보 대상 후보가 서 있다');

  // 선택이 대기 중이어도 보급품은 예전처럼 바로 들어와야 한다.
  const supplied = gameReducer(farmed, { type: 'USE_OPPORTUNITY', opportunityId: 's1', mode: 'normal' });
  const gained = supplied.playerState.inventory.items.length + (supplied.playerState.inventory.ammo > 0 ? 1 : 0);
  assert.equal(gained, 1, '보급품은 대기 중인 선택과 무관하게 지급된다');
  assert.deepEqual(supplied.facilityRunState.pendingFarmChoice, standing, '그리고 서 있던 후보를 건드리지 않는다');

  // 반대로 두 번째 확보 대상은 시작조차 되지 않는다 — 허용하면 앞선 후보가 조용히 덮인다.
  const blocked = gameReducer(supplied, { type: 'USE_OPPORTUNITY', opportunityId: 'p2', mode: 'normal' });
  assert.equal(blocked, supplied, '고르기 전에는 다른 확보 대상을 팔 수 없다');
  assert.throws(() => useOpportunity(supplied.facilityRunState, 'p2', 'normal'), /pending farm reward/);
});

test('equipment broken by a ladder cost falls back into the inventory instead of vanishing', () => {
  const base = makeRun(1);
  const weapon = { id: 'w1', kind: 'equipment', equipmentId: 'katana', durability: 1 };
  const snapshot = snapshotOf(
    { ...base, pendingDurabilityLoss: 1 },
    { loadout: { weapons: [weapon], top: null, bottom: null, modules: [], implantIds: [], consumableSlots: [] } },
  );
  const after = gameReducer(snapshot, { type: 'BASIC_RECON' });

  assert.equal(after.playerState.loadout.weapons.length, 0, '파손된 장비는 슬롯에서 빠진다');
  // id는 인벤토리가 새로 발급한다(addItem은 넘겨받은 id를 항상 버린다, 리뷰 A4) — 물건이
  // 남아 있는지는 equipmentId로 본다.
  const returned = after.playerState.inventory.items.find((i) => i.equipmentId === 'katana');
  assert.ok(returned, '하지만 게임에서 사라지지는 않는다');
  assert.equal(returned.durability, 0);
  assert.equal(after.facilityRunState.pendingDurabilityLoss, 0);
});

test('HP reaching zero from a ladder cost ends the run', () => {
  const base = makeRun(1);
  const snapshot = snapshotOf({ ...base, pendingHpLoss: 8 }, { hp: 5 });
  const after = gameReducer(snapshot, { type: 'BASIC_RECON' });
  assert.equal(after.playerState.hp, 0);
  assert.equal(after.currentScreen, 'gameOver', 'HP 0으로 런이 계속되면 안 된다');
});

test('expired power cuts are pruned instead of accumulating for the whole run', () => {
  const base = makeRun(1);
  const state = { ...base, powerCuts: [{ sectorId: 'labs', expiresAt: 100 }, { sectorId: 'entrance', expiresAt: 99999 }] };
  const after = advanceTime(state, 400);
  assert.deepEqual(after.powerCuts.map((c) => c.sectorId), ['entrance']);
});


// ---- 코드 리뷰 2차: 정수 칸 전환의 접합부 ----

/** 라운드 정산만으로 붕괴 시각을 넘길 수 있는 전투 스냅샷. */
function combatSnapshotAt(time) {
  const { graph } = generateFacilityGraph(1);
  const run = { ...createRunState(graph, 1), time, threats: {} };
  const combat = beginPlayerFirst(createCombatState({
    deckEntries: Array.from({ length: 10 }, (_, i) => ({ defId: 'katana_slash', instanceId: `c-${i}` })),
    monsterIds: ['nibbit', 'nibbit'], playerHp: 70, playerMaxHp: 70, usableAmmo: 8, maxLoad: 999,
    overloadActive: false, extraDrawPerTurn: 0, turnStartAoeDamage: 0,
    inventoryItemIdsInOrder: [], inventoryCapacity: 30, rngState: { seed: 1 },
  }));
  return {
    currentScreen: 'combat',
    activeCombatState: combat,
    playerState: { hp: 70, maxHp: 70, overloadActive: false, loadout: { consumableSlots: [] }, inventory: { items: [], ammo: 0, capacity: 12 } },
    facilityRunState: { ...run, engagedThreatId: 'ghost' },
    combatContext: {
      nodeId: run.playerNodeId, threatId: 'ghost', ammoAtStart: 8, noiseGauge: 0, noiseIntensity: 0,
      roundSettled: false, disengage: { escapeIntent: false, disengageProgress: 0 },
    },
  };
}

test('a round settlement that crosses the collapse deadline ends the run immediately, whatever the combat is doing', () => {
  // 698에 시작한 전투는 라운드 1 정산(3칸)만으로 700을 넘는다. 승패는 아직 나지 않았다.
  const snapshot = combatSnapshotAt(RUN_COLLAPSE_TIME - COMBAT_ROUND_TIME_COST + 1);
  const after = gameReducer(snapshot, { type: 'END_TURN' });

  assert.equal(after.facilityRunState.phase, 'collapsed');
  assert.equal(after.facilityRunState.time, RUN_COLLAPSE_TIME);
  assert.equal(after.currentScreen, 'gameOver', '붕괴한 런에서 계속 카드를 낼 수 있으면 안 된다');
  assert.equal(after.activeCombatState, null);
  assert.equal(after.combatContext, null);
  assert.equal(after.facilityRunState.engagedThreatId, null, '교전 표시도 함께 풀린다');
});

test('a card played on the round that crosses the deadline ends the run too', () => {
  const snapshot = combatSnapshotAt(RUN_COLLAPSE_TIME - COMBAT_ROUND_TIME_COST + 1);
  // 정산은 턴 종료에서 일어나므로, 카드 경로도 같은 검사를 갖는지 보려면 이미 붕괴한 런을 준다.
  const collapsed = {
    ...snapshot,
    facilityRunState: { ...snapshot.facilityRunState, time: RUN_COLLAPSE_TIME, phase: 'collapsed' },
  };
  const card = collapsed.activeCombatState.piles.hand[0];
  const after = gameReducer(collapsed, { type: 'PLAY_CARD', instanceId: card.instanceId, targetId: collapsed.activeCombatState.enemies[0].id });

  assert.equal(after.currentScreen, 'gameOver');
  assert.equal(after.activeCombatState, null);
  assert.equal(after.facilityRunState.engagedThreatId, null);
});

/** 플레이어 노드에 서 있는 위협 하나와, 옆에서 걸어 들어오는 위협 하나를 원하는 순서로 넣는다. */
function twoThreats(order) {
  const { graph } = generateFacilityGraph(1);
  const base = createRunState(graph, 1);
  const nodeId = base.playerNodeId;
  const template = Object.values(base.threats)[0];
  const edge = graph.edges.find((e) => e.from === nodeId || e.to === nodeId);
  const approachNodeId = edge.from === nodeId ? edge.to : edge.from;
  const standing = { ...template, id: 'standing', nodeId, mode: 'patrol', alert: 0, pursuitStrength: 0, target: null, nextMoveAt: 99999 };
  const incoming = {
    ...template,
    id: 'incoming',
    nodeId: approachNodeId,
    mode: 'pursuit',
    alert: 3,
    pursuitStrength: 3,
    lastKnownPlayerNodeId: nodeId,
    target: { kind: 'player', nodeId },
    nextMoveAt: base.time + 1,
  };
  const threats = {};
  for (const t of (order === 'standingFirst' ? [standing, incoming] : [incoming, standing])) threats[t.id] = t;
  return { ...base, threats };
}

for (const order of ['standingFirst', 'incomingFirst']) {
  test(`a newly arriving threat interrupts the task regardless of threat insertion order (${order})`, () => {
    const run = twoThreats(order);
    const after = basicRecon(run);

    assert.equal(after.lastTaskOutcome.status, 'interrupted', '새로 도착한 위협은 순서와 무관하게 작업을 끊는다');
    assert.equal(after.lastTaskOutcome.reason, 'threatContact');
    assert.ok(after.time - run.time < BASIC_RECON_TIME, '경과한 칸만 소모한다');
    assert.equal(after.activeRecon, null, '중단된 정찰은 아무것도 보여주지 않는다');
  });
}

test('a collapse during a task aborts the pending task and says it was the collapse, not an ambush', () => {
  const { graph } = generateFacilityGraph(1);
  const base = { ...createRunState(graph, 1), threats: {}, time: RUN_COLLAPSE_TIME - 2 };
  const nodeId = base.playerNodeId;
  const run = {
    ...base,
    graph: { ...base.graph, opportunities: [{ id: 'p1', nodeId, keyEligible: false, usesRemaining: 1, grade: 'prize', tier: 'elite', axis: 'combat' }] },
  };
  const { state: after } = useOpportunity(run, 'p1', 'normal');

  assert.equal(after.phase, 'collapsed');
  assert.equal(after.pendingTask, null, '끝난 런에 진행 중인 작업이 남으면 안 된다');
  assert.equal(after.lastTaskOutcome.status, 'interrupted');
  assert.equal(after.lastTaskOutcome.reason, 'collapsed');
  assert.notEqual(after.lastActionResult?.status, 'ambushed', '붕괴를 매복이라고 말하면 없는 적을 말하는 셈이다');
  assert.equal(after.graph.opportunities[0].usesRemaining, 1, '기회도 소모되지 않는다');
});

test('a false broadcast whose target filled up while it ran moves nothing — total alert stays conserved', () => {
  const { graph } = generateFacilityGraph(1);
  const base = { ...createRunState(graph, 1), threats: {} };
  const entry = base.graph.accessInterfaces[0];
  const sectorId = entry.nodeId.split('_')[0];
  const targetSectorId = ADJACENT_SECTOR_IDS[sectorId][0];
  const run = {
    ...base,
    playerNodeId: entry.nodeId,
    sectorAlerts: {
      ...base.sectorAlerts,
      [sectorId]: { level: 2, resolvedEventIds: [] },
      [targetSectorId]: { level: 2, resolvedEventIds: [] },
    },
  };
  // 예약 시점에는 둘 다 조건을 만족한다. 작업이 도는 동안 대상 구역이 상한에 차면, 완료 시각에
  // 그대로 적용할 때 +1이 잘려 총량이 하나 사라진다(ADR-0073).
  const reserved = scheduleTask(run, {
    kind: 'falseBroadcast',
    timeCost: FALSE_BROADCAST_TIME,
    params: {
      sectorId,
      targetSectorId,
      decoyNodeId: null,
      intensity: 2,
      duration: FALSE_BROADCAST_DURATION_BY_STEP.standard,
    },
  });
  assert.equal(reserved.pendingTask, null, 'scheduleTask는 완료 시각까지 진행한다');

  const raisedMidway = {
    ...run,
    sectorAlerts: { ...run.sectorAlerts, [targetSectorId]: { level: 3, resolvedEventIds: [] } },
  };
  const before = raisedMidway.sectorAlerts[sectorId].level + raisedMidway.sectorAlerts[targetSectorId].level;
  const done = scheduleTask(raisedMidway, {
    kind: 'falseBroadcast',
    timeCost: FALSE_BROADCAST_TIME,
    params: {
      sectorId,
      targetSectorId,
      decoyNodeId: null,
      intensity: 2,
      duration: FALSE_BROADCAST_DURATION_BY_STEP.standard,
    },
  });
  const after = done.sectorAlerts[sectorId].level + done.sectorAlerts[targetSectorId].level;
  assert.equal(after, before, '옮길 수 없으면 옮기지 않는다 — 옮기는 수단이 지우는 수단이 되면 안 된다');
  assert.equal(done.sectorAlerts[sectorId].level, 2, '이쪽만 내려가지도 않는다');
});

test('an unknown task kind throws instead of quietly burning time for nothing', () => {
  const { graph } = generateFacilityGraph(1);
  const run = { ...createRunState(graph, 1), threats: {} };
  assert.throws(() => scheduleTask(run, { kind: 'typo_here', timeCost: 2 }), /unknown task kind/);
  assert.throws(() => applyCapabilityCost(run, { timeCost: 2 }, undefined), /requires a taskKind/);
});


// ---- 대기 중에는 주변을 관측하지 않는다 ----

test('대기 중에는 인접 위협 관측이 끊기고, 다음 유료 행동이 끝나면 다시 실시간이 된다', () => {
  const base = makeRun(3);
  const quiet = refreshLocalObservations({ ...base, threats: {} });
  const neighborId = openNeighborOf(quiet);
  const observedAt = quiet.observations[neighborId].observedAt;
  assert.equal(quiet.observations[neighborId].hasThreat, false);
  assert.equal(observationSuspended(quiet), false, '아직 대기하지 않았다면 인접은 실시간이다');

  // 대기하는 동안 옆 방에 위협이 자리를 잡는다 — 숨어서 기다리는 플레이어는 그것을 보지 못한다.
  const template = Object.values(base.threats)[0];
  const watched = {
    ...quiet,
    // 순찰 경로를 그 노드 하나로 묶어 둔다 — nextMoveAt만 멀리 미루면 상태 변경이 예약을
    // 당겨(min 규칙) 대기 중에 위협이 자리를 떠 버린다.
    threats: { [template.id]: { ...template, nodeId: neighborId, mode: 'patrol', patrolRoute: [neighborId], patrolIndex: 0 } },
  };

  let waited = watched;
  for (let i = 0; i < 5; i++) waited = refreshLocalObservations(waitOneTick(waited));
  assert.equal(waited.time, watched.time + 5);
  assert.ok(observationSuspended(waited), '대기가 끝난 뒤에도 인접 관측은 끊긴 채로 남는다');
  assert.equal(waited.observations[neighborId].observedAt, observedAt, '인접 관측 시각이 갱신됐다');
  assert.equal(waited.observations[neighborId].hasThreat, false, '대기 중에 옆 방을 들여다봤다');
  assert.equal(waited.observations[waited.playerNodeId].observedAt, waited.time, '서 있는 자리는 계속 안다');

  // 유료 행동 하나면 다시 실시간이다.
  const acted = refreshLocalObservations(scheduleTask(waited, { kind: 'equipSwap', timeCost: 3 }));
  assert.equal(observationSuspended(acted), false);
  assert.equal(acted.observations[neighborId].observedAt, acted.time);
  assert.equal(acted.observations[neighborId].hasThreat, true, '유료 행동 뒤에는 옆 방이 다시 보인다');
});

test('대기 중이어도 같은 방에 들어온 위협과는 조우한다 — 끊기는 것은 관측뿐이다', () => {
  const base = makeRun(3);
  const quiet = refreshLocalObservations({ ...base, threats: {} });
  const neighborId = openNeighborOf(quiet);
  const template = Object.values(base.threats)[0];
  const stalker = {
    ...template,
    nodeId: neighborId,
    mode: 'pursuit',
    lastKnownPlayerNodeId: quiet.playerNodeId,
    pursuitStrength: 3,
    nextMoveAt: quiet.time + 1,
  };
  const waited = waitOneTick({ ...quiet, threats: { [template.id]: stalker } });
  assert.ok(waited.combatTrigger, '숨어 있어도 같은 방에 들어오면 조우는 열린다');
  assert.equal(waited.combatTrigger.nodeId, quiet.playerNodeId);
});

// ---- 정찰 사거리 2홉과 확보 대상 정보 은닉 ----

test('기본 정찰은 2홉까지 관측하고 3홉은 건드리지 않는다', () => {
  const run = makeRun(3);
  const scouted = basicRecon(run);
  const hops = bfsHopDistances(run.graph.edges, run.playerNodeId);
  const watched = new Set(scouted.activeRecon.targetNodeIds);
  const twoHopIds = [...hops].filter(([, hop]) => hop === BASIC_RECON_HOP_RANGE).map(([id]) => id);
  assert.ok(twoHopIds.length > 0, '2홉 노드가 있는 시드여야 한다');
  for (const nodeId of twoHopIds) {
    assert.ok(watched.has(nodeId), `2홉 ${nodeId}가 정찰 범위 밖이다`);
    assert.ok(scouted.observations[nodeId], `2홉 ${nodeId}가 관측되지 않았다`);
  }
  const beyond = [...hops].filter(([, hop]) => hop === BASIC_RECON_HOP_RANGE + 1).map(([id]) => id);
  assert.ok(beyond.length > 0);
  assert.ok(beyond.every((nodeId) => !watched.has(nodeId)), '3홉까지 보면 정찰이 아니라 투시다');
});

test('확보 대상의 등급과 역할축은 그 노드를 정찰한 뒤에만 보이고, 모른 채로 판 파밍도 실제 등급대로 청구된다', () => {
  const base = makeRun(1);
  const prize = base.graph.opportunities.find((o) => o.grade === 'prize' && o.usesRemaining > 0);
  assert.ok(prize, 'seed 1에 확보 대상이 있어야 한다');
  const run = { ...base, playerNodeId: prize.nodeId, threats: {} };

  assert.equal(prizeGradeKnown(run, prize.id, prize.nodeId), false, '서 있는 것만으로 등급이 보이면 정찰할 이유가 없다');

  // 정찰 전에도 팔 수 있다 — 대신 예고는 하나의 값이 아니라 두 등급을 감싸는 범위다.
  const range = forecastUnknownPrizeFarm('normal');
  const farmed = useOpportunity(run, prize.id, 'normal').state;
  const chargedTicks = farmed.time - run.time;
  assert.ok(chargedTicks >= range.minTime && chargedTicks <= range.maxTime, `범위 예고 ${range.timeText} 밖에서 청구됐다 (${chargedTicks}칸)`);
  assert.equal(chargedTicks, forecastAction('farm', { isPrize: true, tier: prize.tier, mode: 'normal' }).timeCost, '실제 청구는 실제 등급의 정확한 값이다');

  // Perception 0의 정찰은 등급까지만 읽는다 — 역할축은 1부터다(정보 깊이 표).
  const shallow = basicRecon(run, 0);
  assert.equal(prizeGradeKnown(shallow, prize.id, prize.nodeId), true);
  assert.equal(shallow.observations[prize.nodeId].opportunityGrades[prize.id].tier, prize.tier);
  assert.equal(shallow.observations[prize.nodeId].opportunityGrades[prize.id].axis, null);

  // 정찰하면 등급과 축이 관측에 남고, 그 뒤의 무료 관측 갱신이 그것을 지우지 않는다.
  const scouted = basicRecon(run, 1);
  assert.equal(prizeGradeKnown(scouted, prize.id, prize.nodeId), true);
  const grade = scouted.observations[prize.nodeId].opportunityGrades[prize.id];
  assert.equal(grade.tier, prize.tier);
  assert.equal(grade.axis, prize.axis);

  const refreshed = refreshLocalObservations(scouted);
  assert.equal(prizeGradeKnown(refreshed, prize.id, prize.nodeId), true, '무료 관측 갱신이 정찰 산출을 덮어썼다');

  // 그 노드를 떠나도 알아낸 등급은 남는다 — 마지막으로 확인한 정보다.
  const left = refreshLocalObservations(moveToAdjacentNode(refreshed, openNeighborOf(refreshed), 4, 4));
  assert.equal(prizeGradeKnown(left, prize.id, prize.nodeId), true);
});

// ---- 조사 기억 ----

test('허탕친 위협은 같은 소음 사건을 기억이 만료될 때까지 다시 조사하지 않는다', () => {
  const base = makeRun(5);
  const template = Object.values(base.threats)[0];
  const sourceNodeId = openNeighborOf(base, template.nodeId);
  // 플레이어는 멀리 둔다 — 목격이 끼어들면 추적이 소음 조사를 덮어쓴다.
  const sourceHops = bfsHopDistances(base.graph.edges, sourceNodeId);
  const far = base.graph.nodes.find((n) => (sourceHops.get(n.id) ?? 0) > 6);
  const second = { ...template, id: 'threat_witness', nodeId: template.nodeId };
  const run = {
    ...base,
    playerNodeId: far.id,
    threats: { [template.id]: { ...template, mode: 'patrol', nextMoveAt: base.time + 1 }, [second.id]: second },
    // 만료가 한참 남은 소음 — 조사 기억이 없다면 같은 자리를 계속 다시 고를 만큼 오래 살아 있다.
    noiseEvents: [{ id: 'noise_fixture', sourceNodeId, intensity: 4, createdAt: base.time, expiresAt: base.time + 200 }],
  };

  let state = run;
  for (let i = 0; i < 12 && !state.threats[template.id].investigationMemory; i++) {
    state = advanceTime(state, state.time + 1);
  }
  const memory = state.threats[template.id].investigationMemory;
  assert.ok(memory, '소음원에 도착해 허탕치면 조사 기억이 남는다');
  assert.equal(memory.eventId, 'noise_fixture');
  assert.equal(memory.expiresAt, state.time + INVESTIGATION_MEMORY_DURATION);

  const later = advanceTime(state, state.time + 1);
  assert.notEqual(later.threats[template.id].target.kind, 'noise', '기억이 살아 있는데 같은 소음을 다시 조사한다');
  assert.equal(later.threats[second.id].target.kind, 'noise', '기억은 위협마다 따로다 — 다른 위협은 조사할 수 있다');

  // 기억이 만료되면 같은 소음을 다시 고른다.
  const expired = advanceTime(later, memory.expiresAt + 1);
  assert.equal(expired.threats[template.id].target.kind, 'noise', '만료된 기억이 영구 면제가 됐다');
});
