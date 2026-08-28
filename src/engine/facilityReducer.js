// 시설맵 행동 커맨드(이동/정찰/파밍/특수 엣지/현장 장비/탈출 요청) — gameReducer.js의 책임
// 분리(§코드 리뷰) 중 시설맵 묶음. combatReducer.js에만 의존한다(위협이 걸어 들어와 강제
// 전투가 열리는 순간 startCombat을 불러야 하므로) — 반대 방향 의존은 없다(순환 없음).
import { weightedPick } from './rng.js';
import {
  moveToAdjacentNode, requestExtraction, basicRecon, openSpecialEdge, useOpportunity,
  useFieldEquipment, isAtOpenExit, refreshLocalObservations, hackCamera, hackAccessInterface, destroyCamera,
  disableGenerator,
} from './runEngine.js';
import { computeCapabilities, listFieldActiveEquipment } from './capabilityEngine.js';
import { scheduleReinforcement } from './combatMapIntegration.js';
import { computeFloorOverload, computeOverloadGainMultiplier, MAX_DURABILITY } from './equipmentEngine.js';
import { rollRewardSlots } from './rewardEngine.js';
import { addItem, createItem, addAmmo } from './inventoryEngine.js';
import { pickThreatEncounter } from '../data/dropTables.js';
import { startCombat } from './combatReducer.js';
import { getAllEquipmentIds } from './inventoryReducer.js';

/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */

/**
 * §5.1.2 step 8(가장 낮은 우선순위): 이번 행동 도중 위협이 내 노드로 들어오면 강제 전투로
 * 전환한다. moveToAdjacentNode뿐 아니라 정찰·파밍·특수 엣지 개방·현장 장비 사용·탈출 요청
 * 등 시간이 걸리는 모든 시설 액션에 공통으로 적용해야 한다 — 그렇지 않으면 "제자리에서
 * 정찰만 반복하면 옆에 위협이 와도 안전하다"는 구멍이 생긴다.
 * @param {GameSnapshot} snapshot 이미 facilityRunState/playerState가 갱신된 스냅샷
 * @returns {GameSnapshot}
 */
function triggerCombatIfNeeded(snapshot) {
  const run = snapshot.facilityRunState;
  const trigger = run?.combatTrigger;
  if (!run || !trigger) return snapshot;
  const threat = run.threats[trigger.threatId];
  if (!threat) return snapshot;

  const encounter = pickThreatEncounter(snapshot.rngState, threat.sectorId, threat.size);
  const withRng = {
    ...snapshot, rngState: encounter.rngState, facilityRunState: { ...run, combatTrigger: null },
  };
  const nearby = Object.values(run.threats).filter(
    (t) => t.id !== threat.id && t.mode === 'pursuit' && t.nodeId === trigger.nodeId,
  );
  const after = startCombat(withRng, encounter.monsterIds, undefined, { nodeId: trigger.nodeId, threatId: threat.id });
  if (!after.combatContext) return after;
  const reinforcementQueue = nearby.map((t) => scheduleReinforcement(t.id, run.time));
  return { ...after, combatContext: { ...after.combatContext, reinforcementQueue } };
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
