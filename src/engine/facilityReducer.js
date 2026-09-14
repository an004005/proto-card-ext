// 시설맵 행동 커맨드(이동/정찰/파밍/특수 엣지/현장 장비/탈출 요청) — gameReducer.js의 책임
// 분리(§코드 리뷰) 중 시설맵 묶음. combatReducer.js에만 의존한다(위협이 걸어 들어와 강제
// 전투가 열리는 순간 startCombat을 불러야 하므로) — 반대 방향 의존은 없다(순환 없음).
import { weightedPick } from './rng.js';
import { RuleViolation } from './errors.js';
import {
  moveToAdjacentNode, requestExtraction, basicRecon, openSpecialEdge, useOpportunity,
  useFieldEquipment, isAtOpenExit, refreshLocalObservations, hackCamera, hackAccessInterface, destroyCamera,
  disableGenerator, useConcealment, hackControlRoom,
  computeThreatPerception, computeEncounterTier, explainEffectiveStealth, deceiveThreat,
  acquireContractGoods, destroyContractTarget, detonateContractCharge, acquireContractIntel, transmitContractIntel,
  disposeCorpse, scheduleTask, taskCompleted, waitOneTick, evadeThreat,
} from './runEngine.js';
import { WAIT_BATCH_MAX_TICKS } from '../data/facilityLayout.js';
import { actionTimeCost } from './actionCosts.js';
import { cleanTraces, cutPower, broadcastFalseTarget, plantFakeNoise } from './recovery.js';
import { computeCapabilities, listFieldActiveEquipment } from './capabilityEngine.js';
import { applyDurabilityDecay, MAX_DURABILITY } from './equipmentEngine.js';
import { rollLootDurability } from './rewardEngine.js';
import { rollSupplyLoot } from './fieldLoot.js';
import { addItem, createItem, addAmmo, removeItem, getUsableAmmo, spendAmmo } from './inventoryEngine.js';
import { startCombat } from './combatReducer.js';
import { equipItem, unequipItem, unequipImplant, unequipConsumable } from './inventoryReducer.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';

