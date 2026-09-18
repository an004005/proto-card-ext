import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ExcelJS from 'exceljs';

import { CARD_DEFINITIONS } from '../src/data/cards.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../src/data/equipment.js';
import { MODULE_DEFINITIONS } from '../src/data/modules.js';
import { IMPLANT_DEFINITIONS } from '../src/data/implants.js';
import { CONSUMABLE_DEFINITIONS } from '../src/data/consumables.js';
import { LOADOUT_PRESETS } from '../src/data/loadoutPresets.js';
import { MONSTER_DEFINITIONS } from '../src/data/monsters.js';
import { axisOfEquipment } from '../src/engine/fieldLoot.js';
import { STATUS_LABELS, POWER_LABELS } from '../src/data/statusEffects.js';
import { MAP_EQUIPMENT_CAPABILITIES, INJURY_PENALTY_STEPS } from '../src/data/facilityEquipmentCapabilities.js';
import * as FACILITY from '../src/data/facilityLayout.js';
import { BASE_MAX_HP, BASE_INVENTORY_CAPACITY, CONSUMABLE_SLOT_COUNT, previewPresetCapabilities } from '../src/engine/loadoutReducer.js';
import { SLOT_LIMITS } from '../src/engine/inventoryReducer.js';
import { AMMO_STACK_SIZE } from '../src/engine/inventoryEngine.js';
import { MAX_DURABILITY } from '../src/engine/equipmentEngine.js';
import { LOOT_DURABILITY_MIN, LOOT_DURABILITY_MAX } from '../src/engine/rewardEngine.js';
import { HAND_SIZE, BASE_ENERGY, DURABILITY_DECAY_CHANCE } from '../src/engine/combatEngine.js';
import { MAP_EQUIP_TIME_COST, MAP_CONSUMABLE_TIME_COST } from '../src/engine/actionCosts.js';
import { TIMELINE_HORIZON } from '../src/engine/mapTimeline.js';

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
  block: '방어도', draw: '카드 뽑기', heal: '회복', reload: '장전',
  applyStatus: '상태이상 부여', applyStun: '스턴 부여',
  exhaust: '소멸', discard: '버리기',
  temporary_barrier: '임시 차단막', snapshot_scan: '스냅샷 스캔', remote_intrusion: '원격 침투',
  edge: '통로', node_contents: '노드 내부', electronic_device: '전자 장치',
  // Capability 6종 — 용어집(docs/terminology.md)과 같은 이름을 쓴다.
  perception: '지각', stealth: '은신', hacking: '해킹', mobility: '기동', force: '파괴', deception: '기만',
  common: '일반', elite: '정예', boss: '보스',
  normal: '일반', true: '예', false: '아니오',
  weapon: '무기', top: '상의', bottom: '하의', module: '모듈', implant: '임플란트',
  kind: '유형', value: '수치', amount: '수치', target: '대상', status: '상태',
  count: '횟수', damage: '피해', hits: '타수', attackKind: '공격 종류',
  ignoresBlock: '방어 무시', duration: '지속 시간', timeCost: '시간 비용',
  cooldown: '재사용 대기시간', range: '범위', targetKind: '대상 종류',
  defId: '카드 ID', equipmentId: '장비 ID', requiresWeapon: '필요 무기',
  insertStatusCard: '삽입 상태이상 카드', insertStatusCardCount: '상태이상 카드 수', summon: '소환', selfDestruct: '자폭',
  flee: '도주', stealCurrency: '재화 강탈', mapNoise: '소음',
  firearm: '총기', assassination: '암살', explosive: '폭발물', escape: '탈출', electronic: '전자 장치',
  // 접근 방식 3종(안전/표준/강행) — 맵 화면 버튼과 같은 이름이어야 한다.
  hack: '해킹', safe: '안전', rush: '강행',
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
  // 역할축은 이 계약에서 파생된다(engine/fieldLoot.js) — 엑셀에도 같이 실어 현장 보상 풀이
  // 어떤 근거로 갈리는지 표 한 장에서 읽히게 한다.
  const axis = axisOfEquipment(id) === 'infiltration' ? '침투' : '전투';
  return { modifiers, fieldAction: koreanJson(contract.fieldAction), mapInfo: contract.mapInfoEffect ? '예' : '', axis };
}

/** 프리셋 시트가 id 대신 사람이 읽는 이름을 적기 위한 표. @type {Object.<string, string>} */
const EQUIPMENT_AND_CONSUMABLE_NAME = Object.fromEntries(
  [WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS, MODULE_DEFINITIONS, IMPLANT_DEFINITIONS, CONSUMABLE_DEFINITIONS]
    .flatMap((definitions) => Object.values(definitions).map((def) => [def.id, def.name])),
);

