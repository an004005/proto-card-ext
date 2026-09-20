import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph, adjacentSectorIds } from '../src/engine/facilityGraph.js';
import {
  createRunState, advanceTime, requestExtraction, reportNoise, reportSighting, moveToAdjacentNode,
  openSpecialEdge, basicRecon, useOpportunity, useFieldEquipment, isAtOpenExit,
  hackCamera, hackAccessInterface, destroyCamera, cameraHackRange, disableGenerator,
  useConcealment, effectiveStealthWithConcealment, refreshActiveRecon, hackControlRoom,
  isOnFloorPlan, isNodeCharted, canTraverseEdge,
  getSectorLandmarkArrowTarget,
  acquireContractGoods, destroyContractTarget, detonateContractCharge, acquireContractIntel, transmitContractIntel,
} from '../src/engine/runEngine.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';
import { MAP_EQUIPMENT_CAPABILITIES } from '../src/data/facilityEquipmentCapabilities.js';
import {
  EXIT_A_DISABLED_AT, EXIT_OPEN_WINDOW,
  EXIT_ACTIVATE_TIME_BY_HACKING, RUN_COLLAPSE_TIME, THREAT_MOVE_INTERVAL,
  BASIC_RECON_TIME, SUPPLY_FARM_TIME, PRIZE_FARM_TIME, CONCEALMENT_ACTION_TIME_COST, CONTROL_ROOM_HACK_TIME,
  TOWER_ELEVATOR_REQUIREMENT, HALL_STEALTH_PENALTY, LOCKDOWN_THREAT_MOVE_INTERVAL,
  REINFORCEMENT_INTERVAL, CORPSE_DISPOSAL_TIME, CAMERA_FORCE_NOISE,
  NOISE_DURATION, CAMERA_FORCE_TIME, GENERATOR_FORCE_TIME,
  CAPABILITY_STEP_TIME_DELTA, CAPABILITY_STEP_HP_COST,
  CONTRACT_DETONATE_TIME, CONTRACT_DETONATE_MIN_HOPS, ALERT_PRESSURE,
} from '../src/data/facilityLayout.js';
import { buildAdjacency, bfsHopDistances } from '../src/engine/graphUtils.js';
import { finishTask } from './helpers/finishTask.js';

function makeRun(seed = 1, runConfig) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed, runConfig);
}

test('advanceTime is deterministic for the same seed and target', () => {
  const a = advanceTime(makeRun(7), 500);
  const b = advanceTime(makeRun(7), 500);
  assert.deepEqual(a, b);
});

// #4 행동 시간 2칸은 정확히 두 번의 칸 경계를 만들고, 위협의 엣지 이동은 nextMoveAt에 의해서만 발생한다.
test('advancing by 2 ticks lands on time 2 and only moves threats whose nextMoveAt was due', () => {
  const initial = makeRun(3);
  const after = advanceTime(initial, 2);
  assert.equal(after.time, 2);
  for (const threat of Object.values(after.threats)) {
    const before = initial.threats[threat.id];
    if (before.nextMoveAt > 2) {
      assert.equal(threat.nodeId, before.nodeId, `threat ${threat.id} moved before its nextMoveAt`);
    }
  }
  // every patrol-mode threat starts with nextMoveAt = THREAT_MOVE_INTERVAL.patrol (5칸), so at
  // t=2 none of them should have moved yet.
  for (const threat of Object.values(after.threats)) {
    assert.equal(threat.nodeId, initial.threats[threat.id].nodeId);
  }
});

test('a threat left alone eventually walks its patrol route and wraps around', () => {
  let state = makeRun(3);
  const threatId = Object.keys(state.threats)[0];
  const positions = new Set([state.threats[threatId].nodeId]);
  for (let i = 0; i < 20; i++) {
    state = advanceTime(state, state.time + THREAT_MOVE_INTERVAL.patrol);
    positions.add(state.threats[threatId].nodeId);
  }
  // over 20 patrol-interval steps it should have visited more than just its start node, and
  // never left its own sector.
  assert.ok(positions.size > 1, 'threat never moved');
  const sectorId = state.threats[threatId].sectorId;
  for (const nodeId of positions) assert.ok(nodeId.startsWith(`${sectorId}_`));
});

// #6/#7 일반 탈출구 요청/개방/재차단/비활성/붕괴 전이, Hacking별 개방 대기.
test('exit activation lifecycle: 가동 -> 개방 -> 닫힘, 그리고 다시 가동할 수 있다', () => {
  let state = makeRun(5);
  const hacking = 2; // -2..4 index 4 -> EXIT_ACTIVATE_TIME_BY_HACKING[4] = 13칸
  // 가동에 드는 것은 1칸이고, 나머지는 그 자리에서 대기로 채우는 게이지다(ADR-0084).
  state = requestExtraction(state, 'A', hacking);
  assert.equal(state.exits.A.status, 'requesting');
  assert.equal(state.exits.A.signalStartedAt, 0);
  assert.equal(state.time, 1);

  const gauge = EXIT_ACTIVATE_TIME_BY_HACKING[hacking + 2];
  const opensAt = gauge;
  state = advanceTime(state, opensAt - 1);
  assert.equal(state.exits.A.status, 'requesting', '게이지가 차기 전에는 열리지 않는다');
  state = advanceTime(state, opensAt);
  assert.equal(state.exits.A.status, 'open');
  assert.equal(state.exits.A.openEndsAt, opensAt + EXIT_OPEN_WINDOW);
  assert.equal(state.pendingTask, null, '게이지가 차면서 작업도 끝난다');

  state = advanceTime(state, opensAt + EXIT_OPEN_WINDOW);
  assert.equal(state.exits.A.status, 'closed');
  assert.equal(state.exits.A.signalStartedAt, null);

  // still before disabledAt -> can activate again
  const before = state.time;
  state = requestExtraction(state, 'A', hacking);
  assert.equal(state.exits.A.status, 'requesting');
  assert.equal(state.time, before + 1);
});

test('isAtOpenExit: true only while standing on an open standard exit, or the key exit while holding the key', () => {
  let state = makeRun(5);
  assert.equal(isAtOpenExit(state), false);

  // standing at A's node before it opens -> not yet
  state = { ...state, playerNodeId: state.exits.A.nodeId };
  assert.equal(isAtOpenExit(state), false);
  state = requestExtraction(state, 'A', 2);
  state = advanceTime(state, EXIT_ACTIVATE_TIME_BY_HACKING[2 + 2]);
  assert.equal(state.exits.A.status, 'open');
  assert.equal(isAtOpenExit(state), true);
  // being open elsewhere doesn't count
  assert.equal(isAtOpenExit({ ...state, playerNodeId: state.exits.key.nodeId }), false);

  // key exit: discovered but not standing there -> false; standing there but not discovered -> false
  const keyState = { ...makeRun(5), playerNodeId: makeRun(5).exits.key.nodeId };
  assert.equal(isAtOpenExit(keyState), false);
  assert.equal(isAtOpenExit({ ...keyState, keyDiscovered: true }), true);
  assert.equal(isAtOpenExit({ ...keyState, keyDiscovered: false }), false);
});

test('exit A cannot be requested once disabled, and the run still ends at RUN_COLLAPSE_TIME', () => {
  let state = makeRun(9);
  state = advanceTime(state, EXIT_A_DISABLED_AT);
  assert.equal(state.exits.A.status, 'disabled');
  assert.throws(() => requestExtraction(state, 'A', 0));
  // 표준 출구는 A 하나뿐이다(ADR-0083) — B는 없다.
  assert.equal(state.exits.B, undefined);

  state = advanceTime(state, RUN_COLLAPSE_TIME);
  assert.equal(state.phase, 'collapsed');
  assert.equal(state.time, RUN_COLLAPSE_TIME);
});

test('collapse at RUN_COLLAPSE_TIME takes priority even mid-request', () => {
  let state = makeRun(11);
  state = advanceTime(state, EXIT_A_DISABLED_AT - 1); // activate just before A disables
  state = requestExtraction(state, 'A', 4); // fastest gauge tier
  // 적 접촉이 진행을 끊고 돌아올 수 있으므로(가동 작업이 중단된다) 붕괴까지 계속 민다.
  for (let i = 0; i < 5 && state.phase === 'active'; i++) state = advanceTime(state, RUN_COLLAPSE_TIME + 50);
  assert.equal(state.phase, 'collapsed');
  assert.equal(state.time, RUN_COLLAPSE_TIME);
});