// 장비 교체·소모품 사용의 칸도 다른 유료 행동과 같은 비용 사양표에 있다(actionCosts.js) —
// UI 예고와 청구가 같은 표를 읽게 하려면 상수를 여기 따로 두면 안 된다. 기존 호출부가
// facilityReducer에서 가져가고 있으므로 그대로 재수출한다.
export { MAP_EQUIP_TIME_COST, MAP_CONSUMABLE_TIME_COST } from './actionCosts.js';

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
  if (!run) return snapshot;
  const trigger = run.combatTrigger;
  if (!trigger) {
    // 조우는 그 위협이 내 노드에 서 있는 동안만 유지된다. 떠났는데도 조우가 남으면 아무도 없는
    // 자리에서 판정이 계속되고, tier가 even/forced인 채로 굳으면 모든 시설맵 액션이 영구히
    // 막힌다(isBlockedByEncounter). 위협이 사라졌으면 조우도 없앤다.
    const stale = run.encounter
      && !Object.values(run.threats).some((t) => t.id === run.encounter.threatId && t.nodeId === run.playerNodeId);
    return stale ? { ...snapshot, facilityRunState: { ...run, encounter: null } } : snapshot;
  }
  const threat = run.threats[trigger.threatId];
  if (!threat) return snapshot;

  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  const explained = explainEffectiveStealth(capabilities.stealth, run);
  const stealth = explained.total;
  const perception = computeThreatPerception(threat);
  const tier = computeEncounterTier(stealth, perception);
  const clearedRun = { ...run, combatTrigger: null };
  // 판정에 쓴 두 수치를 조우에 박아 둔다 — 화면이 "무엇을 보고 이 등급이 나왔는가"를 그 시각의
  // 값으로 고정해 보여줄 수 있게(리뷰 B7). 이후 은엄폐가 만료돼도 이 숫자는 움직이지 않는다.
  // 합계만 박아두면 "왜 동률인가"를 화면이 설명할 수 없다 — 상황 보정의 분해도 같이 고정한다
  // (ADR-0079). 은엄폐가 만료돼도 이 내역은 움직이지 않는다.
  const judgement = {
    stealthAtJudgement: stealth,
    stealthBaseAtJudgement: explained.base,
    stealthPartsAtJudgement: explained.parts,
    perceptionAtJudgement: perception,
  };

  if (tier !== 'disadvantage') {
    return { ...snapshot, facilityRunState: { ...clearedRun, encounter: { threatId: threat.id, nodeId: trigger.nodeId, tier, graceUsed: false, ...judgement } } };
  }
  // 아직 열세(disadvantage) — 직전 재판정도 열세였고 그때 이미 행동권 1회를 준 상태였다면
  // (graceUsed: true) 이번엔 그 행동으로도 못 벗어난 것 -> 전투만 가능한 forced로 전환.
  // 처음 열세에 들어선 경우(또는 그 전엔 우위/동률이었다가 방금 역전된 경우)는 행동 1회를
  // 허용한다(graceUsed: false로 세팅).
  const prior = run.encounter && run.encounter.threatId === trigger.threatId ? run.encounter : null;
  const graceAlreadyGranted = prior?.tier === 'disadvantage' && !prior.graceUsed;
  if (graceAlreadyGranted) {
    return { ...snapshot, facilityRunState: { ...clearedRun, encounter: { threatId: threat.id, nodeId: trigger.nodeId, tier: 'forced', graceUsed: true, ...judgement } } };
  }
  return { ...snapshot, facilityRunState: { ...clearedRun, encounter: { threatId: threat.id, nodeId: trigger.nodeId, tier: 'disadvantage', graceUsed: false, ...judgement } } };
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
 * Capability 층계(§5단계, D8)가 남긴 청구서를 playerState에 정산한다.
 *
 * HP와 장비 내구도는 facilityRunState 바깥에 있어 runEngine이 직접 깎을 수 없다. 그래서
 * applyCapabilityCost가 `pendingHpLoss`/`pendingDurabilityLoss`에 쌓아두고 여기서 한 번에
 * 받는다 — 모든 시설맵 액션이 withFacilityRunState 하나를 지나므로 빠뜨리는 자리가 없다.
 *
 * 내구도는 장착한 무기부터 깎는다. Force로 뜯다 부러지는 것은 손에 든 연장이다.
 * @param {import('./types.js').FacilityRunState} run
 * @param {import('./types.js').PlayerState} playerState
 * @returns {{run: import('./types.js').FacilityRunState, playerState: import('./types.js').PlayerState}}
 */
function settleCapabilityDues(run, playerState) {
  const hpLoss = run.pendingHpLoss || 0;
  const durabilityLoss = run.pendingDurabilityLoss || 0;
  const ammoSpend = run.pendingAmmoSpend || 0;
  if (!hpLoss && !durabilityLoss && !ammoSpend) return { run, playerState };

  let next = playerState;
  if (hpLoss) next = { ...next, hp: Math.max(0, next.hp - hpLoss) };
  // 맵에는 '장전된 탄'이 없다 — 전투의 loaded는 전투 시작 때 인벤토리 탄약으로 만들어지는
  // 값이므로, 맵 행동(카메라 저격)은 예비탄에서 바로 뺀다. 시작 시점에 탄이 있는지는
  // useFieldEquipment가 이미 확인했다.
  if (ammoSpend) next = { ...next, inventory: spendAmmo(next.inventory, Math.min(ammoSpend, getUsableAmmo(next.inventory))) };
  if (durabilityLoss) {
    const tool = next.loadout.weapons?.[0] || next.loadout.top || next.loadout.bottom || next.loadout.modules?.[0];
    // 깎을 장비가 하나도 없으면 그냥 넘어간다 — 맨손으로 뜯었으면 부러질 연장도 없다.
    if (tool) {
      const decayed = applyDurabilityDecay(next.loadout, Array.from({ length: durabilityLoss }, () => tool.id));
      // 내구도가 0이 된 장비는 슬롯에서 빠지지만 게임에서 사라지지는 않는다 — 전투 쪽과 같이
      // 파손 상태로 인벤토리에 되돌린다. 여기서 destroyedItems를 버리면 아이템이 증발한다.
      let inventory = next.inventory;
      for (const destroyed of decayed.destroyedItems) inventory = addItem(inventory, destroyed);
      next = { ...next, loadout: decayed.loadout, inventory };
    }
  }
  return { run: { ...run, pendingHpLoss: 0, pendingDurabilityLoss: 0, pendingAmmoSpend: 0 }, playerState: next };
}

