import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph, sectorRingPairs, findPlainEdgeViolations } from '../src/engine/facilityGraph.js';
import { countEdgeDisjointPaths, reachableSet, baselineWalkDistances, baselineWalkArcs } from '../src/engine/graphUtils.js';
import {
  ALL_SECTOR_IDS, SECTOR_LAYOUTS, totalNodesFor, THREAT_COUNT_BY_SECTOR,
  GENERATOR_SECTOR_IDS,
  ARCHITECTURAL_SPECIAL_EDGES_BY_SECTOR, TOWER_ELEVATOR_REQUIREMENT, NODE_MIN_SEPARATION,
  SECTOR_NODE_RADIUS,
  SPECIAL_EDGES_PER_SECTOR_MIN, SPECIAL_EDGES_PER_SECTOR_MAX,
  CROSS_SECTOR_SPECIAL_EDGES_MIN, CROSS_SECTOR_SPECIAL_EDGES_MAX,
  LONG_RANGE_SPECIAL_EDGES_MIN, LONG_RANGE_SPECIAL_EDGES_MAX,
  LANDMARK_CANDIDATE_MIN, LANDMARK_CANDIDATE_MAX,
} from '../src/data/facilityLayout.js';
import { generateSectorLayout } from '../src/engine/layoutArchetypes.js';
import { createRngState } from '../src/engine/rng.js';

/** 이 런의 링에서 맞닿은 구역 쌍 — 구역이 런마다 다르므로 그래프에서 만든다. @param {{sectorIds: string[]}} graph */
function adjacentSectorKeys(graph) {
  return new Set(sectorRingPairs(graph.sectorIds).map(([a, b]) => [a, b].sort().join('|')));
}

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

