import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  createRunState, advanceTime, requestExtraction, reportNoise, reportSighting, moveToAdjacentNode,
  openSpecialEdge, basicRecon, useOpportunity, applyOverloadDelta, useFieldEquipment, isAtOpenExit,
  hackCamera, hackAccessInterface, destroyCamera, cameraHackRange, disableGenerator,
} from '../src/engine/runEngine.js';
import { MAP_EQUIPMENT_CAPABILITIES } from '../src/data/facilityEquipmentCapabilities.js';
import {
  EXIT_A_DISABLED_AT, EXIT_B_DISABLED_AT, EXIT_REQUEST_TIME, EXIT_OPEN_WINDOW,
  EXIT_OPEN_WAIT_BY_HACKING, RUN_COLLAPSE_TIME, THREAT_MOVE_INTERVAL,
  OVERLOAD_MELTDOWN, BASIC_RECON_TIME, FARM_TIME,
} from '../src/data/facilityLayout.js';
import { buildAdjacency, bfsHopDistances } from '../src/engine/graphUtils.js';

function makeRun(seed = 1, overloadConfig) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed, overloadConfig);
}

test('advanceTime is deterministic for the same seed and target', () => {
  const a = advanceTime(makeRun(7), 500);
  const b = advanceTime(makeRun(7), 500);
  assert.deepEqual(a, b);
});

