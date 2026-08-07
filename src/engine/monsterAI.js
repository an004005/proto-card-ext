// Fixed, looping scripted sequences (§14) with an added `random` branch type: a sequence entry
// can be `{ random: [{ weight, move }, ...] }` instead of a plain move. Random branches are
// resolved exactly once — when the aiState first points at that entry (initial spawn, or when
// advanceAiState moves the cursor onto it) — and the picked move is cached on the aiState as
// `resolvedMove`. This guarantees the intent shown to the player always matches what actually
// executes: both createEnemyInstance's initial intent and executeEnemyAction's later execution
// call currentMove() against the SAME aiState, so they read the SAME cached resolvedMove.
import { weightedPick } from './rng.js';
import { MONSTER_DEFINITIONS } from '../data/monsters.js';

/** @typedef {import('./types.js').RngState} RngState */
/** @typedef {import('./types.js').Move} Move */
/** @typedef {import('./types.js').AiState} AiState */
/** @typedef {import('./types.js').RandomMoveBranch} RandomMoveBranch */

/**
 * @param {string} defId
 * @param {1|2} phase
 * @returns {(Move|{random: RandomMoveBranch})[]}
 */
function activeSequence(defId, phase) {
  const def = MONSTER_DEFINITIONS[defId];
  return phase === 2 && def.phase2Sequence ? def.phase2Sequence : def.sequence;
}

/**
 * Resolves whatever sits at `sequence[index]` — a plain move is returned as-is (no rng
 * consumed); a `{random}` entry is rolled once via weightedPick.
 * @param {(Move|{random: RandomMoveBranch})[]} sequence
 * @param {number} index
 * @param {RngState} rngState
 * @returns {{resolvedMove: Move|undefined, rngState: RngState}}
 */
function resolveEntry(sequence, index, rngState) {
  const entry = sequence[index];
  if (!('random' in entry)) return { resolvedMove: undefined, rngState };
  const picked = weightedPick(rngState, entry.random.map((r) => ({ value: r.move, weight: r.weight })));
  return { resolvedMove: picked.value, rngState: picked.state };
}

/**
 * @param {string} defId
 * @param {number} staggerIndex
 * @param {RngState} rngState
 * @returns {{aiState: AiState, rngState: RngState}}
 */
export function createInitialAiState(defId, staggerIndex, rngState) {
  const def = MONSTER_DEFINITIONS[defId];
  const sequence = def.sequence;
  const index = staggerIndex % sequence.length;
  const resolved = resolveEntry(sequence, index, rngState);
  return { aiState: { sequenceIndex: index, resolvedMove: resolved.resolvedMove }, rngState: resolved.rngState };
}

/**
 * @param {string} defId
 * @param {AiState} aiState
 * @param {1|2} [phase]
 * @returns {Move}
 */
export function currentMove(defId, aiState, phase = 1) {
  if (aiState.resolvedMove) return aiState.resolvedMove;
  const sequence = activeSequence(defId, phase);
  const index = MONSTER_DEFINITIONS[defId].loop === false
    ? Math.min(aiState.sequenceIndex, sequence.length - 1)
    : aiState.sequenceIndex % sequence.length;
  return /** @type {Move} */ (sequence[index]);
}

/**
 * @param {string} defId
 * @param {AiState} aiState
 * @param {1|2} phase
 * @param {RngState} rngState
 * @returns {{aiState: AiState, rngState: RngState}}
 */
export function advanceAiState(defId, aiState, phase = 1, rngState) {
  const def = MONSTER_DEFINITIONS[defId];
  const sequence = activeSequence(defId, phase);
  if (def.loop === false && aiState.sequenceIndex >= sequence.length - 1) {
    return { aiState, rngState }; // parks on the final move (explode / flee) once reached
  }
  const rawNext = aiState.sequenceIndex + 1;
  const lookupIndex = def.loop === false ? Math.min(rawNext, sequence.length - 1) : rawNext % sequence.length;
  const resolved = resolveEntry(sequence, lookupIndex, rngState);
  return { aiState: { sequenceIndex: rawNext, resolvedMove: resolved.resolvedMove }, rngState: resolved.rngState };
}
