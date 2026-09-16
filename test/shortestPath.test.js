// 지도에서 노드를 클릭하면 그곳까지의 최단 경로가 그려진다 — 잠긴 문과 일방통행 역방향은
// 지나지 않고, 길이 없으면 없다고 말한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortestPathOverArcs } from '../src/engine/graphUtils.js';

const arc = (from, to, edgeId) => ({ from, to, edgeId });

test('shortestPathOverArcs: 최단 홉 경로의 노드와 엣지를 순서대로 돌려준다', () => {
  const arcs = [
    arc('a', 'b', 'ab'), arc('b', 'a', 'ab'),
    arc('b', 'c', 'bc'), arc('c', 'b', 'bc'),
    arc('c', 'd', 'cd'), arc('d', 'c', 'cd'),
    arc('a', 'd', 'ad'), arc('d', 'a', 'ad'),
  ];
  assert.deepEqual(shortestPathOverArcs(arcs, 'a', 'd'), { nodeIds: ['a', 'd'], edgeIds: ['ad'] });
  assert.deepEqual(shortestPathOverArcs(arcs, 'a', 'c'), { nodeIds: ['a', 'b', 'c'], edgeIds: ['ab', 'bc'] });
});

test('shortestPathOverArcs: 일방통행 역방향은 지나지 않고, 도달 불가면 null', () => {
  const arcs = [arc('a', 'b', 'ab'), arc('b', 'c', 'bc'), arc('c', 'b', 'bc')];
  assert.deepEqual(shortestPathOverArcs(arcs, 'a', 'c'), { nodeIds: ['a', 'b', 'c'], edgeIds: ['ab', 'bc'] });
  assert.equal(shortestPathOverArcs(arcs, 'c', 'a'), null);
});

test('shortestPathOverArcs: 출발 = 도착이면 빈 경로', () => {
  assert.deepEqual(shortestPathOverArcs([], 'a', 'a'), { nodeIds: ['a'], edgeIds: [] });
});
