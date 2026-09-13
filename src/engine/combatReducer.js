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
import { GENERATOR_COMBAT_START_ARMOR, COMBAT_ENEMY_AMBUSH_TIME_COST } from '../data/facilityLayout.js';

/**
 * planned §8 전투 라운드 정산 — 이 라운드의 맵 칸을 아직 청구하지 않았을 때만 한 번 청구한다.
 *
 * 라운드별 정산 여부(`combatContext.roundSettled`)를 들고 있어야 "턴 종료 처리 중에 승리"가
 * 종료 처리와 승리 처리에서 두 번 청구되지 않는다. 첫 라운드에 끝나도 3칸이고, 세 번째에
 * 끝나면 총 9칸이다. 카드 사용·전투 소모품·이탈 선택에는 별도 비용이 없다 — 전부 그 라운드의
 * 3칸에 포함된다.
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
function settleCombatRound(snapshot) {
  const ctx = snapshot.combatContext;
  if (!ctx || ctx.roundSettled || !snapshot.facilityRunState) return snapshot;
  const facilityRunState = refreshLocalObservations(applyCombatRoundTimeToRunState(snapshot.facilityRunState));
  return { ...snapshot, facilityRunState, combatContext: { ...ctx, roundSettled: true } };
}

/**
 * 전투가 끝나 맵으로 돌아갈 때 교전 표시를 지운다 — 그 위협이 다시 맵에서 움직일 수 있게.
 * @template {import('./types.js').FacilityRunState|null|undefined} T
 * @param {T} run
 * @returns {T}
 */
function releaseEngagement(run) {
  return run && run.engagedThreatId ? { ...run, engagedThreatId: null } : run;
}

