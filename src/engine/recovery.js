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

import { RuleViolation } from './errors.js';
import { applyCapabilityCost } from './runEngine.js';
import { requireActionCost } from './actionCosts.js';
import {
  POWER_CUT_DURATION, FALSE_BROADCAST_OVERLOAD, FALSE_BROADCAST_INTENSITY, ADJACENT_SECTOR_IDS,
  FALSE_BROADCAST_ANY_SECTOR_DECEPTION, FAKE_NOISE_RANGE_BY_DECEPTION,
  FAKE_NOISE_STRONG_DECEPTION, FAKE_NOISE_INTENSITY, FAKE_NOISE_STRONG_INTENSITY,
} from '../data/facilityLayout.js';
import { bfsHopDistances } from './graphUtils.js';

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
 * 실효 Deception이 가짜 소음을 심을 수 있는 홉 범위. 요구치(1)에 못 미쳐도 최소 1홉은 남는다 —
 * 이분 게이트가 아니라 층계이고, 부족분의 대가는 시간으로 받는다(D8).
 * @param {number} effectiveDeception
 * @returns {number}
 */
export function fakeNoiseRange(effectiveDeception) {
  return FAKE_NOISE_RANGE_BY_DECEPTION[Math.max(-2, Math.min(4, effectiveDeception)) + 2];
}

/**
 * 가짜 소음(Deception) — 지정한 노드에 소음 사건 하나를 심는다. 위협은 그것을 실제 소음과
 * 구별하지 못하고 조사하러 간다(selectThreatTarget이 같은 우선순위 표로 둘을 함께 본다).
 *
 * 가짜 목표 송출과 다른 점은 셋이다: 접속 인터페이스가 필요 없고, 경계도를 옮기지 않으며,
 * 대신 **어디에 심을지**를 고른다. 경계도를 건드리지 않으므로 ADR-0073의 총량 보존과 무관하다 —
 * 이것은 수습 수단이 아니라 유인 수단이다.
 *
 * 사거리는 Deception이 정한다(1홉/2홉/3홉). 3 이상이면 심는 소음이 강도 2가 되어 더 멀리까지
 * 들린다. 지속은 소음 사건의 기본 수명 그대로다.
 * @param {FacilityRunState} state
 * @param {number} effectiveDeception
 * @param {string} targetNodeId
 * @returns {FacilityRunState}
 */
export function plantFakeNoise(state, effectiveDeception, targetNodeId) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('fake noise unavailable');
  const target = state.graph.nodes.find((n) => n.id === targetNodeId);
  if (!target) throw new RuleViolation(`unknown node ${targetNodeId}`);
  // 자격 판정은 사양표 하나가 한다 — 요구치(1) 미달은 잠김이 아니라 더 비싼 시도이고,
  // 정말 막히는 것은 불가 단계뿐이다. 사거리는 그 위에 얹히는 별개의 축소다.
  const cost = requireActionCost('fakeNoise', { value: effectiveDeception });
  const range = fakeNoiseRange(effectiveDeception);
  // 심을 수 있는 거리는 "들리는 거리"와 같은 잣대로 잰다 — 잠긴 문 너머에도 소리는 만들 수 있다.
  const hops = bfsHopDistances(state.graph.edges, state.playerNodeId).get(targetNodeId);
  if (hops === undefined || hops > range) throw new RuleViolation(`${targetNodeId} is out of fake-noise range (${range} hops)`);

  const intensity = effectiveDeception >= FAKE_NOISE_STRONG_DECEPTION ? FAKE_NOISE_STRONG_INTENSITY : FAKE_NOISE_INTENSITY;
  // 다른 현장 작업과 같다 — 소음은 시작이 아니라 **완료 시각**에 난다.
  return applyCapabilityCost(state, { ...cost, duration: null }, undefined, 'fakeNoise', { targetNodeId, intensity });
}

/**
 * 흔적 정리(Perception) — 현재 노드의 흔적을 전부 지운다. 경계도 상승의 원인 자체를 없애는
 * 것이라 총량은 건드리지 않는다. 시간이 크고 그동안 무방비다(D12) — Perception이 높을수록 짧다.
 * @param {FacilityRunState} state
 * @param {number} effectivePerception
 * @returns {FacilityRunState}
 */
