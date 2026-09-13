// §4단계 수습 수단(D12): 경계도는 저절로 내려가지 않으므로 낮추거나 미루는 방법은 전부
// 플레이어의 행동이어야 한다. 네 수단이 서로 다른 Capability에 걸려 있어 해킹이 필수 스텟이
// 되지 않는 것이 이 결정의 목적이므로, 각 수단의 게이팅과 "총량 보존" 성격을 확인한다.
//
// §5단계 이후 게이팅은 이분법이 아니라 층계다(D8) — 요구치 1에 0이면 대가를 치르고 되고,
// 하한(-2)에서만 막힌다. 그래서 아래 "막힌다" 검사는 전부 -2로 친다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState, advanceTime, openSpecialEdge } from '../src/engine/runEngine.js';
import { cleanTraces, cutPower, broadcastFalseTarget } from '../src/engine/recovery.js';
import {
  TRACE_CLEANUP_TIME_BY_PERCEPTION, POWER_CUT_DURATION, POWER_CUT_TIME,
  FALSE_BROADCAST_TIME, ADJACENT_SECTOR_IDS, 
} from '../src/data/facilityLayout.js';

/**
 * 위협이 하나도 없는 조용한 런 — 수습 수단 자체의 효과를 보는 테스트의 기본값이다(같은 뜻의
 * 픽스처가 taskScheduling.test.js에도 있다). "작업 도중 적이 도착하면 중단된다"(planned
 * §9.4)는 별개 규칙이 끼어들지 않게 하고, 위협이 필요한 자리에는 아래 threatOfSector로
 * 필요한 하나만 직접 심는다 — 작업을 끝낸 뒤에 위협 전체를 되돌려 넣으면 그 위협이 그동안
 * 어디에 있었는지가 상태와 어긋난다.
 */
function quietRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return { ...createRunState(graph, seed), threats: {} };
}

/** 같은 그래프의 초기 배치에서 그 구역을 맡은 위협 하나를 꺼낸다 — 조사 도착을 심는 재료다. */
function threatOfSector(run, sectorId, seed = 1) {
  return Object.values(createRunState(run.graph, seed).threats).find((t) => t.sectorId === sectorId);
}

/** 접속 인터페이스가 있는 노드에 플레이어를 세운다 — 전원 차단·가짜 목표의 공통 자리다. */
function atInterface(state) {
  const entry = state.graph.accessInterfaces[0];
  return { ...state, playerNodeId: entry.nodeId };
}

test('cleanTraces needs Perception 1+ and traces to clean, and its cost drops as Perception rises', () => {
  const base = quietRun(1);
  const nodeId = base.playerNodeId;
  const sectorId = nodeId.split('_')[0];
  const withTraces = {
    ...base,
    evidence: [
      { id: 'e1', nodeId, tier: 1, createdBySectorId: sectorId },
      { id: 'e2', nodeId, tier: 2, createdBySectorId: sectorId },
      { id: 'elsewhere', nodeId: 'labs_0', tier: 2, createdBySectorId: 'labs' },
    ],
  };

  assert.throws(() => cleanTraces(withTraces, -2), /perception/);
  // 0은 더 이상 막히지 않는다 — 되지만 표준보다 오래 걸린다. 그 "더 오래"는 Perception 전용
  // 시간표가 이미 담고 있으므로 층계 가감을 또 얹지 않는다(ADR-0075) — 얹으면 같은 수치에
  // 대가를 두 번 물린다.
  const strained = cleanTraces(withTraces, 0);
  assert.equal(strained.time - base.time, TRACE_CLEANUP_TIME_BY_PERCEPTION[2], '전용표 값을 그대로 쓴다');
  assert.ok(TRACE_CLEANUP_TIME_BY_PERCEPTION[2] > TRACE_CLEANUP_TIME_BY_PERCEPTION[3], 'Perception이 모자라면 더 오래 걸린다');
  assert.throws(() => cleanTraces(base, 3), /no traces/);

  const cleaned = cleanTraces(withTraces, 1);
  assert.equal(cleaned.pendingHpLoss || 0, 0, 'Perception은 시간 말고 다른 통화를 받지 않는다');
  assert.deepEqual(cleaned.evidence.map((e) => e.id), ['elsewhere'], '현재 노드의 흔적만 지운다');
  assert.equal(cleaned.time, base.time + TRACE_CLEANUP_TIME_BY_PERCEPTION[3]); // perception 1 -> index 3

  const fast = cleanTraces(withTraces, 4);
  assert.ok(fast.time - base.time < cleaned.time - base.time, 'Perception이 높을수록 빨리 끝난다');
});

