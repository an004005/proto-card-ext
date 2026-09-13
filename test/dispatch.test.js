// 전투 연출 재생 중에 들어온 커맨드가 타임라인을 잘라먹지 않는지 본다.
//
// 재생 중에는 화면이 보는 스냅샷이 히스토리 머리보다 뒤처져 있다. 그 상태에서 커맨드를 그대로
// 흘려보내면 아직 재생하지 않은 적 행동 스냅샷이 통째로 버려지고, 플레이어는 적이 때리지도
// 않았는데 턴이 넘어간 화면을 보게 된다(리뷰 A1). 그래서 재생 중 커맨드는 전부 큐에 쌓였다가
// 재생이 끝난 뒤 실행되어야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const projectUrl = (path) => new URL(path, import.meta.url).href;
register(projectUrl('./helpers/preactResolve.mjs'));

const { dispatch, setPlaybackTimers, isPlaybackActive } = await import(projectUrl('../src/state/dispatch.js'));
const { historySignal, snapshotSignal, combatPlaybackActiveSignal } = await import(projectUrl('../src/state/runState.js'));
const { createHistory, currentSnapshot } = await import(projectUrl('../src/engine/historyEngine.js'));
const { createCombatState, beginPlayerFirst } = await import(projectUrl('../src/engine/combatEngine.js'));
const { generateFacilityGraph } = await import(projectUrl('../src/engine/facilityGraph.js'));
const { createRunState } = await import(projectUrl('../src/engine/runEngine.js'));

/** setTimeout을 대신하는 수동 큐 — 테스트가 원하는 시점에만 다음 연출 프레임이 흐른다. */
function manualTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimeout(fn) { const id = nextId++; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); },
    /** 대기 중인 프레임 하나를 실행한다. @returns {boolean} 실행할 게 있었는지 */
    step() {
      const [id, fn] = pending.entries().next().value || [];
      if (!id) return false;
      pending.delete(id);
      fn();
      return true;
    },
    flush(limit = 200) { let n = 0; while (this.step() && n < limit) n += 1; return n; },
    get size() { return pending.size; },
  };
}

function combatSnapshot() {
  const { graph } = generateFacilityGraph(1);
  const facilityRunState = createRunState(graph, 1);
  const combat = beginPlayerFirst(createCombatState({
    deckEntries: Array.from({ length: 10 }, (_, i) => ({ defId: 'katana_slash', instanceId: `dsp-card-${i}` })),
    monsterIds: ['nibbit', 'nibbit'], playerHp: 70, playerMaxHp: 70, usableAmmo: 8, maxLoad: 999,
    overload: 0, overloadFloor: 0, overloadGainMultiplier: 1, extraDrawPerTurn: 0, turnStartAoeDamage: 0,
    inventoryItemIdsInOrder: [], inventoryCapacity: 30, rngState: { seed: 1 },
  }));
  return {
    currentScreen: 'combat',
    activeCombatState: combat,
    facilityRunState,
    playerState: {
      hp: 70, maxHp: 70, overload: 0,
      loadout: { consumableSlots: [], weapons: [], modules: [], implants: [] },
      inventory: { items: [], ammo: 8, capacity: 12 }, warehouse: { items: [], ammo: 0, capacity: 99 },
    },
    combatContext: {
      nodeId: facilityRunState.playerNodeId, ammoAtStart: 8, noiseGauge: 0, noiseIntensity: 0,
      disengage: { escapeIntent: false, disengageProgress: 0 },
    },
    pendingReward: null, combatSummary: null, offeredContracts: null, activeContract: null,
    rngState: facilityRunState.rngState,
  };
}

function seed(snapshot) {
  historySignal.value = createHistory(snapshot);
  snapshotSignal.value = snapshot;
}

test('재생 중 들어온 이탈 커맨드는 큐에 쌓이고, 적 행동 타임라인은 하나도 잘리지 않는다', () => {
  const timers = manualTimers();
  setPlaybackTimers(timers);
  try {
    seed(combatSnapshot());
    dispatch({ type: 'END_TURN' });
    assert.ok(isPlaybackActive(), '턴 종료는 연출 재생을 시작해야 한다');
    assert.equal(combatPlaybackActiveSignal.value, true);

    const headEntries = historySignal.value.entries.length;
    const enemyBeats = historySignal.value.entries.filter((e) => e.animation?.actor === 'enemy').length;
    assert.ok(enemyBeats >= 2, '적 두 마리의 행동이 각각 한 프레임씩 있어야 한다');

    // 연출이 반쯤 흐른 시점에 플레이어가 "이탈 시도"를 누른다.
    timers.step();
    dispatch({ type: 'BEGIN_DISENGAGE' });

    assert.equal(historySignal.value.entries.length, headEntries, '재생 중 커맨드는 히스토리를 건드리지 않는다');
    assert.equal(
      historySignal.value.entries.filter((e) => e.animation?.actor === 'enemy').length, enemyBeats,
      '아직 재생하지 않은 적 행동 스냅샷이 버려지면 안 된다',
    );

    timers.flush();

    const after = currentSnapshot(historySignal.value);
    assert.equal(after.activeCombatState.phase, 'player_turn', '적 행동이 전부 끝나고 플레이어 턴으로 돌아와야 한다');
    assert.equal(after.combatContext.disengage.escapeIntent, true, '큐에 쌓인 이탈 커맨드가 재생 후 실행되어야 한다');
    assert.equal(isPlaybackActive(), false);
    assert.equal(combatPlaybackActiveSignal.value, false);
  } finally {
    setPlaybackTimers(null);
  }
});

test('재생 중 어떤 커맨드가 와도 타임라인 길이는 유지된다', () => {
  const timers = manualTimers();
  setPlaybackTimers(timers);
  try {
    for (const command of [{ type: 'BEGIN_DISENGAGE' }, { type: 'CANCEL_DISENGAGE' }, { type: 'RESOLVE_DISENGAGE' }, { type: 'BASIC_RECON' }]) {
      seed(combatSnapshot());
      dispatch({ type: 'END_TURN' });
      const headEntries = historySignal.value.entries.length;
      timers.step();
      dispatch(command);
      assert.equal(historySignal.value.entries.length, headEntries, `${command.type}가 타임라인을 잘랐다`);
      timers.flush();
      assert.equal(isPlaybackActive(), false);
    }
  } finally {
    setPlaybackTimers(null);
  }
});

test('NEW_RUN은 재생 중에도 큐에 쌓이지 않고 즉시 런을 새로 만든다', () => {
  const timers = manualTimers();
  setPlaybackTimers(timers);
  try {
    seed(combatSnapshot());
    dispatch({ type: 'END_TURN' });
    assert.ok(isPlaybackActive());
    dispatch({ type: 'NEW_RUN', seed: 7 });
    assert.equal(isPlaybackActive(), false);
    assert.equal(historySignal.value.entries.length, 0, '새 런의 히스토리는 비어 있다');
    assert.equal(snapshotSignal.value.activeCombatState, null);
  } finally {
    setPlaybackTimers(null);
  }
});
