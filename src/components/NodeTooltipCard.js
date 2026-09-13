// 노드 하나를 읽는 카드 — 지도 호버 툴팁과 "선택 노드" 패널이 같은 컴포넌트를 쓴다.
// 설계는 게임 UI 목업 디자인/node-tooltip(Main.dc.html · States.dc.html)을 그대로 따른다.
//
// 한 줄로 ' — '를 끼워 이어 붙인 예전 문장은 길어질수록 무엇이 위협이고 무엇이 전리품인지
// 눈으로 가를 수 없었다. 그래서 머리(유형·구역·지식 상태) → 행(위협 / 현장 기회 / 장치 /
// 흔적 / 은신) → 꼬리(정찰·조작 힌트)로 나누고, 행마다 아이콘 + 굵은 한 줄 + 보조 한 줄을
// 둔다. 없는 행은 그리지 않는다.
//
// 내용(무엇을 말할 것인가)은 MapScreen.describeNode가 정하고, 이 파일은 그리기만 한다.
import { html } from '../lib.js';

/** 행 종류별 14px 스트로크 아이콘. 모양이 곧 의미다 — 삼각형은 위협, 마름모는 확보 대상,
 * 원은 보급품, 격자는 장치, 빗금은 흔적, 방패는 은신, 문은 탈출구. */
const ICONS = {
  threat: html`<path d="M8 2 L14.5 13.5 L1.5 13.5 Z"></path>`,
  prize: html`<path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z"></path>`,
  supply: html`<circle cx="8" cy="8" r="5.5"></circle>`,
  device: html`<rect x="2" y="3.5" width="12" height="9"></rect><path d="M2 7.5 H14 M6 3.5 V12.5"></path>`,
  trace: html`<path d="M3 12.5 L6 5 M8 12.5 L11 5 M5 9 H12"></path>`,
  stealth: html`<path d="M8 1.8 L13.5 4 V8.5 C13.5 11.4 11 13.5 8 14.4 C5 13.5 2.5 11.4 2.5 8.5 V4 Z"></path>`,
  exit: html`<path d="M3 2.5 H10 V13.5 H3 Z"></path><path d="M12.5 8 H7.5 M9.5 5.8 L7.2 8 L9.5 10.2"></path>`,
};

/** 행 색조 — 토큰만 쓴다(디자인 토큰 밖의 색을 여기서 만들면 화면마다 위협의 색이 달라진다). */
const TONE_COLORS = {
  threat: 'var(--color-accent-2-400)',
  trace: 'var(--color-accent-2-300)',
  muted: 'var(--color-neutral-400)',
  plain: 'var(--color-bg)',
};

/** 지식 상태 배지의 색. 실시간만 밝게 튄다 — 나머지는 "지금 보고 있는 것이 아니다"를 말한다. */
function badgeStyle(knowledge, debug) {
  if (debug) return { background: 'var(--color-accent-2-700)', color: 'var(--color-bg)' };
  if (knowledge === 'current' || knowledge === 'fresh') return { background: 'var(--color-accent-2-500)', color: 'var(--color-neutral-900)' };
  if (knowledge === 'stale') return { background: 'var(--color-neutral-500)', color: 'var(--color-neutral-900)' };
  return { background: 'var(--color-neutral-700)', color: 'var(--color-bg)' };
}

function Icon({ name, color }) {
  return html`
    <div style=${{ width: '14px', height: '14px', flexShrink: 0, marginTop: '1px', display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        ${ICONS[name] || ICONS.supply}
      </svg>
    </div>
  `;
}