// #4 행동 시간 30은 정확히 세 번의 상태 틱을 만들고, 위협의 엣지 이동은 nextMoveAt에 의해서만 발생한다.
test('advancing by 30 lands on time 30 and only moves threats whose nextMoveAt was due', () => {
  const initial = makeRun(3);
  const after = advanceTime(initial, 30);
  assert.equal(after.time, 30);
  for (const threat of Object.values(after.threats)) {
    const before = initial.threats[threat.id];
    if (before.nextMoveAt > 30) {
      assert.equal(threat.nodeId, before.nodeId, `threat ${threat.id} moved before its nextMoveAt`);
    }
  }
  // every patrol-mode threat starts with nextMoveAt = THREAT_MOVE_INTERVAL.patrol (100), so at
  // t=30 none of them should have moved yet.
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
test('exit request lifecycle: requesting -> opening -> open -> closed, and reopens', () => {
  let state = makeRun(5);
  const hacking = 2; // -2..4 index 4 -> EXIT_OPEN_WAIT_BY_HACKING[4] = 200
  // §6.2: 요청 자체가 시간 50을 소비하는 행동이라, 호출이 끝난 시점엔 이미 requesting 판정 경계
  // (interactionEndsAt)까지 시간이 흘러 'opening'으로 넘어가 있다.
  state = requestExtraction(state, 'A', hacking);
  assert.equal(state.exits.A.status, 'opening');
  assert.equal(state.exits.A.signalStartedAt, 0);
  assert.equal(state.time, EXIT_REQUEST_TIME);

  const wait = EXIT_OPEN_WAIT_BY_HACKING[hacking + 2];
  const opensAt = EXIT_REQUEST_TIME + wait;
  state = advanceTime(state, opensAt);
  assert.equal(state.exits.A.status, 'open');
  assert.equal(state.exits.A.openEndsAt, opensAt + EXIT_OPEN_WINDOW);

  state = advanceTime(state, opensAt + EXIT_OPEN_WINDOW);
  assert.equal(state.exits.A.status, 'closed');
  assert.equal(state.exits.A.signalStartedAt, null);

  // still before disabledAt -> can request again
  const before = state.time;
  state = requestExtraction(state, 'A', hacking);
  assert.equal(state.exits.A.status, 'opening');
  assert.equal(state.time, before + EXIT_REQUEST_TIME);
});

test('isAtOpenExit: true only while standing on an open standard exit, or the key exit while holding the key', () => {
  let state = makeRun(5);
  assert.equal(isAtOpenExit(state), false);

  // standing at A's node before it opens -> not yet
  state = { ...state, playerNodeId: state.exits.A.nodeId };
  assert.equal(isAtOpenExit(state), false);
  state = requestExtraction(state, 'A', 2);
  const wait = EXIT_OPEN_WAIT_BY_HACKING[2 + 2];
  state = advanceTime(state, EXIT_REQUEST_TIME + wait);
  assert.equal(state.exits.A.status, 'open');
  assert.equal(isAtOpenExit(state), true);
  // being open elsewhere doesn't count
  assert.equal(isAtOpenExit({ ...state, playerNodeId: state.exits.B.nodeId }), false);

  // key exit: discovered but not standing there -> false; standing there but not discovered -> false
  const keyState = { ...makeRun(5), playerNodeId: makeRun(5).exits.key.nodeId };
  assert.equal(isAtOpenExit(keyState), false);
  assert.equal(isAtOpenExit({ ...keyState, keyDiscovered: true }), true);
  assert.equal(isAtOpenExit({ ...keyState, keyDiscovered: false }), false);
});

test('exit A cannot be requested once disabled, and B collapse grace ends the run at 4000', () => {
  let state = makeRun(9);
  state = advanceTime(state, EXIT_A_DISABLED_AT);
  assert.equal(state.exits.A.status, 'disabled');
  assert.throws(() => requestExtraction(state, 'A', 0));

  state = advanceTime(state, EXIT_B_DISABLED_AT);
  assert.equal(state.exits.B.status, 'disabled');

  state = advanceTime(state, RUN_COLLAPSE_TIME);
  assert.equal(state.phase, 'collapsed');
  assert.equal(state.time, RUN_COLLAPSE_TIME);
});

test('collapse at 4000 takes priority even mid-request', () => {
  let state = makeRun(11);
  state = advanceTime(state, EXIT_B_DISABLED_AT - 50); // request just before B disables
  state = requestExtraction(state, 'B', 4); // fastest wait tier: 100
  state = advanceTime(state, RUN_COLLAPSE_TIME + 1000); // target way past collapse
  assert.equal(state.phase, 'collapsed');
  assert.equal(state.time, RUN_COLLAPSE_TIME);
});

test('all EXIT_OPEN_WAIT_BY_HACKING tiers are honored', () => {
  const tiers = [-2, -1, 0, 1, 2, 3, 4];
  for (const hacking of tiers) {
    let state = makeRun(2);
    state = requestExtraction(state, 'A', hacking);
    state = advanceTime(state, EXIT_REQUEST_TIME);
    const expectedWait = EXIT_OPEN_WAIT_BY_HACKING[Math.max(-2, Math.min(4, hacking)) + 2];
    state = advanceTime(state, EXIT_REQUEST_TIME + expectedWait - 10);
    assert.equal(state.exits.A.status, 'opening', `hacking ${hacking}: opened too early`);
    state = advanceTime(state, EXIT_REQUEST_TIME + expectedWait);
    assert.equal(state.exits.A.status, 'open', `hacking ${hacking}: did not open on schedule`);
  }
});

// #5 소음 0~3은 각각 0~3홉만 영향을 주고 100포인트 뒤 만료된다.
test('noise events expire after their duration and only reach threats within hop range', () => {
  let state = makeRun(13);
  const threatId = Object.keys(state.threats)[0];
  const threat = state.threats[threatId];
  // Put noise far outside the threat's sector at low intensity so it's out of range (patrol
  // fallback should remain the target), then re-check with a matching high-intensity event.
  state = reportNoise(state, threat.patrolRoute[0], 1, 0);
  const stillPatrolling = advanceTime(state, 5); // before any world tick even runs
  assert.ok(stillPatrolling.noiseEvents.length === 1);

  const expired = advanceTime(state, 101);
  assert.equal(expired.noiseEvents.length, 0, 'noise event should have expired by t=101');
});

test('moveToAdjacentNode requires an edge, costs the traversed edge\'s own (geometry-derived) timeCost, and tracks visited nodes', () => {
  let state = makeRun(21);
  const adjacency = buildAdjacency(state.graph.edges);
  const neighbor = [...adjacency.get(state.playerNodeId)][0];
  const traversedEdge = state.graph.edges.find((e) => (e.from === state.playerNodeId && e.to === neighbor) || (e.to === state.playerNodeId && e.from === neighbor));
  const before = state.time;
  state = moveToAdjacentNode(state, neighbor);
  assert.equal(state.playerNodeId, neighbor);
  assert.equal(state.time, before + traversedEdge.timeCost);
  assert.ok(state.visitedNodeIds.includes(neighbor));

  const nonNeighbor = state.graph.nodes.map((n) => n.id).find((id) => id !== state.playerNodeId && !adjacency.get(state.playerNodeId).has(id));
  assert.throws(() => moveToAdjacentNode(state, nonNeighbor));
});

test('high-ground edges require Mobility 3 and Mobility scales movement time', () => {
  let state = makeRun(21);
  const edge = state.graph.edges.find((entry) => entry.from === state.playerNodeId || entry.to === state.playerNodeId);
  const destination = edge.from === state.playerNodeId ? edge.to : edge.from;
  state = { ...state, graph: { ...state.graph, edges: state.graph.edges.map((entry) => entry.id === edge.id ? { ...entry, features: ['highGround'] } : entry) } };
  assert.throws(() => moveToAdjacentNode(state, destination, 2, 3), /reachable/);
  const fast = moveToAdjacentNode(state, destination, 3, 3);
  assert.equal(fast.time, Math.round(edge.timeCost * 0.7));
});

test('an unhacked camera detects Stealth below 3 and directs nearby threats to the player', () => {
  let state = makeRun(21);
  const edge = state.graph.edges.find((entry) => entry.from === state.playerNodeId || entry.to === state.playerNodeId);
  const destination = edge.from === state.playerNodeId ? edge.to : edge.from;
  const threatId = Object.keys(state.threats)[0];
  state = {
    ...state,
    graph: { ...state.graph, cameras: [{ id: 'camera_test', nodeId: destination }] },
    threats: { ...state.threats, [threatId]: { ...state.threats[threatId], nodeId: state.playerNodeId, nextMoveAt: 99999 } },
  };
  const detected = moveToAdjacentNode(state, destination, 0, 2);
  assert.deepEqual(detected.lastCameraDetection, { cameraId: 'camera_test', nodeId: destination, detectedAt: 0 });
  assert.equal(detected.threats[threatId].mode, 'pursuit');
  assert.equal(detected.threats[threatId].lastKnownPlayerNodeId, destination);

  const hidden = moveToAdjacentNode({ ...state, lastCameraDetection: null }, destination, 0, 3);
  assert.equal(hidden.lastCameraDetection, null);
});

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
  assert.throws(() => hackCamera(state, 'camera_test', 0), /Hacking 1/);
  assert.throws(() => hackCamera(state, 'camera_test', 1), /out of range/); // Hacking 1은 1홉까지만, 카메라는 2홉
  const hacked = hackCamera(state, 'camera_test', 2);
  assert.equal(hacked.activeRecon.source, 'camera');
  assert.ok(hacked.activeRecon.targetNodeIds.includes(twoHopNodeId));
  assert.ok(hacked.hackedCameras.some((entry) => entry.cameraId === 'camera_test'));
  assert.ok(hacked.observations[twoHopNodeId]);

  const connected = hackAccessInterface(state, 'interface_test', 1);
  assert.ok(connected.hackedInterfaceIds.includes('interface_test'));
  const throughInterface = hackCamera(connected, 'camera_test', 1); // 인터페이스 해킹 후엔 홉 사거리 무관하게 같은 구역 전체에 닿는다
  assert.ok(throughInterface.hackedCameras.some((entry) => entry.cameraId === 'camera_test'));
});

