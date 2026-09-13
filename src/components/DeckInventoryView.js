import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../data/equipment.js';
import { MODULE_DEFINITIONS } from '../data/modules.js';
import { IMPLANT_DEFINITIONS } from '../data/implants.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { buildDeckFromLoadout, computeInventoryCapacityBonus } from '../engine/equipmentEngine.js';
import { buildAllEquipSlots, buildDeckGroups, buildBurdenGroups } from '../data/loadoutDisplay.js';
import { getEffectiveCost } from '../engine/combatEngine.js';
import { getStage } from '../engine/overloadEngine.js';
import { BASE_INVENTORY_CAPACITY } from '../engine/gameReducer.js';
import { getBurdenItems } from '../engine/inventoryEngine.js';
import { describeItem } from '../data/itemDisplay.js';
import { describeCapabilityModifiers } from '../data/capabilityDisplay.js';
import { EquipSlotsPanel } from './EquipSlotsPanel.js';
import { Tooltip } from './Tooltip.js';
import { EquipmentTooltipContent } from './EquipmentTooltipContent.js';
import { ItemTooltipContent } from './ItemTooltipContent.js';
import { CardDetailTooltip, TYPE_INFO } from './Card.js';
import { MAP_CONSUMABLE_TIME_COST } from '../engine/facilityReducer.js';

/** 맵에서 즉시 사용할 수 있는 "회복류" 소모품인지 — mapTags.traits에 'healing'이 있는 것만. */
function isHealingConsumable(item) {
  if (item.kind !== 'consumable') return false;
  const def = CONSUMABLE_DEFINITIONS[item.defId];
  return !!def?.mapTags.traits.includes('healing');
}

// "창고 — 출격 준비"의 인벤토리 탭과 동일한 뷰 — 장비 슬롯 + 장착으로 구성된 덱을 카드 그리드로
// 보여준다. `inventory`가 주어지면(맵/전투 팝업) 실제 소지품(잡템/환금템/탄약/미장착 장비) 그리드도
// 함께 렌더링한다. `warehouse`가 주어지면(창고 화면 전용) 무제한 보관함 그리드도 나란히 렌더링해
// 인벤토리와 드래그로 오갈 수 있다. `manage=true`(맵 중 인벤토리 팝업/창고)면 드래그앤드롭
// 장착/해제 + 버리기가 켜진다. 모든 종류의 아이템이 드래그 가능 — 장비 슬롯 드롭은
// gameReducer의 equipItem이 장착 불가능한 종류(잡템/환금템/탄약)는 알아서 무시한다.
const EQUIPPABLE_KINDS = new Set(['equipment', 'consumable']);
const EQUIPMENT_DEFS = { ...WEAPON_DEFINITIONS, ...ARMOR_TOP_DEFINITIONS, ...ARMOR_BOTTOM_DEFINITIONS, ...MODULE_DEFINITIONS, ...IMPLANT_DEFINITIONS };


