import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState } from '../src/engine/runEngine.js';
import {
  addCombatNoiseGauge, nextNoiseIntensity, applyCombatCardNoise, applyCombatRoundTimeToRunState,
  NOISE_GAUGE_CAPACITY, COMBAT_ROUND_TIME_COST,
  beginDisengage, cancelDisengage, addDisengageProgress, canDisengage, resolveDisengage,
  DISENGAGE_REQUIRED_PROGRESS,
} from '../src/engine/combatMapIntegration.js';
import { startCombat, finalizeIfCombatEnded } from '../src/engine/combatReducer.js';
import { gameReducer } from '../src/engine/gameReducer.js';
import { COMBAT_ENEMY_AMBUSH_TIME_COST, RUN_COLLAPSE_TIME } from '../src/data/facilityLayout.js';

/** 위협 하나와 교전 중인 전투 스냅샷 — 라운드 정산만 보기 위한 최소 구성이다. */
function startedCombat(ambush) {
  const { graph } = generateFacilityGraph(2);
  const run = createRunState(graph, 2);
  const threat = Object.values(run.threats)[0];
  const snapshot = {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: { ...run, playerNodeId: run.playerNodeId },
    playerState: {
      hp: 70, maxHp: 70, overloadActive: false,
      loadout: { consumableSlots: [], weapons: [{ id: 'w1', kind: 'equipment', equipmentId: 'katana', durability: 10 }] },
      inventory: { items: [], ammo: 8, capacity: 12 },
    },
  };
  return startCombat(snapshot, ['nibbit'], undefined, { nodeId: run.playerNodeId, threatId: threat.id, ambush });
}

/** 전투 결과만 바꿔 끼운다 — 실제 카드 플레이 없이 정산 규칙만 보기 위해서다. */
function withPhase(snapshot, phase) {
  return { ...snapshot, activeCombatState: { ...snapshot.activeCombatState, phase } };
}

test('addCombatNoiseGauge accumulates and fires only once capacity is reached, then resets to 0', () => {
  // 용량은 6이다(C2) — 소음 2짜리 카드 세 장이면 한 번 울린다.
  assert.equal(NOISE_GAUGE_CAPACITY, 6);
  let r = addCombatNoiseGauge(0, 2);
  assert.deepEqual(r, { gauge: 2, fired: false });
  r = addCombatNoiseGauge(r.gauge, 2);
  assert.deepEqual(r, { gauge: 4, fired: false });
  r = addCombatNoiseGauge(r.gauge, 2);
  assert.equal(r.fired, true);
  assert.equal(r.gauge, 0);
});

test('addCombatNoiseGauge fires exactly at capacity', () => {
  const r = addCombatNoiseGauge(NOISE_GAUGE_CAPACITY - 3, 3);
  assert.deepEqual(r, { gauge: 0, fired: true });
});

test('nextNoiseIntensity climbs 1 -> 2 -> 3 then holds at 3', () => {
  assert.equal(nextNoiseIntensity(0), 1);
  assert.equal(nextNoiseIntensity(1), 2);
  assert.equal(nextNoiseIntensity(2), 3);
  assert.equal(nextNoiseIntensity(3), 3);
});

test('applyCombatCardNoise reports a noise event only when the gauge fires, at the escalating intensity', () => {
  const { graph } = generateFacilityGraph(2);
  const runState = createRunState(graph, 2);
  const nodeId = runState.playerNodeId;

  let result = applyCombatCardNoise(runState, nodeId, NOISE_GAUGE_CAPACITY - 2, 0, 1);
  assert.equal(result.gauge, NOISE_GAUGE_CAPACITY - 1);
  assert.equal(result.intensity, 0);
  assert.equal(result.runState.noiseEvents.length, 0);

  result = applyCombatCardNoise(result.runState, nodeId, result.gauge, result.intensity, 2);
  assert.equal(result.gauge, 0);
  assert.equal(result.intensity, 1);
  assert.equal(result.runState.noiseEvents.length, 1);
  assert.equal(result.runState.noiseEvents[0].intensity, 1);
  assert.equal(result.runState.noiseEvents[0].sourceNodeId, nodeId);

  // fire again — intensity escalates to 2
  result = applyCombatCardNoise(result.runState, nodeId, NOISE_GAUGE_CAPACITY, result.intensity, 0);
  assert.equal(result.intensity, 2);
  assert.equal(result.runState.noiseEvents.length, 2);

  // a third fire caps at 3 and holds there on a fourth
  result = applyCombatCardNoise(result.runState, nodeId, NOISE_GAUGE_CAPACITY, result.intensity, 0);
  assert.equal(result.intensity, 3);
  result = applyCombatCardNoise(result.runState, nodeId, NOISE_GAUGE_CAPACITY, result.intensity, 0);
  assert.equal(result.intensity, 3);
});

