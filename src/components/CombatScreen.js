import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal, combatAnimationSignal, combatPlaybackDurationSignal } from '../state/runState.js';
import { combatStateSignal, handSignal, enemiesSignal, playerCombatSignal, pileCountsSignal, overloadStageSignal, ammoMaxSignal } from '../state/combatStateAdapter.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { isCardPlayable, getCardTargetKind } from '../engine/combatEngine.js';
import { PlayerStatusBar } from './PlayerStatusBar.js';
import { EnemyRow } from './EnemyRow.js';
import { Hand } from './Hand.js';
import { DrawPileBox, DiscardPileBox } from './PileCounts.js';
import { EndTurnButton } from './EndTurnButton.js';
import { TargetingOverlay } from './TargetingOverlay.js';
import { HistoryControls } from './HistoryControls.js';
import { PlayLog } from './PlayLog.js';
import { InventoryPopup } from './InventoryPopup.js';
import { PileListPopup } from './PileListPopup.js';

export function CombatScreen() {
  const [draggingCard, setDraggingCard] = useState(null);
  const [showInventory, setShowInventory] = useState(false);
  const [openPile, setOpenPile] = useState(null); // null | 'draw' | 'discard'
  const combat = combatStateSignal.value;
  const animation = combatAnimationSignal.value;
  const playbackDuration = combatPlaybackDurationSignal.value;
  if (!combat) return null;

  const hand = handSignal.value;
  const enemies = enemiesSignal.value;
  const player = playerCombatSignal.value;
  const pileCounts = pileCountsSignal.value;
  const ammoMax = ammoMaxSignal.value;
  const stage = overloadStageSignal.value;
  const consumableSlots = snapshotSignal.value.playerState.loadout.consumableSlots;

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
      style=${{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--space-6) var(--space-8)', gap: 'var(--space-4)', '--combat-step-ms': `${playbackDuration}ms` }}
      onDragOver=${(e) => e.preventDefault()}
      onDrop=${handleDropAnywhere}
    >
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <h3 style=${{ margin: 0 }}>전투 — ${enemyNames}</h3>
          <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 10px' }} onClick=${() => setShowInventory(true)}>인벤토리</button>
          <label style=${{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px' }}>
            <span>연출</span>
            <select value=${String(playbackDuration)} onChange=${(e) => { combatPlaybackDurationSignal.value = Number(e.currentTarget.value); }}>
              <option value="250">빠르게</option>
              <option value="400">보통-</option>
              <option value="600">보통</option>
              <option value="900">느리게</option>
              <option value="1200">매우 느리게</option>
            </select>
          </label>
        </div>
        <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-2) var(--space-3)', width: '280px', fontSize: '11px' }}>
          <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span class="tag tag-outline">DEBUG · 디버그</span>
            <${HistoryControls} />
          </div>
          <${PlayLog} />
        </div>
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-4)', justifyContent: 'center', alignItems: 'stretch' }}>
        <${PlayerStatusBar} player=${player} overload=${combat.overload} overloadFloor=${combat.overloadFloor} ammoMax=${ammoMax} animation=${animation?.actor === 'player' ? animation : null} />
        <div style=${{ width: '2px', background: 'var(--color-divider)', alignSelf: 'stretch' }}></div>
        <div style=${{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          ${enemies.map((enemy) => html`
            <${EnemyRow}
              key=${enemy.id}
              enemy=${enemy}
              targetable=${needsEnemyTarget && (targetKind !== 'machine_enemy' || enemy.isMachine)}
              onDrop=${handleDropOnEnemy}
              playerVulnerable=${!!player.statuses.vulnerable}
              animation=${animation?.actor === 'enemy' && animation.actorId === enemy.id ? animation : null}
            />
          `)}
        </div>
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        ${consumableSlots.filter(Boolean).map((item) => {
          const def = CONSUMABLE_DEFINITIONS[item.defId];
          return html`
            <button
              key=${item.id} class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 10px' }}
              onClick=${() => dispatch({ type: 'USE_CONSUMABLE', itemId: item.id })}
            >${def.name}</button>
          `;
        })}
      </div>

      <div class="hr" style=${{ margin: 0 }}></div>

      <div style=${{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 'var(--space-3)', flex: 1 }}>
        <${TargetingOverlay} active=${needsEnemyTarget} />
        <div style=${{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', justifyContent: 'center' }}>
          <${DrawPileBox} count=${pileCounts.draw} onClick=${() => setOpenPile('draw')} />
          <${Hand}
            cards=${hand} playableMap=${playableMap}
            draggingInstanceId=${draggingCard?.instanceId ?? null}
            onCardDragStart=${(card) => setDraggingCard(card)}
            onCardDragEnd=${() => setDraggingCard(null)}
            stage=${stage} overload=${combat.overload} powers=${player.powers}
            inventory=${snapshotSignal.value.playerState.inventory}
          />
          <${DiscardPileBox} count=${pileCounts.discard} exhaustCount=${pileCounts.exhaust} onClick=${() => setOpenPile('discard')} />
        </div>
        <${EndTurnButton} disabled=${combat.phase !== 'player_turn'} />
      </div>

      ${showInventory ? html`<${InventoryPopup} onClose=${() => setShowInventory(false)} />` : null}
      ${openPile === 'draw' ? html`<${PileListPopup} title="뽑을 카드" cards=${combat.piles.drawPile} onClose=${() => setOpenPile(null)} />` : null}
      ${openPile === 'discard' ? html`<${PileListPopup} title="버린 카드" cards=${combat.piles.discardPile} onClose=${() => setOpenPile(null)} />` : null}
    </div>
  `;
}
