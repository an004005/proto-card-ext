// 전투 시작·진행·종료·이탈 커맨드 — gameReducer.js의 책임 분리(§코드 리뷰) 중 전투 묶음.
import { applyStatus, applyDamage } from './statusEngine.js';
import { reduceOverload } from './overloadEngine.js';
import {
  createCombatState, beginPlayerFirst, beginEnemyFirst, playCard, advanceTurn, checkWinLoss,
} from './combatEngine.js';
import { refreshLocalObservations } from './runEngine.js';
import { computeCapabilities } from './capabilityEngine.js';
import {
  applyCombatRoundTimeToRunState, applyCombatCardNoise, beginDisengage, cancelDisengage, addDisengageProgress, canDisengage,
} from './combatMapIntegration.js';
import {
  buildDeckFromLoadout, computeFloorOverload, computeOverloadGainMultiplier, getImplantEffect,
  computeMaxLoadBonus, computeDamagedStatusCardEntries, applyDurabilityDecay,
} from './equipmentEngine.js';
import { addItem, removeItem, isItemBurdenGivenOrder, getUsableAmmo, spendAmmo } from './inventoryEngine.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { BURDEN_CARD_DEF_BY_KIND, CARD_DEFINITIONS } from '../data/cards.js';
import { startReward } from './rewardReducer.js';
import { GENERATOR_COMBAT_START_ARMOR } from '../data/facilityLayout.js';

/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */
/** @typedef {import('./types.js').PlayerState} PlayerState */

/**
 * @param {PlayerState} playerState
 * @returns {{defId: string, itemId?: string, equipmentInstanceId?: string}[]}
 */
export function getDeckEntries(playerState) {
  const equipmentEntries = buildDeckFromLoadout(playerState.loadout);
  // 내구도 4 미만인 장착 장비마다 이번 전투에만 삽입되는 손상 상태이상 카드(§신규 내구도).
  const statusCardEntries = computeDamagedStatusCardEntries(playerState.loadout);
  const inv = playerState.inventory;
  const orderedIds = inv.items.map((i) => i.id);
  // 잡템·환금템·미장착 장비·탄약 모두 과적(짐) 상태로 넘어간 것만 상태이상 카드로 덱에 들어간다.
  const lootEntries = inv.items
    .filter((i) => BURDEN_CARD_DEF_BY_KIND[i.kind] && isItemBurdenGivenOrder(orderedIds, [], inv.capacity, i.id))
    .map((i) => ({ defId: BURDEN_CARD_DEF_BY_KIND[i.kind], itemId: i.id }));
  return [...equipmentEntries, ...statusCardEntries, ...lootEntries];
}

/**
 * §신규 조우 시스템: `context.ambush` — 'player'면 플레이어 기습(전 적 스턴 부여 후 정상 플레이어
 * 선공), 'enemy'면 적 기습(beginEnemyFirst, 적 선공 1턴), 생략하면 기존과 같은 평시 플레이어 선공.
 * @param {GameSnapshot} snapshot
 * @param {string[]} monsterIds
 * @param {number|undefined} hpMultiplier
 * @param {{nodeId: string, threatId?: string, ambush?: 'player'|'enemy'}} context
 * @returns {GameSnapshot}
 */
