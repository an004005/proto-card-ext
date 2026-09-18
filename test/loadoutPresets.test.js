// 역할군 프리셋(src/data/loadoutPresets.js) — 네 버튼이 정말로 서로 다른 침투 방식인가, 그리고
// 누르면 정의대로 장착되는가.
//
// Capability 검증이 이 파일의 핵심이다. 프리셋은 "이 구성이면 이 축이 높다"는 약속이고, 장비
// 보정치는 언제든 재조정되므로(C4 같은 밸런스 패스) 약속과 수치가 조용히 어긋날 수 있다. 그래서
// 네 프리셋의 Capability 합을 실제로 계산해 역할 사이의 **관계**를 본다 — 절대값이 아니라.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer } from '../src/engine/gameReducer.js';
import { previewPresetCapabilities } from '../src/engine/loadoutReducer.js';
import { computeCapabilities } from '../src/engine/capabilityEngine.js';
import { LOADOUT_PRESETS, getLoadoutPreset, presetEquipmentIds } from '../src/data/loadoutPresets.js';
import { SLOT_LIMITS } from '../src/engine/inventoryReducer.js';
import { CONSUMABLE_SLOT_COUNT } from '../src/engine/loadoutReducer.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../src/data/equipment.js';
import { MODULE_DEFINITIONS } from '../src/data/modules.js';
import { IMPLANT_DEFINITIONS } from '../src/data/implants.js';
import { CONSUMABLE_DEFINITIONS } from '../src/data/consumables.js';

/** 계약 화면이 NEW_RUN과 로드아웃 사이에 낀다 — 첫 제안을 그대로 수락해 창고로 들어간다. */
function startLoadout(seed) {
  const offered = gameReducer(null, { type: 'NEW_RUN', seed });
  return gameReducer(offered, { type: 'ACCEPT_CONTRACT', contractId: offered.offeredContracts[0].id });
}

const byId = Object.fromEntries(LOADOUT_PRESETS.map((p) => [p.id, previewPresetCapabilities(p)]));
const others = (id, key) => LOADOUT_PRESETS.filter((p) => p.id !== id).map((p) => byId[p.id][key]);

test('프리셋이 가리키는 장비는 전부 실재하고 슬롯 정원을 넘지 않는다', () => {
  assert.deepEqual(LOADOUT_PRESETS.map((p) => p.id), ['assault', 'infiltrator', 'hacker', 'scout']);
  for (const preset of LOADOUT_PRESETS) {
    assert.ok(preset.name && preset.summary, `${preset.id}: 이름과 한 줄 요약`);
    assert.ok(preset.weapons.length <= SLOT_LIMITS.weapons, `${preset.id}: 무기 정원`);
    assert.ok(preset.modules.length <= SLOT_LIMITS.modules, `${preset.id}: 모듈 정원`);
    assert.ok(preset.implants.length <= SLOT_LIMITS.implantIds, `${preset.id}: 임플란트 정원`);
    assert.ok(preset.consumables.length <= CONSUMABLE_SLOT_COUNT, `${preset.id}: 퀵슬롯 정원`);
    // 같은 임플란트를 두 번 장착할 수는 없다 — 프리셋에 중복이 있으면 조용히 하나가 빠진다.
    assert.equal(new Set(preset.implants).size, preset.implants.length, `${preset.id}: 임플란트 중복`);

    for (const id of preset.weapons) assert.ok(WEAPON_DEFINITIONS[id], `${preset.id}: 무기 ${id}가 정의에 없다`);
    assert.ok(ARMOR_TOP_DEFINITIONS[preset.top], `${preset.id}: 상의 ${preset.top}`);
    assert.ok(ARMOR_BOTTOM_DEFINITIONS[preset.bottom], `${preset.id}: 하의 ${preset.bottom}`);
    for (const id of preset.modules) assert.ok(MODULE_DEFINITIONS[id], `${preset.id}: 모듈 ${id}`);
    for (const id of preset.implants) assert.ok(IMPLANT_DEFINITIONS[id], `${preset.id}: 임플란트 ${id}`);
    for (const id of preset.consumables) assert.ok(CONSUMABLE_DEFINITIONS[id], `${preset.id}: 소모품 ${id}`);
  }
});

