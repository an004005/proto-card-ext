import { html } from '../lib.js';
import { getStage } from '../engine/overloadEngine.js';
import { OVERLOAD_STAGE_LABELS } from '../data/statusEffects.js';

// 색만 여기서 정한다 — 이름은 카드 툴팁과 같은 한 벌(statusEffects.OVERLOAD_STAGE_LABELS)을 쓴다. 같은 단계를
// 화면마다 다르게 부르면 플레이어는 그것이 같은 것인 줄 모른다(리뷰 B7).
const STAGE_COLORS = ['var(--color-neutral-500)', 'var(--color-accent-2-600)', 'var(--color-accent-800)'];

export function OverloadGauge({ overload, floor, compact = false }) {
  const clamped = Math.min(100, overload);
  const stage = getStage(overload);
  const color = STAGE_COLORS[stage];
  const height = compact ? '10px' : '16px';

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: compact ? '9px' : '10px', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.85 }}>
        <span>과부화</span><span>${overload}/100</span>
      </div>
      ${!compact ? html`
        <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7 }}>
          <span>과부화</span>
          <span>${OVERLOAD_STAGE_LABELS[stage]}${overload > 100 ? ` — 100 초과, 상태이상 카드 ${Math.ceil((overload - 100) / 10)}장(이번 전투만)` : ''}</span>
        </div>
      ` : null}
      <div style=${{ height, background: 'var(--color-neutral-300)', border: '1px solid var(--color-divider)', position: 'relative', overflow: 'hidden' }}>
        <div style=${{ position: 'absolute', left: `${floor}%`, top: 0, bottom: 0, width: '2px', background: 'var(--color-text)', opacity: 0.4 }} aria-label=${`장착 과부화 바닥 ${floor}`}></div>
        <div style=${{ height: '100%', width: `${clamped}%`, background: color, transition: 'width 0.15s ease' }}></div>
        ${!compact ? html`
          <span style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>
            ${overload}/100
          </span>
        ` : null}
      </div>
    </div>
  `;
}
