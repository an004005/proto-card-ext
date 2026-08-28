import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph, computeWeightedDistance } from '../src/engine/facilityGraph.js';
import { countEdgeDisjointPaths, reachableSet } from '../src/engine/graphUtils.js';
import {
  SECTOR_IDS, NODES_PER_SECTOR, TOTAL_NODES, THREAT_COUNT_BY_SECTOR, EXIT_DISTANCE_RANGES,
  SPECIAL_EDGES_PER_SECTOR_MIN, SPECIAL_EDGES_PER_SECTOR_MAX,
  CROSS_SECTOR_SPECIAL_EDGES_MIN, CROSS_SECTOR_SPECIAL_EDGES_MAX,
  LONG_RANGE_SPECIAL_EDGES_MIN, LONG_RANGE_SPECIAL_EDGES_MAX, SECTOR_ADJACENCY,
} from '../src/data/facilityLayout.js';

const ADJACENT_SECTOR_KEYS = new Set(SECTOR_ADJACENCY.map(([a, b]) => [a, b].sort().join('|')));

/** @param {string} nodeId */
function sectorOf(nodeId) { return nodeId.split('_')[0]; }

// #1 동일 seed는 그래프/위협/기회/열쇠 드롭을 동일하게 생성한다.
test('generateFacilityGraph is fully deterministic for the same seed', () => {
  const a = generateFacilityGraph(1234);
  const b = generateFacilityGraph(1234);
  assert.deepEqual(a.graph, b.graph);
  assert.equal(a.rngState, b.rngState);
  assert.equal(a.usedFallback, b.usedFallback);
});

test('different seeds usually produce different graphs', () => {
  const a = generateFacilityGraph(1);
  const b = generateFacilityGraph(2);
  assert.notDeepEqual(a.graph.edges, b.graph.edges);
});

// #2 48노드, 구역별 12노드, 위협 2/3/4/3, 특수 엣지 12~16.
test('node/sector/threat/special-edge counts match the spec for many seeds', () => {
  for (let seed = 0; seed < 40; seed++) {
    const { graph } = generateFacilityGraph(seed);
    assert.equal(graph.nodes.length, TOTAL_NODES, `seed ${seed}: node count`);

    const bySector = {};
    for (const node of graph.nodes) (bySector[node.sectorId] ||= []).push(node);
    for (const sectorId of SECTOR_IDS) {
      assert.equal(bySector[sectorId]?.length, NODES_PER_SECTOR, `seed ${seed}: ${sectorId} node count`);
    }

    const threatsBySector = {};
    for (const threat of graph.threats) threatsBySector[threat.sectorId] = (threatsBySector[threat.sectorId] || 0) + 1;
    for (const sectorId of SECTOR_IDS) {
      assert.equal(threatsBySector[sectorId] || 0, THREAT_COUNT_BY_SECTOR[sectorId], `seed ${seed}: ${sectorId} threat count`);
    }
    assert.equal(graph.generators.length, 2, `seed ${seed}: two battery generators`);
    assert.deepEqual(new Set(graph.generators.map((generator) => generator.sectorId)), new Set(['power', 'labs']));
    for (const generator of graph.generators) {
      assert.equal(graph.nodes.find((node) => node.id === generator.nodeId)?.sectorId, generator.sectorId);
    }

    const specialEdges = graph.edges.filter((e) => e.features.length > 0);
    const withinSector = specialEdges.filter((e) => sectorOf(e.from) === sectorOf(e.to));
    const crossSector = specialEdges.filter((e) => sectorOf(e.from) !== sectorOf(e.to));
    const adjacentCross = crossSector.filter((e) => ADJACENT_SECTOR_KEYS.has([sectorOf(e.from), sectorOf(e.to)].sort().join('|')));
    const longRange = crossSector.filter((e) => !ADJACENT_SECTOR_KEYS.has([sectorOf(e.from), sectorOf(e.to)].sort().join('|')));
    const withinTotalMin = SECTOR_IDS.length * SPECIAL_EDGES_PER_SECTOR_MIN;
    const withinTotalMax = SECTOR_IDS.length * SPECIAL_EDGES_PER_SECTOR_MAX;
    const crossTotalMin = SECTOR_IDS.length * CROSS_SECTOR_SPECIAL_EDGES_MIN;
    const crossTotalMax = SECTOR_IDS.length * CROSS_SECTOR_SPECIAL_EDGES_MAX;
    assert.ok(withinSector.length >= withinTotalMin && withinSector.length <= withinTotalMax, `seed ${seed}: within-sector special edge total ${withinSector.length}`);
    assert.ok(adjacentCross.length >= crossTotalMin && adjacentCross.length <= crossTotalMax, `seed ${seed}: adjacent cross-sector special edge total ${adjacentCross.length}`);
    // 원거리 지름길은 "매우 소수"가 요구사항이라, 인접 쌍처럼 상한을 넉넉히 잡지 않고 정확히
    // LONG_RANGE_SPECIAL_EDGES_MIN~MAX 범위(구역 쌍당이 아니라 그래프 전체 기준)인지 확인한다.
    assert.ok(longRange.length >= LONG_RANGE_SPECIAL_EDGES_MIN && longRange.length <= LONG_RANGE_SPECIAL_EDGES_MAX, `seed ${seed}: long-range special edge total ${longRange.length}`);

    const withinBySector = {};
    for (const edge of withinSector) {
      const sectorId = sectorOf(edge.from);
      withinBySector[sectorId] = (withinBySector[sectorId] || 0) + 1;
    }
    for (const sectorId of SECTOR_IDS) {
      const count = withinBySector[sectorId] || 0;
      assert.ok(
        count >= SPECIAL_EDGES_PER_SECTOR_MIN && count <= SPECIAL_EDGES_PER_SECTOR_MAX,
        `seed ${seed}: ${sectorId} within-sector special edge count ${count}`,
      );
    }
  }
});

