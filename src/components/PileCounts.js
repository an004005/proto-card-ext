import { html } from '../lib.js';

export function PileCounts({ counts }) {
  return html`
    <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', borderTop: '1px solid var(--color-divider)', paddingTop: '8px' }}>
      <span>뽑기 ${counts.draw}</span><span>버림 ${counts.discard}</span><span>소진 ${counts.exhaust}</span>
    </div>
  `;
}
