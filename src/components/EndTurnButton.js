import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';

export function EndTurnButton({ disabled }) {
  return html`
    <div style=${{ display: 'flex', justifyContent: 'center' }}>
      <button
        class="btn btn-primary" style=${{ padding: '12px 40px', fontSize: '15px' }}
        disabled=${disabled}
        onClick=${() => dispatch({ type: 'END_TURN' })}
      >턴 종료</button>
    </div>
  `;
}
