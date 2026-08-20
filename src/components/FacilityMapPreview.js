// Standalone preview/dev screen for the 48-node extraction map (docs/extraction-map-implementation-spec.md
// §10). Deliberately NOT wired into state/dispatch.js or gameReducer.js — it drives
// facilityGraph.js/runEngine.js directly from local component state. The real map screen swap
// happens once field actions (§6, phase 4) and combat hookup (§9, phase 5) exist; until then this
// is how the graph/time/threat engine gets eyeballed and clicked through in a browser.
//
// Reached via the #facility URL hash (see App.js) so the live game is completely unaffected.

import { html, useState } from '../lib.js';
import { generateFacilityGraph } from '../engine/facilityGraph.js';
import { createRunState, advanceTime, moveToAdjacentNode, requestExtraction } from '../engine/runEngine.js';
import { SECTOR_IDS, SECTOR_NAMES, NODES_PER_SECTOR, RUN_COLLAPSE_TIME } from '../data/facilityLayout.js';

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 700;
const QUADRANT_CENTERS = {
  entrance: { x: 240, y: 190 },
  labs: { x: 660, y: 190 },
  security: { x: 240, y: 510 },
  power: { x: 660, y: 510 },
};
const SECTOR_RADIUS = 150;
const NODE_RADIUS = 12;

function layoutPositions(graph) {
  const positions = {};
  for (const node of graph.nodes) {
    const localIndex = Number(node.id.slice(node.sectorId.length + 1));
    const center = QUADRANT_CENTERS[node.sectorId];
    const angle = (localIndex / NODES_PER_SECTOR) * Math.PI * 2 - Math.PI / 2;
    positions[node.id] = { x: center.x + Math.cos(angle) * SECTOR_RADIUS, y: center.y + Math.sin(angle) * SECTOR_RADIUS };
  }
  return positions;
}

/** §10.2 탐사 안개: 현재 노드/인접 노드는 선명, 방문 노드는 흐리게, 그 외는 숨김. */
function nodeVisibility(state, nodeId) {
  if (state.playerNodeId === nodeId) return 'current';
  const adjacency = state.graph.edges.some(
    (e) => (e.from === state.playerNodeId && e.to === nodeId) || (e.to === state.playerNodeId && e.from === nodeId),
  );
  if (adjacency) return 'adjacent';
  if (state.visitedNodeIds.includes(nodeId)) return 'visited';
  return 'hidden';
}

function nodeFill(visibility, hasThreat, isExit) {
  if (isExit) return 'var(--color-accent)';
  if (visibility === 'current') return 'var(--color-accent-2-700)';
  if (visibility === 'adjacent') return hasThreat ? 'var(--color-negative, #dd2b0f)' : 'var(--color-bg)';
  if (visibility === 'visited') return 'var(--color-neutral-500)';
  return 'var(--color-neutral-300)';
}

function exitStatusLabel(exit) {
  if (exit.kind === 'key') return '열쇠';
  const labels = { closed: '닫힘', requesting: '요청 중', opening: '개방 대기', open: '열림', disabled: '비활성' };
  return labels[exit.status];
}