/**
 * 시설맵 액션 공통: runEngine의 순수 함수를 감싸고, 그 함수가 쌓아둔 청구서(HP·내구도)를
 * 액션이 끝날 때 playerState에 정산한다 — 대가를 치르는 자리가 행동마다 흩어지지 않게.
 * @param {GameSnapshot} snapshot
 * @param {(run: import('./types.js').FacilityRunState) => import('./types.js').FacilityRunState} fn
 * @returns {GameSnapshot}
 */
function withFacilityRunState(snapshot, fn) {
  if (snapshot.currentScreen !== 'map' || !snapshot.facilityRunState) return snapshot;
  if (isBlockedByEncounter(snapshot)) return snapshot;
  const ps = snapshot.playerState;
  const synced = snapshot.facilityRunState;
  // runEngine.js 함수들은 잘못된 호출(자격 미충족/이미 소진 등)에 RuleViolation을 던진다 —
  // UI가 유효한 액션만 노출하는 게 정상 경로지만, 리듀서는 항상 total function이어야 하므로
  // 그것만 흡수한다. TypeError 같은 진짜 버그까지 여기서 삼키면 "버튼을 눌러도 아무 일도
  // 안 일어난다"만 남고 원인이 영영 드러나지 않으므로, 로그를 남기고 다시 던진다(리뷰 A8).
  let next;
  try {
    next = refreshLocalObservations(fn(synced), computeCapabilities(ps.loadout).perception);
  } catch (error) {
    if (error instanceof RuleViolation) return snapshot;
    console.error('[facilityReducer] 시설 액션 처리 중 예상치 못한 오류', error);
    throw error;
  }
  let playerState = ps;
  ({ run: next, playerState } = settleCapabilityDues(next, playerState));
  // D21: 회수 계약은 확보만으로 완료가 아니다 — 물건을 들고 **탈출해야** 완료다. 인벤토리(여기서만
  // 보이는 정보)와 계약 진행 상태(facilityRunState)를 함께 봐야 하는 판정이라, 파밍 루트처럼
  // withFacilityRunState 바깥이 아니라 탈출 판정 바로 앞인 여기서 처리한다 — 모든 시설맵
  // 액션이 이 함수 하나를 거치므로, 어떤 행동으로 탈출구를 밟든 빠짐없이 걸린다.
  //
  // 반드시 isAtOpenExit로 먼저 걸러야 한다. 그러지 않으면 목표부에서 물건을 집고 정찰 한 번만
  // 해도 계약이 완료돼, 봉쇄를 뚫고 걸어 나가는 마지막 장(D21·D22)이 통째로 사라진다.
  const contract = next.contract;
  const extracting = isAtOpenExit(next);
  if (extracting && contract?.type === 'retrieval' && contract.status === 'acquired') {
    const held = playerState.inventory.items.filter((i) => i.kind === 'contractGoods' && i.contractId === contract.id).length;
    if (held >= (contract.goodsSlots || 0)) {
      next = { ...next, contract: { ...contract, status: 'completed', completedAt: next.time } };
    }
  }
  const result = { ...snapshot, facilityRunState: next, playerState };
  // §5.1.2: 붕괴/멜트다운 > 탈출 판정 > 전투 진입 순으로 우선한다 — 같은 순간에 겹쳐도 이 순서.
  if (next.phase !== 'active') return { ...result, currentScreen: 'gameOver' };
  // 층계의 HP 대가(D8)로도 죽을 수 있다. 전투 밖에서 HP가 0이 되는 유일한 경로이므로 여기서
  // 잡지 않으면 HP 0인 채로 런이 계속된다.
  if (playerState.hp <= 0) return { ...result, currentScreen: 'gameOver' };
  // 열린 출구 위에서 탈출 조건이 성립하면, 같은 칸에 적이 도착했더라도 탈출이 먼저 성립한다 —
  // 문턱을 넘은 뒤에 붙잡히지는 않는다. 조우는 탈출이 성립하지 않을 때만 처리한다.
  if (extracting) return { ...result, currentScreen: 'extractionComplete' };
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
  // 거부된 시도(파손 장비 재장착 등)는 실제로 아무것도 바뀌지 않은 것 — 시간을 물리지 않는다.
  // 불가 요청과 취소는 0칸이다(planned §10).
  if (applyEquip(snapshot) === snapshot) return snapshot;
  // 교체는 예약해 두고 **완료 시각에** 적용된다. 그 3칸 안에 위협이 도착하면 교체는 일어나지
  // 않고 경과한 칸만 소모된다 — "제자리에서 장비만 계속 바꾸면 안전하다"는 구멍도 그대로 막힌다.
  const afterTime = withFacilityRunState(snapshot, (run) => scheduleTask(run, { kind: 'equipSwap', timeCost: actionTimeCost('equipSwap') }));
  if (afterTime === snapshot) return snapshot;
  if (afterTime.currentScreen !== 'map' || !taskCompleted(afterTime.facilityRunState)) return afterTime;
  return applyEquip(afterTime);
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
  if (applyMapConsumable(snapshot, itemId) === snapshot) return snapshot;
  // 치료도 완료돼야 효과가 난다 — 중단되면 소모품을 쓰지도, 회복하지도 않는다(planned §9.4).
  const afterTime = withFacilityRunState(snapshot, (run) => scheduleTask(run, { kind: 'mapConsumable', timeCost: actionTimeCost('mapConsumable') }));
  if (afterTime === snapshot) return snapshot;
  if (afterTime.currentScreen !== 'map' || !taskCompleted(afterTime.facilityRunState)) return afterTime;
  return applyMapConsumable(afterTime, itemId);
}