test('all EXIT_ACTIVATE_TIME_BY_HACKING tiers are honored', () => {
  const tiers = [-2, -1, 0, 1, 2, 3, 4];
  for (const hacking of tiers) {
    let state = makeRun(2);
    state = requestExtraction(state, 'A', hacking);
    const gauge = EXIT_ACTIVATE_TIME_BY_HACKING[Math.max(-2, Math.min(4, hacking)) + 2];
    state = advanceTime(state, gauge - 1);
    assert.equal(state.exits.A.status, 'requesting', `hacking ${hacking}: opened too early`);
    state = advanceTime(state, gauge);
    assert.equal(state.exits.A.status, 'open', `hacking ${hacking}: did not open on schedule`);
  }
});

// #5 소음 0~3은 각각 0~3홉만 영향을 주고 NOISE_DURATION칸 뒤 만료된다.
test('noise events expire after their duration and only reach threats within hop range', () => {
  let state = makeRun(13);
  const threatId = Object.keys(state.threats)[0];
  const threat = state.threats[threatId];
  // Put noise far outside the threat's sector at low intensity so it's out of range (patrol
  // fallback should remain the target), then re-check with a matching high-intensity event.
  state = reportNoise(state, threat.patrolRoute[0], 1, 0);
  const stillPatrolling = advanceTime(state, NOISE_DURATION - 1); // 만료 직전
  assert.ok(stillPatrolling.noiseEvents.length === 1);

  // 효과는 [C, C+D)이므로 만료 시각 자체에는 이미 없다.
  const expired = advanceTime(state, NOISE_DURATION);
  assert.equal(expired.noiseEvents.length, 0, `noise event should have expired at t=${NOISE_DURATION}`);
});

/** 그 구역이 실제로 뽑힌 첫 시드의 그래프 — 구역 추첨(ADR-0081) 이후의 픽스처 규칙이다. */
function graphWithSector(seed, sectorId) {
  for (let s = seed; s < seed + 200; s++) {
    const result = generateFacilityGraph(s);
    if (result.graph.sectorIds.includes(sectorId)) return { graph: result.graph, seed: s };
  }
  throw new Error(`no seed near ${seed} draws ${sectorId}`);
}

// D16/D17: 도면은 처음부터 보이고 내용물만 감춘다. 비인가 통로는 도면에 없는 유일한 예외다.
test('the floor plan is charted from the start; only unauthorized passages stay off it', () => {
  const { graph, seed } = graphWithSector(1, 'waste');
  const state = createRunState(graph, seed);
  const offPlan = state.graph.nodes.filter((n) => !isOnFloorPlan(n));
  assert.ok(offPlan.length > 0, 'fixture seed should contain an unauthorized level');
  // 비인가층은 폐기물 처리장에만 있고, 비인가 통로는 전부 거기 속한다.
  assert.deepEqual([...new Set(offPlan.map((n) => n.sectorId))], ['waste']);
  for (const node of state.graph.nodes.filter((n) => n.type === 'crawlway')) {
    assert.equal(isOnFloorPlan(node), false, `${node.id} is an unauthorized passage and should be off the plan`);
  }
  for (const node of state.graph.nodes) {
    assert.equal(isNodeCharted(state, node), isOnFloorPlan(node) || state.visitedNodeIds.includes(node.id));
  }
  // 도면에 없는 노드에 매달린 방도 함께 감춰야 연결선 없이 떠 있는 방이 생기지 않는다.
  const offPlanIds = new Set(offPlan.map((n) => n.id));
  for (const edge of state.graph.edges) {
    if (edge.features.length > 0) continue;
    const from = state.graph.nodes.find((n) => n.id === edge.from);
    const to = state.graph.nodes.find((n) => n.id === edge.to);
    if (offPlanIds.has(edge.from) || offPlanIds.has(edge.to)) continue;
    assert.ok(isOnFloorPlan(from) && isOnFloorPlan(to));
  }
  // 지나가 보면 도면에 없던 통로도 지도에 남는다.
  assert.ok(isNodeCharted({ ...state, visitedNodeIds: [...state.visitedNodeIds, offPlan[0].id] }, offPlan[0]));
});

test('the run can start with the landmarks already revealed, and never with threats revealed (D17)', () => {
  const { graph } = generateFacilityGraph(1);
  const hidden = createRunState(graph, 1);
  assert.deepEqual(hidden.observations, {}, 'by default nothing is revealed up front');

  const revealed = createRunState(graph, 1, { revealLandmarks: true });
  assert.equal(Object.keys(revealed.observations).length, graph.landmarks.length);
  for (const landmark of graph.landmarks) {
    assert.ok(revealed.observations[landmark.nodeId], `landmark ${landmark.id} should be revealed`);
    assert.equal(revealed.observations[landmark.nodeId].hasThreat, false, '난이도는 위협 위치를 절대 공개하지 않는다');
  }
});


// 잠긴 문은 소리를 막지 않지만 사람은 막는다. 탑 승강기가 이 둘을 갈라 보기에 딱 좋다 —
// 1층과 꼭대기는 승강기로 1홉이지만, 승강기를 열기 전에는 계단으로 층을 다 밟아야 한다.
test('a locked edge carries sound but not footsteps: the threat hears through it and walks around', () => {
  const base = makeRun(1);
  const elevator = base.graph.edges.find((e) => e.requiredCapability !== undefined);
  assert.ok(elevator, 'fixture seed should contain the tower elevator');
  const towerCorridors = base.graph.nodes
    .filter((n) => n.sectorId === 'comms' && n.type === 'corridor')
    .sort((a, b) => b.y - a.y);
  const bottom = towerCorridors[0];
  const top = towerCorridors[towerCorridors.length - 1];
  assert.deepEqual([elevator.from, elevator.to].sort(), [bottom.id, top.id].sort());

  // 꼭대기에 위협 하나만 두고, 순찰 경로는 제자리로 만든다 — 움직였다면 소음 때문이다.
  const listener = Object.values(base.threats)[0];
  const state = {
    ...base,
    playerNodeId: bottom.id,
    threats: { [listener.id]: { ...listener, nodeId: top.id, patrolRoute: [top.id], patrolIndex: 0 } },
  };

  // 세기 1은 1홉까지만 들린다. 승강기 너머 1층 소음이 들려야 하고(들리는 거리), 그래도 위협은
  // 승강기를 타지 못하고 계단으로 한 층만 내려와야 한다(가는 거리).
  const heard = advanceTime(reportNoise(state, bottom.id, 1, 1), THREAT_MOVE_INTERVAL.patrol);
  const moved = heard.threats[listener.id];
  assert.equal(moved.target.kind, 'noise', 'the threat should have heard the noise through the locked elevator');
  assert.equal(moved.nodeId, towerCorridors[towerCorridors.length - 2].id, 'the threat should take the stairs one floor down');

  // 승강기를 열면 위협에게도 열린다 — 지름길을 얻는 대신 층 격리를 스스로 깬다.
  const opened = { ...state, openedEdgeIds: [elevator.id] };
  const rode = advanceTime(reportNoise(opened, bottom.id, 1, 1), THREAT_MOVE_INTERVAL.patrol);
  assert.equal(rode.threats[listener.id].nodeId, bottom.id, 'once the elevator is open the threat rides it');
});

test('moveToAdjacentNode requires an edge, costs the traversed edge\'s own (geometry-derived) timeCost, and tracks visited nodes', () => {
  let state = makeRun(21);
  const adjacency = buildAdjacency(state.graph.edges);
  const neighbor = [...adjacency.get(state.playerNodeId)][0];
  const traversedEdge = state.graph.edges.find((e) => (e.from === state.playerNodeId && e.to === neighbor) || (e.to === state.playerNodeId && e.from === neighbor));
  const before = state.time;
  state = moveToAdjacentNode(state, neighbor);
  assert.equal(state.playerNodeId, neighbor);
  assert.equal(state.time, before + 1, '어느 통로든 이동은 1칸이다(ADR-0084)');
  assert.ok(state.visitedNodeIds.includes(neighbor));

  const nonNeighbor = state.graph.nodes.map((n) => n.id).find((id) => id !== state.playerNodeId && !adjacency.get(state.playerNodeId).has(id));
  assert.throws(() => moveToAdjacentNode(state, nonNeighbor));
});