export function cleanTraces(state, effectivePerception) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('trace cleanup unavailable');
  const here = state.evidence.filter((e) => e.nodeId === state.playerNodeId);
  if (here.length === 0) throw new RuleViolation('no traces at this node');

  // Perception은 자기 통화가 없어 시간으로만 받는다(D8의 타협). 수치별 기준 시간표가 이미
  // 있으므로 그것이 곧 전용 시간 규칙이다 — 층계 가감을 또 얹으면 같은 Perception 수치에
  // 대가를 두 번 물리게 된다(ADR-0075). 층계는 불가 판정에만 쓴다.
  const cost = requireActionCost('cleanTraces', { value: effectivePerception });
  // 흔적은 작업이 끝나야 지워진다 — 중간에 적이 들이닥치면 치우다 만 자리가 그대로 남는다.
  return applyCapabilityCost(state, cost, undefined, 'cleanTraces');
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
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('power cut unavailable');
  if (!interfaceHere(state)) throw new RuleViolation('not at an access interface');
  const sectorId = sectorOf(state.playerNodeId);
  if (state.powerCuts.some((cut) => cut.sectorId === sectorId && cut.expiresAt > state.time)) {
    throw new RuleViolation('power is already cut in this sector');
  }

  const cost = requireActionCost('cutPower', { value: effectiveForce });
  return applyCapabilityCost(state, cost, undefined, 'cutPower', { sectorId, duration: POWER_CUT_DURATION });
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
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('false broadcast unavailable');
  if (!interfaceHere(state)) throw new RuleViolation('not at an access interface');

  const sectorId = sectorOf(state.playerNodeId);
  // Deception 3 이상은 인접이 아니라 아무 구역으로나 쏠 수 있다 — 경계를 옆으로 미는 것과
  // 시설 반대편으로 던지는 것은 전혀 다른 계획이고, 그 차이가 Deception 상위 수치의 값이다.
  const anySector = effectiveDeception >= FALSE_BROADCAST_ANY_SECTOR_DECEPTION;
  const neighbors = ADJACENT_SECTOR_IDS[sectorId] || [];
  if (!anySector && !neighbors.includes(targetSectorId)) throw new RuleViolation(`${targetSectorId} is not adjacent to ${sectorId}`);
  if (targetSectorId === sectorId) throw new RuleViolation('cannot broadcast a false target into this very sector');
  const current = state.sectorAlerts[sectorId];
  if (current.level <= 0) throw new RuleViolation('no alert to move');
  // 옮길 곳이 이미 최대면 옮길 수 없다. 그냥 진행하면 +1이 상한에서 잘려 사라지고 이쪽만
  // 내려가, 총량 보존(ADR-0073)을 깨고 경계도를 실제로 지워버린다 — Deception이 통제실보다
  // 싼 경계도 소거기가 되어 "진짜로 낮추는 것은 통제실 장악뿐"이라는 D12의 전제가 무너진다.
  if (state.sectorAlerts[targetSectorId].level >= 3) {
    throw new RuleViolation(`${targetSectorId} alert is already at maximum — there is nowhere to move it`);
  }

  // Deception이 모자라면 가짜 목표가 오래 버티지 못한다 — 경계는 옮겨가지만 시선은 금방
  // 돌아온다(D8: Deception의 통화는 효과 지속).
  const cost = requireActionCost('falseBroadcast', { value: effectiveDeception });

  // 옮겨간 구역의 아무 노드에나 가짜 목표를 심는다 — 그 구역 위협이 실제로 그쪽으로 움직인다.
  // 숫자만 옮기면 시선은 그대로라 수습이 아니다. 경계 이동도 미끼도 **완료 시각 C**에 생기고,
  // 미끼는 거기서부터 층계 고정표의 지속만큼 버틴다.
  const decoyNode = state.graph.nodes.find((n) => n.sectorId === targetSectorId && n.isGateway)
    || state.graph.nodes.find((n) => n.sectorId === targetSectorId);
  return applyCapabilityCost(state, { ...cost, overload: FALSE_BROADCAST_OVERLOAD, duration: null }, undefined, 'falseBroadcast', {
    sectorId,
    targetSectorId,
    decoyNodeId: decoyNode ? decoyNode.id : null,
    intensity: FALSE_BROADCAST_INTENSITY,
    duration: /** @type {number} */ (cost.duration),
  });
}
