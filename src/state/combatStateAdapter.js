// Small derived-signal helpers so components don't reach into activeCombatState's shape
// directly. All values are re-derived automatically whenever snapshotSignal changes.
import { computed } from '../lib.js';
import { snapshotSignal } from './runState.js';
import { getStage } from '../engine/overloadEngine.js';

export const combatStateSignal = computed(() => snapshotSignal.value.activeCombatState);
export const handSignal = computed(() => combatStateSignal.value?.piles.hand ?? []);
export const enemiesSignal = computed(() => combatStateSignal.value?.enemies ?? []);
export const playerCombatSignal = computed(() => combatStateSignal.value?.player ?? null);
export const overloadStageSignal = computed(() => {
  const combat = combatStateSignal.value;
  return combat ? getStage(combat.overload) : 0;
});
export const pileCountsSignal = computed(() => {
  const combat = combatStateSignal.value;
  if (!combat) return { draw: 0, discard: 0, exhaust: 0 };
  return {
    draw: combat.piles.drawPile.length,
    discard: combat.piles.discardPile.length,
    exhaust: combat.piles.exhaustPile.length,
  };
});