test('high-ground edges are a ladder, not a gate — Mobility 3 is the standard and HP pays the shortfall', () => {
  let state = makeRun(21);
  const edge = state.graph.edges.find((entry) => entry.from === state.playerNodeId || entry.to === state.playerNodeId);
  const destination = edge.from === state.playerNodeId ? edge.to : edge.from;
  state = { ...state, graph: { ...state.graph, edges: state.graph.edges.map((entry) => entry.id === edge.id ? { ...entry, features: ['highGround'] } : entry) } };
  const highGroundEdge = state.graph.edges.find((entry) => entry.id === edge.id);

  // 표준(3): 대가 없음. 이동은 언제나 1칸이다(ADR-0084).
  const standard = moveToAdjacentNode(state, destination, 3, 3);
  assert.equal(standard.time, 1);
  assert.equal(standard.pendingHpLoss || 0, 0, '요구치를 맞췄으면 몸은 멀쩡하다');

  // 무리(2)와 위태(1): 넘을 수는 있고 HP로 값을 치른다. 시간은 이동의 전용 규칙 그대로다.
  const strained = moveToAdjacentNode(state, destination, 2, 3);
  assert.equal(strained.pendingHpLoss, CAPABILITY_STEP_HP_COST.strained);
  assert.equal(strained.time, 1, '층계 시간 가감을 중복으로 받지 않는다 — 고지대도 1칸이다');
  const severe = moveToAdjacentNode(state, destination, 1, 3);
  assert.equal(severe.pendingHpLoss, CAPABILITY_STEP_HP_COST.severe);

  // 불가(0 이하): 0 하한이 걸리므로 -2~0이 전부 같은 불가 구간이다.
  for (const mobility of [0, -1, -2]) {
    assert.equal(canTraverseEdge(state, highGroundEdge, mobility), false, `Mobility ${mobility}은 고지대를 넘지 못한다`);
    assert.throws(() => moveToAdjacentNode(state, destination, mobility, 3), /reachable/);
  }
  for (const mobility of [1, 2, 3, 4]) {
    assert.equal(canTraverseEdge(state, highGroundEdge, mobility), true, `Mobility ${mobility}은 대가를 치르고 넘는다`);
  }
});

// 카메라 발각은 test/cameraDetection.test.js가 본다 — 진입이 아니라 행동 뒤·출발·소음에
// 판정하므로(ADR-0091) 이동 하나로는 다 검사할 수 없다.

test('direct hacking reaches exactly Hacking-level hops, and a hacked interface unlocks its whole sector', () => {
  let state = makeRun(21);
  const hops = bfsHopDistances(state.graph.edges, state.playerNodeId);
  const twoHopNodeId = [...hops.entries()].find(([, hop]) => hop === 2)?.[0];
  assert.ok(twoHopNodeId, 'fixture needs a node exactly 2 hops from the start for this test');
  const playerSectorId = state.graph.nodes.find((n) => n.id === state.playerNodeId).sectorId;
  state = {
    ...state,
    graph: {
      ...state.graph,
      // §10.2: Hacking 1/2/3/4 각각 1/2/3/4홉. 2홉 거리 카메라로 Hacking 1이 닿지 않음을 검증한다.
      cameras: [{ id: 'camera_test', nodeId: twoHopNodeId }],
      accessInterfaces: [{ id: 'interface_test', nodeId: state.playerNodeId }],
      // 접속 인터페이스의 "구역 전체" 사거리 우회를 같은 조건으로 검증하려면 카메라가 플레이어와
      // 같은 구역에 있어야 한다 — 시드가 어떻든 결정적으로 만들기 위해 구역을 맞춰 둔다.
      nodes: state.graph.nodes.map((n) => (n.id === twoHopNodeId ? { ...n, sectorId: playerSectorId } : n)),
    },
  };
  assert.deepEqual([1, 2, 3, 4].map(cameraHackRange), [1, 2, 3, 4]);
  assert.throws(() => hackCamera(state, 'camera_test', -2), /out of range/); // 하한에서는 사거리 자체가 닫힌다
  assert.throws(() => hackCamera(state, 'camera_test', 1), /out of range/); // Hacking 1은 1홉까지만, 카메라는 2홉
  const hacked = finishTask(hackCamera(state, 'camera_test', 2));
  assert.equal(hacked.activeRecon.source, 'camera');
  assert.ok(hacked.activeRecon.targetNodeIds.includes(twoHopNodeId));
  assert.ok(hacked.hackedCameras.some((entry) => entry.cameraId === 'camera_test'));
  assert.ok(hacked.observations[twoHopNodeId]);

  const connected = finishTask(hackAccessInterface(state, 'interface_test', 1));
  assert.ok(connected.hackedInterfaceIds.includes('interface_test'));
  const throughInterface = finishTask(hackCamera(connected, 'camera_test', 1)); // 인터페이스 해킹 후엔 홉 사거리 무관하게 같은 구역 전체에 닿는다
  assert.ok(throughInterface.hackedCameras.some((entry) => entry.cameraId === 'camera_test'));
});

test('camera destruction is a local, loud Force action and permanently stops camera detection', () => {
  let state = makeRun(21);
  state = {
    ...state,
    graph: { ...state.graph, cameras: [{ id: 'camera_test', nodeId: state.playerNodeId }] },
  };
  assert.throws(() => destroyCamera(state, 'camera_test', -2), /force/);
  // Force 0은 막히지 않는다 — 더 오래 걸리고 더 시끄럽다(D8 층계).
  const strained = finishTask(destroyCamera(state, 'camera_test', 0));
  assert.ok(strained.time - state.time > CAMERA_FORCE_TIME, 'Force가 모자라면 오래 걸린다');
  assert.ok(strained.noiseEvents[strained.noiseEvents.length - 1].intensity > CAMERA_FORCE_NOISE, '그리고 더 시끄럽다');

  const destroyed = finishTask(destroyCamera(state, 'camera_test', 1));
  assert.ok(destroyed.disabledCameraIds.includes('camera_test'));
  assert.equal(destroyed.time, state.time + CAMERA_FORCE_TIME);
});

test('basic recon stays live across ticks and stops on movement', () => {
  let state = finishTask(basicRecon(makeRun(21)));
  assert.equal(state.activeRecon.source, 'basic');
  const watchedNodeId = state.activeRecon.targetNodeIds.find((nodeId) => nodeId !== state.playerNodeId);
  const threatId = Object.keys(state.threats)[0];
  state = {
    ...state,
    threats: { ...state.threats, [threatId]: { ...state.threats[threatId], nodeId: watchedNodeId, nextMoveAt: 99999 } },
  };
  state = advanceTime(state, state.time + 1);
  assert.equal(state.observations[watchedNodeId].hasThreat, true);
  state = moveToAdjacentNode(state, watchedNodeId, 4, 3);
  assert.equal(state.activeRecon, null);
});

test('a direct sighting immediately puts a threat into pursuit, overriding noise/patrol', () => {
  let state = makeRun(17);
  const threatId = Object.keys(state.threats)[0];
  const someOtherNode = state.graph.nodes.find((n) => n.id !== state.threats[threatId].nodeId).id;
  state = reportSighting(state, threatId, someOtherNode);
  assert.equal(state.threats[threatId].mode, 'pursuit');
  assert.equal(state.threats[threatId].lastKnownPlayerNodeId, someOtherNode);
});