function ItemGrid({ items, burdenIds, draggable, onItemDragStart, onItemDoubleClick, dblClickTitle, onItemUseMenu, onDiscard, emptyLabel }) {
  if (items.length === 0) {
    return html`
      <div style=${{
        border: '2px dashed var(--color-neutral-400)', borderRadius: '4px', padding: 'var(--space-4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '64px',
        fontSize: '11px', opacity: 0.6, textAlign: 'center',
      }}>${emptyLabel || '비어있음'}</div>
    `;
  }
  return html`
    <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: '4px' }}>
      ${items.map((item) => {
        const info = describeItem(item);
        const isBurden = burdenIds.has(item.id);
        const canDrag = draggable;
        const canDblClick = !!onItemDoubleClick;
        const canUseMenu = !!onItemUseMenu && isHealingConsumable(item);
        return html`
          ${/* 조작법(더블클릭/우클릭)은 브라우저 기본 title이 아니라 같은 Tooltip 안에 넣는다 —
              title은 뜨는 데 1초가 걸리고 키보드로는 아예 뜨지 않는다(리뷰 B7). */ null}
          <${Tooltip} key=${item.id} width=${240} content=${html`<div>
            <${ItemTooltipContent} item=${item} />
            ${canDblClick && dblClickTitle ? html`<div style=${{ fontSize: '10px', marginTop: '6px', opacity: 0.75 }}>${dblClickTitle}</div>` : null}
            ${canUseMenu ? html`<div style=${{ fontSize: '10px', marginTop: '2px', opacity: 0.75 }}>우클릭하여 즉시 사용</div>` : null}
          </div>`}>
            <div
              tabIndex="0"
              draggable=${canDrag}
              onDragStart=${canDrag ? () => onItemDragStart(item) : undefined}
              onDblClick=${canDblClick ? () => onItemDoubleClick(item) : undefined}
              onContextMenu=${canUseMenu ? (e) => { e.preventDefault(); onItemUseMenu(item); } : undefined}
              style=${{
                aspectRatio: '1/1', border: `2px solid ${isBurden ? 'var(--color-accent)' : info.color}`,
                background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', padding: '3px', position: 'relative',
                cursor: canDrag ? 'grab' : 'default',
              }}
            >
              <span style=${{ fontSize: '8px', fontWeight: 800, textAlign: 'center', lineHeight: 1.15 }}>${info.name}</span>
              <span style=${{ fontSize: '7px', opacity: 0.7, textAlign: 'center', lineHeight: 1.1 }}>${info.sub}</span>
              ${isBurden ? html`<span style=${{ position: 'absolute', bottom: '1px', fontSize: '6px', color: 'var(--color-accent-700)' }}>짐</span>` : null}
              ${onDiscard ? html`
                <button
                  class="btn btn-icon" aria-label="버리기"
                  style=${{ position: 'absolute', top: '1px', right: '1px', fontSize: '8px', padding: '0 3px', lineHeight: 1.2 }}
                  onClick=${(e) => { e.stopPropagation(); onDiscard(item.id); }}
                >×</button>
              ` : null}
            </div>
          <//>
        `;
      })}
    </div>
  `;
}

