// §5단계 Capability 층계(D8): 게이트가 이분법이면 장비 선택이 체크박스가 되므로, 모자란 채로도
// 들어가되 대가를 치르게 한다. 이 테스트가 지키려는 것은 그 대가가 Capability마다 다른 통화라는
// 점이다 — 전부 시간으로 받으면 시간이 다시 단일 통화가 되어 층계가 무의미해진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityStep, resolveCapabilityCost } from '../src/engine/capabilityCosts.js';
import {
  CAPABILITY_STEP_TIME_MULTIPLIER, CAPABILITY_STEP_HP_COST,
  CAPABILITY_STEP_OVERLOAD_DELTA, CAPABILITY_STEP_DURATION_MULTIPLIER,
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

test('force pays in noise and durability, and nothing in overload', () => {
  const base = { time: 100, noise: 2, overload: 0 };
  const standard = resolveCapabilityCost('force', 1, 1, base);
  const strained = resolveCapabilityCost('force', 0, 1, base);
  const severe = resolveCapabilityCost('force', 0, 2, base);

  assert.equal(standard.noise, 2);
  assert.equal(strained.noise, 3, '무리하면 시끄럽다');
  assert.equal(severe.noise, 3, '소음 강도는 3이 상한이다');
  assert.equal(severe.durabilityLoss, 1, 'severe에서만 장비가 상한다');
  assert.equal(strained.durabilityLoss, 0);

  for (const cost of [standard, strained, severe]) {
    assert.equal(cost.overload, 0, 'Force는 과부화를 내지 않는다');
    assert.equal(cost.hpCost, 0);
    assert.equal(cost.leavesStrongTrace, false);
  }
});

test('hacking pays in overload, and leaves noise exactly as the caller gave it', () => {
  const base = { time: 100, overload: 5, noise: 0 };
  const standard = resolveCapabilityCost('hacking', 2, 2, base);
  const strained = resolveCapabilityCost('hacking', 1, 2, base);
  const severe = resolveCapabilityCost('hacking', 0, 2, base);

  assert.equal(standard.overload, 5);
  assert.equal(strained.overload, 5 + CAPABILITY_STEP_OVERLOAD_DELTA.strained);
  assert.equal(severe.overload, 5 + CAPABILITY_STEP_OVERLOAD_DELTA.severe);

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
    assert.equal(cost.overload, 0);
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
  assert.equal(perception.timeCost, Math.round(80 * CAPABILITY_STEP_TIME_MULTIPLIER.strained));
  assert.equal(perception.hpCost, 0);
  assert.equal(perception.noise, 0);
  assert.equal(perception.overload, 0);
  assert.equal(perception.durabilityLoss, 0);
  assert.equal(perception.leavesStrongTrace, false);
  assert.equal(perception.raisesAlert, false);
});

test('deception pays by shortening the effect, and duration stays null when the action has none', () => {
  const base = { time: 40, duration: 200 };
  assert.equal(resolveCapabilityCost('deception', 1, 1, base).duration, 200);
  assert.equal(resolveCapabilityCost('deception', 0, 1, base).duration, 100, 'strained는 절반');
  assert.equal(resolveCapabilityCost('deception', 0, 2, base).duration, 50, 'severe는 4분의 1');
  assert.equal(
    resolveCapabilityCost('deception', 2, 1, base).durationMultiplier,
    CAPABILITY_STEP_DURATION_MULTIPLIER.surplus,
  );

  // 지속 개념이 없는 행동에 0을 주면 "지속 0"으로 오해할 수 있으므로 null이다.
  assert.equal(resolveCapabilityCost('deception', 0, 1, { time: 40 }).duration, null);
  assert.equal(resolveCapabilityCost('force', 0, 1, base).durationMultiplier, 1, '자기 통화가 아니면 배수는 중립이다');
  assert.equal(resolveCapabilityCost('force', 0, 1, base).duration, 200);
});

test('surplus is genuinely cheaper than standard in both time and the own currency', () => {
  const base = { time: 100, noise: 2, overload: 10, duration: 200 };

  const standardTime = resolveCapabilityCost('perception', 2, 2, base).timeCost;
  const surplusTime = resolveCapabilityCost('perception', 3, 2, base).timeCost;
  assert.ok(surplusTime < standardTime, `${surplusTime} < ${standardTime}`);
  assert.equal(surplusTime, Math.round(100 * CAPABILITY_STEP_TIME_MULTIPLIER.surplus));

  assert.ok(resolveCapabilityCost('force', 3, 2, base).noise < resolveCapabilityCost('force', 2, 2, base).noise);
  assert.ok(resolveCapabilityCost('hacking', 3, 2, base).overload < resolveCapabilityCost('hacking', 2, 2, base).overload);
  assert.ok(resolveCapabilityCost('deception', 3, 2, base).duration > resolveCapabilityCost('deception', 2, 2, base).duration);
});

test('time is a rounded integer for every kind and step', () => {
  for (const kind of ['perception', 'stealth', 'hacking', 'mobility', 'force', 'deception']) {
    for (const value of [5, 4, 3, 2, 1]) {
      const { timeCost } = resolveCapabilityCost(kind, value, 3, { time: 33 });
      assert.ok(Number.isInteger(timeCost), `${kind}/${value} -> ${timeCost}`);
    }
  }
  assert.equal(resolveCapabilityCost('perception', 0, 1, { time: 33 }).timeCost, 46); // 33 * 1.4 = 46.2
});

test('noise is clamped into the 0..3 band the noise pipeline understands', () => {
  assert.equal(resolveCapabilityCost('force', 0, 2, { time: 10, noise: 3 }).noise, 3);
  assert.equal(resolveCapabilityCost('force', 3, 2, { time: 10, noise: 0 }).noise, 0, 'surplus가 소음을 음수로 만들지 않는다');
});

test('impossible returns the step instead of throwing, and charges nothing', () => {
  let cost;
  assert.doesNotThrow(() => { cost = resolveCapabilityCost('hacking', 0, 3, { time: 100, overload: 10, duration: 200 }); });
  assert.equal(cost.step, 'impossible');
  assert.equal(cost.timeCost, 0);
  assert.equal(cost.noise, 0);
  assert.equal(cost.overload, 0);
  assert.equal(cost.hpCost, 0);
  assert.equal(cost.durabilityLoss, 0);
  assert.equal(cost.durationMultiplier, 1, '배수만은 중립값 1이다 — 0이면 호출부가 곱했을 때 의미가 뒤집힌다');
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
  const base = { time: 100, noise: 2, overload: 10, duration: 200 };
  const snapshot = { ...base };
  for (const kind of ['perception', 'stealth', 'hacking', 'mobility', 'force', 'deception']) {
    for (const value of [4, 3, 2, 1, 0]) resolveCapabilityCost(kind, value, 3, base);
  }
  assert.deepEqual(base, snapshot);
});
