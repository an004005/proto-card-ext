import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { STARTING_AMMO } from '../data/loadoutPool.js';
import { CATEGORIES, getSelectedIds, cardCountOf, buildAllEquipSlots, buildDeckGroups } from '../data/loadoutDisplay.js';
import { buildDeckFromLoadout, computeFloorOverload, computeMaxHpBonus, computeInventoryCapacityBonus } from '../engine/equipmentEngine.js';
import { BASE_INVENTORY_CAPACITY } from '../engine/gameReducer.js';
import { OverloadGauge } from './OverloadGauge.js';
import { Tooltip } from './Tooltip.js';
import { EquipSlotsPanel } from './EquipSlotsPanel.js';
import { DeckInventoryView } from './DeckInventoryView.js';
import { EquipmentTooltipContent } from './EquipmentTooltipContent.js';

function StatBox({ label, value }) {
  return html`
    <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-2) var(--space-3)', display: 'flex', justifyContent: 'space-between', background: 'var(--color-surface)' }}>
      <span style=${{ fontSize: '11px', fontWeight: 700 }}>${label}</span>
      <span style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800 }}>${value}</span>
    </div>
  `;
}

export function LoadoutScreen() {
  const [loadoutTab, setLoadoutTab] = useState('equip');
  const [activeTab, setActiveTab] = useState('weapon');
  const loadout = snapshotSignal.value.playerState.loadout;
  const cat = CATEGORIES.find((c) => c.key === activeTab);

  const deckSize = buildDeckFromLoadout(loadout).length;
  const floor = computeFloorOverload(loadout);
  const maxHp = 70 + computeMaxHpBonus(loadout);
  const capacity = BASE_INVENTORY_CAPACITY + computeInventoryCapacityBonus(loadout);
  const deckGroups = buildDeckGroups(loadout);

  const warehouseItems = cat.key === 'consumable'
    ? loadout.consumables.map((c) => ({ id: c.defId, name: CONSUMABLE_DEFINITIONS[c.defId].name, sub: `×${c.count}`, selected: false, description: CONSUMABLE_DEFINITIONS[c.defId].description }))
    : cat.pool.map((id) => {
        const def = cat.defs[id];
        const selected = getSelectedIds(loadout, cat).includes(id);
        const cardCount = cardCountOf(def);
        return {
          id, name: def.name, selected, description: def.description, cardList: def.cardList,
          sub: cardCount !== undefined ? `카드 ${cardCount}장` : def.floorOverload !== undefined ? `과부화 바닥 +${def.floorOverload}` : '',
        };
      });

  const allEquipSlots = buildAllEquipSlots(loadout);

  return html`
    <div style=${{ padding: 'var(--space-6) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid var(--color-divider)', paddingBottom: 'var(--space-3)' }}>
        <h2 style=${{ margin: 0 }}>창고 — 출격 준비</h2>
        <div style=${{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style=${{ display: 'flex', gap: '4px' }}>
            ${[['equip', '장비'], ['inventory', '인벤토리']].map(([id, label]) => html`
              <button key=${id} class=${`btn ${loadoutTab === id ? 'btn-primary' : 'btn-secondary'}`}
                style=${{ fontSize: '12px', padding: '4px 14px' }}
                onClick=${() => setLoadoutTab(id)}
              >${label}</button>
            `)}
          </div>
          ${loadoutTab === 'equip' ? html`
            <div style=${{ display: 'flex', gap: '6px' }}>
              ${CATEGORIES.map((c) => html`
                <button key=${c.key} class=${`btn ${activeTab === c.key ? 'btn-primary' : 'btn-secondary'}`}
                  style=${{ fontSize: '12px', padding: '4px 10px' }}
                  onClick=${() => setActiveTab(c.key)}
                >${c.label}</button>
              `)}
            </div>
          ` : null}
        </div>
      </div>

      ${loadoutTab === 'equip' ? html`
        <div style=${{ display: 'flex', gap: 'var(--space-4)', flex: 1 }}>
          <div style=${{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-3)', alignContent: 'start' }}>
            ${warehouseItems.map((it) => {
              const tile = html`
                <div
                  style=${{
                    border: `2px solid ${it.selected ? 'var(--color-accent)' : 'var(--color-divider)'}`,
                    background: 'var(--color-surface)', padding: 'var(--space-3)', position: 'relative',
                    cursor: cat.slotType ? 'pointer' : 'default',
                  }}
                  onClick=${cat.slotType ? () => dispatch({ type: 'SET_LOADOUT_SLOT', slotType: cat.slotType, id: it.id }) : undefined}
                >
                  <div style=${{ position: 'relative', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style=${{ position: 'absolute', left: '50%', top: '6px', width: '34px', height: '44px', background: 'var(--color-neutral-200)', border: '1px solid var(--color-divider)', transform: 'translateX(-50%) rotate(-10deg)' }}></span>
                    <span style=${{ position: 'absolute', left: '50%', top: '4px', width: '34px', height: '44px', background: 'var(--color-neutral-100)', border: '1px solid var(--color-divider)', transform: 'translateX(-50%) rotate(6deg)' }}></span>
                    <span style=${{ position: 'relative', width: '38px', height: '38px', background: cat.iconColor }}></span>
                  </div>
                  <div style=${{ fontWeight: 800, fontSize: '12px', marginTop: '8px' }}>${it.name}</div>
                  <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                    <span class="tag tag-outline" style=${{ fontSize: '10px' }}>${it.sub}</span>
                    ${it.selected ? html`<span class="tag tag-accent" style=${{ fontSize: '10px' }}>장착중</span>` : null}
                  </div>
                </div>
              `;
              if (it.description) return html`<${Tooltip} key=${it.id} width=${220} content=${it.description}>${tile}<//>`;
              if (it.cardList) return html`<${Tooltip} key=${it.id} width=${260} content=${html`<${EquipmentTooltipContent} name=${it.name} cardList=${it.cardList} />`}>${tile}<//>`;
              return html`<div key=${it.id}>${tile}</div>`;
            })}
          </div>

          <${EquipSlotsPanel} allEquipSlots=${allEquipSlots} />

          <div style=${{ width: '280px', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-3)', background: 'var(--color-surface)' }}>
              <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', marginBottom: '6px' }}>장착 과부화</div>
              <${OverloadGauge} overload=${floor} floor=${floor} />
            </div>

            <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-3)', background: 'var(--color-surface)', flex: 1, overflowY: 'auto' }}>
              <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', marginBottom: '8px' }}>
                <span>구성된 덱</span><span>${deckSize}장</span>
              </div>
              ${deckGroups.map((g) => html`
                <div key=${g.name} style=${{ marginBottom: '8px' }}>
                  <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, marginBottom: '3px' }}>
                    <span style=${{ width: '8px', height: '8px', background: g.color }}></span>${g.name} (${g.cards.length}장)
                  </div>
                  ${g.cards.map((c, i) => html`<div key=${i} style=${{ fontSize: '11px', opacity: 0.8, paddingLeft: '14px' }}>· ${c.name}</div>`)}
                </div>
              `)}
            </div>

            <${StatBox} label="시작 탄환" value=${STARTING_AMMO} />
            <${StatBox} label="최대 체력" value=${maxHp} />
            <${StatBox} label="인벤토리" value=${`${capacity}칸`} />
          </div>
        </div>
      ` : html`<${DeckInventoryView} loadout=${loadout} />`}

      <div style=${{ display: 'flex', justifyContent: 'center' }}>
        <button class="btn btn-primary" style=${{ padding: '12px 60px', fontSize: '15px' }} onClick=${() => dispatch({ type: 'CONFIRM_LOADOUT' })}>
          출격
        </button>
      </div>
    </div>
  `;
}
