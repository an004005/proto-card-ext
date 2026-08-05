import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../data/equipment.js';
import { MODULE_DEFINITIONS } from '../data/modules.js';
import { IMPLANT_DEFINITIONS } from '../data/implants.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { WAREHOUSE_STARTING_POOL, FARMING_ONLY_POOL, STARTING_AMMO } from '../data/loadoutPool.js';
import { buildDeckFromLoadout, computeFloorOverload, computeMaxHpBonus, computeInventoryCapacityBonus } from '../engine/equipmentEngine.js';
import { getEffectiveCost } from '../engine/combatEngine.js';
import { getStage } from '../engine/overloadEngine.js';
import { OverloadGauge } from './OverloadGauge.js';
import { Tooltip } from './Tooltip.js';
import { CardDetailTooltip, TYPE_INFO } from './Card.js';

const CATEGORIES = [
  { key: 'weapon', label: '무기', defs: WEAPON_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.weapons, ...FARMING_ONLY_POOL.weapons], slotType: 'weapon', max: 2, iconColor: 'var(--color-accent)' },
  { key: 'top', label: '상의', defs: ARMOR_TOP_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.tops, ...FARMING_ONLY_POOL.tops], slotType: 'top', max: 1, iconColor: 'var(--color-neutral-700)' },
  { key: 'bottom', label: '하의', defs: ARMOR_BOTTOM_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.bottoms, ...FARMING_ONLY_POOL.bottoms], slotType: 'bottom', max: 1, iconColor: 'var(--color-neutral-700)' },
  { key: 'module', label: '모듈', defs: MODULE_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.modules, ...FARMING_ONLY_POOL.modules], slotType: 'module', max: 2, iconColor: 'var(--color-accent-2-700)' },
  { key: 'implant', label: '임플란트', defs: IMPLANT_DEFINITIONS, pool: [...WAREHOUSE_STARTING_POOL.implants, ...FARMING_ONLY_POOL.implants], slotType: 'implant', max: 3, iconColor: 'var(--color-accent-2-700)' },
  { key: 'consumable', label: '소모품', defs: null, pool: null, slotType: null, max: null, iconColor: 'var(--color-neutral-700)' },
];

function getSelectedIds(loadout, cat) {
  if (cat.key === 'weapon') return loadout.weaponIds;
  if (cat.key === 'top') return loadout.topId ? [loadout.topId] : [];
  if (cat.key === 'bottom') return loadout.bottomId ? [loadout.bottomId] : [];
  if (cat.key === 'module') return loadout.moduleIds;
  if (cat.key === 'implant') return loadout.implantIds;
  return [];
}

function cardCountOf(def) {
  if (!def || !def.cardList) return undefined;
  return def.cardList.reduce((s, e) => s + e.count, 0);
}

function buildSlots(cat, loadout) {
  const ids = getSelectedIds(loadout, cat);
  const slots = [];
  for (let i = 0; i < cat.max; i++) {
    const id = ids[i];
    const def = id ? cat.defs[id] : null;
    slots.push({
      key: `${cat.key}${i}`,
      category: cat.max > 1 ? `${cat.label}${i + 1}` : cat.label,
      filled: !!def,
      name: def?.name,
      cardCount: cardCountOf(def),
      floorOverload: def?.floorOverload,
    });
  }
  return slots;
}

function buildDeckGroups(loadout) {
  const groups = [];
  const pushGroup = (name, color, cardList) => {
    if (!cardList) return;
    const cards = [];
    for (const entry of cardList) {
      const cardDef = CARD_DEFINITIONS[entry.defId];
      if (cardDef.requiresWeapon && !loadout.weaponIds.includes(cardDef.requiresWeapon)) continue;
      for (let i = 0; i < entry.count; i++) cards.push({ name: cardDef.name, defId: entry.defId });
    }
    if (cards.length) groups.push({ name, color, cards });
  };
  loadout.weaponIds.forEach((id) => WEAPON_DEFINITIONS[id] && pushGroup(WEAPON_DEFINITIONS[id].name, 'var(--color-accent)', WEAPON_DEFINITIONS[id].cardList));
  if (loadout.topId) pushGroup(ARMOR_TOP_DEFINITIONS[loadout.topId].name, 'var(--color-neutral-700)', ARMOR_TOP_DEFINITIONS[loadout.topId].cardList);
  if (loadout.bottomId) pushGroup(ARMOR_BOTTOM_DEFINITIONS[loadout.bottomId].name, 'var(--color-neutral-700)', ARMOR_BOTTOM_DEFINITIONS[loadout.bottomId].cardList);
  loadout.moduleIds.forEach((id) => MODULE_DEFINITIONS[id] && pushGroup(MODULE_DEFINITIONS[id].name, 'var(--color-accent-2-700)', MODULE_DEFINITIONS[id].cardList));
  return groups;
}

function StatBox({ label, value }) {
  return html`
    <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-2) var(--space-3)', display: 'flex', justifyContent: 'space-between', background: 'var(--color-surface)' }}>
      <span style=${{ fontSize: '11px', fontWeight: 700 }}>${label}</span>
      <span style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800 }}>${value}</span>
    </div>
  `;
}

function EquipSlotsPanel({ allEquipSlots }) {
  return html`
    <div style=${{ width: '260px', border: '2px solid var(--color-divider)', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--color-surface)', flexShrink: 0 }}>
      <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px' }}>장비 슬롯</div>
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        ${allEquipSlots.map((sl) => html`
          <div key=${sl.key} style=${{
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
        `)}
      </div>
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
  const capacity = 30 + computeInventoryCapacityBonus(loadout);
  const deckGroups = buildDeckGroups(loadout);

  const warehouseItems = cat.key === 'consumable'
    ? loadout.consumables.map((c) => ({ id: c.defId, name: CONSUMABLE_DEFINITIONS[c.defId].name, sub: `×${c.count}`, selected: false, description: CONSUMABLE_DEFINITIONS[c.defId].description }))
    : cat.pool.map((id) => {
        const def = cat.defs[id];
        const selected = getSelectedIds(loadout, cat).includes(id);
        const cardCount = cardCountOf(def);
        return {
          id, name: def.name, selected, description: def.description,
          sub: cardCount !== undefined ? `카드 ${cardCount}장` : def.floorOverload !== undefined ? `과부화 바닥 +${def.floorOverload}` : '',
        };
      });

  const allEquipSlots = [
    ...buildSlots(CATEGORIES[0], loadout),
    ...buildSlots(CATEGORIES[1], loadout),
    ...buildSlots(CATEGORIES[2], loadout),
    ...buildSlots(CATEGORIES[3], loadout),
    ...buildSlots(CATEGORIES[4], loadout),
  ];

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
              return it.description
                ? html`<${Tooltip} key=${it.id} width=${220} content=${it.description}>${tile}<//>`
                : html`<div key=${it.id}>${tile}</div>`;
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
      ` : html`
        <div style=${{ display: 'flex', gap: 'var(--space-4)', flex: 1, alignItems: 'flex-start' }}>
          <${EquipSlotsPanel} allEquipSlots=${allEquipSlots} />

          <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
          </div>
        </div>
      `}

      <div style=${{ display: 'flex', justifyContent: 'center' }}>
        <button class="btn btn-primary" style=${{ padding: '12px 60px', fontSize: '15px' }} onClick=${() => dispatch({ type: 'CONFIRM_LOADOUT' })}>
          출격
        </button>
      </div>
    </div>
  `;
}
