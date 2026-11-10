import assert from 'node:assert/strict';
import { test } from 'node:test';
import { patchNewObjectImportTimestamp } from '../scripts/create-k036-import-time-candidate.mjs';

function fixture() {
  const lines = Array.from({ length: 1170 }, (_, n) => `// preserved ${n + 1}`);
  lines[1008] = '          updated_at: commitTs,';
  lines[1050] = '          updated_at: commitTs,';
  lines[983] = '          updated_at: commitTs,'; // unrelated workspace timestamp
  return lines.join('\n');
}

test('import of a new object preserves source updated_at, not transaction time', () => {
  const original = fixture();
  const { content, originalLine, overwriteLine } = patchNewObjectImportTimestamp(original);
  assert.equal(originalLine, 1009);
  assert.equal(overwriteLine, 1051);
  assert.equal((content.match(/updated_at: commitTs/g) ?? []).length, 2);
  assert.match(content, /const incomingUpdatedAt = o\.updated_at/);
  assert.match(content, /return incomingUpdatedAt/);
  assert.match(content, /IMPORT_OBJECT_UPDATED_AT_INVALID/);
  assert.match(content, /\/\/ preserved 1170/);
});

test('unknown shapes are rejected instead of modifying other fields', () => {
  const lines = fixture().split('\n');
  lines[1008] = '          updated_at: 123,';
  const malformed = lines.join('\n');
  assert.throws(() => patchNewObjectImportTimestamp(malformed), /SOURCE_SHAPE_CHANGED/);
});

test('multiple insertion candidates fail closed', () => {
  const lines = fixture().split('\n');
  lines[1005] = '          updated_at: commitTs,';
  assert.throws(() => patchNewObjectImportTimestamp(lines.join('\n')), /SOURCE_SHAPE_CHANGED/);
});

test('overwrite branch remains byte-identical', () => {
  const original = fixture();
  const before = original.split('\n').slice(1030, 1070).join('\n');
  const after = patchNewObjectImportTimestamp(original).content;
  // Inserting validation lines in the earlier insertion branch shifts line numbers.
  assert.ok(after.includes(before));
});

test('generated insertion expression preserves date and rejects malformed input', () => {
  const content = patchNewObjectImportTimestamp(fixture()).content;
  const match = content.match(/updated_at: (\(\(\) => \{[\s\S]*?\n\s*\}\)\(\))/);
  assert.ok(match, 'patched expression must be self-contained');
  const execute = new Function('o', 'commitTs', `return ${match[1]};`);
  const historical = '2026-10-18T11:26:02.994Z';
  const committed = '2026-10-18T11:26:07.818Z';
  assert.equal(execute({ updated_at: historical }, committed), historical);
  assert.throws(() => execute({ updated_at: null }, committed), /IMPORT_OBJECT_UPDATED_AT_INVALID/);
  assert.throws(() => execute({ updated_at: 'invalid' }, committed), /IMPORT_OBJECT_UPDATED_AT_INVALID/);
});
