// 유료 행동 하나가 실제로 얼마를 청구하는지 — 엔진의 청구 경로와 UI의 예고가 **같은 함수**를
// 쓰도록 비용 사양을 한 곳에 모은다.
//
// 이 모듈이 따로 있는 이유: 예고가 UI에서 따로 계산되면 상수 하나만 바뀌어도 화면이 조용히
// 거짓말을 한다. 플레이어는 예고된 칸으로 마감(붕괴·출구 폐쇄·적 다음 이동)을 뺄셈해 계획을
// 세우므로, 예고와 청구가 1칸이라도 갈라지면 그 계획 전체가 틀어진다. 그래서 MapScreen은
// 숫자를 적지 않고 `forecastAction()`을 부르고, runEngine/recovery는 같은 표를 통과하는
// `requireActionCost()`로 비용을 만든다.
//
// 시간은 전부 정수 칸이다(ADR-0075). 처리 순서는 기본 비용 -> 층계 가감 -> 접근 가감 ->
// 최소 1칸이며, 그 순서는 capabilityCosts.resolveCapabilityCost 하나가 지킨다.

import { RuleViolation } from './errors.js';
import { resolveCapabilityCost } from './capabilityCosts.js';
import {
  APPROACH_TIME_DELTA, APPROACH_NOISE_DELTA, APPROACH_MIN_TIME,
  BASIC_RECON_TIME, WAIT_TICK_TIME, ENCOUNTER_EVADE_TIME, CONCEALMENT_ACTION_TIME_COST,
  CORPSE_DISPOSAL_TIME, EXIT_REQUEST_TIME,
  SUPPLY_FARM_TIME, SUPPLY_FARM_NOISE, PRIZE_FARM_TIME, PRIZE_FARM_NOISE,
  FORCE_TIER1_TIME, FORCE_BASE_NOISE, HACKING_TIER1_TIME, HACKING_BASE_NOISE,
  HACKING_TIER1_OVERLOAD_GAIN, RUSH_OVERLOAD_GAIN, SAFE_OVERLOAD_DISCOUNT,
  CAMERA_HACK_TIME, CAMERA_HACK_OVERLOAD, CAMERA_FORCE_TIME, CAMERA_FORCE_NOISE,
  GENERATOR_HACK_TIME, GENERATOR_HACK_OVERLOAD, GENERATOR_FORCE_TIME, GENERATOR_FORCE_NOISE,
  CONTROL_ROOM_HACK_TIME, CONTROL_ROOM_HACK_OVERLOAD,
  CONTRACT_ACQUIRE_TIME, CONTRACT_ACQUIRE_OVERLOAD, CONTRACT_DESTROY_TIME, CONTRACT_DESTROY_OVERLOAD,
  CONTRACT_TRANSMIT_TIME, CONTRACT_TRANSMIT_OVERLOAD, CONTRACT_DETONATE_TIME,
  FAKE_NOISE_TIME, FAKE_NOISE_OVERLOAD, FAKE_NOISE_REQUIREMENT,
  HIGH_GROUND_MOBILITY_REQUIREMENT, ENCOUNTER_DECEIVE_REQUIREMENT,
  TRACE_CLEANUP_TIME_BY_PERCEPTION, POWER_CUT_TIME, POWER_CUT_NOISE,
  FALSE_BROADCAST_TIME, FALSE_BROADCAST_DURATION_BY_STEP,
  MOBILITY_MOVE_TIME_DELTA, MOVE_MIN_TIME, CAPABILITY_STEP_TIME_DELTA, CAPABILITY_MIN_TIME,
  WAIT_BATCH_MAX_TICKS,
} from '../data/facilityLayout.js';

/** 맵에서 장비를 한 건 갈아끼우는 데 드는 칸. 다른 현장 작업과 같은 결로 중단 대상이다. */
export const MAP_EQUIP_TIME_COST = 3;
/** 맵에서 회복류 소모품을 쓰는 데 드는 칸. */
export const MAP_CONSUMABLE_TIME_COST = 2;

/** @typedef {import('./capabilityCosts.js').CapabilityKind} CapabilityKind */
/** @typedef {import('./capabilityCosts.js').CapabilityCost} CapabilityCost */

