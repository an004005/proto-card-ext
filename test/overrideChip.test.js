// 오버라이드 칩(ADR-0086) — 지도와 전투가 **같은 통**을 쓰는 런 단위 토큰. 여기서 보는 것은
// 그 하나의 통이 두 화면에서 같은 수로 줄어드는가, 그리고 지도의 장전이 "다음 유료 행동
// 하나"에서 정확히 한 번만 소모되는가다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState } from '../src/engine/runEngine.js';
import { startCombat } from '../src/engine/combatReducer.js';
import { gameReducer } from '../src/engine/gameReducer.js';
import { BASE_MAX_HP, START_OVERRIDE_CHIPS } from '../src/engine/loadoutReducer.js';
import { MAP_CONSUMABLE_TIME_COST } from '../src/engine/facilityReducer.js';
import { CAPABILITY_MAX } from '../src/data/facilityEquipmentCapabilities.js';
import { finishTaskSnapshot } from './helpers/finishTask.js';

const EMPTY_LOADOUT = { weapons: [], top: null, bottom: null, modules: [], implantIds: [], consumableSlots: [] };

/** 빈 로드아웃(모든 Capability 0)으로 시설맵에 선 스냅샷 — 장전 없이는 아무것도 못 여는 상태다. */
function mapSnapshot(seed = 21, overrideChips = 3) {
  const { graph } = generateFacilityGraph(seed);
  const run = createRunState(graph, seed);
  return {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    playerState: {
      hp: 50, maxHp: 50, overloadActive: false, overrideChips,
      loadout: { ...EMPTY_LOADOUT },
      inventory: { items: [], ammo: 0, capacity: 12 },
    },
  };
}

/**
 * 현재 노드에 붙은 'blocked' 엣지의 요구치를 3으로 올려 둔 스냅샷 — Force 0으로는 불가
 * 구간(3 − 3)이고, 장전하면 Force 4라 여유(surplus)가 된다.
 */
function withHardBlockedEdge(snapshot) {
  const run = snapshot.facilityRunState;
  const edge = run.graph.edges.find((e) => e.from === run.playerNodeId || e.to === run.playerNodeId);
  const edges = run.graph.edges.map((e) => (e.id === edge.id ? { ...e, features: ['blocked'], requiredCapability: 3 } : e));
  return {
    snapshot: { ...snapshot, facilityRunState: { ...run, graph: { ...run.graph, edges } } },
    edgeId: edge.id,
  };
}

/** 위협 하나와 교전하는 전투 스냅샷. */
function combatSnapshot(overrideChips = 2) {
  const { graph } = generateFacilityGraph(2);
  const run = createRunState(graph, 2);
  const threat = Object.values(run.threats)[0];
  const snapshot = {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    playerState: {
      hp: 50, maxHp: 50, overloadActive: false, overrideChips,
      loadout: { ...EMPTY_LOADOUT, weapons: [{ id: 'w1', kind: 'equipment', equipmentId: 'katana', durability: 10 }] },
      inventory: { items: [], ammo: 8, capacity: 12 },
    },
  };
  return startCombat(snapshot, ['nibbit', 'nibbit'], undefined, { nodeId: run.playerNodeId, threatId: threat.id, ambush: 'player' });
}

test('NEW_RUN은 오버라이드 칩을 START_OVERRIDE_CHIPS개로 시작하고, 기본 최대 HP는 40이다', () => {
  const s = gameReducer(null, { type: 'NEW_RUN', seed: 1 });
  assert.equal(START_OVERRIDE_CHIPS, 3);
  assert.equal(s.playerState.overrideChips, 3);
  assert.equal(BASE_MAX_HP, 40);
  assert.equal(s.playerState.maxHp, 40);
  assert.equal(s.playerState.hp, 40);
});