// 현재 레이아웃 상수의 노드·구역·위협·특수 엣지 범위를 검증한다.
test('node/sector/threat/special-edge counts match the spec for many seeds', () => {
  for (let seed = 0; seed < 40; seed++) {
    const { graph } = generateFacilityGraph(seed);
    // 노드 수는 배치 원형이 정한 값 + 긴 다리를 쪼개며 끼운 복도 노드다(ADR-0097). 쪼개기는
    // 드물어(런당 0~2개) 구역 크기의 의미는 그대로다.
    const splitIdsBySector = {};
    for (const node of graph.nodes) if (node.id.includes('_split')) (splitIdsBySector[node.sectorId] ||= []).push(node.id);
    const splitTotal = Object.values(splitIdsBySector).reduce((sum, ids) => sum + ids.length, 0);
    assert.equal(graph.nodes.length, totalNodesFor(graph.sectorIds) + splitTotal, `seed ${seed}: node count`);
    assert.ok(splitTotal <= 6, `seed ${seed}: 끼워 넣은 복도 노드가 ${splitTotal}개나 된다`);

    const bySector = {};
    for (const node of graph.nodes) (bySector[node.sectorId] ||= []).push(node);
    for (const sectorId of graph.sectorIds) {
      assert.equal(
        bySector[sectorId]?.length,
        SECTOR_LAYOUTS[sectorId].nodeCount + (splitIdsBySector[sectorId] || []).length,
        `seed ${seed}: ${sectorId} node count`,
      );
    }

    const threatsBySector = {};
    for (const threat of graph.threats) threatsBySector[threat.sectorId] = (threatsBySector[threat.sectorId] || 0) + 1;
    for (const sectorId of graph.sectorIds) {
      assert.equal(threatsBySector[sectorId] || 0, THREAT_COUNT_BY_SECTOR[sectorId], `seed ${seed}: ${sectorId} threat count`);
    }
    // 발전기는 뽑힌 구역 중 전력 구역에만 놓인다 — 둘 다 안 뽑힌 런에는 발전기가 없다.
    const poweredSectorIds = GENERATOR_SECTOR_IDS.filter((id) => graph.sectorIds.includes(id));
    assert.equal(graph.generators.length, poweredSectorIds.length, `seed ${seed}: battery generators`);
    assert.deepEqual(new Set(graph.generators.map((generator) => generator.sectorId)), new Set(poweredSectorIds));
    for (const generator of graph.generators) {
      assert.equal(graph.nodes.find((node) => node.id === generator.nodeId)?.sectorId, generator.sectorId);
    }

    const specialEdges = graph.edges.filter((e) => e.features.length > 0);
    const withinSector = specialEdges.filter((e) => sectorOf(e.from) === sectorOf(e.to));
    const crossSector = specialEdges.filter((e) => sectorOf(e.from) !== sectorOf(e.to));
    const adjacentKeys = adjacentSectorKeys(graph);
    const adjacentCross = crossSector.filter((e) => adjacentKeys.has([sectorOf(e.from), sectorOf(e.to)].sort().join('|')));
    const longRange = crossSector.filter((e) => !adjacentKeys.has([sectorOf(e.from), sectorOf(e.to)].sort().join('|')));
    // 배치 원형이 구조적으로 두는 특수 엣지(통신·관제탑 승강기)는 무작위 배치와 별개로 항상 있다.
    // 그 구역이 이번 런에 뽑혔을 때만 센다.
    const architecturalTotal = graph.sectorIds.reduce((sum, id) => sum + (ARCHITECTURAL_SPECIAL_EDGES_BY_SECTOR[id] || 0), 0);
    const n = graph.sectorIds.length;
    const withinTotalMin = n * SPECIAL_EDGES_PER_SECTOR_MIN + architecturalTotal;
    const withinTotalMax = n * SPECIAL_EDGES_PER_SECTOR_MAX + architecturalTotal;
    const crossTotalMin = n * CROSS_SECTOR_SPECIAL_EDGES_MIN;
    const crossTotalMax = n * CROSS_SECTOR_SPECIAL_EDGES_MAX;
    assert.ok(withinSector.length >= withinTotalMin && withinSector.length <= withinTotalMax, `seed ${seed}: within-sector special edge total ${withinSector.length}`);
    assert.ok(adjacentCross.length >= crossTotalMin && adjacentCross.length <= crossTotalMax, `seed ${seed}: adjacent cross-sector special edge total ${adjacentCross.length}`);
    // 원거리 지름길은 "매우 소수"가 요구사항이라, 인접 쌍처럼 상한을 넉넉히 잡지 않고 정확히
    // LONG_RANGE_SPECIAL_EDGES_MIN~MAX 범위(구역 쌍당이 아니라 그래프 전체 기준)인지 확인한다.
    assert.ok(longRange.length >= LONG_RANGE_SPECIAL_EDGES_MIN && longRange.length <= LONG_RANGE_SPECIAL_EDGES_MAX, `seed ${seed}: long-range special edge total ${longRange.length}`);

    const withinBySector = {};
    const convertedBySector = {};
    for (const edge of withinSector) {
      const sectorId = sectorOf(edge.from);
      withinBySector[sectorId] = (withinBySector[sectorId] || 0) + 1;
      if (edge.fromFloorPlan) convertedBySector[sectorId] = (convertedBySector[sectorId] || 0) + 1;
    }
    for (const sectorId of graph.sectorIds) {
      const count = withinBySector[sectorId] || 0;
      const architectural = ARCHITECTURAL_SPECIAL_EDGES_BY_SECTOR[sectorId] || 0;
      // 정규화 패스가 평면도의 지름길을 특수로 바꾼 것은 정원 안에서 센다(ADR-0097) — 무작위
      // 배치가 그만큼 덜 얹으므로 총량은 그대로다. 다만 한 구역에서 바꿀 것이 정원 상한보다
      // 많으면(드물다) 그만큼은 넘어간다 — 규칙 1이 정원보다 우선한다.
      const converted = convertedBySector[sectorId] || 0;
      assert.ok(
        count >= SPECIAL_EDGES_PER_SECTOR_MIN + architectural
          && count <= Math.max(SPECIAL_EDGES_PER_SECTOR_MAX, converted) + architectural,
        `seed ${seed}: ${sectorId} within-sector special edge count ${count} (평면도 변환 ${converted})`,
      );
    }
  }
});

