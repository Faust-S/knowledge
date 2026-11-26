// Assembly identity only. Never change the normal index or any ref.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const prefix = 'runtime/t3-platform/0.3.1-rc.1/';
const archive = prefix + 'platform-inputs.zip';
const host = prefix + 'cehovod-host';
const receiptPath = host + '/cehovod-t3-host-input.json';
const sha40 = /^[0-9a-f]{40}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const paths = value => value.split('\0').filter(Boolean);
const valid = path => typeof path === 'string' &&
  (path === archive || path.startsWith(host + '/')) &&
  /^[A-Za-z0-9_.\/-]+$/.test(path) &&
  path.split('/').every(part => part && part !== '.' && part !== '..');

export function snapshotIdentity(site, wanted) {
  site = resolve(site);
  wanted = [...wanted].sort();
  assert.ok(wanted.length && new Set(wanted).size === wanted.length && wanted.every(valid), 'IDENTITY_PATHS');
  const originalEnv = { ...process.env };
  assert.equal(originalEnv.GIT_INDEX_FILE, undefined, 'IDENTITY_EXISTING_TEMP_INDEX');
  const git = (args, env = originalEnv) => execFileSync('git', args, {
    cwd: site, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const head = git(['rev-parse', 'HEAD']).trim();
  assert.ok(sha40.test(head));
  const initialIndex = git(['ls-files', '--stage', '-z']);
  const temp = mkdtempSync(join(tmpdir(), 'd05-retained-identity-'));
  const env = { ...originalEnv, GIT_INDEX_FILE: join(temp, 'index') };
  const list = () => paths(git(['ls-files', '--stage', '-z', '--', archive, host], env)).map(row => {
    const match = /^(100644|100755) ([0-9a-f]{40}) 0\t(.+)$/.exec(row);
    assert.ok(match, 'IDENTITY_UNSUPPORTED_MODE');
    return { mode: match[1], blob: match[2], path: match[3] };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  try {
    git(['read-tree', head], env);
    git(['add', '-f', '--', archive, host], env);
    const rows = list();
    assert.deepEqual(rows.map(row => row.path), wanted, 'IDENTITY_INVENTORY');
    const changed = paths(git(['diff', '--cached', '--name-only', '-z', head], env));
    assert.ok(changed.every(path => wanted.includes(path)), 'IDENTITY_OUTSIDE_INPUTS');
    for (const row of rows) {
      const raw = git(['hash-object', '--no-filters', '--', row.path]).trim();
      assert.equal(raw, row.blob, 'IDENTITY_GIT_FILTERED_BYTES');
    }
    const tree = git(['write-tree'], env).trim();
    const executable = rows.filter(row => row.mode === '100755');
    // Simulate newly added generated files on a filesystem without executable bits.
    // The exact blob IDs are reused; only the mode in this temporary index changes.
    for (const row of executable) git(['update-index', '--cacheinfo', '100644,' + row.blob + ',' + row.path], env);
    const regular = list();
    assert.deepEqual(regular, rows.map(row => ({ ...row, mode: '100644' })), 'IDENTITY_MODE_SIMULATION_CHANGED_BYTES');
    const allRegularTree = git(['write-tree'], env).trim();
    assert.equal(git(['rev-parse', 'HEAD']).trim(), head, 'IDENTITY_REF_CHANGED');
    assert.equal(git(['ls-files', '--stage', '-z']), initialIndex, 'IDENTITY_NORMAL_INDEX_CHANGED');
    return { head, tree, allRegularTree, inputFiles: rows.length, executableFiles: executable.length,
      regularFiles: rows.length - executable.length,
      contentInventorySha256: sha256(JSON.stringify(rows.map(({path, blob}) => ({path, blob})))),
      modeInventorySha256: sha256(JSON.stringify(rows)), normalIndexUnchanged: true };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function checkRetainedIdentity(site, expected, reported) {
  assert.ok(sha40.test(expected) && sha40.test(reported), 'IDENTITY_EXPECTED_HASH');
  const bytes = readFileSync(join(site, receiptPath));
  const receipt = JSON.parse(bytes.toString('utf8'));
  assert.equal(receipt.schema, 'IWXA_CEHOVOD_COMPILED_HOST_INPUT/1');
  assert.ok(Array.isArray(receipt.files) && Array.isArray(receipt.moduleSourceFiles));
  const wanted = [archive, receiptPath, ...receipt.files.map(row => host + '/' + row.path)];
  const result = snapshotIdentity(site, wanted);
  return {
    status: result.tree === expected ? 'D05_T3_HOST_IDENTITY_PASS' : 'D05_T3_HOST_IDENTITY_MISMATCH',
    ...result, expectedTree: expected, reportedWindowsTree: reported,
    expectedTreeMatched: result.tree === expected,
    reportedWindowsTreeExplainedByModesOnly: result.tree === expected && result.tree !== result.allRegularTree && result.allRegularTree === reported,
    hostReceiptSha256: sha256(bytes),
    compiledFilesInventorySha256: sha256(JSON.stringify(receipt.files)),
    moduleSourceInventorySha256: sha256(JSON.stringify(receipt.moduleSourceFiles)),
    productTestsRepeated: false, productAccepted: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [site, expected, reported] = process.argv.slice(2);
  assert.equal(process.argv.length, 5, 'IDENTITY_USAGE');
  const result = checkRetainedIdentity(resolve(site), expected, reported);
  console.log(JSON.stringify(result));
  if (!result.expectedTreeMatched) process.exitCode = 1;
}
