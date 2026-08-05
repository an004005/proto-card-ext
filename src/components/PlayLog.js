import { html } from '../lib.js';
import { historySignal } from '../state/runState.js';

export function PlayLog() {
  const history = historySignal.value;
  const visible = history.entries.slice(-8);
  return html`
    <div style=${{ maxHeight: '80px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', fontFamily: 'ui-monospace, monospace', fontSize: '11px' }}>
      ${visible.map((entry) => {
        const isFuture = entry.id > history.cursor;
        const isCurrent = entry.id === history.cursor;
        return html`
          <div key=${entry.id} style=${{ opacity: isFuture ? 0.4 : 1, borderLeft: `2px solid ${isCurrent ? 'var(--color-accent)' : 'var(--color-divider)'}`, paddingLeft: '6px' }}>
            #${entry.id} ${entry.summary}
          </div>
        `;
      })}
    </div>
  `;
}
