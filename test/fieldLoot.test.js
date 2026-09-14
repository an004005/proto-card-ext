// §5단계 확보 대상 파밍(D10·D11): 후보 3개가 전부 같은 역할축에서 나오고 서로 다른지, 그리고
// 같은 시드가 같은 결과를 내는지가 이 모듈의 계약이다. 축 분류는 MAP_EQUIPMENT_CAPABILITIES에서
// 파생돼야 하므로 후보를 그 원본 데이터로 되짚어 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollFieldLootOptions, axisOfEquipment, listEquipmentByAxis } from '../src/engine/fieldLoot.js';
import { MAP_EQUIPMENT_CAPABILITIES } from '../src/data/facilityEquipmentCapabilities.js';
import { getAllEquipmentIds } from '../src/engine/inventoryReducer.js';
import { createRngState } from '../src/engine/rng.js';
import { PRIZE_OPTION_COUNT } from '../src/data/facilityLayout.js';
import { REWARD_AMMO_MIN, REWARD_AMMO_MAX, REWARD_CURRENCY_VALUE_RANGE } from '../src/data/rewardTables.js';
import { CONSUMABLE_DROP_WEIGHTS } from '../src/data/dropTables.js';
import { finishTaskSnapshot } from './helpers/finishTask.js';

const AXES = ['combat', 'infiltration', 'resource'];
const SEEDS = [1, 2, 7, 42, 99, 1234, 20260911];

/** 후보 하나를 동일성 비교용 문자열로 — 값이 달라도 같은 장비/소모품이면 같은 선택지다. */
function keyOf(option) {
  if (option.kind === 'equipment') return `equipment:${option.equipmentId}`;
  if (option.kind === 'consumable') return `consumable:${option.defId}`;
  return option.kind;
}

test('같은 시드는 완전히 같은 결과를 낸다 (Math.random 미사용 확인)', () => {
  for (const axis of AXES) {
    for (const tier of ['normal', 'elite']) {
      const a = rollFieldLootOptions(axis, tier, createRngState(1234));
      const b = rollFieldLootOptions(axis, tier, createRngState(1234));
      assert.deepEqual(a, b, `${axis}/${tier}이 결정론적이어야 한다`);
      assert.equal(typeof a.rngState, 'number');
      assert.notEqual(a.rngState, createRngState(1234), 'rng를 실제로 소비해야 한다');
    }
  }
});

test('시드가 다르면 결과도 갈린다 — 상수를 반환하고 있지 않다', () => {
  const rolls = SEEDS.map((s) => JSON.stringify(rollFieldLootOptions('combat', 'normal', createRngState(s)).options));
  assert.ok(new Set(rolls).size > 1, '시드마다 같은 후보만 나오면 롤이 아니다');
});

test('후보는 항상 3개이고 서로 다르다', () => {
  for (const axis of AXES) {
    for (const seed of SEEDS) {
      const { options } = rollFieldLootOptions(axis, 'normal', createRngState(seed));
      assert.equal(options.length, PRIZE_OPTION_COUNT, `${axis}/seed ${seed} 후보 수`);
      const keys = options.map(keyOf);
      assert.equal(new Set(keys).size, keys.length, `${axis}/seed ${seed} 중복 후보: ${keys.join(', ')}`);
    }
  }
});

test('combat 축 후보는 Capability 순이득도 fieldAction도 없는 순수 전투 장비다', () => {
  for (const seed of SEEDS) {
    const { options } = rollFieldLootOptions('combat', 'elite', createRngState(seed));
    for (const option of options) {
      assert.equal(option.kind, 'equipment');
      const contract = MAP_EQUIPMENT_CAPABILITIES[option.equipmentId];
      assert.ok(contract, `${option.equipmentId}는 Capability 계약이 있어야 한다`);
      assert.equal(contract.fieldAction, null, `${option.equipmentId}에 현장 도구가 있으면 침투 축이다`);
      assert.ok(!contract.mapInfoEffect, `${option.equipmentId}는 맵 정보 효과가 있으면 침투 축이다`);
      const net = Object.values(contract.capabilityModifiers).reduce((sum, v) => sum + v, 0);
      assert.ok(net <= 0, `${option.equipmentId} 순합 ${net} — 순이득이 있으면 침투 축이다`);
    }
  }
});

test('infiltration 축 후보는 Capability 순이득·fieldAction·맵 정보 효과 중 하나를 가진 장비다', () => {
  for (const seed of SEEDS) {
    const { options } = rollFieldLootOptions('infiltration', 'elite', createRngState(seed));
    for (const option of options) {
      assert.equal(option.kind, 'equipment');
      const contract = MAP_EQUIPMENT_CAPABILITIES[option.equipmentId];
      assert.ok(contract, `${option.equipmentId}는 Capability 계약이 있어야 한다`);
      const net = Object.values(contract.capabilityModifiers).reduce((sum, v) => sum + v, 0);
      assert.ok(
        contract.fieldAction !== null || contract.mapInfoEffect || net > 0,
        `${option.equipmentId}는 침투에 기여하지 않는다`,
      );
    }
  }
});

