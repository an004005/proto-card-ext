import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeckFromLoadout, computeFloorOverload, computeMaxHpBonus, computeInventoryCapacityBonus,
  computeOverloadGainMultiplier, getImplantEffect,
} from '../src/engine/equipmentEngine.js';

function loadout(overrides = {}) {
  return {
    weaponIds: ['katana'], topId: 'light_top', bottomId: 'tactical_bottom',
    moduleIds: [], implantIds: [], ...overrides,
  };
}

test('buildDeckFromLoadout expands each equipped item\'s full card list with counts', () => {
  const deck = buildDeckFromLoadout(loadout());
  const counts = deck.reduce((m, id) => ({ ...m, [id]: (m[id] || 0) + 1 }), {});
  assert.equal(counts.katana_slash, 2);
  assert.equal(counts.katana_parry, 1);
  assert.equal(counts.light_top_dodge, 2);
  assert.equal(counts.light_top_deflect, 1);
  assert.equal(counts.tactical_bottom_feint, 1);
});

test('무기/상의/하의 미장착 슬롯 1칸당 맨손공격/어설픈 회피 3장씩 덱에 보충된다', () => {
  const fullyGeared = buildDeckFromLoadout(loadout({ weaponIds: ['katana', 'dagger'] }));
  assert.equal(fullyGeared.filter((id) => id === 'bare_hands_attack').length, 0);
  assert.equal(fullyGeared.filter((id) => id === 'clumsy_dodge').length, 0);

  const oneWeapon = buildDeckFromLoadout(loadout({ weaponIds: ['katana'] })); // 1/2 무기 슬롯 빈칸
  assert.equal(oneWeapon.filter((id) => id === 'bare_hands_attack').length, 3);

  const noWeapon = buildDeckFromLoadout(loadout({ weaponIds: [] })); // 2/2 무기 슬롯 빈칸
  assert.equal(noWeapon.filter((id) => id === 'bare_hands_attack').length, 6);

  const noArmor = buildDeckFromLoadout(loadout({ topId: null, bottomId: null })); // 상/하의 둘 다 빈칸
  assert.equal(noArmor.filter((id) => id === 'clumsy_dodge').length, 6);

  const noTopOnly = buildDeckFromLoadout(loadout({ topId: null }));
  assert.equal(noTopOnly.filter((id) => id === 'clumsy_dodge').length, 3);
});

test('돌진 베기 only enters the deck when 카타나 is equipped alongside 신체 강화', () => {
  const withKatana = buildDeckFromLoadout(loadout({ weaponIds: ['katana'], moduleIds: ['module_body'] }));
  assert.ok(withKatana.includes('module_charge_slash'));
  assert.ok(withKatana.includes('module_body_boost'));

  const withoutKatana = buildDeckFromLoadout(loadout({ weaponIds: ['dagger'], moduleIds: ['module_body'] }));
  assert.ok(!withoutKatana.includes('module_charge_slash'));
  assert.ok(withoutKatana.includes('module_body_boost')); // the power card itself is unaffected
});

test('computeFloorOverload sums only equipped implants\' floor values (§10, not modules)', () => {
  assert.equal(computeFloorOverload(loadout({ implantIds: ['implant1', 'implant3'] })), 15); // 10 + 5
  assert.equal(computeFloorOverload(loadout({ implantIds: [] })), 0);
});

test('computeMaxHpBonus / computeInventoryCapacityBonus read the right implant effects', () => {
  assert.equal(computeMaxHpBonus(loadout({ implantIds: ['implant1'] })), 7);
  assert.equal(computeInventoryCapacityBonus(loadout({ implantIds: ['implant3'] })), 5);
  assert.equal(computeMaxHpBonus(loadout({ implantIds: ['implant3'] })), 0);
});

test('computeOverloadGainMultiplier applies implant⑤\'s 50% reduction', () => {
  assert.equal(computeOverloadGainMultiplier(loadout({ implantIds: [] })), 1);
  assert.equal(computeOverloadGainMultiplier(loadout({ implantIds: ['implant5'] })), 0.5);
});

test('getImplantEffect finds the matching implant or returns null', () => {
  assert.equal(getImplantEffect(loadout({ implantIds: ['implant6'] }), 'turnStartAoeDamage').amount, 3);
  assert.equal(getImplantEffect(loadout({ implantIds: [] }), 'turnStartAoeDamage'), null);
});
