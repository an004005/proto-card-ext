// Pure command reducer: (GameSnapshot, command) => GameSnapshot. No Preact/DOM dependency —
// the whole run (loadout -> map -> extraction/death) can be played headlessly with
// `node --test`. state/dispatch.js is the only caller that wires this to signals.
//
// This file is a thin dispatch table only — each command family's actual logic lives in its own
// module (§코드 리뷰 책임 분리): loadoutReducer.js (출격 준비), facilityReducer.js (시설맵
// 행동), combatReducer.js (전투/이탈), rewardReducer.js (보상), inventoryReducer.js (장비/짐
// 정리). Dependency direction is one-way: inventoryReducer <- rewardReducer <- combatReducer <-
// facilityReducer, and loadoutReducer depends only on inventoryReducer + runEngine.js — no cycles.
import { newRun, setLoadoutSlot, confirmLoadout, autoEquipLoadout, applyLoadoutPreset } from './loadoutReducer.js';
import { acceptContractCommand } from './contractReducer.js';
import {
  moveToNode, requestExtractionCommand, basicReconCommand, openSpecialEdgeCommand,
  useOpportunityCommand, useFieldEquipmentCommand, hackCameraCommand, hackAccessInterfaceCommand, destroyCameraCommand, disableGeneratorCommand,
  equipItemOnMapCommand, unequipItemOnMapCommand, unequipImplantOnMapCommand, unequipConsumableOnMapCommand,
  useConcealmentCommand, hackControlRoomCommand,
  encounterAmbushCommand, encounterIgnoreCommand, encounterEvadeCommand, encounterDeceiveCommand, encounterFightCommand,
  useMapConsumableCommand,
  acquireContractGoodsCommand, destroyContractTargetCommand, detonateContractChargeCommand,
  acquireContractIntelCommand, transmitContractIntelCommand,
  disposeCorpseCommand, cleanTracesCommand, cutPowerCommand, broadcastFalseTargetCommand, plantFakeNoiseCommand,
  selectFarmRewardCommand, waitCommand, toggleOverrideArmCommand,
} from './facilityReducer.js';
import {
  playCardCommand, endTurnCommand, useConsumable, beginDisengageCommand, cancelDisengageCommand,
  resolveDisengageCommand, toggleOverloadCommand, getDeckEntries, debugWinCombatCommand,
  useOverrideChipInCombat,
} from './combatReducer.js';
import { selectReward, confirmRewards } from './rewardReducer.js';
import {
  equipItem, equipItemFromWarehouse, unequipItem, unequipImplant, unequipConsumable,
  moveItemBetweenCollections, discardItem,
} from './inventoryReducer.js';

export { BASE_MAX_HP, BASE_INVENTORY_CAPACITY } from './loadoutReducer.js';
export { getDeckEntries };

/**
 * `command` is a discriminated union keyed by `.type` (NEW_RUN, SET_LOADOUT_SLOT, MOVE_TO_NODE,
 * PLAY_CARD, ...) — each branch destructures different fields, so it's typed loosely here rather
 * than spelled out as a full union.
 * @param {import('./types.js').GameSnapshot} snapshot
 * @param {*} command
 * @returns {import('./types.js').GameSnapshot}
 */