// #12 같은 소음/가짜 목표 사건은 여러 위협 마커가 조사해도 구역 경계 게이지를 한 번만 올린다.
test('sector alert pressure rises exactly once per resolved event, not per investigating marker', () => {
  let state = makeRun(4);
  // Move the player node away from everywhere so no investigation ever "finds" the player.
  state = { ...state, playerNodeId: 'nowhere' };
  // Advance a little first so the noise event's expiry (createdAt+NOISE_DURATION) lands strictly
  // after the threat's first patrol-interval check — reporting it at t=0 would have it expire on
  // the exact same 칸 the threat first looks for it, which is a genuine "noise already expired"
  // case per the expire-before-target-selection ordering, not a bug.
  state = advanceTime(state, 3);
  const sectorId = Object.values(state.threats)[0].sectorId;
  const sectorThreat = Object.values(state.threats).find((t) => t.sectorId === sectorId);
  state = reportNoise(state, sectorThreat.nodeId, 3, state.time);
  const before = state.sectorAlerts[sectorId].pressure;
  state = advanceTime(state, 30);
  const after = state.sectorAlerts[sectorId].pressure;
  assert.equal(after, before + ALERT_PRESSURE.failedInvestigation, '허탕 조사 하나는 딱 그만큼만 채운다');
  assert.equal(state.sectorAlerts[sectorId].level, 0, '게이지 하나로는 단계가 오르지 않는다');
  assert.equal(state.sectorAlerts[sectorId].resolvedEventIds.length, 1);

  // advancing further without any new stimulus must not escalate it again.
  state = advanceTime(state, 60);
  assert.equal(state.sectorAlerts[sectorId].pressure, after);
});

test('sector alert never decays with time — only a control room can bring it down (ADR-0073)', () => {
  let state = makeRun(4);
  state = { ...state, playerNodeId: 'nowhere' };
  state = advanceTime(state, 3);
  const sectorId = Object.values(state.threats)[0].sectorId;
  const sectorThreat = Object.values(state.threats).find((t) => t.sectorId === sectorId);
  state = reportNoise(state, sectorThreat.nodeId, 3, state.time);
  state = advanceTime(state, 30);
  const escalated = state.sectorAlerts[sectorId].pressure;
  assert.ok(escalated >= 1);

  // 저절로 회복되는 페널티는 결정을 만들지 않는다 — 아무리 조용히 오래 있어도 내려가지 않는다.
  // 게이지도 시간으로 빠지지 않는다(ADR-0082).
  state = advanceTime(state, 200);
  assert.equal(state.sectorAlerts[sectorId].pressure, escalated, 'alert holds across hundreds of 칸');
  assert.equal(state.sectorAlerts[sectorId].resolvedEventIds.length, 1);

  // 조용한 구역은 애초에 오르지 않았으므로 0 그대로다.
  const quietSectorId = Object.keys(state.sectorAlerts).find((id) => id !== sectorId);
  assert.equal(state.sectorAlerts[quietSectorId].level, 0);
});

test('a blocked edge cannot be walked until opened with Force, and oneWay edges only go one direction', () => {
  let state = makeRun(1);
  const blockedEdge = state.graph.edges.find((e) => e.features.includes('blocked') && !e.features.includes('electronic'));
  assert.ok(blockedEdge, 'fixture seed should contain a plain blocked edge');
  state = { ...state, playerNodeId: blockedEdge.from };
  assert.throws(() => moveToAdjacentNode(state, blockedEdge.to));

  state = finishTask(openSpecialEdge(state, blockedEdge.id, 'force', 1, 'normal'));
  assert.ok(state.openedEdgeIds.includes(blockedEdge.id));
  state = { ...state, playerNodeId: blockedEdge.from }; // openSpecialEdge doesn't move the player
  state = moveToAdjacentNode(state, blockedEdge.to);
  assert.equal(state.playerNodeId, blockedEdge.to);

  const oneWayEdge = makeRun(1).graph.edges.find((e) => e.features.includes('oneWay'));
  if (oneWayEdge) {
    let reversed = { ...makeRun(1), playerNodeId: oneWayEdge.to };
    assert.throws(() => moveToAdjacentNode(reversed, oneWayEdge.from), /reachable/);
  }
});

test('openSpecialEdge requires effective capability >=1 and the matching feature tag', () => {
  let state = makeRun(1);
  const blockedEdge = state.graph.edges.find((e) => e.features.includes('blocked'));
  assert.throws(() => openSpecialEdge(state, blockedEdge.id, 'force', 0, 'normal'));
  // 전자는 자물쇠의 종류라 항상 blocked와 함께 온다 — 물리 자물쇠(blocked 단독)는 Hacking으로
  // 열리지 않고, 전자식 자물쇠는 Force와 Hacking 둘 다로 열린다.
  const physicalLock = state.graph.edges.find((e) => e.features.includes('blocked') && !e.features.includes('electronic'));
  assert.ok(physicalLock, 'fixture seed should contain a physical lock');
  const atLock = { ...state, playerNodeId: physicalLock.from };
  assert.throws(() => openSpecialEdge(atLock, physicalLock.id, 'hacking', 4, 'normal'), /electronic/);
  assert.equal(state.graph.edges.filter((e) => e.features.includes('electronic') && !e.features.includes('blocked')).length, 0);
});

// 승강기처럼 배치 원형이 구조적으로 두는 통로는 요구치가 1보다 높다. 요구치는 접근 수단을
// 가리지 않으므로 Force와 Hacking 둘 다 같은 값이 필요하다.
test('an edge with requiredCapability rejects lower capability on both Force and Hacking, and opens at the required level either way', () => {
  const base = makeRun(1);
  const elevator = base.graph.edges.find((e) => e.requiredCapability !== undefined);
  assert.ok(elevator, 'fixture seed should contain the tower elevator');
  assert.equal(elevator.requiredCapability, TOWER_ELEVATOR_REQUIREMENT);
  const state = { ...base, playerNodeId: elevator.from };

  for (const kind of /** @type {const} */ (['force', 'hacking'])) {
    // 층계(D8) 이후 "못 간다"는 요구치보다 3 이상 낮을 때뿐이다. 그 사이 값은 대가를 치르고 열린다.
    for (let capability = -2; capability <= TOWER_ELEVATOR_REQUIREMENT - 3; capability++) {
      assert.throws(
        () => finishTask(openSpecialEdge(state, elevator.id, kind, capability, 'normal')),
        /too low/,
        `${kind} ${capability} should not reach the elevator`,
      );
    }
    const opened = finishTask(openSpecialEdge(state, elevator.id, kind, TOWER_ELEVATOR_REQUIREMENT, 'normal'));
    assert.ok(opened.openedEdgeIds.includes(elevator.id), `${kind} ${TOWER_ELEVATOR_REQUIREMENT} should open the elevator`);
  }
});

test('standing in a hall costs stealth, and the penalty stacks with concealment', () => {
  const state = makeRun(1);
  // 카메라가 있는 노드는 ADR-0079의 상황 보정(−1)이 따로 붙는다 — 지형 보정만 보려면 카메라가
  // 없는 자리를 골라야 한다.
  const cameraNodeIds = new Set(state.graph.cameras.map((c) => c.nodeId));
  const hall = state.graph.nodes.find((n) => n.type === 'hall' && !cameraNodeIds.has(n.id));
  const corridor = state.graph.nodes.find((n) => n.type === 'corridor' && !cameraNodeIds.has(n.id));
  assert.ok(hall && corridor, 'fixture seed should contain a hall and a corridor');

  assert.equal(effectiveStealthWithConcealment(3, { ...state, playerNodeId: corridor.id }), 3);
  assert.equal(effectiveStealthWithConcealment(3, { ...state, playerNodeId: hall.id }), 3 - HALL_STEALTH_PENALTY);

  const concealed = { ...state, playerNodeId: hall.id, activeConcealment: { nodeId: hall.id, bonus: 2 } };
  assert.equal(effectiveStealthWithConcealment(3, concealed), 3 + 2 - HALL_STEALTH_PENALTY);
});

test('basicRecon always succeeds, costs 80/0-noise, and records threat presence for current+adjacent nodes', () => {
  let state = makeRun(3);
  const before = state.time;
  state = finishTask(basicRecon(state));
  assert.equal(state.time, before + BASIC_RECON_TIME);
  assert.equal(state.noiseEvents.length, 0);
  assert.ok(state.observations[state.playerNodeId]);
  const adjacency = buildAdjacency(state.graph.edges);
  for (const neighbor of adjacency.get(state.playerNodeId)) {
    assert.ok(state.observations[neighbor], `neighbor ${neighbor} should be observed`);
  }
});

