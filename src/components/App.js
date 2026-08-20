import { html } from '../lib.js';
import { snapshotSignal } from '../state/runState.js';
import { LoadoutScreen } from './LoadoutScreen.js';
import { MapScreen } from './MapScreen.js';
import { CombatScreen } from './CombatScreen.js';
import { UnknownRoomScreen } from './UnknownRoomScreen.js';
import { RewardScreen } from './RewardScreen.js';
import { GameOverScreen } from './GameOverScreen.js';
import { ExtractionCompleteScreen } from './ExtractionCompleteScreen.js';
import { FacilityMapPreview } from './FacilityMapPreview.js';

const SCREENS = {
  loadout: LoadoutScreen,
  map: MapScreen,
  combat: CombatScreen,
  unknown_room: UnknownRoomScreen,
  reward: RewardScreen,
  gameOver: GameOverScreen,
  extractionComplete: ExtractionCompleteScreen,
};

export function App() {
  // #facility is a dev-only preview of the 48-node extraction map (see FacilityMapPreview.js) —
  // it doesn't touch snapshotSignal/dispatch at all, so it can't affect the real game.
  const ScreenComponent = typeof location !== 'undefined' && location.hash === '#facility'
    ? FacilityMapPreview
    : SCREENS[snapshotSignal.value.currentScreen];
  return html`
    <div style=${{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', display: 'flex', flexDirection: 'column' }}>
      <${ScreenComponent} />
    </div>
  `;
}
