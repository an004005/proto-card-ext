import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { computeMaxHpBonus, computeInventoryCapacityBonus } from '../engine/equipmentEngine.js';
import { BASE_INVENTORY_CAPACITY, BASE_MAX_HP } from '../engine/gameReducer.js';
import { getUsableAmmo } from '../engine/inventoryEngine.js';
import { computeCapabilities, effectiveForRequirement } from '../engine/capabilityEngine.js';
import { CAPABILITY_ORDER, CAPABILITY_LABELS, CAPABILITY_SHORT, CAPABILITY_ROLE, CAPABILITY_KOREAN } from '../data/capabilityDisplay.js';
import { LOADOUT_PRESETS } from '../data/loadoutPresets.js';
import { previewPresetCapabilities } from '../engine/loadoutReducer.js';
import { EQUIPMENT_DEFS } from '../data/itemDisplay.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
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

/** 프리셋이 건너뛴 항목을 사람이 읽는 이름으로 — 장비든 소모품이든 같은 줄에 적는다. */
function presetItemName(id) {
  return EQUIPMENT_DEFS[id]?.name ?? CONSUMABLE_DEFINITIONS[id]?.name ?? id;
}

// 역할군 프리셋(data/loadoutPresets.js) — 창고에서 장비를 한 점씩 집어 여섯 Capability를 머릿속으로
// 더하는 대신, 완성된 구성 넷을 먼저 보여준다. 툴팁에 결과 Capability 여섯 값을 그대로 적으므로
// 누르기 전에 무엇을 얻고 무엇을 잃는지가 보인다.
function PresetRow({ applied }) {
  return html`
    <div style=${{ border: '2px solid var(--color-divider)', background: 'var(--color-surface)', padding: 'var(--space-2) var(--space-3)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style=${{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em' }}>프리셋</span>
        <span style=${{ fontSize: '10px', opacity: 0.7 }}>누르면 장착된 장비를 전부 창고로 되돌리고 그 역할군 구성으로 갈아입습니다 (탄약은 그대로)</span>
      </div>
      <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        ${LOADOUT_PRESETS.map((preset) => {
          const capabilities = previewPresetCapabilities(preset);
          const preview = CAPABILITY_ORDER
            .map((key) => `${CAPABILITY_SHORT[key]}(${CAPABILITY_KOREAN[key]}) ${capabilities[key] >= 0 ? '+' : ''}${capabilities[key]}`)
            .join(' · ');
          return html`
            <${Tooltip} key=${preset.id} width=${280} content=${`${preset.name} — ${preset.summary}. 장착 후 시설맵 Capability: ${preview}`}>
              <button
                class=${`btn ${applied?.presetId === preset.id ? 'btn-primary' : 'btn-secondary'}`}
                style=${{ padding: '6px 12px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', textAlign: 'left' }}
                onClick=${() => dispatch({ type: 'APPLY_LOADOUT_PRESET', presetId: preset.id })}
              >
                <span style=${{ fontWeight: 800 }}>${preset.name}</span>
                <span style=${{ fontSize: '10px', opacity: 0.8 }}>${preset.summary}</span>
              </button>
            <//>
          `;
        })}
      </div>
      ${applied?.missing?.length
        ? html`<span style=${{ fontSize: '11px', color: 'var(--color-accent-700)' }}>
            창고에 없음: ${applied.missing.map(presetItemName).join(', ')}
          </span>`
        : null}
    </div>
  `;
}

// 창고 — 출격 준비: 장비 슬롯 + 소지품(장착 가능 장비 카드)을 DeckInventoryView(manage 모드)로
// 통합 표시 — 맵 화면의 인벤토리 팝업과 동일한 컴포넌트/드래그앤드롭 로직을 재사용한다. 클릭
// (장착/해제) 또는 드래그 둘 다로 "장착" ↔ "덱에 장비 카드로 보관"을 오갈 수 있다.
export function LoadoutScreen() {
  const snapshot = snapshotSignal.value;
  const ps = snapshot.playerState;
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

      <${PresetRow} applied=${snapshot.appliedLoadoutPreset} />

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
                  <${Tooltip} key=${key} width=${240} content=${`${CAPABILITY_LABELS[key]}(${CAPABILITY_KOREAN[key]}) — ${CAPABILITY_ROLE[key]} 현재 값 ${raw >= 0 ? '+' : ''}${raw}(층계 판정은 이 원시 수치를 그대로 씁니다 — 0으로 자르지 않습니다. 예외는 고지대 통과 하나로, 지형 판정이라 0 하한을 적용한 값 ${eff}로 층계를 가릅니다). 시설맵 화면에서 사용됩니다.`}>
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