// ADR-0097: 평범한 통로는 인접한 노드만 잇는다. 도면을 가로지르거나 사이에 방이 여럿 낀
// 통로는 전부 특수 통로이거나 짧은 둘로 쪼개져 있어야 한다.
test('평범한 통로는 언제나 인접한 노드끼리만 잇는다', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const violations = findPlainEdgeViolations(graph);
    assert.equal(
      violations.length, 0,
      `seed ${seed}: 인접하지 않은 평범한 통로 ${violations.length}개 — ${violations.slice(0, 3).map((v) => `${v.edgeId}(${v.reason})`).join(', ')}`,
    );
  }
});

test('관문을 빼도 각 구역의 평범한 통로만으로 그 구역이 이어져 있다', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const sectorOfNode = new Map(graph.nodes.map((n) => [n.id, n.sectorId]));
    for (const sectorId of graph.sectorIds) {
      const ids = graph.nodes.filter((n) => n.sectorId === sectorId).map((n) => n.id);
      const adjacency = new Map(ids.map((id) => [id, []]));
      for (const edge of graph.edges) {
        if (edge.features.length > 0) continue;
        if (sectorOfNode.get(edge.from) !== sectorId || sectorOfNode.get(edge.to) !== sectorId) continue;
        adjacency.get(edge.from).push(edge.to);
        adjacency.get(edge.to).push(edge.from);
      }
      const seen = new Set([ids[0]]);
      const queue = [ids[0]];
      while (queue.length > 0) {
        const node = queue.pop();
        for (const other of adjacency.get(node)) if (!seen.has(other)) { seen.add(other); queue.push(other); }
      }
      assert.equal(seen.size, ids.length, `seed ${seed}: ${sectorId}가 평범한 통로만으로는 ${ids.length - seen.size}개 노드만큼 끊겨 있다`);
    }
  }
});

test('특수 통로로 바뀐 평면도 통로에는 반드시 성격이 붙고, 구역 간·원거리 지름길도 마찬가지다', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const sectorOfNode = new Map(graph.nodes.map((n) => [n.id, n.sectorId]));
    const adjacentKeys = adjacentSectorKeys(graph);
    for (const edge of graph.edges) {
      if (edge.fromFloorPlan) {
        assert.ok(edge.features.length > 0, `seed ${seed}: ${edge.id}가 평면도 지름길인데 성격이 없다`);
      }
      const from = sectorOfNode.get(edge.from);
      const to = sectorOfNode.get(edge.to);
      if (from === to) continue;
      // 구역을 넘는 통로 중 성격이 없는 것은 관문뿐이고, 관문은 링 이웃만 잇는다.
      if (edge.features.length === 0) {
        assert.ok(adjacentKeys.has([from, to].sort().join('|')), `seed ${seed}: ${edge.id}가 성격 없이 링 밖을 잇는다`);
      } else if (!adjacentKeys.has([from, to].sort().join('|'))) {
        assert.ok(edge.features.length > 0, `seed ${seed}: 원거리 지름길 ${edge.id}에 성격이 없다`);
      }
    }
  }
});

