// 접속 인터페이스 장악이 무엇을 주는가.
//
// 예전에는 Hacking에 따른 홉수 안, 같은 구역 카메라의 **위치**를 드러냈다. 카메라 위치가 런
// 시작부터 지도에 보이게 되면서(ADR-0090) 그 보상은 아무것도 드러내지 않는 빈 규칙이 됐고,
// 인터페이스가 파는 것은 위치가 아니라 **접근**만 남았다 — 그 구역 카메라·발전기에 거리와
// 무관하게 원격으로 손을 댈 수 있다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState, hackAccessInterface, hackCamera } from '../src/engine/runEngine.js';
import { bfsHopDistances } from '../src/engine/graphUtils.js';
import { finishTask } from './helpers/finishTask.js';

const sectorOf = (nodeId) => nodeId.split('_')[0];

/** 같은 구역에 직접 해킹 사거리 밖 카메라를 가진 인터페이스를 찾는다. */
function findInterfaceWithFarCamera() {
  for (let seed = 1; seed <= 40; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const run = createRunState(graph, seed);
    for (const entry of graph.accessInterfaces) {
      const hops = bfsHopDistances(graph.edges, entry.nodeId);
      const far = graph.cameras.filter((c) => sectorOf(c.nodeId) === sectorOf(entry.nodeId) && (hops.get(c.nodeId) ?? Infinity) > 1);
      if (far.length > 0) return { run: { ...run, playerNodeId: entry.nodeId }, entry, far };
    }
  }
  throw new Error('같은 구역에 먼 카메라를 가진 인터페이스를 찾지 못했다');
}

test('인터페이스를 장악하면 그 구역 카메라에 사거리와 무관하게 원격 접속할 수 있다', () => {
  const hacking = 1;
  const { run, entry, far } = findInterfaceWithFarCamera();

  // 장악 전: Hacking 1의 직접 사거리는 1홉이라 먼 카메라에는 손이 닿지 않는다.
  assert.throws(() => hackCamera(run, far[0].id, hacking), /reach|range|out/i);

  const after = finishTask(hackAccessInterface(run, entry.id, hacking));
  assert.ok((after.hackedInterfaceIds || []).includes(entry.id), '인터페이스가 장악 목록에 들어간다');
  const hacked = finishTask(hackCamera(after, far[0].id, hacking));
  assert.ok(hacked.hackedCameras.some((c) => c.cameraId === far[0].id), '장악 뒤에는 같은 구역 먼 카메라도 해킹된다');
});

test('인터페이스 장악은 더 이상 카메라 위치를 관측 기록에 적지 않는다', () => {
  const hacking = 4;
  const { run, entry, far } = findInterfaceWithFarCamera();
  const after = finishTask(hackAccessInterface(run, entry.id, hacking));

  // 무료 관측이 이미 닿는 자리(현재 노드와 인접 1홉)는 이 검사에서 뺀다.
  const freeSight = new Set([run.playerNodeId]);
  for (const edge of run.graph.edges) {
    if (edge.from === run.playerNodeId) freeSight.add(edge.to);
    if (edge.to === run.playerNodeId) freeSight.add(edge.from);
  }
  const outside = far.filter((c) => !freeSight.has(c.nodeId));
  assert.ok(outside.length > 0, '무료 시야 밖의 카메라가 하나는 있어야 이 검사가 성립한다');
  for (const camera of outside) {
    const devices = after.observations[camera.nodeId]?.contents?.devices || [];
    assert.ok(!devices.some((d) => d.kind === 'camera' && d.id === camera.id), '인터페이스가 카메라를 관측 기록에 적었다');
  }
});