/**
 * 전투 정산이 런을 끝냈으면(붕괴) 전투 결과와 무관하게 그 자리에서 런이 끝난다. 라운드 정산은
 * 맵 시간을 밀기 때문에 승패가 아직 나지 않은 라운드에서도 붕괴 시각을 넘길 수 있다 — 그때
 * 전투 화면에 남아 있으면 이미 끝난 런에서 계속 카드를 내게 된다.
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
function endRunIfCollapsed(snapshot) {
  const run = snapshot.facilityRunState;
  if (!run || run.phase === 'active') return snapshot;
  // finalizeIfCombatEnded가 이미 정리한 뒤라면 건드릴 것이 없다.
  if (!snapshot.activeCombatState && !snapshot.combatContext) return snapshot;
  const combat = snapshot.activeCombatState;
  const playerState = combat
    ? { ...snapshot.playerState, hp: combat.player.hp, overload: combat.overload }
    : snapshot.playerState;
  return {
    ...snapshot,
    playerState,
    activeCombatState: null,
    combatContext: null,
    currentScreen: /** @type {const} */ ('gameOver'),
    facilityRunState: releaseEngagement(run),
  };
}

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

  // 교전에 들어간 위협은 전투가 끝날 때까지 맵에서 멈춘다. 외부 위협은 계속 움직이지만,
  // 도착해도 현재 전투에 끼어들지 않고 종료 후 조우로 처리된다(planned §8).
  let facilityRunState = snapshot.facilityRunState
    ? { ...snapshot.facilityRunState, engagedThreatId: context.threatId || null }
    : snapshot.facilityRunState;
  // 적 기습으로 생기는 추가 선공 구간은 라운드와 별도로 3칸이다. 플레이어 기습의 스턴은 적
  // 행동을 막을 뿐 라운드 시간을 줄이지 않으므로 여기에 대응하는 할인이 없다.
  if (context.ambush === 'enemy' && facilityRunState) {
    facilityRunState = refreshLocalObservations(applyCombatRoundTimeToRunState(facilityRunState, COMBAT_ENEMY_AMBUSH_TIME_COST));
  }
  /** @type {GameSnapshot} */
  const started = {
    ...snapshot, activeCombatState: combat, currentScreen: 'combat', rngState: combat.rngState, facilityRunState,
    combatContext: {
      ...context, ammoAtStart: usableAmmo, noiseGauge: 0, noiseIntensity: 0, roundSettled: false,
      disengage: { escapeIntent: false, disengageProgress: 0 },
    },
  };
  // 기습 정산 도중 붕괴에 걸릴 수 있다 — 전투를 시작하기 전에 런이 끝난다.
  if (facilityRunState && facilityRunState.phase !== 'active') {
    return { ...started, activeCombatState: null, combatContext: null, currentScreen: 'gameOver', facilityRunState: releaseEngagement(facilityRunState) };
  }
  return started;
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
  return endRunIfCollapsed(finalizeIfCombatEnded({ ...snapshot, activeCombatState: combat, combatContext, facilityRunState }));
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function endTurnCommand(snapshot) {
  if (!snapshot.activeCombatState || !snapshot.combatContext || !snapshot.facilityRunState) return snapshot;
  const combat = advanceTurn(snapshot.activeCombatState);
  // 턴 종료 처리가 곧 이 라운드의 끝이다 — 여기서 한 번 정산하고, 전투가 이어지면 새 라운드를
  // 미정산으로 연다. 종료 처리 도중 승리했더라도 아래 finalize가 다시 청구하지 않는다.
  let s = settleCombatRound({ ...snapshot, activeCombatState: combat });
  s = endRunIfCollapsed(finalizeIfCombatEnded(s));
  if (!s.combatContext || !s.activeCombatState) return s;
  return { ...s, combatContext: { ...s.combatContext, roundSettled: false } };
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
  let combat = snapshot.activeCombatState;
  if (!combat || (combat.phase !== 'victory' && combat.phase !== 'defeat')) return snapshot;

  // 라운드 도중 승리·패배가 확정돼도 그 라운드는 3칸이다(planned §8). 턴 종료 경로에서 이미
  // 정산했으면 roundSettled가 막아준다 — 이중 청구가 없다.
  snapshot = settleCombatRound(snapshot);
  // settleCombatRound는 맵 시간만 건드린다 — 전투 상태는 방금 확인한 그대로다.
  combat = /** @type {import('./types.js').CombatState} */ (snapshot.activeCombatState);

  if (combat.phase === 'defeat') {
    return {
      ...snapshot, activeCombatState: null, currentScreen: 'gameOver', combatContext: null,
      facilityRunState: releaseEngagement(snapshot.facilityRunState),
    };
  }

  // 정산 도중 붕괴 시각을 넘겼으면 승리했더라도 붕괴 실패가 우선한다. 보상 창·연출 시간은
  // 따로 청구하지 않으므로, 여기서 살아남았다면 보상은 온전히 받는다.
  if (snapshot.facilityRunState && snapshot.facilityRunState.phase !== 'active') {
    return {
      ...snapshot,
      playerState: { ...snapshot.playerState, hp: combat.player.hp, overload: combat.overload },
      activeCombatState: null, currentScreen: 'gameOver', combatContext: null,
      facilityRunState: releaseEngagement(snapshot.facilityRunState),
    };
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

  // 승리한 위협 그룹은 더 이상 순찰/추적하지 않는다 — 격퇴 처리. 대신 그 자리에 시체가
  // 남는다(§4단계, D13): 다른 위협이 밟으면 신고되어 구역 경계도가 오르고 그 지점으로 조사가
  // 몰린다. 치우려면 시간을 써야 하므로 "지금 이기고 나중에 값을 치르는 선택"이 된다.
  let facilityRunState = snapshot.facilityRunState;
  if (facilityRunState && context && context.threatId) {
    const threats = { ...facilityRunState.threats };
    delete threats[context.threatId];
    const nodeId = context.nodeId || facilityRunState.playerNodeId;
    const corpses = nodeId
      ? [...facilityRunState.corpses, {
        id: `corpse_${context.threatId}_${facilityRunState.time}`,
        nodeId,
        sectorId: /** @type {import('./types.js').FacilitySectorId} */ (nodeId.split('_')[0]),
        createdAt: facilityRunState.time,
      }]
      : facilityRunState.corpses;
    facilityRunState = { ...facilityRunState, threats, corpses };
  }
  facilityRunState = releaseEngagement(facilityRunState);

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
  // 이탈 확정에도 별도 맵 비용은 없다 — 다만 이탈한 그 라운드는 아직 정산되지 않았다면 3칸이다.
  const settled = settleCombatRound(snapshot);
  const playerState = { ...settled.playerState, hp: combat.player.hp, overload: combat.overload };
  const facilityRunState = releaseEngagement(settled.facilityRunState);
  const collapsed = facilityRunState && facilityRunState.phase !== 'active';
  return {
    ...settled, playerState, facilityRunState, activeCombatState: null, combatContext: null,
    currentScreen: collapsed ? 'gameOver' : 'map',
  };
}
