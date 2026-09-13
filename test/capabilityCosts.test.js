// §5단계 Capability 층계(D8): 게이트가 이분법이면 장비 선택이 체크박스가 되므로, 모자란 채로도
// 들어가되 대가를 치르게 한다. 이 테스트가 지키려는 것은 그 대가가 Capability마다 다른 통화라는
// 점이다 — 전부 시간으로 받으면 시간이 다시 단일 통화가 되어 층계가 무의미해진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityStep, resolveCapabilityCost } from '../src/engine/capabilityCosts.js';
import {
  CAPABILITY_STEP_TIME_DELTA, CAPABILITY_MIN_TIME, CAPABILITY_STEP_HP_COST,
  CAPABILITY_STEP_RAISES_ALERT, FALSE_BROADCAST_DURATION_BY_STEP, APPROACH_TIME_DELTA,
} from '../src/data/facilityLayout.js';
import { CAPABILITY_MIN, CAPABILITY_MAX } from '../src/data/facilityEquipmentCapabilities.js';

test('the step is decided by the raw gap between capability and requirement, at every boundary', () => {
  for (const required of [0, 1, 2, 3, 4]) {
    assert.equal(capabilityStep(required + 2, required), 'surplus');
    assert.equal(capabilityStep(required + 1, required), 'surplus');
    assert.equal(capabilityStep(required, required), 'standard');
    assert.equal(capabilityStep(required - 1, required), 'strained');
    assert.equal(capabilityStep(required - 2, required), 'severe');
    assert.equal(capabilityStep(required - 3, required), 'impossible');
    assert.equal(capabilityStep(required - 9, required), 'impossible');
  }

  assert.deepEqual(
    [3, 2, 1, 0, -1, -2].map((a) => capabilityStep(a, 1)),
    ['surplus', 'surplus', 'standard', 'strained', 'severe', 'impossible'],
  );
});

test('the impossible band survives at the common requirement of 1', () => {
  // 층계 판정은 원시 수치를 쓴다. `effectiveForRequirement`의 max(0, x)를 끼우면 A가 0 밑으로
  // 내려가지 못해 요구치 1~2인 행동에서 impossible이 아예 나올 수 없다 — D8이 남기려 한 불가
  // 구간이 증발하는 것이다. 하한 빌드만 막히고 기본 로드아웃은 대가를 치르고 통과해야 한다.
  assert.equal(capabilityStep(CAPABILITY_MIN, 1), 'impossible', 'Capability 하한(-2) 빌드는 막힌다');
  assert.equal(capabilityStep(-1, 1), 'severe');
  assert.equal(capabilityStep(0, 1), 'strained', '기본 로드아웃(0)은 대가를 치르고 통과한다');
  assert.equal(capabilityStep(CAPABILITY_MAX, 1), 'surplus');
  assert.equal(resolveCapabilityCost('hacking', CAPABILITY_MIN, 1, { time: 100 }).step, 'impossible');
  assert.equal(resolveCapabilityCost('hacking', 0, 1, { time: 100 }).step, 'strained');
});

test('required defaults to 1, the common gate', () => {
  assert.equal(capabilityStep(2), 'surplus');
  assert.equal(capabilityStep(1), 'standard');
  assert.equal(capabilityStep(0), 'strained');
});

test('a lower capability always means a lower step, negatives included', () => {
  // 음수 구간이 뭉개지지 않아야 -2와 0이 서로 다른 결과를 낳는다.
  const order = ['impossible', 'severe', 'strained', 'standard', 'surplus'];
  for (const required of [1, 2, 3]) {
    let previous = -1;
    for (const value of [CAPABILITY_MIN, -1, 0, 1, 2, 3, CAPABILITY_MAX]) {
      const rank = order.indexOf(capabilityStep(value, required));
      assert.ok(rank >= previous, `R=${required}, A=${value}에서 단계가 거꾸로 갔다`);
      previous = rank;
    }
  }

  assert.notEqual(capabilityStep(-2, 2), capabilityStep(0, 2), '-2와 0은 구분된다');
  assert.equal(resolveCapabilityCost('mobility', -1, 1, { time: 1 }).hpCost, CAPABILITY_STEP_HP_COST.severe);
  assert.equal(resolveCapabilityCost('mobility', -2, 1, { time: 1 }).hpCost, 0, 'impossible은 아무것도 치르지 않는다');
});

