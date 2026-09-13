// #18/#19 데이터 검증: 실행 가능한 카드/소모품은 전부 mapTags를, 몬스터의 모든 move는 전부
// mapNoise를 갖는다 (docs/card-map-tag-mapping.md). 새 정의가 매핑 없이 추가되면 여기서 실패한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_DEFINITIONS } from '../src/data/cards.js';
import { CONSUMABLE_DEFINITIONS } from '../src/data/consumables.js';
import { MONSTER_DEFINITIONS } from '../src/data/monsters.js';

const NOT_EXECUTABLE = new Set([
  'junk_item', 'currency_item', 'equipment_item', 'ammo_item', 'consumable_item', 'contract_goods_item',
  'infected_status_card', 'wound_status_card', 'dizziness_status_card', 'mucus_status_card', 'offering_status_card',
]);

const VALID_TRAITS = new Set([
  'assassination', 'melee', 'firearm', 'explosive', 'hack', 'deception', 'escape',
  'perception', 'electronic', 'healing', 'stabilize',
]);

function assertValidMapTags(mapTags, label) {
  assert.ok(mapTags, `${label}: missing mapTags`);
  assert.ok([0, 1, 2, 3].includes(mapTags.noise), `${label}: noise ${mapTags.noise} out of 0..3`);
  assert.ok(Array.isArray(mapTags.traits), `${label}: traits must be an array`);
  for (const trait of mapTags.traits) assert.ok(VALID_TRAITS.has(trait), `${label}: unknown trait ${trait}`);
  assert.ok([0, 1].includes(mapTags.disengageProgress), `${label}: disengageProgress ${mapTags.disengageProgress} out of 0..1`);
}

test('every executable card defines valid mapTags; excluded (non-executable) cards do not need it', () => {
  for (const [id, def] of Object.entries(CARD_DEFINITIONS)) {
    if (NOT_EXECUTABLE.has(id)) continue;
    assertValidMapTags(def.mapTags, `card ${id}`);
  }
});

test('non-executable card IDs match the doc-authored exclusion list exactly', () => {
  const actuallyExcluded = Object.keys(CARD_DEFINITIONS).filter((id) => !CARD_DEFINITIONS[id].mapTags);
  assert.deepEqual(actuallyExcluded.sort(), [...NOT_EXECUTABLE].sort());
});

test('every consumable defines valid mapTags', () => {
  for (const [id, def] of Object.entries(CONSUMABLE_DEFINITIONS)) {
    assertValidMapTags(def.mapTags, `consumable ${id}`);
  }
});

test('every monster move (including random branches and 2페이즈 시퀀스) defines mapNoise 0..3', () => {
  for (const [monsterId, def] of Object.entries(MONSTER_DEFINITIONS)) {
    // 보스의 2페이즈 시퀀스도 실제로 실행되는 행동이다 — 여기를 돌지 않으면 phase2Sequence에
    // mapNoise를 빼먹어도 아무도 알려주지 않는다(리뷰 A8).
    for (const sequence of [def.sequence, def.phase2Sequence].filter(Boolean)) {
      for (const entry of sequence) {
        const moves = entry.random ? entry.random.map((branch) => branch.move) : [entry];
        for (const move of moves) {
          assert.ok([0, 1, 2, 3].includes(move.mapNoise), `${monsterId}.${move.id}: mapNoise ${move.mapNoise} out of 0..3`);
        }
      }
    }
  }
});
