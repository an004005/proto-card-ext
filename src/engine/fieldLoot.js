// 확보 대상(§5단계, D10·D11) 파밍 결과를 뽑는 롤러. 보급품과 달리 확보 대상은 구역당 3~4개뿐이고
// 길고 시끄러운 대신 "후보 3개 중 1택"을 준다. 후보는 전부 그 지점의 역할축 안에서만 나온다 —
// 축이 섞이면 정찰로 축을 미리 본 의미가 사라지기 때문이다.
//
// 롤 로직 자체는 전투 보상(rewardEngine.js)과 같은 테이블을 써야 한다. 보상 테이블을 고쳤을 때
// 한쪽만 고쳐지는 사고를 막으려고 여기서는 롤러를 복제하지 않고 rewardEngine의 것을 그대로 쓴다.
// 다만 rollRewardSlots(장비 슬롯 + 게이트 슬롯 구조)는 역할축과 맞지 않으므로 쓰지 않는다.
import { rollEquipmentOptions, rollConsumableOptions, rollCurrencyOrJunkOptions } from './rewardEngine.js';
import { MAP_EQUIPMENT_CAPABILITIES } from '../data/facilityEquipmentCapabilities.js';
import { getAllEquipmentIds } from './inventoryReducer.js';
import { PRIZE_OPTION_COUNT } from '../data/facilityLayout.js';
import { CURRENCY_SLOT_ITEM_WEIGHTS, REWARD_CURRENCY_VALUE_RANGE } from '../data/rewardTables.js';

/** @typedef {import('./types.js').RngState} RngState */
/** @typedef {import('./types.js').FarmChoiceOption} FarmChoiceOption */
/** @typedef {'combat'|'infiltration'|'resource'} FieldLootAxis */

/**
 * MAP_EQUIPMENT_CAPABILITIES에 항목이 없지만 침투 도구인 장비의 예외 목록.
 * implant7("⑦ 지도")은 랜드마크 위치를 알려주는 정찰 도구라 성격이 분명히 침투 강화인데,
 * 그 효과가 Capability 테이블 밖(맵 공개 로직)에서 구현돼 있어 합산에 잡히지 않는다.
 * 테이블에 없다고 combat으로 떨어뜨리면 축이 거짓말을 하게 되므로 여기서 명시적으로 바로잡는다.
 */
const UNTABLED_INFILTRATION_EQUIPMENT = new Set(['implant7']);

/**
 * 장비가 어느 역할축에 속하는지 판정한다.
 * 기준은 전부 MAP_EQUIPMENT_CAPABILITIES에서 파생한다 — 축을 위한 별도 데이터를 만들면
 * 장비 수치를 고칠 때 축이 따라오지 않아 금방 어긋나기 때문이다.
 *
 * 판정: fieldAction이 있거나(현장 도구 자체가 침투 수단), capabilityModifiers의 "순합"이 0보다 크면
 * infiltration. 순합을 쓰는 이유는 force +1 / stealth -1 처럼 한쪽을 주고 한쪽을 뺏는 장비는
 * 경로의 대가를 줄여주지 않는 순수 전투 장비이기 때문이다(양수 하나로 판정하면 이들이 오분류된다).
 *
 * @param {string} equipmentId
 * @returns {'combat'|'infiltration'}
 */
export function axisOfEquipment(equipmentId) {
  const contract = MAP_EQUIPMENT_CAPABILITIES[equipmentId];
  if (!contract) return UNTABLED_INFILTRATION_EQUIPMENT.has(equipmentId) ? 'infiltration' : 'combat';
  if (contract.fieldAction) return 'infiltration';
  const net = Object.values(contract.capabilityModifiers).reduce((sum, v) => sum + v, 0);
  return net > 0 ? 'infiltration' : 'combat';
}

/**
 * 해당 축의 장비 id 목록. 카탈로그 순서를 그대로 보존하므로(정렬하지 않음) 같은 시드면 같은 결과다.
 * @param {'combat'|'infiltration'} axis
 * @returns {string[]}
 */
export function listEquipmentByAxis(axis) {
  return getAllEquipmentIds().filter((id) => axisOfEquipment(id) === axis);
}

/** 후보 동일성 판정 키 — 같은 장비/같은 소모품이 두 번 나오면 "선택"이 아니게 된다. */
function optionKey(option) {
  if (option.kind === 'equipment') return `equipment:${option.equipmentId}`;
  if (option.kind === 'consumable') return `consumable:${option.defId}`;
  return option.kind; // ammo / currency는 종류당 한 칸만 차지한다(값만 다른 후보는 선택지가 아니다)
}