test('force pays in noise and durability, and never raises the alert', () => {
  const base = { time: 100, noise: 2 };
  const standard = resolveCapabilityCost('force', 1, 1, base);
  const strained = resolveCapabilityCost('force', 0, 1, base);
  const severe = resolveCapabilityCost('force', 0, 2, base);

  assert.equal(standard.noise, 2);
  assert.equal(strained.noise, 3, '무리하면 시끄럽다');
  assert.equal(severe.noise, 3, '소음 강도는 3이 상한이다');
  assert.equal(severe.durabilityLoss, 1, 'severe에서만 장비가 상한다');
  assert.equal(strained.durabilityLoss, 0);

  for (const cost of [standard, strained, severe]) {
    assert.equal(cost.raisesAlert, false, 'Force는 경계도를 올리지 않는다');
    assert.equal(cost.hpCost, 0);
    assert.equal(cost.leavesStrongTrace, false);
  }
});

test('hacking pays in the sector alert, and leaves noise exactly as the caller gave it', () => {
  const base = { time: 100, noise: 0 };
  const standard = resolveCapabilityCost('hacking', 2, 2, base);
  const strained = resolveCapabilityCost('hacking', 1, 2, base);
  const severe = resolveCapabilityCost('hacking', 0, 2, base);

  assert.equal(standard.raisesAlert, CAPABILITY_STEP_RAISES_ALERT.standard);
  assert.equal(strained.raisesAlert, CAPABILITY_STEP_RAISES_ALERT.strained);
  assert.equal(severe.raisesAlert, CAPABILITY_STEP_RAISES_ALERT.severe, '서툰 해킹은 그 자리에서 경계를 올린다');

  for (const cost of [standard, strained, severe]) {
    assert.equal(cost.noise, 0, 'Hacking은 조용하다 — 부족해도 소음으로 청구하지 않는다');
    assert.equal(cost.durabilityLoss, 0);
    assert.equal(cost.hpCost, 0);
  }

  // 소음이 있는 해킹 행동이라면 표준 소음이 단계와 무관하게 그대로 통과해야 한다.
  const noisy = resolveCapabilityCost('hacking', 0, 2, { time: 10, noise: 2 });
  assert.equal(noisy.noise, 2);
});

test('stealth pays in traces, and severe drags the sector alert up with it', () => {
  const base = { time: 60 };
  assert.equal(resolveCapabilityCost('stealth', 2, 2, base).leavesStrongTrace, false);

  const strained = resolveCapabilityCost('stealth', 1, 2, base);
  assert.equal(strained.leavesStrongTrace, true, '서툰 침투는 강한 흔적을 남긴다');
  assert.equal(strained.raisesAlert, false, 'strained는 아직 경계까지 올리지 않는다');

  const severe = resolveCapabilityCost('stealth', 0, 2, base);
  assert.equal(severe.leavesStrongTrace, true);
  assert.equal(severe.raisesAlert, true);

  for (const cost of [strained, severe]) {
    assert.equal(cost.noise, 0, 'Stealth 부족은 소음이 아니라 흔적으로 청구된다');
    assert.equal(cost.hpCost, 0);
  }
});

test('mobility pays in HP on top of time, and perception pays in time alone', () => {
  const base = { time: 80 };
  const mobility = resolveCapabilityCost('mobility', 0, 1, base);
  assert.equal(mobility.hpCost, CAPABILITY_STEP_HP_COST.strained);
  assert.equal(resolveCapabilityCost('mobility', 0, 2, base).hpCost, CAPABILITY_STEP_HP_COST.severe);
  assert.equal(resolveCapabilityCost('mobility', 1, 1, base).hpCost, 0, '표준이면 몸은 안 상한다');

  const perception = resolveCapabilityCost('perception', 0, 1, base);
  assert.equal(perception.timeCost, 80 + CAPABILITY_STEP_TIME_DELTA.strained);
  assert.equal(perception.hpCost, 0);
  assert.equal(perception.noise, 0);
  assert.equal(perception.durabilityLoss, 0);
  assert.equal(perception.leavesStrongTrace, false);
  assert.equal(perception.raisesAlert, false);
});

