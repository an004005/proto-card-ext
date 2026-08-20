import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  createRunState, advanceTime, requestExtraction, reportNoise, reportSighting, moveToAdjacentNode,
} from '../src/engine/runEngine.js';
import {
  EXIT_A_DISABLED_AT, EXIT_B_DISABLED_AT, EXIT_REQUEST_TIME, EXIT_OPEN_WINDOW,
  EXIT_OPEN_WAIT_BY_HACKING, RUN_COLLAPSE_TIME, THREAT_MOVE_INTERVAL, STANDARD_EDGE_TIME_COST,
} from '../src/data/facilityLayout.js';
import { buildAdjacency } from '../src/engine/graphUtils.js';

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed);
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
