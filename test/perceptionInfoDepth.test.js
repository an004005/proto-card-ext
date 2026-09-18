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
import {
  PERCEPTION_INFO_TABLE, FREE_OBSERVATION_DETAIL_LEVEL, FREE_FAR_OBSERVATION_DETAIL_LEVEL,
  CURRENT_NODE_DETAIL_LEVEL, BASIC_RECON_TIME,
} from '../src/data/facilityLayout.js';
import { bfsHopDistances } from '../src/engine/graphUtils.js';
import { finishTask } from './helpers/finishTask.js';

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed);
}

/** 정찰을 실제로 완료시킨 상태. */
function scout(run, perception) {
  return advanceTime(finishTask(basicRecon({ ...run, threats: {} }, perception)), run.time + BASIC_RECON_TIME);
}

test('정찰 사거리는 Perception이 정한다 — 2 이하 1홉, 3 이상 2홉', () => {
  // Perception 2까지는 무료 인접 관측과 같은 1홉이다 — 그 구간에서 정찰이 사는 것은 깊이뿐이고,
  // 사거리는 Perception 3부터 늘어난다.
  assert.equal(perceptionInfo(-2).reconHops, 1);
  assert.equal(perceptionInfo(-1).reconHops, 1);
  assert.equal(perceptionInfo(0).reconHops, 1);
  assert.equal(perceptionInfo(2).reconHops, 1);
  assert.equal(perceptionInfo(3).reconHops, 2);
  assert.equal(perceptionInfo(4).reconHops, 2);
  // 표 밖의 값은 양끝으로 자른다.
  assert.equal(perceptionInfo(9).reconHops, 2);
  assert.equal(perceptionInfo(-9).reconHops, 1);
});

