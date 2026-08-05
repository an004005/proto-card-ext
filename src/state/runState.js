import { signal } from '../lib.js';
import { gameReducer } from '../engine/gameReducer.js';
import { createHistory } from '../engine/historyEngine.js';

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff);
}

const initialSnapshot = gameReducer(null, { type: 'NEW_RUN', seed: randomSeed() });

// historySignal is the source of truth; snapshotSignal always mirrors historyEngine's
// currentSnapshot(historySignal.value) so components can read game state without importing
// historyEngine themselves. Both are only ever written from state/dispatch.js.
export const historySignal = signal(createHistory(initialSnapshot));
export const snapshotSignal = signal(initialSnapshot);
