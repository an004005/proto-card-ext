// Inventory / 과적(overcapacity) / 짐(burden) (기획서 §6). 30 (+임플란트③) slots, no
// weight, no stacking — 1 item = 1 card. Items beyond capacity, in acquisition order, are
// "burden": still occupies a deck slot as a curse card, but that card becomes playable
// (cost 1) to permanently discard the item.
export function createInventory(capacity) {
  // nextItemId lives on the inventory itself (not module-level mutable state) so item ids stay
  // a pure function of prior state — required for the same seed to always reproduce the same
  // run, including item ids, under headless replay.
  return { capacity, items: [], nextItemId: 1 }; // items: [{ id, kind:'junk'|'currency'|'equipment', value, equipmentId? }]
}

// Returns a partial item (no id yet) — addItem assigns the id from inventory.nextItemId.
export function createItem(kind, extra = {}) {
  return { kind, ...extra };
}

export function addItem(inventory, item) {
  const id = `item-${inventory.nextItemId}`;
  return { ...inventory, nextItemId: inventory.nextItemId + 1, items: [...inventory.items, { id, ...item }] };
}

export function removeItem(inventory, itemId) {
  return { ...inventory, items: inventory.items.filter((i) => i.id !== itemId) };
}

export function getCoreItems(inventory) {
  return inventory.items.slice(0, inventory.capacity);
}

export function getBurdenItems(inventory) {
  return inventory.items.slice(inventory.capacity);
}

export function isBurdenId(inventory, itemId) {
  return getBurdenItems(inventory).some((i) => i.id === itemId);
}

// Combat needs to know burden status live (removing a burden item mid-combat can promote the
// next-oldest overflow item to "core"), without owning the inventory itself. Combat is handed
// an ordered snapshot of item ids at creation time and tracks which have since been removed;
// this recomputes burden status purely from that pair, matching inventoryEngine's own rule.
export function isItemBurdenGivenOrder(orderedItemIds, removedItemIds, capacity, itemId) {
  const remaining = orderedItemIds.filter((id) => !removedItemIds.includes(id));
  const index = remaining.indexOf(itemId);
  return index >= capacity;
}
