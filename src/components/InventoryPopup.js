import { html } from '../lib.js';
import { snapshotSignal } from '../state/runState.js';
import { DeckInventoryView } from './DeckInventoryView.js';

// mode='view'(전투 중, 기본값): 열람 전용. mode='manage'(맵 화면): 드래그앤드롭으로 장비
// 교체·짐으로 보관·버리기 가능 — gameReducer의 EQUIP_ITEM/UNEQUIP_ITEM/DISCARD_ITEM은
// currentScreen==='map'일 때만 실제로 반영되므로, 전투 중엔 드래그해도 상태가 안 바뀐다.
export function InventoryPopup({ onClose, mode = 'view' }) {
  const ps = snapshotSignal.value.playerState;
  const manage = mode === 'manage';

  return html`
    <div
      style=${{ position: 'fixed', inset: 0, background: 'color-mix(in srgb, #201e1d 55%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick=${onClose}
    >
      <div
        style=${{ width: '900px', maxWidth: '92vw', maxHeight: '80vh', background: 'var(--color-bg)', border: '2px solid var(--color-divider)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}
        onClick=${(e) => e.stopPropagation()}
      >
        <div style=${{ padding: 'var(--space-3) var(--space-4)', borderBottom: '2px solid var(--color-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '16px' }}>${manage ? '인벤토리 / 장비 교체' : '인벤토리'}</span>
          <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 10px' }} onClick=${onClose}>닫기</button>
        </div>
        <div style=${{ padding: 'var(--space-4)', overflowY: 'auto' }}>
          <${DeckInventoryView} loadout=${ps.loadout} inventory=${ps.inventory} manage=${manage} />
        </div>
      </div>
    </div>
  `;
}
