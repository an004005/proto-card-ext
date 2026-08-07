import { html } from '../lib.js';

export function AmmoGauge({ ammo, maxAmmo, compact = false }) {
  const max = Math.max(maxAmmo, 1);
  const pct = Math.max(0, Math.min(100, Math.round((ammo / max) * 100)));
  const height = compact ? '10px' : '16px';

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      ${!compact ? html`
        <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7 }}>
          <span>탄약</span><span>${ammo}/${maxAmmo}</span>
        </div>
      ` : null}
      <div style=${{ height, background: 'var(--color-neutral-300)', border: '1px solid var(--color-divider)', position: 'relative', overflow: 'hidden' }}>
        <div style=${{ height: '100%', width: `${pct}%`, background: 'var(--color-accent-2-600)', transition: 'width 0.15s ease' }}></div>
      </div>
    </div>
  `;
}
