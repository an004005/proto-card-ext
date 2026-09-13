import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInventory, addItem, removeItem, createItem, getCoreItems, getBurdenItems, isBurdenId,
  isItemBurdenGivenOrder, addAmmo, getUsableAmmo, spendAmmo,
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

test('addAmmo tops off an existing partial stack before starting a new 10-round stack', () => {
  let inv = createInventory(10);
  inv = addAmmo(inv, 7);
  assert.deepEqual(inv.items.map((i) => i.amount), [7]);
  inv = addAmmo(inv, 5); // fills the 7 -> 10, remaining 2 starts a new stack
  assert.deepEqual(inv.items.map((i) => i.amount), [10, 2]);
});

test('addAmmo creates full 10-round stacks for amounts over the stack size', () => {
  let inv = createInventory(10);
  inv = addAmmo(inv, 23);
  assert.deepEqual(inv.items.map((i) => i.amount), [10, 10, 3]);
});

test('getUsableAmmo only counts core (non-burden) ammo stacks', () => {
  let inv = createInventory(1);
  inv = addAmmo(inv, 10); // core
  inv = addAmmo(inv, 4); // burden (2nd item, capacity 1)
  assert.equal(getUsableAmmo(inv), 10);
});

test('spendAmmo drains core stacks in order and removes emptied stacks', () => {
  let inv = createInventory(10);
  inv = addAmmo(inv, 10);
  inv = addAmmo(inv, 6);
  inv = spendAmmo(inv, 12);
  assert.deepEqual(inv.items.map((i) => i.amount), [4]);
  assert.equal(getUsableAmmo(inv), 4);
});

// ---- id 발급 규칙 (리뷰 A4) ----

test('addAmmo가 만든 새 스택도 컬렉션의 idPrefix를 따른다', () => {
  const warehouse = addAmmo(createInventory(10, 'wh-item'), 25);
  assert.equal(warehouse.items.length, 3);
  for (const item of warehouse.items) assert.match(item.id, /^wh-item-\d+$/, `id가 접두사를 안 따른다: ${item.id}`);
  assert.equal(warehouse.nextItemId, 4);
});

test('addAmmo가 만든 id는 addItem이 만드는 id와 충돌하지 않는다', () => {
  let inv = createInventory(10, 'wh-item');
  inv = addAmmo(inv, 10);
  inv = addItem(inv, createItem('junk', { value: 5 }));
  const ids = inv.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, `id가 겹친다: ${ids.join(',')}`);
});

test('addItem은 넘겨받은 객체의 id를 항상 버리고 컬렉션 규칙대로 다시 발급한다', () => {
  const inv = addItem(createInventory(10, 'inv'), { id: 'wh-item-99', kind: 'junk', value: 3 });
  assert.equal(inv.items[0].id, 'inv-1');
});