// #3 두 탈출구(표준 A + 열쇠)는 서로 다른 구역, 시작 구역 제외, 2개 edge-disjoint 경로.
// fallback 사용률도 확인.
test('exit placement uses two distinct non-start sectors with 2 edge-disjoint paths', () => {
  let fallbackCount = 0;
  const sampleSize = 300;
  for (let seed = 0; seed < sampleSize; seed++) {
    const { graph, usedFallback } = generateFacilityGraph(seed);
    if (usedFallback) fallbackCount += 1;

    assert.equal(graph.exits.length, 2, `seed ${seed}: exit count`);
    assert.deepEqual(graph.exits.map((e) => e.exitId), ['A', 'key'], `seed ${seed}: 표준 출구는 A 하나다(ADR-0083)`);
    const bySectorSet = new Set(graph.exits.map((e) => e.sectorId));
    assert.equal(bySectorSet.size, 2, `seed ${seed}: exits must be in 2 distinct sectors`);
    for (const exit of graph.exits) {
      assert.notEqual(exit.sectorId, 'entrance', `seed ${seed}: exit ${exit.exitId} in the start sector`);
      assert.equal(
        graph.nodes.find((node) => node.id === exit.nodeId)?.sectorId, exit.sectorId,
        `seed ${seed}: exit ${exit.exitId} sectorId disagrees with its node`,
      );
      // 퇴로는 **실제로 걸을 수 있는 간선**으로만 세야 한다 — 잠긴 통로는 물론이고 고지대
      // (유효 Mobility 3 필요)와 환풍구의 역방향(일방통행)도 길이 아니다. 무향으로 세면
      // 되돌아올 수 없는 통로가 두 번째 퇴로로 인정된다(시드 표본의 20%가 그렇게 통과했다).
      const paths = countEdgeDisjointPaths(baselineWalkArcs(graph.edges), graph.startNodeId, exit.nodeId, 2, { directed: true });
      assert.equal(paths, 2, `seed ${seed}: exit ${exit.exitId} has only ${paths} walkable edge-disjoint path(s)`);
    }
  }
  // §11.3 인수 기준 3의 99.5% 목표는 10,000 seed 전수 검증용. 여기서는 빠른 스모크 체크로,
  // 이 표본에서도 fallback이 드물게만 쓰이는지 확인한다 (전수 10,000-seed 검증은 별도 느린 스크립트로 돌린다).
  const fallbackRate = fallbackCount / sampleSize;
  assert.ok(fallbackRate < 0.05, `fallback used too often in sample: ${fallbackCount}/${sampleSize}`);
});

// ADR-0083: 출구 A는 시작 구역도 계약 목표 구역도 아닌 구역에서 **시작점으로부터 가장 먼**
// 노드다. 완성 그래프(특수 엣지 포함)에서, Capability 0이 아무것도 열지 않고 걸을 수 있는
// 간선만으로 잰다.
test('exit A is the farthest walkable node from the start among eligible sectors', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const contractSectorId of [undefined, 'labs', 'entrance']) {
      const { graph } = generateFacilityGraph(seed, undefined, contractSectorId);
      const exitA = graph.exits.find((e) => e.exitId === 'A');
      const fromStart = baselineWalkDistances(graph.edges, graph.startNodeId);
      const measured = fromStart.get(exitA.nodeId) ?? Infinity;
      assert.equal(graph.exitPlacement.exitAWalkDistance, measured, `seed ${seed}: 기록된 A 거리와 실측이 다르다`);
      assert.notEqual(exitA.sectorId, 'entrance', `seed ${seed}: A가 시작 구역에 놓였다`);
      if (contractSectorId && contractSectorId !== 'entrance' && graph.sectorIds.includes(contractSectorId)) {
        assert.notEqual(exitA.sectorId, contractSectorId, `seed ${seed}: A가 계약 목표 구역에 놓였다`);
      }
      // 자격 있는 구역의 어느 노드도 A보다 멀지 않다(2-edge-disjoint 조건을 만족하는 노드 중에서).
      for (const node of graph.nodes) {
        if (node.sectorId === 'entrance' || node.sectorId === exitA.sectorId) continue;
        if (contractSectorId && node.sectorId === contractSectorId) continue;
        if (!graph.sectorIds.includes(node.sectorId)) continue;
        const d = fromStart.get(node.id) ?? Infinity;
        if (!Number.isFinite(d) || d <= measured) continue;
        const paths = countEdgeDisjointPaths(baselineWalkArcs(graph.edges), graph.startNodeId, node.id, 2, { directed: true });
        assert.ok(paths < 2, `seed ${seed}: ${node.id}(${d})가 A(${measured})보다 먼데 퇴로도 둘이다`);
      }
    }
  }
});

