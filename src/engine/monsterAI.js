// All monsters here use fixed, looping scripted sequences (기획서 §14 has no "무작위" pattern
// anywhere) — no RNG needed to pick a move, just a per-enemy cursor. Enemies sharing the same
// defId in one encounter get staggered starting cursors so they act out of phase (니빗 쌍).
import { MONSTER_DEFINITIONS } from '../data/monsters.js';

export function createInitialAiState(defId, staggerIndex) {
  const def = MONSTER_DEFINITIONS[defId];
  const sequence = def.sequence;
  return { sequenceIndex: staggerIndex % sequence.length };
}

function activeSequence(defId, phase) {
  const def = MONSTER_DEFINITIONS[defId];
  return phase === 2 && def.phase2Sequence ? def.phase2Sequence : def.sequence;
}

export function currentMove(defId, aiState, phase = 1) {
  const def = MONSTER_DEFINITIONS[defId];
  const sequence = activeSequence(defId, phase);
  const index = def.loop === false
    ? Math.min(aiState.sequenceIndex, sequence.length - 1)
    : aiState.sequenceIndex % sequence.length;
  return sequence[index];
}

export function advanceAiState(defId, aiState, phase = 1) {
  const def = MONSTER_DEFINITIONS[defId];
  const sequence = activeSequence(defId, phase);
  if (def.loop === false && aiState.sequenceIndex >= sequence.length - 1) {
    return aiState; // parks on the final move (explode / flee) once reached
  }
  return { ...aiState, sequenceIndex: aiState.sequenceIndex + 1 };
}
