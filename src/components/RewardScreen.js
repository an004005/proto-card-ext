import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { describeItem } from '../data/itemDisplay.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';

const CATEGORY_INFO = {
  equipment: { label: '장비', iconColor: 'var(--color-accent)' },
  consumable: { label: '소모품', iconColor: 'var(--color-neutral-700)' },
  currency: { label: '환급템', iconColor: 'var(--color-accent-2-700)' },
  junk: { label: '재료', iconColor: 'var(--color-neutral-500)' },
};

function describeOption(opt) {
  if (opt.kind === 'consumable') {
    const def = CONSUMABLE_DEFINITIONS[opt.defId];
    return { name: def.name, color: 'var(--color-neutral-700)' };
  }
  if (opt.kind === 'ammo') {
    return { name: `탄약 +${opt.amount}`, color: 'var(--color-accent-2-700)' };
  }
  const info = describeItem(opt);
  return { name: info.name, color: info.color };
}

export function RewardScreen() {
  const [activeSlotKey, setActiveSlotKey] = useState(null);
  const pending = snapshotSignal.value.pendingReward;
  if (!pending) return null;

  const { slots, selections } = pending;
  const activeSlot = activeSlotKey ? slots.find((s) => s.key === activeSlotKey) : null;
  const claimedCount = Object.keys(selections).length;

  return html`
    <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--space-8)', gap: 'var(--space-6)' }}>
      <h2 style=${{ margin: 0 }}>전투 승리 — 보상 선택</h2>
      <div class="hr" style=${{ width: '500px' }}></div>

      ${activeSlot ? html`
        <div style=${{ width: '600px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style=${{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button class="btn btn-secondary" style=${{ fontSize: '12px', padding: '4px 10px' }} onClick=${() => setActiveSlotKey(null)}>← 뒤로</button>
            <div style=${{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.06em' }}>${CATEGORY_INFO[activeSlot.category].label} — ${activeSlot.options.length}종 중 1개 선택</div>
          </div>
          <div style=${{ display: 'flex', gap: 'var(--space-3)' }}>
            ${activeSlot.options.map((opt, idx) => {
              const info = describeOption(opt);
              const selected = selections[activeSlot.key] === idx;
              return html`
                <div
                  key=${idx}
                  onClick=${() => { dispatch({ type: 'SELECT_REWARD', slotKey: activeSlot.key, optionIndex: idx }); setActiveSlotKey(null); }}
                  style=${{
                    flex: 1, border: `2px solid ${selected ? 'var(--color-accent)' : 'var(--color-divider)'}`,
                    background: selected ? 'var(--color-neutral-100)' : 'var(--color-surface)',
                    padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                    cursor: 'pointer', position: 'relative',
                  }}
                >
                  ${selected ? html`<span style=${{ position: 'absolute', top: '6px', right: '6px', fontSize: '10px', fontWeight: 800, color: 'var(--color-accent-700)' }}>✓ 선택됨</span>` : null}
                  <span style=${{ width: '36px', height: '36px', background: info.color }}></span>
                  <div style=${{ fontSize: '13px', fontWeight: 700, textAlign: 'center' }}>${info.name}</div>
                </div>
              `;
            })}
          </div>
        </div>
      ` : html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '400px' }}>
          ${slots.map((slot) => {
            const cat = CATEGORY_INFO[slot.category];
            const claimedIdx = selections[slot.key];
            const claimed = claimedIdx !== undefined;
            const claimedInfo = claimed ? describeOption(slot.options[claimedIdx]) : null;
            return html`
              <div
                key=${slot.key}
                onClick=${() => setActiveSlotKey(slot.key)}
                style=${{ border: '2px solid var(--color-divider)', background: 'var(--color-surface)', padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer', position: 'relative' }}
              >
                <span style=${{ width: '36px', height: '36px', background: claimed ? claimedInfo.color : cat.iconColor, flexShrink: 0 }}></span>
                <div style=${{ flex: 1 }}>
                  <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '15px' }}>${cat.label}</div>
                  <div style=${{ fontSize: '11px', opacity: claimed ? 0.75 : 0.5 }}>${claimed ? claimedInfo.name : '클릭해서 선택'}</div>
                </div>
                ${claimed ? html`<span style=${{ fontSize: '12px', fontWeight: 800, color: 'var(--color-accent-700)' }}>✓</span>` : null}
              </div>
            `;
          })}
        </div>
      `}

      <div style=${{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginTop: 'var(--space-2)' }}>
        <span style=${{ fontSize: '12px', opacity: 0.7 }}>${claimedCount}/${slots.length} 선택됨</span>
        <button class="btn btn-primary" style=${{ padding: '12px 40px' }} onClick=${() => dispatch({ type: 'CONFIRM_REWARDS' })}>보상 수령하고 이동</button>
      </div>
    </div>
  `;
}