test('useOpportunity decrements usesRemaining by one per farm, costs its own grade time, reports the pre-rolled keyEligible flag, and can be farmed multiple times until exhausted', () => {
  let state = makeRun(1);
  const opportunity = state.graph.opportunities.find((o) => o.usesRemaining > 0 && o.grade === 'supply');
  assert.ok(opportunity, 'fixture seed should have at least one supply opportunity');
  state = { ...state, playerNodeId: opportunity.nodeId };
  const before = state.time;
  const started = useOpportunity(state, opportunity.id, 'normal');
  const result = { ...started, state: finishTask(started.state) };
  assert.equal(result.keyGranted, opportunity.keyEligible);
  assert.equal(result.state.time, before + SUPPLY_FARM_TIME);
  assert.equal(result.state.graph.opportunities.find((o) => o.id === opportunity.id).usesRemaining, opportunity.usesRemaining - 1);

  let s = result.state;
  for (let i = 1; i < opportunity.usesRemaining; i++) s = finishTask(useOpportunity(s, opportunity.id, 'normal').state);
  assert.equal(s.graph.opportunities.find((o) => o.id === opportunity.id).usesRemaining, 0);
  assert.throws(() => useOpportunity(s, opportunity.id, 'normal'));
});

// D10: 확보 대상은 길고 시끄럽다 — 그 대가가 "저기까지 갈 만한가"를 묻는 장치다.
test('a prize opportunity costs more time than a supply one, and its tier raises the cost further', () => {
  const state = makeRun(1);
  // 위협이 서 있는 노드에서 파밍하면 조우로 중단되어 청구된 칸이 표의 값과 달라진다. 여기서
  // 재려는 것은 표의 값이므로 위협이 없는 자리의 기회만 고른다.
  const quiet = (o) => Object.values(state.threats).every((t) => t.nodeId !== o.nodeId);
  const supply = state.graph.opportunities.find((o) => o.grade === 'supply' && o.usesRemaining > 0 && quiet(o));
  const prize = state.graph.opportunities.find((o) => o.grade === 'prize' && o.usesRemaining > 0 && quiet(o));
  assert.ok(prize, 'fixture seed should have at least one prize opportunity');
  assert.ok(prize.tier && prize.axis, '확보 대상은 등급과 역할축을 함께 갖는다');

  const farm = (opp) => {
    const at = { ...state, playerNodeId: opp.nodeId };
    return finishTask(useOpportunity(at, opp.id, 'normal').state).time - state.time;
  };
  assert.equal(farm(supply), SUPPLY_FARM_TIME);
  assert.equal(farm(prize), PRIZE_FARM_TIME[prize.tier]);
  assert.ok(farm(prize) > farm(supply), '확보 대상이 보급품보다 오래 걸린다');
  assert.ok(PRIZE_FARM_TIME.elite > PRIZE_FARM_TIME.normal, '등급이 높을수록 더 오래 걸린다');
});

test('module_spatial snapshot_scan reveals threat presence within its range and respects cooldown', () => {
  let state = makeRun(1);
  const contract = MAP_EQUIPMENT_CAPABILITIES.module_spatial.fieldAction;
  const before = state.time;
  const startNodeId = state.playerNodeId;
  state = finishTask(useFieldEquipment(state, 'inst1', contract));
  assert.equal(state.time, before + contract.timeCost);
  const hops = bfsHopDistances(state.graph.edges, startNodeId);
  const observedWithinRange = Object.keys(state.observations).every((nodeId) => hops.get(nodeId) <= contract.range);
  assert.ok(observedWithinRange);
  assert.ok(Object.keys(state.observations).length > 1);

  assert.throws(() => useFieldEquipment(state, 'inst1', contract), /cooldown/);
});

test('module_forcefield temporary_barrier blocks threat pathing through the edge but not player movement', () => {
  let state = makeRun(1);
  const threatId = Object.keys(state.threats)[0];
  const threat = state.threats[threatId];
  const barrierEdge = state.graph.edges.find((e) => e.from === threat.patrolRoute[0] || e.to === threat.patrolRoute[0]);
  state = { ...state, playerNodeId: barrierEdge.from };
  const contract = MAP_EQUIPMENT_CAPABILITIES.module_forcefield.fieldAction;
  state = finishTask(useFieldEquipment(state, 'inst2', contract, barrierEdge.id));
  assert.equal(state.activeBarriers.length, 1);

  // Player can still cross it (unless it's also 'blocked'/'oneWay', which fixture edges aren't).
  if (!barrierEdge.features.includes('blocked') && !barrierEdge.features.includes('oneWay')) {
    const other = barrierEdge.from === state.playerNodeId ? barrierEdge.to : barrierEdge.from;
    const moved = moveToAdjacentNode(state, other);
    assert.equal(moved.playerNodeId, other);
  }

  // it expires after its duration.
  const expired = advanceTime(state, state.time + contract.duration);
  assert.equal(expired.activeBarriers.length, 0);
});

test('useFieldEquipment rejects out-of-range targets for remote_intrusion and temporary_barrier', () => {
  const state = makeRun(1);
  const spatialContract = MAP_EQUIPMENT_CAPABILITIES.module_spatial.fieldAction; // snapshot_scan, no target
  const empContract = MAP_EQUIPMENT_CAPABILITIES.module_emp.fieldAction; // remote_intrusion
  const forcefieldContract = MAP_EQUIPMENT_CAPABILITIES.module_forcefield.fieldAction; // temporary_barrier

  const dist = bfsHopDistances(state.graph.edges, state.playerNodeId);
  const farNode = state.graph.nodes.find((n) => (dist.get(n.id) ?? 0) > empContract.range);
  assert.ok(farNode, 'fixture seed should have a node beyond remote_intrusion range');
  assert.throws(() => useFieldEquipment(state, 'inst', empContract, farNode.id), /out of range/);

  const farEdge = state.graph.edges.find((e) => {
    const hf = dist.get(e.from); const ht = dist.get(e.to);
    return (hf === undefined || hf > forcefieldContract.range) && (ht === undefined || ht > forcefieldContract.range);
  });
  assert.ok(farEdge, 'fixture seed should have an edge beyond temporary_barrier range');
  assert.throws(() => useFieldEquipment(state, 'inst', forcefieldContract, farEdge.id), /out of range/);

  // unaffected: a target-less snapshot_scan still works regardless of range.
  const scanned = finishTask(useFieldEquipment(state, 'inst', spatialContract));
  assert.ok(Object.keys(scanned.observations).length > 0);
});

test('battery generators can be hacked directly or through a hacked same-sector interface, and Force is local', () => {
  // 위협은 이 테스트의 주제가 아니다 — 마커가 작업 노드로 들어오면 조우로 게이지가 끊겨
  // 발전기가 실제로 꺼지지 않는다.
  let state = { ...makeRun(21), threats: {} };
  const generator = state.graph.generators.find((entry) => entry.sectorId === 'labs');
  const remoteLabsNode = state.graph.nodes.find((node) => node.sectorId === 'labs' && node.id !== generator.nodeId);
  const localInterface = { id: 'test_labs_interface', nodeId: remoteLabsNode.id };
  state = { ...state, graph: { ...state.graph, accessInterfaces: [localInterface, ...state.graph.accessInterfaces] } };
  state = { ...state, playerNodeId: localInterface.nodeId };
  state = finishTask(hackAccessInterface(state, localInterface.id, 1));
  const disabled = finishTask(disableGenerator(state, generator.id, 'hacking', 1));
  assert.ok(disabled.disabledGeneratorIds.includes(generator.id));

  const wrongInterface = state.graph.accessInterfaces.find((entry) => state.graph.nodes.find((node) => node.id === entry.nodeId)?.sectorId !== 'labs');
  assert.throws(() => disableGenerator({ ...state, playerNodeId: wrongInterface.nodeId, hackedInterfaceIds: [], disabledGeneratorIds: [] }, generator.id, 'hacking', 1));
  assert.throws(() => disableGenerator({ ...state, playerNodeId: localInterface.nodeId, disabledGeneratorIds: [] }, generator.id, 'force', 2));
  const forced = finishTask(disableGenerator({ ...state, playerNodeId: generator.nodeId, disabledGeneratorIds: [] }, generator.id, 'force', 2));
  assert.ok(forced.disabledGeneratorIds.includes(generator.id));
  // 요구치 1에 Force 2 — 여유(surplus)라 표준 GENERATOR_FORCE_TIME보다 빨리 끝난다(D8).
  assert.equal(forced.time, state.time + GENERATOR_FORCE_TIME + CAPABILITY_STEP_TIME_DELTA.surplus);
});

