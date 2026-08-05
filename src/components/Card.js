import { html } from '../lib.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { getEffectiveCost } from '../engine/combatEngine.js';
import { Tooltip } from './Tooltip.js';

export const TYPE_INFO = {
  attack: { color: 'var(--color-accent)', label: 'ATTACK', cls: 'tag-accent' },
  skill: { color: 'var(--color-neutral-700)', label: 'SKILL', cls: 'tag-neutral' },
  power: { color: 'var(--color-accent-2-700)', label: 'POWER', cls: 'tag-accent-2' },
  curse: { color: 'var(--color-neutral-500)', label: 'CURSE', cls: 'tag-neutral' },
};

function CardDetailTooltip({ def, cost, type }) {
  return html`
    <div>
      <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px', marginBottom: '4px' }}>${def.name}</div>
      <div style=${{ opacity: 0.75, marginBottom: '6px' }}>
        ${type.label} · 코스트 ${cost}${def.ammoCost ? ` · 총알 ${def.ammoCost}` : ''}
      </div>
      <div>${def.description}</div>
      <div style=${{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px', opacity: 0.7 }}>
        ${def.overloadGain ? html`<div>과부화 +${def.overloadGain}</div>` : null}
        ${def.exhausts ? html`<div>사용 후 소진</div>` : null}
        ${def.unplayable ? html`<div>과적(짐) 상태일 때만 사용 가능</div>` : null}
        ${def.scalesWithStage ? html`<div>과부화 단계에 따라 수치 변동 (1·2단계 +25%)</div>` : null}
      </div>
    </div>
  `;
}

export function Card({
  card, playable = true, armed = false, width = 140, onClick,
  draggable = false, onDragStart, onDragEnd, stage = 0, powers = {},
}) {
  const def = CARD_DEFINITIONS[card.defId];
  const type = TYPE_INFO[def.type] || TYPE_INFO.skill;
  const classNames = ['hand-card', !playable && 'hand-card-disabled', armed && 'hand-card-armed']
    .filter(Boolean).join(' ');
  const isDraggable = draggable && playable;
  const cost = getEffectiveCost(def, stage, powers);

  return html`
    <${Tooltip} width=${200} content=${html`<${CardDetailTooltip} def=${def} cost=${cost} type=${type} />`}>
      <div
        class=${classNames}
        style=${{
          width: `${width}px`, minHeight: '190px', background: 'var(--color-surface)',
          border: `2px solid ${type.color}`, padding: 'var(--space-2)',
          display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative',
          cursor: isDraggable ? 'grab' : undefined,
        }}
        draggable=${isDraggable}
        onClick=${playable ? onClick : undefined}
        onDragStart=${isDraggable ? (e) => {
          e.dataTransfer.setData('text/plain', card.instanceId);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart && onDragStart(card);
        } : undefined}
        onDragEnd=${isDraggable ? () => onDragEnd && onDragEnd() : undefined}
      >
        <span style=${{
          position: 'absolute', top: '-2px', left: '-2px', width: '26px', height: '26px',
          background: type.color, color: 'var(--color-bg)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '14px',
        }}>${cost}</span>
        ${def.ammoCost ? html`
          <span style=${{ position: 'absolute', top: '-2px', right: '-2px', fontSize: '10px', background: 'var(--color-neutral-800)', color: 'var(--color-bg)', padding: '2px 5px', fontWeight: 700 }}>
            탄 ${def.ammoCost}
          </span>
        ` : null}
        <div style=${{ marginTop: '20px', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px' }}>${def.name}</div>
        <span class=${`tag ${type.cls}`} style=${{ alignSelf: 'flex-start' }}>${type.label}</span>
        <p style=${{ fontSize: '11px', margin: 0, flex: 1, opacity: 0.85 }}>${def.description}</p>
      </div>
    <//>
  `;
}