export function startCombat(snapshot, monsterIds, hpMultiplier, context) {
  const ps = snapshot.playerState;
  const loadout = ps.loadout;
  const extraDrawImplant = getImplantEffect(loadout, 'extraDrawPerTurn');
  const aoeImplant = getImplantEffect(loadout, 'turnStartAoeDamage');
  const usableAmmo = getUsableAmmo(ps.inventory);
  const maxLoad = computeMaxLoadBonus(loadout);

  let combat = createCombatState({
    deckEntries: getDeckEntries(ps), monsterIds, hpMultiplier,
    playerHp: ps.hp, playerMaxHp: ps.maxHp, usableAmmo, maxLoad,
    overload: ps.overload, overloadFloor: computeFloorOverload(loadout),
    overloadGainMultiplier: computeOverloadGainMultiplier(loadout),
    extraDrawPerTurn: extraDrawImplant ? extraDrawImplant.amount : 0,
    turnStartAoeDamage: aoeImplant ? aoeImplant.amount : 0,
    inventoryItemIdsInOrder: ps.inventory.items.map((i) => i.id),
    inventoryCapacity: ps.inventory.capacity,
    hasBurdenItems: ps.inventory.items.length > ps.inventory.capacity,
    rngState: snapshot.rngState,
  });

  const debuff = getImplantEffect(loadout, 'combatStartDebuffAll');
  if (debuff) {
    combat = {
      ...combat,
      enemies: combat.enemies.map((e) => ({
        ...e,
        statuses: applyStatus(applyStatus(e.statuses, 'vulnerable', debuff.vulnerable), 'weak', debuff.weak),
      })),
    };
  }

  const sectorId = snapshot.facilityRunState?.graph.nodes.find((node) => node.id === context.nodeId)?.sectorId;
  const sectorGenerator = snapshot.facilityRunState?.graph.generators?.find((generator) => generator.sectorId === sectorId);
  if (sectorGenerator && !snapshot.facilityRunState.disabledGeneratorIds.includes(sectorGenerator.id)) {
    combat = {
      ...combat,
      enemies: combat.enemies.map((enemy) => ({
        ...enemy,
        statuses: applyStatus(enemy.statuses, 'armor', GENERATOR_COMBAT_START_ARMOR),
      })),
    };
  }

  if (context.ambush === 'player') {
    combat = { ...combat, enemies: combat.enemies.map((e) => ({ ...e, statuses: applyStatus(e.statuses, 'stun', 1) })) };
  }
  combat = context.ambush === 'enemy' ? beginEnemyFirst(combat) : beginPlayerFirst(combat);
  return {
    ...snapshot, activeCombatState: combat, currentScreen: 'combat', rngState: combat.rngState,
    combatContext: {
      ...context, ammoAtStart: usableAmmo, noiseGauge: 0, noiseIntensity: 0,
      disengage: { escapeIntent: false, disengageProgress: 0 },
    },
  };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} instanceId
 * @param {?string} targetId
 * @returns {GameSnapshot}
 */
