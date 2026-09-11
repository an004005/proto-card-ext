// 수습 수단(§4단계, D12) — 경계도는 시간으로 감소하지 않으므로(ADR-0069·0073) 낮추거나 미루는
// 방법은 전부 플레이어의 행동이어야 한다. 낮추는 수단이 해킹 하나뿐이면 해킹이 필수 스텟이 되므로
// 빌드마다 다른 경로를 준다. 총량 보존이 원칙이고, 진짜로 낮추는 것은 통제실 장악뿐이다.
//
// | 수단 | Capability | 성격 |
// |---|---|---|
// | 통제실 장악 | Hacking | 진짜로 낮춘다 (runEngine.js의 hackControlRoom) |
// | 흔적 정리 | Perception | 원인을 지운다. 총량은 안 건드린다 |
// | 전원 차단 | Force | 상승을 잠시 멈춘다. 총량은 안 건드린다 |
// | 가짜 목표 송출 | Deception | 인접 구역으로 옮긴다. 총량은 보존된다 |
//
// runEngine.js가 이미 크므로 신규 세 개는 여기 둔다. 전부 순수 함수이고 시간 진행은
// runEngine.js의 advanceTime을 그대로 쓴다.

import { applyOverloadDelta, reportFalseTarget, applyCapabilityCost, requireCapability } from './runEngine.js';
import {
  TRACE_CLEANUP_TIME_BY_PERCEPTION, POWER_CUT_DURATION, POWER_CUT_TIME, POWER_CUT_NOISE,
  FALSE_BROADCAST_TIME, FALSE_BROADCAST_OVERLOAD, FALSE_BROADCAST_INTENSITY, FALSE_BROADCAST_DURATION, ADJACENT_SECTOR_IDS,
} from '../data/facilityLayout.js';

/** @typedef {import('./types.js').FacilityRunState} FacilityRunState */

/** @param {string} nodeId */
function sectorOf(nodeId) {
  return /** @type {import('./types.js').FacilitySectorId} */ (nodeId.split('_')[0]);
}

/**
 * 현재 노드에 접속 인터페이스가 있는지 — 전원 차단과 가짜 목표 송출의 공통 자리다. 발전기는
 * 실험동·동력동 두 구역에만 있지만 접속 인터페이스는 구역마다 최소 하나가 보장되므로(§4.2),
 * 어느 구역에서든 수습 수단을 쓸 수 있으려면 이쪽이어야 한다.
 * @param {FacilityRunState} state
 */
function interfaceHere(state) {
  return state.graph.accessInterfaces.find((entry) => entry.nodeId === state.playerNodeId);
}

/**
 * 흔적 정리(Perception) — 현재 노드의 흔적을 전부 지운다. 경계도 상승의 원인 자체를 없애는
 * 것이라 총량은 건드리지 않는다. 시간이 크고 그동안 무방비다(D12) — Perception이 높을수록 짧다.
 * @param {FacilityRunState} state
 * @param {number} effectivePerception
 * @returns {FacilityRunState}
 */
export function cleanTraces(state, effectivePerception) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new Error('trace cleanup unavailable');
  const here = state.evidence.filter((e) => e.nodeId === state.playerNodeId);
  if (here.length === 0) throw new Error('no traces at this node');

  // Perception은 자기 통화가 없어 시간으로만 받는다(D8의 타협). 수치별 기준 시간표가 이미
  // 있으므로 그것을 표준 비용으로 삼고, 층계가 다시 배수를 건다.
  const timeIndex = Math.max(-2, Math.min(4, effectivePerception)) + 2;
  const cost = requireCapability('perception', effectivePerception, 1, { time: TRACE_CLEANUP_TIME_BY_PERCEPTION[timeIndex] });
  const next = { ...state, evidence: state.evidence.filter((e) => e.nodeId !== state.playerNodeId) };
  return applyCapabilityCost(next, cost);
}

/**
 * 전원 차단(Force) — 그 구역 감시를 마비시켜 경계 상승을 잠시 멈춘다(escalateSectorAlert가
 * powerCuts를 보고 no-op한다). 대가는 큰 소음과, 그동안 그 구역의 전자식 자물쇠를 열 수 없다는
 * 것이다(전원이 없으니 잡을 제어가 없다. 문을 뜯는 Force는 여전히 된다).
 * @param {FacilityRunState} state
 * @param {number} effectiveForce
 * @returns {FacilityRunState}
 */
