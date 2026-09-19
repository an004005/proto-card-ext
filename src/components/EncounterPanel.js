// 조우 시스템(perception vs stealth) 선택지 패널 — run.encounter가 세워지면 MapScreen이 띄운다.
// 디자인 캔버스 Main.dc.html을 모델로 하되, 실제 토큰(.btn/.tag, --color-*)으로 다시 그렸다.
// 'advantage'/'disadvantage'(행동권 있음) 동안은 다른 맵 액션이 막히지 않으므로, 화면 전체를
// 가리는 모달 배경 없이 떠 있는 카드로만 띄운다(카메라 발각 배너와 같은 위치 규칙).
//
// 자기 좌표를 스스로 잡지 않는다 — MapScreen의 배너 스택이 위치를 정하고 이 카드는 그 안에
// 한 칸으로 쌓인다. 예전에는 파밍 토스트와 이 패널이 각자 같은 좌표에 떠서 서로를 가렸다.
import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { computeThreatPerception, explainEffectiveStealth, describeThreatDecay } from '../engine/runEngine.js';
import { actionTimeCost, forecastAction } from '../engine/actionCosts.js';
import { MONSTER_DEFINITIONS } from '../data/monsters.js';
import { ENCOUNTER_DECEIVE_STEP_PENALTY } from '../data/facilityLayout.js';
import { ladderNote, StepBadge } from './ladderDisplay.js';

const THREAT_MODE_LABELS = { patrol: '순찰', investigate: '조사', alert: '경계', pursuit: '추적', exit_guard: '출구 경계' };

/** ['니빗','니빗'] -> '니빗 ×2' */
function countedNames(names) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(', ');
}

// 회피 칸 수는 다른 유료 행동과 같은 비용 사양표에서 읽는다 — 여기 숫자를 따로 쓰면 예고와
// 청구가 갈라진다.
const EVADE_TICKS = actionTimeCost('evade');

/**
 * 층마다 실제로 그려지는 버튼 목록 — 렌더 분기와 아래 허용 표가 **같은 배열**을 읽는다.
 * 예전에는 표가 손으로 적혀 있어서 동률에 없는 '교전'을 적고 강제 전투에 없는 '회피'를 적었다.
 *
 * `allow`는 허용 표에 적히는 짧은 이름이고, null이면 표에 오르지 않는다 — 동률의 '무시'처럼
 * 잠긴 채로만 그려지는 버튼이 그렇다. 교전은 강제 전투에만 있다(encounterFightCommand는
 * tier가 'forced'가 아니면 스냅샷을 그대로 돌려준다).
 */
const TIER_BUTTONS = {
  advantage: [
    { id: 'ambush', allow: '기습' },
    { id: 'ignore', allow: '무시' },
    { id: 'evade', allow: '회피' },
    { id: 'deceive', allow: '속이기' },
  ],
  even: [
    { id: 'ignore', allow: null },
    { id: 'evade', allow: '회피' },
    { id: 'deceive', allow: '속이기' },
  ],
  disadvantage: [],
  forced: [{ id: 'fight', allow: '교전' }],
};

/**
 * 버튼 목록이 말하지 않는 나머지 — 버튼 없이 되는 것(`extra`)과 막히는 것이다. 판정 자체는
 * facilityReducer.isBlockedByEncounter가 한다 — 'even'과 'forced'만 유료 행동을 통째로 막고,
 * 'advantage'와 'disadvantage'는 막지 않는다(열세는 행동 1회 뒤 다시 판정될 뿐이다). 이 표는
 * 그 규칙을 사람 말로 옮긴 것이므로, 저 함수가 바뀌면 여기도 같이 고친다.
 */
const TIER_ALLOWANCE = {
  advantage: {
    extra: '이동 · 정찰 · 대기 · 파밍 · 장비 사용 — 모든 행동',
    blocked: '없음',
  },
  disadvantage: {
    extra: '유료 행동 1회(이동·정찰·대기·파밍·개방 중 하나) · 무료 조작(인벤토리·카드 확인)',
    blocked: '없음 — 유료 행동이 끝날 때마다 다시 판정되고, 그래도 낮으면 전투만 남는다',
  },
  even: {
    extra: '무료 조작',
    blocked: '이동·정찰·대기·파밍·개방',
  },
  forced: {
    extra: '무료 조작',
    blocked: '회피·속이기를 포함한 그 밖의 모든 행동',
  },
};

