import { html } from '../lib.js';
import { CARD_DEFINITIONS } from '../data/cards.js';

// 뽑을 카드 / 버린 카드 더미를 클릭했을 때 실제 카드 목록을 보여주는 팝업. 같은 카드는
// 묶어서 "이름 ×N"으로 표시한다(더미 안에서 순서는 의미 없음).
export function PileListPopup({ title, cards, onClose }) {
  const counts = new Map();
  for (const c of cards) counts.set(c.defId, (counts.get(c.defId) || 0) + 1);
  const grouped = [...counts.entries()].map(([defId, count]) => ({ defId, name: CARD_DEFINITIONS[defId].name, count }));

  return html`
    <div
      style=${{ position: 'fixed', inset: 0, background: 'color-mix(in srgb, #201e1d 55%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick=${onClose}
    >
      <div
        style=${{ width: '340px', maxHeight: '70vh', background: 'var(--color-bg)', border: '2px solid var(--color-divider)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}
        onClick=${(e) => e.stopPropagation()}
      >
        <div style=${{ padding: 'var(--space-3) var(--space-4)', borderBottom: '2px solid var(--color-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '16px' }}>${title} (${cards.length})</span>
          <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 10px' }} onClick=${onClose}>닫기</button>
        </div>
        <div style=${{ padding: 'var(--space-4)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          ${grouped.length === 0
            ? html`<div style=${{ fontSize: '12px', opacity: 0.6 }}>없음</div>`
            : grouped.map((g) => html`
              <div key=${g.defId} style=${{ fontSize: '12px', padding: '6px 8px', border: '1px solid var(--color-divider)', background: 'var(--color-surface)', display: 'flex', justifyContent: 'space-between' }}>
                <span>${g.name}</span><span>×${g.count}</span>
              </div>
            `)}
        </div>
      </div>
    </div>
  `;
}
