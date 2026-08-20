import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer } from '../src/engine/gameReducer.js';
import { addItem, createItem } from '../src/engine/inventoryEngine.js';

test('AUTO_EQUIP_LOADOUT fills all empty slots from the warehouse', () => {
  let state = gameReducer(null, { type: 'NEW_RUN', seed: 7 });
  state = gameReducer(state, { type: 'AUTO_EQUIP_LOADOUT' });
  const { loadout } = state.playerState;
  assert.equal(loadout.weapons.length, 2);
  assert.ok(loadout.top);
  assert.ok(loadout.bottom);
  assert.equal(loadout.modules.length, 2);
  assert.equal(loadout.implantIds.length, 3);
  assert.equal(loadout.consumableSlots.filter(Boolean).length, 3);
});

test('AUTO_EQUIP_LOADOUT prefers an eligible inventory item before warehouse items', () => {
  let state = gameReducer(null, { type: 'NEW_RUN', seed: 7 });
  const item = createItem('equipment', { equipmentId: 'pistol', durability: 10 });
  state = { ...state, playerState: { ...state.playerState, inventory: addItem(state.playerState.inventory, item) } };
  state = gameReducer(state, { type: 'AUTO_EQUIP_LOADOUT' });
  assert.ok(state.playerState.loadout.weapons.some((w) => w.equipmentId === 'pistol'));
});
