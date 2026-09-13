// Capability 층계 비용 계산 (§5단계, D8).
//
// 이 모듈이 존재하는 이유는 Capability 게이트가 이분법이면 장비 선택이 "요구치를 넘겼나"라는
// 체크박스가 되기 때문이다. 층계로 바꾸면 모자란 채로도 들어갈 수 있고, 대신 무엇을 치를지가
// 선택지가 된다.
//
// 그리고 그 대가를 전부 시간으로 받으면 시간이 다시 단일 통화가 되어 층계가 의미를 잃는다.
// 그래서 Capability마다 자기 통화가 따로 있고(아래 CAPABILITY_CURRENCIES), 시간 가감만 공통이다.
//
// 시간은 배율이 아니라 정수 칸 가감으로 받는다(ADR-0075). 배율이면 같은 단계가 기본 비용마다
// 다른 반올림 값으로 갈라져 "이 행동 동안 적이 몇 번 움직이나"를 뺄셈으로 알 수 없게 된다.
//
// 이 모듈은 순수 계산만 한다 — 상태를 건드리지 않고 "무엇을 치러야 하는지"만 돌려준다.
// 대가마다 반영할 자리가 다르기 때문이다(hpCost는 playerState, 나머지는 facilityRunState).

import {
  CAPABILITY_STEP_TIME_DELTA,
  CAPABILITY_MIN_TIME,
  CAPABILITY_STEP_NOISE_DELTA,
  CAPABILITY_STEP_DURABILITY_LOSS,
  CAPABILITY_STEP_OVERLOAD_DELTA,
  CAPABILITY_STEP_HP_COST,
  CAPABILITY_STEP_LEAVES_STRONG_TRACE,
  CAPABILITY_STEP_RAISES_ALERT,
} from '../data/facilityLayout.js';

/** @typedef {'surplus'|'standard'|'strained'|'severe'|'impossible'} CapabilityStep */
/** @typedef {'perception'|'stealth'|'hacking'|'mobility'|'force'|'deception'} CapabilityKind */

/**
 * @typedef {object} CapabilityCostBase 호출부가 넘기는 "표준 비용". 없는 항목은 그 통화를 안 쓴다는 뜻이다.
 * @property {number} [time] 표준 소요 시간. 시간은 전 Capability 공통 통화라 대부분 채워진다.
 * @property {number} [noise] 표준 소음 강도(0~3).
 * @property {number} [overload] 표준 과부화 증가량.
 * @property {Record<string, number>} [durationByStep] 단계별 지속 **고정표**. 지속이 통화인
 *   행동(현재는 Deception 가짜 목표 송출)만 넘긴다. 배율을 곱하지 않고 이 표를 조회한다.
 * @property {number} [timeDelta] 층계 밖의 칸 가감(공통 접근 모드의 안전 +2 / 강행 -2).
 *   층계 가감 뒤, 최소 1칸 클램프 전에 더한다.
 * @property {boolean} [dedicatedTimeRule] 전용 시간 규칙을 가진 행동(이동의 Mobility 가감,
 *   흔적 정리의 Perception 전용표)은 층계 시간 가감을 중복으로 받지 않는다.
 */

/**
 * @typedef {object} CapabilityCost
 * @property {CapabilityStep} step
 * @property {number} timeCost 정수 칸.
 * @property {number} noise 0~3으로 clamp된 소음 강도. 0은 무음이다.
 * @property {number} overload 과부화 증감. 음수면 오히려 부하가 내려간다(surplus).
 * @property {number} hpCost 차감할 HP. playerState 쪽이라 호출부가 따로 반영한다.
 * @property {number} durabilityLoss 깎일 장비 내구도.
 * @property {number|null} duration base.durationByStep가 있을 때만 조회된 실제 지속 칸.
 * @property {boolean} leavesStrongTrace 남기는 흔적이 tier 2가 되는가.
 * @property {boolean} raisesAlert 그 자리에서 구역 경계도를 올리는가.
 */

/**
 * Capability별로 "자기 통화만" 받는다. 여기 없는 통화는 그 Capability의 부족분으로 청구되지
 * 않으며(시간 가감만은 공통), base로 들어온 표준 비용은 단계와 무관하게 그대로 통과한다.
 * 표에 새 항목을 더하기 전에 D8의 의도 — 통화가 겹치면 층계가 다시 시간 하나로 수렴한다 — 를 볼 것.
 * @type {Record<CapabilityKind, {noise?: true, durability?: true, overload?: true, hp?: true, duration?: true, trace?: true, alert?: true}>}
 */
const CAPABILITY_CURRENCIES = {
  hacking: { overload: true },
  force: { noise: true, durability: true },
  stealth: { trace: true, alert: true },
  mobility: { hp: true },
  perception: {}, // 시간만 받는다. Perception은 정보 수단이라 실패해도 시끄러워질 것이 없다.
  deception: { duration: true },
};

/** 소음 강도는 1~3이고 0은 무음이다 — 표 바깥 값이 나오면 소음 파이프라인이 hop 범위를 못 찾는다. */
const NOISE_MIN = 0;
const NOISE_MAX = 3;

/** @param {number} value @returns {number} */
function clampNoise(value) {
  return Math.max(NOISE_MIN, Math.min(NOISE_MAX, value));
}

