// Bridges card combat and the facility map (docs/extraction-map-implementation-spec.md §9).
// Pure functions only — nothing here touches combatEngine.js's live turn resolution (used by the
// current 8-floor game). `disengage*` models §9.2's CombatContext-only concept (disengage
// progress) that has no equivalent in the live CombatState yet.

import { reportNoise, advanceTime } from './runEngine.js';

/**
 * §9.1 전투 소음 게이지: a cumulative gauge (capacity 10) filled by each played card's
 * `mapTags.noise` (0-3), checked immediately on every card play — never batched to round end,
 * and never fed by enemy intents. Reaching/exceeding capacity fires one noise event at the
 * combat's node and resets the gauge to 0; the fired event's intensity climbs 1 -> 2 -> 3 across
 * successive fires this combat and then holds at 3 (never resets down with the gauge).
 */
export const NOISE_GAUGE_CAPACITY = 10;

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
 * §9.1.1: apply the round's fixed time cost to the facility run (noise is no longer batched per
 * round — see `applyCombatCardNoise`, called immediately on each card play instead).
 * @param {import('./types.js').FacilityRunState} runState
 * @param {number} [roundTimeCost]
 * @returns {import('./types.js').FacilityRunState}
 */
export function applyCombatRoundTimeToRunState(runState, roundTimeCost = 60) {
  return advanceTime(runState, runState.time + roundTimeCost);
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
