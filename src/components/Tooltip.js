import { html, useState } from '../lib.js';

// Generic hover-triggered floating detail panel. Wrap any element; the tooltip appears above
// it on hover. Not used for drag sources' own drag handling — mouseenter/leave don't interfere
// with native HTML5 drag events fired on the wrapped child.
export function Tooltip({ content, width = 220, children }) {
  const [visible, setVisible] = useState(false);
  return html`
    <div
      style=${{ position: 'relative', display: 'inline-block' }}
      onMouseEnter=${() => setVisible(true)}
      onMouseLeave=${() => setVisible(false)}
    >
      ${children}
      ${visible ? html`
        <div style=${{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: '8px', width: `${width}px`, background: 'var(--color-neutral-900)',
          color: 'var(--color-bg)', padding: '10px 12px', fontSize: '11px', lineHeight: 1.5,
          zIndex: 50, boxShadow: 'var(--shadow-lg)', pointerEvents: 'none',
        }}>${content}</div>
      ` : null}
    </div>
  `;
}