test('useConcealment applies its node\'s fixed bonus, costs CONCEALMENT_ACTION_TIME_COST, and only affects the node it was used at', () => {
  const { graph } = generateFacilityGraph(2);
  // 카메라가 살아 있는 노드는 상황 보정으로 Stealth가 −1이라 은엄폐 값만 보려는 이 테스트의
  // 기준선이 흐려진다 — 장치가 없는 은엄폐 노드를 고른다.
  const cameraNodeIds = new Set(graph.cameras.map((c) => c.nodeId));
  // 떠날 자리도 필요하다 — 목적지에 카메라가 있으면 거기서도 −1이 붙어 "은엄폐가 사라졌다"와
  // 구분되지 않으므로, 카메라 없는 이웃이 하나라도 있는 은엄폐 노드를 고른다.
  // 특수 통로는 잠겨 있거나 고지대거나 일방통행이라 그냥 걸어 나갈 수 없다 — 평범한 통로로
  // 이어진 이웃만 본다(ADR-0097 이후로는 도면의 지름길도 특수 통로다).
  const cameraFreeNeighbor = (id) => {
    const edge = graph.edges.find((e) => {
      if (e.features.length > 0) return false;
      const other = e.from === id ? e.to : e.to === id ? e.from : null;
      return other && !cameraNodeIds.has(other);
    });
    return edge ? (edge.from === id ? edge.to : edge.from) : null;
  };
  const concealedNodeId = Object.keys(graph.concealmentByNodeId)
    .find((id) => !cameraNodeIds.has(id) && cameraFreeNeighbor(id));
  assert.ok(concealedNodeId, 'fixture seed should have at least one concealed node');
  const bonus = graph.concealmentByNodeId[concealedNodeId];

  // 위협이 그 노드로 걸어 들어오면 조우로 작업이 중단되어 청구된 칸이 달라진다. 여기서
  // 보려는 것은 은엄폐 값과 그 비용뿐이므로 마커를 비운다.
  let state = { ...createRunState(graph, 2), threats: {}, playerNodeId: concealedNodeId };
  assert.equal(effectiveStealthWithConcealment(1, state), 1, 'no bonus before use');

  const before = state.time;
  state = finishTask(useConcealment(state));
  assert.equal(state.time, before + CONCEALMENT_ACTION_TIME_COST);
  assert.deepEqual(state.activeConcealment, { nodeId: concealedNodeId, bonus });
  assert.equal(effectiveStealthWithConcealment(1, state), 1 + bonus);

  // moving away clears it — a node without concealment must throw.
  const destinationId = cameraFreeNeighbor(concealedNodeId);
  state = moveToAdjacentNode(state, destinationId);
  assert.equal(state.activeConcealment, null);
  assert.equal(effectiveStealthWithConcealment(1, state), 1);
});

test('useConcealment throws at a node with no concealment', () => {
  const { graph } = generateFacilityGraph(2);
  const plainNodeId = graph.nodes.find((n) => !graph.concealmentByNodeId[n.id]).id;
  const state = { ...createRunState(graph, 2), playerNodeId: plainNodeId };
  assert.throws(() => useConcealment(state));
});

test('concealment is only exposed via observations once recon\'d, not just by being adjacent', () => {
  const { graph } = generateFacilityGraph(2);
  const concealedNodeId = Object.keys(graph.concealmentByNodeId)[0];
  const state = createRunState(graph, 2);
  // 은엄폐 값은 정보 깊이 표에서 Perception 2부터 읽힌다.
  const recon = finishTask(basicRecon({ ...state, playerNodeId: concealedNodeId }, 2));
  assert.equal(recon.observations[concealedNodeId].concealment, graph.concealmentByNodeId[concealedNodeId]);

  const shallow = finishTask(basicRecon({ ...state, playerNodeId: concealedNodeId }, 1));
  assert.equal(shallow.observations[concealedNodeId].concealment, undefined, 'Perception 1은 은엄폐 값까지 읽지 못한다');
});

test('hackControlRoom requires standing at the sector landmark and Hacking 1+', () => {
  const { graph } = generateFacilityGraph(2);
  const state = createRunState(graph, 2);
  assert.throws(() => hackControlRoom(state, 1), /control room/);

  const landmark = graph.landmarks[0];
  const atLandmark = { ...state, playerNodeId: landmark.nodeId };
  assert.throws(() => hackControlRoom(atLandmark, -2), /hacking/);
  // Hacking 0은 들어가긴 한다 — 다만 1단계(순찰 경로 공개)까지만 얻고 시간과 과부화를 더 낸다.
  const strained = finishTask(hackControlRoom(atLandmark, 0));
  assert.ok(strained.revealedPatrolRouteSectorIds.includes(landmark.sectorId));
  assert.ok(strained.time - state.time > CONTROL_ROOM_HACK_TIME, 'Hacking이 모자라면 오래 걸린다');
});

test('hackControlRoom level 1 reveals the sector\'s patrol routes permanently, and costs CONTROL_ROOM_HACK_TIME', () => {
  const { graph } = generateFacilityGraph(2);
  const landmark = graph.landmarks[0];
  const state = { ...createRunState(graph, 2), playerNodeId: landmark.nodeId };
  const before = state.time;
  const next = finishTask(hackControlRoom(state, 1));
  assert.equal(next.time, before + CONTROL_ROOM_HACK_TIME);
  assert.deepEqual(next.revealedPatrolRouteSectorIds, [landmark.sectorId]);
  // sector alert / threat modes untouched at level 1
  assert.equal(next.sectorAlerts[landmark.sectorId].level, state.sectorAlerts[landmark.sectorId].level);
});

test('통제실 장악은 구역당 한 번뿐이다 (C3, ADR-0067)', () => {
  const { graph } = generateFacilityGraph(2);
  const landmark = graph.landmarks[0];
  const state = { ...createRunState(graph, 2), playerNodeId: landmark.nodeId };
  const seized = finishTask(hackControlRoom(state, 3));
  assert.ok(seized.revealedPatrolRouteSectorIds.includes(landmark.sectorId));
  // 두 번째 시도는 거절된다 — 시간만 들이면 경계도를 무한히 0으로 되돌릴 수 있으면 안 된다.
  assert.throws(() => hackControlRoom({ ...seized, playerNodeId: landmark.nodeId }, 3), /already seized/);

  // 다른 구역의 통제실은 여전히 장악할 수 있다.
  const other = graph.landmarks.find((l) => l.sectorId !== landmark.sectorId);
  const otherSeized = finishTask(hackControlRoom({ ...seized, playerNodeId: other.nodeId }, 1));
  assert.ok(otherSeized.revealedPatrolRouteSectorIds.includes(other.sectorId));
});

