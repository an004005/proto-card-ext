import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../data/equipment.js';
import { MODULE_DEFINITIONS } from '../data/modules.js';
import { IMPLANT_DEFINITIONS } from '../data/implants.js';

const EQUIPMENT_DEFS = {
  ...WEAPON_DEFINITIONS, ...ARMOR_TOP_DEFINITIONS, ...ARMOR_BOTTOM_DEFINITIONS, ...MODULE_DEFINITIONS, ...IMPLANT_DEFINITIONS,
};

function describeLoot(item) {
  if (item.kind === 'junk') return { name: '잡템', sub: `환금 가치 ${item.value}cr`, color: 'var(--color-neutral-500)' };
  if (item.kind === 'currency') return { name: '환금템', sub: `가치 ${item.value}cr`, color: 'var(--color-accent-2-700)' };
  return { name: EQUIPMENT_DEFS[item.equipmentId]?.name || item.equipmentId, sub: '장비', color: 'var(--color-accent)' };
}

export function LootChoiceScreen() {
  const pendingLoot = snapshotSignal.value.pendingLoot;
  const items = pendingLoot ? pendingLoot.items : [];
  const [kept, setKept] = useState(() => new Set(items.map((_, i) => i)));

  function toggle(i) {
    const next = new Set(kept);
    if (next.has(i)) next.delete(i); else next.add(i);
    setKept(next);
  }

  return html`
    <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-6)', padding: 'var(--space-8)' }}>
      <h2 style=${{ margin: 0 }}>파밍 결과 — 습득할 항목을 선택하세요</h2>
      <p style=${{ margin: 0, fontSize: '12px', opacity: 0.7 }}>인벤토리 칸을 차지합니다. 과적 상태가 아니면 잡템·환금템은 덱에 사용 불가 카드로 들어가지 않습니다.</p>
      <div class="hr" style=${{ width: '500px' }}></div>
      <div style=${{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '700px' }}>
        ${items.map((item, i) => {
          const info = describeLoot(item);
          const selected = kept.has(i);
          return html`
            <div
              key=${i}
              style=${{
                width: '150px', minHeight: '140px', background: 'var(--color-surface)',
                border: `2px solid ${selected ? info.color : 'var(--color-divider)'}`,
                padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '10px',
                alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: 'pointer',
                opacity: selected ? 1 : 0.5,
              }}
              onClick=${() => toggle(i)}
            >
              <span style=${{ width: '32px', height: '32px', background: info.color }}></span>
              <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '14px' }}>${info.name}</div>
              <div style=${{ fontSize: '11px', opacity: 0.75 }}>${info.sub}</div>
              <span class=${`tag ${selected ? 'tag-accent' : 'tag-neutral'}`} style=${{ fontSize: '10px' }}>${selected ? '습득' : '버리기'}</span>
            </div>
          `;
        })}
      </div>
      <button
        class="btn btn-primary" style=${{ padding: '12px 40px', fontSize: '15px' }}
        onClick=${() => dispatch({ type: 'CONFIRM_LOOT_CHOICE', keepIndices: [...kept] })}
      >확인</button>
    </div>
  `;
}