test('네 역할군은 각자의 축에서 나머지 셋보다 높다', () => {
  // 돌격 — Force.
  assert.ok(byId.assault.force > Math.max(...others('assault', 'force')), `돌격 force ${byId.assault.force}`);
  // 잠입 — Stealth와 Mobility를 함께 본다. 창고에 Stealth를 올려 주는 장비가 경갑상의 하나뿐이라
  // Stealth 단독으로는 동률이 나온다. 잠입을 잠입이게 하는 것은 "깎는 것을 하나도 들지 않은" 합이다.
  const infiltratorSum = byId.infiltrator.stealth + byId.infiltrator.mobility;
  for (const preset of LOADOUT_PRESETS.filter((p) => p.id !== 'infiltrator')) {
    const sum = byId[preset.id].stealth + byId[preset.id].mobility;
    assert.ok(infiltratorSum > sum, `잠입 S+M ${infiltratorSum} vs ${preset.id} ${sum}`);
  }
  assert.ok(byId.infiltrator.stealth >= Math.max(...others('infiltrator', 'stealth')), '잠입 stealth는 최소한 공동 1위다');
  // 해커 — Hacking과 Deception 둘 다.
  assert.ok(byId.hacker.hacking > Math.max(...others('hacker', 'hacking')), `해커 hacking ${byId.hacker.hacking}`);
  assert.ok(byId.hacker.deception > Math.max(...others('hacker', 'deception')), `해커 deception ${byId.hacker.deception}`);
  // 정찰 — Perception.
  assert.ok(byId.scout.perception > Math.max(...others('scout', 'perception')), `정찰 perception ${byId.scout.perception}`);

  // 역할군에는 값이 따른다 — 어느 프리셋도 여섯 축이 전부 0 이상일 수는 없거나(무언가를 깎거나),
  // 적어도 자기 축 밖에서는 남들보다 낫지 않아야 한다. 돌격이 그 대가를 가장 크게 치른다.
  assert.ok(byId.assault.stealth < 0, '돌격은 은신을 대가로 치른다');
  assert.equal(byId.scout.mobility, 0, '정찰은 저격총의 기동 -1을 전술하의로 겨우 상쇄한다');
});

test('APPLY_LOADOUT_PRESET은 슬롯을 정의대로 채우고 나머지는 창고에 남긴다', () => {
  for (const preset of LOADOUT_PRESETS) {
    const state = gameReducer(startLoadout(5), { type: 'APPLY_LOADOUT_PRESET', presetId: preset.id });
    const { loadout, warehouse, inventory } = state.playerState;

    assert.deepEqual(loadout.weapons.map((w) => w.equipmentId), preset.weapons, `${preset.id}: 무기`);
    assert.equal(loadout.top.equipmentId, preset.top, `${preset.id}: 상의`);
    assert.equal(loadout.bottom.equipmentId, preset.bottom, `${preset.id}: 하의`);
    assert.deepEqual(loadout.modules.map((m) => m.equipmentId), preset.modules, `${preset.id}: 모듈`);
    assert.deepEqual(loadout.implantIds, preset.implants, `${preset.id}: 임플란트`);
    assert.deepEqual(loadout.consumableSlots.filter(Boolean).map((c) => c.defId), preset.consumables, `${preset.id}: 퀵슬롯`);
    assert.deepEqual(state.appliedLoadoutPreset, { presetId: preset.id, missing: [] }, `${preset.id}: 창고 시작 풀에는 다 있다`);

    // 실제로 장착된 결과가 미리보기와 같다 — 버튼 툴팁이 거짓말을 하지 않는다.
    assert.deepEqual(computeCapabilities(loadout), byId[preset.id], `${preset.id}: 미리보기와 실제`);

    // 장착하지 않은 장비는 인벤토리가 아니라 창고에 남는다 — 프리셋은 짐을 늘리지 않는다.
    assert.equal(inventory.items.filter((i) => i.kind === 'equipment').length, 0, `${preset.id}: 인벤토리에 장비가 쌓였다`);
    const equipped = new Set(presetEquipmentIds(preset));
    for (const id of ['katana', 'rifle', 'revolver']) {
      if (equipped.has(id)) continue;
      assert.ok(warehouse.items.some((i) => i.equipmentId === id), `${preset.id}: ${id}가 창고에서 사라졌다`);
    }
  }
});

