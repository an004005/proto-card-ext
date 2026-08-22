// Overload (과부화) — the run-level meta resource that stands in for STS's card-upgrade tier.
// It persists across the whole run (never reset per combat); only rest/stabilizer reduce it,
// and never below the equipped "floor" (바닥 = sum of implant costs, fixed for the run since
// the warehouse is inaccessible mid-run). In combat, exceeding 100 is no longer instant death —
// combatEngine.js inserts curse cards proportional to the excess instead (this combat only).
// isLethalOverload/OVERLOAD_MAX still gate the facility map (runEngine.js): map actions that
// would push overload over 100 are meant to be pre-emptively disabled in the UI, and this stays
// as a defensive backstop for the map's meltdown-ending-the-run path.
export const OVERLOAD_MAX = 100;

/**
 * 3단계: 0(노멀) 0-29, 1(강화·예열) 30-69, 2(강화+페널티·과열) 70 이상(100 초과분은 여기서
 * 더 오르지 않고 combatEngine.js의 저주 카드 삽입으로 처리된다 — 더 이상 즉사 조건이 아니다).
 * @param {number} overload
 * @returns {0|1|2}
 */
export function getStage(overload) {
  if (overload >= 70) return 2;
  if (overload >= 30) return 1;
  return 0;
}

/** @param {number} overload @returns {boolean} */
export function isLethalOverload(overload) {
  return overload >= OVERLOAD_MAX;
}

/**
 * @param {number} overload
 * @param {number} amount
 * @param {number} [gainMultiplier]
 * @returns {number}
 */
export function gainOverload(overload, amount, gainMultiplier = 1) {
  return overload + Math.round(amount * gainMultiplier);
}

/**
 * @param {number} overload
 * @param {number} amount
 * @param {number} floorOverload
 * @returns {number}
 */
export function reduceOverload(overload, amount, floorOverload) {
  return Math.max(floorOverload, overload - amount);
}

/**
 * Shared "기본 카드 공통 단계 공식" (기획서 §4.2 / §16): stage 1(강화·예열)과 2(강화+페널티·
 * 과열) 모두 +25%(반올림) 보정을 받고, stage 0(노멀)만 원래 수치를 쓴다. stage 2의 "페널티"는
 * 이 보정과 별개로 combatEngine.js의 카드 코스트 +1로 처리된다. scalesWithStage가 꺼진 카드
 * (뽑기·저주·상태 전용 등)는 보정하지 않는다.
 * @param {number} baseValue
 * @param {number} stage
 * @param {boolean} scalesWithStage
 * @param {number} [coefficient]
 * @returns {number}
 */
export function applyStageScale(baseValue, stage, scalesWithStage, coefficient = 0.25) {
  if (!scalesWithStage) return baseValue;
  if (stage === 1 || stage === 2) return Math.round(baseValue * (1 + coefficient));
  return baseValue;
}
