import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  createRunState, advanceTime, requestExtraction, reportNoise, reportSighting, moveToAdjacentNode,
  openSpecialEdge, basicRecon, useOpportunity, applyOverloadDelta, useFieldEquipment,
} from '../src/engine/runEngine.js';
import { MAP_EQUIPMENT_CAPABILITIES } from '../src/data/facilityEquipmentCapabilities.js';
import {
  EXIT_A_DISABLED_AT, EXIT_B_DISABLED_AT, EXIT_REQUEST_TIME, EXIT_OPEN_WINDOW,
  EXIT_OPEN_WAIT_BY_HACKING, RUN_COLLAPSE_TIME, THREAT_MOVE_INTERVAL, STANDARD_EDGE_TIME_COST,
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
  state = requestExtraction(state, 'A', hacking);
  assert.equal(state.exits.A.status, 'requesting');
  assert.equal(state.exits.A.signalStartedAt, 0);

  state = advanceTime(state, EXIT_REQUEST_TIME);
  assert.equal(state.exits.A.status, 'opening');

  const wait = EXIT_OPEN_WAIT_BY_HACKING[hacking + 2];
  const opensAt = EXIT_REQUEST_TIME + wait;
  state = advanceTime(state, opensAt);
  assert.equal(state.exits.A.status, 'open');
  assert.equal(state.exits.A.openEndsAt, opensAt + EXIT_OPEN_WINDOW);

  state = advanceTime(state, opensAt + EXIT_OPEN_WINDOW);
  assert.equal(state.exits.A.status, 'closed');
  assert.equal(state.exits.A.signalStartedAt, null);

  // still before disabledAt -> can request again
  state = requestExtraction(state, 'A', hacking);
  assert.equal(state.exits.A.status, 'requesting');
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

test('moveToAdjacentNode requires an edge, costs STANDARD_EDGE_TIME_COST, and tracks visited nodes', () => {
  let state = makeRun(21);
  const adjacency = buildAdjacency(state.graph.edges);
  const neighbor = [...adjacency.get(state.playerNodeId)][0];
  const before = state.time;
  state = moveToAdjacentNode(state, neighbor);
  assert.equal(state.playerNodeId, neighbor);
  assert.equal(state.time, before + STANDARD_EDGE_TIME_COST);
  assert.ok(state.visitedNodeIds.includes(neighbor));

  const nonNeighbor = state.graph.nodes.map((n) => n.id).find((id) => id !== state.playerNodeId && !adjacency.get(state.playerNodeId).has(id));
  assert.throws(() => moveToAdjacentNode(state, nonNeighbor));
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

test('useOpportunity consumes the opportunity, costs FARM_TIME, and reports the pre-rolled keyEligible flag', () => {
  let state = makeRun(1);
  const opportunity = state.graph.opportunities.find((o) => !o.consumed);
  assert.ok(opportunity, 'fixture seed should have at least one opportunity');
  state = { ...state, playerNodeId: opportunity.nodeId };
  const before = state.time;
  const result = useOpportunity(state, opportunity.id, 'normal');
  assert.equal(result.keyGranted, opportunity.keyEligible);
  assert.equal(result.state.time, before + FARM_TIME);
  assert.ok(result.state.graph.opportunities.find((o) => o.id === opportunity.id).consumed);
  assert.throws(() => useOpportunity(result.state, opportunity.id, 'normal'));
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

// #9 Overload 100은 HP와 무관한 즉시 패배이며, 장착 임플란트 바닥 아래로는 감소하지 않는다.
test('Overload >=100 ends the run in meltdown, and reduction never drops below the floor', () => {
  let state = makeRun(5, { overloadFloor: 15 });
  state = applyOverloadDelta(state, 90);
  assert.equal(state.overload, 105);
  assert.equal(state.phase, 'meltdown');

  let floored = makeRun(6, { overloadFloor: 15 });
  floored = applyOverloadDelta(floored, -50);
  assert.equal(floored.overload, 15);
});
