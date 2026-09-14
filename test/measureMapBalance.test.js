// scripts/measure-map-balance.mjs의 스모크 테스트. 측정값 자체(밸런스)는 검증하지 않는다 —
// 표의 구조와 수치 정합성만 본다: 출구 A 배치(ADR-0083)와 "여유 = 마감 − 거리".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, formatReport, parseArgs, MOBILITY_VALUES } from '../scripts/measure-map-balance.mjs';
import {
  RUN_COLLAPSE_TIME, EXIT_A_DISABLED_AT, EXIT_ACTIVATE_TIME_BY_HACKING,
} from '../src/data/facilityLayout.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';

const SEEDS = [1, 2, 3];
const EXIT_OVERHEAD = EXIT_ACTIVATE_TIME_BY_HACKING[2];

test('측정 결과는 시드마다 Mobility 네 값을 모두 담는다', () => {
  const result = measure(SEEDS);
  assert.deepEqual(result.seeds, SEEDS);
  assert.equal(result.seedResults.length, SEEDS.length);
  for (const seedResult of result.seedResults) {
    assert.equal(Object.keys(seedResult.byMobility).length, MOBILITY_VALUES.length);
    for (const mobility of MOBILITY_VALUES) {
      const entry = seedResult.byMobility[mobility];
      assert.ok(entry, `Mobility ${mobility} 누락`);
      // 한 런은 네 구역만 쓰므로(ADR-0081) 그 구역에 목표부가 있는 계약만 측정 대상이다.
      const expected = CONTRACT_DEFS.filter((def) => seedResult.sectorIds.includes(def.sectorId));
      assert.ok(expected.length >= 1, `시드 ${seedResult.seed}: 잴 계약이 하나도 없다`);
      assert.deepEqual(new Set(Object.keys(entry.contracts)), new Set(expected.map((def) => def.id)));
    }
  }
});

test('기록된 출구 A 거리는 Mobility 0 · 개방 없이 실측과 같다', () => {
  const result = measure(SEEDS);
  for (const seedResult of result.seedResults) {
    const { exitAWalkDistance } = seedResult.exitPlacement;
    assert.equal(typeof exitAWalkDistance, 'number');
    // 배치 판정은 Mobility 0 · 개방 없이 기준이므로 그 Mobility의 실측과 같아야 한다.
    assert.equal(seedResult.byMobility[0].exits.A.walk, exitAWalkDistance, `시드 ${seedResult.seed}: 실측 A 거리`);
  }
});

test('여유는 마감에서 최단거리를 뺀 값이다', () => {
  const result = measure(SEEDS);
  for (const seedResult of result.seedResults) {
    for (const mobility of MOBILITY_VALUES) {
      const { exits, slack } = seedResult.byMobility[mobility];
      assert.equal(slack.exitA, EXIT_A_DISABLED_AT - exits.A.walk);
      assert.equal(slack.collapseViaA, RUN_COLLAPSE_TIME - exits.A.walk - EXIT_OVERHEAD);
      // 문을 열면 절대 더 멀어지지 않는다(같은 그래프에 간선만 더한 것이므로).
      for (const exitId of ['A', 'key']) {
        assert.ok(exits[exitId].open <= exits[exitId].walk, `${exitId}: 개방 경로가 더 길 수 없다`);
      }
    }
  }
});

test('계약 왕복은 확보 시각과 완료 행동을 함께 계산한다', () => {
  const result = measure(SEEDS);
  for (const seedResult of result.seedResults) {
    for (const mobility of MOBILITY_VALUES) {
      for (const def of CONTRACT_DEFS) {
        const entry = seedResult.byMobility[mobility].contracts[def.id];
        if (!entry) continue; // 이 시드가 뽑지 않은 구역의 계약
        // 봉쇄는 목표부 행동이 끝나는 순간 켜진다 — 파괴 계약도 설치 완료 시각이 기준이고
        // 기폭 시각이 아니다(C5).
        assert.equal(entry.acquiredAt, entry.toObjective + entry.actionCost);
        assert.ok(entry.actionCost > 0);
        // 봉쇄는 출구를 앞당겨 닫지 않는다(ADR-0083) — A는 자기 폐쇄 시각, 열쇠는 마감 없음.
        assert.equal(entry.legs.A.deadline, EXIT_A_DISABLED_AT);
        assert.equal(entry.legs.key.deadline, Infinity);
        // 목표부를 떠난 뒤에도 완료 행동이 남는 계약이 있다(파괴=기폭 2칸, 정보=송출 5칸).
        assert.equal(entry.completionCost > 0, def.type !== 'retrieval');
        for (const exitId of ['A', 'key']) {
          const leg = entry.legs[exitId];
          assert.equal(leg.total, entry.acquiredAt + leg.leg + entry.completionCost);
          assert.equal(leg.slack, leg.deadline - leg.total);
        }
      }
    }
  }
});

test('표 출력은 여섯 절을 모두 담는다', () => {
  const report = formatReport(measure(SEEDS));
  for (const heading of ['## 1. 그래프 형태', '## 2. 시작점', '## 3. 마감별 여유', '## 4. 행동 예산', '## 5. 적 압박', '## 6. 계약 왕복']) {
    assert.ok(report.includes(heading), `${heading} 누락`);
  }
  assert.ok(report.includes(`붕괴 ${RUN_COLLAPSE_TIME}`));
});

test('--seeds 는 범위를 그대로 펼친다', () => {
  assert.deepEqual(parseArgs(['--seeds', '4..7']).seeds, [4, 5, 6, 7]);
  assert.equal(parseArgs([]).seeds.length, 30);
  assert.equal(parseArgs(['--json']).json, '-');
  assert.equal(parseArgs(['--json', 'out.json']).json, 'out.json');
  assert.throws(() => parseArgs(['--seeds', 'abc']));
});
