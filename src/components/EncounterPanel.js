// 조우 시스템(perception vs stealth) 선택지 패널 — run.encounter가 세워지면 MapScreen이 띄운다.
// 디자인 캔버스 Main.dc.html을 모델로 하되, 실제 토큰(.btn/.tag, --color-*)으로 다시 그렸다.
// 'advantage'/'disadvantage'(행동권 있음) 동안은 다른 맵 액션이 막히지 않으므로, 화면 전체를
// 가리는 모달 배경 없이 떠 있는 카드로만 띄운다(카메라 발각 배너와 같은 위치 규칙).
import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { computeThreatPerception, effectiveStealthWithConcealment } from '../engine/runEngine.js';

const TIER_INFO = {
  advantage: { label: '우위', color: '#15803d', bg: '#f0fdf4' },
  even: { label: '동률', color: '#b45309', bg: '#fffbeb' },
  disadvantage: { label: '열세', color: 'var(--color-accent-2-700)', bg: 'var(--color-accent-2-100)' },
  forced: { label: '열세 지속', color: 'var(--color-negative, #dc2626)', bg: '#fef2f2' },
};

/**
 * @param {{run: import('../engine/types.js').FacilityRunState, capabilities: Record<string, number>}} props
 */
export function EncounterPanel({ run, capabilities }) {
  const encounter = run.encounter;
  if (!encounter) return null;
  const threat = run.threats[encounter.threatId];
  if (!threat) return null;

  const stealth = effectiveStealthWithConcealment(capabilities.stealth, run);
  const perception = computeThreatPerception(threat);
  const opSymbol = stealth > perception ? '>' : stealth === perception ? '=' : '<';
  const info = TIER_INFO[encounter.tier];

  return html`
    <div style=${{
      position: 'fixed', top: '72px', left: '50%', transform: 'translateX(-50%)', zIndex: 30,
      width: '340px', background: 'var(--color-bg)', border: '1px solid var(--color-divider)', boxShadow: 'var(--shadow-lg)', padding: 'var(--space-4)',
    }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
        <div>
          <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '2px' }}>조우</div>
          <h4 style=${{ margin: 0, fontSize: '17px' }}>위협과 마주쳤다</h4>
        </div>
        <span class="tag" style=${{ background: info.bg, color: info.color }}>${info.label}</span>
      </div>

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

      ${encounter.tier === 'advantage' ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button class="btn btn-danger" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_AMBUSH' })}>기습 — 적 전원 스턴 부여</button>
          <button class="btn btn-secondary" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_IGNORE' })}>무시 — 이 자리에서 다른 행동</button>
          <button class="btn btn-secondary" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_EVADE' })}>회피 — 다른 노드로 이동 (확정 성공)</button>
        </div>
      ` : null}

      ${encounter.tier === 'even' ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button class="btn btn-secondary" disabled style=${{ width: '100%' }}>무시 — 사용 불가</button>
          <div style=${{ fontSize: '10px', color: 'var(--color-neutral-600)', marginTop: '-4px' }}>동률 상태에서는 무시할 수 없습니다.</div>
          <button class="btn btn-secondary" style=${{ width: '100%', marginTop: '4px' }} onClick=${() => dispatch({ type: 'ENCOUNTER_EVADE' })}>회피 — 다른 노드로 이동 (확정 성공)</button>
        </div>
      ` : null}

      ${encounter.tier === 'disadvantage' ? html`
        <div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', textAlign: 'center' }}>
          지금은 행동 1회만 허용됩니다 — 정찰 등 다른 맵 행동을 하면 다시 판정합니다. 그래도 낮으면 전투만 가능해집니다.
        </div>
      ` : null}

      ${encounter.tier === 'forced' ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button class="btn btn-danger" style=${{ width: '100%' }} onClick=${() => dispatch({ type: 'ENCOUNTER_FIGHT' })}>전투</button>
          <div style=${{ fontSize: '11px', color: 'var(--color-negative, #dc2626)', textAlign: 'center', fontWeight: 700 }}>기습당함 — 적이 먼저 행동합니다.</div>
        </div>
      ` : null}
    </div>
  `;
}
