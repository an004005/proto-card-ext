// 개발자 전용 테스트 시나리오 — 정식 게임 콘텐츠가 아니며 CONTEXT.md의 데이터 권위 규칙과
// 무관하다(수치를 정의하지 않고, 이미 생성된 런 스냅샷을 UI 확인용으로 결정론적으로 뒤튼다).
// `?devScenario=<name>`으로만 진입하며(App.js), 정상 플레이 경로에는 전혀 관여하지 않는다.
// 은엄폐·조우·통제실·지도 화살표처럼 무작위 배치나 여러 스텝의 플레이가 있어야 나오는 상태를
// 브라우저에서 즉시 재현하기 위한 것.

import { startCombat } from '../engine/combatReducer.js';

export const DEV_SCENARIOS = ['concealment', 'landmark', 'encounter-advantage', 'encounter-disadvantage', 'map-item', 'combat'];

/**
 * @param {import('../engine/types.js').GameSnapshot} snapshot CONFIRM_LOADOUT 직후(currentScreen: 'map') 스냅샷
 * @param {string} name DEV_SCENARIOS 중 하나
 * @returns {import('../engine/types.js').GameSnapshot}
 */
export function applyDevScenario(snapshot, name) {
  const run = snapshot.facilityRunState;
  if (!run || snapshot.currentScreen !== 'map') return snapshot;
  switch (name) {
    case 'concealment': return withConcealment(snapshot, run);
    case 'landmark': return withLandmark(snapshot, run);
    case 'encounter-advantage': return withEncounter(snapshot, run, 'advantage');
    case 'encounter-disadvantage': return withEncounter(snapshot, run, 'disadvantage');
    case 'map-item': return withMapItem(snapshot);
    case 'combat': return withCombat(snapshot, run);
    default: return snapshot;
  }
}

/** 즉시 전투로 진입시킨다(소음 게이지 UI 등 전투 화면 자체를 확인할 때 씀). */
function withCombat(snapshot, run) {
  const threatId = Object.keys(run.threats)[0];
  const threat = threatId ? run.threats[threatId] : null;
  return startCombat(snapshot, threat?.monsterIds ?? ['nibbit'], undefined, { nodeId: run.playerNodeId, threatId: threatId ?? undefined });
}

/** 현재 노드에 은엄폐(+2)를 강제 배치하고, 정찰한 것처럼 관측 기록도 함께 채운다(버튼이
 * `observations[nodeId]?.concealment != null`을 요구하므로 값만 심어서는 버튼이 안 뜬다). */
function withConcealment(snapshot, run) {
  const nodeId = run.playerNodeId;
  const value = 2;
  const graph = { ...run.graph, concealmentByNodeId: { ...run.graph.concealmentByNodeId, [nodeId]: value } };
  const prevObservation = run.observations[nodeId] || { observedAt: run.time, hasThreat: false };
  const observations = { ...run.observations, [nodeId]: { ...prevObservation, concealment: value } };
  return { ...snapshot, facilityRunState: { ...run, graph, observations } };
}

/** 첫 번째 구역 랜드마크로 순간이동시켜 통제실 해킹 패널을 즉시 띄운다. */
function withLandmark(snapshot, run) {
  const landmark = run.graph.landmarks[0];
  if (!landmark) return snapshot;
  return { ...snapshot, facilityRunState: { ...run, playerNodeId: landmark.nodeId } };
}

/** 임의의 기존 위협 마커 하나를 플레이어 노드로 끌어와 조우 상태를 강제로 연다. */
function withEncounter(snapshot, run, tier) {
  const threatId = Object.keys(run.threats)[0];
  if (!threatId) return snapshot;
  const threats = { ...run.threats, [threatId]: { ...run.threats[threatId], nodeId: run.playerNodeId } };
  const encounter = { threatId, nodeId: run.playerNodeId, tier, graceUsed: false };
  return { ...snapshot, facilityRunState: { ...run, threats, encounter } };
}

/** 지도 임플란트(⑦)를 강제 장착시켜 구역 랜드마크 화살표 오버레이를 즉시 확인할 수 있게 한다. */
function withMapItem(snapshot) {
  const ps = snapshot.playerState;
  if (ps.loadout.implantIds.includes('implant7')) return snapshot;
  const implantIds = [...ps.loadout.implantIds.slice(0, 2), 'implant7'];
  return { ...snapshot, playerState: { ...ps, loadout: { ...ps.loadout, implantIds } } };
}