// #3 세 탈출구가 서로 다른 구역, A<열쇠<B, 각 범위 안, 2개 edge-disjoint 경로. fallback 사용률도 확인.
test('exit placement satisfies distance ranges, ordering, distinct sectors, and 2 edge-disjoint paths', () => {
  let fallbackCount = 0;
  const sampleSize = 300;
  for (let seed = 0; seed < sampleSize; seed++) {
    const { graph, usedFallback } = generateFacilityGraph(seed);
    if (usedFallback) fallbackCount += 1;

    assert.equal(graph.exits.length, 3, `seed ${seed}: exit count`);
    const bySectorSet = new Set(graph.exits.map((e) => e.sectorId));
    assert.equal(bySectorSet.size, 3, `seed ${seed}: exits must be in 3 distinct sectors`);

    // §2.2 distance ranges are validated against the base facility graph (standard corridors
    // only) at placement time and stored on the exit — that stored value is authoritative.
    // Special edges (§4.2) are layered on afterwards as bonus shortcuts a player may or may not
    // have the capability to use, so they can only ever make the *actual* graph distance equal
    // or shorter, never invalidate the placement; we only sanity-check that direction here.
    const byId = Object.fromEntries(graph.exits.map((e) => [e.exitId, e]));
    for (const exitId of ['A', 'key', 'B']) {
      const range = EXIT_DISTANCE_RANGES[exitId];
      const stored = byId[exitId].weightedDistanceFromStart;
      assert.ok(stored >= range.min && stored <= range.max, `seed ${seed}: exit ${exitId} distance ${stored} out of [${range.min},${range.max}]`);
      const distWithSpecialEdges = computeWeightedDistance(graph.edges, graph.startNodeId, byId[exitId].nodeId);
      assert.ok(distWithSpecialEdges <= stored, `seed ${seed}: exit ${exitId} full-graph distance ${distWithSpecialEdges} exceeds stored ${stored}`);
    }
    assert.ok(byId.A.weightedDistanceFromStart < byId.key.weightedDistanceFromStart, `seed ${seed}: A < key`);
    assert.ok(byId.key.weightedDistanceFromStart < byId.B.weightedDistanceFromStart, `seed ${seed}: key < B`);

    for (const exit of graph.exits) {
      const paths = countEdgeDisjointPaths(graph.edges, graph.startNodeId, exit.nodeId, 2);
      assert.equal(paths, 2, `seed ${seed}: exit ${exit.exitId} has only ${paths} edge-disjoint path(s)`);
    }
  }
  // §11.3 인수 기준 3의 99.5% 목표는 10,000 seed 전수 검증용. 여기서는 빠른 스모크 체크로,
  // 이 표본에서도 fallback이 드물게만 쓰이는지 확인한다 (전수 10,000-seed 검증은 별도 느린 스크립트로 돌린다).
  const fallbackRate = fallbackCount / sampleSize;
  assert.ok(fallbackRate < 0.05, `fallback used too often in sample: ${fallbackCount}/${sampleSize}`);
});

