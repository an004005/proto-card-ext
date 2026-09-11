// §4단계 인과 고리(D13·D14): 시체와 흔적이 발견되면 경계도가 오르고, 비워진 자리는 증원으로
// 다시 채워진다. "실패 원인을 한 문장으로 말할 수 있는가"가 이 단계의 검증 질문이므로, 원인과
// 결과가 실제로 이어지는지를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState, advanceTime, disposeCorpse } from '../src/engine/runEngine.js';
import {
  REINFORCEMENT_INTERVAL, CORPSE_DISPOSAL_TIME, THREAT_COUNT_BY_SECTOR, WORLD_TICK_INTERVAL,
} from '../src/data/facilityLayout.js';

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed);
}

/** 위협 하나를 지정한 노드로 옮기고 바로 움직일 수 있게 만든다. */
function putThreatAt(state, threatId, nodeId) {
  const threat = state.threats[threatId];
  return {
    ...state,
    threats: { ...state.threats, [threatId]: { ...threat, nodeId, nextMoveAt: state.time, mode: 'patrol' } },
  };
}

test('a threat that walks onto a corpse reports it: the sector alert rises, an investigation is drawn there, and the corpse is gone', () => {
  const base = makeRun(1);
  const threat = Object.values(base.threats)[0];
  // 위협의 순찰 경로 위에 시체를 둔다 — 다음 걸음에 반드시 밟는다.
  const target = threat.patrolRoute[1] || threat.patrolRoute[0];
  const sectorId = threat.sectorId;
  const state = putThreatAt({
    ...base,
    playerNodeId: null,
    corpses: [{ id: 'corpse_x', nodeId: target, sectorId, createdAt: 0 }],
  }, threat.id, target);

  assert.equal(state.sectorAlerts[sectorId].level, 0);
  const after = advanceTime(state, state.time + WORLD_TICK_INTERVAL);

  assert.equal(after.corpses.length, 0, '신고된 시체는 사라진다');
  assert.equal(after.sectorAlerts[sectorId].level, 1, '시체 발견은 그 구역 경계도를 올린다');
  assert.ok(after.noiseEvents.some((e) => e.sourceNodeId === target), '발견 지점으로 조사가 몰린다');
});

test('a weak trace only draws an investigation; only a strong trace raises the alert', () => {
  const base = makeRun(1);
  const threat = Object.values(base.threats)[0];
  const target = threat.patrolRoute[1] || threat.patrolRoute[0];
  const sectorId = threat.sectorId;

  const withWeak = putThreatAt({
    ...base,
    playerNodeId: null,
    evidence: [{ id: 'e1', nodeId: target, tier: 1, createdBySectorId: sectorId }],
  }, threat.id, target);
  const afterWeak = advanceTime(withWeak, withWeak.time + WORLD_TICK_INTERVAL);
  assert.equal(afterWeak.evidence.length, 0, '발견한 흔적은 지워진다');
  assert.equal(afterWeak.sectorAlerts[sectorId].level, 0, '약한 흔적은 경계도를 올리지 않는다');
  assert.ok(afterWeak.noiseEvents.some((e) => e.sourceNodeId === target), '대신 조사를 끌어온다');

  const withStrong = putThreatAt({
    ...base,
    playerNodeId: null,
    evidence: [{ id: 'e2', nodeId: target, tier: 2, createdBySectorId: sectorId }],
  }, threat.id, target);
  const afterStrong = advanceTime(withStrong, withStrong.time + WORLD_TICK_INTERVAL);
  assert.equal(afterStrong.sectorAlerts[sectorId].level, 1, '강한 흔적은 경계도를 올린다');
});

test('disposing of a corpse costs time and removes it', () => {
  const base = makeRun(1);
  const nodeId = base.playerNodeId;
  const state = {
    ...base,
    corpses: [{ id: 'corpse_y', nodeId, sectorId: nodeId.split('_')[0], createdAt: 0 }],
  };
  const after = disposeCorpse(state);
  assert.equal(after.corpses.length, 0);
  assert.equal(after.time, state.time + CORPSE_DISPOSAL_TIME);
  assert.throws(() => disposeCorpse(after), /no corpse/);
});