/** 그 층의 버튼 이름 + 버튼 없이 되는 것. 표와 버튼이 갈라지지 않도록 여기서만 만든다. */
export function encounterAllowanceText(tier) {
  const entry = TIER_ALLOWANCE[tier];
  if (!entry) return null;
  const names = (TIER_BUTTONS[tier] || []).filter((button) => button.allow).map((button) => button.allow);
  return { allowed: [...names, entry.extra].join(' · '), blocked: entry.blocked };
}

/** 조우 층 설명 밑에 붙는 두 칸짜리 요약 — "그래서 지금 뭘 누를 수 있는가"에 답한다. */
function AllowanceList({ tier }) {
  const entry = encounterAllowanceText(tier);
  if (!entry) return null;
  const labelStyle = {
    fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'var(--color-neutral-600)', marginBottom: '3px',
  };
  return html`
    <div style=${{ marginTop: '12px', borderTop: '1px solid var(--color-divider)', paddingTop: '10px' }}>
      <div style=${labelStyle}>지금 할 수 있는 것</div>
      <div style=${{ display: 'flex', gap: '12px', marginTop: '6px' }}>
        <div style=${{ flex: 1 }}>
          <div style=${{ ...labelStyle, color: 'var(--color-neutral-700)' }}>허용</div>
          <div style=${{ fontSize: '10.5px', lineHeight: 1.45 }}>${entry.allowed}</div>
        </div>
        <div style=${{ width: '1px', background: 'var(--color-divider)' }}></div>
        <div style=${{ flex: 1 }}>
          <div style=${{ ...labelStyle, color: 'var(--color-negative)' }}>막힘</div>
          <div style=${{ fontSize: '10.5px', lineHeight: 1.45, color: 'var(--color-neutral-700)' }}>${entry.blocked}</div>
        </div>
      </div>
    </div>
  `;
}

const TIER_INFO = {
  advantage: { label: '우위', color: 'var(--color-positive)', bg: 'var(--color-positive-100)' },
  even: { label: '동률', color: 'var(--color-warning)', bg: 'var(--color-warning-100)' },
  disadvantage: { label: '열세', color: 'var(--color-accent-2-700)', bg: 'var(--color-accent-2-100)' },
  forced: { label: '열세 지속', color: 'var(--color-negative)', bg: 'var(--color-negative-100)' },
};

/**
 * `내 은신 2 = 기본 1 + 은엄폐 2 − 카메라 1`. 보정이 하나도 없으면 등호 뒤를 생략한다.
 * @param {number} total @param {number} base @param {{label: string, delta: number}[]} parts
 */
export function stealthBreakdownText(total, base, parts) {
  if (!parts || parts.length === 0) return `내 은신 ${total} = 기본 ${base} (상황 보정 없음)`;
  const terms = parts.map((part) => `${part.delta < 0 ? '−' : '+'} ${part.label} ${Math.abs(part.delta)}`).join(' ');
  return `내 은신 ${total} = 기본 ${base} ${terms}`;
}

/**
 * @param {{run: import('../engine/types.js').FacilityRunState, capabilities: Record<string, number>}} props
 */
