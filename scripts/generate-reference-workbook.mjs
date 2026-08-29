import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ExcelJS from 'exceljs';

import { CARD_DEFINITIONS } from '../src/data/cards.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../src/data/equipment.js';
import { MODULE_DEFINITIONS } from '../src/data/modules.js';
import { IMPLANT_DEFINITIONS } from '../src/data/implants.js';
import { CONSUMABLE_DEFINITIONS } from '../src/data/consumables.js';
import { MONSTER_DEFINITIONS } from '../src/data/monsters.js';
import { STATUS_LABELS, POWER_LABELS } from '../src/data/statusEffects.js';
import { MAP_EQUIPMENT_CAPABILITIES } from '../src/data/facilityEquipmentCapabilities.js';
import * as FACILITY from '../src/data/facilityLayout.js';
import { BASE_MAX_HP, BASE_INVENTORY_CAPACITY, CONSUMABLE_SLOT_COUNT } from '../src/engine/loadoutReducer.js';
import { SLOT_LIMITS } from '../src/engine/inventoryReducer.js';
import { AMMO_STACK_SIZE } from '../src/engine/inventoryEngine.js';
import { MAX_DURABILITY } from '../src/engine/equipmentEngine.js';
import { LOOT_DURABILITY_MIN, LOOT_DURABILITY_MAX } from '../src/engine/rewardEngine.js';
import { HAND_SIZE, BASE_ENERGY, DURABILITY_DECAY_CHANCE } from '../src/engine/combatEngine.js';

const OUTPUT = path.resolve('docs/card-extraction-reference.xlsx');
const FONT = 'Arial';
const COLORS = {
  navy: '17324D',
  teal: '18A6A6',
  header: '24566B',
  pale: 'EAF5F5',
  line: 'D6E2E7',
  text: '172B3A',
  white: 'FFFFFF',
};

const KOREAN_TERMS = {
  attack: '공격', skill: '스킬', power: '파워', status_card: '상태이상 카드', burden: '과적 카드',
  melee: '근접', ranged: '원거리',
  self: '자신', enemy: '적', player: '플레이어', all_enemies: '모든 적',
  damage: '피해', block: '방어도', draw: '카드 뽑기', heal: '회복', reload: '장전',
  applyStatus: '상태이상 부여', applyStun: '스턴 부여', insertStatusCard: '상태이상 카드 삽입',
  exhaust: '소멸', discard: '버리기', gainOverload: '과부화 획득',
  temporary_barrier: '임시 차단막', snapshot_scan: '스냅샷 스캔', remote_intrusion: '원격 침투',
  edge: '통로', node_contents: '노드 내부', electronic_device: '전자 장치',
  perception: '지각', stealth: '은신', hacking: '해킹', mobility: '기동', force: '강행', deception: '기만',
  common: '일반', elite: '정예', boss: '보스',
  normal: '일반', true: '예', false: '아니오',
  weapon: '무기', top: '상의', bottom: '하의', module: '모듈', implant: '임플란트',
  kind: '유형', value: '수치', amount: '수치', target: '대상', status: '상태',
  count: '횟수', damage: '피해', hits: '타수', attackKind: '공격 종류',
  ignoresBlock: '방어 무시', duration: '지속 시간', timeCost: '시간 비용', overloadGain: '과부화',
  cooldown: '재사용 대기시간', range: '범위', targetKind: '대상 종류',
  defId: '카드 ID', equipmentId: '장비 ID', requiresWeapon: '필요 무기',
  insertStatusCard: '삽입 상태이상 카드', insertStatusCardCount: '상태이상 카드 수', summon: '소환', selfDestruct: '자폭',
  flee: '도주', stealCurrency: '재화 강탈', mapNoise: '소음',
  firearm: '총기', assassination: '암살', explosive: '폭발물', escape: '탈출', electronic: '전자 장치',
  hack: '해킹', safe: '신중', rush: '돌진',
};

const TERM_MAPPING_ROWS = Object.entries({ ...KOREAN_TERMS, ...STATUS_LABELS, ...POWER_LABELS })
  .map(([english, korean]) => ({ korean, english }))
  .sort((left, right) => left.korean.localeCompare(right.korean, 'ko'));

