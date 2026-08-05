import { html } from '../lib.js';
import { Tooltip } from './Tooltip.js';
import { EquipmentTooltipContent } from './EquipmentTooltipContent.js';

export function EquipSlotsPanel({ allEquipSlots }) {
  return html`
    <div style=${{ width: '260px', border: '2px solid var(--color-divider)', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--color-surface)', flexShrink: 0 }}>
      <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px' }}>장비 슬롯</div>
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        ${allEquipSlots.map((sl) => {
          const cell = html`
            <div style=${{
              border: sl.filled ? '2px solid var(--color-divider)' : '2px dashed var(--color-neutral-400)',
              padding: '6px', minHeight: '52px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px',
              background: sl.filled ? 'var(--color-bg)' : 'transparent',
            }}>
              <span style=${{ fontSize: '9px', opacity: 0.6, textTransform: 'uppercase' }}>${sl.category}</span>
              ${sl.filled ? html`
                <span style=${{ fontSize: '11px', fontWeight: 700 }}>${sl.name}</span>
                ${sl.cardCount !== undefined ? html`<span class="tag tag-outline" style=${{ fontSize: '9px', alignSelf: 'flex-start' }}>+${sl.cardCount}장</span>` : null}
              ` : html`<span style=${{ fontSize: '16px', opacity: 0.35 }}>+</span>`}
            </div>
          `;
          if (sl.cardList) return html`<${Tooltip} key=${sl.key} width=${260} content=${html`<${EquipmentTooltipContent} name=${sl.name} cardList=${sl.cardList} />`}>${cell}<//>`;
          if (sl.description) return html`<${Tooltip} key=${sl.key} width=${220} content=${sl.description}>${cell}<//>`;
          return html`<div key=${sl.key}>${cell}</div>`;
        })}
      </div>
    </div>
  `;
}
