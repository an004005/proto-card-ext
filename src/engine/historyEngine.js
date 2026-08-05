// Undo/redo log. This is a debug/balancing tool exposed to the prototype player, not a game
// feature — see PLAN.md "플레이 로그 / Undo / Redo". `cursor === -1` means baseSnapshot is
// the current state (nothing applied yet).
export function createHistory(baseSnapshot) {
  return { baseSnapshot, entries: [], cursor: -1 };
}

export function currentSnapshot(history) {
  return history.cursor === -1 ? history.baseSnapshot : history.entries[history.cursor].after;
}

// Appending after an undo discards the redo branch (entries past cursor).
export function pushEntry(history, command, summary, before, after) {
  const truncated = history.entries.slice(0, history.cursor + 1);
  const entry = { id: truncated.length, command, summary, before, after };
  return { ...history, entries: [...truncated, entry], cursor: truncated.length };
}

export function canUndo(history) {
  return history.cursor >= 0;
}

export function canRedo(history) {
  return history.cursor < history.entries.length - 1;
}

export function undo(history) {
  if (!canUndo(history)) return { history, snapshot: currentSnapshot(history) };
  const snapshot = history.entries[history.cursor].before;
  return { history: { ...history, cursor: history.cursor - 1 }, snapshot };
}

export function redo(history) {
  if (!canRedo(history)) return { history, snapshot: currentSnapshot(history) };
  const nextCursor = history.cursor + 1;
  const snapshot = history.entries[nextCursor].after;
  return { history: { ...history, cursor: nextCursor }, snapshot };
}
