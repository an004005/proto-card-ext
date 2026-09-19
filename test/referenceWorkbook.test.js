import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { LOADOUT_PRESETS } from '../src/data/loadoutPresets.js';
import { previewPresetCapabilities } from '../src/engine/loadoutReducer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('자동 생성 참조 엑셀이 현재 코드 데이터와 일치한다', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-reference-workbook.mjs', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

// 「프리셋」 시트는 창고 화면의 프리셋 툴팁과 같은 말을 해야 한다 — 기획이 엑셀만 보고 수치를
// 정하므로, 열 구성이 바뀌거나 Capability 표기가 화면과 갈라지면 여기서 잡는다.
test('「프리셋」 시트가 정해진 열 구성과 화면과 같은 Capability 표기를 낸다', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(ROOT, 'docs/card-extraction-reference.xlsx'));
  const sheet = workbook.getWorksheet('프리셋');
  assert.ok(sheet, '「프리셋」 시트가 없다');

  const headers = sheet.getRow(4).values.slice(1).map((value) => String(value));
  assert.deepEqual(headers, [
    '프리셋 ID', '역할군', '한 줄 요약', '무기', '상의 / 하의', '모듈', '임플란트', '퀵슬롯', '장착 후 Capability',
  ]);
  assert.equal(sheet.rowCount - 4, LOADOUT_PRESETS.length, '프리셋 수와 행 수가 다르다');

  // 첫 프리셋의 Capability 칸을 정의에서 다시 계산해 글자까지 맞춰 본다. 부호 표기(양수만 +,
  // 0은 그냥 0)도 LoadoutScreen과 같은 규칙이다.
  const preset = LOADOUT_PRESETS[0];
  const capabilities = previewPresetCapabilities(preset);
  const labels = { perception: '지각', stealth: '은신', hacking: '해킹', mobility: '기동', force: '파괴', deception: '기만' };
  const expected = Object.keys(labels)
    .map((key) => `${labels[key]} ${capabilities[key] > 0 ? '+' : ''}${capabilities[key]}`).join(', ');

  const row = sheet.getRow(5);
  assert.equal(String(row.getCell(1).value), preset.id);
  assert.equal(String(row.getCell(9).value), expected);
});