test('전투에서의 칩은 살아 있는 적 전원만 스턴시키고 칩 하나를 쓴다 — 에너지도 턴도 건드리지 않는다', () => {
  const started = combatSnapshot(2);
  // 기습 스턴이 이미 걸려 있으므로 그 위에서의 증가분을 본다.
  const before = started.activeCombatState;
  const withDead = {
    ...started,
    activeCombatState: { ...before, enemies: before.enemies.map((e, i) => (i === 1 ? { ...e, hp: 0 } : e)) },
  };
  const energyBefore = withDead.activeCombatState.player.energy;
  const turnBefore = withDead.activeCombatState.turn;
  const stunBefore = withDead.activeCombatState.enemies[0].statuses.stun || 0;

  const after = gameReducer(withDead, { type: 'USE_OVERRIDE_CHIP' });
  assert.equal(after.playerState.overrideChips, 1);
  assert.equal(after.activeCombatState.enemies[0].statuses.stun, stunBefore + 1);
  assert.equal(after.activeCombatState.enemies[1].statuses.stun, withDead.activeCombatState.enemies[1].statuses.stun, '죽은 적은 건드리지 않는다');
  assert.equal(after.activeCombatState.player.energy, energyBefore);
  assert.equal(after.activeCombatState.turn, turnBefore);
});

test('칩이 없거나 이미 끝난 전투에서는 아무 일도 일어나지 않는다', () => {
  const empty = combatSnapshot(0);
  assert.equal(gameReducer(empty, { type: 'USE_OVERRIDE_CHIP' }), empty);

  const started = combatSnapshot(2);
  const won = { ...started, activeCombatState: { ...started.activeCombatState, phase: 'victory' } };
  assert.equal(gameReducer(won, { type: 'USE_OVERRIDE_CHIP' }), won);
});

test('지도에서 장전하면 다음 유료 행동 하나가 모든 Capability 4로 판정되고, 그 행동이 칩을 쓴다', () => {
  const { snapshot, edgeId } = withHardBlockedEdge(mapSnapshot());
  // 장전 전에는 불가 구간이다 — 커맨드가 통째로 no-op이 된다.
  assert.equal(gameReducer(snapshot, { type: 'OPEN_SPECIAL_EDGE', edgeId, capabilityKind: 'force', mode: 'normal' }), snapshot);

  const armed = gameReducer(snapshot, { type: 'USE_OVERRIDE_CHIP' });
  assert.equal(armed.facilityRunState.overrideArmed, true);
  assert.equal(armed.playerState.overrideChips, 2, '장전 순간 칩이 나간다');
  assert.equal(armed.facilityRunState.time, snapshot.facilityRunState.time, '장전 자체는 0칸이다');

  const opened = finishTaskSnapshot(gameReducer(armed, { type: 'OPEN_SPECIAL_EDGE', edgeId, capabilityKind: 'force', mode: 'normal' }));
  assert.ok(opened.facilityRunState.openedEdgeIds.includes(edgeId), '요구치 3을 빈 로드아웃으로 연다');
  assert.equal(opened.facilityRunState.overrideArmed, false, '유료 행동 하나로 장전이 소모된다');
  assert.equal(opened.playerState.overrideChips, 2, '칩은 장전 때 이미 나갔으므로 더 줄지 않는다');
  // 여유(surplus) 단계라 사다리 대가가 없다 — HP도 내구도도 청구되지 않는다.
  assert.equal(opened.playerState.hp, 50);
  assert.equal(opened.facilityRunState.pendingHpLoss, 0);
  assert.equal(opened.facilityRunState.pendingDurabilityLoss, 0);
  assert.equal(CAPABILITY_MAX, 4);
});

test('장전은 RuleViolation으로 끝난 시도에는 쓰이지 않는다', () => {
  const armed = gameReducer(mapSnapshot(), { type: 'USE_OVERRIDE_CHIP' });
  // 인접하지 않은(존재하지 않는) 엣지 — runEngine이 던지고 리듀서가 스냅샷을 그대로 돌려준다.
  const after = gameReducer(armed, { type: 'OPEN_SPECIAL_EDGE', edgeId: 'no-such-edge', capabilityKind: 'force', mode: 'normal' });
  assert.equal(after, armed);
  assert.equal(after.facilityRunState.overrideArmed, true);
  assert.equal(after.playerState.overrideChips, 2);
});

