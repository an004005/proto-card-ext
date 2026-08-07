// Inventory / 과적(overcapacity) / 짐(burden) (기획서 §6). 30 (+임플란트③) slots, no
// weight, no stacking — 1 item = 1 card. Items beyond capacity, in acquisition order, are
// "burden": still occupies a deck slot as a curse card, but that card becomes playable
// (cost 1) to permanently discard the item.

/** @typedef {import('./types.js').Inventory} Inventory */
/** @typedef {import('./types.js').Item} Item */

/**
 * @param {number} capacity
 * @returns {Inventory}
 */
export function createInventory(capacity) {
  // nextItemId lives on the inventory itself (not module-level mutable state) so item ids stay
  // a pure function of prior state — required for the same seed to always reproduce the same
  // run, including item ids, under headless replay.
  return { capacity, items: [], nextItemId: 1 };
}

/**
 * Returns a partial item (no id yet) — addItem assigns the id from inventory.nextItemId.
 * @param {Item['kind']} kind
 * @param {Object} [extra]
 * @returns {Omit<Item, 'id'>}
 */
export function createItem(kind, extra = {}) {
  return { kind, ...extra };
}

/**
 * @param {Inventory} inventory
 * @param {Omit<Item, 'id'>} item
 * @returns {Inventory}
 */
export function addItem(inventory, item) {
  const id = `item-${inventory.nextItemId}`;
  return { ...inventory, nextItemId: inventory.nextItemId + 1, items: [...inventory.items, { id, ...item }] };
}

/**
 * @param {Inventory} inventory
 * @param {string} itemId
 * @returns {Inventory}
 */
export function removeItem(inventory, itemId) {
  return { ...inventory, items: inventory.items.filter((i) => i.id !== itemId) };
}

/** @param {Inventory} inventory @returns {Item[]} */
export function getCoreItems(inventory) {
  return inventory.items.slice(0, inventory.capacity);
}

/** @param {Inventory} inventory @returns {Item[]} */
export function getBurdenItems(inventory) {
  return inventory.items.slice(inventory.capacity);
}

/**
 * @param {Inventory} inventory
 * @param {string} itemId
 * @returns {boolean}
 */
export function isBurdenId(inventory, itemId) {
  return getBurdenItems(inventory).some((i) => i.id === itemId);
}

/**
 * Combat needs to know burden status live (removing a burden item mid-combat can promote the
 * next-oldest overflow item to "core"), without owning the inventory itself. Combat is handed
 * an ordered snapshot of item ids at creation time and tracks which have since been removed;
 * this recomputes burden status purely from that pair, matching inventoryEngine's own rule.
 * @param {string[]} orderedItemIds
 * @param {string[]} removedItemIds
 * @param {number} capacity
 * @param {string} itemId
 * @returns {boolean}
 */
export function isItemBurdenGivenOrder(orderedItemIds, removedItemIds, capacity, itemId) {
  const remaining = orderedItemIds.filter((id) => !removedItemIds.includes(id));
  const index = remaining.indexOf(itemId);
  return index >= capacity;
}

// ---- ammo-as-inventory-item (10발 = 카드 1스택, §신규) ----
export const AMMO_STACK_SIZE = 10;

/**
 * Tops off existing partial stacks (in acquisition order) before creating new ones, so a
 * reward of e.g. 7 rounds merges into whatever partial stack is oldest rather than always
 * starting a fresh card.
 * @param {Inventory} inventory
 * @param {number} amount
 * @returns {Inventory}
 */
export function addAmmo(inventory, amount) {
  let remaining = amount;
  const items = inventory.items.map((it) => ({ ...it }));
  for (let i = 0; i < items.length && remaining > 0; i++) {
    const it = items[i];
    if (it.kind !== 'ammo' || it.amount >= AMMO_STACK_SIZE) continue;
    const add = Math.min(AMMO_STACK_SIZE - it.amount, remaining);
    items[i] = { ...it, amount: it.amount + add };
    remaining -= add;
  }
  let nextItemId = inventory.nextItemId;
  while (remaining > 0) {
    const stackAmount = Math.min(AMMO_STACK_SIZE, remaining);
    items.push({ id: `item-${nextItemId}`, kind: 'ammo', amount: stackAmount });
    nextItemId += 1;
    remaining -= stackAmount;
  }
  return { ...inventory, items, nextItemId };
}

/**
 * Only core (non-burden) ammo stacks count toward usable ammo — overflowed stacks sit as
 * unplayable curse cards (ammo_item) until discarded, same rule as junk/currency.
 * @param {Inventory} inventory
 * @returns {number}
 */
export function getUsableAmmo(inventory) {
  return getCoreItems(inventory)
    .filter((i) => i.kind === 'ammo')
    .reduce((sum, i) => sum + (i.amount || 0), 0);
}

/**
 * Spends from core ammo stacks in acquisition order, removing stacks that hit 0. Caller must
 * ensure amount <= getUsableAmmo(inventory) (combatEngine's ammoCost gate already guarantees this).
 * @param {Inventory} inventory
 * @param {number} amount
 * @returns {Inventory}
 */
export function spendAmmo(inventory, amount) {
  let remaining = amount;
  const items = inventory.items
    .map((it, index) => {
      if (remaining <= 0 || it.kind !== 'ammo' || index >= inventory.capacity) return it;
      const spend = Math.min(it.amount, remaining);
      remaining -= spend;
      return { ...it, amount: it.amount - spend };
    })
    .filter((it) => !(it.kind === 'ammo' && it.amount <= 0));
  return { ...inventory, items };
}