test('applyCombatRoundTimeToRunState advances time by the round cost with no noise side effect', () => {
  const { graph } = generateFacilityGraph(2);
  const runState = createRunState(graph, 2);
  const before = runState.time;
  const next = applyCombatRoundTimeToRunState(runState, 60);
  assert.equal(next.time, before + 60);
  assert.equal(next.noiseEvents.length, 0);
});

test('beginDisengage grants a one-time Mobility>=2 bonus, not on repeated calls', () => {
  let d = { escapeIntent: false, disengageProgress: 0 };
  d = beginDisengage(d, 2);
  assert.equal(d.escapeIntent, true);
  assert.equal(d.disengageProgress, 1);
  const again = beginDisengage(d, 2);
  assert.equal(again, d, 'begin while already intending should be a no-op');
});

test('cancelDisengage and resolveDisengage both reset intent and progress to 0', () => {
  let d = beginDisengage({ escapeIntent: false, disengageProgress: 0 }, 3);
  d = addDisengageProgress(d, 5);
  const cancelled = cancelDisengage(d);
  assert.deepEqual(cancelled, { escapeIntent: false, disengageProgress: 0 });
  const resolved = resolveDisengage();
  assert.deepEqual(resolved, { escapeIntent: false, disengageProgress: 0 });
});

test('canDisengage requires both escapeIntent and enough progress', () => {
  let d = { escapeIntent: false, disengageProgress: DISENGAGE_REQUIRED_PROGRESS };
  assert.equal(canDisengage(d), false);
  d = beginDisengage({ escapeIntent: false, disengageProgress: 0 }, 0);
  d = addDisengageProgress(d, DISENGAGE_REQUIRED_PROGRESS);
  assert.equal(canDisengage(d), true);
});

// ---- 전투 라운드 정산 (docs/combat-reference.md「맵 시간과 라운드 정산」) ----

test('전투 1라운드는 3칸이고, 라운드마다 정확히 한 번만 정산된다', () => {
  const started = startedCombat();
  assert.equal(started.facilityRunState.time, 0, '평시 진입에는 시작 비용이 없다');

  // 첫 라운드에 승리해도 그 라운드는 3칸이다.
  const won = finalizeIfCombatEnded(withPhase(started, 'victory'));
  assert.equal(won.facilityRunState.time, COMBAT_ROUND_TIME_COST);

  // 세 번째 라운드에 끝나면 총 9칸 — 턴 종료 두 번(각 3칸) + 마지막 라운드 3칸.
  let s = startedCombat();
  s = gameReducer(s, { type: 'END_TURN' });
  assert.equal(s.facilityRunState.time, COMBAT_ROUND_TIME_COST);
  s = gameReducer(s, { type: 'END_TURN' });
  assert.equal(s.facilityRunState.time, COMBAT_ROUND_TIME_COST * 2);
  const third = finalizeIfCombatEnded(withPhase(s, 'victory'));
  assert.equal(third.facilityRunState.time, COMBAT_ROUND_TIME_COST * 3);
});

test('턴 종료 처리 도중 승리해도 그 라운드는 한 번만 청구된다', () => {
  const started = startedCombat();
  // 적이 이미 쓰러진 상태에서 턴을 종료하면 종료 처리 안에서 승리가 확정된다.
  const downed = {
    ...started,
    activeCombatState: { ...started.activeCombatState, enemies: started.activeCombatState.enemies.map((e) => ({ ...e, hp: 0 })) },
  };
  const after = gameReducer(downed, { type: 'END_TURN' });
  assert.notEqual(after.currentScreen, 'combat', '이 턴 종료로 전투가 끝난다');
  assert.equal(after.facilityRunState.time, COMBAT_ROUND_TIME_COST, '종료 처리와 승리 처리가 이중 청구하지 않는다');
});

