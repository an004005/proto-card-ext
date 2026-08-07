import { html } from '../lib.js';

// 뽑을 카드 더미(손패 왼쪽 끝)와 버린 카드 더미(오른쪽 끝)로 분리 배치 — 소진 카드 수는
// 버린 카드 박스에 보조 표시로 곁들인다(별도 팝업 없이).
export function DrawPileBox({ count }) {
  return html`
    <div style=${{ width: '90px', flexShrink: 0, border: '2px solid var(--color-divider)', background: 'var(--color-surface)', padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.04em', opacity: 0.7 }}>뽑을 카드</div>
      <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '20px' }}>${count}</div>
    </div>
  `;
}

export function DiscardPileBox({ count, exhaustCount }) {
  return html`
    <div style=${{ width: '90px', flexShrink: 0, border: '2px solid var(--color-divider)', background: 'var(--color-surface)', padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.04em', opacity: 0.7 }}>버린 카드</div>
      <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '20px' }}>${count}</div>
      <div style=${{ fontSize: '9px', opacity: 0.5 }}>소진 ${exhaustCount}</div>
    </div>
  `;
}
