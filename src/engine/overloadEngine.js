// Overload (과부화) — the run-level meta resource that stands in for STS's card-upgrade tier.
// It persists across the whole run (never reset per combat); only rest/stabilizer reduce it,
// and never below the equipped "floor" (바닥 = sum of implant costs, fixed for the run since
// the warehouse is inaccessible mid-run). In combat, exceeding 100 is no longer instant death —
// combatEngine.js clamps it back down to 100 and inserts status cards proportional to the excess
// instead (drawPile, this combat only), so combat-scoped overload is never stored above 100.
// On the facility map there is no meltdown/run-ending state at all anymore: MapScreen.js
// pre-emptively disables any action that would push overload over 100, so it never actually gets
// there. isLethalOverload/OVERLOAD_MAX below are unused dead code left over from when the map
// did end the run at 100 — kept only because nothing currently forces their removal.
export const OVERLOAD_MAX = 100;

/**
 * 3단계: 0(노멀) 0-29, 1(강화·예열) 30-69, 2(강화+페널티·과열) 70 이상(100 초과분은 여기서
 * 더 오르지 않고 combatEngine.js의 상태이상 카드 삽입으로 처리된다 — 더 이상 즉사 조건이 아니다).
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
 * Shared non-damage stage formula (docs/game-rules.md): stage 1 and 2 both receive a +25%
 * rounded adjustment, while stage 0 uses the original value. Damage uses its own ceil rule in
 * statusEngine.js. Stage 2's cost penalty is handled separately in combatEngine.js.
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
