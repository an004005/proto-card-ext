import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRngState } from '../src/engine/rng.js';
import {
  buildDeck, createEmptyPiles, shuffleIntoDrawPile, drawCards, discardHand,
  removeFromHand, moveToDiscard, discardRandomFromHand, insertCardToDiscard,
} from '../src/engine/cardEngine.js';

function entries(defIds) {
  return defIds.map((defId) => ({ defId }));
}

test('drawCards reshuffles discard into draw pile when the draw pile empties', () => {
  const deck = buildDeck(entries(['katana_slash', 'katana_slash', 'katana_parry']));
  const shuffled = shuffleIntoDrawPile(createEmptyPiles(), deck, createRngState(1));
  let piles = shuffled.piles;
  let rng = shuffled.rngState;

  const first = drawCards(piles, 3, rng);
  piles = first.piles; rng = first.rngState;
  assert.equal(piles.hand.length, 3);
  assert.equal(piles.drawPile.length, 0);

  piles = discardHand(piles);
  const second = drawCards(piles, 2, rng);
  assert.equal(second.piles.hand.length, 2);
  assert.equal(second.piles.drawPile.length, 1);
});

test('buildDeck carries an itemId onto the resulting card instance (loot cards)', () => {
  const deck = buildDeck([{ defId: 'junk_item', itemId: 'item-7' }]);
  assert.equal(deck[0].defId, 'junk_item');
  assert.equal(deck[0].itemId, 'item-7');
});

test('removeFromHand + moveToDiscard moves a specific card by instanceId', () => {
  const deck = buildDeck(entries(['katana_slash', 'katana_parry']));
  const shuffled = shuffleIntoDrawPile(createEmptyPiles(), deck, createRngState(2));
  const drawn = drawCards(shuffled.piles, 2, shuffled.rngState);
  const target = drawn.piles.hand[0];
  const removal = removeFromHand(drawn.piles, target.instanceId);
  const discarded = moveToDiscard(removal.piles, removal.card);
  assert.equal(discarded.discardPile.length, 1);
  assert.equal(discarded.discardPile[0].instanceId, target.instanceId);
});

test('discardRandomFromHand moves exactly one card from hand to discard', () => {
  const deck = buildDeck(entries(['katana_slash', 'katana_slash', 'katana_slash']));
  const shuffled = shuffleIntoDrawPile(createEmptyPiles(), deck, createRngState(5));
  const drawn = drawCards(shuffled.piles, 3, shuffled.rngState);
  const result = discardRandomFromHand(drawn.piles, drawn.rngState);
  assert.equal(result.piles.hand.length, 2);
  assert.equal(result.piles.discardPile.length, 1);
});

test('insertCardToDiscard adds a fresh instance directly into the discard pile (monster curses)', () => {
  const piles = insertCardToDiscard(createEmptyPiles(), 'mucus_curse');
  assert.equal(piles.discardPile.length, 1);
  assert.equal(piles.discardPile[0].defId, 'mucus_curse');
});
