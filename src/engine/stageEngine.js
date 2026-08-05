// Fixed 10-floor progression (기획서 §13). Replaces the old branching mapEngine — floors here
// are a straight linear sequence of steps, no graph/RNG needed to build it.
import { STAGE_STEPS, UNKNOWN_ROOM_OUTCOME_WEIGHTS } from '../data/stageLayout.js';
import { weightedPick, nextInt } from './rng.js';

export function createStageState() {
  return { stepIndex: 0 };
}

export function isStageComplete(stageState) {
  return stageState.stepIndex >= STAGE_STEPS.length;
}

export function getCurrentStep(stageState) {
  if (isStageComplete(stageState)) return null;
  return STAGE_STEPS[stageState.stepIndex];
}

export function advanceStage(stageState) {
  return { ...stageState, stepIndex: stageState.stepIndex + 1 };
}

export function resolveUnknownRoomOutcome(rngState) {
  return weightedPick(rngState, UNKNOWN_ROOM_OUTCOME_WEIGHTS);
}

function getNormalMonsterPoolForFloor(floor) {
  const pool = [];
  for (const step of STAGE_STEPS) {
    if (step.floor === floor && step.type === 'combat' && !step.tier) pool.push(...step.monsterIds);
  }
  return [...new Set(pool)];
}

// 미지의 방 전투 결과: 현재 층의 일반 몬스터 풀에서 1마리 추첨 (기획서 §13.1).
export function pickUnknownRoomMonster(floor, rngState) {
  const pool = getNormalMonsterPoolForFloor(floor);
  const { value: index, state } = nextInt(rngState, pool.length);
  return { monsterId: pool[index], rngState: state };
}