/**
 * 이미 담긴 후보와 겹치지 않는 것만 추려 넣는다. 입력 배열은 건드리지 않는다.
 * @param {FarmChoiceOption[]} into
 * @param {Set<string>} seen
 * @param {FarmChoiceOption[]} candidates
 * @returns {FarmChoiceOption[]}
 */
function appendDistinct(into, seen, candidates) {
  const result = into.slice();
  for (const candidate of candidates) {
    if (result.length >= PRIZE_OPTION_COUNT) break;
    const key = optionKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

/**
 * 장비 축 후보 뽑기. rewardEngine.rollEquipmentOptions는 한 번에 REWARD_OPTIONS_PER_SLOT개까지만
 * 주므로, 모자라면 이미 뽑힌 id를 풀에서 빼고 다시 굴려 채운다(같은 장비가 두 번 나오지 않는다).
 * @param {string[]} pool
 * @param {FarmChoiceOption[]} current
 * @param {Set<string>} seen
 * @param {RngState} rngState
 * @returns {{options: FarmChoiceOption[], rngState: RngState}}
 */
function fillFromEquipmentPool(pool, current, seen, rngState) {
  let options = current;
  let rng = rngState;
  let remaining = pool.filter((id) => !seen.has(`equipment:${id}`));
  while (options.length < PRIZE_OPTION_COUNT && remaining.length > 0) {
    const rolled = rollEquipmentOptions(remaining, rng);
    rng = rolled.state;
    options = appendDistinct(options, seen, rolled.options);
    remaining = remaining.filter((id) => !seen.has(`equipment:${id}`));
  }
  return { options, rngState: rng };
}

/**
 * 자원 축 후보 뽑기 — 탄약·소모품·재화만 나온다(FarmChoiceOption에 junk kind가 없다).
 * 전투 보상과 같은 롤러를 써서 tier 처리(REWARD_CURRENCY_VALUE_RANGE[tier])도 그대로 따라간다.
 * 재화/탄약 롤은 3개를 주지만 kind가 겹칠 수 있으므로 종류별 한 칸만 남기고, 남는 칸은
 * 소모품 롤로 채운다 — 이러면 "지금 당장 버틸 수단"이 항상 서로 다른 셋이 된다.
 * @param {'normal'|'elite'} tier
 * @param {FarmChoiceOption[]} current
 * @param {Set<string>} seen
 * @param {RngState} rngState
 * @returns {{options: FarmChoiceOption[], rngState: RngState}}
 */
function fillFromResourcePool(tier, current, seen, rngState) {
  const cash = rollCurrencyOrJunkOptions(tier, CURRENCY_SLOT_ITEM_WEIGHTS, 'currency', REWARD_CURRENCY_VALUE_RANGE, rngState);
  let options = appendDistinct(current, seen, cash.options);
  let rng = cash.state;
  if (options.length < PRIZE_OPTION_COUNT) {
    const consumables = rollConsumableOptions(rng);
    rng = consumables.state;
    options = appendDistinct(options, seen, consumables.options);
  }
  return { options, rngState: rng };
}

/**
 * 확보 대상 하나를 파밍했을 때 고를 후보 3개를 뽑는다. 전부 같은 축이다.
 *
 * 축 풀이 모자라 3개를 못 채우면 (1) 반대 장비 축 (2) 자원 후보 순으로 보충한다 —
 * 축이 조금 흐려지는 편이 선택지가 사라지는 것보다 낫고, 중복 후보는 어떤 경우에도 만들지 않는다.
 * (현재 데이터로는 두 장비 축 모두 3종을 넘으므로 보충 경로는 실제로 타지 않는다.)
 *
 * @param {FieldLootAxis} axis 맵 생성 시 굴려 고정된 이 지점의 역할축.
 * @param {'normal'|'elite'} tier 확보 대상 등급 — 나오는 것의 값어치를 올린다.
 * @param {RngState} rngState
 * @returns {{options: FarmChoiceOption[], rngState: RngState}}
 */
export function rollFieldLootOptions(axis, tier, rngState) {
  const seen = new Set();

  if (axis === 'resource') {
    return fillFromResourcePool(tier, [], seen, rngState);
  }

  const other = axis === 'combat' ? 'infiltration' : 'combat';
  const primary = fillFromEquipmentPool(listEquipmentByAxis(axis), [], seen, rngState);
  if (primary.options.length >= PRIZE_OPTION_COUNT) return primary;

  const secondary = fillFromEquipmentPool(listEquipmentByAxis(other), primary.options, seen, primary.rngState);
  if (secondary.options.length >= PRIZE_OPTION_COUNT) return secondary;

  return fillFromResourcePool(tier, secondary.options, seen, secondary.rngState);
}