/**
 * 대기(planned §4) — 1칸씩 진행한다. 아무것도 회복시키지 않고 개방·쿨다운·적 위치를 기다리는
 * 용도다. 묶음 대기(최대 5칸)는 1칸 대기를 반복하며 새 조우, 출구 개방/폐쇄, 붕괴가 나면
 * 즉시 멈추므로 실제로 흐른 칸만 소모된다.
 * @param {GameSnapshot} snapshot
 * @param {number} [ticks]
 * @returns {GameSnapshot}
 */
export function waitCommand(snapshot, ticks = 1) {
  // 0칸(또는 음수) 대기는 아무 일도 아니다 — 스냅샷을 그대로 돌려줘야 플레이 로그에 "아무
  // 일도 일어나지 않은 대기"가 쌓이지 않는다(리뷰 A8).
  const requested = Math.floor(ticks);
  if (!Number.isFinite(requested) || requested <= 0) return snapshot;
  const total = Math.min(WAIT_BATCH_MAX_TICKS, requested);
  const startedAt = snapshot.facilityRunState?.time ?? 0;
  let s = snapshot;
  /** @type {'encounter'|'exitChange'|'runEnded'|'blocked'|null} */
  let stopReason = null;
  for (let i = 0; i < total; i++) {
    const before = s;
    s = withFacilityRunState(s, (run) => waitOneTick(run));
    if (s === before) { stopReason = 'blocked'; break; } // 조우에 막혔거나 런이 이미 끝났다
    if (s.currentScreen !== 'map') { stopReason = 'runEnded'; break; } // 붕괴·사망·탈출
    const run = s.facilityRunState;
    if (!run || run.phase !== 'active') { stopReason = 'runEnded'; break; }
    if (run.encounter) { stopReason = 'encounter'; break; } // 새 조우
    if (exitStatusesOf(before.facilityRunState) !== exitStatusesOf(run)) { stopReason = 'exitChange'; break; } // 개방/폐쇄
  }
  // 몇 칸을 실제로 썼고 왜 멈췄는지는 화면이 말해야 하는 정보다 — 5칸을 눌렀는데 2칸만 흘렀다면
  // 그 사이에 무슨 일이 생긴 것이고, 그것이 다음 결정의 근거다.
  const run = s.facilityRunState;
  if (!run) return s;
  // 첫 칸부터 막혔으면(조우·종료된 런) 시간이 한 칸도 흐르지 않았다 — 결과 배너만 새로 다는
  // 대신 스냅샷을 그대로 돌려준다.
  if (s === snapshot) return snapshot;
  return {
    ...s,
    facilityRunState: {
      ...run,
      lastWaitBatch: { requested: total, elapsed: run.time - startedAt, reason: stopReason, completedAt: run.time },
    },
  };
}

