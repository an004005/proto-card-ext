// 경계도 3단계의 추적자(ADR-0092). 최대 단계가 "위협이 조금 더 빨리 걷는다"에서 "이름을 가진
// 하나가 나를 향해 걷는다"로 바뀌었는지 — 스폰 계기, 고정 이동 간격, 세 무력화 조건, 그리고
// 같은 노드에서의 강제 조우까지 규칙의 다섯 축을 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState, advanceTime, isHunter, describeHunters } from '../src/engine/runEngine.js';
import { waitCommand } from '../src/engine/facilityReducer.js';
import { HUNTER_MOVE_INTERVAL, HUNTER_LOSE_TICKS, HUNTER_PERCEPTION } from '../src/data/facilityLayout.js';
import { MONSTER_DEFINITIONS } from '../src/data/monsters.js';

/** 위협 마커를 전부 치운 런 — 추적자만 남겨 두고 봐야 다른 마커의 이동이 판정에 섞이지 않는다. */
function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return { ...createRunState(graph, seed), threats: {} };
}

/** 한 구역의 경계도를 원하는 단계로 직접 세운다(게이지 경로는 sectorAlertGauge.test.js가 본다). */
function atAlert(state, sectorId, level) {
  return {
    ...state,
    sectorAlerts: { ...state.sectorAlerts, [sectorId]: { level, pressure: 0, resolvedEventIds: [] } },
  };
}

function hunters(state) {
  return Object.values(state.threats).filter(isHunter);
}

test('추적자 정의는 기존 정예급보다 강하고 지각이 높다', () => {
  const hunter = MONSTER_DEFINITIONS.hunter;
  assert.equal(hunter.name, '추적자');
  assert.ok(hunter.hp > MONSTER_DEFINITIONS.byrdonis.hp - 30, '정예급과 같은 체급대에 있다');
  assert.equal(hunter.perception, HUNTER_PERCEPTION);
  for (const move of hunter.sequence) {
    assert.ok([0, 1, 2, 3].includes(move.mapNoise), `${move.id}: mapNoise가 있어야 한다`);
  }
});

test('구역 경계도가 3이 되면 그 구역 랜드마크에 추적자 하나가 나오고, 더 나오지는 않는다', () => {
  const base = makeRun(3);
  const sectorId = base.graph.sectorIds[0];
  const landmark = base.graph.landmarks.find((l) => l.sectorId === sectorId);

  const before = advanceTime(base, base.time + 1);
  assert.equal(hunters(before).length, 0, '경계도가 3이 아니면 나오지 않는다');

  let state = advanceTime(atAlert(base, sectorId, 3), base.time + 1);
  assert.equal(hunters(state).length, 1);
  const hunter = hunters(state)[0];
  assert.equal(hunter.sectorId, sectorId);
  assert.equal(hunter.nodeId, landmark.nodeId, '랜드마크에서 나온다');
  assert.equal(hunter.mode, 'pursuit');
  assert.equal(hunter.alwaysVisible, true);
  assert.deepEqual(hunter.monsterIds, ['hunter']);

  // 여러 칸을 더 흘려도 같은 구역에 둘째는 나오지 않는다.
  state = advanceTime(state, state.time + 10);
  assert.equal(hunters(state).length, 1, '구역당 하나뿐이다');
});

test('추적자는 경계도 가속·봉쇄와 무관하게 2칸마다 한 번 움직인다', () => {
  const base = makeRun(3);
  const sectorId = base.graph.sectorIds[0];
  // 봉쇄까지 켠다 — 다른 위협이었다면 이 조합에서 간격이 줄어든다.
  let state = advanceTime({ ...atAlert(base, sectorId, 3), lockdown: { startedAt: 0 } }, base.time + 1);
  const hunter = hunters(state)[0];
  assert.equal(hunter.nextMoveAt - state.time, HUNTER_MOVE_INTERVAL);

  // 플레이어를 멀리 두고 앵커를 없애 제자리 순회만 하게 하면, 이동 횟수를 칸 수로 나눌 수 있다.
  state = { ...state, playerNodeId: null, threats: { ...state.threats, [hunter.id]: { ...hunter, lastKnownPlayerNodeId: null } } };
  let moves = 0;
  let at = state.threats[hunter.id].nodeId;
  for (let i = 0; i < 12; i += 1) {
    state = advanceTime(state, state.time + 1);
    const now = state.threats[hunter.id];
    if (!now) break;
    if (now.nodeId !== at) { moves += 1; at = now.nodeId; }
  }
  assert.ok(moves <= 12 / HUNTER_MOVE_INTERVAL, `12칸에 ${moves}번 — 2칸마다 한 번을 넘지 않는다`);
});

test(`${HUNTER_LOSE_TICKS}칸 동안 플레이어를 관측하지 못하면 추적자는 흔적을 놓치고 사라진다`, () => {
  const base = makeRun(3);
  const sectorId = base.graph.sectorIds[0];
  // 플레이어가 없으면 관측도 없다 — 놓치기 카운터가 매 칸 오른다.
  let state = advanceTime({ ...atAlert(base, sectorId, 3), playerNodeId: null }, base.time + 1);
  assert.equal(hunters(state).length, 1);

  state = advanceTime(state, state.time + HUNTER_LOSE_TICKS - 1);
  assert.equal(hunters(state).length, 1, `${HUNTER_LOSE_TICKS}칸을 채우기 전에는 남아 있다`);

  state = advanceTime(state, state.time + 2);
  assert.equal(hunters(state).length, 0);
  const last = state.hunterLog[state.hunterLog.length - 1];
  assert.equal(last.reason, 'lost');
  assert.match(last.text, /흔적을 놓쳤다/);
});

