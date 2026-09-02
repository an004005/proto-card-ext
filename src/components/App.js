import { html, useEffect } from '../lib.js';
import { snapshotSignal, historySignal } from '../state/runState.js';
import { dispatch } from '../state/dispatch.js';
import { createHistory } from '../engine/historyEngine.js';
import { DEV_SCENARIOS, applyDevScenario } from '../dev/devScenarios.js';
import { LoadoutScreen } from './LoadoutScreen.js';
import { MapScreen } from './MapScreen.js';
import { CombatScreen } from './CombatScreen.js';
import { RewardScreen } from './RewardScreen.js';
import { GameOverScreen } from './GameOverScreen.js';
import { ExtractionCompleteScreen } from './ExtractionCompleteScreen.js';

const SCREENS = {
  loadout: LoadoutScreen,
  map: MapScreen,
  combat: CombatScreen,
  reward: RewardScreen,
  gameOver: GameOverScreen,
  extractionComplete: ExtractionCompleteScreen,
};

/** 개발자 전용 진입점 — ?devScenario=<name>이 붙어 있으면 자동으로 출격 준비를 끝내고 그
 * 시나리오 상태로 맵에 진입시킨다. devScenarios.js 참고. 정상 플레이에는 영향 없음. */
function useDevScenario() {
  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get('devScenario');
    if (!name || !DEV_SCENARIOS.includes(name)) return;
    dispatch({ type: 'AUTO_EQUIP_LOADOUT' });
    dispatch({ type: 'CONFIRM_LOADOUT' });
    // historySignal은 dispatch()가 읽는 진짜 소스(state/runState.js) — snapshotSignal만 덮어쓰면
    // 화면엔 시나리오가 반영된 것처럼 보이지만 다음 dispatch()는 여전히 시나리오 적용 전 상태를
    // 대상으로 실행돼 매번 조용히 실패한다(실제로 겪은 버그). 반드시 같이 리셋해야 한다.
    const scenario = applyDevScenario(snapshotSignal.value, name);
    historySignal.value = createHistory(scenario);
    snapshotSignal.value = scenario;
  }, []);
}

export function App() {
  useDevScenario();
  const ScreenComponent = SCREENS[snapshotSignal.value.currentScreen];
  return html`
    <div style=${{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', display: 'flex', flexDirection: 'column' }}>
      <${ScreenComponent} />
    </div>
  `;
}
