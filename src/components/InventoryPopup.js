import { html } from '../lib.js';
import { snapshotSignal } from '../state/runState.js';
import { DeckInventoryView } from './DeckInventoryView.js';

// Same "인벤토리" view as the 창고 — 출격 준비 screen's inventory tab, just reachable mid-combat.
// Loadout is fixed for the run, so this reflects exactly what was equipped at CONFIRM_LOADOUT.
export function InventoryPopup({ onClose }) {
  const loadout = snapshotSignal.value.playerState.loadout;

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
          <span style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '16px' }}>인벤토리</span>
          <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 10px' }} onClick=${onClose}>닫기</button>
        </div>
        <div style=${{ padding: 'var(--space-4)', overflowY: 'auto' }}>
          <${DeckInventoryView} loadout=${loadout} />
        </div>
      </div>
    </div>
  `;
}