export function playCardCommand(snapshot, instanceId, targetId) {
  if (!snapshot.activeCombatState || !snapshot.combatContext || !snapshot.facilityRunState) return snapshot;
  const card = snapshot.activeCombatState.piles.hand.find((c) => c.instanceId === instanceId);
  const combat = playCard(snapshot.activeCombatState, instanceId, targetId);
  if (combat === snapshot.activeCombatState) return snapshot;

  const mapTags = card ? CARD_DEFINITIONS[card.defId]?.mapTags : null;
  let combatContext = snapshot.combatContext;
  let facilityRunState = snapshot.facilityRunState;
  if (mapTags) {
    // §9.1 전투 소음 게이지: checked immediately on every card play, never batched to round end —
    // enemy intents do not feed it (only played cards do).
    const noise = applyCombatCardNoise(facilityRunState, combatContext.nodeId, combatContext.noiseGauge, combatContext.noiseIntensity, mapTags.noise);
    facilityRunState = refreshLocalObservations(noise.runState);
    combatContext = { ...combatContext, noiseGauge: noise.gauge, noiseIntensity: noise.intensity };
    if (mapTags.disengageProgress) combatContext = { ...combatContext, disengage: addDisengageProgress(combatContext.disengage, mapTags.disengageProgress) };
  }
  return finalizeIfCombatEnded({ ...snapshot, activeCombatState: combat, combatContext, facilityRunState });
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function endTurnCommand(snapshot) {
  if (!snapshot.activeCombatState || !snapshot.combatContext || !snapshot.facilityRunState) return snapshot;
  const combat = advanceTurn(snapshot.activeCombatState);
  const facilityRunState = refreshLocalObservations(applyCombatRoundTimeToRunState(snapshot.facilityRunState));
  return finalizeIfCombatEnded({ ...snapshot, activeCombatState: combat, facilityRunState });
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
export function useConsumable(snapshot, itemId) {
  if (!snapshot.activeCombatState) return snapshot;
  const ps = snapshot.playerState;
  const slotIndex = ps.loadout.consumableSlots.findIndex((it) => it?.id === itemId);
  if (slotIndex === -1) return snapshot;
  const def = CONSUMABLE_DEFINITIONS[ps.loadout.consumableSlots[slotIndex].defId];
  let combat = snapshot.activeCombatState;

  if (def.effect.kind === 'healPercent') {
    const heal = Math.round(combat.player.maxHp * def.effect.amount);
    combat = { ...combat, player: { ...combat.player, hp: Math.min(combat.player.maxHp, combat.player.hp + heal) } };
  } else if (def.effect.kind === 'reduceOverload') {
    combat = { ...combat, overload: reduceOverload(combat.overload, def.effect.amount, combat.overloadFloor) };
  } else if (def.effect.kind === 'aoeDamage') {
    combat = { ...combat, enemies: combat.enemies.map((e) => (e.hp > 0 ? applyDamage(e, def.effect.amount, false) : e)) };
  } else if (def.effect.kind === 'aoeDebuff') {
    combat = {
      ...combat,
      enemies: combat.enemies.map((e) => (e.hp > 0
        ? { ...e, statuses: applyStatus(applyStatus(e.statuses, 'vulnerable', def.effect.vulnerable), 'weak', def.effect.weak) }
        : e)),
    };
  }
  combat = checkWinLoss(combat);

  const consumableSlots = ps.loadout.consumableSlots.map((it, i) => (i === slotIndex ? null : it));
  const loadout = { ...ps.loadout, consumableSlots };
  return finalizeIfCombatEnded({ ...snapshot, activeCombatState: combat, playerState: { ...ps, loadout } });
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function finalizeIfCombatEnded(snapshot) {
  const combat = snapshot.activeCombatState;
  if (!combat || (combat.phase !== 'victory' && combat.phase !== 'defeat')) return snapshot;

  if (combat.phase === 'defeat') {
    return { ...snapshot, activeCombatState: null, currentScreen: 'gameOver', combatContext: null };
  }

  const ps = snapshot.playerState;
  let inventory = ps.inventory;
  for (const itemId of combat.player.removedItemIds) inventory = removeItem(inventory, itemId);
  const ammoAtStart = (snapshot.combatContext && snapshot.combatContext.ammoAtStart) || 0;
  const ammoRemaining = combat.player.loaded + combat.player.reserve;
  const ammoSpent = Math.max(0, ammoAtStart - ammoRemaining);
  if (ammoSpent > 0) inventory = spendAmmo(inventory, ammoSpent);

  // 장비 내구도(§신규): 전투 중 축적된 감소 판정을 여기서 실제로 적용. 파괴된 장비는 로드아웃에서
  // 자동 해제되지만 삭제되진 않고 인벤토리에 파손 상태로 남는다(수리 시스템은 아직 없음).
  const decayResult = applyDurabilityDecay(ps.loadout, combat.player.durabilityDecayInstanceIds);
  for (const destroyed of decayResult.destroyedItems) {
    const { id, ...rest } = destroyed;
    inventory = addItem(inventory, rest);
  }
  const combatSummary = (decayResult.changes.length || decayResult.destroyedItems.length)
    ? {
      durabilityChanges: decayResult.changes,
      destroyed: decayResult.destroyedItems.map((i) => ({ itemId: i.id, equipmentId: i.equipmentId })),
    }
    : null;

  const context = snapshot.combatContext;
  const threat = context?.threatId && snapshot.facilityRunState ? snapshot.facilityRunState.threats[context.threatId] : null;
  const tier = threat && threat.size >= 4 ? 'elite' : 'normal';

  // 승리한 위협 그룹은 더 이상 순찰/추적하지 않는다 — 격퇴 처리.
  let facilityRunState = snapshot.facilityRunState;
  if (facilityRunState && context && context.threatId) {
    const threats = { ...facilityRunState.threats };
    delete threats[context.threatId];
    facilityRunState = { ...facilityRunState, threats };
  }

  const playerState = { ...ps, hp: combat.player.hp, overload: combat.overload, inventory, loadout: decayResult.loadout };
  const s = { ...snapshot, playerState, activeCombatState: null, combatSummary, combatContext: null, facilityRunState };
  return startReward(s, tier);
}

// ---- disengage (§9.2) ----

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function beginDisengageCommand(snapshot) {
  if (!snapshot.activeCombatState || !snapshot.combatContext) return snapshot;
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  const disengage = beginDisengage(snapshot.combatContext.disengage, capabilities.mobility);
  return { ...snapshot, combatContext: { ...snapshot.combatContext, disengage } };
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function cancelDisengageCommand(snapshot) {
  if (!snapshot.activeCombatState || !snapshot.combatContext) return snapshot;
  return { ...snapshot, combatContext: { ...snapshot.combatContext, disengage: cancelDisengage(snapshot.combatContext.disengage) } };
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function resolveDisengageCommand(snapshot) {
  const combat = snapshot.activeCombatState;
  const context = snapshot.combatContext;
  if (!combat || !context || !canDisengage(context.disengage)) return snapshot;
  const playerState = { ...snapshot.playerState, hp: combat.player.hp, overload: combat.overload };
  return { ...snapshot, playerState, activeCombatState: null, combatContext: null, currentScreen: 'map' };
}
