// Perception이 정하는 정보의 깊이(PERCEPTION_INFO_TABLE). 정찰 비용 4칸과 표준 2홉은 그대로고,
// Perception이 사는 것은 사거리와 **무엇이 보이는가**다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  createRunState, basicRecon, advanceTime, refreshLocalObservations, observationSuspended,
  perceptionInfo, detailIncludes, waitOneTick,
} from '../src/engine/runEngine.js';
import { describeObservedThreat, observableThreatMoves } from '../src/engine/mapTimeline.js';
import { PERCEPTION_INFO_TABLE, FREE_OBSERVATION_DETAIL_LEVEL, BASIC_RECON_TIME } from '../src/data/facilityLayout.js';
import { bfsHopDistances } from '../src/engine/graphUtils.js';

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed);
}

/** 정찰을 실제로 완료시킨 상태. */
function scout(run, perception) {
  return advanceTime(basicRecon({ ...run, threats: {} }, perception), run.time + BASIC_RECON_TIME);
}

test('정찰 사거리는 Perception이 정한다 — −1 이하 1홉, 0~2는 2홉, 3 이상은 3홉', () => {
  assert.equal(perceptionInfo(-2).reconHops, 1);
  assert.equal(perceptionInfo(-1).reconHops, 1);
  assert.equal(perceptionInfo(0).reconHops, 2);
  assert.equal(perceptionInfo(2).reconHops, 2);
  assert.equal(perceptionInfo(3).reconHops, 3);
  assert.equal(perceptionInfo(4).reconHops, 3);
  // 표 밖의 값은 양끝으로 자른다.
  assert.equal(perceptionInfo(9).reconHops, 3);
  assert.equal(perceptionInfo(-9).reconHops, 1);
});

test('정찰 비용은 Perception과 무관하게 4칸 고정이다', () => {
  const run = { ...makeRun(1), threats: {} };
  for (const perception of [-2, 0, 2, 4]) {
    const scouted = basicRecon(run, perception);
    assert.equal(scouted.time - run.time, BASIC_RECON_TIME);
  }
});

test('사거리는 실제 관측 노드 집합에 그대로 나타난다', () => {
  const run = makeRun(1);
  const hops = bfsHopDistances(run.graph.edges, run.playerNodeId);
  for (const perception of [-1, 0, 3]) {
    const scouted = scout(run, perception);
    const watched = new Set(scouted.activeRecon.targetNodeIds);
    const expected = perceptionInfo(perception).reconHops;
    for (const [nodeId, hop] of hops) {
      assert.equal(watched.has(nodeId), hop <= expected, `${nodeId}(${hop}홉)이 Perception ${perception}의 ${expected}홉 사거리와 어긋난다`);
    }
  }
});

test('정보 깊이는 관측 기록에 detailLevel로 남고, 깊이별로 읽히는 항목이 표와 같다', () => {
  const run = makeRun(1);
  for (const perception of [-1, 0, 1, 2, 3, 4]) {
    const info = perceptionInfo(perception);
    const scouted = scout(run, perception);
    const record = scouted.observations[scouted.playerNodeId];
    assert.equal(record.detailLevel, info.level, `Perception ${perception}의 깊이가 표와 다르다`);
    for (const field of ['presence', 'size', 'mode', 'alert', 'nextMove', 'composition', 'patrolNext', 'prizeGrade', 'prizeAxis', 'concealment', 'cameras', 'evidence']) {
      const expected = info.threat.includes(field) || info.extra.includes(field);
      assert.equal(detailIncludes(info.level, field), expected, `${field}@Perception ${perception}`);
    }
  }
});

test('은엄폐 값은 Perception 2부터, 확보 대상 역할축은 1부터 기록된다', () => {
  const run = makeRun(1);
  const concealedNodeId = Object.keys(run.graph.concealmentByNodeId)[0];
  const at = { ...run, playerNodeId: concealedNodeId };
  assert.equal(scout(at, 1).observations[concealedNodeId].concealment, undefined);
  assert.equal(scout(at, 2).observations[concealedNodeId].concealment, run.graph.concealmentByNodeId[concealedNodeId]);

  const prize = run.graph.opportunities.find((o) => o.grade === 'prize' && o.usesRemaining > 0);
  const atPrize = { ...run, playerNodeId: prize.nodeId };
  assert.equal(scout(atPrize, 0).observations[prize.nodeId].opportunityGrades[prize.id].axis, null);
  assert.equal(scout(atPrize, 1).observations[prize.nodeId].opportunityGrades[prize.id].axis, prize.axis);
});