/**
 * @typedef {object} ActionCostOpts 행동마다 필요한 것만 채워 넘긴다.
 * @property {number} [value] 원시 Capability 수치(-2~4).
 * @property {CapabilityKind} [capabilityKind] 수단을 호출부가 고르는 행동(특수 엣지·회수 계약)의 실제 수단.
 * @property {number} [required] 요구치 R. 사양이 스스로 정하면 그쪽이 이긴다.
 * @property {'safe'|'normal'|'rush'} [mode] 접근 모드.
 * @property {{timeCost: number, requiredCapability?: number|null}} [edge] 이동·특수 엣지의 대상 통로.
 * @property {boolean} [isPrize] 파밍 등급.
 * @property {'normal'|'elite'} [tier] 확보 대상 등급.
 * @property {number} [ticks] 묶음 대기가 요청하는 칸 수.
 * @property {{timeCost: number, overloadGain: number}} [contract] 현장 장비의 능동 효과 표.
 */

/**
 * @typedef {import('./capabilityCosts.js').CapabilityCostBase & {baseTime?: number, approachDelta?: number, mobilityDelta?: number, timeFloor?: number}} ActionCostBase
 *   표준 비용에 예고용 내역(가감 전 기본 칸, 접근 가감)을 덧붙인 형태.
 */

/** 원시 Capability 값을 표 색인(-2~4 -> 0~6)으로. @param {number} value */
function clampIndex(value) {
  return Math.max(-2, Math.min(4, value)) + 2;
}

/**
 * 통로 하나를 지나는 실제 칸 수. 통로 비용 B에 Mobility 칸 가감을 더하고 하한으로 자른다
 * (ADR-0075) — 배율이 아니므로 반올림이 끼어들 자리가 없다. runEngine이 이 함수를 그대로
 * 재수출하고 MapScreen의 도착 예고도 같은 함수를 쓴다.
 * @param {{timeCost: number}} edge
 * @param {number} effectiveMobility 원시 Mobility(-2~4).
 * @returns {number} 정수 칸.
 */
export function moveTimeCost(edge, effectiveMobility = 0) {
  return Math.max(MOVE_MIN_TIME, edge.timeCost + MOBILITY_MOVE_TIME_DELTA[clampIndex(effectiveMobility)]);
}

/**
 * 접근 모드(안전/표준/강행)의 시간·소음 가감. 층계가 걸리지 않는 행동(파밍)만 여기서 바로
 * 자른다 — 층계 행동은 `timeDelta`로 넘겨 마지막에 한 번만 잘라야 강행(-2)과 부족(+2)이
 * 서로 상쇄된다.
 * @param {number} baseTime @param {number} baseNoise @param {'safe'|'normal'|'rush'} mode
 */
export function applyApproachMode(baseTime, baseNoise, mode) {
  return {
    time: Math.max(APPROACH_MIN_TIME, baseTime + APPROACH_TIME_DELTA[mode]),
    noise: Math.max(0, Math.min(3, baseNoise + APPROACH_NOISE_DELTA[mode])),
  };
}

/**
 * 행동 하나의 비용 사양.
 *
 * `capability`가 null이면 층계가 걸리지 않는 고정 비용 행동이고, 그 경우 `base.time`이 곧
 * 청구 칸이다. `capability`가 있으면 base를 resolveCapabilityCost에 그대로 넘긴다.
 *
 * @typedef {object} ActionSpec
 * @property {string} label 예고에 쓰는 행동 이름.
 * @property {CapabilityKind|null} capability
 * @property {(opts: ActionCostOpts) => number} [required] 요구치 R(기본 1).
 * @property {(opts: ActionCostOpts) => ActionCostBase} base
 */