test('cutPower freezes the sector alert until it expires, and blocks hacking electronic locks meanwhile', () => {
  const base = atInterface(quietRun(1));
  const sectorId = base.playerNodeId.split('_')[0];

  assert.throws(() => cutPower(base, -2), /force/);
  assert.throws(() => cutPower({ ...base, playerNodeId: base.graph.startNodeId }, 3), /access interface/);

  const cut = cutPower(base, 1);
  assert.equal(cut.time, base.time + POWER_CUT_TIME);
  assert.ok(cut.powerCuts.some((c) => c.sectorId === sectorId), '그 구역 전원이 끊긴다');
  assert.ok(cut.noiseEvents.length > base.noiseEvents.length, '큰 소음이 대가다');
  assert.throws(() => cutPower(cut, 3), /already cut/);

  // 전원이 끊긴 동안에는 이 구역에서 위협이 소음 출처에 도착해도 경계도가 오르지 않는다.
  const threat = threatOfSector(cut, sectorId);
  assert.ok(threat, 'fixture sector should have a threat');
  const investigating = {
    ...cut,
    playerNodeId: null,
    noiseEvents: [{ id: 'n1', sourceNodeId: threat.patrolRoute[0], intensity: 3, createdAt: cut.time, expiresAt: cut.time + 400 }],
    threats: { [threat.id]: { ...threat, nodeId: threat.patrolRoute[0], nextMoveAt: cut.time, mode: 'investigate' } },
  };
  const during = advanceTime(investigating, cut.time + 1);
  assert.equal(during.sectorAlerts[sectorId].level, 0, '전원 차단 중에는 경계가 오르지 않는다');

  // 전자식 자물쇠는 전원이 없으면 해킹으로 열 수 없다 — Force로 뜯는 길은 남는다.
  const lock = cut.graph.edges.find((e) => (e.from === cut.playerNodeId || e.to === cut.playerNodeId)
    && e.features.includes('electronic'));
  if (lock) {
    assert.throws(() => openSpecialEdge(cut, lock.id, 'hacking', 4, 'normal'), /power is cut/);
  }
});

test('broadcastFalseTarget conserves total alert: it moves one level to an adjacent sector and plants a decoy there', () => {
  const base = atInterface(quietRun(1));
  const sectorId = base.playerNodeId.split('_')[0];
  const neighborId = ADJACENT_SECTOR_IDS[sectorId][0];

  assert.throws(() => broadcastFalseTarget(base, 3, neighborId), /no alert to move/);

  const raised = {
    ...base,
    sectorAlerts: { ...base.sectorAlerts, [sectorId]: { level: 2, resolvedEventIds: [] } },
  };
  assert.throws(() => broadcastFalseTarget(raised, -2, neighborId), /deception/);
  const far = Object.keys(base.sectorAlerts).find((id) => id !== sectorId && !ADJACENT_SECTOR_IDS[sectorId].includes(id));
  assert.throws(() => broadcastFalseTarget(raised, 2, far), /not adjacent/);
  // Deception 3부터는 인접이 아니라 아무 구역으로나 던질 수 있다.
  const thrown = broadcastFalseTarget(raised, 3, far);
  assert.equal(thrown.sectorAlerts[far].level, raised.sectorAlerts[far].level + 1);
  assert.ok(thrown.falseTargets.some((t) => t.sourceNodeId.startsWith(`${far}_`)));

  const before = raised.sectorAlerts[sectorId].level + raised.sectorAlerts[neighborId].level;
  const after = broadcastFalseTarget(raised, 1, neighborId);
  assert.equal(after.sectorAlerts[sectorId].level, 1, '이 구역은 하나 내려간다');
  assert.equal(after.sectorAlerts[neighborId].level, raised.sectorAlerts[neighborId].level + 1, '인접 구역이 대신 진다');
  assert.equal(after.sectorAlerts[sectorId].level + after.sectorAlerts[neighborId].level, before, '총량은 보존된다');
  assert.ok(after.falseTargets.some((t) => t.sourceNodeId.startsWith(`${neighborId}_`)), '옮긴 쪽으로 시선도 옮긴다');
  assert.equal(after.time, raised.time + FALSE_BROADCAST_TIME);
});

test('the power cut wears off and the sector can be escalated again', () => {
  const base = atInterface(quietRun(1));
  const sectorId = base.playerNodeId.split('_')[0];
  const cut = cutPower(base, 1);
  const expiry = cut.powerCuts.find((c) => c.sectorId === sectorId).expiresAt;
  // 효과는 완료 시각 C부터 `[C, C+D)` 동안 유효하다(ADR-0075) — 시작 시각부터가 아니다.
  assert.equal(expiry, base.time + POWER_CUT_TIME + POWER_CUT_DURATION);

  const threat = threatOfSector(cut, sectorId);
  const source = threat.patrolRoute[0];
  const later = expiry + 1;
  const investigating = {
    ...cut,
    time: expiry,
    playerNodeId: null,
    noiseEvents: [{ id: 'n2', sourceNodeId: source, intensity: 3, createdAt: expiry, expiresAt: later + 400 }],
    threats: { [threat.id]: { ...threat, nodeId: source, nextMoveAt: expiry, mode: 'investigate' } },
  };
  const after = advanceTime(investigating, later);
  assert.equal(after.sectorAlerts[sectorId].level, 1, '전원이 복구되면 다시 오른다');
});