export function gameReducer(snapshot, command) {
  switch (command.type) {
    case 'NEW_RUN': return newRun(command.seed);
    case 'ACCEPT_CONTRACT': return acceptContractCommand(snapshot, command.contractId);
    case 'SET_LOADOUT_SLOT': return setLoadoutSlot(snapshot, command.slotType, command.id);
    case 'CONFIRM_LOADOUT': return confirmLoadout(snapshot);
    case 'AUTO_EQUIP_LOADOUT': return autoEquipLoadout(snapshot);
    // 역할군 프리셋은 리듀서 안에서 "전부 창고로 → 목록대로 장착"을 순차 적용한다 — 화면이
    // 장착 액션을 열댓 번 쏘면 되돌리기가 그만큼 잘게 쪼개진다.
    case 'APPLY_LOADOUT_PRESET': return applyLoadoutPreset(snapshot, command.presetId);
    case 'MOVE_TO_NODE': return moveToNode(snapshot, command.nodeId);
    case 'REQUEST_EXTRACTION': return requestExtractionCommand(snapshot, command.exitId);
    case 'BASIC_RECON': return basicReconCommand(snapshot);
    // 대기(planned §4). WAIT은 1칸, WAIT_BATCH는 최대 5칸 묶음이며 사건이 나면 즉시 멈춘다.
    case 'WAIT': return waitCommand(snapshot, 1);
    case 'WAIT_BATCH': return waitCommand(snapshot, command.ticks);
    case 'USE_CONCEALMENT': return useConcealmentCommand(snapshot);
    case 'HACK_CONTROL_ROOM': return hackControlRoomCommand(snapshot);
    case 'ACQUIRE_CONTRACT_GOODS': return acquireContractGoodsCommand(snapshot);
    case 'DESTROY_CONTRACT_TARGET': return destroyContractTargetCommand(snapshot);
    case 'DETONATE_CONTRACT_CHARGE': return detonateContractChargeCommand(snapshot);
    case 'ACQUIRE_CONTRACT_INTEL': return acquireContractIntelCommand(snapshot);
    case 'TRANSMIT_CONTRACT_INTEL': return transmitContractIntelCommand(snapshot);
    case 'SELECT_FARM_REWARD': return selectFarmRewardCommand(snapshot, command.optionIndex);
    case 'DISPOSE_CORPSE': return disposeCorpseCommand(snapshot);
    case 'CLEAN_TRACES': return cleanTracesCommand(snapshot);
    case 'CUT_POWER': return cutPowerCommand(snapshot);
    case 'BROADCAST_FALSE_TARGET': return broadcastFalseTargetCommand(snapshot, command.targetSectorId);
    case 'PLANT_FAKE_NOISE': return plantFakeNoiseCommand(snapshot, command.targetNodeId);
    case 'ENCOUNTER_AMBUSH': return encounterAmbushCommand(snapshot);
    case 'ENCOUNTER_IGNORE': return encounterIgnoreCommand(snapshot);
    case 'ENCOUNTER_EVADE': return encounterEvadeCommand(snapshot);
    case 'ENCOUNTER_DECEIVE': return encounterDeceiveCommand(snapshot);
    case 'ENCOUNTER_FIGHT': return encounterFightCommand(snapshot);
    case 'USE_MAP_CONSUMABLE': return useMapConsumableCommand(snapshot, command.itemId);
    case 'HACK_CAMERA': return hackCameraCommand(snapshot, command.cameraId);
    case 'HACK_ACCESS_INTERFACE': return hackAccessInterfaceCommand(snapshot, command.interfaceId);
    case 'DESTROY_CAMERA': return destroyCameraCommand(snapshot, command.cameraId);
    case 'DISABLE_GENERATOR': return disableGeneratorCommand(snapshot, command.generatorId, command.capabilityKind);
    case 'OPEN_SPECIAL_EDGE': return openSpecialEdgeCommand(snapshot, command.edgeId, command.capabilityKind, command.mode);
    case 'USE_OPPORTUNITY': return useOpportunityCommand(snapshot, command.opportunityId, command.mode);
    case 'USE_FIELD_EQUIPMENT': return useFieldEquipmentCommand(snapshot, command.instanceId, command.targetId);
    // 과부화 토글 — 지도에서도 전투 플레이어 턴에서도 받는다. 대가가 없어 시간을 흘리지 않는다.
    case 'TOGGLE_OVERLOAD': return toggleOverloadCommand(snapshot);
    case 'PLAY_CARD': return playCardCommand(snapshot, command.instanceId, command.targetId);
    case 'END_TURN': return endTurnCommand(snapshot);
    // 디버그 전용(CombatScreen의 'DEBUG 즉시 승리'). 정상 승리와 같은 처리 경로를 탄다.
    case 'DEBUG_WIN_COMBAT': return debugWinCombatCommand(snapshot);
    case 'USE_CONSUMABLE': return useConsumable(snapshot, command.itemId);
    // 오버라이드 칩은 지도와 전투가 같은 통을 쓰므로(ADR-0086) 커맨드도 하나다 — 어느 화면에
    // 있느냐가 "긴급 권한 코드(사용 중 상태)"인지 "충격 코어(적 전원 스턴)"인지를 가른다.
    case 'USE_OVERRIDE_CHIP':
      return snapshot.currentScreen === 'combat' ? useOverrideChipInCombat(snapshot) : toggleOverrideArmCommand(snapshot);
    case 'BEGIN_DISENGAGE': return beginDisengageCommand(snapshot);
    case 'CANCEL_DISENGAGE': return cancelDisengageCommand(snapshot);
    case 'RESOLVE_DISENGAGE': return resolveDisengageCommand(snapshot);
    case 'SELECT_REWARD': return selectReward(snapshot, command.slotKey, command.optionIndex);
    case 'CONFIRM_REWARDS': return confirmRewards(snapshot);
    // 맵에서는 장비 교체 1건마다 시간(MAP_EQUIP_TIME_COST)이 든다 — 출격 준비(loadout) 화면에서는
    // 그대로 무료/즉시.
    case 'EQUIP_ITEM':
      return snapshot.currentScreen === 'map' ? equipItemOnMapCommand(snapshot, command.itemId) : equipItem(snapshot, command.itemId);
    case 'EQUIP_ITEM_FROM_WAREHOUSE': return equipItemFromWarehouse(snapshot, command.itemId);
    case 'UNEQUIP_ITEM':
      return snapshot.currentScreen === 'map' ? unequipItemOnMapCommand(snapshot, command.itemId) : unequipItem(snapshot, command.itemId);
    case 'UNEQUIP_IMPLANT':
      return snapshot.currentScreen === 'map' ? unequipImplantOnMapCommand(snapshot, command.equipmentId) : unequipImplant(snapshot, command.equipmentId);
    case 'UNEQUIP_CONSUMABLE':
      return snapshot.currentScreen === 'map' ? unequipConsumableOnMapCommand(snapshot, command.itemId) : unequipConsumable(snapshot, command.itemId);
    case 'MOVE_TO_INVENTORY': return moveItemBetweenCollections(snapshot, command.itemId, 'warehouse', 'inventory');
    case 'MOVE_TO_WAREHOUSE': return moveItemBetweenCollections(snapshot, command.itemId, 'inventory', 'warehouse');
    case 'DISCARD_ITEM': return discardItem(snapshot, command.itemId);
    default:
      throw new Error(`Unknown command type "${command.type}"`);
  }
}
