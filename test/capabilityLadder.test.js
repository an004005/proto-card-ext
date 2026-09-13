// §5단계 Capability 층계(D8)가 실제 상태에 닿는지 본다. 단계 판정 자체는
// capabilityCosts.test.js가 맡고, 여기서는 "그 대가가 정말 그 통화로 나가는가"만 확인한다 —
// 통화가 전부 시간으로 수렴하면 층계가 있으나 마나이므로 이 쪽이 이 결정의 실질 검증이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  createRunState, destroyCamera, hackAccessInterface, acquireContractGoods, openSpecialEdge,
} from '../src/engine/runEngine.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';
import { CAMERA_FORCE_TIME } from '../src/data/facilityLayout.js';

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed);
}

test('Force pays in noise and equipment durability, and never raises the alert', () => {
  const base = makeRun(21);
  const state = { ...base, graph: { ...base.graph, cameras: [{ id: 'cam', nodeId: base.playerNodeId }] } };

  const standard = destroyCamera(state, 'cam', 1);
  assert.equal(standard.time - state.time, CAMERA_FORCE_TIME);
  assert.equal(standard.pendingDurabilityLoss, 0, '요구치를 맞췄으면 연장은 멀쩡하다');
  assert.deepEqual(standard.sectorAlerts, state.sectorAlerts, 'Force는 경계도로 값을 치르지 않는다');

  const severe = destroyCamera(state, 'cam', -1);
  assert.ok(severe.pendingDurabilityLoss > 0, '크게 모자라면 연장이 상한다');
  assert.ok(severe.time - state.time > standard.time - state.time);
  const loudest = severe.noiseEvents[severe.noiseEvents.length - 1];
  const normal = standard.noiseEvents[standard.noiseEvents.length - 1];
  assert.ok(loudest.intensity > normal.intensity, '그리고 더 시끄럽다');
});

test('Hacking pays in the sector alert, and a surplus actually costs less than the standard', () => {
  const base = makeRun(1);
  const state = {
    ...base,
    graph: { ...base.graph, accessInterfaces: [{ id: 'iface', nodeId: base.playerNodeId }] },
  };
  const sectorId = state.playerNodeId.split('_')[0];

  const standard = hackAccessInterface(state, 'iface', 1);
  assert.equal(standard.sectorAlerts[sectorId].level, 0, '요구치를 맞췄으면 들키지 않는다');

  const strained = hackAccessInterface(state, 'iface', 0);
  assert.equal(strained.sectorAlerts[sectorId].level, 0, 'strained는 아직 경계까지 올리지 않는다');
  assert.ok(strained.time > standard.time);
  assert.equal(strained.pendingHpLoss, 0, 'Hacking은 HP로 받지 않는다');

  const severe = hackAccessInterface(state, 'iface', -1);
  assert.equal(severe.sectorAlerts[sectorId].level, 1, '크게 모자라면 그 자리에서 들킨다');

  const surplus = hackAccessInterface(state, 'iface', 3);
  assert.ok(surplus.time < standard.time, '여유가 있으면 더 빨리 끝난다');
  assert.equal(surplus.sectorAlerts[sectorId].level, 0);
});

test('Stealth pays in a strong trace, and a severe shortfall raises the sector alert on the spot', () => {
  const base = makeRun(1);
  const contract = CONTRACT_DEFS.find((c) => c.type === 'retrieval');
  const landmark = base.graph.landmarks.find((l) => l.sectorId === contract.sectorId);
  const at = {
    ...base,
    playerNodeId: landmark.nodeId,
    contract: { ...contract, status: 'accepted' },
  };
  const sectorId = landmark.nodeId.split('_')[0];

  const standard = acquireContractGoods(at, 1, 0);
  assert.equal(standard.evidence.filter((e) => e.tier === 2).length, 0, '요구치를 맞췄으면 강한 흔적은 없다');
  assert.equal(standard.sectorAlerts[sectorId].level, 0);

  const strained = acquireContractGoods(at, 0, 0);
  assert.ok(strained.evidence.some((e) => e.nodeId === landmark.nodeId && e.tier === 2), '모자라면 강한 흔적이 남는다');
  assert.equal(strained.sectorAlerts[sectorId].level, 0, '아직은 발견되기를 기다리는 단계다');

  const severe = acquireContractGoods(at, -1, -1);
  assert.equal(severe.sectorAlerts[sectorId].level, 1, '크게 모자라면 그 자리에서 바로 들킨다');
});

test('the impossible band is what stays locked — and it starts three below the requirement', () => {
  const base = makeRun(1);
  const blocked = base.graph.edges.find((e) => e.features.includes('blocked') && (e.requiredCapability ?? 1) === 1);
  assert.ok(blocked, 'fixture seed should contain a plain blocked edge');
  const state = { ...base, playerNodeId: blocked.from };

  // 요구치 1: -1(severe)까지는 대가를 치르고 열리고, -2부터 막힌다.
  for (const capability of [1, 0, -1]) {
    const opened = openSpecialEdge(state, blocked.id, 'force', capability, 'normal');
    assert.ok(opened.openedEdgeIds.includes(blocked.id), `Force ${capability}은 대가를 치르고 열려야 한다`);
  }
  assert.throws(() => openSpecialEdge(state, blocked.id, 'force', -2, 'normal'), /too low/);
});

test('Mobility pays in HP, and the reducer settles that off playerState', async () => {
  const { gameReducer } = await import('../src/engine/gameReducer.js');
  const base = makeRun(1);
  const contract = CONTRACT_DEFS.find((c) => c.type === 'retrieval');
  const landmark = base.graph.landmarks.find((l) => l.sectorId === contract.sectorId);
  const at = { ...base, playerNodeId: landmark.nodeId, contract: { ...contract, status: 'accepted' } };

  // Mobility가 Stealth보다 높으면 Mobility 쪽 통화로 청구된다 — 조용히가 아니라 빠르게 해냈으니
  // 흔적 대신 몸이 값을 치른다.
  const byMobility = acquireContractGoods(at, -1, 0);
  assert.ok(byMobility.pendingHpLoss > 0, 'Mobility가 모자라면 HP로 받는다');
  assert.equal(byMobility.evidence.filter((e) => e.tier === 2).length, 0, '그 대신 흔적은 남지 않는다');

  // 그 청구서는 커맨드를 거치면서 실제로 playerState에서 빠지고 비워진다.
  const snapshot = {
    currentScreen: 'map',
    rngState: base.rngState,
    facilityRunState: { ...base, pendingHpLoss: 7 },
    playerState: { hp: 50, maxHp: 50, overloadActive: false, loadout: {}, inventory: { items: [], ammo: 0, capacity: 12 } },
  };
  const after = gameReducer(snapshot, { type: 'BASIC_RECON' });
  assert.equal(after.playerState.hp, 43, '쌓인 HP 청구서가 실제로 빠진다');
  assert.equal(after.facilityRunState.pendingHpLoss, 0, '그리고 두 번 청구되지 않도록 비워진다');
});