test('resource 축 후보는 탄약·소모품·재화뿐이고 값이 tier 범위 안이다', () => {
  const consumableIds = new Set(CONSUMABLE_DROP_WEIGHTS.map((w) => w.value));
  for (const tier of ['normal', 'elite']) {
    for (const seed of SEEDS) {
      const { options } = rollFieldLootOptions('resource', tier, createRngState(seed));
      for (const option of options) {
        assert.ok(['ammo', 'consumable', 'currency'].includes(option.kind), `예상 밖 kind: ${option.kind}`);
        if (option.kind === 'ammo') {
          assert.ok(option.amount >= REWARD_AMMO_MIN && option.amount <= REWARD_AMMO_MAX, `탄약 ${option.amount}`);
        } else if (option.kind === 'currency') {
          const range = REWARD_CURRENCY_VALUE_RANGE[tier];
          assert.ok(option.value >= range.min && option.value <= range.max, `${tier} 재화 ${option.value}`);
        } else {
          assert.ok(consumableIds.has(option.defId), `알 수 없는 소모품 ${option.defId}`);
        }
      }
    }
  }
});

test('elite는 normal보다 재화 상한이 높다 — tier가 값어치에 반영된다', () => {
  assert.ok(REWARD_CURRENCY_VALUE_RANGE.elite.max > REWARD_CURRENCY_VALUE_RANGE.normal.max);
  const eliteValues = SEEDS.flatMap((s) => rollFieldLootOptions('resource', 'elite', createRngState(s)).options)
    .filter((o) => o.kind === 'currency').map((o) => o.value);
  assert.ok(eliteValues.length > 0, 'elite 롤에 재화가 한 번은 나와야 한다');
  assert.ok(Math.max(...eliteValues) > REWARD_CURRENCY_VALUE_RANGE.normal.max, 'elite에서 normal 상한을 넘는 값이 나온다');
});

test('axisOfEquipment가 실제 장비 데이터를 순합 기준으로 분류한다', () => {
  // 한쪽을 주고 한쪽을 뺏는 장비(순합 0)는 경로의 대가를 줄이지 못하므로 전투 축이다.
  assert.equal(axisOfEquipment('shotgun'), 'combat');          // force +1 / stealth -1
  assert.equal(axisOfEquipment('rocket_launcher'), 'combat');  // force +1 / stealth -1
  assert.equal(axisOfEquipment('heavy_top'), 'combat');
  assert.equal(axisOfEquipment('heavy_bottom'), 'combat');
  assert.equal(axisOfEquipment('rifle'), 'combat');            // 수정치 없음
  assert.equal(axisOfEquipment('module_neural'), 'combat');

  assert.equal(axisOfEquipment('katana'), 'infiltration');            // force +1 (순합 +1)
  assert.equal(axisOfEquipment('tactical_bottom'), 'infiltration');   // mobility +1 (순합 +1)
  assert.equal(axisOfEquipment('module_sandevistan'), 'infiltration');// mobility +2 / stealth -1 (순합 +1)
  assert.equal(axisOfEquipment('implant2'), 'infiltration');          // perception +1
  // 순합은 -1이지만 현장 도구를 주므로 침투 축이다.
  assert.equal(axisOfEquipment('module_forcefield'), 'infiltration');
  // 저격총도 같다 — 순합 0(perception +1 / mobility -1)이지만 카메라 저격이라는 현장 행동을 준다.
  assert.equal(axisOfEquipment('sniper_rifle'), 'infiltration');
  // ⑦ 지도는 Capability 수치도 현장 행동도 주지 않지만 맵 정보를 준다 — 표의 mapInfoEffect가
  // 그 사실을 밝히므로 규칙만으로 침투 축이 된다(예외 목록이라는 두 번째 진실 없이, 리뷰 A8).
  assert.equal(axisOfEquipment('implant7'), 'infiltration');
  // 존재하지 않는 장비는 침투 근거가 없으므로 전투 축으로 떨어진다.
  assert.equal(axisOfEquipment('no_such_equipment'), 'combat');
});

