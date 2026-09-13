// 지도 뷰(팬·줌)와 디버그 토글은 화면 상태라 스냅샷 밖의 시그널에 산다(state/mapViewState.js).
// 화면 밖에 두는 이유가 "전투·팝업이 MapScreen을 언마운트해도 남는 것"이므로, 여기서 지키는
// 것은 두 가지다: 새 런이 시작되면 반드시 초기화되고, 그 외에는 아무도 건드리지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const projectUrl = (path) => new URL(path, import.meta.url).href;
register(projectUrl('./helpers/preactResolve.mjs'));

const { mapViewSignal, mapDebugRevealSignal, resetMapView, DEFAULT_MAP_VIEW } = await import(projectUrl('../src/state/mapViewState.js'));
const { dispatch } = await import(projectUrl('../src/state/dispatch.js'));

test('resetMapView는 팬·줌과 디버그 토글을 처음 상태로 돌린다', () => {
  mapViewSignal.value = { x: -120, y: 80, scale: 4 };
  mapDebugRevealSignal.value = true;

  resetMapView();

  assert.deepEqual(mapViewSignal.value, DEFAULT_MAP_VIEW);
  assert.equal(mapDebugRevealSignal.value, false);
});

test('새 런(NEW_RUN)은 지도 뷰를 초기화한다 — 이전 시설의 좌표는 의미가 없다', () => {
  mapViewSignal.value = { x: 300, y: -50, scale: 2.5 };
  mapDebugRevealSignal.value = true;

  dispatch({ type: 'NEW_RUN', seed: 4242 });

  assert.deepEqual(mapViewSignal.value, DEFAULT_MAP_VIEW);
  assert.equal(mapDebugRevealSignal.value, false);
});

test('다른 명령은 지도 뷰를 건드리지 않는다 — 전투 한 번에 화면이 튀면 안 된다', () => {
  const kept = { x: 12, y: -34, scale: 3.5 };
  mapViewSignal.value = kept;

  dispatch({ type: 'WAIT' });

  assert.deepEqual(mapViewSignal.value, kept);
});
