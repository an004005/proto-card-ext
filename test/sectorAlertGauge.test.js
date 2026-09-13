// 구역 경계도는 단계가 아니라 압력 게이지로 오른다(ADR-0082). 한 번의 실수가 통째로 한 단계를
// 올리던 시절에는 "아무 일도 없음"과 "+1" 사이에 중간이 없었다. 여기서는 원인별 압력이 실제로
// 누적되는지, 정원을 넘으면 이월되는지, 수습이 게이지를 지우는지 — 새 규칙의 네 축을 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph, adjacentSectorIds } from '../src/engine/facilityGraph.js';
import { createRunState, escalateSectorAlert, hackControlRoom, advanceTime } from '../src/engine/runEngine.js';
import { broadcastFalseTarget } from '../src/engine/recovery.js';
import { ALERT_GAUGE_CAPACITY, ALERT_PRESSURE, POWER_CUT_DURATION } from '../src/data/facilityLayout.js';

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return { ...createRunState(graph, seed), threats: {} };
}

/** escalateSectorAlert는 sectorAlerts만 돌려준다 — 상태에 다시 끼워 넣어 연쇄 호출한다. */
function push(state, sectorId, eventId, amount) {
  return { ...state, sectorAlerts: escalateSectorAlert(state, sectorId, eventId, amount) };
}

test('압력이 정원을 채우면 단계가 1 오르고 게이지는 0에서 다시 시작한다', () => {
  const base = makeRun(1);
  const sectorId = base.graph.sectorIds[0];
  assert.equal(ALERT_PRESSURE.cameraDetection + ALERT_PRESSURE.botchedAction, ALERT_GAUGE_CAPACITY);

  const seen = push(base, sectorId, 'camera_1', ALERT_PRESSURE.cameraDetection);
  assert.equal(seen.sectorAlerts[sectorId].level, 0, '카메라 하나로는 단계가 오르지 않는다');
  assert.equal(seen.sectorAlerts[sectorId].pressure, ALERT_PRESSURE.cameraDetection);

  const botched = push(seen, sectorId, 'botch_1', ALERT_PRESSURE.botchedAction);
  assert.equal(botched.sectorAlerts[sectorId].level, 1);
  assert.equal(botched.sectorAlerts[sectorId].pressure, 0);
});

test('정원을 넘긴 초과분은 다음 단계로 이월된다 — 큰 사건의 나머지가 버려지지 않는다', () => {
  const base = makeRun(1);
  const sectorId = base.graph.sectorIds[0];
  let state = base;
  for (const n of [1, 2]) state = push(state, sectorId, `trace_${n}`, ALERT_PRESSURE.strongTraceFound);
  assert.equal(state.sectorAlerts[sectorId].level, 0, '강한 흔적 둘로는 아직 모자라다');
  assert.equal(state.sectorAlerts[sectorId].pressure, ALERT_PRESSURE.strongTraceFound * 2);

  state = push(state, sectorId, 'trace_3', ALERT_PRESSURE.strongTraceFound);
  assert.equal(state.sectorAlerts[sectorId].level, 1, '셋째 흔적이 게이지를 채운다');
  assert.equal(state.sectorAlerts[sectorId].pressure, ALERT_PRESSURE.strongTraceFound * 3 - ALERT_GAUGE_CAPACITY, '남은 양은 이월된다');
});

test('최대 단계에서는 게이지가 0에 고정된다 — 더 채울 것이 없다', () => {
  const base = makeRun(1);
  const sectorId = base.graph.sectorIds[0];
  const maxed = { ...base, sectorAlerts: { ...base.sectorAlerts, [sectorId]: { level: 3, pressure: 0, resolvedEventIds: [] } } };
  const after = push(maxed, sectorId, 'camera_1', ALERT_PRESSURE.cameraDetection);
  assert.equal(after.sectorAlerts[sectorId].level, 3);
  assert.equal(after.sectorAlerts[sectorId].pressure, 0);
});

test('같은 사건은 두 번 압력을 얹지 않는다', () => {
  const base = makeRun(1);
  const sectorId = base.graph.sectorIds[0];
  let state = push(base, sectorId, 'same_event', ALERT_PRESSURE.corpseFound);
  state = push(state, sectorId, 'same_event', ALERT_PRESSURE.corpseFound);
  assert.equal(state.sectorAlerts[sectorId].pressure, ALERT_PRESSURE.corpseFound);
  assert.equal(state.sectorAlerts[sectorId].resolvedEventIds.length, 1);
});

