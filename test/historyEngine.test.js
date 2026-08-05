import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, pushEntry, undo, redo, canUndo, canRedo, currentSnapshot } from '../src/engine/historyEngine.js';

test('undo restores the exact "before" snapshot and redo restores "after"', () => {
  let history = createHistory({ n: 0 });
  history = pushEntry(history, { type: 'INC' }, '+1', { n: 0 }, { n: 1 });
  history = pushEntry(history, { type: 'INC' }, '+1', { n: 1 }, { n: 2 });
  assert.deepEqual(currentSnapshot(history), { n: 2 });

  const undo1 = undo(history);
  assert.deepEqual(undo1.snapshot, { n: 1 });
  history = undo1.history;

  const undo2 = undo(history);
  assert.deepEqual(undo2.snapshot, { n: 0 });
  history = undo2.history;
  assert.equal(canUndo(history), false);

  const redo1 = redo(history);
  assert.deepEqual(redo1.snapshot, { n: 1 });
});

test('new command after undo discards the redo branch', () => {
  let history = createHistory({ n: 0 });
  history = pushEntry(history, { type: 'INC' }, '+1', { n: 0 }, { n: 1 });
  history = pushEntry(history, { type: 'INC' }, '+1', { n: 1 }, { n: 2 });
  const undone = undo(history);
  history = undone.history;
  assert.equal(canRedo(history), true);

  history = pushEntry(history, { type: 'DEC' }, '-1', { n: 1 }, { n: 0 });
  assert.equal(canRedo(history), false);
  assert.equal(history.entries.length, 2);
  assert.deepEqual(currentSnapshot(history), { n: 0 });
});

test('cursor -1 means the base snapshot is current', () => {
  const history = createHistory({ n: 5 });
  assert.equal(canUndo(history), false);
  assert.deepEqual(currentSnapshot(history), { n: 5 });
});