test('위협 정보는 관측 깊이만큼만 읽힌다 — 없는 항목은 null이다', () => {
  const run = makeRun(1);
  const threat = Object.values(run.threats)[0];

  /** @param {number} level */
  const at = (level) => describeObservedThreat(
    { ...run, observations: { [threat.nodeId]: { observedAt: run.time, hasThreat: true, detailLevel: level } } },
    threat,
  );

  const shallow = at(0);
  assert.equal(shallow.size, null, '깊이 0은 유무만이다');
  assert.equal(shallow.mode, null);

  const free = at(FREE_OBSERVATION_DETAIL_LEVEL);
  assert.equal(free.size, threat.size, '무료 인접 관측은 규모까지');
  assert.equal(free.mode, null, '모드는 Perception 1부터');

  assert.equal(at(2).mode, threat.mode);
  assert.equal(at(2).alert, null);
  assert.equal(at(3).alert, threat.alert);
  assert.equal(at(3).composition, null);
  assert.ok(at(4).composition.length > 0, '구성은 Perception 3부터');
  assert.equal(at(4).patrolNext, null);
  assert.equal(at(5).patrolNext, threat.patrolRoute[(threat.patrolIndex + 1) % threat.patrolRoute.length]);
});

test('다음 이동까지 남은 칸은 Perception 2의 깊이로 본 위협에만 붙는다', () => {
  const run = makeRun(1);
  const threat = Object.values(run.threats)[0];
  const edge = run.graph.edges.find((e) => e.from === run.playerNodeId || e.to === run.playerNodeId);
  const seenNodeId = edge.from === run.playerNodeId ? edge.to : edge.from;
  const base = {
    ...run,
    threats: { [threat.id]: { ...threat, nodeId: seenNodeId, nextMoveAt: run.time + 4 } },
  };

  const deep = { ...base, observations: { [seenNodeId]: { observedAt: run.time, hasThreat: true, detailLevel: 3 } } };
  assert.deepEqual(observableThreatMoves(deep).map((t) => t.ticksUntilMove), [4]);

  const shallow = { ...base, observations: { [seenNodeId]: { observedAt: run.time, hasThreat: true, detailLevel: 1 } } };
  assert.deepEqual(observableThreatMoves(shallow).map((t) => t.ticksUntilMove), [null]);
  assert.deepEqual(observableThreatMoves(shallow).map((t) => t.interval), [null]);
});

test('무료 인접 관측의 깊이는 Perception과 무관하게 고정이다', () => {
  const run = makeRun(1);
  for (const perception of [-2, 0, 4]) {
    const refreshed = refreshLocalObservations(run, perception);
    assert.equal(refreshed.observations[run.playerNodeId].detailLevel, FREE_OBSERVATION_DETAIL_LEVEL);
  }
});

test('깊은 정찰 기록은 얕은 무료 관측이 지나가도 깊이를 잃지 않는다', () => {
  const run = makeRun(1);
  const scouted = scout(run, 4);
  const nodeId = scouted.playerNodeId;
  assert.equal(scouted.observations[nodeId].detailLevel, perceptionInfo(4).level);
  const refreshed = refreshLocalObservations(scouted, 0);
  assert.equal(refreshed.observations[nodeId].detailLevel, perceptionInfo(4).level, '무료 관측이 깊이를 덮어썼다');
});

test('Perception 2 이상이면 대기 중에도 인접 1홉 실시간 관측이 유지된다', () => {
  const run = makeRun(1);
  const waited = waitOneTick({ ...run, threats: {} });
  assert.ok(waited.lastWaitEndedAt != null, '대기 직후 상태여야 한다');

  assert.equal(observationSuspended(waited, 1), true);
  assert.equal(observationSuspended(waited, 2), false);

  const adjacent = run.graph.edges
    .filter((e) => e.from === run.playerNodeId || e.to === run.playerNodeId)
    .map((e) => (e.from === run.playerNodeId ? e.to : e.from));
  assert.ok(adjacent.length > 0);

  const blind = refreshLocalObservations(waited, 1);
  assert.ok(adjacent.every((id) => (blind.observations[id]?.observedAt ?? -1) < blind.time), 'Perception 1은 대기 중 인접을 보지 않는다');

  const watchful = refreshLocalObservations(waited, 2);
  assert.ok(adjacent.some((id) => watchful.observations[id]?.observedAt === watchful.time), 'Perception 2는 대기 중에도 인접을 본다');
});

test('정보 깊이 표의 레벨은 오름차순이고 항목은 누적이다', () => {
  for (let i = 1; i < PERCEPTION_INFO_TABLE.length; i++) {
    const prev = PERCEPTION_INFO_TABLE[i - 1];
    const cur = PERCEPTION_INFO_TABLE[i];
    assert.ok(cur.level >= prev.level);
    assert.ok(cur.reconHops >= prev.reconHops);
    for (const field of prev.threat) assert.ok(cur.threat.includes(field), `${field}가 상위 레벨에서 사라졌다`);
    for (const field of prev.extra) assert.ok(cur.extra.includes(field), `${field}가 상위 레벨에서 사라졌다`);
  }
});
