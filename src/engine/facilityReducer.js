// 시설맵 행동 커맨드(이동/정찰/파밍/특수 엣지/현장 장비/탈출 요청) — gameReducer.js의 책임
// 분리(§코드 리뷰) 중 시설맵 묶음. combatReducer.js에만 의존한다(위협이 걸어 들어와 강제
// 전투가 열리는 순간 startCombat을 불러야 하므로) — 반대 방향 의존은 없다(순환 없음).
import { weightedPick } from './rng.js';
import {
  moveToAdjacentNode, requestExtraction, basicRecon, openSpecialEdge, useOpportunity,
  useFieldEquipment, isAtOpenExit, refreshLocalObservations, hackCamera, hackAccessInterface, destroyCamera,
  disableGenerator, advanceTime, useConcealment, hackControlRoom,
  computeThreatPerception, computeEncounterTier, effectiveStealthWithConcealment,
} from './runEngine.js';
import { computeCapabilities, listFieldActiveEquipment } from './capabilityEngine.js';
import { computeFloorOverload, computeOverloadGainMultiplier, MAX_DURABILITY } from './equipmentEngine.js';
import { rollRewardSlots } from './rewardEngine.js';
import { addItem, createItem, addAmmo, removeItem } from './inventoryEngine.js';
import { startCombat } from './combatReducer.js';
import { getAllEquipmentIds, equipItem, unequipItem, unequipImplant, unequipConsumable } from './inventoryReducer.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';

/** 맵에서 장비를 교체할 때 건당 부과되는 시간 비용 — 정찰/파밍 등 다른 맵 액션과 같은 결로,
 * 그동안 위협이 도착하면 아래 triggerCombatIfNeeded가 강제 전투로 전환한다. */
export const MAP_EQUIP_TIME_COST = 50;
/** 맵에서 회복류 소모품을 즉시 사용할 때 부과되는 시간 비용. */
export const MAP_CONSUMABLE_TIME_COST = 30;

/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */

/**
 * §5.1.2 step 8(가장 낮은 우선순위) + §신규 조우 시스템: 이번 행동 도중 위협이 내 노드로
 * 들어오면(또는 이미 같은 노드에 있는 채로 행동을 계속하면) perception(위협) vs 실효
 * stealth(플레이어)를 재판정해 `run.encounter`를 세우거나 갱신한다 — 더 이상 콜리전이 즉시
 * 전투를 여는 게 아니다. moveToAdjacentNode뿐 아니라 정찰·파밍·특수 엣지 개방·현장 장비
 * 사용·탈출 요청·장비 교체·은엄폐 등 시간이 걸리는 모든 시설 액션에 공통으로 적용해야 한다
 * — 그렇지 않으면 "제자리에서 정찰만 반복하면 옆에 위협이 와도 안전하다"는 구멍이 생긴다.
 * @param {GameSnapshot} snapshot 이미 facilityRunState/playerState가 갱신된 스냅샷
 * @returns {GameSnapshot}
 */
function triggerCombatIfNeeded(snapshot) {
  const run = snapshot.facilityRunState;
  const trigger = run?.combatTrigger;
  if (!run || !trigger) return snapshot;
  const threat = run.threats[trigger.threatId];
  if (!threat) return snapshot;

  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  const stealth = effectiveStealthWithConcealment(capabilities.stealth, run);
  const perception = computeThreatPerception(threat);
  const tier = computeEncounterTier(stealth, perception);
  const clearedRun = { ...run, combatTrigger: null };

  if (tier !== 'disadvantage') {
    return { ...snapshot, facilityRunState: { ...clearedRun, encounter: { threatId: threat.id, nodeId: trigger.nodeId, tier, graceUsed: false } } };
  }
  // 아직 열세(disadvantage) — 직전 재판정도 열세였고 그때 이미 행동권 1회를 준 상태였다면
  // (graceUsed: true) 이번엔 그 행동으로도 못 벗어난 것 -> 전투만 가능한 forced로 전환.
  // 처음 열세에 들어선 경우(또는 그 전엔 우위/동률이었다가 방금 역전된 경우)는 행동 1회를
  // 허용한다(graceUsed: false로 세팅).
  const prior = run.encounter && run.encounter.threatId === trigger.threatId ? run.encounter : null;
  const graceAlreadyGranted = prior?.tier === 'disadvantage' && !prior.graceUsed;
  if (graceAlreadyGranted) {
    return { ...snapshot, facilityRunState: { ...clearedRun, encounter: { threatId: threat.id, nodeId: trigger.nodeId, tier: 'forced', graceUsed: true } } };
  }
  return { ...snapshot, facilityRunState: { ...clearedRun, encounter: { threatId: threat.id, nodeId: trigger.nodeId, tier: 'disadvantage', graceUsed: false } } };
}

