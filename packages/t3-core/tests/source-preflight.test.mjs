import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inspectCanonicalSource, literalModuleReferences, runSourcePreflight } from '../scripts/source-preflight.mjs';

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 't2-source-preflight-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
const inputs = {
  'package.json': JSON.stringify({ scripts: { build: 'example-build', typecheck: 'example-typecheck', lint: 'example-lint' }, dependencies: { react: 'fixture' } }),
  'package-lock.json': '{}',
  'tsconfig.json': '{}',
  'src/modules/base/features/workspace/WorkspaceView.tsx': 'export {};',
  'src/kernel-client/contracts/runtime-1.2.0.ts': 'export {};',
  'src/profiles/definition.ts': 'export {};',
  'src/shell/routing.ts': 'export {};',
};

test('preflight finds real literal imports, skips comments and quoted prose, and preserves scoped packages', () => {
  const source = `// import X from 'ignored-comment';
/* export * from 'ignored-block'; */
const text = "import X from 'ignored-prose'";
import type { X } from './contract';
import 'styles.css';
export { something } from '@scope/pkg/subpath';
const module = import('./lazy.mjs');
const fs = require('node:fs');
const url = import.meta.url;
`;
  assert.deepEqual(literalModuleReferences(source).map((r) => r.specifier), ['./contract', 'styles.css', '@scope/pkg/subpath', './lazy.mjs', 'node:fs']);
});

test('an empty canonical root is blocked, never release ready', (t) => {
  const report = inspectCanonicalSource(fixture(t));
  assert.equal(report.status, 'BLOCKED_SOURCE_INCOMPLETE');
  assert.equal(report.releaseReady, false);
  for (const code of ['SOURCE_TREE_EMPTY', 'PACKAGE_MANIFEST_MISSING_OR_INVALID', 'BUILD_SCRIPT_MISSING', 'DEPENDENCY_LOCK_MISSING', 'TYPESCRIPT_CONFIG_MISSING', 'REQUIRED_WORKSPACE_SOURCE_MISSING']) {
    assert.ok(report.issues.some((issue) => issue.code === code), code);
  }
});

test('preflight detects missing imports, escaping paths and undeclared packages', (t) => {
  const root = fixture(t, { ...inputs, 'src/main.ts': "import './missing'; import '../../outside'; import X from '@missing/pkg/api'; import React from 'react'; import fs from 'node:fs';" });
  const report = inspectCanonicalSource(root);
  assert.equal(report.issues.filter((issue) => issue.code === 'LOCAL_MODULE_MISSING').length, 1);
  assert.equal(report.issues.filter((issue) => issue.code === 'MODULE_REFERENCE_OUTSIDE_CANONICAL_ROOT').length, 1);
  const undeclared = report.issues.filter((issue) => issue.code === 'PACKAGE_OR_ALIAS_UNDECLARED');
  assert.equal(undeclared.length, 1);
  assert.equal(undeclared[0].package, '@missing/pkg');
});

test('extensionless and emitted JS module references resolve to actual TypeScript source', (t) => {
  const root = fixture(t, { ...inputs, 'src/main.ts': "import { x } from './model.js'; export * from './section';", 'src/model.ts': 'export const x = 1;', 'src/section/index.ts': 'export {};' });
  const first = inspectCanonicalSource(root);
  assert.equal(first.issueCount, 0);
  assert.equal(first.status, 'NO_STATIC_BLOCKERS_FOUND_BUILD_VALIDATION_REQUIRED');
  assert.equal(first.releaseReady, false);
  assert.deepEqual(inspectCanonicalSource(root), first);
  writeFileSync(join(root, 'src/model.ts'), 'export const x = 2;');
  assert.notEqual(inspectCanonicalSource(root).sourceDigest, first.sourceDigest);
});

test('diagnostic report mode never promotes blockers into readiness and strict mode fails', (t) => {
  const root = fixture(t);
  const strict = runSourcePreflight([], root);
  const diagnostic = runSourcePreflight(['--report'], root);
  assert.equal(strict.exitCode, 2);
  assert.equal(diagnostic.exitCode, 0);
  assert.deepEqual(strict.report, diagnostic.report);
  assert.equal(diagnostic.report.releaseReady, false);
  assert.throws(() => runSourcePreflight(['--allow-release'], root));
});

test('source symlinks do not cause an unreviewed traversal outside the source tree', (t) => {
  const outside = fixture(t, { 'secret.ts': 'export const secret = true;' });
  const root = fixture(t, { 'package.json': '{}' });
  symlinkSync(outside, join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
  const report = inspectCanonicalSource(root);
  assert.equal(report.sourceFileCount, 0);
  assert.ok(report.issues.some((issue) => issue.code === 'SOURCE_SYMLINK_REQUIRES_REVIEW'));
});

test('malformed manifest and escaped module references remain explicit blockers', (t) => {
  const root = fixture(t, { ...inputs, 'package.json': 'null', 'src/main.ts': "import './mod\\u0065l';" });
  const report = inspectCanonicalSource(root);
  assert.ok(report.issues.some((issue) => issue.code === 'PACKAGE_MANIFEST_INVALID_SHAPE'));
  assert.ok(report.issues.some((issue) => issue.code === 'ESCAPED_MODULE_REFERENCE_REQUIRES_REVIEW'));
});


test('literal compiler path alias resolves real source without becoming a package declaration', (t) => {
  const root = fixture(t, { ...inputs,
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    'src/main.ts': "import '@/shell/routing';",
  });
  assert.equal(inspectCanonicalSource(root).issueCount, 0);
});

test('unresolved declared aliases and undeclared aliases remain blockers', (t) => {
  const root = fixture(t, { ...inputs,
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    'src/main.ts': "import '@/absent'; import '#unconfigured/model';",
  });
  const codes = inspectCanonicalSource(root).issues.map((issue) => issue.code);
  assert.deepEqual(codes, ['ALIAS_MODULE_MISSING', 'PACKAGE_OR_ALIAS_UNDECLARED']);
});

test('alias longest-prefix matching and in-root fallbacks do not use a broader match', (t) => {
  const root = fixture(t, { ...inputs,
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./missing/*'], '@/shell/*': ['./missing/*', './src/shell/*'] } } }),
    'src/main.ts': "import '@/shell/routing';",
  });
  assert.equal(inspectCanonicalSource(root).issueCount, 0);
});

test('alias traversal and out-of-root fallbacks fail closed', (t) => {
  const root = fixture(t, { ...inputs,
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*', '../outside/*'] } } }),
    'src/main.ts': "import '@/shell/routing';",
  });
  assert.ok(inspectCanonicalSource(root).issues.some((issue) => issue.code === 'MODULE_REFERENCE_OUTSIDE_CANONICAL_ROOT'));
});

test('malformed or inherited compiler aliases require review rather than being silently accepted', (t) => {
  const root = fixture(t, { ...inputs,
    'tsconfig.json': JSON.stringify({ extends: './shared.json', compilerOptions: { paths: { '@/*': 'not-an-array' } } }),
  });
  const codes = inspectCanonicalSource(root).issues.map((issue) => issue.code);
  assert.ok(codes.includes('TYPESCRIPT_EXTENDS_REQUIRES_COMPILER_REVIEW'));
  assert.ok(codes.includes('TYPESCRIPT_PATHS_INVALID'));
});
