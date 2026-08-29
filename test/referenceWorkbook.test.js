import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

test('자동 생성 참조 엑셀이 현재 코드 데이터와 일치한다', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawnSync(process.execPath, ['scripts/generate-reference-workbook.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
