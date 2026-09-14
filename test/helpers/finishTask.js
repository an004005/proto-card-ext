// 작업은 더 이상 그것을 시작한 호출 안에서 끝나지 않는다(ADR-0084) — 가동에 1칸이 들고,
// 남은 게이지는 그 자리에서 대기로 채운다. 완료 효과를 보는 테스트는 그 대기를 대신 돌린다.

import { waitOneTick } from '../../src/engine/runEngine.js';
import { gameReducer } from '../../src/engine/gameReducer.js';

/** 게이지가 이만큼 도는 동안 끝나지 않으면 테스트 쪽 실수다 — 무한 루프 대신 여기서 멈춘다. */
const MAX_TICKS = 200;

/**
 * 진행 중인 작업이 끝날 때까지(완료든 중단이든) 1칸씩 대기한다. 이미 끝난 상태면 그대로 돌려준다.
 * @param {import('../../src/engine/types.js').FacilityRunState} run
 * @returns {import('../../src/engine/types.js').FacilityRunState}
 */
export function finishTask(run) {
  let current = run;
  for (let i = 0; i < MAX_TICKS && current.pendingTask && current.phase === 'active'; i++) {
    current = waitOneTick(current);
  }
  return current;
}

/**
 * 스냅샷 쪽에서 같은 일을 한다 — 인벤토리·장비처럼 facilityRunState 바깥에서 정산되는 완료
 * 효과를 보려면 리듀서를 거쳐야 한다(facilityReducer.DEFERRED_COMPLETIONS).
 * @param {import('../../src/engine/types.js').GameSnapshot} snapshot
 * @returns {import('../../src/engine/types.js').GameSnapshot}
 */
export function finishTaskSnapshot(snapshot) {
  let current = snapshot;
  for (let i = 0; i < MAX_TICKS; i++) {
    const run = current.facilityRunState;
    if (!run || !run.pendingTask || run.phase !== 'active' || current.currentScreen !== 'map') break;
    const next = gameReducer(current, { type: 'WAIT' });
    if (next === current) break;
    current = next;
  }
  return current;
}