test('플레이어를 보면 놓치기 카운터가 0으로 돌아가고 추적자는 나를 향해 좁혀 온다', () => {
  const base = makeRun(3);
  const sectorId = base.graph.sectorIds[0];
  // 먼저 내보낸 뒤, 그 자리로 걸어 들어간다 — 추적자는 플레이어가 서 있는 자리에서는 나오지 않는다.
  const spawned = advanceTime({ ...atAlert(base, sectorId, 3), playerNodeId: null }, base.time + 1);
  const origin = hunters(spawned)[0].nodeId;

  let state = advanceTime({ ...spawned, playerNodeId: origin, playerStealth: 0 }, spawned.time + 1);
  const hunter = hunters(state)[0];
  assert.equal(hunter.lostTicks, 0);
  assert.equal(hunter.lastKnownPlayerNodeId, origin);

  // 실효 Stealth가 3 이상이면 같은 시야에서도 놓친다 — 은신 빌드의 손잡이.
  state = advanceTime({ ...state, playerStealth: 3 }, state.time + 1);
  assert.ok(hunters(state)[0].lostTicks >= 1, '은신이 임계를 넘으면 관측이 끊긴다');
});

test('구역 경계도가 3 아래로 내려가면 추적자는 철수한다', () => {
  const base = makeRun(3);
  const sectorId = base.graph.sectorIds[0];
  let state = advanceTime({ ...atAlert(base, sectorId, 3), playerNodeId: null }, base.time + 1);
  assert.equal(hunters(state).length, 1);

  state = advanceTime(atAlert(state, sectorId, 2), state.time + 1);
  assert.equal(hunters(state).length, 0);
  assert.equal(state.hunterLog[state.hunterLog.length - 1].reason, 'alertFell');
  assert.match(state.hunterLog[state.hunterLog.length - 1].text, /철수했다/);

  // 다시 3이 되면 새로 나온다 — 스폰 기록도 함께 지워졌다는 뜻이다.
  state = advanceTime(atAlert(state, sectorId, 3), state.time + 1);
  assert.equal(hunters(state).length, 1);
});

test('그 구역 통제실을 장악하면 추적자는 철수한다', () => {
  const base = makeRun(3);
  const sectorId = base.graph.sectorIds[0];
  let state = advanceTime({ ...atAlert(base, sectorId, 3), playerNodeId: null }, base.time + 1);
  assert.equal(hunters(state).length, 1);

  // 통제실 장악의 표식은 순찰 경로 공개다(레벨 1부터). 경계도는 그대로 3으로 둔다.
  state = advanceTime({ ...state, revealedPatrolRouteSectorIds: [sectorId] }, state.time + 1);
  assert.equal(hunters(state).length, 0);
  assert.equal(state.hunterLog[state.hunterLog.length - 1].reason, 'controlRoom');
});

test('추적자가 내 노드에 닿으면 판정 없이 강제 조우 — 전투만 남는다', () => {
  const base = makeRun(3);
  const sectorId = base.graph.sectorIds[0];
  const landmark = base.graph.landmarks.find((l) => l.sectorId === sectorId);
  // 랜드마크 옆 노드에 서서, 추적자가 한 칸 걸어오면 같은 노드가 되게 한다.
  const neighborEdge = base.graph.edges.find((e) => e.from === landmark.nodeId || e.to === landmark.nodeId);
  const playerNodeId = neighborEdge.from === landmark.nodeId ? neighborEdge.to : neighborEdge.from;

  const run = advanceTime({ ...atAlert(base, sectorId, 3), playerNodeId, playerStealth: 0 }, base.time + 1);
  const hunter = hunters(run)[0];
  // 추적자를 바로 내 노드로 옮기고 한 칸 흘려 콜리전을 만든다.
  const collided = advanceTime({
    ...run,
    threats: { ...run.threats, [hunter.id]: { ...hunter, nodeId: playerNodeId } },
  }, run.time + 1);
  assert.equal(collided.combatTrigger?.threatId, hunter.id);

  const snapshot = {
    currentScreen: 'map',
    facilityRunState: collided,
    playerState: {
      hp: 50, maxHp: 50, overloadActive: false,
      loadout: { consumableSlots: [], weapons: [], modules: [], implants: [] },
      inventory: { items: [], ammo: 0, capacity: 12 },
    },
  };
  // 어떤 시설 액션이든 이 자리를 지나면 조우가 세워진다 — 1칸 대기로 리듀서를 태운다.
  const after = waitCommand(snapshot, 1);
  assert.equal(after.facilityRunState.encounter.tier, 'forced', '회피·속이기 없이 전투만');
  assert.equal(after.facilityRunState.encounter.graceUsed, true);
});

test('describeHunters는 구역·홉·놓치기까지 남은 칸을 항상 돌려준다', () => {
  const base = makeRun(3);
  const sectorId = base.graph.sectorIds[0];
  const state = advanceTime({ ...atAlert(base, sectorId, 3), playerNodeId: null }, base.time + 1);
  const [described] = describeHunters(state);
  assert.equal(described.sectorId, sectorId);
  assert.equal(described.ticksUntilLost, HUNTER_LOSE_TICKS - 1);
});