test('hackControlRoom level 2 lowers this sector alert by (hacking - 1), and level 3 also lowers both adjacent sectors by 1 (D12)', () => {
  const { graph } = generateFacilityGraph(2);
  const landmark = graph.landmarks[0];
  const neighbors = adjacentSectorIds(graph, landmark.sectorId);
  let state = { ...createRunState(graph, 2), playerNodeId: landmark.nodeId };
  const raised = { level: 3, pressure: 0, resolvedEventIds: [] };
  state = {
    ...state,
    sectorAlerts: {
      ...state.sectorAlerts,
      [landmark.sectorId]: raised,
      [neighbors[0]]: { ...raised },
      [neighbors[1]]: { level: 0, pressure: 0, resolvedEventIds: [] },
    },
  };
  // 예전 3단계는 맵 전체 위협을 patrol로 되돌렸다 — 그 효과가 사라졌는지도 같이 본다.
  const threats = {};
  // 위협은 전부 통제실에서 멀찍이(6홉 이상) 옮겨 둔다 — 이 테스트가 보는 것은 경계도 산수인데,
  // 해킹 4칸 사이에 적 접촉이 나면 작업이 중단되어 그 산수를 아예 못 본다.
  const hopsFromPlayer = bfsHopDistances(graph.edges, landmark.nodeId);
  const farNode = graph.nodes.find((n) => (hopsFromPlayer.get(n.id) ?? 0) >= 6);
  for (const [id, t] of Object.entries(state.threats)) {
    threats[id] = { ...t, nodeId: farNode.id, mode: 'pursuit', pursuitStrength: 3, lastKnownPlayerNodeId: farNode.id };
  }
  // 경계도 3단계는 추적자를 내보낸다(ADR-0092). 이 테스트가 보는 것은 경계도 산수이므로 그
  // 구역들을 "이미 한 번 내보낸" 것으로 표시해 둔다 — 추적자 규칙은 hunter.test.js가 본다.
  state = { ...state, threats, hunterSpawnedSectorIds: [landmark.sectorId, neighbors[0]] };

  const level2 = finishTask(hackControlRoom(state, 2));
  assert.equal(level2.sectorAlerts[landmark.sectorId].level, 2); // 3 - (2-1) = 2
  assert.deepEqual(level2.revealedPatrolRouteSectorIds, [landmark.sectorId]); // level 1 effect included
  assert.equal(level2.sectorAlerts[neighbors[0]].level, 3, '2단계는 인접 구역을 건드리지 않는다');

  const level3 = finishTask(hackControlRoom(state, 3));
  assert.equal(level3.sectorAlerts[landmark.sectorId].level, 1); // 3 - (3-1) = 1
  assert.equal(level3.sectorAlerts[neighbors[0]].level, 2, '인접 구역은 1만 내려간다');
  assert.equal(level3.sectorAlerts[neighbors[1]].level, 0, '이미 0인 인접 구역은 음수로 가지 않는다');
  // 맵 전체 patrol 전환은 D12에서 삭제됐다 — 3단계가 위협 상태를 건드리면 안 된다. 게이지가
  // 차는 동안의 경계 감쇠는 별개의 규칙이므로, 같은 칸만큼 그냥 흘려보낸 대조군과 비교한다.
  const idled = advanceTime(state, level3.time);
  assert.deepEqual(
    Object.fromEntries(Object.entries(level3.threats).map(([id, t]) => [id, t.mode])),
    Object.fromEntries(Object.entries(idled.threats).map(([id, t]) => [id, t.mode])),
    '통제실 장악은 위협의 mode를 바꾸지 않는다',
  );
});

test('getSectorLandmarkArrowTarget points at the current sector\'s landmark until it has been observed, and is null without the implant', () => {
  const { graph } = generateFacilityGraph(2);
  const state = createRunState(graph, 2);
  const playerSectorId = graph.nodes.find((n) => n.id === state.playerNodeId).sectorId;
  const landmark = graph.landmarks.find((l) => l.sectorId === playerSectorId);

  assert.equal(getSectorLandmarkArrowTarget(state, false), null, 'no implant -> no arrow');
  assert.deepEqual(getSectorLandmarkArrowTarget(state, true), landmark);

  const observed = { ...state, observations: { ...state.observations, [landmark.nodeId]: { observedAt: 0, hasThreat: false } } };
  assert.equal(getSectorLandmarkArrowTarget(observed, true), null, 'landmark already observed -> arrow gone');
});

// ---- 계약(§3단계, D3·D4·D21·D22) ----

// 계약 행동 자체를 보는 테스트라 위협을 비운다 — 현장 작업이 적 접촉으로 중단되는 규칙
// (planned §9.4)은 taskScheduling.test.js에서 따로 본다.
function withContract(seed, contractId) {
  const contract = CONTRACT_DEFS.find((c) => c.id === contractId);
  // 구역은 런마다 넷만 뽑히므로(ADR-0081) 아무 시드나 이 계약의 목표부 구역을 갖고 있지는
  // 않다. 주어진 시드부터 올라가며 그 구역이 든 첫 시드를 쓴다 — 여전히 결정론적이다.
  const { graph, seed: used } = graphWithSector(seed, contract.sectorId);
  return { ...createRunState(graph, used, { contract }), threats: {} };
}

test('acquireContractGoods requires being at the objective and Stealth or Mobility 1+, then sets acquired + lockdown', () => {
  const state = withContract(1, 'sample_retrieval');
  const landmark = state.graph.landmarks.find((l) => l.sectorId === state.contract.sectorId);
  assert.notEqual(landmark.nodeId, state.playerNodeId, 'fixture should not start at the objective');

  assert.throws(() => acquireContractGoods(state, 1, 1), /objective/, 'wrong node should be rejected');

  const at = { ...state, playerNodeId: landmark.nodeId };
  assert.throws(() => acquireContractGoods(at, -2, -2), /stealth|mobility/);
  // 0/0은 막히지 않는다 — 둘 중 높은 쪽(여기선 동률이라 Stealth)의 통화로 값을 치른다.
  const strained = finishTask(acquireContractGoods(at, 0, 0));
  assert.equal(strained.contract.status, 'acquired');
  assert.ok(strained.evidence.some((e) => e.nodeId === landmark.nodeId && e.tier === 2), 'Stealth가 모자라면 강한 흔적이 남는다');

  const acquired = finishTask(acquireContractGoods(at, 1, 0));
  assert.equal(acquired.contract.status, 'acquired');
  // 확보는 작업 **완료 시각**에 일어난다 — 봉쇄도 그때 켜진다(planned §9.5).
  assert.equal(acquired.contract.acquiredAt, acquired.time);
  assert.ok(acquired.lockdown, 'lockdown should activate on acquisition');
  assert.equal(acquired.lockdown.startedAt, acquired.time);
  // 봉쇄는 출구 폐쇄 시각을 건드리지 않는다(ADR-0083).
  assert.equal(acquired.exits.A.disabledAt, EXIT_A_DISABLED_AT);

  assert.throws(() => acquireContractGoods(acquired, 1, 1), /no retrieval contract/, 'already-acquired contract cannot be acquired again');
});

test('파괴 계약은 설치와 기폭 두 장이다 — 설치에서 봉쇄가 켜지고, 기폭은 목표부에서 떨어져야 한다 (C5)', () => {
  const state = withContract(1, 'generator_shutdown');
  const landmark = state.graph.landmarks.find((l) => l.sectorId === state.contract.sectorId);
  const at = { ...state, playerNodeId: landmark.nodeId };

  assert.throws(() => destroyContractTarget(at, -2), /force/);
  assert.throws(() => detonateContractCharge(at), /no planted charge/, '설치 전에는 기폭할 수 없다');

  // 1단계: 설치. 여기서 봉쇄가 켜지고 유예 125칸이 시작되지만 계약은 아직 완료가 아니다.
  const planted = finishTask(destroyContractTarget(at, 1));
  assert.equal(planted.contract.status, 'acquired');
  assert.equal(planted.contract.completedAt, null);
  assert.ok(planted.lockdown);
  assert.equal(planted.lockdown.startedAt, planted.time, '봉쇄는 설치 완료 시각부터다');
  assert.equal(planted.exits.A.disabledAt, EXIT_A_DISABLED_AT, '봉쇄는 출구를 앞당겨 닫지 않는다');

  // 목표부에 서 있는 채로는 못 터뜨린다.
  assert.throws(() => detonateContractCharge(planted), /too close/);

  // 2단계: 2홉 이상 떨어진 자리에서 기폭 — 여기서 완료.
  const hops = bfsHopDistances(planted.graph.edges, landmark.nodeId);
  const farNodeId = planted.graph.nodes.map((n) => n.id).find((id) => (hops.get(id) ?? -1) >= CONTRACT_DETONATE_MIN_HOPS);
  const detonated = finishTask(detonateContractCharge({ ...planted, playerNodeId: farNodeId }));
  assert.equal(detonated.contract.status, 'completed');
  assert.equal(detonated.contract.completedAt, detonated.time);
  assert.equal(detonated.time - planted.time, CONTRACT_DETONATE_TIME);
  assert.equal(detonated.lockdown.startedAt, planted.lockdown.startedAt, '기폭이 봉쇄 시계를 다시 돌리지 않는다');
});

