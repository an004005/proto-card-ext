// Small derived-signal helpers so components don't reach into activeCombatState's shape
// directly. All values are re-derived automatically whenever snapshotSignal changes.
import { computed } from '../lib.js';
import { snapshotSignal } from './runState.js';

export const combatStateSignal = computed(() => snapshotSignal.value.activeCombatState);
export const handSignal = computed(() => combatStateSignal.value?.piles.hand ?? []);
export const enemiesSignal = computed(() => combatStateSignal.value?.enemies ?? []);
export const playerCombatSignal = computed(() => combatStateSignal.value?.player ?? null);
export const overloadActiveSignal = computed(() => !!combatStateSignal.value?.overloadActive);
export const combatSummarySignal = computed(() => snapshotSignal.value.combatSummary);
export const pileCountsSignal = computed(() => {
  const combat = combatStateSignal.value;
  if (!combat) return { draw: 0, discard: 0, exhaust: 0 };
  return {
    draw: combat.piles.drawPile.length,
    discard: combat.piles.discardPile.length,
    exhaust: combat.piles.exhaustPile.length,
  };
});