export function FacilityMapPreview() {
  const [seed, setSeed] = useState(1);
  const [state, setState] = useState(() => {
    const { graph } = generateFacilityGraph(seed);
    return createRunState(graph, seed);
  });
  const [log, setLog] = useState([]);
  const [hackingLevel, setHackingLevel] = useState(0);

  const pushLog = (message) => setLog((prev) => [message, ...prev].slice(0, 12));

  const regenerate = (nextSeed) => {
    const { graph } = generateFacilityGraph(nextSeed);
    setState(createRunState(graph, nextSeed));
    setSeed(nextSeed);
    setLog([]);
  };

  const positions = layoutPositions(state.graph);
  const threatsByNode = {};
  for (const threat of Object.values(state.threats)) (threatsByNode[threat.nodeId] ||= []).push(threat);
  const exitByNode = {};
  for (const exit of Object.values(state.exits)) exitByNode[exit.nodeId] = exit;

  const currentSectorId = state.graph.nodes.find((n) => n.id === state.playerNodeId)?.sectorId;
  const currentSectorAlert = currentSectorId ? state.sectorAlerts[currentSectorId] : null;

  const handleNodeClick = (nodeId) => {
    if (state.phase !== 'active') return;
    const visibility = nodeVisibility(state, nodeId);
    if (visibility !== 'adjacent') return;
    try {
      const next = moveToAdjacentNode(state, nodeId);
      setState(next);
      if (next.combatTrigger) pushLog(`⚔ 위협 ${next.combatTrigger.threatId}과(와) ${next.combatTrigger.nodeId}에서 조우 (전투 연동은 5단계)`);
      else pushLog(`이동 -> ${nodeId} (t=${next.time})`);
    } catch (err) {
      pushLog(`이동 실패: ${err.message}`);
    }
  };

  const handleRequestExit = (exitId) => {
    try {
      const next = requestExtraction(state, exitId, hackingLevel);
      setState(next);
      pushLog(`탈출구 ${exitId} 요청 (Hacking ${hackingLevel})`);
    } catch (err) {
      pushLog(`요청 실패: ${err.message}`);
    }
  };

  const currentExit = exitByNode[state.playerNodeId];

  return html`
    <div style=${{ padding: 'var(--space-6) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid var(--color-divider)', paddingBottom: 'var(--space-3)' }}>
        <h2 style=${{ margin: 0 }}>48노드 익스트랙션 맵 — 미리보기 (개발용, #facility)</h2>
        <div style=${{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', fontSize: '13px' }}>
          <label>seed <input type="number" value=${seed} style=${{ width: '70px' }} onChange=${(e) => setSeed(Number(e.target.value))} /></label>
          <button class="btn btn-secondary" onClick=${() => regenerate(seed)}>새 런 생성</button>
        </div>
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-6)', fontSize: '13px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span>시간 <strong>${state.time}</strong> / ${RUN_COLLAPSE_TIME} ${state.phase === 'collapsed' ? '— 시설 붕괴' : ''}</span>
        <span>현재 구역 <strong>${currentSectorId ? SECTOR_NAMES[currentSectorId] : '-'}</strong> 경계 ${currentSectorAlert ? currentSectorAlert.level : '-'}</span>
        ${['A', 'B'].map((exitId) => html`<span key=${exitId}>${exitId} <strong>${exitStatusLabel(state.exits[exitId])}</strong></span>`)}
        <span>열쇠 탈출구 <strong>${state.exits.key ? '알려짐' : '-'}</strong></span>
        <label>요청 시 Hacking
          <select value=${hackingLevel} onChange=${(e) => setHackingLevel(Number(e.target.value))}>
            ${[-2, -1, 0, 1, 2, 3, 4].map((v) => html`<option key=${v} value=${v}>${v}</option>`)}
          </select>
        </label>
      </div>

      ${currentExit && currentExit.kind === 'standard' && currentExit.status === 'closed' && state.phase === 'active'
        ? html`<button class="btn btn-primary" style=${{ width: 'fit-content' }} onClick=${() => handleRequestExit(currentExit.exitId)}>탈출구 ${currentExit.exitId} 개방 요청</button>`
        : null}

      <div style=${{ display: 'flex', gap: 'var(--space-4)' }}>
        <svg width=${CANVAS_WIDTH} height=${CANVAS_HEIGHT} style=${{ background: 'var(--color-bg-alt, #14100f)', flexShrink: 0 }}>
          <g stroke="var(--color-divider)" stroke-width="1" opacity="0.6">
            ${state.graph.edges.map((e) => {
              const from = positions[e.from]; const to = positions[e.to];
              const fromVis = nodeVisibility(state, e.from);
              const toVis = nodeVisibility(state, e.to);
              if (fromVis === 'hidden' && toVis === 'hidden') return null;
              const dashed = e.features.length > 0;
              return html`<line key=${e.id} x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} stroke-dasharray=${dashed ? '4 3' : undefined}></line>`;
            })}
          </g>
          ${state.graph.nodes.map((n) => {
            const visibility = nodeVisibility(state, n.id);
            if (visibility === 'hidden') return null;
            const pos = positions[n.id];
            const threatsHere = threatsByNode[n.id] || [];
            const exit = exitByNode[n.id];
            const clickable = visibility === 'adjacent';
            return html`
              <g key=${n.id} style=${{ cursor: clickable ? 'pointer' : 'default' }} onClick=${() => handleNodeClick(n.id)}>
                <circle cx=${pos.x} cy=${pos.y} r=${exit ? NODE_RADIUS + 4 : NODE_RADIUS} fill=${nodeFill(visibility, threatsHere.length > 0, !!exit)} stroke="var(--color-divider)" stroke-width="1.5" opacity=${visibility === 'visited' ? 0.5 : 1}></circle>
                ${exit ? html`<text x=${pos.x} y=${pos.y + 4} text-anchor="middle" font-size="9" font-weight="800" fill="var(--color-bg)">${exit.kind === 'key' ? 'K' : exit.exitId}</text>` : null}
                ${threatsHere.length > 0 && visibility !== 'hidden' ? html`<text x=${pos.x} y=${pos.y - NODE_RADIUS - 6} text-anchor="middle" font-size="10" fill="var(--color-accent-2-700, #dd2b0f)">▲${threatsHere.length}</text>` : null}
              </g>
            `;
          })}
        </svg>

        <div style=${{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: '12px', minWidth: '260px' }}>
          <h4 style=${{ margin: 0 }}>구역 경계도</h4>
          ${SECTOR_IDS.map((sectorId) => html`<div key=${sectorId}>${SECTOR_NAMES[sectorId]}: ${state.sectorAlerts[sectorId].level}</div>`)}
          <h4 style=${{ margin: '12px 0 0' }}>로그</h4>
          <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            ${log.map((line, i) => html`<div key=${i}>${line}</div>`)}
          </div>
        </div>
      </div>
    </div>
  `;
}