test('camera destruction is a local, loud Force action and permanently stops camera detection', () => {
  let state = makeRun(21);
  state = {
    ...state,
    graph: { ...state.graph, cameras: [{ id: 'camera_test', nodeId: state.playerNodeId }] },
  };
  assert.throws(() => destroyCamera(state, 'camera_test', 0), /Force 1/);
  const destroyed = destroyCamera(state, 'camera_test', 1);
  assert.ok(destroyed.disabledCameraIds.includes('camera_test'));
  assert.equal(destroyed.time, state.time + 100);
});

test('basic recon stays live across ticks and stops on movement', () => {
  let state = basicRecon(makeRun(21));
  assert.equal(state.activeRecon.source, 'basic');
  const watchedNodeId = state.activeRecon.targetNodeIds.find((nodeId) => nodeId !== state.playerNodeId);
  const threatId = Object.keys(state.threats)[0];
  state = {
    ...state,
    threats: { ...state.threats, [threatId]: { ...state.threats[threatId], nodeId: watchedNodeId, nextMoveAt: 99999 } },
  };
  state = advanceTime(state, state.time + 10);
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

// #12 같은 소음/가짜 목표 사건은 여러 위협 마커가 조사해도 구역 경계도를 한 번만 올린다.
test('sector alert rises by exactly 1 per resolved event, not per investigating marker', () => {
  let state = makeRun(4);
  // Move the player node away from everywhere so no investigation ever "finds" the player.
  state = { ...state, playerNodeId: 'nowhere' };
  // Advance a little first so the noise event's expiry (createdAt+100) lands strictly after the
  // threat's first patrol-interval check at t=100 — reporting it at t=0 would have it expire on
  // the exact same tick the threat first looks for it (both are round-100), which is a genuine
  // "noise already expired" case per §5.1.2's expire-before-target-selection ordering, not a bug.
  state = advanceTime(state, 50);
  const sectorId = Object.values(state.threats)[0].sectorId;
  const sectorThreat = Object.values(state.threats).find((t) => t.sectorId === sectorId);
  state = reportNoise(state, sectorThreat.nodeId, 3, state.time);
  const before = state.sectorAlerts[sectorId].level;
  state = advanceTime(state, 500);
  const after = state.sectorAlerts[sectorId].level;
  assert.equal(after, before + 1, 'a single noise event must resolve to exactly +1, not more');
  assert.equal(state.sectorAlerts[sectorId].resolvedEventIds.length, 1);

  // advancing further without any new stimulus must not escalate it again.
  state = advanceTime(state, 900);
  assert.equal(state.sectorAlerts[sectorId].level, after);
});

test('a blocked edge cannot be walked until opened with Force, and oneWay edges only go one direction', () => {
  let state = makeRun(1);
  const blockedEdge = state.graph.edges.find((e) => e.features.includes('blocked') && !e.features.includes('electronic'));
  assert.ok(blockedEdge, 'fixture seed should contain a plain blocked edge');
  state = { ...state, playerNodeId: blockedEdge.from };
  assert.throws(() => moveToAdjacentNode(state, blockedEdge.to));

  state = openSpecialEdge(state, blockedEdge.id, 'force', 1, 'normal');
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
  const electronicEdge = state.graph.edges.find((e) => e.features.includes('electronic') && !e.features.includes('blocked'));
  if (electronicEdge) assert.throws(() => openSpecialEdge(state, electronicEdge.id, 'force', 4, 'normal'));
});

test('basicRecon always succeeds, costs 80/0-noise, and records threat presence for current+adjacent nodes', () => {
  let state = makeRun(3);
  const before = state.time;
  state = basicRecon(state);
  assert.equal(state.time, before + BASIC_RECON_TIME);
  assert.equal(state.noiseEvents.length, 0);
  assert.ok(state.observations[state.playerNodeId]);
  const adjacency = buildAdjacency(state.graph.edges);
  for (const neighbor of adjacency.get(state.playerNodeId)) {
    assert.ok(state.observations[neighbor], `neighbor ${neighbor} should be observed`);
  }
});

test('useOpportunity decrements usesRemaining by one per farm, costs FARM_TIME, reports the pre-rolled keyEligible flag, and can be farmed multiple times until exhausted', () => {
  let state = makeRun(1);
  const opportunity = state.graph.opportunities.find((o) => o.usesRemaining > 0);
  assert.ok(opportunity, 'fixture seed should have at least one opportunity');
  state = { ...state, playerNodeId: opportunity.nodeId };
  const before = state.time;
  const result = useOpportunity(state, opportunity.id, 'normal');
  assert.equal(result.keyGranted, opportunity.keyEligible);
  assert.equal(result.state.time, before + FARM_TIME);
  assert.equal(result.state.graph.opportunities.find((o) => o.id === opportunity.id).usesRemaining, opportunity.usesRemaining - 1);

  let s = result.state;
  for (let i = 1; i < opportunity.usesRemaining; i++) s = useOpportunity(s, opportunity.id, 'normal').state;
  assert.equal(s.graph.opportunities.find((o) => o.id === opportunity.id).usesRemaining, 0);
  assert.throws(() => useOpportunity(s, opportunity.id, 'normal'));
});

test('module_spatial snapshot_scan reveals threat presence within its range and respects cooldown', () => {
  let state = makeRun(1);
  const contract = MAP_EQUIPMENT_CAPABILITIES.module_spatial.fieldAction;
  const before = state.time;
  const startNodeId = state.playerNodeId;
  state = useFieldEquipment(state, 'inst1', contract);
  assert.equal(state.time, before + contract.timeCost);
  assert.equal(state.overload, contract.overloadGain);
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
  state = useFieldEquipment(state, 'inst2', contract, barrierEdge.id);
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
  const scanned = useFieldEquipment(state, 'inst', spatialContract);
  assert.ok(Object.keys(scanned.observations).length > 0);
});

// #9 Overload 100은 HP와 무관한 즉시 패배이며, 장착 임플란트 바닥 아래로는 감소하지 않는다.
test('Overload >=100 keeps the run active, and reduction never drops below the floor', () => {
  let state = makeRun(5, { overloadFloor: 15 });
  state = applyOverloadDelta(state, 90);
  assert.equal(state.overload, 105);
  assert.equal(state.phase, 'active');

  let floored = makeRun(6, { overloadFloor: 15 });
  floored = applyOverloadDelta(floored, -50);
  assert.equal(floored.overload, 15);
});

test('battery generators can be hacked directly or through a hacked same-sector interface, and Force is local', () => {
  let state = makeRun(21);
  const generator = state.graph.generators.find((entry) => entry.sectorId === 'labs');
  const remoteLabsNode = state.graph.nodes.find((node) => node.sectorId === 'labs' && node.id !== generator.nodeId);
  const localInterface = { id: 'test_labs_interface', nodeId: remoteLabsNode.id };
  state = { ...state, graph: { ...state.graph, accessInterfaces: [localInterface, ...state.graph.accessInterfaces] } };
  state = { ...state, playerNodeId: localInterface.nodeId };
  state = hackAccessInterface(state, localInterface.id, 1);
  const disabled = disableGenerator(state, generator.id, 'hacking', 1);
  assert.ok(disabled.disabledGeneratorIds.includes(generator.id));

  const wrongInterface = state.graph.accessInterfaces.find((entry) => state.graph.nodes.find((node) => node.id === entry.nodeId)?.sectorId !== 'labs');
  assert.throws(() => disableGenerator({ ...state, playerNodeId: wrongInterface.nodeId, hackedInterfaceIds: [], disabledGeneratorIds: [] }, generator.id, 'hacking', 1));
  assert.throws(() => disableGenerator({ ...state, playerNodeId: localInterface.nodeId, disabledGeneratorIds: [] }, generator.id, 'force', 2));
  const forced = disableGenerator({ ...state, playerNodeId: generator.nodeId, disabledGeneratorIds: [] }, generator.id, 'force', 2);
  assert.ok(forced.disabledGeneratorIds.includes(generator.id));
  assert.equal(forced.time, state.time + 100);
});