test('exit placement is deterministic for a seed', () => {
  for (const seed of [1, 7, 42]) {
    const first = generateFacilityGraph(seed).graph;
    const second = generateFacilityGraph(seed).graph;
    assert.deepEqual(first.exits, second.exits, `seed ${seed}: exits`);
    assert.equal(first.startNodeId, second.startNodeId, `seed ${seed}: start node`);
    assert.deepEqual(first.exitPlacement, second.exitPlacement, `seed ${seed}: placement meta`);
  }
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
    assert.equal(graph.landmarks.length, graph.sectorIds.length);
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
  for (const sectorId of graph.sectorIds) {
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

test('concealment values are within 1-3, absent (0) nodes are omitted, and generation is deterministic', () => {
  for (let seed = 0; seed < 10; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const [nodeId, value] of Object.entries(graph.concealmentByNodeId)) {
      assert.ok(nodeIds.has(nodeId), `seed ${seed}: concealment on unknown node ${nodeId}`);
      assert.ok(value >= 1 && value <= 3, `seed ${seed}: concealment value ${value} out of range`);
    }
    const again = generateFacilityGraph(seed);
    assert.deepEqual(again.graph.concealmentByNodeId, graph.concealmentByNodeId);
  }
});

// ---- 평면도 생성 (D6·D18·D20) ----

test('every node carries a type and each sector shows its archetype signature', () => {
  const NODE_TYPES = new Set(['corridor', 'office', 'hall', 'vault', 'utility', 'watch', 'refuge', 'crawlway']);
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    for (const node of graph.nodes) {
      assert.ok(NODE_TYPES.has(node.type), `seed ${seed}: ${node.id} has unknown type ${node.type}`);
    }
    const typesBySector = {};
    for (const node of graph.nodes) (typesBySector[node.sectorId] ||= new Set()).add(node.type);

    // 서명 유형: 그 구역에서 가장 무거운 방 유형은 반드시 한 번은 나온다(attachRooms가 보장).
    for (const sectorId of graph.sectorIds) {
      const layout = SECTOR_LAYOUTS[sectorId];
      const signature = layout.roomTypes.reduce((best, item) => (item.weight > best.weight ? item : best), layout.roomTypes[0]).value;
      assert.ok(typesBySector[sectorId].has(signature), `seed ${seed}: ${sectorId} is missing its signature type ${signature}`);
    }
    // 대공간은 격납고에만, 비인가 통로는 폐기물에만 있다 — 그 구역이 뽑히지 않은 런에는 아예 없다.
    assert.deepEqual(
      new Set(graph.nodes.filter((n) => n.type === 'hall').map((n) => n.sectorId)),
      new Set(graph.sectorIds.includes('hangar') ? ['hangar'] : []),
    );
    assert.deepEqual(
      new Set(graph.nodes.filter((n) => n.type === 'crawlway').map((n) => n.sectorId)),
      new Set(graph.sectorIds.includes('waste') ? ['waste'] : []),
    );
  }
});

test('sectors are joined only by gateways, two per sector, on ring-adjacent pairs', () => {
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const typeById = new Map(graph.nodes.map((n) => [n.id, n]));

    const gatewaysBySector = {};
    for (const node of graph.nodes) if (node.isGateway) gatewaysBySector[node.sectorId] = (gatewaysBySector[node.sectorId] || 0) + 1;
    for (const sectorId of graph.sectorIds) {
      assert.equal(gatewaysBySector[sectorId], 2, `seed ${seed}: ${sectorId} should have exactly two gateways`);
    }
    const adjacentKeys = adjacentSectorKeys(graph);

    // 일반 엣지 중 구역을 넘는 것은 관문뿐이고, 관문은 링에서 인접한 구역만 잇는다.
    for (const edge of graph.edges) {
      if (edge.features.length > 0) continue; // 특수 엣지는 별도 규칙(§4.2)을 따른다
      const from = typeById.get(edge.from);
      const to = typeById.get(edge.to);
      if (from.sectorId === to.sectorId) continue;
      assert.ok(from.isGateway && to.isGateway, `seed ${seed}: ${edge.id} crosses sectors without gateways`);
      assert.ok(adjacentKeys.has([from.sectorId, to.sectorId].sort().join('|')), `seed ${seed}: ${edge.id} links non-adjacent sectors`);
    }
  }
});

