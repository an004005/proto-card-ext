import { html } from '../lib.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { buildDeckFromLoadout, computeFloorOverload, computeInventoryCapacityBonus } from '../engine/equipmentEngine.js';
import { buildAllEquipSlots, buildDeckGroups } from '../data/loadoutDisplay.js';
import { getEffectiveCost } from '../engine/combatEngine.js';
import { getStage } from '../engine/overloadEngine.js';
import { BASE_INVENTORY_CAPACITY } from '../engine/gameReducer.js';
import { EquipSlotsPanel } from './EquipSlotsPanel.js';
import { Tooltip } from './Tooltip.js';
import { CardDetailTooltip, TYPE_INFO } from './Card.js';

// "창고 — 출격 준비"의 인벤토리 탭과 동일한 뷰 — 장비 슬롯 + 장착으로 구성된 덱을 카드 그리드로
// 보여준다. 전투 중 인벤토리 팝업에서도 그대로 재사용한다.
export function DeckInventoryView({ loadout }) {
  const deckSize = buildDeckFromLoadout(loadout).length;
  const floor = computeFloorOverload(loadout);
  const capacity = BASE_INVENTORY_CAPACITY + computeInventoryCapacityBonus(loadout);
  const deckGroups = buildDeckGroups(loadout);
  const allEquipSlots = buildAllEquipSlots(loadout);

  return html`
    <div style=${{ display: 'flex', gap: 'var(--space-4)', flex: 1, alignItems: 'flex-start' }}>
      <${EquipSlotsPanel} allEquipSlots=${allEquipSlots} />

      <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style=${{ display: 'flex', gap: 'var(--space-5)', fontSize: '12px', paddingBottom: 'var(--space-2)', borderBottom: '2px solid var(--color-divider)' }}>
          <span>인벤토리 <strong>${deckSize}</strong>/${capacity}</span>
        </div>
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
  `;
}
