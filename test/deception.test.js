// 기만(Deception) — 유인(가짜 소음)과 오도(조우 속이기, 임의 구역 송출).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState, deceiveThreat } from '../src/engine/runEngine.js';
import { plantFakeNoise, fakeNoiseRange } from '../src/engine/recovery.js';
import { forecastAction } from '../src/engine/actionCosts.js';
import {
  FAKE_NOISE_TIME, FAKE_NOISE_RANGE_BY_DECEPTION, NOISE_DURATION,
  ENCOUNTER_DECEIVE_REQUIREMENT,
} from '../src/data/facilityLayout.js';
import { bfsHopDistances } from '../src/engine/graphUtils.js';

/** 위협이 도중에 끼어들지 않는 조용한 런. */
function quietRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return { ...createRunState(graph, seed), threats: {} };
}

function nodeAtHops(run, hops) {
  const distances = bfsHopDistances(run.graph.edges, run.playerNodeId);
  for (const [nodeId, h] of distances) if (h === hops) return nodeId;
  throw new Error(`no node at ${hops} hops`);
}

// ---- 가짜 소음 ----

test('가짜 소음의 사거리는 Deception이 정한다 — 1 미만은 아예 쓸 수 없다', () => {
  assert.equal(fakeNoiseRange(-2), 0);
  assert.equal(fakeNoiseRange(0), 0);
  assert.equal(fakeNoiseRange(1), 1);
  assert.equal(fakeNoiseRange(2), 2);
  assert.equal(fakeNoiseRange(3), 3);
  assert.equal(fakeNoiseRange(4), 3);
  assert.deepEqual(FAKE_NOISE_RANGE_BY_DECEPTION, [0, 0, 0, 1, 2, 3, 3]);
});

test('가짜 소음은 3칸이고, 예고와 청구가 같은 사양표에서 나온다', () => {
  const run = quietRun(1);
  const forecast = forecastAction('fakeNoise', { value: 1 });
  assert.equal(forecast.timeCost, FAKE_NOISE_TIME);

  const planted = plantFakeNoise(run, 1, nodeAtHops(run, 1));
  assert.equal(planted.time - run.time, forecast.timeCost, '예고한 칸이 그대로 청구된다');
});

test('가짜 소음은 사거리 안의 노드에만 심을 수 있다', () => {
  const run = quietRun(1);
  assert.throws(() => plantFakeNoise(run, 0, nodeAtHops(run, 1)), /deception too low/);
  assert.throws(() => plantFakeNoise(run, 1, nodeAtHops(run, 2)), /out of fake-noise range/);
  assert.ok(plantFakeNoise(run, 2, nodeAtHops(run, 2)));
  assert.ok(plantFakeNoise(run, 3, nodeAtHops(run, 3)));
});

test('심은 소음은 대상 노드에 강도 1로 나고, Deception 3 이상이면 강도 2다', () => {
  const run = quietRun(1);
  const target = nodeAtHops(run, 1);

  const weak = plantFakeNoise(run, 1, target);
  const weakEvent = weak.noiseEvents.find((e) => e.sourceNodeId === target);
  assert.ok(weakEvent, '대상 노드에 소음이 심어져야 한다');
  assert.equal(weakEvent.intensity, 1);
  // 소음은 완료 시각에 난다 — 다른 현장 작업과 같은 규칙이다.
  assert.equal(weakEvent.createdAt, weak.time);
  assert.equal(weakEvent.expiresAt, weak.time + NOISE_DURATION);

  const strong = plantFakeNoise(run, 3, target);
  assert.equal(strong.noiseEvents.find((e) => e.sourceNodeId === target).intensity, 2);
});

test('가짜 소음은 구역 경계도를 건드리지 않는다 — 수습 수단이 아니라 유인 수단이다', () => {
  const run = quietRun(1);
  const after = plantFakeNoise(run, 2, nodeAtHops(run, 2));
  assert.deepEqual(after.sectorAlerts, run.sectorAlerts);
});

// ---- 조우 속이기 ----

function runWithThreatHere(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  const base = createRunState(graph, seed);
  const threat = Object.values(base.threats)[0];
  return {
    run: { ...base, threats: { [threat.id]: { ...threat, nodeId: base.playerNodeId, mode: 'pursuit', alert: 2 } } },
    threatId: threat.id,
  };
}

test('조우 속이기는 Deception 2 이상이어야 하고 위협당 한 번뿐이다', () => {
  const { run, threatId } = runWithThreatHere();
  assert.throws(() => deceiveThreat(run, threatId, ENCOUNTER_DECEIVE_REQUIREMENT - 1), /deception too low/);

  const once = deceiveThreat(run, threatId, 2).state;
  assert.deepEqual(once.deceivedThreatIds, [threatId]);
  assert.throws(() => deceiveThreat(once, threatId, 4), /already been deceived/);
});

test('성공 판정은 결정적이다 — Deception이 그 위협의 경계 이상이면 성공', () => {
  const { run, threatId } = runWithThreatHere();
  assert.equal(run.threats[threatId].alert, 2);
  assert.equal(deceiveThreat(run, threatId, 2).success, true);

  const highAlert = { ...run, threats: { [threatId]: { ...run.threats[threatId], alert: 3 } } };
  const failed = deceiveThreat(highAlert, threatId, 2);
  assert.equal(failed.success, false);
  assert.equal(failed.state.threats[threatId].lastKnownPlayerNodeId, highAlert.threats[threatId].lastKnownPlayerNodeId, '실패하면 아무것도 옮기지 않는다');
  assert.deepEqual(failed.state.deceivedThreatIds, [threatId], '실패도 한 번을 쓴다');
});

test('성공하면 위협은 순찰로 돌아가지 않고 마지막 확인 위치만 옆 노드로 옮겨간다', () => {
  const { run, threatId } = runWithThreatHere();
  const { state, success } = deceiveThreat(run, threatId, 3);
  assert.equal(success, true);
  const after = state.threats[threatId];
  assert.equal(after.mode, 'pursuit', '추적은 유지된다 — 회피와 달리 끊지 않는다');
  assert.notEqual(after.lastKnownPlayerNodeId, run.playerNodeId, '내가 선 자리에서 시선이 떠났다');
  assert.equal(after.target.kind, 'player');
  assert.equal(after.target.nodeId, after.lastKnownPlayerNodeId, '추적 목표가 옮겨간 자리다');
  // 옮긴 자리는 내 노드와 실제로 이어진 인접 노드다.
  const neighbors = run.graph.edges
    .filter((e) => e.from === run.playerNodeId || e.to === run.playerNodeId)
    .map((e) => (e.from === run.playerNodeId ? e.to : e.from));
  assert.ok(neighbors.includes(after.lastKnownPlayerNodeId));
  // 속인 순간부터 경계 감쇠 타이머가 다시 돈다(ADR-0079).
  assert.equal(after.lastObservedPlayerAt, state.time);
});

test('조우 속이기는 0칸이다 — 시계가 움직이지 않는다', () => {
  const { run, threatId } = runWithThreatHere();
  assert.equal(deceiveThreat(run, threatId, 3).state.time, run.time);
});
