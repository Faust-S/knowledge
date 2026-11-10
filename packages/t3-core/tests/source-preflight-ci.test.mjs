import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../../../../.github/workflows/T2_MANUAL_VERIFY.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('manual canonical workflow retains diagnostics without automatic Actions triggers or a production write surface', () => {
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+push:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+schedule:\s*$/m);
  assert.ok(workflow.includes('contents: read'));
  assert.ok(workflow.includes('persist-credentials: false'));
  for(const command of ['npm ci --no-audit --no-fund','npm run test:all','npm run typecheck','npm run lint','npm run build']) assert.ok(workflow.includes(command));
});

test('source report and strict source gate remain separate from dependency-free test success', () => {
  assert.equal(pkg.scripts['audit:source'], 'node scripts/source-preflight.mjs --report');
  assert.equal(pkg.scripts['check:source'], 'node scripts/source-preflight.mjs');
  assert.equal(pkg.scripts.test, 'node scripts/run-current-core-tests.mjs');
});
