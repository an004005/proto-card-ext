import { html } from '../lib.js';
import { Tooltip } from './Tooltip.js';

// 얇은 압력 바 — CombatHud.dc.html(클로드 디자인)의 소음 게이지 모양이다. 전투 소음과 구역
// 경계 게이지가 같은 그림을 쓴다: 둘 다 "쌓이다 정원에서 한 번 터지고 0으로 돌아간다"는
// 같은 규칙이라, 화면이 달라도 읽는 법이 같아야 한다.
export function ThinGauge({ label, value, max, valueText, tip, tipWidth = 240, width = '180px', color = 'var(--color-accent-2-600)' }) {
  const pct = Math.min(100, (value / max) * 100);
  return html`
    <${Tooltip} width=${tipWidth} content=${tip}>
    <div tabIndex="0" style=${{ display: 'flex', flexDirection: 'column', gap: '4px', width }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.75 }}>
        <span style=${{ textDecoration: 'underline dotted', textUnderlineOffset: '2px' }}>${label}</span>
        <span>${valueText ?? `${value}/${max}`}</span>
      </div>
      <div style=${{ height: '10px', background: 'var(--color-neutral-300)', border: '1px solid var(--color-divider)', position: 'relative', overflow: 'hidden' }}>
        <div style=${{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.15s ease' }}></div>
      </div>
    </div>
    <//>
  `;
}