/**
 * 요구치 대비 실효 수치의 차이로 층계를 가른다.
 *
 * 여기서는 `effectiveForRequirement`의 `max(0, value)` clamp를 쓰지 않는다. 그 clamp는 이분법
 * 게이트(`< 1`이면 실패)를 위한 것이라 "-2든 0이든 어차피 실패"여서 음수를 구분할 이유가 없었다.
 * 층계에서는 그 음수 구간이 바로 필요한 정보다 — clamp를 걸면 요구치가 2 이하인 행동에서
 * impossible이 아예 나올 수 없게 되어 불가 구간이 증발한다. 원시 수치를 그대로 재야
 * Capability 하한(`CAPABILITY_MIN` = -2)에 있는 빌드만 막히고 기본 로드아웃(0)은 대가를 치르고
 * 통과한다.
 *
 * @param {number} effectiveValue 원시 Capability 수치(-2 ~ 4).
 * @param {number} [required] 요구치 R.
 * @returns {CapabilityStep}
 */
export function capabilityStep(effectiveValue, required = 1) {
  const gap = effectiveValue - required;
  if (gap >= 1) return 'surplus';
  if (gap === 0) return 'standard';
  if (gap === -1) return 'strained';
  if (gap === -2) return 'severe';
  return 'impossible';
}

/** 아무것도 치르지 않는 형태. impossible은 행동 자체가 일어나지 않으므로 비용이 없다. */
const NO_COST = /** @type {const} */ ({
  timeCost: 0,
  noise: 0,
  overload: 0,
  hpCost: 0,
  durabilityLoss: 0,
  duration: null,
  leavesStrongTrace: false,
  raisesAlert: false,
});

/**
 * 그 단계에서 치러야 할 대가를 계산한다.
 *
 * `impossible`이면 여기서 throw하지 않고 단계만 돌려준다 — 막는 문구와 예외 형태는 행동마다
 * 달라서 호출부가 정해야 한다. 나머지 필드는 전부 0/false라 호출부가 단계 검사를 빠뜨려도
 * "대가 없이 성공"이 아니라 "아무 일도 없음"이 된다.
 *
 * 반면 알 수 없는 `capabilityKind`는 즉시 throw한다. 조용히 표준 비용으로 넘기면 오타 하나가
 * 대가 없는 행동을 만들어내고, 그건 테스트로도 눈으로도 잡히지 않는다.
 *
 * @param {CapabilityKind} capabilityKind
 * @param {number} effectiveValue 원시 Capability 수치(-2 ~ 4).
 * @param {number} [required] 요구치 R.
 * @param {CapabilityCostBase} [base] 호출부가 주는 표준 비용.
 * @returns {CapabilityCost}
 */
export function resolveCapabilityCost(capabilityKind, effectiveValue, required = 1, base = {}) {
  const currencies = Object.prototype.hasOwnProperty.call(CAPABILITY_CURRENCIES, capabilityKind)
    ? CAPABILITY_CURRENCIES[capabilityKind]
    : null;
  if (!currencies) {
    throw new Error(`unknown capability kind: ${String(capabilityKind)}`);
  }

  const step = capabilityStep(effectiveValue, required);
  if (step === 'impossible') return { step, ...NO_COST };

  const baseTime = base.time ?? 0;
  const baseNoise = base.noise ?? 0;
  const baseOverload = base.overload ?? 0;

  // 자기 통화가 아닌 항목은 단계 보정 없이 표준 비용을 그대로 통과시킨다. base에 값이 없으면
  // 결과도 0이라 "hacking은 소음 0, force는 과부화 0"이 자연히 성립한다.
  const noise = currencies.noise ? baseNoise + CAPABILITY_STEP_NOISE_DELTA[step] : baseNoise;
  // 과부화는 clamp하지 않는다. surplus의 음수는 "부하를 오히려 덜어낸다"는 뜻이고, 게이지 하한
  // 처리는 과부화를 보관하는 쪽의 몫이다.
  const overload = currencies.overload ? baseOverload + CAPABILITY_STEP_OVERLOAD_DELTA[step] : baseOverload;
  // 지속이 통화인 행동은 단계별 고정표를 조회한다. 표를 안 넘겼으면 지속 개념이 없는 행동이다.
  // 자기 통화가 아닌 Capability에는 다른 대가와 마찬가지로 표준값(standard)이 그대로 통과한다.
  const duration = base.durationByStep ? base.durationByStep[currencies.duration ? step : 'standard'] : null;

  // 처리 순서: (자격 확인) -> 기본 비용 -> 층계 가감 -> (지원 행동에만) 접근 가감 -> 최소 1칸.
  // 중간에 클램프를 끼우면 강행(-2) 뒤 부족(+2)이 서로 상쇄되지 못해 같은 조합이 경로에 따라
  // 다른 값이 된다 — 그래서 가감을 전부 더한 뒤에 한 번만 자른다.
  const stepTimeDelta = base.dedicatedTimeRule ? 0 : CAPABILITY_STEP_TIME_DELTA[step];
  const rawTime = baseTime + stepTimeDelta + (base.timeDelta ?? 0);

  return {
    step,
    timeCost: baseTime > 0 ? Math.max(CAPABILITY_MIN_TIME, rawTime) : 0,
    noise: clampNoise(noise),
    overload,
    hpCost: currencies.hp ? CAPABILITY_STEP_HP_COST[step] : 0,
    durabilityLoss: currencies.durability ? CAPABILITY_STEP_DURABILITY_LOSS[step] : 0,
    // 지속 개념이 없는 행동에 0을 주면 호출부가 "지속 0"으로 오해한다. 없으면 null로 둔다.
    duration,
    leavesStrongTrace: currencies.trace ? CAPABILITY_STEP_LEAVES_STRONG_TRACE[step] : false,
    raisesAlert: currencies.alert ? CAPABILITY_STEP_RAISES_ALERT[step] : false,
  };
}
