import { html } from '../lib.js';
import { CARD_DEFINITIONS } from '../data/cards.js';

// Lists the cards a piece of equipment (weapon/top/bottom/module) adds to the deck, with each
// card's own description — used by both the warehouse item grid and the equip-slot tooltips.
export function EquipmentTooltipContent({ name, cardList }) {
  return html`
    <div>
      <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px', marginBottom: '8px' }}>${name}</div>
      ${cardList.map((entry) => {
        const def = CARD_DEFINITIONS[entry.defId];
        return html`
          <div key=${entry.defId} style=${{ marginBottom: '6px' }}>
            <div style=${{ fontSize: '11px', fontWeight: 700 }}>${def.name}${entry.count > 1 ? ` ×${entry.count}` : ''}</div>
            <div style=${{ fontSize: '11px', opacity: 0.8 }}>${def.description}</div>
          </div>
        `;
      })}
    </div>
  `;
}
