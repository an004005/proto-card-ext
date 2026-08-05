import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInventory, addItem, removeItem, createItem, getCoreItems, getBurdenItems, isBurdenId,
  isItemBurdenGivenOrder,
} from '../src/engine/inventoryEngine.js';

test('items beyond capacity, in acquisition order, are burden (§6 과적/짐)', () => {
  let inv = createInventory(2);
  inv = addItem(inv, createItem('junk'));
  inv = addItem(inv, createItem('junk'));
  inv = addItem(inv, createItem('junk'));
  const [a, b, c] = inv.items;
  assert.deepEqual(getCoreItems(inv).map((i) => i.id), [a.id, b.id]);
  assert.deepEqual(getBurdenItems(inv).map((i) => i.id), [c.id]);
  assert.equal(isBurdenId(inv, c.id), true);
  assert.equal(isBurdenId(inv, a.id), false);
});

test('removing a core item promotes the oldest burden item to core', () => {
  let inv = createInventory(1);
  inv = addItem(inv, createItem('junk'));
  inv = addItem(inv, createItem('junk'));
  const [a, b] = inv.items;
  assert.equal(isBurdenId(inv, b.id), true);
  inv = removeItem(inv, a.id);
  assert.equal(isBurdenId(inv, b.id), false);
});

test('isItemBurdenGivenOrder mirrors inventory burden rules from a combat-local snapshot', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(isItemBurdenGivenOrder(order, [], 2, 'c'), true);
  assert.equal(isItemBurdenGivenOrder(order, [], 2, 'a'), false);
  // removing 'a' shifts 'c' into a core slot
  assert.equal(isItemBurdenGivenOrder(order, ['a'], 2, 'c'), false);
});
