// Procedural branching map (replaces the old stageEngine.js linear STAGE_STEPS). Generated once
// per run from the seeded rngState (same pattern as combat/reward rolls — reproducible under
// undo/redo). Node types are visible from the start; only reachability changes as the player
// advances (no fog of war on the node graph itself).
import { nextInt, pick, weightedPick } from './rng.js';
import {
  MAP_FLOOR_COUNT, NODES_PER_FLOOR_MIN, NODES_PER_FLOOR_MAX, NODE_TYPE_WEIGHTS,
  ELITE_MIN_FLOOR, ELITE_MAX_FLOOR, ELITE_MAX_PER_FLOOR, UNKNOWN_MAX_PER_FLOOR, REST_MAX_PER_FLOOR,
  MAP_ENCOUNTER_TEMPLATES, BOSS_ENCOUNTER_TEMPLATES,
} from '../data/mapLayout.js';

/** @typedef {import('./types.js').RngState} RngState */
/** @typedef {import('./types.js').MapData} MapData */
/** @typedef {import('./types.js').MapNode} MapNode */
/** @typedef {import('./types.js').MapState} MapState */

/**
 * @param {RngState} rngState
 * @param {number} floor
 * @param {{elite: number, unknown: number, rest: number}} counts
 * @returns {{value: string, state: RngState}}
 */
function pickNodeType(rngState, floor, counts) {
  const allowed = NODE_TYPE_WEIGHTS.filter((w) => {
    if (w.value === 'elite') {
      if (floor < ELITE_MIN_FLOOR || floor > ELITE_MAX_FLOOR) return false;
      if (counts.elite >= ELITE_MAX_PER_FLOOR) return false;
    }
    if (w.value === 'unknown' && counts.unknown >= UNKNOWN_MAX_PER_FLOOR) return false;
    if (w.value === 'rest' && counts.rest >= REST_MAX_PER_FLOOR) return false;
    return true;
  });
  return weightedPick(rngState, allowed.length ? allowed : [{ value: 'combat', weight: 1 }]);
}

/**
 * @param {RngState} rngState
 * @param {string} type
 * @returns {{encounter: ?MapNode['encounter'], state: RngState}}
 */
function pickEncounter(rngState, type) {
  if (type === 'elite') {
    const { value: monsterIds, state } = pick(rngState, MAP_ENCOUNTER_TEMPLATES.elite);
    return { encounter: { monsterIds, tier: 'elite' }, state };
  }
  if (type === 'combat') {
    const { value: monsterIds, state } = pick(rngState, MAP_ENCOUNTER_TEMPLATES.normal);
    return { encounter: { monsterIds, tier: 'normal' }, state };
  }
  return { encounter: null, state: rngState };
}

/**
 * @param {RngState} rngState
 * @returns {{mapData: MapData, rngState: RngState}}
 */
export function generateMap(rngState) {
  let rng = rngState;
  const nodes = [];
  const edges = [];
  const floorNodeIds = [];

  for (let floor = 1; floor <= MAP_FLOOR_COUNT - 1; floor++) {
    const countRoll = nextInt(rng, NODES_PER_FLOOR_MAX - NODES_PER_FLOOR_MIN + 1);
    rng = countRoll.state;
    const nodeCount = NODES_PER_FLOOR_MIN + countRoll.value;
    const counts = { elite: 0, unknown: 0, rest: 0 };
    const ids = [];
    for (let i = 0; i < nodeCount; i++) {
      const typeRoll = pickNodeType(rng, floor, counts);
      rng = typeRoll.state;
      const type = typeRoll.value;
      if (type in counts) counts[type] += 1;
      const encRoll = pickEncounter(rng, type);
      rng = encRoll.state;
      const id = `f${floor}n${i}`;
      nodes.push({ id, floor, type, encounter: encRoll.encounter });
      ids.push(id);
    }
    floorNodeIds.push(ids);
  }

  const bossId = `f${MAP_FLOOR_COUNT}n0`;
  const bossPick = pick(rng, BOSS_ENCOUNTER_TEMPLATES);
  rng = bossPick.state;
  nodes.push({ id: bossId, floor: MAP_FLOOR_COUNT, type: 'boss', encounter: { monsterIds: bossPick.value, tier: 'boss' } });
  floorNodeIds.push([bossId]);

  // Connect each floor to the next: every node gets 1-2 forward edges, then any next-floor
  // node with zero incoming edges is patched with an edge from a random node in this floor.
  for (let f = 0; f < floorNodeIds.length - 1; f++) {
    const fromIds = floorNodeIds[f];
    const toIds = floorNodeIds[f + 1];
    const incoming = new Set();
    for (const fromId of fromIds) {
      const linkCountRoll = nextInt(rng, 2);
      rng = linkCountRoll.state;
      const linkCount = Math.min(toIds.length, 1 + linkCountRoll.value);
      const shuffledTargets = [...toIds];
      for (let i = shuffledTargets.length - 1; i > 0; i--) {
        const j = nextInt(rng, i + 1);
        rng = j.state;
        [shuffledTargets[i], shuffledTargets[j.value]] = [shuffledTargets[j.value], shuffledTargets[i]];
      }
      for (let i = 0; i < linkCount; i++) {
        edges.push({ from: fromId, to: shuffledTargets[i] });
        incoming.add(shuffledTargets[i]);
      }
    }
    for (const toId of toIds) {
      if (incoming.has(toId)) continue;
      const pickFrom = pick(rng, fromIds);
      rng = pickFrom.state;
      edges.push({ from: pickFrom.value, to: toId });
    }
  }

  return { mapData: { nodes, edges }, rngState: rng };
}

/** @param {MapData} mapData @returns {MapState} */
export function createMapState(mapData) {
  return { mapData, currentNodeId: null, visitedNodeIds: [] };
}

/**
 * @param {MapState} mapState
 * @param {?string} nodeId
 * @returns {?MapNode}
 */
export function getNode(mapState, nodeId) {
  return mapState.mapData.nodes.find((n) => n.id === nodeId) || null;
}

/** @param {MapState} mapState @returns {string[]} */
export function getAvailableNodeIds(mapState) {
  if (mapState.currentNodeId === null) {
    return mapState.mapData.nodes.filter((n) => n.floor === 1).map((n) => n.id);
  }
  return mapState.mapData.edges.filter((e) => e.from === mapState.currentNodeId).map((e) => e.to);
}

/**
 * @param {MapState} mapState
 * @param {string} nodeId
 * @returns {MapState}
 */
export function markNodeDone(mapState, nodeId) {
  return {
    ...mapState,
    currentNodeId: nodeId,
    visitedNodeIds: mapState.visitedNodeIds.includes(nodeId) ? mapState.visitedNodeIds : [...mapState.visitedNodeIds, nodeId],
  };
}

/**
 * Ambush encounters (§7.3, triggered from the 미지의 방 2택1) aren't tied to a specific map
 * node, so they pick from the same normal-tier template pool used for combat nodes.
 * @param {RngState} rngState
 * @returns {{monsterIds: string[], rngState: RngState}}
 */
export function pickAmbushEncounter(rngState) {
  const { value: monsterIds, state } = pick(rngState, MAP_ENCOUNTER_TEMPLATES.normal);
  return { monsterIds, rngState: state };
}

/** @param {MapState} mapState @returns {boolean} */
export function isMapComplete(mapState) {
  const node = getNode(mapState, mapState.currentNodeId);
  return !!node && node.type === 'boss' && mapState.visitedNodeIds.includes(node.id);
}