test('concealment follows node type — corridors and halls never offer any', () => {
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const typeById = new Map(graph.nodes.map((n) => [n.id, n.type]));
    for (const [nodeId, value] of Object.entries(graph.concealmentByNodeId)) {
      const type = typeById.get(nodeId);
      assert.ok(value >= 1 && value <= 3, `seed ${seed}: ${nodeId} concealment out of range`);
      assert.ok(type !== 'corridor' && type !== 'hall', `seed ${seed}: ${nodeId} is a ${type} and should have no concealment`);
    }
    // 은신처는 거의 항상 은엄폐를 가진다(가중치 90%) — 한 판에 하나도 없으면 유형이 안 먹은 것이다.
    const refuges = graph.nodes.filter((n) => n.type === 'refuge');
    if (refuges.length >= 5) {
      assert.ok(refuges.some((n) => graph.concealmentByNodeId[n.id]), `seed ${seed}: no refuge got concealment`);
    }
  }
});

test('nodes inside a sector never overlap', () => {
  // 로컬 정규화 좌표에서의 최소 간격이 전역 좌표로는 SECTOR_NODE_RADIUS배가 된다. 밀어내기가
  // 매 패스 끝에 다시 정규화되면서 조금씩 되감기므로 목표치에 극소량(월드 0.5 미만) 못 미치는
  // 쌍이 남는다 — 화면에서는 구분되지 않는 차이라 그만큼을 허용한다.
  const minWorldDistance = NODE_MIN_SEPARATION * SECTOR_NODE_RADIUS;
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const bySector = {};
    for (const node of graph.nodes) (bySector[node.sectorId] ||= []).push(node);
    for (const sectorId of graph.sectorIds) {
      const nodes = bySector[sectorId];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          assert.ok(d >= minWorldDistance - 0.5, `seed ${seed}: ${nodes[i].id} and ${nodes[j].id} are ${d.toFixed(1)} apart`);
        }
      }
    }
  }
});

