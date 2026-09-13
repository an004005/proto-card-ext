// Overload (과부화) — a run-level ON/OFF toggle that stands in for STS's card-upgrade tier.
// It is a single boolean on playerState that persists across the whole run and carries into and
// out of combat like HP does. ON puts every stage-scaled card and module power one step up
// (단계 1 = 과부화); OFF is the plain 단계 0. Toggling is free — there is no resource to spend,
// no floor, and no gain per action (ADR-0080: the cost will arrive with the character ability).

/** 단계는 둘뿐이다 — 꺼짐(0)과 과부화(1). @param {boolean} overloadActive @returns {0|1} */
export function getStage(overloadActive) {
  return overloadActive ? 1 : 0;
}

/**
 * Shared non-damage stage formula (docs/game-rules.md): 과부화 단계는 +25% 반올림 보정을 받고,
 * 단계 0은 원래 값을 그대로 쓴다. 피해는 statusEngine.js의 올림 규칙을 따로 쓴다.
 * @param {number} baseValue
 * @param {number} stage
 * @param {boolean} scalesWithStage
 * @param {number} [coefficient]
 * @returns {number}
 */
export function applyStageScale(baseValue, stage, scalesWithStage, coefficient = 0.25) {
  if (!scalesWithStage) return baseValue;
  if (stage === 1) return Math.round(baseValue * (1 + coefficient));
  return baseValue;
}
