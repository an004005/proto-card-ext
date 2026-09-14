// 접속 인터페이스 장악이 구역 카메라의 **위치**를 드러낸다.
//
// 인터페이스는 구역 카메라 버스다 — 제어를 잡으면 어느 노드에 눈이 달려 있는지가 먼저 읽힌다.
// 드러나는 것은 위치와 상태뿐이고, 그 노드의 나머지(현장 기회·은엄폐·위협)는 여전히 모르는
// 채로 남는다. 그래서 관측 깊이는 0이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState, hackAccessInterface, interfaceCameraRevealHops } from '../src/engine/runEngine.js';
import { bfsHopDistances } from '../src/engine/graphUtils.js';
import { INTERFACE_CAMERA_REVEAL_HOPS_BY_HACKING } from '../src/data/facilityLayout.js';
import { finishTask } from './helpers/finishTask.js';

const sectorOf = (nodeId) => nodeId.split('_')[0];

/** 같은 구역에 사거리 안 카메라와 사거리 밖 카메라가 둘 다 있는 인터페이스를 찾는다. */
function findInterfaceWithNearAndFarCameras(hacking) {
  const reach = interfaceCameraRevealHops(hacking);
  for (let seed = 1; seed <= 40; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const run = createRunState(graph, seed);
    for (const entry of graph.accessInterfaces) {
      const hops = bfsHopDistances(graph.edges, entry.nodeId);
      const sameSector = graph.cameras.filter((c) => sectorOf(c.nodeId) === sectorOf(entry.nodeId));
      const near = sameSector.filter((c) => (hops.get(c.nodeId) ?? Infinity) <= reach);
      const far = sameSector.filter((c) => (hops.get(c.nodeId) ?? Infinity) > reach);
      const otherSector = graph.cameras.filter((c) => sectorOf(c.nodeId) !== sectorOf(entry.nodeId));
      if (near.length > 0 && far.length > 0 && otherSector.length > 0) {
        return { run: { ...run, playerNodeId: entry.nodeId }, entry, near, far, otherSector, hops };
      }
    }
  }
  throw new Error(`Hacking ${hacking}의 반경 ${reach} 안팎에 카메라가 갈리는 시드를 찾지 못했다`);
}

test('인터페이스를 장악하면 같은 구역 사거리 안 카메라가 관측 기록에 드러난다', () => {
  const hacking = 1;
  const { run, entry, near, far, otherSector } = findInterfaceWithNearAndFarCameras(hacking);
  const after = finishTask(hackAccessInterface(run, entry.id, hacking));

  assert.ok((after.hackedInterfaceIds || []).includes(entry.id), '인터페이스가 장악 목록에 들어간다');

  for (const camera of near) {
    const observation = after.observations[camera.nodeId];
    assert.ok(observation, `사거리 안 ${camera.nodeId}에 관측 기록이 없다`);
    assert.ok(
      observation.contents.devices.some((d) => d.kind === 'camera' && d.id === camera.id),
      `사거리 안 ${camera.id}가 기록되지 않았다`,
    );
  }

  // 사거리 밖과 다른 구역은 드러나지 않는다 — 인터페이스가 닿지 않은 자리다. 다만 플레이어가
  // 서 있는 노드와 그 인접은 무료 관측이 이미 닿으므로 그 자리들은 이 검사에서 뺀다.
  const freeSight = new Set([run.playerNodeId]);
  for (const edge of run.graph.edges) {
    if (edge.from === run.playerNodeId) freeSight.add(edge.to);
    if (edge.to === run.playerNodeId) freeSight.add(edge.from);
  }
  for (const camera of [...far, ...otherSector]) {
    if (freeSight.has(camera.nodeId)) continue;
    const devices = after.observations[camera.nodeId]?.contents?.devices || [];
    assert.ok(
      !devices.some((d) => d.kind === 'camera' && d.id === camera.id),
      `${camera.id}는 인터페이스 반경 밖이거나 다른 구역이라 드러나면 안 된다`,
    );
  }
});

test('드러나는 것은 위치와 상태뿐이다 — 관측 깊이는 0이고 현장 기회는 새로 적히지 않는다', () => {
  const hacking = 1;
  const { run, entry, near } = findInterfaceWithNearAndFarCameras(hacking);
  const after = finishTask(hackAccessInterface(run, entry.id, hacking));

  const freeSight = new Set([run.playerNodeId]);
  for (const edge of run.graph.edges) {
    if (edge.from === run.playerNodeId) freeSight.add(edge.to);
    if (edge.to === run.playerNodeId) freeSight.add(edge.from);
  }
  const revealed = near.filter((c) => !freeSight.has(c.nodeId));
  assert.ok(revealed.length > 0, '무료 관측 밖에서 드러난 카메라가 하나는 있어야 한다');

  for (const camera of revealed) {
    const observation = after.observations[camera.nodeId];
    assert.equal(observation.detailLevel, 0, '카메라 위치만 안다 — 깊이는 0이다');
    assert.deepEqual(observation.contents.opportunities, [], '현장 기회는 여전히 모르는 채다');
    assert.equal(observation.hasThreat, undefined, '그 자리에 위협이 있는지도 여전히 모른다');
  }
});

test('반경은 유효 Hacking이 정하고 표의 양끝으로 잘린다', () => {
  for (let value = -2; value <= 4; value++) {
    assert.equal(interfaceCameraRevealHops(value), INTERFACE_CAMERA_REVEAL_HOPS_BY_HACKING[value + 2]);
  }
  assert.equal(interfaceCameraRevealHops(-9), INTERFACE_CAMERA_REVEAL_HOPS_BY_HACKING[0]);
  assert.equal(interfaceCameraRevealHops(9), INTERFACE_CAMERA_REVEAL_HOPS_BY_HACKING[6]);

  // 해커가 좋을수록 더 멀리 읽는다 — 같은 인터페이스에서 반경만 넓어진다.
  const { run, entry } = findInterfaceWithNearAndFarCameras(1);
  const countRevealed = (hacking) => {
    const after = finishTask(hackAccessInterface(run, entry.id, hacking));
    return run.graph.cameras.filter((c) => (after.observations[c.nodeId]?.contents?.devices || [])
      .some((d) => d.kind === 'camera' && d.id === c.id)).length;
  };
  assert.ok(countRevealed(4) >= countRevealed(1), 'Hacking 4가 1보다 좁게 읽을 수는 없다');
});
