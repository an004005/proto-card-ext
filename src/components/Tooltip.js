import { html, useState, useRef, useLayoutEffect } from '../lib.js';

// Generic hover-triggered floating detail panel. Wrap any element; the tooltip appears above
// it on hover, nudged horizontally (and flipped below if too close to the top) so it never
// spills past the viewport edge. Not used for drag sources' own drag handling — mouseenter/
// leave don't interfere with native HTML5 drag events fired on the wrapped child.
//
// Positioned with position:fixed from the trigger's real getBoundingClientRect(), not
// position:absolute relative to the trigger — an absolutely-positioned box is clipped by the
// nearest ancestor that scrolls (overflowY:auto), and CSS silently forces that ancestor's
// overflowX to auto too (the paired overflow-value quirk) the moment overflowY isn't visible,
// so a centered tooltip on a full-width trigger near that ancestor's edge gets cut off instead
// of spilling out. Fixed positioning escapes every ancestor's clipping/stacking context (short
// of a CSS transform on one, which none of this app's scroll containers use), so this is the
// one fix that holds for every call site — the side panel, modal popups, anywhere.
// align="left": anchor the box to the trigger's left edge instead of centering on it — still
// useful when the trigger fills a narrow column and a centered box would read oddly, even
// though clipping itself is no longer the reason to reach for it.
// 키보드로도 열린다 — 마우스를 올려야만 보이는 정보는 탭으로 버튼을 훑는 사람에게는 없는
// 정보다. Esc로 닫는 것도 같은 이유다(포커스를 옮기지 않고 가릴 방법이 있어야 한다).
export function Tooltip({ content, width = 220, align = 'center', children }) {
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef(null);
  const boxRef = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    if (!visible || !wrapRef.current) return;
    const margin = 8;
    const wrapRect = wrapRef.current.getBoundingClientRect();
    const boxHeight = boxRef.current ? boxRef.current.getBoundingClientRect().height : 0;

    let left = align === 'left' ? wrapRect.left : wrapRect.left + wrapRect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));

    const spaceAbove = wrapRect.top - margin;
    const flip = spaceAbove < boxHeight + 8; // 위쪽 공간이 모자라면 아래로.
    const top = flip ? wrapRect.bottom + 8 : Math.max(margin, wrapRect.top - 8 - boxHeight);

    setPos({ left, top });
  }, [visible, align, width, content]);

  return html`
    <div
      ref=${wrapRef}
      style=${{ position: 'relative', display: 'inline-block' }}
      onMouseEnter=${() => setVisible(true)}
      onMouseLeave=${() => setVisible(false)}
      onFocusCapture=${() => setVisible(true)}
      onBlurCapture=${() => setVisible(false)}
      onKeyDown=${(ev) => { if (ev.key === 'Escape') setVisible(false); }}
    >
      ${children}
      ${/* 문자열 설명은 보이지 않는 사본으로도 항상 DOM에 둔다. 렌더 테스트가 툴팁 본문의
          단위 표기를 검사할 수 있게 하고(그 전에는 hover 없이는 아무 글자도 없었다), 보조
          기술도 같은 문장을 읽는다. */ null}
      ${typeof content === 'string' ? html`<span style=${{ display: 'none' }}>${content}</span>` : null}
      ${visible ? html`
        <div ref=${boxRef} style=${{
          position: 'fixed', left: `${pos.left}px`, top: `${pos.top}px`,
          width: `${width}px`, background: 'var(--color-neutral-900)',
          color: 'var(--color-bg)', padding: '10px 12px', fontSize: '11px', lineHeight: 1.5,
          zIndex: 200, boxShadow: 'var(--shadow-lg)', pointerEvents: 'none',
        }}>${content}</div>
      ` : null}
    </div>
  `;
}