test('deception pays by shortening the effect, read straight off the fixed per-step table', () => {
  // 지속도 시간이라 배율이 아니라 단계별 고정 칸 표다(ADR-0075) — 곱셈이 끼면 같은 단계가
  // 기본값마다 다른 반올림 값으로 갈라져 "몇 칸 버티나"를 뺄셈으로 읽을 수 없다.
  const base = { time: 40, durationByStep: FALSE_BROADCAST_DURATION_BY_STEP };
  assert.equal(resolveCapabilityCost('deception', 2, 1, base).duration, 19, '여유');
  assert.equal(resolveCapabilityCost('deception', 1, 1, base).duration, 15, '적정이 기본값이다');
  assert.equal(resolveCapabilityCost('deception', 0, 1, base).duration, 8, '부족');
  assert.equal(resolveCapabilityCost('deception', 0, 2, base).duration, 4, '크게 부족');

  // 지속 개념이 없는 행동에 0을 주면 "지속 0"으로 오해할 수 있으므로 null이다.
  assert.equal(resolveCapabilityCost('deception', 0, 1, { time: 40 }).duration, null);
  // 자기 통화가 아니면 다른 대가처럼 표준값이 단계와 무관하게 그대로 통과한다.
  assert.equal(resolveCapabilityCost('force', 0, 1, base).duration, FALSE_BROADCAST_DURATION_BY_STEP.standard);
});

test('surplus is genuinely cheaper than standard in both time and the own currency', () => {
  const base = { time: 100, noise: 2, durationByStep: FALSE_BROADCAST_DURATION_BY_STEP };

  const standardTime = resolveCapabilityCost('perception', 2, 2, base).timeCost;
  const surplusTime = resolveCapabilityCost('perception', 3, 2, base).timeCost;
  assert.ok(surplusTime < standardTime, `${surplusTime} < ${standardTime}`);
  assert.equal(surplusTime, 100 + CAPABILITY_STEP_TIME_DELTA.surplus);

  assert.ok(resolveCapabilityCost('force', 3, 2, base).noise < resolveCapabilityCost('force', 2, 2, base).noise);
  assert.ok(resolveCapabilityCost('deception', 3, 2, base).duration > resolveCapabilityCost('deception', 2, 2, base).duration);
});

test('the step charges a fixed number of ticks, the same count regardless of the base cost', () => {
  // 배율이면 같은 단계가 기본 비용마다 다른 값을 물린다. 가감이므로 33이든 4든 부족은 +2다.
  for (const baseTime of [4, 33]) {
    const at = (value, required) => resolveCapabilityCost('perception', value, required, { time: baseTime }).timeCost;
    assert.equal(at(2, 1) - baseTime, CAPABILITY_STEP_TIME_DELTA.surplus);
    assert.equal(at(1, 1) - baseTime, CAPABILITY_STEP_TIME_DELTA.standard);
    assert.equal(at(0, 1) - baseTime, CAPABILITY_STEP_TIME_DELTA.strained);
    assert.equal(at(0, 2) - baseTime, CAPABILITY_STEP_TIME_DELTA.severe);
  }

  // 기본 4칸 행동은 여유 3 / 적정 4 / 부족 6 / 크게 부족 8칸이다.
  assert.deepEqual(
    [[2, 1], [1, 1], [0, 1], [0, 2]].map(([a, r]) => resolveCapabilityCost('hacking', a, r, { time: 4 }).timeCost),
    [3, 4, 6, 8],
  );

  for (const kind of ['perception', 'stealth', 'hacking', 'mobility', 'force', 'deception']) {
    for (const value of [5, 4, 3, 2, 1]) {
      const { timeCost } = resolveCapabilityCost(kind, value, 3, { time: 33 });
      assert.ok(Number.isInteger(timeCost), `${kind}/${value} -> ${timeCost}`);
    }
  }
});

test('the floor is one tick — surplus never makes a paid action free', () => {
  // 0칸이면 무료 조작과 구분이 사라져 "시간 없는 반복"이 열린다.
  assert.equal(resolveCapabilityCost('hacking', 4, 1, { time: 1 }).timeCost, CAPABILITY_MIN_TIME);
  assert.equal(resolveCapabilityCost('hacking', 4, 1, { time: 1, timeDelta: APPROACH_TIME_DELTA.rush }).timeCost, CAPABILITY_MIN_TIME);
  // 시간을 아예 안 쓰는 행동은 0 그대로다 — 하한은 유료 행동에만 건다.
  assert.equal(resolveCapabilityCost('hacking', 4, 1, {}).timeCost, 0);
});