/** @type {Record<string, ActionSpec>} */
export const ACTION_SPECS = {
  move: {
    label: '이동',
    capability: null,
    // 이동은 Mobility 전용 시간 규칙을 쓴다(층계 가감을 얹지 않는다).
    base: (opts) => {
      const edge = /** @type {{timeCost: number}} */ (opts.edge);
      return {
        time: moveTimeCost(edge, opts.value ?? 0),
        baseTime: edge.timeCost,
        mobilityDelta: MOBILITY_MOVE_TIME_DELTA[clampIndex(opts.value ?? 0)],
        timeFloor: MOVE_MIN_TIME,
      };
    },
  },
  // 고지대 통과 — 이동 그 자체이므로 시간은 이동의 전용 규칙(Mobility 칸 가감)을 그대로 쓰고
  // (`dedicatedTimeRule`: 층계 시간 가감을 또 얹으면 같은 수치에 대가를 두 번 물린다),
  // 부족분은 Mobility의 통화인 HP로만 받는다. 요구치 3이라 0 이하가 불가 구간이 된다.
  traverseHighGround: {
    label: '고지대 통과',
    capability: 'mobility',
    required: () => HIGH_GROUND_MOBILITY_REQUIREMENT,
    base: (opts) => {
      const edge = /** @type {{timeCost: number}} */ (opts.edge);
      return {
        time: moveTimeCost(edge, opts.value ?? 0),
        baseTime: edge.timeCost,
        mobilityDelta: MOBILITY_MOVE_TIME_DELTA[clampIndex(opts.value ?? 0)],
        timeFloor: MOVE_MIN_TIME,
        dedicatedTimeRule: true,
      };
    },
  },
  // 조우 속이기 — 0칸짜리 선택지라 시간으로 받을 대가가 없다. 층계는 불가 판정만 맡고, 실제
  // 대가는 판정 자체에 붙는다(ENCOUNTER_DECEIVE_STEP_PENALTY, runEngine.deceiveThreat).
  encounterDeceive: {
    label: '조우 속이기',
    capability: 'deception',
    required: () => ENCOUNTER_DECEIVE_REQUIREMENT,
    base: () => ({ time: 0 }),
  },
  recon: { label: '기본 정찰', capability: null, base: () => ({ time: BASIC_RECON_TIME }) },
  wait: { label: '대기', capability: null, base: () => ({ time: WAIT_TICK_TIME }) },
  // 묶음 대기의 예고는 **최대치**다. 사건이 나면 그 자리에서 멈추고 실제로 흐른 칸만 소모되며,
  // 모자라게 끝났다는 사실은 대기 배너가 따로 말한다.
  waitBatch: {
    label: '묶음 대기',
    capability: null,
    base: (opts) => ({ time: WAIT_TICK_TIME * (opts.ticks ?? WAIT_BATCH_MAX_TICKS) }),
  },
  evade: { label: '조우 회피', capability: null, base: () => ({ time: ENCOUNTER_EVADE_TIME }) },
  concealment: { label: '은엄폐 사용', capability: null, base: () => ({ time: CONCEALMENT_ACTION_TIME_COST }) },
  corpse: { label: '시체 처리', capability: null, base: () => ({ time: CORPSE_DISPOSAL_TIME }) },
  requestExtraction: { label: '탈출구 개방 요청', capability: null, base: () => ({ time: EXIT_REQUEST_TIME }) },
  equipSwap: { label: '장비 교체', capability: null, base: () => ({ time: MAP_EQUIP_TIME_COST }) },
  mapConsumable: { label: '소모품 사용', capability: null, base: () => ({ time: MAP_CONSUMABLE_TIME_COST }) },
  farm: {
    label: '파밍',
    capability: null,
    base: (opts) => {
      const tier = opts.tier || 'normal';
      const mode = opts.mode || 'normal';
      const baseTime = opts.isPrize ? PRIZE_FARM_TIME[tier] : SUPPLY_FARM_TIME;
      const baseNoise = opts.isPrize ? PRIZE_FARM_NOISE[tier] : SUPPLY_FARM_NOISE;
      const applied = applyApproachMode(baseTime, baseNoise, mode);
      return { time: applied.time, noise: applied.noise, baseTime, approachDelta: APPROACH_TIME_DELTA[mode] };
    },
  },
  fieldEquipment: {
    label: '현장 장비',
    capability: null,
    base: (opts) => {
      const contract = /** @type {{timeCost: number, overloadGain: number}} */ (opts.contract);
      return { time: contract.timeCost, overload: contract.overloadGain };
    },
  },
  openEdge: {
    label: '특수 엣지 개방',
    capability: null, // 실제 종류는 opts.capabilityKind가 정한다(Force/Hacking 둘 다 가능).
    required: (opts) => opts.edge?.requiredCapability ?? opts.required ?? 1,
    base: (opts) => {
      const mode = opts.mode || 'normal';
      const isForce = opts.capabilityKind === 'force';
      const baseTime = isForce ? FORCE_TIER1_TIME : HACKING_TIER1_TIME;
      const baseNoise = isForce ? FORCE_BASE_NOISE : HACKING_BASE_NOISE;
      const { noise } = applyApproachMode(baseTime, baseNoise, mode);
      const overload = opts.capabilityKind === 'hacking'
        ? Math.max(0, HACKING_TIER1_OVERLOAD_GAIN + (mode === 'rush' ? RUSH_OVERLOAD_GAIN : 0) - (mode === 'safe' ? SAFE_OVERLOAD_DISCOUNT : 0))
        : 0;
      return { time: baseTime, timeDelta: APPROACH_TIME_DELTA[mode], noise, overload };
    },
  },
  hackInterface: { label: '접속 인터페이스 해킹', capability: 'hacking', base: () => ({ time: CAMERA_HACK_TIME, overload: CAMERA_HACK_OVERLOAD }) },
  hackCamera: { label: '카메라 해킹', capability: 'hacking', base: () => ({ time: CAMERA_HACK_TIME, overload: CAMERA_HACK_OVERLOAD }) },
  destroyCamera: { label: '카메라 파괴', capability: 'force', base: () => ({ time: CAMERA_FORCE_TIME, noise: CAMERA_FORCE_NOISE }) },
  disableGeneratorHack: { label: '발전기 해킹 무력화', capability: 'hacking', base: () => ({ time: GENERATOR_HACK_TIME, overload: GENERATOR_HACK_OVERLOAD }) },
  disableGeneratorForce: { label: '발전기 파괴', capability: 'force', base: () => ({ time: GENERATOR_FORCE_TIME, noise: GENERATOR_FORCE_NOISE }) },
  controlRoom: { label: '통제실 장악', capability: 'hacking', base: () => ({ time: CONTROL_ROOM_HACK_TIME, overload: CONTROL_ROOM_HACK_OVERLOAD }) },
  contractRetrieve: {
    label: '물건 확보',
    // 회수 계약은 Stealth와 Mobility 중 높은 쪽으로 판정한다 — 그 선택은 호출부가 하고
    // opts.capabilityKind로 넘어온다.
    capability: null,
    base: () => ({ time: CONTRACT_ACQUIRE_TIME, overload: CONTRACT_ACQUIRE_OVERLOAD }),
  },
  contractDestroy: { label: '폭약 설치', capability: 'force', base: () => ({ time: CONTRACT_DESTROY_TIME, overload: CONTRACT_DESTROY_OVERLOAD }) },
  // 기폭은 스위치를 누르는 일이다 — Capability 요구 없이 시간만 든다(C5).
  contractDetonate: { label: '기폭', capability: null, base: () => ({ time: CONTRACT_DETONATE_TIME }) },
  contractIntel: { label: '데이터 확보', capability: 'hacking', base: () => ({ time: CONTRACT_ACQUIRE_TIME, overload: CONTRACT_ACQUIRE_OVERLOAD }) },
  contractTransmit: { label: '데이터 송출', capability: 'hacking', base: () => ({ time: CONTRACT_TRANSMIT_TIME, overload: CONTRACT_TRANSMIT_OVERLOAD }) },
  cleanTraces: {
    label: '흔적 정리',
    capability: 'perception',
    // Perception은 자기 통화가 없어 시간으로만 받는다. 수치별 기준표가 곧 전용 시간 규칙이라
    // 층계 가감을 또 얹지 않는다(ADR-0075) — 얹으면 같은 수치에 대가를 두 번 물린다.
    base: (opts) => ({ time: TRACE_CLEANUP_TIME_BY_PERCEPTION[clampIndex(opts.value ?? 0)], dedicatedTimeRule: true }),
  },
  cutPower: { label: '전원 차단', capability: 'force', base: () => ({ time: POWER_CUT_TIME, noise: POWER_CUT_NOISE }) },
  falseBroadcast: {
    label: '가짜 목표 송출',
    capability: 'deception',
    base: () => ({ time: FALSE_BROADCAST_TIME, durationByStep: FALSE_BROADCAST_DURATION_BY_STEP }),
  },
  // 가짜 소음 — 지속이 통화인 다른 Deception 행동과 달리 고정 지속(소음 사건의 기본 수명)이라
  // durationByStep을 넘기지 않는다. 층계는 시간 가감과 불가 판정만 맡는다.
  fakeNoise: {
    label: '가짜 소음',
    capability: 'deception',
    required: () => FAKE_NOISE_REQUIREMENT,
    base: () => ({ time: FAKE_NOISE_TIME, overload: FAKE_NOISE_OVERLOAD }),
  },
};

