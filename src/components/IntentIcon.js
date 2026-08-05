import { html } from '../lib.js';

function describeIntent(move) {
  if (!move) return { isAttack: false, label: '' };
  if (move.damage) {
    const total = move.damage * (move.hits || 1);
    return { isAttack: true, label: String(total) };
  }
  const effects = move.effects || [];
  if (effects.some((e) => e.kind === 'block')) return { isAttack: false, label: '방어' };
  if (effects.some((e) => e.kind === 'applyStatus' && (e.status === 'weak' || e.status === 'vulnerable'))) {
    return { isAttack: false, label: '디버프' };
  }
  if (effects.some((e) => e.kind === 'applyStatus')) return { isAttack: false, label: '버프' };
  if (move.flee) return { isAttack: false, label: '도주' };
  if (move.insertCurse) return { isAttack: false, label: '오염' };
  return { isAttack: false, label: '' };
}

export function IntentIcon({ intent }) {
  const { isAttack, label } = describeIntent(intent);
  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style=${{
        width: 0, height: 0, borderLeft: '11px solid transparent', borderRight: '11px solid transparent',
        borderBottom: `${isAttack ? '18px' : '14px'} solid ${isAttack ? 'var(--color-accent)' : 'var(--color-neutral-700)'}`,
        transform: isAttack ? 'none' : 'rotate(180deg)',
      }}></div>
      <span style=${{ fontSize: '11px', fontWeight: 800, marginTop: '2px' }}>${label}</span>
    </div>
  `;
}
