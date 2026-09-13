import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { combatSummarySignal } from '../state/combatStateAdapter.js';
import { describeItem, EQUIPMENT_DEFS } from '../data/itemDisplay.js';
import { Tooltip } from './Tooltip.js';
import { ItemTooltipContent } from './ItemTooltipContent.js';
import { getBurdenItems } from '../engine/inventoryEngine.js';
import { MAX_DURABILITY } from '../engine/equipmentEngine.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';

const CATEGORY_INFO = {
  equipment: { label: '장비', iconColor: 'var(--color-accent)' },
  consumable: { label: '소모품', iconColor: 'var(--color-neutral-700)' },
  currency: { label: '환금템', iconColor: 'var(--color-accent-2-700)' },
  junk: { label: '잡템', iconColor: 'var(--color-neutral-500)' },
};

/**
 * 보상 후보를 인벤토리 아이템 모양으로 — ItemTooltipContent가 그대로 읽을 수 있게. 아직 받지
 * 않은 물건이라 id가 없고, 장비는 아직 내구도가 굴려지지 않았으므로 새것 기준으로 보여준다.
 */
function optionAsItem(opt) {
  if (opt.kind === 'ammo') return { id: 'preview', kind: 'ammo', amount: opt.amount };
  if (opt.kind === 'consumable') return { id: 'preview', kind: 'consumable', defId: opt.defId };
  if (opt.kind === 'equipment') return { id: 'preview', kind: 'equipment', equipmentId: opt.equipmentId, durability: MAX_DURABILITY };
  return { id: 'preview', kind: opt.kind, value: opt.value };
}

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
  const unclaimedCount = slots.length - claimedCount;
  const summary = combatSummarySignal.value;
  const inventory = snapshotSignal.value.playerState.inventory;
  const burdenCount = getBurdenItems(inventory).length;

  return html`
    <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--space-8)', gap: 'var(--space-6)' }}>
      <h2 style=${{ margin: 0 }}>전투 승리 — 보상 선택</h2>

      ${summary ? html`
        <div style=${{ width: '400px', border: '2px solid var(--color-divider)', padding: 'var(--space-3)', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style=${{ fontWeight: 800, letterSpacing: '0.04em', marginBottom: '2px' }}>이번 전투 장비 내구도 변화</div>
          ${summary.durabilityChanges.map((c, i) => html`
            <div key=${i} style=${{ opacity: 0.8 }}>${EQUIPMENT_DEFS[c.equipmentId]?.name || c.equipmentId} 내구도 ${c.from}→${c.to}</div>
          `)}
          ${summary.destroyed.map((d, i) => html`
            <div key=${i} style=${{ color: 'var(--color-accent-700)', fontWeight: 700 }}>${EQUIPMENT_DEFS[d.equipmentId]?.name || d.equipmentId} 파손 — 자동 해제됨</div>
          `)}
        </div>
      ` : null}

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
              // 이름만 보고 고르라고 하면 "산데비스탄"이 무엇을 주고 무엇을 뺏는지 모른 채
              // 고르게 된다 — 인벤토리와 같은 툴팁을 여기서도 붙인다(리뷰 B3).
              return html`
                <${Tooltip} key=${idx} width=${240} content=${html`<${ItemTooltipContent} item=${optionAsItem(opt)} />`}>
                <div
                  onClick=${() => { dispatch({ type: 'SELECT_REWARD', slotKey: activeSlot.key, optionIndex: idx }); setActiveSlotKey(null); }}
                  style=${{
                    border: `2px solid ${selected ? 'var(--color-accent)' : 'var(--color-divider)'}`,
                    background: selected ? 'var(--color-neutral-100)' : 'var(--color-surface)',
                    padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                    cursor: 'pointer', position: 'relative', minWidth: '150px',
                  }}
                >
                  ${selected ? html`<span style=${{ position: 'absolute', top: '6px', right: '6px', fontSize: '10px', fontWeight: 800, color: 'var(--color-accent-700)' }}>✓ 선택됨</span>` : null}
                  <span style=${{ width: '36px', height: '36px', background: info.color }}></span>
                  <div style=${{ fontSize: '13px', fontWeight: 700, textAlign: 'center' }}>${info.name}</div>
                </div>
                <//>
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
        ${/* 보상을 받기 전에 "지금 소지품이 몇 칸 남았는지"를 말해야 한다 — 넘치면 그 물건은
            선물이 아니라 덱에 섞이는 짐 카드가 된다(리뷰 B3). */ null}
        <span style=${{ fontSize: '12px', fontWeight: burdenCount > 0 ? 800 : 400, color: burdenCount > 0 ? 'var(--color-negative, #dc2626)' : undefined }}>
          소지품 ${inventory.items.length}/${inventory.capacity}${burdenCount > 0 ? ` — 넘친 ${burdenCount}개는 짐 카드` : ' — 넘치면 짐 카드'}
        </span>
        <button class="btn btn-primary" style=${{ padding: '12px 40px' }} onClick=${() => dispatch({ type: 'CONFIRM_REWARDS' })}>
          ${unclaimedCount > 0 ? `선택 안 한 ${unclaimedCount}개는 버리고 이동` : '보상 수령하고 이동'}
        </button>
      </div>
    </div>
  `;
}
