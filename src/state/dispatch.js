// The only place allowed to write to historySignal/snapshotSignal. Wraps the pure
// gameReducer + historyEngine with the debug undo/redo log (see PLAN.md "플레이 로그").
import {
  createHistory, pushEntry, undo as undoHistory, redo as redoHistory,
  canUndo as canUndoHistory, canRedo as canRedoHistory, currentSnapshot,
} from '../engine/historyEngine.js';
import { gameReducer } from '../engine/gameReducer.js';
import { historySignal, snapshotSignal, combatAnimationSignal, combatPlaybackDurationSignal } from './runState.js';
import { buildCombatTimeline } from './combatTimeline.js';

let playbackTimer = null;
let playbackActive = false;
const queuedCombatCommands = [];

function isCombatCommand(command, snapshot) {
  return !!snapshot.activeCombatState && ['PLAY_CARD', 'END_TURN', 'USE_CONSUMABLE'].includes(command.type);
}

function stopPlayback(clearQueue = false) {
  if (playbackTimer) clearTimeout(playbackTimer);
  playbackTimer = null;
  playbackActive = false;
  combatAnimationSignal.value = null;
  if (clearQueue) queuedCombatCommands.length = 0;
}

function appendTimeline(history, command, before, timeline) {
  const entries = history.entries.slice(0, history.cursor + 1);
  let previous = before;
  for (const step of timeline) {
    entries.push({ id: entries.length, command, summary: step.animation.label, before: previous, after: step.after, animation: step.animation });
    previous = step.after;
  }
  return { ...history, entries, cursor: history.cursor };
}

function playNextStep() {
  const history = historySignal.value;
  if (history.cursor >= history.entries.length - 1) {
    stopPlayback();
    const next = queuedCombatCommands.shift();
    if (next) dispatch(next);
    return;
  }
  const nextEntry = history.entries[history.cursor + 1];
  historySignal.value = { ...history, cursor: history.cursor + 1 };
  snapshotSignal.value = nextEntry.after;
  combatAnimationSignal.value = nextEntry.animation || null;
  playbackTimer = setTimeout(playNextStep, combatPlaybackDurationSignal.value);
}

function summarize(command, before) {
  switch (command.type) {
    case 'NEW_RUN': return `NEW_RUN (seed ${command.seed})`;
    case 'SET_LOADOUT_SLOT': return `SET_LOADOUT_SLOT ${command.slotType}:${command.id}`;
    case 'CONFIRM_LOADOUT': return 'CONFIRM_LOADOUT';
    case 'AUTO_EQUIP_LOADOUT': return 'AUTO_EQUIP_LOADOUT';
    case 'ENTER_MAP_NODE': return `ENTER_MAP_NODE ${command.nodeId}`;
    case 'RESOLVE_UNKNOWN_ROOM_CHOICE': return `RESOLVE_UNKNOWN_ROOM_CHOICE ${command.choice}`;
    case 'PLAY_CARD': {
      const card = before.activeCombatState?.piles.hand.find((c) => c.instanceId === command.instanceId);
      return `PLAY_CARD ${card ? card.defId : command.instanceId}`;
    }
    case 'END_TURN': return 'END_TURN';
    case 'USE_CONSUMABLE': return `USE_CONSUMABLE ${command.itemId}`;
    case 'SELECT_REWARD': return `SELECT_REWARD ${command.slotKey}:${command.optionIndex}`;
    case 'CONFIRM_REWARDS': return 'CONFIRM_REWARDS';
    case 'EQUIP_ITEM': return `EQUIP_ITEM ${command.itemId}`;
    case 'EQUIP_ITEM_FROM_WAREHOUSE': return `EQUIP_ITEM_FROM_WAREHOUSE ${command.itemId}`;
    case 'UNEQUIP_ITEM': return `UNEQUIP_ITEM ${command.equipmentId}`;
    case 'UNEQUIP_CONSUMABLE': return `UNEQUIP_CONSUMABLE ${command.itemId}`;
    case 'MOVE_TO_INVENTORY': return `MOVE_TO_INVENTORY ${command.itemId}`;
    case 'MOVE_TO_WAREHOUSE': return `MOVE_TO_WAREHOUSE ${command.itemId}`;
    case 'DISCARD_ITEM': return `DISCARD_ITEM ${command.itemId}`;
    default: return command.type;
  }
}

export function dispatch(command) {
  const before = currentSnapshot(historySignal.value);

  if (playbackActive && isCombatCommand(command, before)) {
    queuedCombatCommands.push(command);
    return;
  }

  if (command.type === 'NEW_RUN') {
    stopPlayback(true);
    const after = gameReducer(before, command);
    historySignal.value = createHistory(after);
    snapshotSignal.value = after;
    return;
  }

  if (isCombatCommand(command, before)) {
    const timeline = buildCombatTimeline(before, command);
    if (timeline.length > 0) {
      historySignal.value = appendTimeline(historySignal.value, command, before, timeline);
      playbackActive = true;
      playNextStep();
      return;
    }
  }

  const after = gameReducer(before, command);
  if (after === before) return; // no-op action: nothing changed, nothing to log

  historySignal.value = pushEntry(historySignal.value, command, summarize(command, before), before, after);
  snapshotSignal.value = after;
}

export function undo() {
  stopPlayback(true);
  const result = undoHistory(historySignal.value);
  historySignal.value = result.history;
  snapshotSignal.value = result.snapshot;
}

export function redo() {
  stopPlayback(true);
  const result = redoHistory(historySignal.value);
  historySignal.value = result.history;
  snapshotSignal.value = result.snapshot;
}

export function canUndo() {
  return canUndoHistory(historySignal.value);
}

export function canRedo() {
  return canRedoHistory(historySignal.value);
}