/**
 * §신규 조우 시스템: 'even'(무시 불가, 회피만)과 'forced'(전투만) 동안은 조우 선택지 명령
 * 이외의 시설맵 액션을 전부 막는다. 'advantage'(무시 가능)와 아직 행동권이 남은
 * 'disadvantage'(행동 1회 허용)는 막지 않는다 — 그 행동 자체가 이 시스템이 요구하는 흐름이다.
 * @param {GameSnapshot} snapshot
 * @returns {boolean}
 */
function isBlockedByEncounter(snapshot) {
  const tier = snapshot.facilityRunState?.encounter?.tier;
  return tier === 'even' || tier === 'forced';
}

/**
 * 시설맵 액션 공통: 호출 직전 playerState.overload를 facilityRunState에 동기화하고, 호출 후
 * facilityRunState.overload를 다시 playerState.overload로 되돌린다 — Overload는 전투와
 * 공유하는 런 전체 자원이므로 두 상태가 각자 카피를 갖지 않도록 매 액션마다 맞춘다.
 * @param {GameSnapshot} snapshot
 * @param {(run: import('./types.js').FacilityRunState) => import('./types.js').FacilityRunState} fn
 * @returns {GameSnapshot}
 */
function withFacilityRunState(snapshot, fn) {
  if (snapshot.currentScreen !== 'map' || !snapshot.facilityRunState) return snapshot;
  if (isBlockedByEncounter(snapshot)) return snapshot;
  const ps = snapshot.playerState;
  const synced = {
    ...snapshot.facilityRunState, overload: ps.overload,
    overloadFloor: computeFloorOverload(ps.loadout), overloadGainMultiplier: computeOverloadGainMultiplier(ps.loadout),
  };
  // runEngine.js 함수들은 잘못된 호출(자격 미충족/이미 소진 등)에 예외를 던진다 — UI가 유효한
  // 액션만 노출하는 게 정상 경로지만, 리듀서는 항상 total function이어야 하므로 여기서 흡수한다.
  let next;
  try { next = refreshLocalObservations(fn(synced)); } catch { return snapshot; }
  const playerState = { ...ps, overload: next.overload };
  const result = { ...snapshot, facilityRunState: next, playerState };
  // §5.1.2: 붕괴/멜트다운 > 탈출 판정 > 전투 진입 순으로 우선한다 — 같은 순간에 겹쳐도 이 순서.
  if (next.phase !== 'active') return { ...result, currentScreen: 'gameOver' };
  if (isAtOpenExit(next)) return { ...result, currentScreen: 'extractionComplete' };
  return triggerCombatIfNeeded(result);
}

/**
 * 맵에서의 장비 교체 1건(장착/해제 각각)마다 MAP_EQUIP_TIME_COST를 부과한다 — 다른 시설맵
 * 액션과 같은 결로, 그 시간 동안 위협이 도착하면 위 triggerCombatIfNeeded가 강제 전투로
 * 전환한다("제자리에서 장비만 계속 바꾸면 안전하다"는 구멍을 막는다).
 * @param {GameSnapshot} snapshot
 * @param {(s: GameSnapshot) => GameSnapshot} applyEquip
 * @returns {GameSnapshot}
 */