/**
 * 출구 A/B의 상태를 한 문자열로 — 대기 중 개방/폐쇄가 일어났는지 비교하는 용도.
 * @param {import('./types.js').FacilityRunState|null|undefined} run
 * @returns {string}
 */
function exitStatusesOf(run) {
  if (!run) return '';
  return /** @type {const} */ (['A'])
    .map((id) => /** @type {import('./types.js').StandardExitRuntimeState|undefined} */ (run.exits[id])?.status)
    .join('|');
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
 * @param {'A'} exitId
 * @returns {GameSnapshot}
 */
export function requestExtractionCommand(snapshot, exitId) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => requestExtraction(run, exitId, capabilities.hacking));
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function basicReconCommand(snapshot) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => basicRecon(run, capabilities.perception));
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

/**
 * 회수 계약(D21) 확보 — 인벤토리 변화가 있어(파밍처럼) withFacilityRunState 바깥에서 아이템을
 * 추가한다. 완료(탈출) 판정은 withFacilityRunState 안에서 별도로 처리된다.
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
export function acquireContractGoodsCommand(snapshot) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  const before = snapshot.facilityRunState?.contract;
  const s = withFacilityRunState(snapshot, (run) => acquireContractGoods(run, capabilities.stealth, capabilities.mobility));
  if (s === snapshot || !before) return s;
  // 중단된 확보는 물건을 들고 나오지 못한 것이다 — 인벤토리에도 아무것도 들어오지 않는다.
  if (!taskCompleted(s.facilityRunState)) return s;
  let inventory = s.playerState.inventory;
  for (let i = 0; i < (before.goodsSlots || 0); i++) {
    inventory = addItem(inventory, createItem('contractGoods', { contractId: before.id, value: before.goodsValuePerSlot }));
  }
  return { ...s, playerState: { ...s.playerState, inventory } };
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function destroyContractTargetCommand(snapshot) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => destroyContractTarget(run, capabilities.force));
}

/** 설치해 둔 폭약을 터뜨린다(C5) — 목표부에서 2홉 이상 떨어진 자리에서만.
 * @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function detonateContractChargeCommand(snapshot) {
  return withFacilityRunState(snapshot, (run) => detonateContractCharge(run));
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function acquireContractIntelCommand(snapshot) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => acquireContractIntel(run, capabilities.hacking));
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function transmitContractIntelCommand(snapshot) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => transmitContractIntel(run, capabilities.hacking));
}

// ---- §4단계: 시체와 수습 수단 (D12·D13) ----

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function disposeCorpseCommand(snapshot) {
  return withFacilityRunState(snapshot, (run) => disposeCorpse(run));
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function cleanTracesCommand(snapshot) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => cleanTraces(run, capabilities.perception));
}

/** @param {GameSnapshot} snapshot @returns {GameSnapshot} */
export function cutPowerCommand(snapshot) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => cutPower(run, capabilities.force));
}

/** @param {GameSnapshot} snapshot @param {string} targetNodeId @returns {GameSnapshot} */
export function plantFakeNoiseCommand(snapshot, targetNodeId) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => plantFakeNoise(run, capabilities.deception, targetNodeId));
}