test('다른 프리셋을 눌러도, 같은 프리셋을 두 번 눌러도 결과는 정의 그대로다', () => {
  let state = gameReducer(startLoadout(5), { type: 'APPLY_LOADOUT_PRESET', presetId: 'assault' });
  const afterAssault = state;

  // 돌격 → 잠입 → 돌격. 마지막 상태는 처음 돌격과 같아야 한다(밀려난 장비가 인벤토리에 쌓여
  // 결과가 달라지면 프리셋을 눌러 볼수록 상태가 나빠진다).
  state = gameReducer(state, { type: 'APPLY_LOADOUT_PRESET', presetId: 'infiltrator' });
  state = gameReducer(state, { type: 'APPLY_LOADOUT_PRESET', presetId: 'assault' });
  const describe = (s) => ({
    weapons: s.playerState.loadout.weapons.map((w) => w.equipmentId),
    top: s.playerState.loadout.top.equipmentId,
    bottom: s.playerState.loadout.bottom.equipmentId,
    modules: s.playerState.loadout.modules.map((m) => m.equipmentId),
    implants: s.playerState.loadout.implantIds,
    consumables: s.playerState.loadout.consumableSlots.filter(Boolean).map((c) => c.defId),
    inventorySize: s.playerState.inventory.items.length,
    warehouseSize: s.playerState.warehouse.items.length,
  });
  assert.deepEqual(describe(state), describe(afterAssault));

  // 같은 프리셋을 한 번 더 눌러도 같다.
  assert.deepEqual(describe(gameReducer(state, { type: 'APPLY_LOADOUT_PRESET', presetId: 'assault' })), describe(afterAssault));
});

test('창고에 없는 항목은 건너뛰고 화면이 읽을 수 있게 남긴다', () => {
  const start = startLoadout(5);
  const preset = getLoadoutPreset('assault');
  // 샷건과 붕대를 창고에서 전부 치운다.
  const stripped = {
    ...start,
    playerState: {
      ...start.playerState,
      warehouse: {
        ...start.playerState.warehouse,
        items: start.playerState.warehouse.items.filter((i) => i.equipmentId !== 'shotgun' && i.defId !== 'bandage'),
      },
    },
  };

  const state = gameReducer(stripped, { type: 'APPLY_LOADOUT_PRESET', presetId: 'assault' });
  assert.equal(state.appliedLoadoutPreset.presetId, 'assault');
  assert.deepEqual(state.appliedLoadoutPreset.missing, ['shotgun', 'bandage', 'bandage', 'bandage']);
  // 나머지는 정상적으로 장착됐다 — 하나가 없다고 프리셋 전체가 무산되지 않는다.
  assert.deepEqual(state.playerState.loadout.weapons.map((w) => w.equipmentId), ['rocket_launcher']);
  assert.equal(state.playerState.loadout.top.equipmentId, preset.top);
  assert.deepEqual(state.playerState.loadout.implantIds, preset.implants);
  assert.deepEqual(state.playerState.loadout.consumableSlots, [null, null, null]);
});

test('출격 준비 화면이 아니면 프리셋은 아무 일도 하지 않는다', () => {
  const offered = gameReducer(null, { type: 'NEW_RUN', seed: 5 }); // 'contract' 화면
  assert.equal(gameReducer(offered, { type: 'APPLY_LOADOUT_PRESET', presetId: 'assault' }), offered);
  const loadout = startLoadout(5);
  assert.equal(gameReducer(loadout, { type: 'APPLY_LOADOUT_PRESET', presetId: 'nope' }), loadout);
});