test('every node is reachable from the start node', () => {
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const reachable = reachableSet(graph.edges, graph.startNodeId);
    assert.equal(reachable.size, graph.nodes.length, `seed ${seed}: not all nodes reachable from start`);
  }
});

// #11 모든 특수 엣지와 랜드마크는 두 개 이상 접근법을 제공한다 (데이터 계약 확인).
test('landmarks declare at least two capability approaches', () => {
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    assert.equal(graph.landmarks.length, SECTOR_IDS.length);
    for (const landmark of graph.landmarks) {
      assert.ok(landmark.approaches.length >= 2, `landmark ${landmark.id} has <2 approaches`);
    }
  }
});

// #20 (일부) 경로 단절 뒤에도 시작점->탈출구 경로가 남는다. 특수 엣지는 base 그래프에 얹는
// 추가 엣지일 뿐이므로(설계상 결정), blocked 태그가 붙은 엣지를 전부 제거해도 base 그래프의
// 2-edge-disjoint 보장은 그대로 남아야 한다.
test('removing every blocked special edge still leaves 2 edge-disjoint paths to each exit', () => {
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const withoutBlocked = graph.edges.filter((e) => !e.features.includes('blocked'));
    for (const exit of graph.exits) {
      const paths = countEdgeDisjointPaths(withoutBlocked, graph.startNodeId, exit.nodeId, 2);
      assert.equal(paths, 2, `seed ${seed}: exit ${exit.exitId} loses redundancy once blocked edges are removed`);
    }
  }
});

test('opportunities carry a keyEligible roll and a 1-3 usesRemaining fixed at generation time', () => {
  const { graph } = generateFacilityGraph(42);
  assert.ok(graph.opportunities.length > 0);
  for (const opportunity of graph.opportunities) {
    assert.equal(typeof opportunity.keyEligible, 'boolean');
    assert.ok(opportunity.usesRemaining >= 1 && opportunity.usesRemaining <= 3);
  }
});

test('cameras and access interfaces are deterministic, independent, and present in every sector', () => {
  const { graph } = generateFacilityGraph(42);
  assert.ok(graph.cameras.length > 0);
  assert.ok(graph.accessInterfaces.length > 0);
  for (const sectorId of SECTOR_IDS) {
    assert.ok(graph.cameras.some((device) => device.nodeId.startsWith(`${sectorId}_`)), `${sectorId}: camera`);
    assert.ok(graph.accessInterfaces.some((device) => device.nodeId.startsWith(`${sectorId}_`)), `${sectorId}: interface`);
  }
  assert.ok(graph.nodes.some((node) => {
    const hasCamera = graph.cameras.some((device) => device.nodeId === node.id);
    const hasInterface = graph.accessInterfaces.some((device) => device.nodeId === node.id);
    return hasCamera !== hasInterface;
  }), 'at least one node should demonstrate that the two device rolls are independent');
});

test('generated special edges include Mobility-3 high-ground routes', () => {
  let count = 0;
  for (let seed = 0; seed < 20; seed++) {
    count += generateFacilityGraph(seed).graph.edges.filter((edge) => edge.features.includes('highGround')).length;
  }
  assert.ok(count > 0);
});

test('threat patrol routes stay within their own sector and within the configured length', () => {
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    for (const threat of graph.threats) {
      assert.ok(threat.patrolRoute.length >= 2 && threat.patrolRoute.length <= 4, `seed ${seed}: threat ${threat.id} route length ${threat.patrolRoute.length}`);
      for (const nodeId of threat.patrolRoute) {
        assert.ok(nodeId.startsWith(`${threat.sectorId}_`), `seed ${seed}: threat ${threat.id} route leaves its sector`);
      }
    }
  }
});