// D16: 표지 노드의 위치 규칙은 배치 원형마다 고정이다. 도면만 보고 후보를 두세 방으로 좁힐 수
// 있어야 하고(너무 많으면 안 좁혀지고), 하나뿐이면 정찰할 이유가 없다.
test('the landmark always sits on one of the archetype-fixed candidate rooms', () => {
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const landmark of graph.landmarks) {
      const node = byId.get(landmark.nodeId);
      const layout = SECTOR_LAYOUTS[landmark.sectorId];
      const sectorNodes = graph.nodes.filter((n) => n.sectorId === landmark.sectorId);
      const cy = sectorNodes.reduce((sum, n) => sum + n.y, 0) / sectorNodes.length;
      // 원형별 규칙을 좌표로 다시 확인한다 — 생성기의 내부 구조가 아니라 도면에서 읽히는 성질을 본다.
      if (layout.archetype === 'tower') {
        // 최상층: 구역의 위쪽 절반에 있다.
        assert.ok(node.y < cy, `seed ${seed}: ${landmark.sectorId} landmark is not near the top of the tower`);
      } else if (layout.archetype === 'radial') {
        // 중심부: 회랑이 모이는 허브에 붙은 방이다. 정규화와 밀어내기로 좌표가 밀리므로 순위로
        // 본다 — 바깥 고리에는 절대 놓이지 않는다는 것이 확인하려는 성질이다. 밀어내기가 안쪽
        // 절반의 경계에 걸친 방을 한 칸 바깥으로 밀어내는 시드가 있어 경계 노드 하나까지 인정한다.
        const cx = sectorNodes.reduce((sum, n) => sum + n.x, 0) / sectorNodes.length;
        const ranked = sectorNodes
          .map((n) => ({ id: n.id, d: Math.hypot(n.x - cx, n.y - cy) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, Math.ceil(sectorNodes.length / 2) + 1)
          .map((c) => c.id);
        assert.ok(ranked.includes(node.id), `seed ${seed}: ${landmark.sectorId} landmark is not in the hub`);
      }
      // 어떤 원형에서도 표지는 복도가 아니라 방이다.
      assert.notEqual(node.type, 'corridor', `seed ${seed}: ${landmark.sectorId} landmark sits in a corridor`);
      // 비인가 통로는 도면에 없으므로 표지가 놓이지 않는다.
      assert.notEqual(node.type, 'crawlway', `seed ${seed}: ${landmark.sectorId} landmark sits off the floor plan`);
    }
  }
});

test('every sector offers 2-4 landmark candidates — enough to narrow down, not enough to be certain', () => {
  for (let seed = 0; seed < 20; seed++) {
    for (const sectorId of ALL_SECTOR_IDS) {
      const layout = generateSectorLayout(createRngState(seed), sectorId);
      assert.ok(
        layout.landmarkIndices.length >= LANDMARK_CANDIDATE_MIN && layout.landmarkIndices.length <= LANDMARK_CANDIDATE_MAX,
        `seed ${seed}: ${sectorId} offers ${layout.landmarkIndices.length} landmark candidates`,
      );
    }
  }
});

// 탑 제약은 세 군데(관문 연결, 구역 간·원거리 특수 엣지, 구역 안 특수 엣지)에서 각각 지켜야
// 성립한다. 새 종류의 엣지가 하나 추가되면 조용히 깨지므로 바깥에서 관찰 가능한 성질로 못박는다.
test('the comms tower only touches other sectors through its ground-floor lobby', () => {
  let checked = 0;
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    // 통신동은 런마다 뽑히기도 안 뽑히기도 한다(ADR-0081) — 뽑힌 시드만 본다.
    if (!graph.sectorIds.includes('comms')) continue;
    checked += 1;
    const inTower = new Set(graph.nodes.filter((n) => n.sectorId === 'comms').map((n) => n.id));
    // 로비 = 1층 복도(층 사슬의 아래 끝)와 거기 일반 엣지로 붙은 방.
    const corridors = graph.nodes.filter((n) => n.sectorId === 'comms' && n.type === 'corridor');
    const ground = corridors.reduce((best, n) => (n.y > best.y ? n : best), corridors[0]);
    const lobby = new Set([ground.id]);
    for (const edge of graph.edges) {
      if (edge.features.length > 0) continue;
      if (edge.from === ground.id && inTower.has(edge.to)) lobby.add(edge.to);
      if (edge.to === ground.id && inTower.has(edge.from)) lobby.add(edge.from);
    }
    for (const edge of graph.edges) {
      const fromInside = inTower.has(edge.from);
      if (fromInside === inTower.has(edge.to)) continue;
      const endpoint = fromInside ? edge.from : edge.to;
      assert.ok(lobby.has(endpoint), `seed ${seed}: ${edge.id} leaves the tower from ${endpoint}, which is not the lobby`);
    }
  }
  assert.ok(checked > 0, '통신동이 뽑힌 시드가 하나도 없었다 — 표본을 늘려야 한다');
});

