import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { computeFloorOverload, computeMaxHpBonus, computeInventoryCapacityBonus } from '../engine/equipmentEngine.js';
import { BASE_INVENTORY_CAPACITY, BASE_MAX_HP } from '../engine/gameReducer.js';
import { getUsableAmmo } from '../engine/inventoryEngine.js';
import { OverloadGauge } from './OverloadGauge.js';
import { DeckInventoryView } from './DeckInventoryView.js';

function StatBox({ label, value }) {
  return html`
    <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-2) var(--space-3)', display: 'flex', justifyContent: 'space-between', background: 'var(--color-surface)' }}>
      <span style=${{ fontSize: '11px', fontWeight: 700 }}>${label}</span>
      <span style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800 }}>${value}</span>
    </div>
  `;
}

// 창고 — 출격 준비: 장비 슬롯 + 소지품(장착 가능 장비 카드)을 DeckInventoryView(manage 모드)로
// 통합 표시 — 맵 화면의 인벤토리 팝업과 동일한 컴포넌트/드래그앤드롭 로직을 재사용한다. 클릭
// (장착/해제) 또는 드래그 둘 다로 "장착" ↔ "덱에 장비 카드로 보관"을 오갈 수 있다.
export function LoadoutScreen() {
  const ps = snapshotSignal.value.playerState;
  const loadout = ps.loadout;

  const floor = computeFloorOverload(loadout);
  const maxHp = BASE_MAX_HP + computeMaxHpBonus(loadout);
  const capacity = BASE_INVENTORY_CAPACITY + computeInventoryCapacityBonus(loadout);
  const startingAmmo = getUsableAmmo(ps.inventory);

  return html`
    <div style=${{ padding: 'var(--space-6) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid var(--color-divider)', paddingBottom: 'var(--space-3)' }}>
        <h2 style=${{ margin: 0 }}>창고 — 출격 준비</h2>
        <span style=${{ fontSize: '11px', opacity: 0.7 }}>장비 클릭 또는 드래그로 장착 ⇄ 짐(덱 카드) 전환</span>
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-4)', flex: 1 }}>
        <div style=${{ flex: 1 }}>
          <${DeckInventoryView} loadout=${loadout} inventory=${ps.inventory} warehouse=${ps.warehouse} manage=${true} />
        </div>

        <div style=${{ width: '280px', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-3)', background: 'var(--color-surface)' }}>
            <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', marginBottom: '6px' }}>장착 과부화</div>
            <${OverloadGauge} overload=${floor} floor=${floor} />
          </div>

          <${StatBox} label="시작 탄환" value=${startingAmmo} />
          <${StatBox} label="최대 체력" value=${maxHp} />
          <${StatBox} label="인벤토리" value=${`${capacity}칸`} />
        </div>
      </div>

      <div style=${{ display: 'flex', justifyContent: 'center' }}>
        <button class="btn btn-secondary" style=${{ padding: '12px 24px', fontSize: '14px', marginRight: 'var(--space-3)' }} onClick=${() => dispatch({ type: 'AUTO_EQUIP_LOADOUT' })}>
          자동 장착
        </button>
        <button class="btn btn-primary" style=${{ padding: '12px 60px', fontSize: '15px' }} onClick=${() => dispatch({ type: 'CONFIRM_LOADOUT' })}>
          출격
        </button>
      </div>
    </div>
  `;
}
