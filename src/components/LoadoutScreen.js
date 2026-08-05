import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../data/equipment.js';
import { MODULE_DEFINITIONS } from '../data/modules.js';
import { IMPLANT_DEFINITIONS } from '../data/implants.js';
import { WAREHOUSE_STARTING_POOL, STARTING_AMMO } from '../data/loadoutPool.js';
import { buildDeckFromLoadout, computeFloorOverload, computeMaxHpBonus, computeInventoryCapacityBonus } from '../engine/equipmentEngine.js';
import { OverloadGauge } from './OverloadGauge.js';

function SlotSection({ title, items, selectedIds, multi, onToggle }) {
  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style=${{ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.6 }}>${title}</div>
      <div style=${{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        ${items.map((item) => {
          const selected = selectedIds.includes(item.id);
          return html`
            <button
              key=${item.id}
              class=${`btn ${selected ? 'btn-primary' : 'btn-secondary'}`}
              style=${{ fontSize: '12px', padding: '6px 12px' }}
              onClick=${() => onToggle(item.id)}
            >${item.name}${item.floorOverload !== undefined ? ` (바닥 ${item.floorOverload})` : ''}</button>
          `;
        })}
      </div>
    </div>
  `;
}

export function LoadoutScreen() {
  const loadout = snapshotSignal.value.playerState.loadout;

  const weapons = WAREHOUSE_STARTING_POOL.weapons.map((id) => WEAPON_DEFINITIONS[id]);
  const tops = WAREHOUSE_STARTING_POOL.tops.map((id) => ARMOR_TOP_DEFINITIONS[id]);
  const bottoms = WAREHOUSE_STARTING_POOL.bottoms.map((id) => ARMOR_BOTTOM_DEFINITIONS[id]);
  const modules = WAREHOUSE_STARTING_POOL.modules.map((id) => MODULE_DEFINITIONS[id]);
  const implants = WAREHOUSE_STARTING_POOL.implants.map((id) => IMPLANT_DEFINITIONS[id]);

  const deckSize = buildDeckFromLoadout(loadout).length;
  const floor = computeFloorOverload(loadout);
  const maxHp = 70 + computeMaxHpBonus(loadout);
  const capacity = 30 + computeInventoryCapacityBonus(loadout);

  return html`
    <div style=${{ padding: 'var(--space-6) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: '900px' }}>
      <div style=${{ borderBottom: '2px solid var(--color-divider)', paddingBottom: 'var(--space-3)' }}>
        <h2 style=${{ margin: 0 }}>창고 — 출격 준비</h2>
        <p style=${{ margin: '4px 0 0', fontSize: '13px', opacity: 0.7 }}>런 중에는 창고에 접근할 수 없습니다. 장착을 확정하면 바로 1층부터 시작합니다.</p>
      </div>

      <${SlotSection} title="무기 (최대 2)" items=${weapons} selectedIds=${loadout.weaponIds}
        onToggle=${(id) => dispatch({ type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id })} />
      <${SlotSection} title="상의" items=${tops} selectedIds=${[loadout.topId]}
        onToggle=${(id) => dispatch({ type: 'SET_LOADOUT_SLOT', slotType: 'top', id })} />
      <${SlotSection} title="하의" items=${bottoms} selectedIds=${[loadout.bottomId]}
        onToggle=${(id) => dispatch({ type: 'SET_LOADOUT_SLOT', slotType: 'bottom', id })} />
      <${SlotSection} title="모듈 (최대 2)" items=${modules} selectedIds=${loadout.moduleIds}
        onToggle=${(id) => dispatch({ type: 'SET_LOADOUT_SLOT', slotType: 'module', id })} />
      <${SlotSection} title="임플란트 (최대 3, 장착 시 과부화 바닥 상승)" items=${implants.map((i) => ({ ...i, floorOverload: i.floorOverload }))} selectedIds=${loadout.implantIds}
        onToggle=${(id) => dispatch({ type: 'SET_LOADOUT_SLOT', slotType: 'implant', id })} />

      <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        ${loadout.consumables.map((c) => html`<span key=${c.defId} class="tag tag-neutral">${c.defId} ×${c.count}</span>`)}
      </div>

      <div class="hr" style=${{ margin: 0 }}></div>

      <div style=${{ display: 'flex', gap: 'var(--space-6)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span>최대 체력 <strong>${maxHp}</strong></span>
        <span>인벤토리 <strong>${capacity}</strong>칸</span>
        <span>시작 총알 <strong>${STARTING_AMMO}</strong></span>
        <span>덱 <strong>${deckSize}</strong>장</span>
      </div>
      <div style=${{ width: '320px' }}>
        <${OverloadGauge} overload=${floor} floor=${floor} />
      </div>

      <button class="btn btn-primary" style=${{ padding: '12px 40px', alignSelf: 'flex-start' }} onClick=${() => dispatch({ type: 'CONFIRM_LOADOUT' })}>
        장착 확정 — 출격
      </button>
    </div>
  `;
}
