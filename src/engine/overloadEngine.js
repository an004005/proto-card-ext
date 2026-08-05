// Overload (과부화) — the run-level meta resource that stands in for STS's card-upgrade tier.
// It persists across the whole run (never reset per combat); only rest/stabilizer reduce it,
// and never below the equipped "floor" (바닥 = sum of implant costs, fixed for the run since
// the warehouse is inaccessible mid-run). 100 = instant death, no safety net (기획서 §4).
export const OVERLOAD_MAX = 100;

// stage 0: 0-24, 1: 25-49, 2: 50-74, 3: 75-99, 4 (dead): 100+
export function getStage(overload) {
  if (overload >= 100) return 4;
  if (overload >= 75) return 3;
  if (overload >= 50) return 2;
  if (overload >= 25) return 1;
  return 0;
}

export function isLethalOverload(overload) {
  return overload >= OVERLOAD_MAX;
}

export function gainOverload(overload, amount, gainMultiplier = 1) {
  return overload + Math.round(amount * gainMultiplier);
}

export function reduceOverload(overload, amount, floorOverload) {
  return Math.max(floorOverload, overload - amount);
}

// Shared "기본 카드 공통 단계 공식" (기획서 §4.2 / §16): stage 1-2 add +25% (rounded), stage
// 0 and 3 both use the raw base value ("3단계는 원래 수치로 회귀"). Only applies to cards
// flagged scalesWithStage — non-numeric effects (draw, curse, status-only) never scale.
export function applyStageScale(baseValue, stage, scalesWithStage, coefficient = 0.25) {
  if (!scalesWithStage) return baseValue;
  if (stage === 1 || stage === 2) return Math.round(baseValue * (1 + coefficient));
  return baseValue;
}
