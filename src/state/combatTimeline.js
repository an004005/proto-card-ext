import { advanceTurnWithSteps } from '../engine/combatEngine.js';
import { gameReducer } from '../engine/gameReducer.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';

function displayMoveId(id) {
  return String(id || '행동').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Convert a player combat command into replayable snapshots.  Non-turn commands are a single
 * visible action; END_TURN is expanded into one snapshot per enemy action.
 */
export function buildCombatTimeline(before, command) {
  const finalSnapshot = gameReducer(before, command);
  if (finalSnapshot === before || !before.activeCombatState) return [];

  if (command.type === 'END_TURN') {
    const result = advanceTurnWithSteps(before.activeCombatState);
    const timeline = result.steps.map((step) => ({
      after: { ...before, activeCombatState: step.state },
      animation: { ...step, label: displayMoveId(step.label) },
    }));
    const last = timeline[timeline.length - 1];
    if (last && finalSnapshot.currentScreen === 'combat') last.after = finalSnapshot;
    else if (last) timeline.push({ after: finalSnapshot, animation: { actor: 'player', label: '전투 종료', kind: 'action' } });
    return timeline;
  }

  let label = '행동';
  let kind = 'action';
  if (command.type === 'PLAY_CARD') {
    const card = before.activeCombatState.piles.hand.find((item) => item.instanceId === command.instanceId);
    const def = card && CARD_DEFINITIONS[card.defId];
    label = def?.name || '카드 사용';
    kind = def?.type === 'attack' ? 'attack' : 'action';
  } else if (command.type === 'USE_CONSUMABLE') {
    const item = before.playerState.loadout.consumableSlots.find((slot) => slot?.id === command.itemId);
    label = item ? CONSUMABLE_DEFINITIONS[item.defId]?.name || '소모품 사용' : '소모품 사용';
  }
  return [{ after: finalSnapshot, animation: { actor: 'player', label, kind } }];
}