export function EncounterPanel({ run, capabilities }) {
  const [collapsed, setCollapsed] = useState(false);
  const encounter = run.encounter;
  if (!encounter) return null;
  const threat = run.threats[encounter.threatId];
  if (!threat) return null;

  // 이 두 수치는 조우가 **판정된 그 시각**의 값이다 — 이후 은엄폐가 만료되거나 경계도가 올라도
  // 화면의 숫자가 조용히 바뀌면 플레이어는 무엇을 보고 고른 것인지 알 수 없게 된다(리뷰 B7).
  const live = explainEffectiveStealth(capabilities.stealth, run);
  const stealth = encounter.stealthAtJudgement ?? live.total;
  const stealthBase = encounter.stealthBaseAtJudgement ?? live.base;
  const stealthParts = encounter.stealthPartsAtJudgement ?? live.parts;
  const perception = encounter.perceptionAtJudgement ?? computeThreatPerception(threat);
  const decay = describeThreatDecay(run, threat);
  // 조우 속이기(D) — 회피 대신 고르는 0칸짜리 선택지. 위협당 한 번뿐이고, 성공 여부는
  // 지금 이 자리에서 이미 정해져 있다(Deception >= 그 위협의 경계). 그 예고를 그대로 적는다.
  //
  // 요구치 2는 이분 게이트가 아니라 층계다(D8) — 모자란 채로도 시도할 수 있고, 대신 0칸짜리
  // 행동이라 시간 대신 판정 자체가 불리해진다(ENCOUNTER_DECEIVE_STEP_PENALTY).
  const deception = capabilities.deception ?? 0;
  const deceiveUsed = (run.deceivedThreatIds || []).includes(threat.id);
  const deceiveForecast = forecastAction('encounterDeceive', { value: deception });
  const penalty = ENCOUNTER_DECEIVE_STEP_PENALTY[deceiveForecast.step] || { successPenalty: 0, raisesThreatAlert: false };
  const penaltyText = deceiveForecast.blocked ? '' : [
    penalty.successPenalty ? `성공 기준 +${penalty.successPenalty}` : '',
    penalty.raisesThreatAlert ? '시도 자체로 이 위협의 경계 +1' : '',
  ].filter(Boolean).join(' · ');
  const deceiveLadder = ladderNote(deceiveForecast, penaltyText);
  const canDeceive = !deceiveForecast.blocked && !deceiveUsed;
  // 성공 기준은 그 위협의 경계에 층계 벌점을 더한 값이다 — 엔진의 deceiveThreat와 같은 식.
  const deceiveBar = threat.alert + penalty.successPenalty;
  const deceiveWouldWork = deception >= deceiveBar;
  const deceiveTip = deceiveUsed
    ? '이 위협은 이미 한 번 속였습니다 — 같은 수는 두 번 통하지 않습니다.'
    : deceiveForecast.blocked
      ? `${deceiveLadder?.note ?? ''}.`
      : `${deceiveWouldWork
        ? `성공합니다 — Deception ${deception} ≥ 성공 기준 ${deceiveBar}. 추적은 유지되지만 목표가 옆 노드로 옮겨갑니다.`
        : `실패합니다 — Deception ${deception} < 성공 기준 ${deceiveBar}. 속이려다 들켜 열세로 내려갑니다.`}${
        penaltyText ? ` 층계 ${deceiveLadder?.label} — ${penaltyText}(성공 기준은 이 위협의 경계 ${threat.alert}에 벌점을 더한 값입니다).` : ''}`;
  // 층마다 마크업을 따로 두면 한쪽만 고쳐지고 두 층이 서로 다른 예고를 적게 된다 — 버튼
  // 하나에 렌더러 하나다. TIER_BUTTONS가 어느 층에 무엇이 뜨는지를 정한다.
  //
  // 예고 문장은 버튼 아래 줄로 **보이게** 적는다. 같은 문장을 title로 한 번 더 걸면 화면에
  // 보이는 글과 브라우저 툴팁이 겹쳐 뜬다.
  const BUTTON_RENDERERS = {
    ambush: () => html`<button class="btn btn-danger" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_AMBUSH' })}>기습 — 적 전원 스턴 부여 (0칸)</button>`,
    ignore: () => (encounter.tier === 'advantage'
      ? html`<button class="btn btn-secondary" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_IGNORE' })}>무시 — 이 자리에서 다른 행동 (0칸)</button>`
      : html`
        <button class="btn btn-secondary" disabled style=${{ width: '100%' }}>무시 — 사용 불가</button>
        <div style=${{ fontSize: '10px', color: 'var(--color-neutral-600)', marginTop: '-4px' }}>동률 상태에서는 무시할 수 없습니다. 회피는 ${EVADE_TICKS}칸이 들고, 같은 위협은 다음 유료 행동이 끝날 때 다시 판정합니다.</div>
      `),
    evade: () => html`<button class="btn btn-secondary" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_EVADE' })}>회피 — 추적 해제 (${EVADE_TICKS}칸)</button>`,
    deceive: () => html`
      <button class="btn btn-secondary" style=${{ width: '100%' }} disabled=${!canDeceive}
        onClick=${() => dispatch({ type: 'ENCOUNTER_DECEIVE' })}>
        속이기 — 추적 목표를 옆으로 (0칸${canDeceive ? (deceiveWouldWork ? ' · 성공 예고' : ' · 실패 예고') : ''})${canDeceive && deceiveLadder && deceiveLadder.step !== 'standard' ? html` <${StepBadge} ladder=${deceiveLadder} />` : null}
      </button>
      <div style=${{ fontSize: '10px', color: 'var(--color-neutral-600)', marginTop: '-2px' }}>${deceiveTip}</div>
    `,
    fight: () => html`
      <button class="btn btn-danger" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_FIGHT' })}>전투</button>
      <div style=${{ fontSize: '11px', color: 'var(--color-negative)', textAlign: 'center', fontWeight: 700 }}>기습당함 — 적이 먼저 행동합니다.</div>
    `,
  };
  const tierButtons = TIER_BUTTONS[encounter.tier] || [];
  const opSymbol = stealth > perception ? '>' : stealth === perception ? '=' : '<';
  const info = TIER_INFO[encounter.tier];
  // 열세는 버튼이 하나도 없는 안내문이라 지도를 계속 가린다 — 읽은 뒤에는 접을 수 있어야 한다.
  const collapsible = encounter.tier === 'disadvantage';

  return html`
    <div style=${{
      width: '340px', background: 'var(--color-bg)', border: '1px solid var(--color-divider)', boxShadow: 'var(--shadow-lg)', padding: 'var(--space-4)',
    }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
        <div>
          <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '2px' }}>조우</div>
          <h4 style=${{ margin: 0, fontSize: '17px' }}>위협과 마주쳤다</h4>
          ${/* 눈앞에 선 것이 무엇인지 — 이 거리에서는 구성까지 보인다(리뷰 B8). */ null}
          <div style=${{ fontSize: '11px', marginTop: '3px', color: 'var(--color-neutral-700)' }}>
            위협: ${countedNames((threat.monsterIds || []).map((id) => MONSTER_DEFINITIONS[id]?.name || id)) || '미상'} · 규모 ${threat.size} · ${THREAT_MODE_LABELS[threat.mode] || threat.mode}${decay ? ` · ${decay.ticksLeft}칸 뒤 ${THREAT_MODE_LABELS[decay.nextMode]}로` : ''}
          </div>
        </div>
        <div style=${{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span class="tag" style=${{ background: info.bg, color: info.color }}>${info.label}</span>
          ${collapsible ? html`<button class="btn btn-secondary" style=${{ fontSize: '10px', padding: '2px 7px' }} onClick=${() => setCollapsed((v) => !v)}>${collapsed ? '펼치기' : '접기'}</button>` : null}
        </div>
      </div>
      ${collapsed ? null : html`<div>

      <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', background: 'var(--color-neutral-100)', border: '1px solid var(--color-divider)', padding: '12px', marginBottom: '16px' }}>
        <div style=${{ textAlign: 'center' }}>
          <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>내 은신</div>
          <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '24px', color: 'var(--color-accent-2-700)' }}>${stealth}</div>
        </div>
        <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '20px', color: 'var(--color-neutral-500)' }}>${opSymbol}</div>
        <div style=${{ textAlign: 'center' }}>
          <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>적 지각</div>
          <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '24px', color: 'var(--color-negative)' }}>${perception}</div>
        </div>
      </div>

      ${/* ADR-0079: 합계만 보여주면 무엇을 바꿔야 판정이 뒤집히는지 알 수 없다 — 분해해 적는다. */ null}
      <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginTop: '-10px', marginBottom: '14px', textAlign: 'center' }}>
        ${stealthBreakdownText(stealth, stealthBase, stealthParts)}
      </div>

      ${tierButtons.length ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          ${tierButtons.map((button) => BUTTON_RENDERERS[button.id]())}
        </div>
      ` : null}

      ${encounter.tier === 'disadvantage' ? html`
        <div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', textAlign: 'center' }}>
          지금은 유효한 유료 행동 1회만 허용됩니다 — 정찰 등 시간이 드는 행동을 하면 다시 판정합니다(인벤토리 정렬 같은 무료 조작은 이 기회를 쓰지 않습니다). 그래도 낮으면 전투만 가능해집니다.
        </div>
      ` : null}

      <${AllowanceList} tier=${encounter.tier} />
      </div>`}
    </div>
  `;
}