test('정찰 비용은 Perception과 무관하게 4칸 고정이다', () => {
  const run = { ...makeRun(1), threats: {} };
  for (const perception of [-2, 0, 2, 4]) {
    const scouted = finishTask(basicRecon(run, perception));
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
    for (const field of ['presence', 'count', 'size', 'mode', 'alert', 'nextMove', 'composition', 'patrolNext', 'prizeGrade', 'prizeAxis', 'concealment', 'evidence']) {
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

  const shallow = at(FREE_FAR_OBSERVATION_DETAIL_LEVEL);
  assert.equal(FREE_FAR_OBSERVATION_DETAIL_LEVEL, 0);
  assert.equal(shallow.size, null, '두 번째 홉은 유무만이다');
  assert.equal(shallow.mode, null);

  // 공짜 인접 시야(1홉)는 모드까지 읽는다 — 규모만은 값을 치러야 산다(ADR-0090).
  const free = at(FREE_OBSERVATION_DETAIL_LEVEL);
  assert.equal(FREE_OBSERVATION_DETAIL_LEVEL, 1);
  assert.equal(free.mode, threat.mode, '무료 인접 관측은 모드까지다');
  assert.equal(free.size, null, '규모는 무료 시야가 주지 않는다');
  // 규모는 서 있는 자리나 Perception 0 이상의 정찰부터 읽힌다.
  assert.equal(at(CURRENT_NODE_DETAIL_LEVEL).size, threat.size, '규모는 서 있는 자리의 깊이부터');

  assert.equal(at(3).alert, null);
  assert.equal(at(4).alert, threat.alert);
  assert.equal(at(4).composition, null);
  assert.ok(at(5).composition.length > 0, '구성은 Perception 3부터');
  assert.equal(at(5).patrolNext, null);
  assert.equal(at(6).patrolNext, threat.patrolRoute[(threat.patrolIndex + 1) % threat.patrolRoute.length]);
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

  const deep = { ...base, observations: { [seenNodeId]: { observedAt: run.time, hasThreat: true, detailLevel: 4 } } };
  assert.deepEqual(observableThreatMoves(deep).map((t) => t.ticksUntilMove), [4]);

  const shallow = { ...base, observations: { [seenNodeId]: { observedAt: run.time, hasThreat: true, detailLevel: 2 } } };
  assert.deepEqual(observableThreatMoves(shallow).map((t) => t.ticksUntilMove), [null]);
  assert.deepEqual(observableThreatMoves(shallow).map((t) => t.interval), [null]);
});

test('무료 시야는 서 있는 자리와 옆방을 가른다 — 옆방은 내용물의 존재까지, Perception을 타지 않는다', () => {
  const run = makeRun(1);
  const adjacentIds = run.graph.edges
    .filter((e) => e.from === run.playerNodeId || e.to === run.playerNodeId)
    .map((e) => (e.from === run.playerNodeId ? e.to : e.from));
  assert.ok(adjacentIds.length > 0);

  for (const perception of [-2, 0, 4]) {
    const refreshed = refreshLocalObservations(run, perception);

    // 서 있는 자리 — 방 안에 있으므로 내용물을 남은 횟수까지 얻고 깊이도 규모까지다.
    const here = refreshed.observations[run.playerNodeId];
    assert.equal(here.detailLevel, CURRENT_NODE_DETAIL_LEVEL, '서 있는 자리는 규모까지 읽는다');
    assert.ok(here.contents, '서 있는 자리의 내용물은 보인다');
    for (const opportunity of here.contents.opportunities) {
      assert.equal(typeof opportunity.usesRemaining, 'number', '서 있는 자리는 남은 횟수까지 안다');
    }

    // 옆방 — 무엇이 있는지까지다. 남은 횟수와 출구 상태는 값을 치러야 산다.
    for (const nodeId of adjacentIds) {
      const there = refreshed.observations[nodeId];
      assert.equal(there.detailLevel, FREE_OBSERVATION_DETAIL_LEVEL, '옆방의 깊이는 Perception을 타지 않는다');
      assert.ok(there.contents, '공짜 시야도 무엇이 있는지는 읽는다');
      for (const opportunity of there.contents.opportunities) {
        assert.equal(opportunity.usesRemaining, undefined, '남은 횟수는 무료 시야가 주지 않는다');
        assert.ok(opportunity.grade === 'supply' || opportunity.grade === 'prize');
      }
      assert.equal(there.exitStatus, undefined, '출구 상태도 공짜로는 읽히지 않는다');
      assert.equal(typeof there.hasThreat, 'boolean', '위협 유무는 보인다');
      assert.equal(typeof there.threatCount, 'number', '그룹 수도 보인다');
    }
  }
});

test('Perception 2 이상이면 무료 시야가 한 홉 더 뻗고, 그 두 번째 홉은 위협 유무까지다', () => {
  const run = makeRun(1);
  const hops = bfsHopDistances(run.graph.edges, run.playerNodeId);
  const twoHopIds = [...hops.entries()].filter(([, hop]) => hop === 2).map(([id]) => id);
  assert.ok(twoHopIds.length > 0, '시드에 2홉 노드가 있어야 한다');

  const narrow = refreshLocalObservations(run, 1);
  for (const nodeId of twoHopIds) {
    assert.equal(narrow.observations[nodeId], undefined, 'Perception 1은 두 번째 홉을 보지 못한다');
  }

  const wide = refreshLocalObservations(run, 2);
  for (const nodeId of twoHopIds) {
    const there = wide.observations[nodeId];
    assert.ok(there, 'Perception 2는 두 번째 홉을 본다');
    assert.equal(there.detailLevel, FREE_FAR_OBSERVATION_DETAIL_LEVEL, '두 번째 홉은 유무까지다');
    assert.equal(there.contents, undefined, '두 번째 홉은 방 안을 읽지 않는다');
    assert.equal(there.threatCount, undefined, '두 번째 홉은 그룹 수도 모른다');
    assert.equal(typeof there.hasThreat, 'boolean');
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

test('정찰은 Perception과 무관하게 노드의 내용물을 기록한다 — 보급품·확보 대상·장치', () => {
  // Perception 3의 2홉 사거리로 본다 — 1홉 안은 무료 인접 관측이 이미 닿아 "정찰이 새로 적었다"를
  // 보여주지 못한다.
  const perception = 3;
  const reconHops = perceptionInfo(perception).reconHops;
  // 시작점 2홉 안에 세 가지가 다 있는 시드를 찾아 쓴다 — 어느 시드가 그런지는 생성 난수에
  // 달려 있어서 고정 시드로 박아 두면 무관한 변경마다 이 검사가 깨진다.
  const found = (() => {
    for (let seed = 1; seed <= 40; seed++) {
      const run = makeRun(seed);
      const hops = bfsHopDistances(run.graph.edges, run.playerNodeId);
      const inRange = (nodeId) => (hops.get(nodeId) ?? Infinity) <= reconHops;
      const supply = run.graph.opportunities.find((o) => o.grade !== 'prize' && o.usesRemaining > 0 && inRange(o.nodeId));
      const prize = run.graph.opportunities.find((o) => o.grade === 'prize' && o.usesRemaining > 0 && inRange(o.nodeId));
      const camera = run.graph.cameras.find((c) => inRange(c.nodeId));
      if (supply && prize && camera) return { run, hops, supply, prize, camera };
    }
    return null;
  })();
  assert.ok(found, `${reconHops}홉 안에 보급품·확보 대상·카메라가 다 있는 시드를 찾지 못했다`);
  const { run, hops, supply, prize, camera } = found;

  // 정찰 전에는 아무것도 없다 — 인접 무료 관측이 닿는 자리는 빼고 본다.
  const far = [supply, prize, camera].filter((entry) => (hops.get(entry.nodeId) ?? 0) === reconHops);
  for (const entry of far) {
    assert.equal(run.observations[entry.nodeId]?.contents, undefined, '정찰 전에 내용물이 이미 적혀 있다');
  }

  const scouted = scout(run, perception);
  assert.ok(
    scouted.observations[supply.nodeId].contents.opportunities.some((o) => o.id === supply.id && o.usesRemaining === supply.usesRemaining),
    '보급품이 남은 횟수까지 기록돼야 한다',
  );
  assert.ok(
    scouted.observations[prize.nodeId].contents.opportunities.some((o) => o.id === prize.id && o.grade === 'prize'),
    '확보 대상의 존재가 기록돼야 한다',
  );
  const recorded = scouted.observations[camera.nodeId].contents.devices.find((d) => d.id === camera.id);
  assert.deepEqual(recorded, { kind: 'camera', id: camera.id, status: 'active' }, '카메라는 Perception 3 없이도 기록된다');
});

test('무료 인접 관측도 내용물을 적는다 — 현재 노드와 인접 1홉', () => {
  const run = makeRun(1);
  const refreshed = refreshLocalObservations(run, 0);
  const contents = refreshed.observations[run.playerNodeId].contents;
  assert.ok(contents, '서 있는 자리의 내용물이 없다');
  const expectedIds = run.graph.opportunities.filter((o) => o.nodeId === run.playerNodeId && o.usesRemaining > 0).map((o) => o.id);
  assert.deepEqual(contents.opportunities.map((o) => o.id), expectedIds);

  // 인접 1홉도 장치의 존재를 적는다 — 카메라·인터페이스·발전기가 있다는 것까지.
  const adjacentWithDevice = run.graph.edges
    .filter((e) => e.from === run.playerNodeId || e.to === run.playerNodeId)
    .map((e) => (e.from === run.playerNodeId ? e.to : e.from))
    .find((id) => run.graph.cameras.some((c) => c.nodeId === id) || run.graph.accessInterfaces.some((i) => i.nodeId === id));
  if (adjacentWithDevice) {
    assert.ok(refreshed.observations[adjacentWithDevice].contents.devices.length > 0, '옆방의 장치 존재가 적히지 않았다');
  }
});

test('얕은 무료 관측이 지나가도 정찰이 적어둔 남은 횟수는 지워지지 않는다', () => {
  const run = makeRun(1);
  const adjacentId = run.graph.edges
    .filter((e) => e.from === run.playerNodeId || e.to === run.playerNodeId)
    .map((e) => (e.from === run.playerNodeId ? e.to : e.from))
    .find((id) => run.graph.opportunities.some((o) => o.nodeId === id && o.usesRemaining > 0));
  assert.ok(adjacentId, '시드의 인접 노드에 현장 기회가 하나는 있어야 한다');

  const scouted = scout({ ...run, playerNodeId: adjacentId }, 2);
  const known = scouted.observations[adjacentId].contents.opportunities[0];
  assert.equal(typeof known.usesRemaining, 'number');

  // 원래 자리로 돌려놓고 공짜 시야만 한 번 갱신한다.
  const refreshed = refreshLocalObservations({ ...scouted, playerNodeId: run.playerNodeId }, 0);
  const after = refreshed.observations[adjacentId].contents.opportunities.find((o) => o.id === known.id);
  assert.equal(after.usesRemaining, known.usesRemaining, '무료 관측이 정찰의 남은 횟수를 지웠다');
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