export function DeckInventoryView({ loadout, inventory = null, warehouse = null, manage = false, overloadActive = false }) {
  const [dragPayload, setDragPayload] = useState(null);
  const [tab, setTab] = useState('inventory'); // 'inventory' | 'deck'
  const [useMenuItem, setUseMenuItem] = useState(null); // 더블클릭/우클릭으로 연 "사용" 팝업 대상
  const deckSize = buildDeckFromLoadout(loadout).length;
  // 덱 탭의 카드 코스트·피해는 지금 과부화가 켜져 있는지를 그대로 따른다 — 화면마다 다른
  // 단계로 읽히면 플레이어가 실제로 낼 코스트를 알 수 없다(리뷰 B7).
  const deckStage = getStage(overloadActive);
  const capacity = BASE_INVENTORY_CAPACITY + computeInventoryCapacityBonus(loadout);
  const deckGroups = [...buildDeckGroups(loadout), ...buildBurdenGroups(inventory)];
  const allEquipSlots = buildAllEquipSlots(loadout);
  const burdenIds = inventory ? new Set(getBurdenItems(inventory).map((i) => i.id)) : new Set();

  function handleDropOnSlot() {
    if (!dragPayload) return;
    if (dragPayload.type === 'inventoryItem') dispatch({ type: 'EQUIP_ITEM', itemId: dragPayload.itemId });
    else if (dragPayload.type === 'warehouseItem') dispatch({ type: 'EQUIP_ITEM_FROM_WAREHOUSE', itemId: dragPayload.itemId });
    setDragPayload(null);
  }
  function handleDropOnInventoryArea(e) {
    e.preventDefault();
    if (!dragPayload) return;
    if (dragPayload.type === 'equippedItem') dispatch({ type: 'UNEQUIP_ITEM', itemId: dragPayload.itemId });
    else if (dragPayload.type === 'equippedImplant') dispatch({ type: 'UNEQUIP_IMPLANT', equipmentId: dragPayload.equipmentId });
    else if (dragPayload.type === 'equippedConsumable') dispatch({ type: 'UNEQUIP_CONSUMABLE', itemId: dragPayload.itemId });
    setDragPayload(null);
  }
  function handleDropOnWarehouseZone(e) {
    e.preventDefault();
    e.stopPropagation();
    if (dragPayload?.type === 'inventoryItem') dispatch({ type: 'MOVE_TO_WAREHOUSE', itemId: dragPayload.itemId });
    setDragPayload(null);
  }
  function handleDropOnInventoryZone(e) {
    e.preventDefault();
    e.stopPropagation();
    if (dragPayload?.type === 'warehouseItem') dispatch({ type: 'MOVE_TO_INVENTORY', itemId: dragPayload.itemId });
    else handleDropOnInventoryArea(e);
  }

  return html`
    <div style=${{ display: 'flex', gap: 'var(--space-4)', flex: 1, alignItems: 'flex-start' }}>
      <${EquipSlotsPanel}
        allEquipSlots=${allEquipSlots} manage=${manage}
        onDragEquipped=${(sl) => setDragPayload(
          sl.catKey === 'consumable' ? { type: 'equippedConsumable', itemId: sl.itemId }
            : sl.catKey === 'implant' ? { type: 'equippedImplant', equipmentId: sl.equipmentId }
              : { type: 'equippedItem', itemId: sl.itemId },
        )}
        onDropOnSlot=${handleDropOnSlot}
        onItemUseMenu=${(!warehouse && manage) ? (item) => setUseMenuItem(item) : null}
      />

      <div
        style=${{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        onDragOver=${manage ? (e) => e.preventDefault() : undefined}
        onDrop=${manage ? handleDropOnInventoryArea : undefined}
      >
        <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 'var(--space-2)', borderBottom: '2px solid var(--color-divider)' }}>
          <div style=${{ display: 'flex', gap: 'var(--space-5)', fontSize: '12px' }}>
            <span>덱 카드 <strong>${deckSize}</strong>장</span>
            ${inventory ? html`<span>인벤토리 <strong>${inventory.items.length}</strong>/${capacity}${burdenIds.size ? ` (짐 ${burdenIds.size})` : ''}</span>` : null}
            ${warehouse ? html`<span>창고 <strong>${warehouse.items.length}</strong></span>` : null}
          </div>
          ${inventory ? html`
            <div style=${{ display: 'flex', gap: '4px' }}>
              <button class="btn ${tab === 'inventory' ? 'btn-primary' : 'btn-secondary'}" style=${{ fontSize: '11px', padding: '4px 10px' }} onClick=${() => setTab('inventory')}>인벤토리</button>
              <button class="btn ${tab === 'deck' ? 'btn-primary' : 'btn-secondary'}" style=${{ fontSize: '11px', padding: '4px 10px' }} onClick=${() => setTab('deck')}>덱</button>
            </div>
          ` : null}
        </div>

        ${(!inventory || tab === 'deck') ? deckGroups.map((g) => html`
          <div key=${g.name}>
            <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', marginBottom: '6px' }}>
              <span style=${{ width: '8px', height: '8px', background: g.color }}></span>${g.name} (${g.cards.length}장)
            </div>
            <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
              ${g.cards.map((c, i) => {
                const def = CARD_DEFINITIONS[c.defId];
                const type = TYPE_INFO[def.type] || TYPE_INFO.skill;
                const cost = getEffectiveCost(def, deckStage, {});
                return html`
                  <${Tooltip} key=${i} width=${280} content=${html`<${CardDetailTooltip} def=${def} cost=${cost} type=${type} overloadActive=${overloadActive} item=${c.item} />`}>
                    <div style=${{ aspectRatio: '3/4', border: `2px solid ${g.color}`, background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', cursor: 'default' }}>
                      <span style=${{ fontSize: '9px', fontWeight: 800, textAlign: 'center', lineHeight: 1.2 }}>${c.name}</span>
                    </div>
                  <//>
                `;
              })}
            </div>
          </div>
        `) : null}

        ${(inventory && tab === 'inventory') ? html`
          <div style=${{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
            ${warehouse ? html`
              <div style=${{ flex: 1, minWidth: 0 }} onDragOver=${manage ? (e) => e.preventDefault() : undefined} onDrop=${manage ? handleDropOnWarehouseZone : undefined}>
                <div style=${{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', marginBottom: '6px' }}>창고 (무제한 — 여기서 인벤토리로 드래그하면 런에 들고 감)</div>
                <${ItemGrid}
                  items=${warehouse.items} burdenIds=${new Set()} draggable=${manage}
                  onItemDragStart=${(item) => setDragPayload({ type: 'warehouseItem', itemId: item.id })}
                  onItemDoubleClick=${manage ? (item) => dispatch({ type: 'MOVE_TO_INVENTORY', itemId: item.id }) : null}
                  dblClickTitle="더블클릭하여 인벤토리로 이동"
                  onDiscard=${manage ? (itemId) => dispatch({ type: 'DISCARD_ITEM', itemId }) : null}
                  emptyLabel="창고가 비어있음"
                />
              </div>
            ` : null}
            <div style=${{ flex: 1, minWidth: 0 }} onDragOver=${manage && warehouse ? (e) => e.preventDefault() : undefined} onDrop=${manage && warehouse ? handleDropOnInventoryZone : undefined}>
              <div style=${{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', marginBottom: '6px' }}>소지품 (잡템·환금템·탄약·미장착 장비·미장착 소모품)</div>
              <${ItemGrid}
                items=${inventory.items} burdenIds=${burdenIds} draggable=${manage}
                onItemDragStart=${(item) => setDragPayload({ type: 'inventoryItem', itemId: item.id })}
                onItemDoubleClick=${manage ? (item) => EQUIPPABLE_KINDS.has(item.kind) && dispatch({ type: 'EQUIP_ITEM', itemId: item.id }) : null}
                dblClickTitle="더블클릭하여 장착"
                onItemUseMenu=${(!warehouse && manage) ? (item) => setUseMenuItem(item) : null}
                onDiscard=${manage ? (itemId) => dispatch({ type: 'DISCARD_ITEM', itemId }) : null}
                emptyLabel=${warehouse ? '비어있음 — 창고에서 아이템을 여기로 드래그하면 런에 들고 갑니다' : '비어있음'}
              />
            </div>
          </div>
        ` : null}
      </div>
      ${useMenuItem ? html`<${MapConsumableUsePopup} item=${useMenuItem} onClose=${() => setUseMenuItem(null)} />` : null}
    </div>
  `;
}

/** 맵에서 회복류 소모품을 우클릭했을 때 뜨는 "사용" 팝업 — ConsumablePopup.dc.html 참고. */
function MapConsumableUsePopup({ item, onClose }) {
  const def = CONSUMABLE_DEFINITIONS[item.defId];
  return html`
    <div style=${{ position: 'fixed', inset: 0, background: 'color-mix(in srgb, #201e1d 45%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick=${onClose}>
      <div style=${{ width: '230px', background: 'var(--color-bg)', border: '1px solid var(--color-divider)', boxShadow: 'var(--shadow-lg)', padding: 'var(--space-4)' }} onClick=${(e) => e.stopPropagation()}>
        <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '15px', marginBottom: '2px' }}>${def.name}</div>
        <div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', marginBottom: '14px' }}>${def.description}</div>
        <button class="btn btn-primary" style=${{ width: '100%' }} onClick=${() => { dispatch({ type: 'USE_MAP_CONSUMABLE', itemId: item.id }); onClose(); }}>사용</button>
        <div style=${{ textAlign: 'center', fontSize: '10px', color: 'var(--color-neutral-600)', marginTop: '8px' }}>사용 시 시간 ${MAP_CONSUMABLE_TIME_COST}칸 소요</div>
      </div>
    </div>
  `;
}
