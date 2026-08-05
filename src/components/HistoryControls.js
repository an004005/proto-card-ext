import { html, useEffect } from '../lib.js';
import { undo, redo, canUndo, canRedo } from '../state/dispatch.js';

export function HistoryControls() {
  useEffect(() => {
    function onKeyDown(e) {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return html`
    <div style=${{ display: 'flex', gap: '6px' }}>
      <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '2px 8px' }} disabled=${!canUndo()} onClick=${undo}>← Undo</button>
      <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '2px 8px' }} disabled=${!canRedo()} onClick=${redo}>Redo →</button>
    </div>
  `;
}