export function cutPower(state, effectiveForce) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new Error('power cut unavailable');
  if (!interfaceHere(state)) throw new Error('not at an access interface');
  const sectorId = sectorOf(state.playerNodeId);
  if (state.powerCuts.some((cut) => cut.sectorId === sectorId && cut.expiresAt > state.time)) {
    throw new Error('power is already cut in this sector');
  }

  const cost = requireCapability('force', effectiveForce, 1, { time: POWER_CUT_TIME, noise: POWER_CUT_NOISE });
  const next = { ...state, powerCuts: [...state.powerCuts, { sectorId, expiresAt: state.time + POWER_CUT_DURATION }] };
  return applyCapabilityCost(next, cost);
}

/**
 * 가짜 목표 송출(Deception) — 이 구역의 경계를 인접 구역 하나로 옮긴다. 총량은 그대로이고,
 * 옮겨간 구역이 대신 위험해진다(D12). 옮긴 쪽에는 가짜 목표까지 심어 위협을 실제로 그쪽으로
 * 끌어간다 — 숫자만 옮기는 게 아니라 시선이 옮겨가야 수습이라 할 수 있다.
 * @param {FacilityRunState} state
 * @param {number} effectiveDeception
 * @param {import('./types.js').FacilitySectorId} targetSectorId
 * @returns {FacilityRunState}
 */
export function broadcastFalseTarget(state, effectiveDeception, targetSectorId) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new Error('false broadcast unavailable');
  if (!interfaceHere(state)) throw new Error('not at an access interface');

  const sectorId = sectorOf(state.playerNodeId);
  const neighbors = ADJACENT_SECTOR_IDS[sectorId] || [];
  if (!neighbors.includes(targetSectorId)) throw new Error(`${targetSectorId} is not adjacent to ${sectorId}`);
  const current = state.sectorAlerts[sectorId];
  if (current.level <= 0) throw new Error('no alert to move');
  // 옮길 곳이 이미 최대면 옮길 수 없다. 그냥 진행하면 +1이 상한에서 잘려 사라지고 이쪽만
  // 내려가, 총량 보존(ADR-0073)을 깨고 경계도를 실제로 지워버린다 — Deception이 통제실보다
  // 싼 경계도 소거기가 되어 "진짜로 낮추는 것은 통제실 장악뿐"이라는 D12의 전제가 무너진다.
  if (state.sectorAlerts[targetSectorId].level >= 3) {
    throw new Error(`${targetSectorId} alert is already at maximum — there is nowhere to move it`);
  }

  // Deception이 모자라면 가짜 목표가 오래 버티지 못한다 — 경계는 옮겨가지만 시선은 금방
  // 돌아온다(D8: Deception의 통화는 효과 지속).
  const cost = requireCapability('deception', effectiveDeception, 1, { time: FALSE_BROADCAST_TIME, duration: FALSE_BROADCAST_DURATION });

  const target = state.sectorAlerts[targetSectorId];
  let next = {
    ...state,
    sectorAlerts: {
      ...state.sectorAlerts,
      [sectorId]: { ...current, level: /** @type {0|1|2|3} */ (current.level - 1) },
      [targetSectorId]: { ...target, level: /** @type {0|1|2|3} */ (Math.min(3, target.level + 1)) },
    },
  };
  next = applyOverloadDelta(next, FALSE_BROADCAST_OVERLOAD);

  // 옮겨간 구역의 아무 노드에나 가짜 목표를 심는다 — 그 구역 위협이 실제로 그쪽으로 움직인다.
  // 숫자만 옮기면 시선은 그대로라 수습이 아니다.
  const decoyNode = next.graph.nodes.find((n) => n.sectorId === targetSectorId && n.isGateway)
    || next.graph.nodes.find((n) => n.sectorId === targetSectorId);
  if (decoyNode) {
    next = reportFalseTarget(next, decoyNode.id, FALSE_BROADCAST_INTENSITY, /** @type {number} */ (cost.duration), next.time);
    // 심은 미끼는 이미 위에서 경계도 한 칸으로 값을 치렀다. 나중에 위협이 쫓아가 허탕을 쳐도
    // 또 올리면 총량이 늘어나 "옮긴다"가 아니라 "만든다"가 된다 — 그 구역의 처리 완료 목록에
    // 미리 넣어 두 번 계산되지 않게 한다.
    const planted = next.falseTargets[next.falseTargets.length - 1];
    const targetAlert = next.sectorAlerts[targetSectorId];
    next = {
      ...next,
      sectorAlerts: {
        ...next.sectorAlerts,
        [targetSectorId]: { ...targetAlert, resolvedEventIds: [...targetAlert.resolvedEventIds, planted.id] },
      },
    };
  }

  return applyCapabilityCost(next, { ...cost, duration: null });
}
