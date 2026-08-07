import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { buildDeckFromLoadout, computeFloorOverload, computeInventoryCapacityBonus } from '../engine/equipmentEngine.js';
import { buildAllEquipSlots, buildDeckGroups } from '../data/loadoutDisplay.js';
import { getEffectiveCost } from '../engine/combatEngine.js';
import { getStage } from '../engine/overloadEngine.js';
import { BASE_INVENTORY_CAPACITY } from '../engine/gameReducer.js';
import { getBurdenItems } from '../engine/inventoryEngine.js';
import { describeItem } from '../data/itemDisplay.js';
import { EquipSlotsPanel } from './EquipSlotsPanel.js';
import { Tooltip } from './Tooltip.js';
import { CardDetailTooltip, TYPE_INFO } from './Card.js';

// "창고 — 출격 준비"의 인벤토리 탭과 동일한 뷰 — 장비 슬롯 + 장착으로 구성된 덱을 카드 그리드로
// 보여준다. `inventory`가 주어지면(맵/전투 팝업) 실제 소지품(잡템/환금템/탄약/미장착 장비) 그리드도
// 함께 렌더링한다. `manage=true`(맵 중 인벤토리 팝업)면 드래그앤드롭 장착/해제 + 버리기가 켜진다.
export function DeckInventoryView({ loadout, inventory = null, manage = false }) {
  const [dragPayload, setDragPayload] = useState(null);
  const deckSize = buildDeckFromLoadout(loadout).length;
  const floor = computeFloorOverload(loadout);
  const capacity = BASE_INVENTORY_CAPACITY + computeInventoryCapacityBonus(loadout);
  const deckGroups = buildDeckGroups(loadout);
  const allEquipSlots = buildAllEquipSlots(loadout);
  const burdenIds = inventory ? new Set(getBurdenItems(inventory).map((i) => i.id)) : new Set();

  function handleDropOnSlot() {
    if (!dragPayload) return;
    if (dragPayload.type === 'inventoryItem') dispatch({ type: 'EQUIP_ITEM', itemId: dragPayload.itemId });
    setDragPayload(null);
  }
  function handleDropOnInventoryArea(e) {
    e.preventDefault();
    if (!dragPayload) return;
    if (dragPayload.type === 'equippedItem') dispatch({ type: 'UNEQUIP_ITEM', equipmentId: dragPayload.equipmentId });
    setDragPayload(null);
  }

  return html`
    <div style=${{ display: 'flex', gap: 'var(--space-4)', flex: 1, alignItems: 'flex-start' }}>
      <${EquipSlotsPanel}
        allEquipSlots=${allEquipSlots} manage=${manage}
        onDragEquipped=${(equipmentId) => setDragPayload({ type: 'equippedItem', equipmentId })}
        onDropOnSlot=${handleDropOnSlot}
      />

      <div
        style=${{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        onDragOver=${manage ? (e) => e.preventDefault() : undefined}
        onDrop=${manage ? handleDropOnInventoryArea : undefined}
      >
        <div style=${{ display: 'flex', gap: 'var(--space-5)', fontSize: '12px', paddingBottom: 'var(--space-2)', borderBottom: '2px solid var(--color-divider)' }}>
          <span>덱 카드 <strong>${deckSize}</strong>장</span>
          ${inventory ? html`<span>인벤토리 <strong>${inventory.items.length}</strong>/${capacity}${burdenIds.size ? ` (짐 ${burdenIds.size})` : ''}</span>` : null}
        </div>

        ${deckGroups.map((g) => html`
          <div key=${g.name}>
            <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', marginBottom: '6px' }}>
              <span style=${{ width: '8px', height: '8px', background: g.color }}></span>${g.name} (${g.cards.length}장)
            </div>
            <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
              ${g.cards.map((c, i) => {
                const def = CARD_DEFINITIONS[c.defId];
                const type = TYPE_INFO[def.type] || TYPE_INFO.skill;
                const cost = getEffectiveCost(def, getStage(floor), {});
                return html`
                  <${Tooltip} key=${i} width=${280} content=${html`<${CardDetailTooltip} def=${def} cost=${cost} type=${type} overload=${floor} />`}>
                    <div style=${{ aspectRatio: '3/4', border: `2px solid ${g.color}`, background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', cursor: 'default' }}>
                      <span style=${{ fontSize: '9px', fontWeight: 800, textAlign: 'center', lineHeight: 1.2 }}>${c.name}</span>
                    </div>
                  <//>
                `;
              })}
            </div>
          </div>
        `)}

        ${inventory ? html`
          <div>
            <div style=${{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', marginBottom: '6px' }}>소지품 (잡템·환금템·탄약·미장착 장비)</div>
            <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
              ${inventory.items.map((item) => {
                const info = describeItem(item);
                const isBurden = burdenIds.has(item.id);
                return html`
                  <div
                    key=${item.id}
                    draggable=${manage && item.kind === 'equipment'}
                    onDragStart=${manage && item.kind === 'equipment' ? () => setDragPayload({ type: 'inventoryItem', itemId: item.id }) : undefined}
                    style=${{
                      aspectRatio: '3/4', border: `2px solid ${isBurden ? 'var(--color-accent)' : info.color}`,
                      background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '4px', position: 'relative',
                      cursor: manage && item.kind === 'equipment' ? 'grab' : 'default',
                    }}
                  >
                    <span style=${{ fontSize: '9px', fontWeight: 800, textAlign: 'center', lineHeight: 1.2 }}>${info.name}</span>
                    <span style=${{ fontSize: '9px', opacity: 0.7 }}>${info.sub}</span>
                    ${isBurden ? html`<span style=${{ position: 'absolute', bottom: '2px', fontSize: '7px', color: 'var(--color-accent-700)' }}>짐</span>` : null}
                    ${manage ? html`
                      <button
                        class="btn btn-icon" title="버리기"
                        style=${{ position: 'absolute', top: '2px', right: '2px', fontSize: '9px', padding: '1px 4px', lineHeight: 1 }}
                        onClick=${(e) => { e.stopPropagation(); dispatch({ type: 'DISCARD_ITEM', itemId: item.id }); }}
                      >×</button>
                    ` : null}
                  </div>
                `;
              })}
            </div>
          </div>
        ` : null}
      </div>
    </div>
  `;
}
