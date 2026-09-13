// Capability 층계(D8)를 화면에 적는 공용 조각 — 단계 이름·색, 대가 한 줄 요약, 뱃지, 설명 툴팁.
//
// 원래 MapScreen.js 안에 있었지만 조우 패널도 같은 뱃지를 써야 해서 따로 뺐다(MapScreen이
// EncounterPanel을 import하므로 거꾸로 가져갈 수 없다). 여기 있는 것은 전부 표현이고, 숫자는
// 하나도 만들지 않는다 — 입력은 언제나 엔진이 실제로 청구할 값(actionCosts.forecastAction)이다.
import { html } from '../lib.js';
import { CAPABILITY_LABELS } from '../data/capabilityDisplay.js';
import { ALERT_GAUGE_CAPACITY, ALERT_PRESSURE } from '../data/facilityLayout.js';
import { Tooltip } from './Tooltip.js';

export const STEP_LABELS = { surplus: '여유', standard: '표준', strained: '무리', severe: '위태', impossible: '불가' };
export const STEP_COLORS = { surplus: '#15803d', standard: 'var(--color-neutral-600)', strained: '#b45309', severe: '#dc2626', impossible: '#dc2626' };

/**
 * 층계(D8)로 바뀌면서 버튼은 더 이상 잠기지 않고 "대가를 치르고 된다"가 됐다. 그 대가가 누르기
 * 전에 보이지 않으면 플레이어는 자기가 무엇을 지불했는지 사후에야 알게 된다 — 그러면 고민할
 * 자리가 사라지므로, 여기서 단계와 통화를 미리 문장으로 만든다.
 *
 * 입력은 엔진이 실제로 청구할 값(actionCosts.forecastAction)이다. 여기서 비용식을 다시 쓰면
 * 상수 하나만 바뀌어도 화면이 조용히 거짓말을 한다.
 * @param {import('../engine/actionCosts.js').ActionForecast} forecast
 * @param {string} [extra] 이 행동만의 추가 대가 한 줄(조우 속이기의 판정 벌점처럼 통화표에 없는 것).
 * @returns {{step: string, label: string, note: string, color: string, blocked: boolean}|null}
 */
export function ladderNote(forecast, extra = '') {
  const kind = forecast.capabilityKind;
  const cost = forecast.cost;
  // 층계가 걸리지 않는 고정 비용 행동(정찰·대기·시체 처리 등)은 뱃지가 없다.
  if (!kind || !cost || !forecast.step) return null;
  const step = forecast.step;
  if (step === 'impossible') {
    // 한 문장으로만 말한다. 예전에는 버튼에 '불가', 뱃지에 또 '불가', 그리고 요구치를 두 개
    // (표준 R과 시도 하한 R-2) 나란히 적어서, 셋 중 무엇이 진짜 조건인지 읽히지 않았다.
    return {
      step,
      label: STEP_LABELS[step],
      note: `${CAPABILITY_LABELS[kind]} ${forecast.required}이 표준, ${forecast.required - 2} 이상이면 대가를 치르고 시도 가능(현재 ${forecast.value})`,
      color: STEP_COLORS[step],
      blocked: true,
    };
  }
  const parts = [];
  // 시간 가감은 예고가 실제로 더한 만큼만 적는다 — 흔적 정리처럼 전용 시간표를 쓰는 행동은
  // 층계 가감을 받지 않으므로, 층계표를 그대로 베끼면 버튼이 없는 대가를 말하게 된다.
  const timeDelta = forecast.parts.filter((part) => part.label === '능력').reduce((acc, part) => acc + part.delta, 0);
  if (timeDelta !== 0) parts.push(`시간 ${timeDelta > 0 ? '+' : ''}${timeDelta}칸`);
  // 소음은 **총량**이다. `+`를 붙이면 "지금보다 2 더"로 읽히지만 실제로는 "이 행동이
  // 낼 소음이 2"라는 뜻이다. 층계가 그 값을 바꿨을 때만 기본값과의 차이를 괄호로 덧붙인다.
  const amount = (label, value, baseValue) => {
    const delta = value - baseValue;
    if (delta === 0) return `${label} ${value}`;
    return `${label} ${value}(기본 ${baseValue} ${delta > 0 ? '+' : '−'} ${STEP_LABELS[step]} ${Math.abs(delta)})`;
  };
  if (cost.noise !== 0 || forecast.baseNoise !== 0) parts.push(amount('소음', cost.noise, forecast.baseNoise));
  if (cost.hpCost) parts.push(`HP -${cost.hpCost}`);
  if (cost.durabilityLoss) parts.push(`장비 내구도 -${cost.durabilityLoss}`);
  if (cost.duration != null) parts.push(`지속 ${cost.duration}칸`);
  if (cost.leavesStrongTrace) parts.push('강한 흔적이 남음');
  if (cost.raisesAlert) parts.push(`이 구역 경계 게이지 +${ALERT_PRESSURE.botchedAction}/${ALERT_GAUGE_CAPACITY}`);
  if (extra) parts.push(extra);
  return {
    step,
    label: STEP_LABELS[step],
    note: parts.length ? parts.join(' · ') : '추가 대가 없음',
    color: STEP_COLORS[step],
    blocked: false,
  };
}

/** 층계 다섯 단계가 무엇인지 — 뱃지에 "무리"라고만 쓰여 있으면 그게 좋은 건지 나쁜 건지,
 * 투자하면 뭐가 나아지는지 알 수 없다. 뱃지마다 같은 설명을 달아 둔다. */
export const LADDER_EXPLAINER = html`<div>
  <div style=${{ fontWeight: 800, marginBottom: '5px' }}>Capability 층계</div>
  <div>요구치를 못 넘겨도 시도할 수 있습니다. 대신 모자란 만큼 그 Capability의 통화로 값을 치릅니다.</div>
  <div style=${{ marginTop: '5px' }}>
    여유(+1 이상) 시간 −1칸<br />
    표준(요구치와 같음) 추가 대가 없음<br />
    무리(−1) 시간 +2칸 + 대가 하나<br />
    위태(−2) 시간 +4칸 + 무거운 대가<br />
    불가(−3 이하) 시도 불가
  </div>
  <div style=${{ marginTop: '5px', opacity: 0.85 }}>
    통화는 Capability마다 다릅니다 — Hacking은 구역 경계도, Force는 소음과 장비 내구도, Stealth는 강한 흔적과 경계도, Mobility는 HP, Deception은 효과 지속, Perception은 시간.
  </div>
  <div style=${{ marginTop: '5px', opacity: 0.85 }}>
    전용 시간 규칙을 쓰는 행동(이동·고지대 통과·흔적 정리)은 층계 시간 가감을 중복으로 받지 않고, 0칸짜리 조우 속이기는 시간 대신 성공 기준이 높아집니다.
  </div>
</div>`;

/** @param {{ladder: {step: string, label: string, note: string, color: string}}} props */
export function StepBadge({ ladder }) {
  return html`<${Tooltip} width=${250} content=${LADDER_EXPLAINER}>
    <span style=${{ fontSize: '10px', fontWeight: 800, color: ladder.color, textDecoration: 'underline dotted', textUnderlineOffset: '2px' }}>${ladder.label}${ladder.step === 'standard' ? '' : ` · ${ladder.note}`}</span>
  <//>`;
}
