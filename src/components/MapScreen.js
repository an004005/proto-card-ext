import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { getAvailableNodeIds } from '../engine/mapEngine.js';
import { computeFloorOverload } from '../engine/equipmentEngine.js';
import { getDeckEntries } from '../engine/gameReducer.js';
import { getBurdenItems } from '../engine/inventoryEngine.js';
import { MAP_FLOOR_COUNT } from '../data/mapLayout.js';
import { OverloadGauge } from './OverloadGauge.js';
import { InventoryPopup } from './InventoryPopup.js';

const NODE_TYPE_LABEL = { combat: '', elite: 'EL', rest: '휴', unknown: '?', boss: 'BOSS' };
const NODE_SIZE = 40;
const SVG_WIDTH = 480;
const FLOOR_ROW_HEIGHT = 110;

function layoutNodes(mapData) {
  const floors = {};
  for (const n of mapData.nodes) {
    (floors[n.floor] ||= []).push(n);
  }
  const positioned = {};
  for (const floorStr of Object.keys(floors)) {
    const floor = Number(floorStr);
    const nodesInFloor = floors[floor];
    const y = (MAP_FLOOR_COUNT - floor) * FLOOR_ROW_HEIGHT + 60;
    const spacing = SVG_WIDTH / (nodesInFloor.length + 1);
    nodesInFloor.forEach((n, i) => { positioned[n.id] = { x: spacing * (i + 1), y }; });
  }
  return { positioned, height: (MAP_FLOOR_COUNT - 1) * FLOOR_ROW_HEIGHT + 120 };
}

function nodeVisualState(node, mapState, availableIds) {
  if (mapState.currentNodeId === node.id) return 'current';
  if (mapState.visitedNodeIds.includes(node.id)) return 'done';
  if (availableIds.includes(node.id)) return 'available';
  return 'unseen';
}

function nodeStyle(node, visual) {
  if (visual === 'done') return { fill: 'var(--color-neutral-600)', stroke: 'var(--color-divider)', strokeW: 2, textColor: 'var(--color-bg)' };
  if (visual === 'current') return { fill: 'var(--color-accent)', stroke: 'var(--color-accent-2-700)', strokeW: 4, textColor: 'var(--color-bg)' };
  if (visual === 'available') return { fill: 'var(--color-bg)', stroke: node.type === 'elite' ? 'var(--color-accent-2-700)' : 'var(--color-accent)', strokeW: 3, textColor: 'var(--color-text)' };
  // unseen
  return { fill: 'var(--color-neutral-300)', stroke: node.type === 'elite' ? 'var(--color-accent-2-700)' : 'var(--color-divider)', strokeW: node.type === 'elite' ? 3 : 2, textColor: 'var(--color-text)' };
}

export function MapScreen() {
  const [showInventory, setShowInventory] = useState(false);
  const snapshot = snapshotSignal.value;
  const ps = snapshot.playerState;
  const mapState = snapshot.mapState;
  if (!mapState) return null;

  const floor = computeFloorOverload(ps.loadout);
  const burdenCount = getBurdenItems(ps.inventory).length;
  const deckSize = getDeckEntries(ps).length;
  const availableIds = getAvailableNodeIds(mapState);
  const { positioned, height } = layoutNodes(mapState.mapData);
  const currentFloor = mapState.currentNodeId
    ? mapState.mapData.nodes.find((n) => n.id === mapState.currentNodeId)?.floor || 1
    : null;

  return html`
    <div style=${{ padding: 'var(--space-6) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid var(--color-divider)', paddingBottom: 'var(--space-3)' }}>
        <h2 style=${{ margin: 0 }}>맵 — ${currentFloor === null ? '출발' : `${currentFloor}층`} / ${MAP_FLOOR_COUNT}층</h2>
        <div style=${{ display: 'flex', gap: 'var(--space-6)', fontSize: '13px', alignItems: 'center' }}>
          <span>HP <strong>${ps.hp}</strong>/${ps.maxHp}</span>
          <span>덱 <strong>${deckSize}</strong>장</span>
          <span>인벤토리 <strong>${ps.inventory.items.length}</strong>/${ps.inventory.capacity}${burdenCount > 0 ? ` (짐 ${burdenCount})` : ''}</span>
          <button class="btn btn-secondary" style=${{ fontSize: '12px', padding: '6px 12px' }} onClick=${() => setShowInventory(true)}>인벤토리 / 장비교체</button>
        </div>
      </div>

      <div style=${{ width: '320px' }}>
        <${OverloadGauge} overload=${ps.overload} floor=${floor} />
      </div>

      <div style=${{ padding: 'var(--space-4) 0', display: 'flex', justifyContent: 'center' }}>
        <svg width=${SVG_WIDTH} height=${height} style=${{ display: 'block' }}>
          <g stroke="var(--color-divider)" stroke-width="2">
            ${mapState.mapData.edges.map((e, i) => {
              const from = positioned[e.from]; const to = positioned[e.to];
              if (!from || !to) return null;
              return html`<line key=${i} x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y}></line>`;
            })}
          </g>
          ${mapState.mapData.nodes.map((n) => {
            const pos = positioned[n.id];
            const visual = nodeVisualState(n, mapState, availableIds);
            const style = nodeStyle(n, visual);
            const clickable = visual === 'available';
            return html`
              <g
                key=${n.id}
                style=${{ cursor: clickable ? 'pointer' : 'default' }}
                onClick=${clickable ? () => dispatch({ type: 'ENTER_MAP_NODE', nodeId: n.id }) : undefined}
              >
                <rect x=${pos.x - NODE_SIZE / 2} y=${pos.y - NODE_SIZE / 2} width=${NODE_SIZE} height=${NODE_SIZE} fill=${style.fill} stroke=${style.stroke} stroke-width=${style.strokeW}></rect>
                <text x=${pos.x} y=${pos.y + 4} text-anchor="middle" font-family="Archivo, sans-serif" font-weight="800" font-size="10" fill=${style.textColor}>${NODE_TYPE_LABEL[n.type]}</text>
              </g>
            `;
          })}
        </svg>
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-6)', fontSize: '12px', borderTop: '2px solid var(--color-divider)', paddingTop: 'var(--space-3)' }}>
        <span style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '14px', height: '14px', background: 'var(--color-accent)' }}></span>현재 위치</span>
        <span style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '14px', height: '14px', background: 'var(--color-bg)', border: '2px solid var(--color-accent)' }}></span>이동 가능</span>
        <span style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '14px', height: '14px', background: 'var(--color-neutral-300)', border: '2px solid var(--color-divider)' }}></span>미확인</span>
        <span style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '14px', height: '14px', background: 'var(--color-neutral-600)' }}></span>완료</span>
        <span style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '14px', height: '14px', border: '3px solid var(--color-accent-2-700)' }}></span>엘리트</span>
      </div>

      ${showInventory ? html`<${InventoryPopup} mode="manage" onClose=${() => setShowInventory(false)} />` : null}
    </div>
  `;
}