function withMapEquipTimeCost(snapshot, applyEquip) {
  if (snapshot.currentScreen !== 'map') return applyEquip(snapshot);
  if (isBlockedByEncounter(snapshot)) return snapshot;
  const equipped = applyEquip(snapshot);
  // 거부된 시도(파손 장비 재장착 등)는 실제로 아무것도 바뀌지 않은 것 — 시간을 물리지 않는다.
  if (equipped === snapshot) return snapshot;
  return withFacilityRunState(equipped, (run) => advanceTime(run, run.time + MAP_EQUIP_TIME_COST));
}

/** @param {GameSnapshot} snapshot @param {string} itemId @returns {GameSnapshot} */
export function equipItemOnMapCommand(snapshot, itemId) {
  return withMapEquipTimeCost(snapshot, (s) => equipItem(s, itemId));
}

/** @param {GameSnapshot} snapshot @param {string} itemId @returns {GameSnapshot} */
export function unequipItemOnMapCommand(snapshot, itemId) {
  return withMapEquipTimeCost(snapshot, (s) => unequipItem(s, itemId));
}

/** @param {GameSnapshot} snapshot @param {string} equipmentId @returns {GameSnapshot} */
export function unequipImplantOnMapCommand(snapshot, equipmentId) {
  return withMapEquipTimeCost(snapshot, (s) => unequipImplant(s, equipmentId));
}

/** @param {GameSnapshot} snapshot @param {string} itemId @returns {GameSnapshot} */
export function unequipConsumableOnMapCommand(snapshot, itemId) {
  return withMapEquipTimeCost(snapshot, (s) => unequipConsumable(s, itemId));
}

/**
 * §신규: 맵에서 회복류 소모품을 인벤토리/퀵슬롯 어디에 있든 즉시 사용한다(전투 중 규칙은
 * 그대로 — 퀵슬롯만, 무료). "회복류"는 `mapTags.traits`에 'healing'이 있는 소모품만.
 * @param {GameSnapshot} snapshot
 * @param {string} itemId
 * @returns {GameSnapshot}
 */
function applyMapConsumable(snapshot, itemId) {
  const ps = snapshot.playerState;
  const fromInventory = ps.inventory.items.find((i) => i.id === itemId && i.kind === 'consumable');
  const slotIndex = ps.loadout.consumableSlots.findIndex((it) => it?.id === itemId);
  const item = fromInventory || (slotIndex !== -1 ? ps.loadout.consumableSlots[slotIndex] : null);
  if (!item) return snapshot;
  const def = CONSUMABLE_DEFINITIONS[item.defId];
  if (!def || def.effect.kind !== 'healPercent' || !def.mapTags.traits.includes('healing')) return snapshot;

  const heal = Math.round(ps.maxHp * def.effect.amount);
  const hp = Math.min(ps.maxHp, ps.hp + heal);
  let inventory = ps.inventory;
  let loadout = ps.loadout;
  if (fromInventory) {
    inventory = removeItem(inventory, itemId);
  } else {
    loadout = { ...loadout, consumableSlots: loadout.consumableSlots.map((it, i) => (i === slotIndex ? null : it)) };
  }
  return { ...snapshot, playerState: { ...ps, hp, inventory, loadout } };
}

/** @param {GameSnapshot} snapshot @param {string} itemId @returns {GameSnapshot} */
export function useMapConsumableCommand(snapshot, itemId) {
  if (snapshot.currentScreen !== 'map') return snapshot;
  if (isBlockedByEncounter(snapshot)) return snapshot;
  const applied = applyMapConsumable(snapshot, itemId);
  if (applied === snapshot) return snapshot;
  return withFacilityRunState(applied, (run) => advanceTime(run, run.time + MAP_CONSUMABLE_TIME_COST));
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} nodeId
 * @returns {GameSnapshot}
 */
export function moveToNode(snapshot, nodeId) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => moveToAdjacentNode(run, nodeId, capabilities.mobility, capabilities.stealth));
}

/**
 * @param {GameSnapshot} snapshot
 * @param {'A'|'B'} exitId
 * @returns {GameSnapshot}
 */
