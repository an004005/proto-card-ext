import { html } from '../lib.js';
import { getStage } from '../engine/overloadEngine.js';

const STAGE_INFO = [
  { label: '노멀', color: 'var(--color-neutral-500)' },
  { label: '최적', color: 'var(--color-accent-2-600)' },
  { label: '과열', color: 'var(--color-accent-600)' },
  { label: '멜트다운', color: 'var(--color-accent-800)' },
];

export function OverloadGauge({ overload, floor, compact = false }) {
  const clamped = Math.min(100, overload);
  const stage = getStage(overload);
  const info = STAGE_INFO[Math.min(stage, 3)];
  const height = compact ? '10px' : '16px';

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      ${!compact ? html`
        <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7 }}>
          <span>과부화</span><span>${info.label} (${stage}단계)</span>
        </div>
      ` : null}
      <div style=${{ height, background: 'var(--color-neutral-300)', border: '1px solid var(--color-divider)', position: 'relative', overflow: 'hidden' }}>
        <div style=${{ position: 'absolute', left: `${floor}%`, top: 0, bottom: 0, width: '2px', background: 'var(--color-text)', opacity: 0.4 }} title="장착 바닥"></div>
        <div style=${{ height: '100%', width: `${clamped}%`, background: info.color, transition: 'width 0.15s ease' }}></div>
        ${!compact ? html`
          <span style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>
            ${overload}/100
          </span>
        ` : null}
      </div>
    </div>
  `;
}