function Row({ row }) {
  const color = TONE_COLORS[row.tone] || TONE_COLORS.plain;
  return html`
    <div style=${{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
      <${Icon} name=${row.icon || row.kind} color=${color} />
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '1px', flexGrow: 1, minWidth: 0 }}>
        ${row.title ? html`<div style=${{ fontSize: '11px', fontWeight: 800, color }}>${row.title}</div>` : null}
        ${row.detail ? html`<div style=${{ fontSize: '10px', color: 'var(--color-neutral-300)', lineHeight: 1.45 }}>${row.detail}</div>` : null}
        ${(row.debugLines || []).length > 0 ? html`
          <div style=${{ fontSize: '10px', color: 'var(--color-neutral-300)', lineHeight: 1.45, fontFamily: 'ui-monospace, monospace' }}>
            ${row.debugLines.map((line) => html`<div key=${line}>${line}</div>`)}
          </div>
        ` : null}
        ${(row.chips || []).length > 0 ? html`
          <div style=${{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '1px' }}>
            ${row.chips.map((chip) => html`
              <span key=${chip.label} style=${{
    fontSize: '10px', padding: '1px 6px',
    border: `1px solid ${chip.tone === 'threat' ? 'var(--color-accent-2-400)' : 'var(--color-neutral-500)'}`,
    color: chip.tone === 'threat' ? 'var(--color-accent-2-400)' : 'var(--color-neutral-300)',
  }}>${chip.label}</span>
            `)}
          </div>
        ` : null}
      </div>
    </div>
  `;
}

/**
 * @param {{description: any, text?: string, hint?: string|null, width?: number}} props
 *   description은 MapScreen.describeNode의 구조화된 결과, text는 그것을 한 문장으로 이은 사본
 *   (describeNodeText — 보조 기술·렌더 테스트용), hint는 꼬리 오른쪽의 조작 안내("클릭해 선택").
 */
export function NodeTooltipCard({ description, text = '', hint = null, width = 300 }) {
  const { header, rows, footer } = description;
  const sectorLine = [header.sectorName, header.landmark].filter(Boolean);
  return html`
    <div style=${{
    width: `${width}px`, background: 'var(--color-neutral-900)', color: 'var(--color-bg)',
    display: 'flex', flexDirection: 'column',
    border: header.debug ? '1px solid var(--color-accent-2-700)' : 'none',
  }}>
      ${/* 문자열 사본은 보이지 않게 항상 둔다 — Tooltip.js와 같은 이유로, 렌더 테스트와 보조
          기술이 카드의 내용을 같은 문장으로 읽을 수 있어야 한다. */ null}
      <span style=${{ display: 'none' }}>${text}</span>

      <div style=${{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px', borderBottom: '1px solid rgba(243,242,242,0.18)' }}>
        <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style=${{ fontSize: '12px', fontWeight: 800, letterSpacing: '-0.01em' }}>
            ${header.typeLabel}${header.gatewayLabel ? html` <span style=${{ fontWeight: 400, color: 'var(--color-neutral-400)' }}>· ${header.gatewayLabel}</span>` : null}
          </div>
          <div style=${{
    fontSize: '9px', fontWeight: 800, letterSpacing: '0.06em', padding: '2px 6px', whiteSpace: 'nowrap',
    ...badgeStyle(header.knowledge, header.debug),
  }}>${header.debug ? 'DEBUG' : header.knowledgeLabel}</div>
        </div>
        <div style=${{ fontSize: '10px', color: 'var(--color-neutral-400)' }}>
          ${sectorLine.join(' · ')}${header.isObjective ? html` <span style=${{ color: 'var(--color-accent-2-400)', fontWeight: 600 }}>계약 목표부</span>` : null}
          ${header.debug ? ` · 실제 지식: ${header.knowledgeLabel}` : null}
        </div>
      </div>

      ${rows.length > 0 ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', padding: '6px 10px 8px', gap: '6px' }}>
          ${rows.map((row, index) => html`<${Row} key=${`${row.kind}:${index}`} row=${row} />`)}
        </div>
      ` : html`
        <div style=${{ padding: '8px 10px', fontSize: '10px', color: 'var(--color-neutral-400)', lineHeight: 1.45 }}>
          ${header.emptyNote || '아직 확인한 것이 없다.'}
        </div>
      `}

      ${(footer.length > 0 || hint) ? html`
        <div style=${{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
    padding: '6px 10px', borderTop: '1px solid rgba(243,242,242,0.18)',
    fontSize: '10px', color: 'var(--color-neutral-400)',
  }}>
          <span>${footer.join(' · ')}</span>
          ${hint ? html`<span>${hint}</span>` : null}
        </div>
      ` : null}
    </div>
  `;
}