test('inside the comms tower nothing crosses a floor except the stairs and the elevator', () => {
  let checked = 0;
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    if (!graph.sectorIds.includes('comms')) continue;
    checked += 1;
    const inTower = new Set(graph.nodes.filter((n) => n.sectorId === 'comms').map((n) => n.id));
    const corridorIds = new Set(graph.nodes.filter((n) => n.sectorId === 'comms' && n.type === 'corridor').map((n) => n.id));
    // 층 번호를 그래프에서 되짚는다: 복도는 y 순서가 곧 층이고, 방은 자기를 매단 복도의 층이다.
    const floors = [...corridorIds]
      .map((id) => graph.nodes.find((n) => n.id === id))
      .sort((a, b) => b.y - a.y);
    /** @type {Map<string, number>} */
    const floorOf = new Map(floors.map((n, i) => [n.id, i]));
    for (const edge of graph.edges) {
      if (edge.features.length > 0) continue;
      if (!inTower.has(edge.from) || !inTower.has(edge.to)) continue;
      const room = corridorIds.has(edge.from) ? edge.to : edge.from;
      const host = corridorIds.has(edge.from) ? edge.from : edge.to;
      if (corridorIds.has(room)) continue;
      assert.ok(!floorOf.has(room), `seed ${seed}: ${room} hangs off more than one corridor`);
      floorOf.set(room, floorOf.get(host));
    }
    const elevator = graph.edges.find((e) => e.requiredCapability !== undefined);
    for (const edge of graph.edges) {
      if (!inTower.has(edge.from) || !inTower.has(edge.to)) continue;
      if (edge === elevator) continue;
      const gap = Math.abs(floorOf.get(edge.from) - floorOf.get(edge.to));
      assert.ok(gap <= 1, `seed ${seed}: ${edge.id} skips ${gap} floors`);
      if (gap === 1) {
        assert.ok(
          corridorIds.has(edge.from) && corridorIds.has(edge.to),
          `seed ${seed}: ${edge.id} crosses a floor without being the stairs`,
        );
      }
    }
  }
  assert.ok(checked > 0, '통신동이 뽑힌 시드가 하나도 없었다 — 표본을 늘려야 한다');
});

test('the comms tower is a straight column with a locked elevator from bottom to top', () => {
  let checked = 0;
  for (let seed = 0; seed < 20; seed++) {
    const { graph } = generateFacilityGraph(seed);
    if (!graph.sectorIds.includes('comms')) continue;
    checked += 1;
    const corridors = graph.nodes.filter((n) => n.sectorId === 'comms' && n.type === 'corridor');
    // 곧은 기둥이라 복도의 x 편차가 층 간격보다 훨씬 작다.
    const xs = corridors.map((n) => n.x);
    const ys = corridors.map((n) => n.y);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadY = Math.max(...ys) - Math.min(...ys);
    assert.ok(spreadX < spreadY * 0.2, `seed ${seed}: tower corridors are not a straight column (x ${spreadX.toFixed(0)} vs y ${spreadY.toFixed(0)})`);

    const bottom = corridors.reduce((best, n) => (n.y > best.y ? n : best), corridors[0]);
    const top = corridors.reduce((best, n) => (n.y < best.y ? n : best), corridors[0]);
    const elevator = graph.edges.find((e) => (e.from === bottom.id && e.to === top.id) || (e.from === top.id && e.to === bottom.id));
    assert.ok(elevator, `seed ${seed}: no elevator between the tower's bottom and top`);
    assert.ok(elevator.features.includes('blocked'), `seed ${seed}: the elevator should be locked until opened`);
    assert.ok(elevator.features.includes('electronic'), `seed ${seed}: the elevator should also open with Hacking`);
    assert.equal(elevator.requiredCapability, TOWER_ELEVATOR_REQUIREMENT, `seed ${seed}: elevator requirement`);
  }
  assert.ok(checked > 0, '통신동이 뽑힌 시드가 하나도 없었다 — 표본을 늘려야 한다');
});
