// 런 종료 화면(GameOverScreen/ExtractionCompleteScreen) 공통 로직.
import { dispatch } from '../state/dispatch.js';

export { computeContractOutcome } from '../engine/contractReducer.js';

/** @param {import('../engine/types.js').Inventory} inventory @returns {number} */
export function computeInventoryScore(inventory) {
  return inventory.items.reduce((sum, i) => sum + (i.value || 0), 0);
}

export function startNewRun() {
  dispatch({ type: 'NEW_RUN', seed: Math.floor(Math.random() * 0xffffffff) });
}
