import { html, useState } from '../lib.js';
import { IntentIcon } from './IntentIcon.js';
import { useDamagePopups, DamagePopupLayer } from './DamagePopup.js';
import { StatusTag } from './StatusTag.js';

export function EnemyRow({ enemy, targetable = false, onDrop, playerVulnerable = false, animation = null }) {
  const [hovering, setHovering] = useState(false);
  const dead = enemy.hp <= 0;
  const hpPct = dead ? 0 : Math.max(0, Math.round((enemy.hp / enemy.maxHp) * 100));
  const statusEntries = Object.entries(enemy.statuses).filter(([, v]) => v);
  const popups = useDamagePopups(enemy.hp);
  const canDrop = targetable && !dead;

  return html`
    <div
      style=${{
        width: '220px',
        border: `2px solid ${hovering ? 'var(--color-accent-600)' : canDrop ? 'var(--color-accent)' : 'var(--color-divider)'}`,
        padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '8px',
        background: 'var(--color-surface)', opacity: dead ? 0.4 : 1, position: 'relative',
      }}
      class=${animation?.kind === 'attack' ? 'combatant-attack' : undefined}
      onDragOver=${canDrop ? (e) => e.preventDefault() : undefined}
      onDragEnter=${canDrop ? (e) => { e.preventDefault(); setHovering(true); } : undefined}
      onDragLeave=${canDrop ? () => setHovering(false) : undefined}
      onDrop=${canDrop ? (e) => { e.preventDefault(); e.stopPropagation(); setHovering(false); onDrop(enemy); } : undefined}
    >
      ${animation ? html`<div class="action-cue">${animation.label}</div>` : null}
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style=${{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '14px' }}>${enemy.name}</span>
          ${enemy.isMachine ? html`<span class="tag tag-outline" style=${{ fontSize: '9px', padding: '1px 5px' }}>기계</span>` : null}
        </span>
        ${!dead && enemy.intent ? html`<${IntentIcon} intent=${enemy.intent} enemyStatuses=${enemy.statuses} playerVulnerable=${playerVulnerable} />` : null}
      </div>
      <div style=${{ height: '14px', background: 'var(--color-neutral-300)', border: '1px solid var(--color-divider)', position: 'relative' }}>
        <div style=${{ height: '100%', background: 'var(--color-accent-600)', width: `${hpPct}%` }}></div>
        <span style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>
          ${enemy.hp}/${enemy.maxHp}
        </span>
        <${DamagePopupLayer} popups=${popups} />
      </div>
      <div style=${{ display: 'flex', gap: '6px', flexWrap: 'wrap', minHeight: '18px' }}>
        ${enemy.block > 0 ? html`<span class="tag tag-neutral">방어 ${enemy.block}</span>` : null}
        ${statusEntries.map(([key, value]) => html`<${StatusTag} key=${key} statusKey=${key} value=${value} />`)}
      </div>
    </div>
  `;
}
