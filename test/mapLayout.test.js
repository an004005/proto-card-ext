// 지도 노드 배치 — 엔진 평면도 좌표를 캔버스에 놓을 때 노드가 남의 통로 위에 얹히거나 서로
// 포개지지 않도록 정리한다. 정리는 그리기 전용이라 게임 구조(관문·특수 엣지)는 건드리지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  layoutPositions, scaledPositions, countLayoutOverlaps, plainSectorEdges,
  CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_PADDING, NODE_RADIUS,
} from '../src/components/mapLayout.js';
import { PLAIN_EDGE_SCREEN_MAX_LENGTH_FACTOR } from '../src/data/facilityLayout.js';

const SEEDS = [1, 2, 3, 5, 8, 11, 13];

test('정리된 배치는 결정적이고 모든 노드가 캔버스 여백 안에 있다', () => {
  for (const seed of SEEDS) {
    const { graph } = generateFacilityGraph(seed);
    const a = layoutPositions(graph);
    const b = layoutPositions(graph);
    assert.deepEqual(a, b, `seed ${seed}: 같은 그래프는 같은 배치`);
    for (const node of graph.nodes) {
      const p = a[node.id];
      assert.ok(p.x >= CANVAS_PADDING && p.x <= CANVAS_WIDTH - CANVAS_PADDING, `seed ${seed}: ${node.id} x 범위`);
      assert.ok(p.y >= CANVAS_PADDING && p.y <= CANVAS_HEIGHT - CANVAS_PADDING, `seed ${seed}: ${node.id} y 범위`);
    }
  }
});

test('같은 그래프 객체는 배치를 한 번만 계산한다 — 두 번째 호출이 같은 객체를 돌려준다', () => {
  const { graph } = generateFacilityGraph(11);
  const first = layoutPositions(graph);
  const second = layoutPositions(graph);
  assert.equal(first, second, '같은 그래프에는 캐시된 같은 객체가 와야 한다');
});

test('다른 그래프는 캐시를 공유하지 않는다', () => {
  const a = generateFacilityGraph(11).graph;
  const b = generateFacilityGraph(13).graph;
  const positionsA = layoutPositions(a);
  const positionsB = layoutPositions(b);
  assert.notEqual(positionsA, positionsB, '서로 다른 그래프가 같은 객체를 받았다');
  assert.notDeepEqual(
    a.nodes.map((n) => positionsA[n.id]),
    b.nodes.map((n) => positionsB[n.id]),
    '서로 다른 그래프인데 배치가 똑같다',
  );
});

test('정리 후에는 노드가 서로 포개지지 않고, 통로 위에 얹힌 노드가 순수 축척보다 크게 줄어든다', () => {
  for (const seed of SEEDS) {
    const { graph } = generateFacilityGraph(seed);
    const raw = countLayoutOverlaps(graph, scaledPositions(graph));
    const relaxed = countLayoutOverlaps(graph, layoutPositions(graph));
    // 비율 기준은 느슨하게 둔다(상수 튜닝에 흔들리지 않게). 실질 방어선은 아래 "원 미겹침" 검사다.
    assert.ok(relaxed.nodeOnEdge <= raw.nodeOnEdge * 0.5, `seed ${seed}: 통로 위 노드 ${raw.nodeOnEdge} → ${relaxed.nodeOnEdge}`);
    assert.ok(relaxed.nodePairs <= raw.nodePairs * 0.25, `seed ${seed}: 가까운 노드 쌍 ${raw.nodePairs} → ${relaxed.nodePairs}`);

    // 원이 실제로 겹치는(중심 거리 < 지름 + 4) 쌍은 하나도 없어야 한다.
    const positions = layoutPositions(graph);
    const ids = graph.nodes.map((n) => n.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const d = Math.hypot(positions[ids[i]].x - positions[ids[j]].x, positions[ids[i]].y - positions[ids[j]].y);
        assert.ok(d >= NODE_RADIUS * 2 + 4, `seed ${seed}: ${ids[i]}와 ${ids[j]}가 ${d.toFixed(1)}px로 포개짐`);
      }
    }
  }
});

// ADR-0097: 엔진이 인접한 노드만 평범한 통로로 잇더라도, 화면 정리가 그것을 다시 길게 늘이면
// 플레이어에게는 여전히 도면을 가로지르는 줄이다. 화면에서도 상한을 지킨다.
test('화면에서도 구역 안 평범한 통로는 그 구역 중앙값의 2배를 넘지 않는다', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { graph } = generateFacilityGraph(seed);
    const positions = layoutPositions(graph);
    const sectorOf = Object.fromEntries(graph.nodes.map((n) => [n.id, n.sectorId]));
    const lengthsBySector = {};
    for (const edge of plainSectorEdges(graph)) {
      (lengthsBySector[sectorOf[edge.from]] ??= []).push(Math.hypot(
        positions[edge.from].x - positions[edge.to].x, positions[edge.from].y - positions[edge.to].y,
      ));
    }
    for (const [sectorId, lengths] of Object.entries(lengthsBySector)) {
      const sorted = lengths.slice().sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      const longest = sorted[sorted.length - 1];
      assert.ok(
        longest <= median * PLAIN_EDGE_SCREEN_MAX_LENGTH_FACTOR,
        `seed ${seed}: ${sectorId}의 가장 긴 평범한 통로가 중앙값의 ${(longest / median).toFixed(2)}배다`,
      );
    }
  }
});

test('정리는 구역의 상대 위치를 바꾸지 않는다 — 구역 중심의 배치 순서가 그대로다', () => {
  for (const seed of SEEDS) {
    const { graph } = generateFacilityGraph(seed);
    const raw = scaledPositions(graph);
    const relaxed = layoutPositions(graph);
    const center = (positions, sectorId) => {
      const pts = graph.nodes.filter((n) => n.sectorId === sectorId).map((n) => positions[n.id]);
      return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    };
    const canvasCenter = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    for (const sectorId of graph.sectorIds) {
      const before = center(raw, sectorId); const after = center(relaxed, sectorId);
      const angleBefore = Math.atan2(before.y - canvasCenter.y, before.x - canvasCenter.x);
      const angleAfter = Math.atan2(after.y - canvasCenter.y, after.x - canvasCenter.x);
      const diff = Math.abs(((angleAfter - angleBefore + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      assert.ok(diff < 0.2, `seed ${seed}: ${sectorId} 구역이 링에서 ${diff.toFixed(2)}rad 돌아감`);
    }
  }
});
