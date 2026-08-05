import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { combatStateSignal, handSignal, enemiesSignal, playerCombatSignal, pileCountsSignal, overloadStageSignal } from '../state/combatStateAdapter.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { isCardPlayable, getCardTargetKind } from '../engine/combatEngine.js';
import { PlayerStatusBar } from './PlayerStatusBar.js';
import { EnemyRow } from './EnemyRow.js';
import { Hand } from './Hand.js';
import { EndTurnButton } from './EndTurnButton.js';
import { TargetingOverlay } from './TargetingOverlay.js';
import { HistoryControls } from './HistoryControls.js';
import { PlayLog } from './PlayLog.js';
import { InventoryPopup } from './InventoryPopup.js';

export function CombatScreen() {
  const [draggingCard, setDraggingCard] = useState(null);
  const [showInventory, setShowInventory] = useState(false);
  const combat = combatStateSignal.value;
  if (!combat) return null;

  const hand = handSignal.value;
  const enemies = enemiesSignal.value;
  const player = playerCombatSignal.value;
  const pileCounts = pileCountsSignal.value;
  const stage = overloadStageSignal.value;
  const consumables = snapshotSignal.value.playerState.loadout.consumables;

  const playableMap = {};
  for (const card of hand) playableMap[card.instanceId] = isCardPlayable(combat, card.instanceId);

  const draggingDef = draggingCard ? CARD_DEFINITIONS[draggingCard.defId] : null;
  const targetKind = draggingDef ? getCardTargetKind(draggingDef) : 'none';
  const needsEnemyTarget = targetKind === 'enemy' || targetKind === 'machine_enemy';

  function handleDropAnywhere(e) {
    if (!draggingCard) return;
    e.preventDefault();
    if (!needsEnemyTarget) {
      dispatch({ type: 'PLAY_CARD', instanceId: draggingCard.instanceId, targetId: null });
    }
    setDraggingCard(null);
  }

  function handleDropOnEnemy(enemy) {
    if (!draggingCard) return;
    if (targetKind === 'machine_enemy' && !enemy.isMachine) { setDraggingCard(null); return; }
    dispatch({ type: 'PLAY_CARD', instanceId: draggingCard.instanceId, targetId: enemy.id });
    setDraggingCard(null);
  }

  const enemyNames = [...new Set(enemies.map((e) => e.name))].join(', ');

  return html`
    <div
      style=${{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--space-6) var(--space-8)', gap: 'var(--space-4)' }}
      onDragOver=${(e) => e.preventDefault()}
      onDrop=${handleDropAnywhere}
    >
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <h3 style=${{ margin: 0 }}>전투 — ${enemyNames}</h3>
          <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 10px' }} onClick=${() => setShowInventory(true)}>인벤토리</button>
        </div>
        <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-2) var(--space-3)', width: '280px', fontSize: '11px' }}>
          <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span class="tag tag-outline">DEBUG · 디버그</span>
            <${HistoryControls} />
          </div>
          <${PlayLog} />
        </div>
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-4)', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <${PlayerStatusBar} player=${player} overload=${combat.overload} overloadFloor=${combat.overloadFloor} pileCounts=${pileCounts} />
        <div style=${{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          ${enemies.map((enemy) => html`
            <${EnemyRow}
              key=${enemy.id}
              enemy=${enemy}
              targetable=${needsEnemyTarget && (targetKind !== 'machine_enemy' || enemy.isMachine)}
              onDrop=${handleDropOnEnemy}
            />
          `)}
        </div>
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        ${consumables.map((c) => {
          const def = CONSUMABLE_DEFINITIONS[c.defId];
          return html`
            <button
              key=${c.defId} class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 10px' }}
              onClick=${() => dispatch({ type: 'USE_CONSUMABLE', defId: c.defId })}
            >${def.name} ×${c.count}</button>
          `;
        })}
      </div>

      <div class="hr" style=${{ margin: 0 }}></div>

      <div style=${{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 'var(--space-3)', flex: 1 }}>
        <${TargetingOverlay} active=${needsEnemyTarget} />
        <${Hand}
          cards=${hand} playableMap=${playableMap}
          draggingInstanceId=${draggingCard?.instanceId ?? null}
          onCardDragStart=${(card) => setDraggingCard(card)}
          onCardDragEnd=${() => setDraggingCard(null)}
          stage=${stage} overload=${combat.overload} powers=${player.powers}
        />
        <${EndTurnButton} disabled=${combat.phase !== 'player_turn'} />
      </div>

      ${showInventory ? html`<${InventoryPopup} onClose=${() => setShowInventory(false)} />` : null}
    </div>
  `;
}
