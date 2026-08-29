import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeckFromLoadout, computeFloorOverload, computeMaxHpBonus, computeInventoryCapacityBonus,
  computeOverloadGainMultiplier, getImplantEffect, computeMaxLoadBonus, computeDamagedStatusCardEntries,
  applyDurabilityDecay, MAX_DURABILITY,
} from '../src/engine/equipmentEngine.js';

/** @param {string} equipmentId @param {string} id @param {number} [durability] */
function equipItem(equipmentId, id, durability = MAX_DURABILITY) {
  return { id, kind: 'equipment', equipmentId, durability };
}

function loadout(overrides = {}) {
  return {
    weapons: [equipItem('katana', 'w1')], top: equipItem('light_top', 't1'), bottom: equipItem('tactical_bottom', 'b1'),
    modules: [], implantIds: [], ...overrides,
  };
}

function defIds(entries) {
  return entries.map((e) => e.defId);
}

test('buildDeckFromLoadout expands each equipped item\'s full card list with counts, tagged with the source instance', () => {
  const deck = buildDeckFromLoadout(loadout());
  const counts = deck.reduce((m, e) => ({ ...m, [e.defId]: (m[e.defId] || 0) + 1 }), {});
  assert.equal(counts.katana_slash, 2);
  assert.equal(counts.katana_parry, 1);
  assert.equal(counts.light_top_dodge, 2);
  assert.equal(counts.light_top_deflect, 1);
  assert.equal(counts.tactical_bottom_feint, 1);
  assert.ok(deck.filter((e) => e.defId === 'katana_slash').every((e) => e.equipmentInstanceId === 'w1'));
  assert.ok(deck.filter((e) => e.defId === 'light_top_dodge').every((e) => e.equipmentInstanceId === 't1'));
});

test('무기/상의/하의 미장착 슬롯 1칸당 맨손공격/어설픈 회피 3장씩 덱에 보충된다', () => {
  const fullyGeared = defIds(buildDeckFromLoadout(loadout({ weapons: [equipItem('katana', 'w1'), equipItem('dagger', 'w2')] })));
  assert.equal(fullyGeared.filter((id) => id === 'bare_hands_attack').length, 0);
  assert.equal(fullyGeared.filter((id) => id === 'clumsy_dodge').length, 0);

  const oneWeapon = defIds(buildDeckFromLoadout(loadout({ weapons: [equipItem('katana', 'w1')] }))); // 1/2 무기 슬롯 빈칸
  assert.equal(oneWeapon.filter((id) => id === 'bare_hands_attack').length, 3);

  const noWeapon = defIds(buildDeckFromLoadout(loadout({ weapons: [] }))); // 2/2 무기 슬롯 빈칸
  assert.equal(noWeapon.filter((id) => id === 'bare_hands_attack').length, 6);

  const noArmor = defIds(buildDeckFromLoadout(loadout({ top: null, bottom: null }))); // 상/하의 둘 다 빈칸
  assert.equal(noArmor.filter((id) => id === 'clumsy_dodge').length, 6);

  const noTopOnly = defIds(buildDeckFromLoadout(loadout({ top: null })));
  assert.equal(noTopOnly.filter((id) => id === 'clumsy_dodge').length, 3);
});

test('돌진 베기 only enters the deck when 카타나 is equipped alongside 신체 강화', () => {
  const withKatana = defIds(buildDeckFromLoadout(loadout({ weapons: [equipItem('katana', 'w1')], modules: [equipItem('module_body', 'm1')] })));
  assert.ok(withKatana.includes('module_charge_slash'));
  assert.ok(withKatana.includes('module_body_boost'));

  const withoutKatana = defIds(buildDeckFromLoadout(loadout({ weapons: [equipItem('dagger', 'w1')], modules: [equipItem('module_body', 'm1')] })));
  assert.ok(!withoutKatana.includes('module_charge_slash'));
  assert.ok(withoutKatana.includes('module_body_boost')); // the power card itself is unaffected
});

test('같은 무기 두 자루를 동시 장착하면 각자의 카드가 서로 다른 인스턴스에 태깅된다 (§신규 인스턴스화, 중복 허용)', () => {
  const deck = buildDeckFromLoadout(loadout({ weapons: [equipItem('pistol', 'w1'), equipItem('pistol', 'w2')] }));
  const instanceIds = new Set(deck.filter((e) => e.defId === 'pistol_shot').map((e) => e.equipmentInstanceId));
  assert.deepEqual([...instanceIds].sort(), ['w1', 'w2']);
});

test('computeMaxLoadBonus sums maxLoadBonus across equipped weapons (§신규 재장전)', () => {
  assert.equal(computeMaxLoadBonus(loadout({ weapons: [equipItem('pistol', 'w1')] })), 3);
  assert.equal(computeMaxLoadBonus(loadout({ weapons: [equipItem('rifle', 'w1')] })), 5);
  assert.equal(computeMaxLoadBonus(loadout({ weapons: [equipItem('pistol', 'w1'), equipItem('rifle', 'w2')] })), 8);
  assert.equal(computeMaxLoadBonus(loadout({ weapons: [equipItem('katana', 'w1')] })), 0);
});

test('computeDamagedStatusCardEntries inserts (4-durability) status cards per equipped weapon/top/bottom/module, never for implants', () => {
  assert.deepEqual(computeDamagedStatusCardEntries(loadout({ weapons: [equipItem('katana', 'w1', MAX_DURABILITY)] })), []);
  assert.equal(computeDamagedStatusCardEntries(loadout({ weapons: [equipItem('katana', 'w1', 1)] })).length, 3);
  assert.equal(computeDamagedStatusCardEntries(loadout({ weapons: [equipItem('katana', 'w1', 0)] })).length, 4);
  assert.ok(computeDamagedStatusCardEntries(loadout({ weapons: [equipItem('katana', 'w1', 0)] })).every((e) => e.defId === 'equipment_damaged_status_card'));
});

test('applyDurabilityDecay decrements per instance and destroys at 0, leaving other slots untouched', () => {
  const l = loadout({ weapons: [equipItem('katana', 'w1', 2)], modules: [equipItem('module_body', 'm1', 5)] });
  const result = applyDurabilityDecay(l, ['w1', 'w1', 'm1']);
  assert.equal(result.destroyedItems.length, 1);
  assert.equal(result.destroyedItems[0].id, 'w1');
  assert.equal(result.loadout.weapons.length, 0);
  assert.equal(result.loadout.modules[0].durability, 4);
  assert.deepEqual(result.changes.find((c) => c.itemId === 'w1'), { itemId: 'w1', equipmentId: 'katana', from: 2, to: 0 });
});

test('applyDurabilityDecay is a no-op when nothing decayed this combat', () => {
  const l = loadout();
  const result = applyDurabilityDecay(l, []);
  assert.equal(result.loadout, l);
  assert.deepEqual(result.destroyedItems, []);
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
