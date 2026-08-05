import { html, useState, useRef, useLayoutEffect } from '../lib.js';

// Generic hover-triggered floating detail panel. Wrap any element; the tooltip appears above
// it on hover, nudged horizontally (and flipped below if too close to the top) so it never
// spills past the viewport edge. Not used for drag sources' own drag handling — mouseenter/
// leave don't interfere with native HTML5 drag events fired on the wrapped child.
export function Tooltip({ content, width = 220, children }) {
  const [visible, setVisible] = useState(false);
  const boxRef = useRef(null);
  const [adjust, setAdjust] = useState({ x: 0, flip: false });

  useLayoutEffect(() => {
    if (!visible || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    const margin = 8;
    let x = 0;
    if (rect.left < margin) x = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) x = (window.innerWidth - margin) - rect.right;
    setAdjust({ x, flip: rect.top < margin });
  }, [visible]);

  return html`
    <div
      style=${{ position: 'relative', display: 'inline-block' }}
      onMouseEnter=${() => setVisible(true)}
      onMouseLeave=${() => setVisible(false)}
    >
      ${children}
      ${visible ? html`
        <div ref=${boxRef} style=${{
          position: 'absolute', left: '50%',
          [adjust.flip ? 'top' : 'bottom']: '100%',
          [adjust.flip ? 'marginTop' : 'marginBottom']: '8px',
          transform: `translateX(calc(-50% + ${adjust.x}px))`,
          width: `${width}px`, background: 'var(--color-neutral-900)',
          color: 'var(--color-bg)', padding: '10px 12px', fontSize: '11px', lineHeight: 1.5,
          zIndex: 50, boxShadow: 'var(--shadow-lg)', pointerEvents: 'none',
        }}>${content}</div>
      ` : null}
    </div>
  `;
}
