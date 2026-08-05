import { html } from '../lib.js';
import { Card } from './Card.js';

export function Hand({ cards, playableMap, draggingInstanceId, onCardDragStart, onCardDragEnd, stage, overload, powers }) {
  return html`
    <div style=${{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap' }}>
      ${cards.map((card) => html`
        <${Card}
          key=${card.instanceId}
          card=${card}
          playable=${playableMap[card.instanceId]}
          armed=${draggingInstanceId === card.instanceId}
          draggable=${true}
          stage=${stage}
          overload=${overload}
          powers=${powers}
          onDragStart=${() => onCardDragStart(card)}
          onDragEnd=${onCardDragEnd}
        />
      `)}
    </div>
  `;
}