function koreanTerm(value) {
  return STATUS_LABELS[value] || POWER_LABELS[value] || KOREAN_TERMS[value] || value;
}

function koreanData(value) {
  if (Array.isArray(value)) return value.map(koreanData);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [koreanTerm(key), koreanData(item)]));
  }
  return typeof value === 'string' ? koreanTerm(value) : value;
}

function json(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value, (_, item) => item === Infinity ? 'Infinity' : item);
}

function koreanJson(value) {
  return json(koreanData(value));
}

function nameWithId(id, definitions) {
  if (!id) return '';
  return definitions[id]?.name ? `${definitions[id].name} (${id})` : id;
}

function cardList(value = []) {
  return value.map(({ defId, count }) => `${nameWithId(defId, CARD_DEFINITIONS)} ×${count}`).join(', ');
}

function capability(id) {
  const contract = MAP_EQUIPMENT_CAPABILITIES[id] || { capabilityModifiers: {}, fieldAction: null };
  const modifiers = Object.entries(contract.capabilityModifiers)
    .map(([key, value]) => `${koreanTerm(key)} ${value > 0 ? '+' : ''}${value}`)
    .join(', ');
  return { modifiers, fieldAction: koreanJson(contract.fieldAction) };
}

function categoryForConstant(name) {
  if (name.includes('EXIT') || name.includes('COLLAPSE')) return '탈출';
  if (name.includes('THREAT') || name.includes('ALERT') || name.includes('NOISE') || name.includes('INVESTIGATION')) return '위협·소음';
  if (name.includes('SECTOR') || name.includes('NODE') || name.includes('EDGE') || name.includes('GENERATION')) return '그래프';
  if (name.includes('CAMERA') || name.includes('GENERATOR') || name.includes('INTERFACE')) return '장치';
  if (name.includes('OPPORTUNITY') || name.includes('LANDMARK') || name.includes('KEY_DROP')) return '콘텐츠';
  if (name.includes('APPROACH') || name.includes('RECON') || name.includes('FARM') || name.includes('HACKING') || name.includes('FORCE') || name.includes('MOBILITY')) return '행동';
  if (name.includes('OVERLOAD')) return '과부화';
  return '기타';
}

function sheet(workbook, name, title, source, columns, rows) {
  const ws = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    properties: { defaultRowHeight: 18 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const end = columns.length;
  ws.mergeCells(1, 1, 1, end);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: FONT, size: 16, bold: true, color: { argb: COLORS.white } };
  ws.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  ws.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, end);
  ws.getCell(2, 1).value = `자동 생성 원본: ${source} · 수동 편집 금지 · npm run docs:reference`;
  ws.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: COLORS.text } };
  ws.getCell(2, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.pale } };
  ws.getCell(2, 1).alignment = { vertical: 'middle', wrapText: true };
  ws.getRow(2).height = 24;
  ws.getRow(3).height = 8;

  columns.forEach((column, index) => {
    const cell = ws.getCell(4, index + 1);
    cell.value = column.header;
    ws.getColumn(index + 1).width = column.width;
  });
  ws.getRow(4).height = 24;
  ws.getRow(4).eachCell((cell) => {
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  for (const item of rows) {
    const row = ws.addRow(columns.map((column) => item[column.key] ?? ''));
    row.font = { name: FONT, size: 9, color: { argb: COLORS.text } };
    row.alignment = { vertical: 'top' };
    row.eachCell((cell, colNumber) => {
      cell.alignment = {
        vertical: 'top',
        horizontal: columns[colNumber - 1].numeric ? 'right' : 'left',
        wrapText: true,
      };
      cell.border = { bottom: { style: 'hair', color: { argb: COLORS.line } } };
    });
    if (row.number % 2 === 0) {
      row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FAFB' } }; });
    }
  }
  if (rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: end } };
  return ws;
}

function buildWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Card Extraction';
  workbook.company = 'Card Extraction';
  workbook.created = new Date('2000-01-01T00:00:00Z');
  workbook.modified = new Date('2000-01-01T00:00:00Z');
  workbook.calcProperties.fullCalcOnLoad = false;

  const rules = [
    ['런 준비', '기본 최대 HP', BASE_MAX_HP, '런 시작 기본값', 'src/engine/loadoutReducer.js'],
    ['런 준비', '기본 인벤토리 용량', BASE_INVENTORY_CAPACITY, '임플란트 보너스 적용 전', 'src/engine/loadoutReducer.js'],
    ['런 준비', '무기 슬롯', SLOT_LIMITS.weapons, '빈 슬롯마다 맨손공격 3장', 'src/engine/inventoryReducer.js'],
    ['런 준비', '모듈 슬롯', SLOT_LIMITS.modules, '장착 모듈의 카드가 덱에 추가됨', 'src/engine/inventoryReducer.js'],
    ['런 준비', '임플란트 슬롯', SLOT_LIMITS.implantIds, '카드 없는 패시브', 'src/engine/inventoryReducer.js'],
    ['런 준비', '소모품 슬롯', CONSUMABLE_SLOT_COUNT, '퀵슬롯 장착 후 전투에서 사용', 'src/engine/loadoutReducer.js'],
    ['전투', '기본 에너지', BASE_ENERGY, '플레이어 턴 시작 시 회복', 'src/engine/combatEngine.js'],
    ['전투', '기본 드로우', HAND_SIZE, '추가 드로우 효과 적용 전', 'src/engine/combatEngine.js'],
    ['전투', '피해 소수점', '올림', '단계 보정과 취약 등 피해 계산에서 발생한 소수점은 올림. 약화 계산만 내림', 'src/engine/statusEngine.js'],
    ['과부화', '0단계', '0~29', '기본 수치와 기본 카드 비용', 'src/engine/overloadEngine.js'],
    ['과부화', '1단계', '30~69', '단계 적용 피해·방어도 +25%', 'src/engine/overloadEngine.js'],
    ['과부화', '2단계', '70~100', '단계 적용 피해·방어도 +25%, 모든 카드 비용 +1', 'src/engine/overloadEngine.js'],
    ['과부화', '100 초과', '초과 10당 올림 1장', '과부화를 즉시 100으로 고정하고 뽑을 더미 무작위 위치에 상태이상 카드 삽입', 'src/engine/combatEngine.js'],
    ['장비', '최대 내구도', MAX_DURABILITY, '임플란트 제외', 'src/engine/equipmentEngine.js'],
    ['장비', '드롭 내구도', `${LOOT_DURABILITY_MIN}~${LOOT_DURABILITY_MAX}`, '장비 드롭 생성 범위', 'src/engine/rewardEngine.js'],
    ['장비', '카드 사용 내구도 감소 확률', `${DURABILITY_DECAY_CHANCE * 100}%`, '장비 소속 카드 사용마다 판정, 전투 종료 후 적용', 'src/engine/combatEngine.js'],
    ['인벤토리', '탄약 더미 크기', AMMO_STACK_SIZE, '한 인벤토리 칸에 저장하는 최대 탄약', 'src/engine/inventoryEngine.js'],
    ['맵', '총 노드', FACILITY.TOTAL_NODES, `${FACILITY.SECTOR_IDS.length}구역 × ${FACILITY.NODES_PER_SECTOR}노드`, 'src/data/facilityLayout.js'],
    ['맵', '월드 틱', FACILITY.WORLD_TICK_INTERVAL, '시간 포인트마다 위협과 지속 상태 갱신', 'src/data/facilityLayout.js'],
    ['맵', '시설 붕괴', FACILITY.RUN_COLLAPSE_TIME, '도달 시 런 종료', 'src/data/facilityLayout.js'],
    ['탈출', 'A 비활성', FACILITY.EXIT_A_DISABLED_AT, '이후 새 개방 요청 불가', 'src/data/facilityLayout.js'],
    ['탈출', 'B 비활성', FACILITY.EXIT_B_DISABLED_AT, '이후 새 개방 요청 불가', 'src/data/facilityLayout.js'],
    ['탈출', '개방 요청 행동', FACILITY.EXIT_REQUEST_TIME, '요청 상호작용 시간', 'src/data/facilityLayout.js'],
    ['탈출', '개방 유지', FACILITY.EXIT_OPEN_WINDOW, '열린 뒤 추출 가능한 시간', 'src/data/facilityLayout.js'],
  ].map(([category, name, value, detail, source]) => ({ category, name, value, detail, source }));
  sheet(workbook, '규칙', '현재 구현 규칙', 'src/engine/*, src/data/facilityLayout.js', [
    { key: 'category', header: '분류', width: 14 },
    { key: 'name', header: '규칙', width: 25 },
    { key: 'value', header: '값', width: 18 },
    { key: 'detail', header: '동작', width: 58 },
    { key: 'source', header: '코드 원본', width: 34 },
  ], rules);

  sheet(workbook, '용어 매핑', '엑셀 표기 용어 매핑', 'scripts/generate-reference-workbook.mjs', [
    { key: 'korean', header: '한글 표기', width: 24 },
    { key: 'english', header: '영문 코드', width: 30 },
  ], TERM_MAPPING_ROWS);

  const cards = Object.values(CARD_DEFINITIONS).map((def) => ({
    id: def.id, name: def.name, type: def.type, attackKind: def.attackKind ?? '', cost: def.cost ?? '',
    ammoCost: def.ammoCost ?? '', overloadGain: def.overloadGain ?? 0, exhausts: !!def.exhausts,
    type: koreanTerm(def.type), attackKind: koreanTerm(def.attackKind ?? ''),
    exhausts: def.exhausts ? '예' : '아니오', stageScale: def.scalesWithStage ? '적용' : '미적용', unplayable: def.unplayable ? '예' : '아니오', innate: def.innate ? '예' : '아니오',
    retain: def.retain ? '예' : '아니오', volatile: def.volatile ? '예' : '아니오', sly: def.sly ? '예' : '아니오',
    requiresWeapon: nameWithId(def.requiresWeapon, WEAPON_DEFINITIONS), condition: koreanJson(Object.fromEntries(Object.entries({ requiresLoadedAtMost: def.requiresLoadedAtMost, scalesBy: def.scalesBy, scalesByAmount: def.scalesByAmount }).filter(([, value]) => value !== undefined))),
    noise: def.mapTags?.noise ?? '', traits: def.mapTags?.traits?.map(koreanTerm).join(', ') ?? '',
    disengage: def.mapTags?.disengageProgress ?? '', effects: koreanJson(def.stageTable ?? def.effects ?? []), description: def.description ?? '',
  }));
  sheet(workbook, '카드 일람', '카드 일람', 'src/data/cards.js', [
    { key: 'id', header: '카드 ID', width: 28 }, { key: 'name', header: '이름', width: 20 },
    { key: 'type', header: '타입', width: 11 }, { key: 'attackKind', header: '공격 종류', width: 12 },
    { key: 'cost', header: '에너지', width: 9, numeric: true }, { key: 'ammoCost', header: '탄약', width: 8, numeric: true },
    { key: 'overloadGain', header: '과부화', width: 9, numeric: true }, { key: 'exhausts', header: '소멸', width: 8 },
    { key: 'stageScale', header: '단계 보정', width: 10 }, { key: 'unplayable', header: '사용 불가', width: 10 },
    { key: 'innate', header: '선천성', width: 8 }, { key: 'retain', header: '보존', width: 8 },
    { key: 'volatile', header: '휘발성', width: 8 }, { key: 'sly', header: '교활', width: 8 },
    { key: 'requiresWeapon', header: '필요 무기', width: 18 }, { key: 'condition', header: '추가 조건', width: 34 },
    { key: 'noise', header: '소음', width: 8, numeric: true }, { key: 'traits', header: '맵 특성', width: 28 },
    { key: 'disengage', header: '이탈', width: 8, numeric: true }, { key: 'effects', header: '효과 데이터', width: 64 },
    { key: 'description', header: '설명', width: 58 },
  ], cards);

  const equipmentRows = (definitions, subtype = '') => Object.values(definitions).map((def) => {
    const map = capability(def.id);
    return { id: def.id, name: def.name, subtype, slot: koreanTerm(def.slot), maxLoad: def.maxLoadBonus ?? '', cards: cardList(def.cardList), capability: map.modifiers, fieldAction: map.fieldAction };
  });
  const equipmentColumns = [
    { key: 'id', header: '장비 ID', width: 28 }, { key: 'name', header: '이름', width: 22 },
    { key: 'subtype', header: '종류', width: 12 }, { key: 'slot', header: '슬롯', width: 11 },
    { key: 'maxLoad', header: '장전 상한', width: 11, numeric: true }, { key: 'cards', header: '제공 카드', width: 60 },
    { key: 'capability', header: 'Capability', width: 42 }, { key: 'fieldAction', header: '능동 현장 효과', width: 64 },
  ];
  sheet(workbook, '무기', '무기 스펙', 'src/data/equipment.js, src/data/facilityEquipmentCapabilities.js', equipmentColumns, equipmentRows(WEAPON_DEFINITIONS, '무기'));
  sheet(workbook, '방어구', '방어구 스펙', 'src/data/equipment.js, src/data/facilityEquipmentCapabilities.js', equipmentColumns,
    [...equipmentRows(ARMOR_TOP_DEFINITIONS, '상의'), ...equipmentRows(ARMOR_BOTTOM_DEFINITIONS, '하의')]);
  sheet(workbook, '모듈', '모듈 스펙', 'src/data/modules.js, src/data/facilityEquipmentCapabilities.js', equipmentColumns, equipmentRows(MODULE_DEFINITIONS, '모듈'));

  const implants = Object.values(IMPLANT_DEFINITIONS).map((def) => {
    const map = capability(def.id);
    return { id: def.id, name: def.name, floor: def.floorOverload, effect: koreanJson(def.effect), description: def.description, capability: map.modifiers, fieldAction: map.fieldAction };
  });
  sheet(workbook, '임플란트', '임플란트 스펙', 'src/data/implants.js, src/data/facilityEquipmentCapabilities.js', [
    { key: 'id', header: '임플란트 ID', width: 18 }, { key: 'name', header: '이름', width: 22 },
    { key: 'floor', header: '과부화 하한', width: 13, numeric: true }, { key: 'effect', header: '패시브 효과 데이터', width: 52 },
    { key: 'description', header: '설명', width: 36 }, { key: 'capability', header: 'Capability', width: 36 },
    { key: 'fieldAction', header: '능동 현장 효과', width: 50 },
  ], implants);

  const monsters = Object.values(MONSTER_DEFINITIONS).map((def) => ({
    id: def.id, name: def.name, tier: koreanTerm(def.tier), hp: def.hp, machine: def.isMachine ? '예' : '아니오',
    standingArmor: def.standingArmor ?? '', startingStatuses: koreanJson(def.startingStatuses ?? {}),
    phaseThreshold: def.phaseTransitionHpFraction ?? '', phase1Actions: def.sequence.length,
    phase2Actions: def.phase2Sequence?.length ?? 0,
  }));
  sheet(workbook, '몬스터 스펙', '몬스터 스펙', 'src/data/monsters.js', [
    { key: 'id', header: '몬스터 ID', width: 28 }, { key: 'name', header: '이름', width: 24 },
    { key: 'tier', header: '등급', width: 11 }, { key: 'hp', header: 'HP', width: 9, numeric: true },
    { key: 'machine', header: '기계', width: 8 }, { key: 'standingArmor', header: '고정 갑옷', width: 11, numeric: true },
    { key: 'startingStatuses', header: '시작 상태', width: 38 }, { key: 'phaseThreshold', header: '2단계 HP 비율', width: 15 },
    { key: 'phase1Actions', header: '1단계 행동 수', width: 13, numeric: true }, { key: 'phase2Actions', header: '2단계 행동 수', width: 13, numeric: true },
  ], monsters);

  const monsterActions = [];
  const addActions = (monster, sequence, phase) => sequence.forEach((entry, index) => {
    const branches = entry.random ?? [{ weight: '', move: entry }];
    branches.forEach((branch) => {
      const move = branch.move;
      monsterActions.push({ monsterId: monster.id, monster: monster.name, tier: koreanTerm(monster.tier), phase, order: index + 1,
        weight: branch.weight ?? '', moveId: move.id, damage: move.damage ?? 0, hits: move.hits ?? 1,
        mapNoise: move.mapNoise, effects: koreanJson(move.effects ?? []), statusCard: nameWithId(move.insertStatusCard, CARD_DEFINITIONS),
        statusCardCount: move.insertStatusCardCount ?? '', summon: nameWithId(move.summon, MONSTER_DEFINITIONS), selfDestruct: move.selfDestruct ? '예' : '아니오',
        flee: move.flee ? '예' : '아니오', stealCurrency: move.stealCurrency ?? '' });
    });
  });
  Object.values(MONSTER_DEFINITIONS).forEach((monster) => {
    addActions(monster, monster.sequence, 1);
    if (monster.phase2Sequence) addActions(monster, monster.phase2Sequence, 2);
  });
  sheet(workbook, '몬스터 행동', '몬스터 상세 행동', 'src/data/monsters.js', [
    { key: 'monsterId', header: '몬스터 ID', width: 27 }, { key: 'monster', header: '몬스터', width: 22 },
    { key: 'tier', header: '등급', width: 10 }, { key: 'phase', header: '단계', width: 8, numeric: true },
    { key: 'order', header: '순서', width: 8, numeric: true }, { key: 'weight', header: '분기 가중치', width: 11, numeric: true },
    { key: 'moveId', header: '행동 ID', width: 25 }, { key: 'damage', header: '피해', width: 8, numeric: true },
    { key: 'hits', header: '타수', width: 8, numeric: true }, { key: 'mapNoise', header: '소음', width: 8, numeric: true },
    { key: 'effects', header: '효과', width: 58 }, { key: 'statusCard', header: '삽입 상태이상 카드', width: 24 },
    { key: 'statusCardCount', header: '상태이상 카드 수', width: 14, numeric: true }, { key: 'summon', header: '소환', width: 22 },
    { key: 'selfDestruct', header: '자폭', width: 8 }, { key: 'flee', header: '도주', width: 8 },
    { key: 'stealCurrency', header: '재화 강탈', width: 10 },
  ], monsterActions);

  const mapRows = Object.entries(FACILITY)
    .filter(([, value]) => typeof value !== 'function')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => ({ category: categoryForConstant(id), id, value: koreanJson(value), source: 'src/data/facilityLayout.js' }));
  sheet(workbook, '맵 구성요소', '맵 구성요소와 상수', 'src/data/facilityLayout.js', [
    { key: 'category', header: '분류', width: 15 }, { key: 'id', header: '상수 ID', width: 42 },
    { key: 'value', header: '현재 값', width: 90 }, { key: 'source', header: '코드 원본', width: 34 },
  ], mapRows);

  return workbook;
}

function comparable(workbook) {
  return workbook.worksheets.map((ws) => ({
    name: ws.name,
    rows: Array.from({ length: ws.rowCount }, (_, rowIndex) =>
      Array.from({ length: ws.columnCount }, (_, colIndex) => {
        const value = ws.getCell(rowIndex + 1, colIndex + 1).value;
        if (value instanceof Date) return value.toISOString();
        if (value && typeof value === 'object') return JSON.stringify(value);
        return value ?? '';
      })),
  }));
}

const workbook = buildWorkbook();
if (process.argv.includes('--check')) {
  const current = new ExcelJS.Workbook();
  try {
    await current.xlsx.readFile(OUTPUT);
  } catch {
    console.error(`참조 엑셀이 없습니다: ${OUTPUT}`);
    process.exit(1);
  }
  if (JSON.stringify(comparable(current)) !== JSON.stringify(comparable(workbook))) {
    console.error('참조 엑셀이 현재 코드와 다릅니다. npm run docs:reference를 실행하세요.');
    process.exit(1);
  }
  console.log('참조 엑셀이 현재 코드와 일치합니다.');
} else {
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await workbook.xlsx.writeFile(OUTPUT);
  console.log(`생성 완료: ${OUTPUT}`);
}
