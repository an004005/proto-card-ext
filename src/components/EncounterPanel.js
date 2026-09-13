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

const TIER_INFO = {
  advantage: { label: '우위', color: '#15803d', bg: '#f0fdf4' },
  even: { label: '동률', color: '#b45309', bg: '#fffbeb' },
  disadvantage: { label: '열세', color: 'var(--color-accent-2-700)', bg: 'var(--color-accent-2-100)' },
  forced: { label: '열세 지속', color: 'var(--color-negative, #dc2626)', bg: '#fef2f2' },
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
  // 우위와 동률이 같은 버튼을 내놓는다 — 마크업을 두 벌 두면 한쪽만 고쳐지고 두 층이 서로
  // 다른 예고를 적게 된다.
  const deceiveOption = () => html`
    <button class="btn btn-secondary" style=${{ width: '100%' }} disabled=${!canDeceive}
      title=${deceiveTip}
      onClick=${() => dispatch({ type: 'ENCOUNTER_DECEIVE' })}>
      속이기 — 추적 목표를 옆으로 (0칸${canDeceive ? (deceiveWouldWork ? ' · 성공 예고' : ' · 실패 예고') : ''})${canDeceive && deceiveLadder && deceiveLadder.step !== 'standard' ? html` <${StepBadge} ladder=${deceiveLadder} />` : null}
    </button>
    <div style=${{ fontSize: '10px', color: 'var(--color-neutral-600)', marginTop: '-2px' }}>${deceiveTip}</div>
  `;
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
          <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '24px', color: 'var(--color-negative, #dc2626)' }}>${perception}</div>
        </div>
      </div>

      ${/* ADR-0079: 합계만 보여주면 무엇을 바꿔야 판정이 뒤집히는지 알 수 없다 — 분해해 적는다. */ null}
      <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginTop: '-10px', marginBottom: '14px', textAlign: 'center' }}>
        ${stealthBreakdownText(stealth, stealthBase, stealthParts)}
      </div>

      ${encounter.tier === 'advantage' ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button class="btn btn-danger" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_AMBUSH' })}>기습 — 적 전원 스턴 부여 (0칸)</button>
          <button class="btn btn-secondary" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_IGNORE' })}>무시 — 이 자리에서 다른 행동 (0칸)</button>
          <button class="btn btn-secondary" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_EVADE' })}>회피 — 추적 해제 (${EVADE_TICKS}칸)</button>
          ${deceiveOption()}
        </div>
      ` : null}

      ${encounter.tier === 'even' ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button class="btn btn-secondary" disabled style=${{ width: '100%' }}>무시 — 사용 불가</button>
          <div style=${{ fontSize: '10px', color: 'var(--color-neutral-600)', marginTop: '-4px' }}>동률 상태에서는 무시할 수 없습니다. 회피는 ${EVADE_TICKS}칸이 들고, 같은 위협은 다음 유료 행동이 끝날 때 다시 판정합니다.</div>
          <button class="btn btn-secondary" style=${{ width: '100%', marginTop: '4px' }} onClick=${() => dispatch({ type: 'ENCOUNTER_EVADE' })}>회피 — 추적 해제 (${EVADE_TICKS}칸)</button>
          ${deceiveOption()}
        </div>
      ` : null}

      ${encounter.tier === 'disadvantage' ? html`
        <div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', textAlign: 'center' }}>
          지금은 유효한 유료 행동 1회만 허용됩니다 — 정찰 등 시간이 드는 행동을 하면 다시 판정합니다(인벤토리 정렬 같은 무료 조작은 이 기회를 쓰지 않습니다). 그래도 낮으면 전투만 가능해집니다.
        </div>
      ` : null}

      ${encounter.tier === 'forced' ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button class="btn btn-danger" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_FIGHT' })}>전투</button>
          <div style=${{ fontSize: '11px', color: 'var(--color-negative, #dc2626)', textAlign: 'center', fontWeight: 700 }}>기습당함 — 적이 먼저 행동합니다.</div>
        </div>
      ` : null}
      </div>`}
    </div>
  `;
}