test('적 기습의 선공 구간은 라운드와 별도로 3칸이다', () => {
  const ambushed = startedCombat('enemy');
  assert.equal(ambushed.facilityRunState.time, COMBAT_ENEMY_AMBUSH_TIME_COST);
  const won = finalizeIfCombatEnded(withPhase(ambushed, 'victory'));
  assert.equal(won.facilityRunState.time, COMBAT_ENEMY_AMBUSH_TIME_COST + COMBAT_ROUND_TIME_COST);

  // 플레이어 기습의 스턴은 적 행동을 막을 뿐 라운드 시간을 줄이지 않는다.
  const playerAmbush = startedCombat('player');
  assert.equal(playerAmbush.facilityRunState.time, 0);
  assert.equal(
    finalizeIfCombatEnded(withPhase(playerAmbush, 'victory')).facilityRunState.time,
    COMBAT_ROUND_TIME_COST,
  );
});

test('교전 중인 위협은 맵에서 멈추고 외부 위협은 계속 움직인다', () => {
  const started = startedCombat();
  const engagedId = started.combatContext.threatId;
  assert.equal(started.facilityRunState.engagedThreatId, engagedId);

  // 교전 중인 위협과 외부 위협 모두 이번 3칸 안에 움직일 예약을 들고 있게 맞춘다 — 그래야
  // "멈춘 쪽"과 "진행한 쪽"의 차이가 예약 시각이 아니라 교전 여부에서 온다.
  const outsider = Object.values(started.facilityRunState.threats).find((t) => t.id !== engagedId);
  const primed = {
    ...started,
    facilityRunState: {
      ...started.facilityRunState,
      threats: {
        ...started.facilityRunState.threats,
        [engagedId]: { ...started.facilityRunState.threats[engagedId], nextMoveAt: 1 },
        [outsider.id]: { ...outsider, nextMoveAt: 1 },
      },
    },
  };

  const before = primed.facilityRunState.threats[engagedId].nodeId;
  const after = gameReducer(primed, { type: 'END_TURN' }).facilityRunState;
  assert.equal(after.threats[engagedId].nodeId, before, '교전 중인 위협은 제자리다');
  assert.equal(after.threats[engagedId].nextMoveAt, 1, '예약도 그대로 멈춰 있다');
  assert.notEqual(after.threats[outsider.id].nodeId, outsider.nodeId, '외부 위협은 그 3칸 동안 진행한다');
});

test('정산 도중 붕괴 시각을 넘기면 승리했더라도 붕괴가 우선한다', () => {
  const started = startedCombat();
  const nearEnd = {
    ...started,
    facilityRunState: { ...started.facilityRunState, time: RUN_COLLAPSE_TIME - 2 },
  };
  const won = finalizeIfCombatEnded(withPhase(nearEnd, 'victory'));
  assert.equal(won.facilityRunState.phase, 'collapsed');
  assert.equal(won.currentScreen, 'gameOver', '보상 화면으로 가지 않는다');
});

// ---- 전투 RNG가 보상 롤에 반영되는가 (리뷰 A3) ----

test('전투 중 굴린 난수가 스냅샷으로 돌아와 보상 롤에 반영된다', () => {
  const started = startedCombat();
  // 전투 안에서 몇 번을 더 굴렸든 그 결과가 스냅샷의 rngState가 되어야 한다.
  const advanced = {
    ...started,
    activeCombatState: { ...started.activeCombatState, phase: 'victory', rngState: 123456 },
  };
  const won = finalizeIfCombatEnded(advanced);
  assert.notDeepEqual(won.rngState, started.rngState, '전투 시작 시점 시드가 그대로 남아 있다');
});

test('같은 전투를 다르게 풀면 보상 후보가 갈린다', () => {
  function rewardOf(combatRngSeed) {
    const started = startedCombat();
    const won = finalizeIfCombatEnded({
      ...started,
      activeCombatState: { ...started.activeCombatState, phase: 'victory', rngState: combatRngSeed },
    });
    return won.pendingReward;
  }
  const a = rewardOf(1001);
  const b = rewardOf(987654);
  assert.ok(a && b, '승리하면 보상 창이 서야 한다');
  assert.notDeepEqual(a.slots, b.slots, '전투 진행이 달라도 보상 후보가 똑같다');
});
