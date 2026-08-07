import { html } from '../lib.js';
import { Tooltip } from './Tooltip.js';
import { EquipmentTooltipContent } from './EquipmentTooltipContent.js';

// manage=true(맵 중 인벤토리 팝업)일 때만 드래그앤드롭 활성화: 장착된 슬롯을 드래그해서 시작할
// 수 있고(짐으로 되돌리는 건 DeckInventoryView의 인벤토리 영역이 드롭 대상), 인벤토리 아이템
// 카드를 슬롯 위에 놓으면 장착된다(이미 찬 슬롯이면 gameReducer의 equipItem이 자동 스왑).
export function EquipSlotsPanel({ allEquipSlots, manage = false, onDragEquipped = null, onDropOnSlot = null }) {
  return html`
    <div style=${{ width: '260px', border: '2px solid var(--color-divider)', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--color-surface)', flexShrink: 0 }}>
      <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px' }}>장비 슬롯</div>
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        ${allEquipSlots.map((sl) => {
          const cell = html`
            <div
              draggable=${manage && sl.filled}
              onDragStart=${manage && sl.filled ? () => onDragEquipped(sl.equipmentId) : undefined}
              onDragOver=${manage ? (e) => e.preventDefault() : undefined}
              onDrop=${manage ? (e) => { e.preventDefault(); onDropOnSlot(); } : undefined}
              style=${{
                border: sl.filled ? '2px solid var(--color-divider)' : '2px dashed var(--color-neutral-400)',
                padding: '6px', minHeight: '52px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px',
                background: sl.filled ? 'var(--color-bg)' : 'transparent',
                cursor: manage && sl.filled ? 'grab' : 'default',
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
