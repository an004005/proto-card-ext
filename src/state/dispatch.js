// The only place allowed to write to historySignal/snapshotSignal. Wraps the pure
// gameReducer + historyEngine with the debug undo/redo log (see PLAN.md "플레이 로그").
import {
  createHistory, pushEntry, undo as undoHistory, redo as redoHistory,
  canUndo as canUndoHistory, canRedo as canRedoHistory, currentSnapshot,
} from '../engine/historyEngine.js';
import { gameReducer } from '../engine/gameReducer.js';
import { historySignal, snapshotSignal } from './runState.js';

function summarize(command, before) {
  switch (command.type) {
    case 'NEW_RUN': return `NEW_RUN (seed ${command.seed})`;
    case 'SET_LOADOUT_SLOT': return `SET_LOADOUT_SLOT ${command.slotType}:${command.id}`;
    case 'CONFIRM_LOADOUT': return 'CONFIRM_LOADOUT';
    case 'ENTER_MAP_NODE': return `ENTER_MAP_NODE ${command.nodeId}`;
    case 'RESOLVE_UNKNOWN_ROOM_CHOICE': return `RESOLVE_UNKNOWN_ROOM_CHOICE ${command.choice}`;
    case 'PLAY_CARD': {
      const card = before.activeCombatState?.piles.hand.find((c) => c.instanceId === command.instanceId);
      return `PLAY_CARD ${card ? card.defId : command.instanceId}`;
    }
    case 'END_TURN': return 'END_TURN';
    case 'USE_CONSUMABLE': return `USE_CONSUMABLE ${command.defId}`;
    case 'SELECT_REWARD': return `SELECT_REWARD ${command.slotKey}:${command.optionIndex}`;
    case 'CONFIRM_REWARDS': return 'CONFIRM_REWARDS';
    case 'EQUIP_ITEM': return `EQUIP_ITEM ${command.itemId}`;
    case 'UNEQUIP_ITEM': return `UNEQUIP_ITEM ${command.equipmentId}`;
    case 'DISCARD_ITEM': return `DISCARD_ITEM ${command.itemId}`;
    default: return command.type;
  }
}

export function dispatch(command) {
  const before = currentSnapshot(historySignal.value);

  if (command.type === 'NEW_RUN') {
    const after = gameReducer(before, command);
    historySignal.value = createHistory(after);
    snapshotSignal.value = after;
    return;
  }

  const after = gameReducer(before, command);
  if (after === before) return; // no-op action: nothing changed, nothing to log

  historySignal.value = pushEntry(historySignal.value, command, summarize(command, before), before, after);
  snapshotSignal.value = after;
}

export function undo() {
  const result = undoHistory(historySignal.value);
  historySignal.value = result.history;
  snapshotSignal.value = result.snapshot;
}

export function redo() {
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