export function requestExtractionCommand(snapshot, exitId) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => requestExtraction(run, exitId, capabilities.hacking));
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function basicReconCommand(snapshot) {
  return withFacilityRunState(snapshot, (run) => basicRecon(run));
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function useConcealmentCommand(snapshot) {
  return withFacilityRunState(snapshot, (run) => useConcealment(run));
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function hackControlRoomCommand(snapshot) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => hackControlRoom(run, capabilities.hacking));
}

/** @param {GameSnapshot} snapshot @param {string} cameraId @returns {GameSnapshot} */
export function hackCameraCommand(snapshot, cameraId) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => hackCamera(run, cameraId, capabilities.hacking));
}

/** @param {GameSnapshot} snapshot @param {string} interfaceId @returns {GameSnapshot} */
export function hackAccessInterfaceCommand(snapshot, interfaceId) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => hackAccessInterface(run, interfaceId, capabilities.hacking));
}

/** @param {GameSnapshot} snapshot @param {string} cameraId @returns {GameSnapshot} */
export function destroyCameraCommand(snapshot, cameraId) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => destroyCamera(run, cameraId, capabilities.force));
}

/** @param {GameSnapshot} snapshot @param {string} generatorId @param {'hacking'|'force'} capabilityKind */
export function disableGeneratorCommand(snapshot, generatorId, capabilityKind) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => disableGenerator(run, generatorId, capabilityKind, capabilities[capabilityKind]));
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} edgeId
 * @param {'force'|'hacking'} capabilityKind
 * @param {'safe'|'normal'|'rush'} mode
 * @returns {GameSnapshot}
 */
export function openSpecialEdgeCommand(snapshot, edgeId, capabilityKind, mode) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => openSpecialEdge(run, edgeId, capabilityKind, capabilities[capabilityKind], mode));
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} opportunityId
 * @param {'safe'|'normal'|'rush'} mode
 * @returns {GameSnapshot}
 */
export function useOpportunityCommand(snapshot, opportunityId, mode) {
  // useOpportunity itself throws when the opportunity is missing/exhausted/not-here, and
  // withFacilityRunState's catch returns `snapshot` unchanged on any such throw — so `s ===
  // snapshot` alone already fully captures "the action failed," no separate success flag needed.
  const s = withFacilityRunState(snapshot, (run) => useOpportunity(run, opportunityId, mode).state);
  if (s === snapshot) return s;
  // 파밍 보상 티어를 normal 65% / elite 35%로 무작위화 — 고정 normal 1롤보다 파밍이 매번
  // 동일하게 느껴지지 않도록 하는 간이 밸런싱(정밀 수치는 실측 후 조정 대상).
  const tierRoll = weightedPick(s.rngState, [{ value: 'normal', weight: 0.65 }, { value: 'elite', weight: 0.35 }]);
  const tier = /** @type {'normal'|'elite'} */ (tierRoll.value);
  const { slots, rngState } = rollRewardSlots(tier, getAllEquipmentIds(), tierRoll.state);
  const opt = slots[0]?.options[0];
  let inventory = s.playerState.inventory;
  if (opt) {
    if (opt.kind === 'equipment') inventory = addItem(inventory, createItem('equipment', { equipmentId: opt.equipmentId, durability: MAX_DURABILITY }));
    else if (opt.kind === 'currency') inventory = addItem(inventory, createItem('currency', { value: opt.value }));
    else if (opt.kind === 'junk') inventory = addItem(inventory, createItem('junk', { value: opt.value }));
    else if (opt.kind === 'ammo') inventory = addAmmo(inventory, opt.amount);
    else if (opt.kind === 'consumable') inventory = addItem(inventory, createItem('consumable', { defId: opt.defId }));
  }
  const facilityRunState = s.facilityRunState && s.facilityRunState.lastActionResult
    ? { ...s.facilityRunState, lastActionResult: { ...s.facilityRunState.lastActionResult, loot: opt || null } }
    : s.facilityRunState;
  return { ...s, rngState, facilityRunState, playerState: { ...s.playerState, inventory } };
}