test('정보 송출은 목표부 구역과 비인접 구역에서는 할 수 없다 (C5)', () => {
  const state = withContract(1, 'record_review');
  const landmark = state.graph.landmarks.find((l) => l.sectorId === 'entrance');
  const acquired = finishTask(acquireContractIntel({ ...state, playerNodeId: landmark.nodeId }, 1));
  const adjacentIds = adjacentSectorIds(state.graph, 'entrance');

  assert.throws(
    () => finishTask(transmitContractIntel({ ...acquired, playerNodeId: landmark.nodeId }, 1)),
    /adjacent/,
    '확보한 그 자리에서 바로 송출하면 계약의 마지막 장이 사라진다',
  );
  const far = acquired.graph.landmarks.find((l) => l.sectorId !== 'entrance' && !adjacentIds.includes(l.sectorId));
  assert.throws(
    () => finishTask(transmitContractIntel({ ...acquired, playerNodeId: far.nodeId }, 1)),
    /adjacent/,
    '먼 구역까지 가야 하면 우회가 이웃 하나가 아니라 시설 횡단이 된다',
  );
  const neighbor = acquired.graph.landmarks.find((l) => adjacentIds.includes(l.sectorId));
  assert.equal(finishTask(transmitContractIntel({ ...acquired, playerNodeId: neighbor.nodeId }, 1)).contract.status, 'completed');
});

test('intel contracts need a two-step acquire-then-transmit at an adjacent-sector landmark, and only the acquire step activates lockdown', () => {
  const state = withContract(1, 'record_review');
  const landmark = state.graph.landmarks.find((l) => l.sectorId === 'entrance');
  const at = { ...state, playerNodeId: landmark.nodeId };

  assert.throws(() => transmitContractIntel(at, 1), /no acquired intel/, 'cannot transmit before acquiring');
  assert.throws(() => acquireContractIntel(at, -2), /hacking/);

  const acquired = finishTask(acquireContractIntel(at, 1));
  assert.equal(acquired.contract.status, 'acquired');
  assert.ok(acquired.lockdown);
  const lockedAt = acquired.lockdown.startedAt;

  const otherLandmark = acquired.graph.landmarks.find((l) => adjacentSectorIds(acquired.graph, 'entrance').includes(l.sectorId));
  assert.throws(
    () => finishTask(acquireContractIntel({ ...acquired, playerNodeId: otherLandmark.nodeId }, 1)),
    /no intel contract to acquire/,
    'already-acquired contract cannot be acquired again',
  );

  const transmitted = finishTask(transmitContractIntel({ ...acquired, playerNodeId: otherLandmark.nodeId }, 1));
  assert.equal(transmitted.contract.status, 'completed');
  assert.equal(transmitted.lockdown.startedAt, lockedAt, 'transmit must not re-trigger or move the lockdown clock');
});

// ADR-0083: 봉쇄는 어느 계약에서도 출구 폐쇄 시각을 앞당기지 않는다 — 하는 일은 위협 가속뿐이다.
// 표준 출구가 A 하나뿐이므로 그것까지 앞당겨 닫으면 봉쇄가 곧 실패 선고가 된다.
test('봉쇄는 출구 폐쇄를 앞당기지 않고 위협만 가속한다 — 세 계약 유형 모두', () => {
  const intelState = withContract(1, 'record_review');
  const intelLandmark = intelState.graph.landmarks.find((l) => l.sectorId === 'entrance');
  const acquired = finishTask(acquireContractIntel({ ...intelState, playerNodeId: intelLandmark.nodeId }, 1));
  assert.ok(acquired.lockdown, '봉쇄 자체는 켜진다');
  assert.equal(acquired.exits.A.disabledAt, EXIT_A_DISABLED_AT, 'A는 봉쇄가 건드리지 않는다');
  assert.equal(acquired.exits.B, undefined, '출구 B는 더 이상 없다');

  // 송출(완료)도 출구를 건드리지 않는다 — 봉쇄는 확보에서 한 번만 켜진다.
  const neighbor = acquired.graph.landmarks.find((l) => adjacentSectorIds(acquired.graph, 'entrance').includes(l.sectorId));
  const transmitted = finishTask(transmitContractIntel({ ...acquired, playerNodeId: neighbor.nodeId }, 1));
  assert.equal(transmitted.exits.A.disabledAt, EXIT_A_DISABLED_AT);

  // 봉쇄의 실제 효과 — 위협 이동이 봉쇄표로 빨라진다.
  // 같은 상태에서 lockdown만 떼어낸 대조군과 비교해 봉쇄표가 실제로 쓰였는지 본다.
  const baseThreats = createRunState(acquired.graph, 1).threats;
  const threatId = Object.keys(baseThreats)[0];
  const withThreats = { ...acquired, threats: baseThreats, time: 0 };
  const lockedMoved = advanceTime(withThreats, THREAT_MOVE_INTERVAL.patrol);
  const unlockedMoved = advanceTime({ ...withThreats, lockdown: null }, THREAT_MOVE_INTERVAL.patrol);
  assert.equal(unlockedMoved.threats[threatId].nextMoveAt, THREAT_MOVE_INTERVAL.patrol * 2);
  assert.equal(
    lockedMoved.threats[threatId].nextMoveAt,
    (1 + LOCKDOWN_THREAT_MOVE_INTERVAL.patrol) + LOCKDOWN_THREAT_MOVE_INTERVAL.patrol,
    '봉쇄에서는 위협 이동 간격이 봉쇄표를 쓴다',
  );

  // 회수·파괴도 마찬가지다.
  const retrieval = withContract(1, 'sample_retrieval');
  const labs = retrieval.graph.landmarks.find((l) => l.sectorId === retrieval.contract.sectorId);
  const goods = finishTask(acquireContractGoods({ ...retrieval, playerNodeId: labs.nodeId }, 1, 0));
  assert.equal(goods.exits.A.disabledAt, EXIT_A_DISABLED_AT);

  const destroy = withContract(1, 'generator_shutdown');
  const power = destroy.graph.landmarks.find((l) => l.sectorId === destroy.contract.sectorId);
  const planted = finishTask(destroyContractTarget({ ...destroy, playerNodeId: power.nodeId }, 1));
  assert.equal(planted.exits.A.disabledAt, EXIT_A_DISABLED_AT);
});

// D22: 신규 위협 스폰 시스템이 없어 "증원 가속"을 기존 위협 전원의 이동 간격 단축으로
// 구현했다(사용자 확정). resolveMoveInterval은 비공개라 advanceTime으로 실제 재스케줄
// 결과를 비교해 관찰 가능한 성질로 확인한다.
test('lockdown uses the fixed LOCKDOWN_THREAT_MOVE_INTERVAL table, not a multiplier', () => {
  const base = makeRun(1);
  const threatId = Object.keys(base.threats)[0];
  assert.equal(base.threats[threatId].nextMoveAt, THREAT_MOVE_INTERVAL.patrol);

  // 평상시: 예약대로 5칸에 움직이고 다음 예약은 +5칸.
  const normal = advanceTime(base, THREAT_MOVE_INTERVAL.patrol);
  assert.equal(normal.threats[threatId].nextMoveAt, THREAT_MOVE_INTERVAL.patrol * 2);

  // 봉쇄: 간격이 3칸 고정으로 줄어 min 규칙이 첫 예약을 1+3칸으로 당기고, 이동 뒤 다시 +3칸.
  const lockedInterval = LOCKDOWN_THREAT_MOVE_INTERVAL.patrol;
  const locked = advanceTime({ ...base, lockdown: { startedAt: 0 } }, THREAT_MOVE_INTERVAL.patrol);
  assert.equal(locked.threats[threatId].nextMoveAt, (1 + lockedInterval) + lockedInterval);
  assert.ok(lockedInterval < THREAT_MOVE_INTERVAL.patrol, 'locked-down threats should reschedule sooner');
});
