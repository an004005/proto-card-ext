import { html, useState } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal, combatAnimationSignal, combatPlaybackDurationSignal, combatPlaybackActiveSignal } from '../state/runState.js';
import { combatStateSignal, handSignal, enemiesSignal, playerCombatSignal, pileCountsSignal, overloadActiveSignal } from '../state/combatStateAdapter.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { isCardPlayable, getCardTargetKind } from '../engine/combatEngine.js';
import { canDisengage, DISENGAGE_REQUIRED_PROGRESS, COMBAT_ROUND_TIME_COST, COMBAT_NOISE_ENABLED } from '../engine/combatMapIntegration.js';
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

/**
 * 전투 머리의 "라운드 N · 이 전투 T칸". 첫 플레이어 턴이 1라운드이고, 맵 시간은 라운드가
 * 끝날 때마다 나가므로 아직 아무 라운드도 정산되지 않은 1라운드에는 0칸이다 — 시계만 보면
 * "이 전투에 이미 얼마를 썼나"를 알 수 없다.
 * @param {number} turn 현재 라운드 번호(1부터)
 * @param {number} roundCost 라운드 하나가 쓰는 맵 칸
 */
export function combatTimeSpentText(turn, roundCost) {
  const rounds = Math.max(0, (turn || 1) - 1);
  return `라운드 ${Math.max(1, turn || 1)} · 이 전투 ${rounds * roundCost}칸`;
}

