import { shuffle, nextInt } from './rng.js';

/** @typedef {import('./types.js').RngState} RngState */
/** @typedef {import('./types.js').CardInstance} CardInstance */
/** @typedef {import('./types.js').Piles} Piles */

// Module-global monotonic counter — unique within a process, but NOT a pure function of game
// state. That's fine: combat state (the only place instanceIds live) never survives into a
// snapshot that gets deepEqual-compared across independent runs (it's cleared at combat end).
// Never derive anything outside combat from an instanceId's exact value.
let instanceCounter = 0;
/** @returns {string} */
function nextInstanceId() {
  instanceCounter += 1;
  return `card-${instanceCounter}`;
}

/**
 * @param {string} defId
 * @param {string} [itemId]
 * @returns {CardInstance}
 */
export function createCardInstance(defId, itemId) {
  const instance = { instanceId: nextInstanceId(), defId };
  if (itemId) instance.itemId = itemId;
  return instance;
}

/**
 * entries: [{defId}] for ordinary cards, or [{defId, itemId}] for loot-linked curse cards
 * (junk_item/currency_item) whose playability depends on that specific inventory item's
 * burden status — see inventoryEngine.isItemBurdenGivenOrder.
 * @param {{defId: string, itemId?: string}[]} entries
 * @returns {CardInstance[]}
 */
export function buildDeck(entries) {
  return entries.map((entry) => createCardInstance(entry.defId, entry.itemId));
}

/** @returns {Piles} */
export function createEmptyPiles() {
  return { drawPile: [], hand: [], discardPile: [], exhaustPile: [] };
}

/**
 * @param {Piles} piles
 * @param {CardInstance[]} deck
 * @param {RngState} rngState
 * @returns {{piles: Piles, rngState: RngState}}
 */
export function shuffleIntoDrawPile(piles, deck, rngState) {
  const { value: drawPile, state } = shuffle(rngState, deck);
  return { piles: { ...piles, drawPile, hand: [], discardPile: [], exhaustPile: [] }, rngState: state };
}

/**
 * @param {Piles} piles
 * @param {RngState} rngState
 * @returns {{piles: Piles, rngState: RngState}}
 */
function reshuffleDiscardIntoDraw(piles, rngState) {
  if (piles.discardPile.length === 0) return { piles, rngState };
  const { value: drawPile, state } = shuffle(rngState, piles.discardPile);
  return { piles: { ...piles, drawPile, discardPile: [] }, rngState: state };
}

/**
 * @param {Piles} piles
 * @param {number} count
 * @param {RngState} rngState
 * @returns {{piles: Piles, rngState: RngState}}
 */
export function drawCards(piles, count, rngState) {
  let currentPiles = piles;
  let currentRng = rngState;
  for (let i = 0; i < count; i++) {
    if (currentPiles.drawPile.length === 0) {
      const reshuffled = reshuffleDiscardIntoDraw(currentPiles, currentRng);
      currentPiles = reshuffled.piles;
      currentRng = reshuffled.rngState;
      if (currentPiles.drawPile.length === 0) break;
    }
    const [card, ...restDraw] = currentPiles.drawPile;
    currentPiles = { ...currentPiles, drawPile: restDraw, hand: [...currentPiles.hand, card] };
  }
  return { piles: currentPiles, rngState: currentRng };
}

/**
 * @param {Piles} piles
 * @param {string} instanceId
 * @returns {?{card: CardInstance, piles: Piles}}
 */
export function removeFromHand(piles, instanceId) {
  const card = piles.hand.find((c) => c.instanceId === instanceId);
  if (!card) return null;
  return { card, piles: { ...piles, hand: piles.hand.filter((c) => c.instanceId !== instanceId) } };
}

/**
 * @param {Piles} piles
 * @param {CardInstance} card
 * @returns {Piles}
 */
export function moveToDiscard(piles, card) {
  return { ...piles, discardPile: [...piles.discardPile, card] };
}

/**
 * @param {Piles} piles
 * @param {CardInstance} card
 * @returns {Piles}
 */
export function moveToExhaust(piles, card) {
  return { ...piles, exhaustPile: [...piles.exhaustPile, card] };
}

/** @param {Piles} piles @returns {Piles} */
export function discardHand(piles) {
  return { ...piles, hand: [], discardPile: [...piles.discardPile, ...piles.hand] };
}

/**
 * Used for monster-inserted curses (점액/공물) — always lands in the discard pile so it's
 * drawn naturally on a future turn, same as STS-style curse insertion.
 * @param {Piles} piles
 * @param {string} defId
 * @returns {Piles}
 */
export function insertCardToDiscard(piles, defId) {
  return { ...piles, discardPile: [...piles.discardPile, createCardInstance(defId)] };
}

/**
 * @param {Piles} piles
 * @param {RngState} rngState
 * @returns {{piles: Piles, rngState: RngState}}
 */
export function discardRandomFromHand(piles, rngState) {
  if (piles.hand.length === 0) return { piles, rngState };
  const { value: index, state } = nextInt(rngState, piles.hand.length);
  const card = piles.hand[index];
  const nextHand = piles.hand.filter((_, i) => i !== index);
  return { piles: { ...piles, hand: nextHand, discardPile: [...piles.discardPile, card] }, rngState: state };
}