test('전원 차단 중인 구역은 압력도 오르지 않고 기록도 남지 않는다', () => {
  const base = makeRun(1);
  const sectorId = base.graph.sectorIds[0];
  const cut = { ...base, powerCuts: [{ sectorId, expiresAt: base.time + POWER_CUT_DURATION }] };
  const during = push(cut, sectorId, 'camera_1', ALERT_PRESSURE.cameraDetection);
  assert.equal(during.sectorAlerts[sectorId].pressure, 0);
  assert.equal(during.sectorAlerts[sectorId].resolvedEventIds.length, 0);

  // 복구된 뒤 같은 원인이 다시 발견되면 그때는 오른다 — 막는 게 아니라 멈추는 것이다.
  const after = push({ ...during, powerCuts: [] }, sectorId, 'camera_1', ALERT_PRESSURE.cameraDetection);
  assert.equal(after.sectorAlerts[sectorId].pressure, ALERT_PRESSURE.cameraDetection);
});

test('통제실 장악은 단계를 낮추면서 반쯤 찬 게이지도 지운다', () => {
  const { graph } = generateFacilityGraph(2);
  const landmark = graph.landmarks[0];
  const base = { ...createRunState(graph, 2), playerNodeId: landmark.nodeId };
  const state = {
    ...base,
    sectorAlerts: {
      ...base.sectorAlerts,
      [landmark.sectorId]: { level: 2, pressure: ALERT_GAUGE_CAPACITY - 1, resolvedEventIds: [] },
    },
  };
  const seized = hackControlRoom(state, 2);
  assert.equal(seized.sectorAlerts[landmark.sectorId].level, 1);
  // 게이지를 남겨두면 장악한 구역이 다음 작은 사건 하나에 곧바로 되돌아간다.
  assert.equal(seized.sectorAlerts[landmark.sectorId].pressure, 0);
});

test('가짜 목표 송출은 단계 하나를 옮기고 보내는 쪽 게이지를 지운다 — 받는 쪽 게이지는 그대로다', () => {
  const { graph } = generateFacilityGraph(1);
  const base = { ...createRunState(graph, 1), threats: {} };
  const entry = base.graph.accessInterfaces[0];
  const sectorId = entry.nodeId.split('_')[0];
  const targetSectorId = adjacentSectorIds(base.graph, sectorId)[0];
  const raised = {
    ...base,
    playerNodeId: entry.nodeId,
    sectorAlerts: {
      ...base.sectorAlerts,
      [sectorId]: { level: 2, pressure: 7, resolvedEventIds: [] },
      [targetSectorId]: { level: 0, pressure: 3, resolvedEventIds: [] },
    },
  };
  const after = broadcastFalseTarget(raised, 1, targetSectorId);
  assert.equal(after.sectorAlerts[sectorId].level, 1, '옮기는 단위는 단계다');
  assert.equal(after.sectorAlerts[targetSectorId].level, 1, '총량은 단계 단위로 보존된다(ADR-0073)');
  assert.equal(after.sectorAlerts[sectorId].pressure, 0, '내준 쪽의 게이지는 지워진다');
  assert.equal(after.sectorAlerts[targetSectorId].pressure, 3, '받는 쪽 게이지는 건드리지 않는다');
});

test('같은 자리에서 시체와 강한 흔적이 함께 발견되면 압력이 같이 더해져 한 단계가 오른다', () => {
  const { graph } = generateFacilityGraph(1);
  const base = createRunState(graph, 1);
  const threat = Object.values(base.threats)[0];
  const target = threat.patrolRoute[1] || threat.patrolRoute[0];
  const sectorId = threat.sectorId;
  const state = {
    ...base,
    playerNodeId: null,
    corpses: [{ id: 'corpse_x', nodeId: target, sectorId, createdAt: 0 }],
    evidence: [{ id: 'e_strong', nodeId: target, tier: 2, createdBySectorId: sectorId }],
    threats: { ...base.threats, [threat.id]: { ...threat, nodeId: target, patrolRoute: [target], patrolIndex: 0, nextMoveAt: base.time, mode: 'patrol' } },
  };
  assert.equal(ALERT_PRESSURE.corpseFound + ALERT_PRESSURE.strongTraceFound, ALERT_GAUGE_CAPACITY);

  const after = advanceTime(state, state.time + 1);
  assert.equal(after.sectorAlerts[sectorId].level, 1, '둘이 겹치면 정확히 한 단계가 오른다');
  assert.equal(after.sectorAlerts[sectorId].pressure, 0);
});