test('맵 정보 효과 임플란트는 침투 축이다 — 표의 mapInfoEffect가 근거다', () => {
  const mapInfoIds = Object.entries(MAP_EQUIPMENT_CAPABILITIES)
    .filter(([, contract]) => contract.mapInfoEffect)
    .map(([id]) => id);
  assert.ok(mapInfoIds.includes('implant7'), '⑦ 지도는 맵 정보 효과로 표시돼 있어야 한다');
  for (const id of mapInfoIds) {
    const contract = MAP_EQUIPMENT_CAPABILITIES[id];
    const net = Object.values(contract.capabilityModifiers).reduce((sum, v) => sum + v, 0);
    // Capability 수치도 현장 행동도 없는데 침투로 분류된다 — 판정이 mapInfoEffect만으로 선다.
    assert.equal(contract.fieldAction, null, `${id}`);
    assert.equal(net, 0, `${id}`);
    assert.equal(axisOfEquipment(id), 'infiltration', `${id}`);
    assert.ok(listEquipmentByAxis('infiltration').includes(id), `${id}는 침투 풀에 있어야 한다`);
  }
});

test('두 장비 축이 카탈로그를 빠짐없이 겹치지 않게 가른다', () => {
  const all = getAllEquipmentIds();
  const combat = listEquipmentByAxis('combat');
  const infiltration = listEquipmentByAxis('infiltration');
  assert.equal(combat.length + infiltration.length, all.length);
  assert.equal(new Set([...combat, ...infiltration]).size, all.length);
  // 후보 3개를 축 안에서 채우려면 각 축에 최소 PRIZE_OPTION_COUNT종이 있어야 한다.
  assert.ok(combat.length >= PRIZE_OPTION_COUNT, `combat ${combat.length}종`);
  assert.ok(infiltration.length >= PRIZE_OPTION_COUNT, `infiltration ${infiltration.length}종`);
});

test('입력 rngState를 변형하지 않고 새 상태를 반환한다', () => {
  const seed = createRngState(77);
  const first = rollFieldLootOptions('infiltration', 'normal', seed);
  const again = rollFieldLootOptions('infiltration', 'normal', seed);
  assert.deepEqual(first, again, '같은 state 값을 두 번 넣으면 같은 결과여야 한다');
  const chained = rollFieldLootOptions('infiltration', 'normal', first.rngState);
  assert.notEqual(chained.rngState, first.rngState, '이어 굴리면 상태가 진행된다');
});

// 보급품(supply) 롤러 — 예전에는 전투 보상 슬롯 0번을 그대로 써서 100% 장비가 나왔고 등급
// 롤이 결과에 전혀 반영되지 않았다(리뷰 A2).
test('보급품 200회 롤에서 장비는 소수이고 자원(탄약·소모품·재화·잡템)이 주력이다', async () => {
  const { rollSupplyLoot } = await import('../src/engine/fieldLoot.js');
  const counts = {};
  let rng = { seed: 4242 };
  for (let i = 0; i < 200; i += 1) {
    const rolled = rollSupplyLoot('normal', rng);
    rng = rolled.rngState;
    counts[rolled.option.kind] = (counts[rolled.option.kind] || 0) + 1;
  }
  const equipment = counts.equipment || 0;
  assert.ok(equipment < 200, '장비 100%였던 예전 동작이 남아 있다');
  assert.ok(equipment / 200 < 0.2, `장비 비중이 너무 높다: ${equipment}/200`);
  assert.ok((counts.ammo || 0) > 0 && (counts.currency || 0) > 0 && (counts.junk || 0) > 0, JSON.stringify(counts));
});

test('보급품 등급은 결과를 실제로 바꾼다 — normal과 elite의 분포가 다르다', async () => {
  const { rollSupplyLoot } = await import('../src/engine/fieldLoot.js');
  function distribution(tier) {
    const counts = {};
    let rng = { seed: 909 };
    let ammoTotal = 0;
    for (let i = 0; i < 200; i += 1) {
      const rolled = rollSupplyLoot(tier, rng);
      rng = rolled.rngState;
      counts[rolled.option.kind] = (counts[rolled.option.kind] || 0) + 1;
      if (rolled.option.kind === 'ammo') ammoTotal += rolled.option.amount;
    }
    return { counts, ammoTotal };
  }
  const normal = distribution('normal');
  const elite = distribution('elite');
  assert.notDeepEqual(normal.counts, elite.counts, '등급이 카테고리 분포를 바꾸지 않는다');
  assert.ok((elite.counts.equipment || 0) > (normal.counts.equipment || 0), 'elite가 장비를 더 자주 줘야 한다');
});

test('보급품 롤은 같은 시드에서 결정적이다', async () => {
  const { rollSupplyLoot } = await import('../src/engine/fieldLoot.js');
  const a = rollSupplyLoot('elite', { seed: 77 });
  const b = rollSupplyLoot('elite', { seed: 77 });
  assert.deepEqual(a, b);
});
