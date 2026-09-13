// Bridges card combat and the facility map (docs/extraction-map-implementation-spec.md §9).
// Pure functions only — nothing here touches combatEngine.js's live turn resolution (used by the
// current 8-floor game). `disengage*` models §9.2's CombatContext-only concept (disengage
// progress) that has no equivalent in the live CombatState yet.

import { reportNoise, advanceTime } from './runEngine.js';
import { COMBAT_ROUND_TIME_COST } from '../data/facilityLayout.js';

export { COMBAT_ROUND_TIME_COST };

/**
 * §9.1 전투 소음 게이지: a cumulative gauge filled by each played card's `mapTags.noise` (0-3),
 * checked immediately on every card play — never batched to round end, and never fed by enemy
 * intents. Reaching/exceeding capacity fires one noise event at the combat's node and resets the
 * gauge to 0; the fired event's intensity climbs 1 -> 2 -> 3 across successive fires this combat
 * and then holds at 3 (never resets down with the gauge).
 *
 * 용량 6(C 확정): 10이면 소음 2짜리 카드를 다섯 장 내야 한 번 울려서, 대부분의 전투가 소음을
 * 한 번도 내지 않고 끝났다 — 전투가 맵을 건드리지 않으면 "조용히 이기기"라는 선택 자체가 없다.
 * 6이면 보통 전투가 두세 번 울리고, 시끄러운 카드를 고를지 말지가 매 턴의 결정이 된다.
 */
export const NOISE_GAUGE_CAPACITY = 6;

/**
 * @param {number} gauge current accumulated noise (0..CAPACITY-1 going in)
 * @param {number} amount the played card's mapTags.noise (0-3)
 * @returns {{gauge: number, fired: boolean}}
 */
export function addCombatNoiseGauge(gauge, amount) {
  const next = gauge + Math.max(0, amount);
  if (next < NOISE_GAUGE_CAPACITY) return { gauge: next, fired: false };
  return { gauge: 0, fired: true };
}

/** @param {0|1|2|3} lastIntensity @returns {1|2|3} */
export function nextNoiseIntensity(lastIntensity) {
  return /** @type {1|2|3} */ (Math.min(3, lastIntensity + 1));
}

/**
 * Applies one played card's noise contribution to the gauge and, if it fires, reports the noise
 * event to the facility run at its escalated intensity.
 * @param {import('./types.js').FacilityRunState} runState
 * @param {string} nodeId combat's facility node
 * @param {number} gauge current gauge value
 * @param {0|1|2|3} lastIntensity last fired intensity this combat (0 if none fired yet)
 * @param {number} cardNoise the played card's mapTags.noise
 * @returns {{runState: import('./types.js').FacilityRunState, gauge: number, intensity: 0|1|2|3}}
 */
export function applyCombatCardNoise(runState, nodeId, gauge, lastIntensity, cardNoise) {
  const { gauge: nextGauge, fired } = addCombatNoiseGauge(gauge, cardNoise);
  if (!fired) return { runState, gauge: nextGauge, intensity: lastIntensity };
  const intensity = nextNoiseIntensity(lastIntensity);
  return { runState: reportNoise(runState, nodeId, intensity, runState.time), gauge: nextGauge, intensity };
}

/**
 * planned §8: 전투 1라운드(플레이어 행동 구간 + 적 반응)에 드는 맵 칸을 시설 런에 청구한다.
 * 적 개체 수나 낸 카드 수로 늘어나지 않는 고정값이고, 이 3칸 동안 맵의 쿨다운·개방·증원·효과
 * 만료가 함께 진행된다(교전 중인 위협만 `run.engagedThreatId`로 멈춰 있다).
 * @param {import('./types.js').FacilityRunState} runState
 * @param {number} [roundTimeCost]
 * @returns {import('./types.js').FacilityRunState}
 */
export function applyCombatRoundTimeToRunState(runState, roundTimeCost = COMBAT_ROUND_TIME_COST) {
  // 전투 라운드도 유료 행동이다 — 대기로 끊겼던 인접 실시간 관측은 여기서 다시 살아난다.
  return advanceTime({ ...runState, lastWaitEndedAt: null }, runState.time + roundTimeCost);
}

export const DISENGAGE_REQUIRED_PROGRESS = 2;
export const DISENGAGE_MOBILITY_BONUS_THRESHOLD = 2;

/**
 * @typedef {Object} DisengageState
 * @property {boolean} escapeIntent
 * @property {number} disengageProgress
 */

/**
 * §9.2 `BEGIN_DISENGAGE`: turns on escapeIntent; Mobility >=2 grants a one-time +1 at this moment
 * only (not on every subsequent progress tick).
 * @param {DisengageState} state
 * @param {number} effectiveMobility
 * @returns {DisengageState}
 */
export function beginDisengage(state, effectiveMobility) {
  if (state.escapeIntent) return state;
  const bonus = effectiveMobility >= DISENGAGE_MOBILITY_BONUS_THRESHOLD ? 1 : 0;
  return { escapeIntent: true, disengageProgress: state.disengageProgress + bonus };
}

/** §9.2 `CANCEL_DISENGAGE`: intent와 진행도를 즉시 0으로. @param {DisengageState} state @returns {DisengageState} */
export function cancelDisengage(state) {
  return { escapeIntent: false, disengageProgress: 0 };
}

/**
 * §9.2: `mapTags.disengageProgress`가 부여하는 진행도는 escapeIntent가 켜져 있을 때만 쌓인다 —
 * 꺼져 있으면 카드가 이탈 태그를 갖고 있어도 조용히 무시된다(자동 도주 방지).
 * @param {DisengageState} state
 * @param {number} amount
 * @returns {DisengageState}
 */
export function addDisengageProgress(state, amount) {
  if (!state.escapeIntent || amount <= 0) return state;
  return { ...state, disengageProgress: state.disengageProgress + amount };
}

/** @param {DisengageState} state @returns {boolean} */
export function canDisengage(state) {
  return state.escapeIntent && state.disengageProgress >= DISENGAGE_REQUIRED_PROGRESS;
}

/** 성공 이탈 뒤 진행도를 초기화한다(§9.2). @returns {DisengageState} */
export function resolveDisengage() {
  return { escapeIntent: false, disengageProgress: 0 };
}
