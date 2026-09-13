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
import { CAMERA_FORCE_TIME, CAMERA_HACK_OVERLOAD } from '../src/data/facilityLayout.js';

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed);
}

/**
 * 그 계약의 목표부 구역이 실제로 뽑힌 첫 시드의 런 — 구역이 런마다 넷만 들어가므로(ADR-0081)
 * 고정 시드가 특정 계약의 구역을 담고 있다고 가정할 수 없다.
 */
function runWithContractSector(seed, contract) {
  for (let s = seed; s < seed + 200; s++) {
    const { graph } = generateFacilityGraph(s);
    if (graph.sectorIds.includes(contract.sectorId)) return createRunState(graph, s);
  }
  throw new Error(`no seed near ${seed} draws ${contract.sectorId}`);
}

test('Force pays in noise and equipment durability, not in overload', () => {
  const base = makeRun(21);
  const state = { ...base, graph: { ...base.graph, cameras: [{ id: 'cam', nodeId: base.playerNodeId }] } };

  const standard = destroyCamera(state, 'cam', 1);
  assert.equal(standard.time - state.time, CAMERA_FORCE_TIME);
  assert.equal(standard.pendingDurabilityLoss, 0, '요구치를 맞췄으면 연장은 멀쩡하다');
  assert.equal(standard.overload, state.overload, 'Force는 과부화로 값을 치르지 않는다');

  const severe = destroyCamera(state, 'cam', -1);
  assert.ok(severe.pendingDurabilityLoss > 0, '크게 모자라면 연장이 상한다');
  assert.ok(severe.time - state.time > standard.time - state.time);
  const loudest = severe.noiseEvents[severe.noiseEvents.length - 1];
  const normal = standard.noiseEvents[standard.noiseEvents.length - 1];
  assert.ok(loudest.intensity > normal.intensity, '그리고 더 시끄럽다');
});

test('Hacking pays in overload, and a surplus actually costs less than the standard', () => {
  const base = makeRun(1);
  const state = {
    ...base,
    graph: { ...base.graph, accessInterfaces: [{ id: 'iface', nodeId: base.playerNodeId }] },
  };

  const standard = hackAccessInterface(state, 'iface', 1);
  assert.equal(standard.overload - state.overload, CAMERA_HACK_OVERLOAD);

  const strained = hackAccessInterface(state, 'iface', 0);
  assert.ok(strained.overload > standard.overload, 'Hacking이 모자라면 과부화가 더 붙는다');
  assert.ok(strained.time > standard.time);
  assert.equal(strained.pendingHpLoss, 0, 'Hacking은 HP로 받지 않는다');

  const surplus = hackAccessInterface(state, 'iface', 3);
  assert.ok(surplus.time < standard.time, '여유가 있으면 더 빨리 끝난다');
  assert.ok(surplus.overload < standard.overload, '그리고 부하도 덜 진다');
});

test('Stealth pays in a strong trace, and a severe shortfall raises the sector alert on the spot', () => {
  const contract = CONTRACT_DEFS.find((c) => c.type === 'retrieval');
  const base = runWithContractSector(1, contract);
  const landmark = base.graph.landmarks.find((l) => l.sectorId === contract.sectorId);
  const at = {
    ...base,
    playerNodeId: landmark.nodeId,
    contract: { ...contract, status: 'accepted' },
    // 카메라는 층계와 무관한 두 번째 경계도 상승원이다 — 목표부에 카메라가 놓이는 시드에서
    // "층계 대가로 몇 단계가 올랐는가"가 흐려지므로 이 테스트에서는 비운다.
    graph: { ...base.graph, cameras: [] },
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
  const contract = CONTRACT_DEFS.find((c) => c.type === 'retrieval');
  const base = runWithContractSector(1, contract);
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
    playerState: { hp: 50, maxHp: 50, overload: 0, loadout: {}, inventory: { items: [], ammo: 0, capacity: 12 } },
  };
  const after = gameReducer(snapshot, { type: 'BASIC_RECON' });
  assert.equal(after.playerState.hp, 43, '쌓인 HP 청구서가 실제로 빠진다');
  assert.equal(after.facilityRunState.pendingHpLoss, 0, '그리고 두 번 청구되지 않도록 비워진다');
});

