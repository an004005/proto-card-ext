import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal, combatAnimationSignal, combatPlaybackDurationSignal, combatPlaybackActiveSignal } from '../state/runState.js';
import { combatStateSignal, handSignal, enemiesSignal, playerCombatSignal, pileCountsSignal, overloadStageSignal } from '../state/combatStateAdapter.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { isCardPlayable, getCardTargetKind } from '../engine/combatEngine.js';
import { canDisengage, DISENGAGE_REQUIRED_PROGRESS, COMBAT_ROUND_TIME_COST } from '../engine/combatMapIntegration.js';
import { runCountdowns } from '../engine/mapTimeline.js';
import { MapClock } from './MapClock.js';
import { Tooltip } from './Tooltip.js';
import { NoiseGauge } from './NoiseGauge.js';
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

/** 전투 중 마감 배너를 띄우는 시간 창(칸). 한 턴이 3칸이니 다섯 턴 남짓이다. */
const COMBAT_DEADLINE_BANNER_WINDOW = 15;

export function CombatScreen() {
  const [draggingCard, setDraggingCard] = useState(null);
  const [showInventory, setShowInventory] = useState(false);
  const [openPile, setOpenPile] = useState(null); // null | 'draw' | 'discard'
  const combat = combatStateSignal.value;
  const animation = combatAnimationSignal.value;
  const playbackDuration = combatPlaybackDurationSignal.value;
  const playbackActive = combatPlaybackActiveSignal.value;
  if (!combat) return null;

  const hand = handSignal.value;
  const enemies = enemiesSignal.value;
  const player = playerCombatSignal.value;
  const pileCounts = pileCountsSignal.value;
  const stage = overloadStageSignal.value;
  const consumableSlots = snapshotSignal.value.playerState.loadout.consumableSlots;
  const combatContext = snapshotSignal.value.combatContext;
  const disengage = combatContext?.disengage;

  const playableMap = {};
  for (const card of hand) playableMap[card.instanceId] = isCardPlayable(combat, card.instanceId);

  const draggingDef = draggingCard ? CARD_DEFINITIONS[draggingCard.defId] : null;
  const targetKind = draggingDef ? getCardTargetKind(draggingDef) : 'none';
  const needsEnemyTarget = targetKind === 'enemy' || targetKind === 'machine_enemy';
  const escapeCards = hand.filter((card) => CARD_DEFINITIONS[card.defId]?.mapTags?.disengageProgress);

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

  // 전투 중에도 맵 시계는 턴마다 흐른다. 같은 시계 블록과 같은 색 규칙을 쓰고, 붕괴나 출구
  // 폐쇄가 눈앞이면 배너로 한 번 더 말한다 — 그 사실을 모르고 두 턴을 더 쓰면 런이 끝난다.
  const run = snapshotSignal.value.facilityRunState;
  const countdowns = run ? runCountdowns(run) : null;
  const urgent = countdowns
    ? [
      ...(countdowns.collapseIn <= COMBAT_DEADLINE_BANNER_WINDOW ? [`시설 붕괴까지 ${countdowns.collapseIn}칸`] : []),
      ...countdowns.exits
        .filter((exit) => !exit.closed && exit.inTicks <= COMBAT_DEADLINE_BANNER_WINDOW)
        .map((exit) => `출구 ${exit.exitId} 폐쇄까지 ${exit.inTicks}칸`),
    ]
    : [];

  return html`
    <div
      style=${{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--space-6) var(--space-8)', gap: 'var(--space-4)', '--combat-step-ms': `${playbackDuration}ms` }}
      onDragOver=${(e) => e.preventDefault()}
      onDrop=${handleDropAnywhere}
    >
      ${urgent.length > 0 ? html`
        <div style=${{ fontSize: '12px', fontWeight: 800, padding: '7px var(--space-4)', color: 'var(--color-bg)', background: 'var(--color-negative, #dd2b0f)' }}>
          ${urgent.join(' · ')} — 턴 하나에 맵 ${COMBAT_ROUND_TIME_COST}칸이 나갑니다.
        </div>
      ` : null}
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <h3 style=${{ margin: 0 }}>전투 — ${enemyNames}</h3>
          ${run ? html`<${MapClock} run=${run} countdowns=${countdowns} compact=${true} />` : null}
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
        <${NoiseGauge} gauge=${combatContext?.noiseGauge ?? 0} intensity=${combatContext?.noiseIntensity ?? 0} />
        <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-2) var(--space-3)', width: '280px', fontSize: '11px' }}>
          <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span class="tag tag-outline">DEBUG · 디버그</span>
            <${HistoryControls} />
          </div>
          <${PlayLog} />
        </div>
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-4)', justifyContent: 'center', alignItems: 'stretch' }}>
        <${PlayerStatusBar} player=${player} overload=${combat.overload} overloadFloor=${combat.overloadFloor} animation=${animation?.actor === 'player' ? animation : null} />
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

      <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        ${consumableSlots.filter(Boolean).map((item) => {
          const def = CONSUMABLE_DEFINITIONS[item.defId];
          // 버튼에 이름만 있으면 무엇이 일어나는지, 소음이 얼마나 나는지, 다시 쓸 수 있는지가
          // 전부 감춰진다 — 소모품은 한 번 쓰면 영구히 사라지므로 특히 그렇다(리뷰 B7).
          const tip = `${def.description}.`
            + ` 소음 ${def.mapTags.noise}${def.mapTags.noise === 0 ? ' (조용함)' : ' — 전투 소음 게이지에 더해집니다'}.`
            + `${def.mapTags.disengageProgress ? ` 이탈 진행도 +${def.mapTags.disengageProgress}.` : ''}`
            + ' 쓰면 이 런에서 영구히 사라집니다.';
          return html`
            <${Tooltip} key=${item.id} width=${220} content=${tip}>
              <button
                class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 10px' }}
                disabled=${playbackActive}
                onClick=${() => dispatch({ type: 'USE_CONSUMABLE', itemId: item.id })}
              >${def.name}</button>
            <//>
          `;
        })}
        ${/* 디버그: 정상 승리와 같은 처리 경로(checkWinLoss -> finalizeIfCombatEnded)를 타므로
              보상·시체·라운드 정산이 실제 승리와 동일하게 일어난다. */ null}
        <${Tooltip} width=${230} content="디버그: 살아 있는 적을 전부 쓰러뜨린 것으로 치고 정상 승리 처리(보상 생성·시체 남기기·라운드 정산)를 그대로 진행합니다.">
          <button
            class="btn btn-secondary"
            style=${{
              fontSize: '11px', fontWeight: 800, padding: '4px 10px', letterSpacing: '0.03em',
              borderColor: 'var(--color-accent-2-700)', color: 'var(--color-accent-2-700)',
            }}
            disabled=${playbackActive}
            onClick=${() => dispatch({ type: 'DEBUG_WIN_COMBAT' })}
          >DEBUG 즉시 승리</button>
        <//>
        ${disengage ? html`
          <div style=${{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginLeft: 'auto', fontSize: '11px' }}>
            ${disengage.escapeIntent
              ? html`
                <${Tooltip} width=${200} content="이탈 태그가 붙은 카드를 플레이하면 진행도가 오릅니다. 필요한 진행도에 도달하면 '이탈 확정'으로 보상 없이 즉시 맵으로 돌아갈 수 있습니다.">
                  <span>이탈 진행도 ${disengage.disengageProgress}/${DISENGAGE_REQUIRED_PROGRESS}</span>
                <//>
                ${escapeCards.length > 0 ? html`<span style=${{ color: '#0e7490', fontWeight: 800 }}>손패 이탈 카드 ${escapeCards.length}장 강조됨</span>` : html`<span style=${{ color: 'var(--color-negative, #dc2626)' }}>손패에 이탈 카드 없음 — 다음 드로우까지 버티세요</span>`}
                <button class="btn btn-secondary" style=${{ padding: '4px 10px' }} disabled=${playbackActive} onClick=${() => dispatch({ type: 'CANCEL_DISENGAGE' })}>이탈 취소</button>
                <${Tooltip} width=${200} content="진행도를 채우면 전투를 즉시 종료하고 맵으로 돌아갑니다 — 승리 보상은 없지만 HP/과부화는 지금 상태 그대로 유지됩니다.">
                  <button class="btn btn-primary" style=${{ padding: '4px 10px' }} disabled=${playbackActive || !canDisengage(disengage)} onClick=${() => dispatch({ type: 'RESOLVE_DISENGAGE' })}>이탈 확정</button>
                <//>
              `
              : html`
                <${Tooltip} width=${200} content=${playbackActive ? '적 행동 연출이 끝난 뒤에 이탈을 시도할 수 있습니다.' : '이탈 시도를 켭니다. Mobility 2 이상이면 시도 즉시 진행도 +1을 받습니다. 이후 이탈 태그 카드를 플레이해 진행도를 채우세요.'}>
                  <button class="btn btn-secondary" style=${{ padding: '4px 10px' }} disabled=${playbackActive} onClick=${() => dispatch({ type: 'BEGIN_DISENGAGE' })}>이탈 시도</button>
                <//>
              `}
          </div>
        ` : null}
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
            player=${player}
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