test('장전 해제는 칩을 돌려준다', () => {
  const base = mapSnapshot();
  const armed = gameReducer(base, { type: 'USE_OVERRIDE_CHIP' });
  const disarmed = gameReducer(armed, { type: 'USE_OVERRIDE_CHIP' });
  assert.equal(disarmed.facilityRunState.overrideArmed, false);
  assert.equal(disarmed.playerState.overrideChips, base.playerState.overrideChips);
});

test('칩이 0이면 장전되지 않는다', () => {
  const base = mapSnapshot(21, 0);
  assert.equal(gameReducer(base, { type: 'USE_OVERRIDE_CHIP' }), base);
});

test('조우가 열리면 장전은 맵에 남지 않는다 — 전투로 새어 나가지 않는다', () => {
  const base = mapSnapshot();
  const run = base.facilityRunState;
  const threatId = Object.keys(run.threats)[0];
  // 위협을 플레이어 노드에 세워 두면 다음 행동 끝에 콜리전이 열린다 — triggerCombatIfNeeded가
  // 조우를 세우는 그 자리가 장전을 끄는 자리다.
  const withThreat = {
    ...base,
    facilityRunState: {
      ...run,
      threats: { ...run.threats, [threatId]: { ...run.threats[threatId], nodeId: run.playerNodeId } },
      combatTrigger: { threatId, nodeId: run.playerNodeId },
    },
  };
  const armed = gameReducer(withThreat, { type: 'USE_OVERRIDE_CHIP' });
  assert.equal(armed.facilityRunState.overrideArmed, true);
  const after = gameReducer(armed, { type: 'WAIT' });
  assert.ok(after.facilityRunState.encounter, '조우가 열렸다');
  assert.equal(after.facilityRunState.overrideArmed, false);
});

test('오버라이드 셀은 전투에서 칩 2개를 충전한다', () => {
  const started = combatSnapshot(1);
  const item = { id: 'c1', kind: 'consumable', defId: 'overrideCell' };
  const s = {
    ...started,
    playerState: { ...started.playerState, loadout: { ...started.playerState.loadout, consumableSlots: [item, null, null] } },
  };
  const after = gameReducer(s, { type: 'USE_CONSUMABLE', itemId: 'c1' });
  assert.equal(after.playerState.overrideChips, 3);
  assert.equal(after.playerState.loadout.consumableSlots[0], null, '소모품은 사라진다');
});

test('오버라이드 셀은 맵에서도 쓸 수 있고, 회복류와 같은 칸(MAP_CONSUMABLE_TIME_COST)을 쓴다', () => {
  const base = mapSnapshot(21, 1);
  const item = { id: 'c1', kind: 'consumable', defId: 'overrideCell' };
  const s = { ...base, playerState: { ...base.playerState, inventory: { ...base.playerState.inventory, items: [item] } } };
  const after = finishTaskSnapshot(gameReducer(s, { type: 'USE_MAP_CONSUMABLE', itemId: 'c1' }));
  assert.equal(after.playerState.overrideChips, 3);
  assert.equal(after.playerState.inventory.items.length, 0);
  assert.equal(after.facilityRunState.time - base.facilityRunState.time, MAP_CONSUMABLE_TIME_COST);
});

