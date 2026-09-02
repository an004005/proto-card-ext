import { html } from '../lib.js';
import { NOISE_GAUGE_CAPACITY } from '../engine/combatMapIntegration.js';

// 전투 소음 게이지 — CombatHud.dc.html(클로드 디자인) 참고. OverloadGauge.js와 같은 결의 얇은
// 바 컴포넌트. gauge는 0..CAPACITY-1(다음 카드로 다 차면 그 즉시 소음 이벤트 발생 후 0으로
// 리셋), intensity는 이번 전투에서 마지막으로 발생한 소음 강도(1~2~3, 3에서 유지, 아직 한
// 번도 안 났으면 0).
export function NoiseGauge({ gauge, intensity }) {
  const pct = Math.min(100, (gauge / NOISE_GAUGE_CAPACITY) * 100);
  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px', width: '180px' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.75 }}>
        <span>전투 소음</span>
        <span>${gauge}/${NOISE_GAUGE_CAPACITY}${intensity ? ` · 강도 ${intensity}` : ''}</span>
      </div>
      <div style=${{ height: '10px', background: 'var(--color-neutral-300)', border: '1px solid var(--color-divider)', position: 'relative', overflow: 'hidden' }}>
        <div style=${{ height: '100%', width: `${pct}%`, background: 'var(--color-accent-2-600)', transition: 'width 0.15s ease' }}></div>
      </div>
    </div>
  `;
}
