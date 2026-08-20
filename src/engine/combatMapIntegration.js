// Bridges card combat and the facility map (docs/extraction-map-implementation-spec.md §9).
// Pure functions only — nothing here touches combatEngine.js's live turn resolution (used by the
// current 8-floor game). `applyCombatRoundToRunState` composes runEngine.js's existing
// `reportNoise`/`advanceTime` to turn "this round's cards+enemy moves" into the map's noise/time
// state; `disengage*`/`reinforcement*` model §9.2/§9.1's CombatContext-only concepts (disengage
// progress, reinforcement queue) that have no equivalent in the live CombatState yet.

import { reportNoise, advanceTime } from './runEngine.js';

/**
 * §9.1/§9.1.1 "전투 소음 봉투": one noise event per combat round, at the combat's node, whose
 * intensity is the max of every card/enemy-move noise used that round — never one event per card.
 * @param {number[]} noiseValues
 * @returns {0|1|2|3}
 */
export function computeRoundNoiseEnvelope(noiseValues) {
  return /** @type {0|1|2|3} */ (noiseValues.reduce((max, n) => Math.max(max, n), 0));
}

/**
 * §9.1.1: apply one combat round's noise envelope + the round's fixed time cost to the facility
 * run. `roundTimeCost` defaults to the player-turn base (60, §9.1) — pass the actual committed
 * time if a round ever differs (it doesn't yet; kept as a parameter so callers don't hardcode it
 * twice).
 * @param {import('./types.js').FacilityRunState} runState
 * @param {string} nodeId combat's facility node
 * @param {number[]} noiseValues this round's card + enemy move noise values
 * @param {number} [roundTimeCost]
 * @returns {import('./types.js').FacilityRunState}
 */
export function applyCombatRoundToRunState(runState, nodeId, noiseValues, roundTimeCost = 60) {
  const envelope = computeRoundNoiseEnvelope(noiseValues);
  const withNoise = envelope > 0 ? reportNoise(runState, nodeId, /** @type {1|2|3} */ (envelope), runState.time) : runState;
  return advanceTime(withNoise, withNoise.time + roundTimeCost);
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

export const REINFORCEMENT_FIRST_DELAY = 120;
export const REINFORCEMENT_SUBSEQUENT_DELAY = 60;
export const REINFORCEMENT_MAX_PER_GROUP = 2;

/**
 * @typedef {Object} ReinforcementEntry
 * @property {string} threatId
 * @property {number} eligibleAt 전투 시작 또는 이 그룹의 도착 시각.
 * @property {number} addedCount
 * @property {number|null} nextAt
 */

/**
 * @param {string} threatId
 * @param {number} eligibleAt
 * @returns {ReinforcementEntry}
 */
export function scheduleReinforcement(threatId, eligibleAt) {
  return { threatId, eligibleAt, addedCount: 0, nextAt: null };
}

/**
 * §9.1 "증원 대기": 전투 시작/도착 뒤 120에 1개체, 이후 60마다 1개체씩 최대 2개체. 이번 라운드에
 * 등록된 증원은 다음 적 행동부터 참가한다(§9.1.1) — 그 순서는 호출자(전투 라운드 처리)의 몫이고,
 * 이 함수는 "지금 몇 명이 합류 가능한가"만 결정한다.
 * @param {ReinforcementEntry[]} queue
 * @param {number} currentTime
 * @returns {{queue: ReinforcementEntry[], arrivals: {threatId: string, count: number}[]}}
 */
export function advanceReinforcements(queue, currentTime) {
  /** @type {{threatId: string, count: number}[]} */
  const arrivals = [];
  const nextQueue = queue.map((entry) => {
    if (entry.addedCount === 0 && currentTime >= entry.eligibleAt) {
      arrivals.push({ threatId: entry.threatId, count: 1 });
      return { ...entry, addedCount: 1, nextAt: currentTime + REINFORCEMENT_SUBSEQUENT_DELAY };
    }
    if (entry.addedCount === 1 && entry.nextAt !== null && currentTime >= entry.nextAt) {
      arrivals.push({ threatId: entry.threatId, count: 1 });
      return { ...entry, addedCount: REINFORCEMENT_MAX_PER_GROUP, nextAt: null };
    }
    return entry;
  });
  return { queue: nextQueue, arrivals };
}
