import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { computeMaxHpBonus, computeInventoryCapacityBonus } from '../engine/equipmentEngine.js';
import { BASE_INVENTORY_CAPACITY, BASE_MAX_HP } from '../engine/gameReducer.js';
import { getUsableAmmo } from '../engine/inventoryEngine.js';
import { computeCapabilities, effectiveForRequirement } from '../engine/capabilityEngine.js';
import { CAPABILITY_ORDER, CAPABILITY_LABELS, CAPABILITY_SHORT, CAPABILITY_ROLE, CAPABILITY_KOREAN } from '../data/capabilityDisplay.js';
import { DeckInventoryView } from './DeckInventoryView.js';
import { Tooltip } from './Tooltip.js';

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

  const maxHp = BASE_MAX_HP + computeMaxHpBonus(loadout);
  const capacity = BASE_INVENTORY_CAPACITY + computeInventoryCapacityBonus(loadout);
  const startingAmmo = getUsableAmmo(ps.inventory);
  const capabilities = computeCapabilities(loadout);

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
          <${StatBox} label="시작 탄환" value=${startingAmmo} />
          <${StatBox} label="최대 체력" value=${maxHp} />
          <${StatBox} label="인벤토리" value=${`${capacity}칸`} />

          <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-surface)' }}>
            <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', marginBottom: '6px' }}>시설맵 Capability</div>
            <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              ${CAPABILITY_ORDER.map((key) => {
                const raw = capabilities[key];
                const eff = effectiveForRequirement(raw);
                return html`
                  ${/* 창고(출격 준비)와 맵이 같은 문장을 써야 한다 — 여기서만 "유효치"를 말하면
                      플레이어는 층계 판정이 그 값으로 이뤄진다고 읽는다(리뷰 B7). */ null}
                  <${Tooltip} key=${key} width=${240} content=${`${CAPABILITY_LABELS[key]}(${CAPABILITY_KOREAN[key]}) — ${CAPABILITY_ROLE[key]} 현재 값 ${raw >= 0 ? '+' : ''}${raw}(층계 판정은 이 원시 수치를 그대로 씁니다 — 0으로 자르지 않으며, 0 하한이 걸리는 것은 높은 지형 통과 판정뿐입니다. 그 하한을 적용한 값은 ${eff}). 시설맵 화면에서 사용됩니다.`}>
                    <span class="tag tag-outline" tabIndex="0">${CAPABILITY_SHORT[key]}(${CAPABILITY_KOREAN[key]}) ${raw >= 0 ? '+' : ''}${raw}</span>
                  <//>
                `;
              })}
            </div>
          </div>
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