/** @param {GameSnapshot} snapshot @param {string} targetSectorId @returns {GameSnapshot} */
export function broadcastFalseTargetCommand(snapshot, targetSectorId) {
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  return withFacilityRunState(snapshot, (run) => broadcastFalseTarget(run, capabilities.deception, targetSectorId));
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
  // 방금 판 기회의 등급을 행동 **전에** 읽어 둔다. 행동 후에 `pendingFarmChoice`가 섰는지로
  // 판정하면 두 가지가 어긋난다: 매복이 떠서 후보를 못 세운 확보 대상이 보급품 보상을 받고,
  // 앞선 확보 대상 선택이 대기 중일 때 판 보급품은 아무것도 못 받는다.
  const target = snapshot.facilityRunState?.graph.opportunities.find((o) => o.id === opportunityId);
  const isPrize = target?.grade === 'prize';

  // useOpportunity itself throws when the opportunity is missing/exhausted/not-here, and
  // withFacilityRunState's catch returns `snapshot` unchanged on any such throw — so `s ===
  // snapshot` alone already fully captures "the action failed," no separate success flag needed.
  const s = withFacilityRunState(snapshot, (run) => useOpportunity(run, opportunityId, mode).state);
  if (s === snapshot) return s;
  // 완료 전에 적이 접촉하면 파밍은 중단이다 — 기회도 소모되지 않고 보상도 없다(planned §9.4).
  if (!taskCompleted(s.facilityRunState)) return s;

  // 확보 대상은 여기서 아무것도 주지 않는다 — runEngine이 세워둔 후보 셋을 플레이어가 고르면
  // selectFarmRewardCommand가 지급한다(D11). 매복이 떠서 후보가 서지 못했다면 그것이 강행의
  // 대가이므로 역시 아무것도 주지 않는다. 보급품만 예전처럼 즉시 들어온다.
  if (isPrize) return s;

  // 보급품 보상 티어를 normal 65% / elite 35%로 무작위화 — 고정 normal 1롤보다 파밍이 매번
  // 동일하게 느껴지지 않도록 하는 간이 밸런싱(정밀 수치는 실측 후 조정 대상).
  const tierRoll = weightedPick(s.rngState, [{ value: 'normal', weight: 0.65 }, { value: 'elite', weight: 0.35 }]);
  const tier = /** @type {'normal'|'elite'} */ (tierRoll.value);
  const { option: opt, durability, rngState } = rollSupplyLoot(tier, tierRoll.state);
  let inventory = s.playerState.inventory;
  if (opt) inventory = grantLootOption(inventory, opt, durability);
  const facilityRunState = s.facilityRunState && s.facilityRunState.lastActionResult
    ? { ...s.facilityRunState, lastActionResult: { ...s.facilityRunState.lastActionResult, loot: opt || null } }
    : s.facilityRunState;
  return { ...s, rngState, facilityRunState, playerState: { ...s.playerState, inventory } };
}

/**
 * 보상 후보 하나를 인벤토리에 넣는다. 보급품 자동 지급과 확보 대상 선택 지급이 같은 규칙을
 * 쓰도록 한 자리에 모았다.
 * @param {import('./types.js').Inventory} inventory
 * @param {{kind: string, equipmentId?: string, defId?: string, value?: number, amount?: number}} option
 * @param {number} durability
 * @returns {import('./types.js').Inventory}
 */
function grantLootOption(inventory, option, durability) {
  if (option.kind === 'equipment') return addItem(inventory, createItem('equipment', { equipmentId: option.equipmentId, durability }));
  if (option.kind === 'currency') return addItem(inventory, createItem('currency', { value: option.value }));
  if (option.kind === 'junk') return addItem(inventory, createItem('junk', { value: option.value }));
  if (option.kind === 'ammo') return addAmmo(inventory, option.amount);
  if (option.kind === 'consumable') return addItem(inventory, createItem('consumable', { defId: option.defId }));
  return inventory;
}

/**
 * 확보 대상의 후보 중 하나를 골라 받는다(D11).
 *
 * 등급이 여기서 값을 한다. 등급이 높으면 파밍 시간과 소음이 컸으므로(D10) 받는 것도 나아야
 * 한다 — 장비 축은 후보 자체가 등급을 안 타므로, elite는 새것(MAX_DURABILITY)으로, normal은
 * 쓰던 것(3~9)으로 준다. 그러지 않으면 elite는 시간만 더 쓰는 순수 손해가 된다.
 * @param {GameSnapshot} snapshot
 * @param {number} optionIndex
 * @returns {GameSnapshot}
 */