/**
 * 그 행동의 사양을 꺼낸다. 없는 id는 즉시 던진다 — 조용히 0칸으로 넘기면 오타 하나가 공짜
 * 행동이 되고, 그건 화면으로도 테스트로도 잡히지 않는다.
 * @param {string} actionId
 * @returns {ActionSpec}
 */
function specOf(actionId) {
  const spec = ACTION_SPECS[actionId];
  if (!spec) throw new Error(`unknown action cost id: ${String(actionId)}`);
  return spec;
}

/** 그 행동이 실제로 쓰는 Capability. openEdge/contractRetrieve처럼 호출부가 수단을 고르는
 * 행동은 opts.capabilityKind가 답이다.
 * @param {ActionSpec} spec @param {ActionCostOpts} opts @returns {CapabilityKind|null} */
function kindOf(spec, opts) {
  return opts.capabilityKind || spec.capability;
}

/**
 * @typedef {object} ActionForecast 누르기 전에 보여줄 값이자, 눌렀을 때 실제로 나갈 값.
 * @property {string} actionId
 * @property {string} label
 * @property {CapabilityKind|null} capabilityKind
 * @property {number} required
 * @property {number} value 판정에 쓰인 원시 Capability 수치(층계가 안 걸리면 0).
 * @property {number} timeCost 실제로 청구될 칸.
 * @property {import('./capabilityCosts.js').CapabilityStep|null} step
 * @property {boolean} blocked 층계 불가라 시도조차 못 하는가.
 * @property {CapabilityCost|null} cost 층계가 걸린 행동의 전체 대가(소음·과부화·HP·내구도·지속).
 * @property {number} baseTime 가감 전 기본 칸.
 * @property {number} floor 가감을 다 더해도 이 아래로는 내려가지 않는 하한 칸(행동마다 다르다).
 * @property {{label: string, delta: number}[]} parts 기본값에 더해진 가감의 내역.
 * @property {number} noise 완료 시각에 낼 소음 강도(0은 무음).
 * @property {number} overload 완료 시각에 오를 과부화.
 * @property {number} baseNoise 층계 가감 전의 표준 소음 — 뱃지가 `소음 2(기본 3 − 여유 1)`을 쓸 근거.
 * @property {number} baseOverload 층계 가감 전의 표준 과부화.
 */

