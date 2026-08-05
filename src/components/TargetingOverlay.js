import { html } from '../lib.js';

export function TargetingOverlay({ active }) {
  if (!active) return null;
  return html`
    <div style=${{ textAlign: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--color-accent)' }}>
      카드를 대상(적) 위로 드래그하세요
    </div>
  `;
}
