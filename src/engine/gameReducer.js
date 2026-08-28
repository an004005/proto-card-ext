// Pure command reducer: (GameSnapshot, command) => GameSnapshot. No Preact/DOM dependency —
// the whole run (loadout -> map -> extraction/death) can be played headlessly with
// `node --test`. state/dispatch.js is the only caller that wires this to signals.
//
// This file is a thin dispatch table only — each command family's actual logic lives in its own
// module (§코드 리뷰 책임 분리): loadoutReducer.js (출격 준비), facilityReducer.js (시설맵
// 행동), combatReducer.js (전투/이탈), rewardReducer.js (보상), inventoryReducer.js (장비/짐
// 정리). Dependency direction is one-way: inventoryReducer <- rewardReducer <- combatReducer <-
// facilityReducer, and loadoutReducer depends only on inventoryReducer + runEngine.js — no cycles.
import { newRun, setLoadoutSlot, confirmLoadout, autoEquipLoadout } from './loadoutReducer.js';
import {
  moveToNode, requestExtractionCommand, basicReconCommand, openSpecialEdgeCommand,
  useOpportunityCommand, useFieldEquipmentCommand, hackCameraCommand, hackAccessInterfaceCommand, destroyCameraCommand, disableGeneratorCommand,
} from './facilityReducer.js';
import {
  playCardCommand, endTurnCommand, useConsumable, beginDisengageCommand, cancelDisengageCommand,
  resolveDisengageCommand, getDeckEntries,
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
    case 'SET_LOADOUT_SLOT': return setLoadoutSlot(snapshot, command.slotType, command.id);
    case 'CONFIRM_LOADOUT': return confirmLoadout(snapshot);
    case 'AUTO_EQUIP_LOADOUT': return autoEquipLoadout(snapshot);
    case 'MOVE_TO_NODE': return moveToNode(snapshot, command.nodeId);
    case 'REQUEST_EXTRACTION': return requestExtractionCommand(snapshot, command.exitId);
    case 'BASIC_RECON': return basicReconCommand(snapshot);
    case 'HACK_CAMERA': return hackCameraCommand(snapshot, command.cameraId);
    case 'HACK_ACCESS_INTERFACE': return hackAccessInterfaceCommand(snapshot, command.interfaceId);
    case 'DESTROY_CAMERA': return destroyCameraCommand(snapshot, command.cameraId);
    case 'DISABLE_GENERATOR': return disableGeneratorCommand(snapshot, command.generatorId, command.capabilityKind);
    case 'OPEN_SPECIAL_EDGE': return openSpecialEdgeCommand(snapshot, command.edgeId, command.capabilityKind, command.mode);
    case 'USE_OPPORTUNITY': return useOpportunityCommand(snapshot, command.opportunityId, command.mode);
    case 'USE_FIELD_EQUIPMENT': return useFieldEquipmentCommand(snapshot, command.instanceId, command.targetId);
    case 'PLAY_CARD': return playCardCommand(snapshot, command.instanceId, command.targetId);
    case 'END_TURN': return endTurnCommand(snapshot);
    case 'USE_CONSUMABLE': return useConsumable(snapshot, command.itemId);
    case 'BEGIN_DISENGAGE': return beginDisengageCommand(snapshot);
    case 'CANCEL_DISENGAGE': return cancelDisengageCommand(snapshot);
    case 'RESOLVE_DISENGAGE': return resolveDisengageCommand(snapshot);
    case 'SELECT_REWARD': return selectReward(snapshot, command.slotKey, command.optionIndex);
    case 'CONFIRM_REWARDS': return confirmRewards(snapshot);
    case 'EQUIP_ITEM': return equipItem(snapshot, command.itemId);
    case 'EQUIP_ITEM_FROM_WAREHOUSE': return equipItemFromWarehouse(snapshot, command.itemId);
    case 'UNEQUIP_ITEM': return unequipItem(snapshot, command.itemId);
    case 'UNEQUIP_IMPLANT': return unequipImplant(snapshot, command.equipmentId);
    case 'UNEQUIP_CONSUMABLE': return unequipConsumable(snapshot, command.itemId);
    case 'MOVE_TO_INVENTORY': return moveItemBetweenCollections(snapshot, command.itemId, 'warehouse', 'inventory');
    case 'MOVE_TO_WAREHOUSE': return moveItemBetweenCollections(snapshot, command.itemId, 'inventory', 'warehouse');
    case 'DISCARD_ITEM': return discardItem(snapshot, command.itemId);
    default:
      throw new Error(`Unknown command type "${command.type}"`);
  }
}