/**
 * 행동 하나의 비용을 계산한다 — UI 예고와 엔진 청구가 함께 쓰는 유일한 입구.
 * @param {string} actionId
 * @param {ActionCostOpts} [opts] 행동마다 필요한 것만.
 * @returns {ActionForecast}
 */
export function forecastAction(actionId, opts = {}) {
  const spec = specOf(actionId);
  const base = spec.base(opts);
  const required = spec.required ? spec.required(opts) : (opts.required ?? 1);
  const kind = kindOf(spec, opts);
  const baseTime = base.baseTime ?? base.time ?? 0;
  // 하한은 행동마다 다르다 — 이동은 2칸, 접근 모드만 걸린 행동은 1칸, 층계가 걸린 행동은
  // CAPABILITY_MIN_TIME이다. 예고 문장이 "(최소 1칸)"을 통째로 하드코딩하면 이동에서 거짓말이 된다.
  const floor = base.timeFloor ?? (kind ? CAPABILITY_MIN_TIME : APPROACH_MIN_TIME);
  /** @type {{label: string, delta: number}[]} */
  const parts = [];

  if (!kind) {
    // 층계가 걸리지 않는 고정 비용. 파밍의 접근 가감만 내역으로 보인다.
    if (base.mobilityDelta) parts.push({ label: 'Mobility', delta: base.mobilityDelta });
    if (base.approachDelta) parts.push({ label: '접근', delta: base.approachDelta });
    return {
      actionId, label: spec.label, capabilityKind: null, required, value: opts.value ?? 0,
      timeCost: base.time ?? 0, step: null, blocked: false, cost: null, baseTime, floor, parts,
      noise: base.noise ?? 0, overload: base.overload ?? 0,
      baseNoise: base.noise ?? 0, baseOverload: base.overload ?? 0,
    };
  }

  const value = opts.value ?? 0;
  const cost = resolveCapabilityCost(kind, value, required, base);
  if (cost.step !== 'impossible') {
    // 전용 시간 규칙을 쓰는 층계 행동(고지대 통과)은 그 규칙의 내역을 대신 낸다 — 여기서
    // 빠뜨리면 `고지대 통과 4칸`만 남고 왜 4칸인지가 화면에서 사라진다.
    if (base.mobilityDelta) parts.push({ label: 'Mobility', delta: base.mobilityDelta });
    if (!base.dedicatedTimeRule && CAPABILITY_STEP_TIME_DELTA[cost.step]) {
      parts.push({ label: '능력', delta: CAPABILITY_STEP_TIME_DELTA[cost.step] });
    }
    if (base.timeDelta) parts.push({ label: '접근', delta: base.timeDelta });
  }
  return {
    actionId,
    label: spec.label,
    capabilityKind: kind,
    required,
    value,
    timeCost: cost.timeCost,
    step: cost.step,
    blocked: cost.step === 'impossible',
    cost,
    baseTime,
    floor,
    parts,
    noise: cost.noise,
    overload: cost.overload,
    baseNoise: base.noise ?? 0,
    baseOverload: base.overload ?? 0,
  };
}