export function CombatScreen() {
  const [draggingCard, setDraggingCard] = useState(null);
  const [showInventory, setShowInventory] = useState(false);
  // 디버그 상자는 기본적으로 닫혀 있다 — 플레이 로그는 상시 화면 한 귀퉁이를 차지할 만큼
  // 자주 보는 것이 아니고, 그 자리는 적 카드가 써야 한다.
  const [showDebug, setShowDebug] = useState(false);
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
  const overloadActive = overloadActiveSignal.value;
  const consumableSlots = snapshotSignal.value.playerState.loadout.consumableSlots;
  const overrideChips = snapshotSignal.value.playerState.overrideChips || 0;
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
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <h3 style=${{ margin: 0 }}>전투 — ${enemyNames}</h3>
          ${run ? html`<${MapClock} run=${run} countdowns=${countdowns} compact=${true} />` : null}
          <${Tooltip} width=${260} content=${`전투는 1라운드마다 맵 시간 ${COMBAT_ROUND_TIME_COST}칸이 흐릅니다. 위 시계의 마감은 그동안에도 다가옵니다.`}>
            <span style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', whiteSpace: 'nowrap' }}>${combatTimeSpentText(combat.turn, COMBAT_ROUND_TIME_COST)}</span>
          <//>
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
        <div style=${{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          ${COMBAT_NOISE_ENABLED ? html`<${NoiseGauge} gauge=${combatContext?.noiseGauge ?? 0} intensity=${combatContext?.noiseIntensity ?? 0} />` : null}
          <button
            class="btn btn-secondary"
            style=${{ fontSize: '10px', padding: '4px 10px', letterSpacing: '0.08em', borderColor: showDebug ? 'var(--color-accent)' : 'var(--color-divider)', color: showDebug ? 'var(--color-accent)' : 'inherit' }}
            onClick=${() => setShowDebug((v) => !v)}
          >DEBUG</button>
        </div>
      </div>

      ${/* 아레나 — 헤더와 손패 사이를 전부 쓴다. 플레이어가 왼쪽, 적이 오른쪽, 가운데 구분선.
            예전에는 둘 다 화면 위쪽에 붙은 작은 카드였고 아래 60%가 비어 있었다. */ null}
      <div style=${{ flex: 1, minHeight: 0, display: 'flex', gap: 'var(--space-6)', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
        <${PlayerStatusBar} player=${player} overloadActive=${combat.overloadActive} canToggleOverload=${combat.phase === 'player_turn'} animation=${animation?.actor === 'player' ? animation : null} />
        <div style=${{ width: '2px', background: 'var(--color-divider)', alignSelf: 'stretch' }}></div>
        <div style=${{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', maxHeight: '100%', overflowY: 'auto' }}>
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
        ${showDebug ? html`
          <div style=${{
            position: 'absolute', top: 0, right: 0, zIndex: 5, width: '300px', fontSize: '11px',
            border: '2px solid var(--color-divider)', background: 'var(--color-bg)', boxShadow: 'var(--shadow-lg)',
            padding: 'var(--space-2) var(--space-3)', display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span class="tag tag-outline">DEBUG · 디버그</span>
              <${HistoryControls} />
            </div>
            <${PlayLog} />
            ${/* 디버그: 정상 승리와 같은 처리 경로(checkWinLoss -> finalizeIfCombatEnded)를 타므로
                  보상·시체·라운드 정산이 실제 승리와 동일하게 일어난다. */ null}
            <${Tooltip} width=${230} content="디버그: 살아 있는 적을 전부 쓰러뜨린 것으로 치고 정상 승리 처리(보상 생성·시체 남기기·라운드 정산)를 그대로 진행합니다.">
              <button
                class="btn btn-secondary"
                style=${{
                  width: '100%', fontSize: '11px', fontWeight: 800, padding: '4px 10px', letterSpacing: '0.03em',
                  borderColor: 'var(--color-accent-2-700)', color: 'var(--color-accent-2-700)',
                }}
                disabled=${playbackActive}
                onClick=${() => dispatch({ type: 'DEBUG_WIN_COMBAT' })}
              >DEBUG 즉시 승리</button>
            <//>
          </div>
        ` : null}
      </div>

      ${/* 행동 줄 — 손패 바로 위. 소모품·충격 코어·이탈이 손에서 멀리 떨어져 있으면 카드를 내는
            동안 존재 자체가 잊힌다. 턴 종료 버튼은 손패 바로 아래에 이미 붙어 있어 그대로 둔다. */ null}
      <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        ${consumableSlots.filter(Boolean).map((item) => {
          const def = CONSUMABLE_DEFINITIONS[item.defId];
          // 버튼에 이름만 있으면 무엇이 일어나는지, 소음이 얼마나 나는지, 다시 쓸 수 있는지가
          // 전부 감춰진다 — 소모품은 한 번 쓰면 영구히 사라지므로 특히 그렇다(리뷰 B7).
          const tip = `${def.description}.`
            + (COMBAT_NOISE_ENABLED ? ` 소음 ${def.mapTags.noise}${def.mapTags.noise === 0 ? ' (조용함)' : ' — 전투 소음 게이지에 더해집니다'}.` : '')
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
        ${/* 오버라이드 칩은 소모품 슬롯이 아니라 런 전체의 통에서 나간다(ADR-0086) — 그래서
              슬롯 목록 바깥에, 같은 줄에 둔다. */ null}
        <${Tooltip} width=${260} content="충격 코어: 오버라이드 칩 하나로 시설 관리자 권한을 강제로 밀어넣어 적 전원의 장비·신경계를 과부하시킵니다. 살아 있는 적 전원 스턴 1(다음 행동을 건너뜀). 에너지·턴 소모 없음.">
          <button
            class="btn btn-secondary"
            style=${{
              fontSize: '11px', fontWeight: 800, padding: '4px 10px',
              borderColor: 'var(--color-accent-700)', color: 'var(--color-accent-700)',
            }}
            disabled=${playbackActive || overrideChips <= 0}
            onClick=${() => dispatch({ type: 'USE_OVERRIDE_CHIP' })}
          >충격 코어 · 칩 ×${overrideChips}</button>
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
                <${Tooltip} width=${200} content="진행도를 채우면 전투를 즉시 종료하고 맵으로 돌아갑니다 — 승리 보상은 없지만 HP는 지금 상태 그대로 유지됩니다.">
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

      <div style=${{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 'var(--space-3)', flex: '0 0 auto' }}>
        <${TargetingOverlay} active=${needsEnemyTarget} />
        <div style=${{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', justifyContent: 'center' }}>
          <${DrawPileBox} count=${pileCounts.draw} onClick=${() => setOpenPile('draw')} />
          <${Hand}
            cards=${hand} playableMap=${playableMap}
            draggingInstanceId=${draggingCard?.instanceId ?? null}
            onCardDragStart=${(card) => setDraggingCard(card)}
            onCardDragEnd=${() => setDraggingCard(null)}
            overloadActive=${overloadActive} powers=${player.powers}
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