test('reinforcement refills a killed marker at a gateway, and never exceeds the sector roster', () => {
  const base = makeRun(1);
  const sectorId = 'labs';
  const roster = base.graph.threats.filter((t) => t.sectorId === sectorId);
  assert.equal(roster.length, THREAT_COUNT_BY_SECTOR[sectorId]);

  // 정원이 찬 상태에서는 교대 시각이 와도 아무도 늘지 않는다.
  const full = advanceTime(base, REINFORCEMENT_INTERVAL + WORLD_TICK_INTERVAL);
  const liveFull = Object.values(full.threats).filter((t) => t.sectorId === sectorId).length;
  assert.equal(liveFull, roster.length, '정원을 넘겨 증식하지 않는다');

  // 하나를 전투로 지운 뒤에는 교대 시각에 그 자리가 다시 찬다.
  const killedId = roster[0].id;
  const threats = { ...base.threats };
  delete threats[killedId];
  const killed = { ...base, threats };
  assert.equal(Object.values(killed.threats).filter((t) => t.sectorId === sectorId).length, roster.length - 1);

  const refilled = advanceTime(killed, REINFORCEMENT_INTERVAL + WORLD_TICK_INTERVAL);
  const back = refilled.threats[killedId];
  assert.ok(back, '비워진 로스터 자리는 다시 채워진다');
  const gatewayIds = refilled.graph.nodes.filter((n) => n.sectorId === sectorId && n.isGateway).map((n) => n.id);
  assert.ok(gatewayIds.includes(back.nodeId), '증원은 구역 관문에서 나온다 — 등 뒤에서 생기지 않는다');
  assert.deepEqual(back.patrolRoute, roster[0].patrolRoute, '로스터의 순찰 경로를 그대로 물려받는다');
});

test('reinforcement never spawns onto the player, even when they are standing on a gateway', () => {
  const base = makeRun(1);
  const sectorId = 'labs';
  const roster = base.graph.threats.filter((t) => t.sectorId === sectorId);
  const gateways = base.graph.nodes.filter((n) => n.sectorId === sectorId && n.isGateway);
  assert.ok(gateways.length >= 1);

  const threats = { ...base.threats };
  for (const t of roster) delete threats[t.id];
  for (const gateway of gateways) {
    const state = { ...base, threats, playerNodeId: gateway.id };
    const after = advanceTime(state, REINFORCEMENT_INTERVAL + WORLD_TICK_INTERVAL);
    const spawnedHere = Object.values(after.threats).filter((t) => t.nodeId === gateway.id && t.sectorId === sectorId);
    assert.equal(spawnedHere.length, 0, `${gateway.id}에 서 있는데 그 자리로 증원이 나왔다`);
  }
});

test('a rising alert pulls that sector’s next reinforcement forward', () => {
  const base = makeRun(1);
  const sectorId = 'labs';
  const roster = base.graph.threats.filter((t) => t.sectorId === sectorId);
  const threats = { ...base.threats };
  delete threats[roster[0].id];

  // 경계도가 오르기 전에는 교대 시각이 그대로다.
  const quiet = advanceTime({ ...base, threats }, WORLD_TICK_INTERVAL);
  assert.equal(quiet.reinforcements[sectorId].nextAt, REINFORCEMENT_INTERVAL);
  assert.ok(!quiet.threats[roster[0].id], '아직 채워지지 않았다');

  // 경계도를 올려 두면(= 원인이 발생하면) 다음 틱에 교대가 앞당겨져 즉시 채워진다.
  const escalated = {
    ...base,
    threats,
    sectorAlerts: { ...base.sectorAlerts, [sectorId]: { level: 1, resolvedEventIds: ['cause'] } },
  };
  const after = advanceTime(escalated, WORLD_TICK_INTERVAL);
  assert.ok(after.threats[roster[0].id], '경계도 상승이 증원을 앞당긴다');
});
