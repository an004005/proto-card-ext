// 전투 승리 후 보상 화면 커맨드(§신규, 기존 3택1 post_combat 화면 대체) — gameReducer.js의
// 책임 분리(§코드 리뷰) 중 보상 묶음.
import { rollRewardSlots, rollLootDurability } from './rewardEngine.js';
import { addItem, createItem, addAmmo } from './inventoryEngine.js';
import { getAllEquipmentIds } from './inventoryReducer.js';

/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */

/**
 * @param {GameSnapshot} snapshot
 * @param {'normal'|'elite'} tier
 * @returns {GameSnapshot}
 */
export function startReward(snapshot, tier) {
  const { slots, rngState } = rollRewardSlots(tier, getAllEquipmentIds(), snapshot.rngState);
  return {
    ...snapshot, rngState,
    pendingReward: { slots, selections: {}, nodeId: null, tier },
    combatContext: null,
    currentScreen: 'reward',
  };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} slotKey
 * @param {number} optionIndex
 * @returns {GameSnapshot}
 */
export function selectReward(snapshot, slotKey, optionIndex) {
  if (snapshot.currentScreen !== 'reward' || !snapshot.pendingReward) return snapshot;
  const selections = { ...snapshot.pendingReward.selections };
  if (selections[slotKey] === optionIndex) delete selections[slotKey];
  else selections[slotKey] = optionIndex;
  return { ...snapshot, pendingReward: { ...snapshot.pendingReward, selections } };
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function confirmRewards(snapshot) {
  if (snapshot.currentScreen !== 'reward' || !snapshot.pendingReward) return snapshot;
  const { slots, selections } = snapshot.pendingReward;
  let ps = snapshot.playerState;
  let inventory = ps.inventory;
  let rng = snapshot.rngState;

  for (const slot of slots) {
    const idx = selections[slot.key];
    if (idx === undefined) continue;
    const opt = slot.options[idx];
    if (!opt) continue;
    if (opt.kind === 'equipment') {
      const rolled = rollLootDurability(rng);
      rng = rolled.state;
      inventory = addItem(inventory, createItem('equipment', { equipmentId: opt.equipmentId, durability: rolled.value }));
    } else if (opt.kind === 'currency') inventory = addItem(inventory, createItem('currency', { value: opt.value }));
    else if (opt.kind === 'junk') inventory = addItem(inventory, createItem('junk', { value: opt.value }));
    // kind별로 채워지는 필드가 갈리므로(RewardOption) `?? 0`은 타입만 좁힌다.
    else if (opt.kind === 'ammo') inventory = addAmmo(inventory, opt.amount ?? 0);
    else if (opt.kind === 'consumable') inventory = addItem(inventory, createItem('consumable', { defId: opt.defId }));
  }

  ps = { ...ps, inventory };
  return { ...snapshot, playerState: ps, pendingReward: null, rngState: rng, combatSummary: null, currentScreen: 'map' };
}