/**
 * @param {GameSnapshot} snapshot
 * @param {string} instanceId
 * @param {string} [targetId]
 * @returns {GameSnapshot}
 */
export function useFieldEquipmentCommand(snapshot, instanceId, targetId) {
  const active = listFieldActiveEquipment(snapshot.playerState.loadout);
  const entry = active.find((e) => e.instanceId === instanceId);
  if (!entry) return snapshot;
  return withFacilityRunState(snapshot, (run) => useFieldEquipment(run, instanceId, entry.contract.fieldAction, targetId));
}

// ---- §신규 조우 시스템: 판정 결과에 대한 플레이어 선택 ----

/**
 * 기습 — tier 'advantage' 전용. 적 전원에게 스턴을 걸고(§전투) 전투를 시작한다(플레이어 선공은
 * 그대로 유지, 스턴 자체가 "적 첫 턴 무력화" 효과를 만든다).
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
export function encounterAmbushCommand(snapshot) {
  const run = snapshot.facilityRunState;
  const encounter = run?.encounter;
  if (!encounter || encounter.tier !== 'advantage') return snapshot;
  const threat = run.threats[encounter.threatId];
  if (!threat) return { ...snapshot, facilityRunState: { ...run, encounter: null } };
  const cleared = { ...snapshot, facilityRunState: { ...run, encounter: null } };
  return startCombat(cleared, threat.monsterIds, undefined, { nodeId: encounter.nodeId, threatId: threat.id, ambush: 'player' });
}

/**
 * 무시 — tier 'advantage' 전용('even'/'disadvantage'/'forced'에서는 무시 불가). 전투 없이 선택지만
 * 닫는다 — 위협은 그대로 그 노드에 있으므로, 다음 행동에서 다시 재판정된다(계속 우위면 계속 무시 가능).
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
export function encounterIgnoreCommand(snapshot) {
  const run = snapshot.facilityRunState;
  const encounter = run?.encounter;
  if (!encounter || encounter.tier !== 'advantage') return snapshot;
  return { ...snapshot, facilityRunState: { ...run, encounter: null } };
}

/**
 * 회피 — tier 'advantage'/'even' 전용, 선택 즉시 확정 성공. 위협을 patrol로 되돌리고 추적을
 * 지운다. 노드 자체는 그대로라 다음 행동에서 재콜리전이 뜰 수 있지만(그 자리에 계속 머물면),
 * 보통은 곧바로 다른 노드로 이동해 완전히 따돌리는 흐름을 기대한다.
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
export function encounterEvadeCommand(snapshot) {
  const run = snapshot.facilityRunState;
  const encounter = run?.encounter;
  if (!encounter || (encounter.tier !== 'advantage' && encounter.tier !== 'even')) return snapshot;
  const threat = run.threats[encounter.threatId];
  if (!threat) return { ...snapshot, facilityRunState: { ...run, encounter: null } };
  const threats = {
    ...run.threats,
    [encounter.threatId]: { ...threat, mode: 'patrol', pursuitStrength: 0, lastKnownPlayerNodeId: null, target: null },
  };
  return { ...snapshot, facilityRunState: { ...run, threats, encounter: null } };
}

/**
 * 전투 — tier 'forced' 전용(열세에서 행동 1회를 다 쓰고도 여전히 열세). 진입 시 항상 적 기습
 * (beginEnemyFirst, 적 선공 1턴).
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
export function encounterFightCommand(snapshot) {
  const run = snapshot.facilityRunState;
  const encounter = run?.encounter;
  if (!encounter || encounter.tier !== 'forced') return snapshot;
  const threat = run.threats[encounter.threatId];
  if (!threat) return { ...snapshot, facilityRunState: { ...run, encounter: null } };
  const cleared = { ...snapshot, facilityRunState: { ...run, encounter: null } };
  return startCombat(cleared, threat.monsterIds, undefined, { nodeId: encounter.nodeId, threatId: threat.id, ambush: 'enemy' });
}
