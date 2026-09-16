// 지도 노드 배치 — 엔진 평면도 좌표를 캔버스에 놓을 때 노드가 남의 통로 위에 얹히거나 서로
// 포개지지 않도록 정리한다. 정리는 그리기 전용이라 게임 구조(관문·특수 엣지)는 건드리지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  layoutPositions, scaledPositions, countLayoutOverlaps,
  CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_PADDING, NODE_RADIUS,
} from '../src/components/mapLayout.js';

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