function categoryForConstant(name) {
  if (name.includes('EXIT') || name.includes('COLLAPSE')) return '탈출';
  if (name.includes('THREAT') || name.includes('ALERT') || name.includes('NOISE') || name.includes('INVESTIGATION')) return '위협·소음';
  if (name.includes('SECTOR') || name.includes('NODE') || name.includes('EDGE') || name.includes('GENERATION')) return '그래프';
  if (name.includes('CAMERA') || name.includes('GENERATOR') || name.includes('INTERFACE')) return '장치';
  if (name.includes('OPPORTUNITY') || name.includes('LANDMARK') || name.includes('KEY_DROP')) return '콘텐츠';
  if (name.includes('COMBAT')) return '전투';
  if (name.includes('WAIT') || name.includes('EVADE')) return '행동';
  if (name.includes('APPROACH') || name.includes('RECON') || name.includes('FARM') || name.includes('HACKING') || name.includes('FORCE') || name.includes('MOBILITY')) return '행동';
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
    ['과부화', '0단계 (OFF)', '토글 꺼짐', '기본 수치와 기본 카드 비용', 'src/engine/overloadEngine.js'],
    ['과부화', '1단계 (ON)', '토글 켜짐', '단계 적용 피해·방어도 +25%, 모듈 보정 상향', 'src/engine/overloadEngine.js'],
    ['과부화', '전환 대가', '없음', '지도와 전투 플레이어 턴에서 언제든 무료로 전환', 'src/engine/combatReducer.js'],
    ['장비', '최대 내구도', MAX_DURABILITY, '임플란트 제외', 'src/engine/equipmentEngine.js'],
    ['장비', '드롭 내구도', `${LOOT_DURABILITY_MIN}~${LOOT_DURABILITY_MAX}`, '장비 드롭 생성 범위', 'src/engine/rewardEngine.js'],
    ['장비', '카드 사용 내구도 감소 확률', `${DURABILITY_DECAY_CHANCE * 100}%`, '장비 소속 카드 사용마다 판정, 전투 종료 후 적용', 'src/engine/combatEngine.js'],
    ['인벤토리', '탄약 더미 크기', AMMO_STACK_SIZE, '한 인벤토리 칸에 저장하는 최대 탄약', 'src/engine/inventoryEngine.js'],
    ['맵', '구역 추첨', `${FACILITY.RUN_SECTOR_COUNT}구역 / 전체 ${FACILITY.ALL_SECTOR_IDS.length}구역`, `계약 제안마다 미리 뽑아 계약 화면에 보여주고, 수락은 그 목록을 그대로 쓴다(ADR-0089). 입구·관리동과 그 계약의 목표 구역은 항상 포함되고 나머지를 균등 추첨. 링 정반대(가장 깊은 자리)는 동력·정비동이 뽑혔으면 동력·정비동, 아니면 계약 목표 구역이다(ADR-0083)`, 'src/engine/facilityGraph.js'],
    ['맵', '총 노드', `${FACILITY.totalNodesFor(['entrance', 'hangar', 'comms', 'security'])}~${FACILITY.totalNodesFor(['entrance', 'residential', 'waste', 'labs'])}`, `뽑힌 구역 합. 구역별 ${FACILITY.ALL_SECTOR_IDS.map((id) => `${FACILITY.SECTOR_NAMES[id]} ${FACILITY.SECTOR_LAYOUTS[id].nodeCount}`).join(' / ')}`, 'src/data/facilityLayout.js'],
    ['맵', '시간 단위', '1칸', '맵의 모든 시각·비용·지속·예약은 정수 칸이다. 1칸마다 월드를 한 번 갱신한다', 'src/engine/runEngine.js'],
    ['맵', '시설 붕괴', FACILITY.RUN_COLLAPSE_TIME, '이 시각에 도달하면 런 종료(마감과 같은 시각 도착은 늦은 것)', 'src/data/facilityLayout.js'],
    ['맵', '이동 비용', '1칸', '통로의 길이도 Mobility도 이동 시간을 바꾸지 않는다 — 맵의 모든 이동은 한 칸이다(ADR-0084)', 'src/engine/actionCosts.js'],
    ['맵', '위협 이동 간격', `순찰 ${FACILITY.THREAT_MOVE_INTERVAL.patrol} / 조사·경계 ${FACILITY.THREAT_MOVE_INTERVAL.investigate} / 추적 ${FACILITY.THREAT_MOVE_INTERVAL.pursuit}`, `봉쇄 중에는 고정표로 각각 ${FACILITY.LOCKDOWN_THREAT_MOVE_INTERVAL.patrol}/${FACILITY.LOCKDOWN_THREAT_MOVE_INTERVAL.investigate}/${FACILITY.LOCKDOWN_THREAT_MOVE_INTERVAL.pursuit}. 이동이 1칸이 된 뒤로는 "내가 몇 홉 갈 동안 저쪽이 한 홉"으로 읽는다(ADR-0084)`, 'src/data/facilityLayout.js'],
    ['맵', '경계도 2+ 이동 간격', `순찰 ${FACILITY.SECTOR_ALERT_MOVE_INTERVAL.patrol} / 조사·경계 ${FACILITY.SECTOR_ALERT_MOVE_INTERVAL.investigate} / 추적 ${FACILITY.SECTOR_ALERT_MOVE_INTERVAL.pursuit}`, `구역 경계도가 ${FACILITY.SECTOR_ALERT_FAST_MOVE_LEVEL} 이상이면 그 구역의 위협이 모드를 가리지 않고 빨라진다. 봉쇄표와 함께 걸리면 둘 중 작은 값을 쓴다`, 'src/data/facilityLayout.js'],
    ['맵', '구역 경계 게이지', `정원 ${FACILITY.ALERT_GAUGE_CAPACITY}`, `원인마다 압력이 쌓이고 정원을 채우면 단계가 1 오르며 남은 양은 이월된다(3에서 멈춘다). 카메라 감지 +${FACILITY.ALERT_PRESSURE.cameraDetection} / 시체 발견 +${FACILITY.ALERT_PRESSURE.corpseFound} / 강한 흔적 발견 +${FACILITY.ALERT_PRESSURE.strongTraceFound} / 층계 위태 +${FACILITY.ALERT_PRESSURE.botchedAction} / 허탕 조사 +${FACILITY.ALERT_PRESSURE.failedInvestigation}. 단계를 낮추는 수습은 그 구역 게이지를 0으로 지운다`, 'src/data/facilityLayout.js'],
    ['맵', '추적자', `이동 ${FACILITY.HUNTER_MOVE_INTERVAL}칸 고정 / 지각 ${FACILITY.HUNTER_PERCEPTION}`, `구역 경계도 단계가 3이 되는 순간 그 구역의 랜드마크(없으면 관문)에 규모 1의 추적자 하나가 나온다. 구역당 하나. 경계도 가속·봉쇄와 무관하게 ${FACILITY.HUNTER_MOVE_INTERVAL}칸 고정 간격이고, ${FACILITY.HUNTER_SIGHT_HOPS}홉 이내에서 실효 Stealth ${FACILITY.HUNTER_STEALTH_THRESHOLD} 미만이면 관측한다. 같은 노드에 닿으면 회피·속이기 없이 강제 조우. 연속 ${FACILITY.HUNTER_LOSE_TICKS}칸 미관측 / 경계도 3 아래로 하락 / 통제실 장악 중 하나로 물러난다. 안개와 무관하게 항상 보인다(ADR-0092)`, 'src/data/facilityLayout.js'],
    ['맵', '부상 페널티', INJURY_PENALTY_STEPS.map((s) => `HP ${Math.round(s.ratio * 100)}% 이하 −${s.penalty}`).join(' / '), '맵이 판정에 쓰는 여섯 Capability 전부에서 같은 값을 뺀 뒤 -2~4로 자른다. 겹치는 문턱은 누적하지 않고 가장 깊은 한 칸만 쓴다. 저장하지 않고 매번 HP에서 계산하므로 회복하면 곧바로 풀린다. 오버라이드 칩 사용 중에는 걸리지 않는다(ADR-0093)', 'src/data/facilityEquipmentCapabilities.js'],
    ['맵', '구역 증원 주기', `${FACILITY.REINFORCEMENT_INTERVAL} / 봉쇄 ${FACILITY.REINFORCEMENT_LOCKDOWN_INTERVAL}`, '구역별 독립 시계. 로스터의 빈자리만 채운다', 'src/data/facilityLayout.js'],
    ['맵', '카메라 위치 공개', '런 시작', '모든 카메라의 위치와 상태는 런 시작부터 지도와 노드 카드에 보인다. 접속 인터페이스 장악이 주는 것은 그 구역 카메라의 원격 접속뿐이다(ADR-0090)', 'src/engine/runEngine.js'],
    ['맵', '무료 인접 관측', '1홉 · 깊이 ' + FACILITY.FREE_OBSERVATION_DETAIL_LEVEL, '옆방의 위협 유무·그룹 수·모드와 내용물의 존재(보급품·확보 대상·장치)를 공짜로 준다. Perception ' + FACILITY.PERCEPTION_FREE_FAR_VIEW_MIN + ' 이상이면 두 번째 홉의 위협 유무까지 넓어진다(ADR-0090)', 'src/engine/runEngine.js'],
    ['탈출', 'A 비활성', FACILITY.EXIT_A_DISABLED_AT, '이 시각 뒤로는 새 가동을 시작할 수 없다. 이미 시작된 가동 게이지와 열린 창은 끝까지 간다(ADR-0054)', 'src/data/facilityLayout.js'],
    ['탈출', '표준 출구 수', '1 (+열쇠 출구)', '표준 출구는 A 하나뿐이고 열쇠 출구가 유일한 대안 경로다. A는 시작 구역도 계약 목표 구역도 아닌 구역에서 시작점으로부터 가장 먼 노드에 놓인다(ADR-0083)', 'src/engine/facilityGraph.js'],
    ['탈출', '봉쇄와 출구', '영향 없음', '봉쇄는 위협 이동·증원만 가속하고 출구 폐쇄 시각은 앞당기지 않는다(ADR-0083)', 'src/engine/runEngine.js'],
    ['탈출', '탈출구 가동', `시작 1칸 + 게이지 ${FACILITY.EXIT_ACTIVATE_TIME_BY_HACKING.join('/')}`, '유효 Hacking -2~4별 전체 소요 칸. 가동에 드는 것은 1칸이고 나머지는 그 노드에서 대기로 채운다. 자리를 뜨면 가동이 취소된다(ADR-0084)', 'src/data/facilityLayout.js'],
    ['탈출', '개방 유지', FACILITY.EXIT_OPEN_WINDOW, '열린 뒤 추출 가능한 시간', 'src/data/facilityLayout.js'],
    ['맵 행동', '작업 가동', '시작 1칸 + 게이지', '현장 작업은 1칸으로 가동만 하고 남은 칸은 그 자리에서 대기로 채운다. 보상·효과·쿨다운·경계도·소음은 게이지가 차는 시각 C에 한 번에 확정된다(ADR-0084)', 'src/engine/runEngine.js'],
    ['맵 행동', '작업 중단', '적 접촉 · 자리를 떠남 · 붕괴', '완료 전에 새 위협이 도착하거나 그 노드를 벗어나면 경과한 칸만 소모하고 미완료 효과는 하나도 적용하지 않는다. 그 자리에 선 채로의 임의 취소는 불가', 'src/engine/runEngine.js'],
    ['맵 행동', '대기', `1 / 최대 ${FACILITY.WAIT_BATCH_MAX_TICKS}칸`, '아무것도 회복시키지 않는다. 진행 중인 작업이 있으면 그 게이지를 채운다. 묶음 대기는 새 조우·출구 개방/폐쇄·붕괴·작업 완료에서 즉시 멈춘다', 'src/engine/facilityReducer.js'],
    ['맵 행동', '조우 회피', FACILITY.ENCOUNTER_EVADE_TIME, '그 위협의 추적을 해제한다. 같은 위협은 다음 유료 행동 종료 때 재판정한다', 'src/engine/runEngine.js'],
    ['맵 행동', '무료 조작', '0칸', '지도 조작, 인벤토리 열기·정렬, 아이템 버리기, 실행 전 취소, 조우 무시, 우위 조우의 기습 진입(열세·강제 전투 진입은 적 선공 3칸)', 'src/engine/gameReducer.js'],
    ['맵 행동', '장비 교체', MAP_EQUIP_TIME_COST, '장착·해제 각 1건마다. 가동해 두고 게이지가 찰 때 적용되며, 중단되면 교체 없이 경과한 칸만 든다', 'src/engine/actionCosts.js'],
    ['맵 행동', '회복 소모품 사용', MAP_CONSUMABLE_TIME_COST, '맵에서는 인벤토리·퀵슬롯 어디에 있든 쓸 수 있다. 중단되면 소모도 회복도 없다', 'src/engine/actionCosts.js'],
    ['맵', '타임라인 예고 범위', TIMELINE_HORIZON, '지도 화면이 「앞으로 N칸」에 보여주는 범위. 지금 알 수 있는 사건만 시각순으로 나온다', 'src/engine/mapTimeline.js'],
    ['전투', '라운드 맵 시간', FACILITY.COMBAT_ROUND_TIME_COST, '플레이어 행동 구간+적 반응 한 라운드. 라운드마다 한 번만 정산한다', 'src/engine/combatReducer.js'],
    ['전투', '적 기습 선공 구간', FACILITY.COMBAT_ENEMY_AMBUSH_TIME_COST, '라운드 비용과 별도로 전투 시작 시 한 번', 'src/engine/combatReducer.js'],
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
    ammoCost: def.ammoCost ?? '', exhausts: !!def.exhausts,
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
    { key: 'exhausts', header: '소멸', width: 8 },
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
    return { id: def.id, name: def.name, subtype, slot: koreanTerm(def.slot), maxLoad: def.maxLoadBonus ?? '', cards: cardList(def.cardList), capability: map.modifiers, fieldAction: map.fieldAction, mapInfo: map.mapInfo, axis: map.axis };
  });
  const equipmentColumns = [
    { key: 'id', header: '장비 ID', width: 28 }, { key: 'name', header: '이름', width: 22 },
    { key: 'subtype', header: '종류', width: 12 }, { key: 'slot', header: '슬롯', width: 11 },
    { key: 'maxLoad', header: '장전 상한', width: 11, numeric: true }, { key: 'cards', header: '제공 카드', width: 60 },
    { key: 'capability', header: 'Capability', width: 42 }, { key: 'fieldAction', header: '능동 현장 효과', width: 64 },
    { key: 'mapInfo', header: '맵 정보 효과', width: 12 }, { key: 'axis', header: '역할축', width: 10 },
  ];
  sheet(workbook, '무기', '무기 스펙', 'src/data/equipment.js, src/data/facilityEquipmentCapabilities.js', equipmentColumns, equipmentRows(WEAPON_DEFINITIONS, '무기'));
  sheet(workbook, '방어구', '방어구 스펙', 'src/data/equipment.js, src/data/facilityEquipmentCapabilities.js', equipmentColumns,
    [...equipmentRows(ARMOR_TOP_DEFINITIONS, '상의'), ...equipmentRows(ARMOR_BOTTOM_DEFINITIONS, '하의')]);
  sheet(workbook, '모듈', '모듈 스펙', 'src/data/modules.js, src/data/facilityEquipmentCapabilities.js', equipmentColumns, equipmentRows(MODULE_DEFINITIONS, '모듈'));

  const implants = Object.values(IMPLANT_DEFINITIONS).map((def) => {
    const map = capability(def.id);
    return { id: def.id, name: def.name, effect: koreanJson(def.effect), description: def.description, capability: map.modifiers, fieldAction: map.fieldAction, mapInfo: map.mapInfo, axis: map.axis };
  });
  sheet(workbook, '임플란트', '임플란트 스펙', 'src/data/implants.js, src/data/facilityEquipmentCapabilities.js', [
    { key: 'id', header: '임플란트 ID', width: 18 }, { key: 'name', header: '이름', width: 22 },
    { key: 'effect', header: '패시브 효과 데이터', width: 52 },
    { key: 'description', header: '설명', width: 36 }, { key: 'capability', header: 'Capability', width: 36 },
    { key: 'fieldAction', header: '능동 현장 효과', width: 50 },
    { key: 'mapInfo', header: '맵 정보 효과', width: 12 }, { key: 'axis', header: '역할축', width: 10 },
  ], implants);

  const presetName = (id) => EQUIPMENT_AND_CONSUMABLE_NAME[id] ?? id;
  const presets = LOADOUT_PRESETS.map((preset) => {
    const capabilities = previewPresetCapabilities(preset);
    return {
      id: preset.id, name: preset.name, summary: preset.summary,
      weapons: preset.weapons.map(presetName).join(', '),
      armor: `${presetName(preset.top)} / ${presetName(preset.bottom)}`,
      modules: preset.modules.map(presetName).join(', '),
      implants: preset.implants.map(presetName).join(', '),
      consumables: preset.consumables.map(presetName).join(', '),
      capability: ['perception', 'stealth', 'hacking', 'mobility', 'force', 'deception']
        .map((key) => `${koreanTerm(key)} ${capabilities[key] > 0 ? '+' : ''}${capabilities[key]}`).join(', '),
    };
  });
  sheet(workbook, '프리셋', '출격 준비 역할군 프리셋', 'src/data/loadoutPresets.js', [
    { key: 'id', header: '프리셋 ID', width: 14 }, { key: 'name', header: '역할군', width: 10 },
    { key: 'summary', header: '한 줄 요약', width: 42 },
    { key: 'weapons', header: '무기', width: 24 }, { key: 'armor', header: '상의 / 하의', width: 22 },
    { key: 'modules', header: '모듈', width: 26 }, { key: 'implants', header: '임플란트', width: 32 },
    { key: 'consumables', header: '퀵슬롯', width: 18 },
    { key: 'capability', header: '장착 후 Capability', width: 60 },
  ], presets);

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
