// Undo/redo log. This is a debug/balancing tool exposed to the prototype player, not a game
// feature — see PLAN.md "플레이 로그 / Undo / Redo". `cursor === -1` means baseSnapshot is
// the current state (nothing applied yet).

/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */

/**
 * @typedef {Object} HistoryEntry
 * @property {number} id
 * @property {Object} command
 * @property {string} summary
 * @property {GameSnapshot} before
 * @property {GameSnapshot} after
 */

/**
 * @typedef {Object} History
 * @property {GameSnapshot} baseSnapshot
 * @property {HistoryEntry[]} entries
 * @property {number} cursor -1 means baseSnapshot is current
 */

/**
 * @param {GameSnapshot} baseSnapshot
 * @returns {History}
 */
export function createHistory(baseSnapshot) {
  return { baseSnapshot, entries: [], cursor: -1 };
}

/**
 * @param {History} history
 * @returns {GameSnapshot}
 */
export function currentSnapshot(history) {
  return history.cursor === -1 ? history.baseSnapshot : history.entries[history.cursor].after;
}

/**
 * Appending after an undo discards the redo branch (entries past cursor).
 * @param {History} history
 * @param {Object} command
 * @param {string} summary
 * @param {GameSnapshot} before
 * @param {GameSnapshot} after
 * @returns {History}
 */
export function pushEntry(history, command, summary, before, after) {
  const truncated = history.entries.slice(0, history.cursor + 1);
  const entry = { id: truncated.length, command, summary, before, after };
  return { ...history, entries: [...truncated, entry], cursor: truncated.length };
}

/** @param {History} history @returns {boolean} */
export function canUndo(history) {
  return history.cursor >= 0;
}

/** @param {History} history @returns {boolean} */
export function canRedo(history) {
  return history.cursor < history.entries.length - 1;
}

/**
 * @param {History} history
 * @returns {{history: History, snapshot: GameSnapshot}}
 */
export function undo(history) {
  if (!canUndo(history)) return { history, snapshot: currentSnapshot(history) };
  const snapshot = history.entries[history.cursor].before;
  return { history: { ...history, cursor: history.cursor - 1 }, snapshot };
}

/**
 * @param {History} history
 * @returns {{history: History, snapshot: GameSnapshot}}
 */
export function redo(history) {
  if (!canRedo(history)) return { history, snapshot: currentSnapshot(history) };
  const nextCursor = history.cursor + 1;
  const snapshot = history.entries[nextCursor].after;
  return { history: { ...history, cursor: nextCursor }, snapshot };
}