test('the access delta lands after the step delta, so rush and strained cancel instead of clipping', () => {
  // 접근 가감을 먼저 잘라 버리면 강행(-2)이 하한에 걸려 사라지고 뒤이은 부족(+2)만 남아,
  // 같은 조합이 적용 순서에 따라 다른 값이 된다.
  assert.equal(resolveCapabilityCost('force', 0, 1, { time: 2, timeDelta: APPROACH_TIME_DELTA.rush }).timeCost, 2);
  assert.equal(resolveCapabilityCost('force', 1, 1, { time: 2, timeDelta: APPROACH_TIME_DELTA.safe }).timeCost, 4);

  // 기본 4칸 문 열기 — 여유+강행 1칸, 부족+안전 8칸.
  assert.equal(resolveCapabilityCost('hacking', 2, 1, { time: 4, timeDelta: APPROACH_TIME_DELTA.rush }).timeCost, 1);
  assert.equal(resolveCapabilityCost('hacking', 0, 1, { time: 4, timeDelta: APPROACH_TIME_DELTA.safe }).timeCost, 8);
});

test('an action with its own time rule does not take the step delta on top of it', () => {
  // 이동(Mobility 가감)과 흔적 정리(Perception 전용표)는 이미 수치별 표를 갖는다. 층계를 또
  // 얹으면 같은 Capability 수치에 대가를 두 번 물린다.
  for (const [value, required] of [[2, 1], [1, 1], [0, 1], [0, 2]]) {
    assert.equal(resolveCapabilityCost('perception', value, required, { time: 14, dedicatedTimeRule: true }).timeCost, 14);
  }
  // 그래도 불가 판정은 층계가 그대로 맡는다.
  assert.equal(resolveCapabilityCost('perception', -2, 1, { time: 14, dedicatedTimeRule: true }).step, 'impossible');
});

test('noise is clamped into the 0..3 band the noise pipeline understands', () => {
  assert.equal(resolveCapabilityCost('force', 0, 2, { time: 10, noise: 3 }).noise, 3);
  assert.equal(resolveCapabilityCost('force', 3, 2, { time: 10, noise: 0 }).noise, 0, 'surplus가 소음을 음수로 만들지 않는다');
});

test('impossible returns the step instead of throwing, and charges nothing', () => {
  let cost;
  assert.doesNotThrow(() => { cost = resolveCapabilityCost('hacking', 0, 3, { time: 100, durationByStep: FALSE_BROADCAST_DURATION_BY_STEP }); });
  assert.equal(cost.step, 'impossible');
  assert.equal(cost.timeCost, 0);
  assert.equal(cost.noise, 0);
  assert.equal(cost.hpCost, 0);
  assert.equal(cost.durabilityLoss, 0);
  assert.equal(cost.duration, null);
  assert.equal(cost.leavesStrongTrace, false);
  assert.equal(cost.raisesAlert, false);
});

test('an unknown capability kind throws instead of quietly costing nothing', () => {
  // 오타가 조용히 표준 비용으로 통과하면 "대가가 없는 행동"이 생겨도 아무도 모른다.
  assert.throws(() => resolveCapabilityCost('stealh', 1, 1, { time: 10 }), /unknown capability kind/);
  assert.throws(() => resolveCapabilityCost('', 1, 1), /unknown capability kind/);
  assert.throws(() => resolveCapabilityCost(undefined, 1, 1), /unknown capability kind/);
  assert.throws(() => resolveCapabilityCost('toString', 1, 1), /unknown capability kind/);
});

test('the caller\'s base object is never mutated', () => {
  const base = { time: 100, noise: 2, durationByStep: FALSE_BROADCAST_DURATION_BY_STEP };
  const snapshot = { ...base };
  for (const kind of ['perception', 'stealth', 'hacking', 'mobility', 'force', 'deception']) {
    for (const value of [4, 3, 2, 1, 0]) resolveCapabilityCost(kind, value, 3, base);
  }
  assert.deepEqual(base, snapshot);
});