test('고지대 통과는 층계다 — Mobility의 통화(HP)로만 받고, 시간은 이동의 전용 규칙 그대로다', async () => {
  const { forecastAction, moveTimeCost } = await import('../src/engine/actionCosts.js');
  const { CAPABILITY_STEP_HP_COST, HIGH_GROUND_MOBILITY_REQUIREMENT } = await import('../src/data/facilityLayout.js');
  const edge = { timeCost: 6, features: ['highGround'] };

  const standard = forecastAction('traverseHighGround', { edge, value: HIGH_GROUND_MOBILITY_REQUIREMENT });
  assert.equal(standard.step, 'standard');
  assert.equal(standard.cost.hpCost, 0);
  assert.equal(standard.timeCost, moveTimeCost(edge, 3), '시간은 이동과 같은 값이다 — 층계 가감을 또 얹지 않는다');

  const strained = forecastAction('traverseHighGround', { edge, value: 2 });
  assert.equal(strained.step, 'strained');
  assert.equal(strained.cost.hpCost, CAPABILITY_STEP_HP_COST.strained);
  assert.equal(strained.timeCost, moveTimeCost(edge, 2));
  assert.equal(strained.cost.noise, 0, 'Mobility는 소음으로 받지 않는다');
  assert.equal(strained.cost.overload, 0, '과부화로도 받지 않는다');

  const severe = forecastAction('traverseHighGround', { edge, value: 1 });
  assert.equal(severe.step, 'severe');
  assert.equal(severe.cost.hpCost, CAPABILITY_STEP_HP_COST.severe);

  assert.equal(forecastAction('traverseHighGround', { edge, value: 0 }).blocked, true, '0은 불가 구간이다(요구치 3 − 3)');
});

test('조우 속이기의 층계는 시간이 아니라 판정에 붙는다 — 0칸짜리 선택지라서', async () => {
  const { forecastAction } = await import('../src/engine/actionCosts.js');
  const { ENCOUNTER_DECEIVE_STEP_PENALTY, ENCOUNTER_DECEIVE_REQUIREMENT } = await import('../src/data/facilityLayout.js');

  for (const [value, step] of [[3, 'surplus'], [2, 'standard'], [1, 'strained'], [0, 'severe']]) {
    const forecast = forecastAction('encounterDeceive', { value });
    assert.equal(forecast.step, step);
    assert.equal(forecast.timeCost, 0, '어느 단계에서도 0칸이다');
    assert.equal(forecast.required, ENCOUNTER_DECEIVE_REQUIREMENT);
  }
  assert.equal(forecastAction('encounterDeceive', { value: -1 }).blocked, true);

  assert.equal(ENCOUNTER_DECEIVE_STEP_PENALTY.standard.successPenalty, 0);
  assert.equal(ENCOUNTER_DECEIVE_STEP_PENALTY.strained.successPenalty, 1);
  assert.equal(ENCOUNTER_DECEIVE_STEP_PENALTY.severe.raisesThreatAlert, true);
});

test('고지대의 HP 대가도 커맨드 래퍼에서 playerState로 정산된다', async () => {
  const { gameReducer } = await import('../src/engine/gameReducer.js');
  const { CAPABILITY_STEP_HP_COST } = await import('../src/data/facilityLayout.js');
  const base = makeRun(21);
  const edge = base.graph.edges.find((e) => e.from === base.playerNodeId || e.to === base.playerNodeId);
  const destination = edge.from === base.playerNodeId ? edge.to : edge.from;
  const run = {
    ...base,
    graph: { ...base.graph, edges: base.graph.edges.map((e) => (e.id === edge.id ? { ...e, features: ['highGround'] } : e)) },
  };
  // Mobility 2(무리) 로드아웃 — 요구치 3에 하나 모자라므로 넘어는 가되 HP를 치른다.
  const loadout = {
    weapons: [], modules: [{ id: 'm1', equipmentId: 'module_sandevistan' }], consumableSlots: [], implantIds: [],
  };
  const snapshot = {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    playerState: { hp: 50, maxHp: 50, overload: 0, loadout, inventory: { items: [], ammo: 0, capacity: 12 } },
  };
  const after = gameReducer(snapshot, { type: 'MOVE_TO_NODE', nodeId: destination });
  assert.equal(after.facilityRunState.playerNodeId, destination, '모자란 채로도 넘어간다');
  assert.equal(after.playerState.hp, 50 - CAPABILITY_STEP_HP_COST.strained, 'HP 대가가 실제로 빠진다');
  assert.equal(after.facilityRunState.pendingHpLoss, 0, '그리고 두 번 청구되지 않도록 비워진다');

  // Mobility 0(빈 로드아웃)은 불가 구간이라 커맨드가 통째로 no-op이 된다.
  const bare = { ...snapshot, playerState: { ...snapshot.playerState, loadout: { weapons: [], modules: [], consumableSlots: [], implantIds: [] } } };
  assert.equal(gameReducer(bare, { type: 'MOVE_TO_NODE', nodeId: destination }), bare);
});
