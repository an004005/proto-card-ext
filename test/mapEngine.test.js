import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRngState } from '../src/engine/rng.js';
import {
  generateMap, createMapState, getAvailableNodeIds, markNodeDone, getNode, isMapComplete,
} from '../src/engine/mapEngine.js';
import {
  MAP_FLOOR_COUNT, NODES_PER_FLOOR_MIN, NODES_PER_FLOOR_MAX,
  ELITE_MIN_FLOOR, ELITE_MAX_FLOOR, ELITE_MAX_PER_FLOOR, UNKNOWN_MAX_PER_FLOOR, REST_MAX_PER_FLOOR,
} from '../src/data/mapLayout.js';

test('generateMap is deterministic for the same seed', () => {
  const a = generateMap(createRngState(7));
  const b = generateMap(createRngState(7));
  assert.deepEqual(a.mapData, b.mapData);
});

test('generateMap produces MAP_FLOOR_COUNT floors, a single boss node on the last floor, and 2-4 nodes per earlier floor', () => {
  const { mapData } = generateMap(createRngState(99));
  const floors = {};
  for (const n of mapData.nodes) (floors[n.floor] ||= []).push(n);
  assert.equal(Object.keys(floors).length, MAP_FLOOR_COUNT);
  for (let f = 1; f < MAP_FLOOR_COUNT; f++) {
    assert.ok(floors[f].length >= NODES_PER_FLOOR_MIN && floors[f].length <= NODES_PER_FLOOR_MAX, `floor ${f} node count out of range`);
  }
  assert.equal(floors[MAP_FLOOR_COUNT].length, 1);
  assert.equal(floors[MAP_FLOOR_COUNT][0].type, 'boss');
});

test('elite nodes only appear within [ELITE_MIN_FLOOR, ELITE_MAX_FLOOR] and at most ELITE_MAX_PER_FLOOR per floor', () => {
  for (let seed = 0; seed < 25; seed++) {
    const { mapData } = generateMap(createRngState(seed));
    const byFloor = {};
    for (const n of mapData.nodes) {
      if (n.type !== 'elite') continue;
      assert.ok(n.floor >= ELITE_MIN_FLOOR && n.floor <= ELITE_MAX_FLOOR, `elite on floor ${n.floor} (seed ${seed})`);
      byFloor[n.floor] = (byFloor[n.floor] || 0) + 1;
      assert.ok(byFloor[n.floor] <= ELITE_MAX_PER_FLOOR, `too many elites on floor ${n.floor} (seed ${seed})`);
    }
  }
});

test('unknown/rest node counts respect their per-floor caps', () => {
  for (let seed = 0; seed < 25; seed++) {
    const { mapData } = generateMap(createRngState(seed));
    const byFloor = {};
    for (const n of mapData.nodes) {
      if (n.type !== 'unknown' && n.type !== 'rest') continue;
      const key = `${n.floor}:${n.type}`;
      byFloor[key] = (byFloor[key] || 0) + 1;
      const cap = n.type === 'unknown' ? UNKNOWN_MAX_PER_FLOOR : REST_MAX_PER_FLOOR;
      assert.ok(byFloor[key] <= cap, `too many ${n.type} on floor ${n.floor} (seed ${seed})`);
    }
  }
});

test('every node is reachable from floor 1 (edges never leave a later-floor node with zero incoming links)', () => {
  const { mapData } = generateMap(createRngState(11));
  const incoming = new Set(mapData.edges.map((e) => e.to));
  for (const n of mapData.nodes) {
    if (n.floor === 1) continue;
    assert.ok(incoming.has(n.id), `node ${n.id} (floor ${n.floor}) has no incoming edge`);
  }
});

test('getAvailableNodeIds starts as all floor-1 nodes, then follows edges from the current node', () => {
  const { mapData } = generateMap(createRngState(3));
  let mapState = createMapState(mapData);
  const floor1Ids = mapData.nodes.filter((n) => n.floor === 1).map((n) => n.id);
  assert.deepEqual(getAvailableNodeIds(mapState).sort(), floor1Ids.sort());

  const firstId = floor1Ids[0];
  mapState = markNodeDone(mapState, firstId);
  const expectedNext = mapData.edges.filter((e) => e.from === firstId).map((e) => e.to);
  assert.deepEqual(getAvailableNodeIds(mapState).sort(), expectedNext.sort());
  assert.equal(mapState.currentNodeId, firstId);
  assert.deepEqual(mapState.visitedNodeIds, [firstId]);
});

test('isMapComplete is true only once the current node is the visited boss node', () => {
  const { mapData } = generateMap(createRngState(3));
  let mapState = createMapState(mapData);
  assert.equal(isMapComplete(mapState), false);
  const bossNode = mapData.nodes.find((n) => n.type === 'boss');
  mapState = markNodeDone(mapState, bossNode.id);
  assert.equal(isMapComplete(mapState), true);
  assert.equal(getNode(mapState, bossNode.id).type, 'boss');
});