test('장전은 그 행동 직후의 조우 판정까지 상한 은신으로 읽은 뒤에 꺼진다', () => {
  const base = mapSnapshot();
  const run = base.facilityRunState;
  const threatId = Object.keys(run.threats)[0];
  const withThreat = {
    ...base,
    facilityRunState: {
      ...run,
      threats: { ...run.threats, [threatId]: { ...run.threats[threatId], nodeId: run.playerNodeId } },
      combatTrigger: { threatId, nodeId: run.playerNodeId },
    },
  };
  const armed = gameReducer(withThreat, { type: 'USE_OVERRIDE_CHIP' });
  const after = gameReducer(armed, { type: 'WAIT' });
  assert.ok(after.facilityRunState.encounter, '조우가 열렸다');
  // 빈 로드아웃은 은신 0이다 — 판정에 박힌 은신이 상한(4)이어야 "붙잡히지 않으려고 장전한다"가 성립한다.
  assert.equal(after.facilityRunState.encounter.stealthBaseAtJudgement, CAPABILITY_MAX);
  assert.equal(after.facilityRunState.overrideArmed, false);
  assert.equal(after.playerState.overrideChips, 2);
});

/** 플레이어 노드에 위협을 세우고 주어진 등급의 조우를 강제로 연 스냅샷. */
function encounterSnapshot(tier) {
  const base = mapSnapshot();
  const run = base.facilityRunState;
  const threatId = Object.keys(run.threats)[0];
  return {
    ...base,
    facilityRunState: {
      ...run,
      threats: { ...run.threats, [threatId]: { ...run.threats[threatId], nodeId: run.playerNodeId } },
      encounter: { threatId, nodeId: run.playerNodeId, tier, graceUsed: false },
    },
  };
}

test('0칸인 기만 회피도 장전된 Deception을 쓰므로 장전을 소모한다', () => {
  const armed = gameReducer(encounterSnapshot('even'), { type: 'USE_OVERRIDE_CHIP' });
  assert.equal(armed.facilityRunState.overrideArmed, true);
  const after = gameReducer(armed, { type: 'ENCOUNTER_DECEIVE' });
  assert.notEqual(after, armed, '기만 회피가 처리되어야 한다');
  assert.equal(after.facilityRunState.overrideArmed, false, '이득이 실현됐으니 장전은 나가야 한다');
  assert.equal(after.playerState.overrideChips, 2);
});

test('조우 패널의 교전·기습 버튼으로 전투에 들어가도 장전은 전투로 새어 나가지 않는다', () => {
  for (const [tier, type] of [['forced', 'ENCOUNTER_FIGHT'], ['advantage', 'ENCOUNTER_AMBUSH']]) {
    const armed = gameReducer(encounterSnapshot(tier), { type: 'USE_OVERRIDE_CHIP' });
    assert.equal(armed.facilityRunState.overrideArmed, true);
    const combat = gameReducer(armed, { type });
    assert.equal(combat.currentScreen, 'combat', `${type}로 전투가 열려야 한다`);
    assert.equal(combat.facilityRunState.overrideArmed, false, `${type}: 장전이 전투로 새어 나갔다`);
  }
});

test('대기·장비 교체·소모품 사용처럼 판정 없는 행동은 시간이 흘러도 칩을 쓰지 않는다', () => {
  const armed = gameReducer(mapSnapshot(), { type: 'USE_OVERRIDE_CHIP' });
  const waited = gameReducer(armed, { type: 'WAIT' });
  assert.ok(waited.facilityRunState.time > armed.facilityRunState.time, '대기로 시간이 흘렀다');
  assert.equal(waited.facilityRunState.overrideArmed, true, '대기는 판정이 없으니 사용 상태가 유지된다');
  assert.equal(waited.playerState.overrideChips, 2);
  // 그 뒤의 판정 있는 행동(정찰)에서 비로소 소모된다.
  const scouted = gameReducer(waited, { type: 'BASIC_RECON' });
  assert.equal(scouted.facilityRunState.overrideArmed, false);
});

test('사용 중이어도 장비에서 계산한 Perception은 그대로다 — 화면의 관측 그리기는 이 값을 쓴다', async () => {
  const { computeCapabilities, effectiveCapabilities } = await import('../src/engine/capabilityEngine.js');
  const armed = gameReducer(mapSnapshot(), { type: 'USE_OVERRIDE_CHIP' });
  assert.equal(effectiveCapabilities(armed).perception, CAPABILITY_MAX);
  assert.equal(computeCapabilities(armed.playerState.loadout).perception, 0);
});