export function selectFarmRewardCommand(snapshot, optionIndex) {
  const pending = snapshot.facilityRunState?.pendingFarmChoice;
  if (!pending) return snapshot;
  const option = pending.options[optionIndex];
  if (!option) return snapshot;

  let rngState = snapshot.rngState;
  let durability = MAX_DURABILITY;
  if (pending.tier !== 'elite') {
    const rolled = rollLootDurability(rngState);
    durability = rolled.value;
    rngState = rolled.state;
  }

  const inventory = grantLootOption(snapshot.playerState.inventory, option, durability);
  const run = snapshot.facilityRunState;
  return {
    ...snapshot,
    rngState,
    playerState: { ...snapshot.playerState, inventory },
    facilityRunState: {
      ...run,
      pendingFarmChoice: null,
      lastActionResult: run.lastActionResult ? { ...run.lastActionResult, loot: option } : run.lastActionResult,
    },
  };
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
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  const usableAmmo = getUsableAmmo(snapshot.playerState.inventory);
  return withFacilityRunState(snapshot, (run) => useFieldEquipment(
    run, instanceId, entry.contract.fieldAction, targetId,
    { effectivePerception: capabilities.perception, usableAmmo },
  ));
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
export function encounterDeceiveCommand(snapshot) {
  const run = snapshot.facilityRunState;
  const encounter = run?.encounter;
  // 회피와 같은 자리에서만 고를 수 있다 — 동률(그리고 우위)의 선택지다.
  if (!encounter || (encounter.tier !== 'advantage' && encounter.tier !== 'even')) return snapshot;
  const threat = run.threats[encounter.threatId];
  if (!threat) return { ...snapshot, facilityRunState: { ...run, encounter: null } };
  const capabilities = computeCapabilities(snapshot.playerState.loadout);
  // 요구치 미달은 여기서 거르지 않는다 — 층계(D8)의 불가 판정만 막고, 그 판정은 deceiveThreat
  // 안의 사양표가 한다. 화면의 예고와 커맨드가 다른 기준을 쓰면 버튼이 조용히 아무 일도 안 한다.
  if ((run.deceivedThreatIds || []).includes(threat.id)) return snapshot;

  let result;
  try {
    result = deceiveThreat(run, threat.id, capabilities.deception);
  } catch (error) {
    if (error instanceof RuleViolation) return snapshot;
    throw error;
  }
  // 0칸이다 — 시간이 흐르지 않으므로 공통 래퍼(withFacilityRunState)를 타지 않고 조우만 다시 쓴다.
  // 성공하면 조우가 닫히고, 실패하면 같은 자리에서 열세로 내려간다.
  const encounterAfter = result.success
    ? null
    : { ...encounter, tier: /** @type {const} */ ('disadvantage'), graceUsed: false };
  return { ...snapshot, facilityRunState: { ...result.state, encounter: encounterAfter } };
}

/**
 * @param {GameSnapshot} snapshot
 * @returns {GameSnapshot}
 */
export function encounterEvadeCommand(snapshot) {
  const run = snapshot.facilityRunState;
  const encounter = run?.encounter;
  if (!encounter || (encounter.tier !== 'advantage' && encounter.tier !== 'even')) return snapshot;
  const threat = run.threats[encounter.threatId];
  if (!threat) return { ...snapshot, facilityRunState: { ...run, encounter: null } };
  // 조우를 먼저 닫아야 공통 래퍼의 조우 차단('even')에 자기 자신이 막히지 않는다. 회피는
  // 1칸짜리 유료 행동이고(planned §4), 그 1칸 동안 다른 위협과 붕괴는 정상 판정된다.
  const cleared = { ...snapshot, facilityRunState: { ...run, encounter: null } };
  return withFacilityRunState(cleared, (r) => evadeThreat(r, encounter.threatId));
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