/**
 * 등급을 아직 모르는 확보 대상의 **범위 예고**. 확보 대상 파밍 비용은 등급(일반/상급)이 가르는데
 * 등급은 그 노드를 정찰해야 보이므로, 정찰 전에는 하나의 값을 약속할 수 없다. 그렇다고 버튼을
 * 잠그지는 않는다 — 정보 없이 도박하는 선택을 남기는 것이 이 설계의 요점이라, 대신 "10~13칸"처럼
 * 두 등급을 모두 감싸는 범위를 적는다. 실제 청구는 실제 등급의 정확한 값이며 항상 이 범위 안이다.
 * @param {'safe'|'normal'|'rush'} [mode]
 * @returns {{minTime: number, maxTime: number, minNoise: number, maxNoise: number, timeText: string, noiseText: string}}
 */
export function forecastUnknownPrizeFarm(mode = 'normal') {
  const tiers = /** @type {const} */ (['normal', 'elite'])
    .map((tier) => forecastAction('farm', { isPrize: true, tier, mode }));
  const times = tiers.map((f) => f.timeCost);
  const noises = tiers.map((f) => f.noise);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minNoise = Math.min(...noises);
  const maxNoise = Math.max(...noises);
  return {
    minTime,
    maxTime,
    minNoise,
    maxNoise,
    timeText: minTime === maxTime ? `${minTime}칸` : `${minTime}~${maxTime}칸`,
    noiseText: minNoise === maxNoise ? `${minNoise}` : `${minNoise}~${maxNoise}`,
  };
}

/**
 * 엔진의 청구 경로. 예고와 같은 표를 통과해야 "예고 = 청구"가 구조적으로 성립한다.
 * 층계 불가면 던진다 — 문구가 행동마다 달라야 UI가 이유를 말할 수 있으므로 호출부가 잡는다.
 * @param {string} actionId
 * @param {ActionCostOpts} [opts]
 * @returns {CapabilityCost}
 */
export function requireActionCost(actionId, opts = {}) {
  const forecast = forecastAction(actionId, opts);
  if (forecast.blocked) {
    throw new RuleViolation(`${forecast.capabilityKind} too low (needs ${forecast.required}, have ${opts.value ?? 0})`);
  }
  if (!forecast.cost) throw new RuleViolation(`${actionId} has no capability cost`);
  return forecast.cost;
}

/** 최종 칸 수만 필요할 때(고정 비용 행동 포함). @param {string} actionId @param {ActionCostOpts} [opts] */
export function actionTimeCost(actionId, opts = {}) {
  return forecastAction(actionId, opts).timeCost;
}

/**
 * 예고를 사람이 읽는 한 줄로 — `정찰 4칸`, `문 해킹 3칸 = 기본 4 − 능력 1`.
 * 가감이 없으면 분해를 붙이지 않는다(같은 값을 두 번 읽게 된다).
 * @param {ActionForecast} forecast
 * @param {string} [label] 행동 이름을 덮어쓸 때.
 * @returns {string}
 */
export function describeForecast(forecast, label = forecast.label) {
  if (forecast.blocked) return `${label} 불가`;
  const head = `${label} ${forecast.timeCost}칸`;
  if (forecast.parts.length === 0) return head;
  const tail = forecast.parts
    .map((part) => `${part.delta > 0 ? '+' : '−'} ${part.label} ${Math.abs(part.delta)}`)
    .join(' ');
  // 가감을 다 더해도 최종값과 다르면 하한에 잘린 것이다 — 그 사실을 감추면 분해가 최종 숫자와
  // 어긋나 보인다. 하한 값은 행동마다 다르므로(이동은 2칸) 예고가 들고 온 것을 그대로 쓴다.
  const sum = forecast.baseTime + forecast.parts.reduce((acc, part) => acc + part.delta, 0);
  const clampNote = sum === forecast.timeCost ? '' : ` (최소 ${forecast.floor}칸)`;
  return `${head} = 기본 ${forecast.baseTime} ${tail}${clampNote}`;
}
