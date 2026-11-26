// D07 one-shot recovery of the qualified 45777863688 release, not a new product build system.
// Run outside the source checkout, on the authorized Linux x64 build machine.
// No clone, credential changes, Actions, push, deploy or product acceptance.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const pins = Object.freeze({
  site: '20ca06ee2f07b430dbd6b59f72822b45f0527bd4',
  subject: '11ec43898d025107174df0b2cde6024c340c1cc0',
  t2: 'e70de29b72b83e2546f7ab74b17572685a728c17',
  core: '326f725c44d69ac99f6b912241e9e8a6c3d716a5',
  assistant: '5e3083788aa541921559de29d3457d4a52bbba00',
  archive: 'b778474d011b34a77cd60b945f02295fb24654c833f3ab12ff36bd3c0bdd8863',
  tree: 'd614243c9dbfc596f7c0c2a8d5ef516ab3703aa5b61b6ec4c9a2538d49749d69',
  qualificationRun: 45777863688,
  qualificationHead: '792a42cd2f81ce2d18969e3b94360754b23f98af',
  recoveryRun: 45780650395,
  platformRun: 45395047723,
  platformArtifact: 14920233669,
  distFiles: 826,
  retainedFiles: 98,
  retainedBytes: 58575873,
});
export const branch = 'work/2026-11-24-d07-t3';
const remoteRef = 'refs/heads/' + branch;
const platform = 'runtime/t3-platform/0.3.1-rc.1';
export const groups = ['d07-host', 'kernel-support', 'platform-inputs.zip'].map(x => platform + '/' + x);
const fail = code => { throw Error('D07_RECOVERY_' + code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const separated = (a, b) => a !== b && !a.startsWith(b + sep) && !b.startsWith(a + sep);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
}).trim();
const allowedInput = p => typeof p === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p) &&
  !p.split('/').some(s => s === '.' || s === '..' || s === '.git' || s === 'node_modules' || s.startsWith('.env')) &&
  !/\.(?:map|log|gguf|safetensors|onnx|pem|key)$/i.test(p) &&
  (p === groups[2] || p.startsWith(groups[0] + '/') || p.startsWith(groups[1] + '/'));

export function requireQualifiedTree(identity) {
  if (identity?.sha256 !== pins.tree || identity.files !== pins.distFiles) fail('QUALIFIED_TREE_MISMATCH');
  return identity;
}
export function requireRetentionPaths(paths) {
  if (paths.length !== pins.retainedFiles || new Set(paths).size !== pins.retainedFiles || paths.some(p => !allowedInput(p)) ||
      !groups.every(g => paths.some(p => p === g || p.startsWith(g + '/')))) fail('RETENTION_SCOPE');
  return paths;
}
export function requireRetentionBytes(bytes) {
  if (bytes !== pins.retainedBytes) fail('RETENTION_BYTES_MISMATCH');
  return bytes;
}
export function requireArchive(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || hash(readFileSync(path)) !== pins.archive) fail('ARCHIVE_MISMATCH');
  return path;
}
export function requireRemoteHead(raw) {
  if (raw.trim() !== pins.site + '\t' + remoteRef) fail('REMOTE_HEAD_CHANGED');
}
export function requireSiteRemote(raw) {
  if (typeof raw !== 'string' || /[\r\n]/.test(raw)) fail('SINGLE_REMOTE_REQUIRED');
  let name;
  if (raw.startsWith('git@github.com:')) name = raw.slice('git@github.com:'.length);
  else {
    let url;
    try { url = new URL(raw); } catch { fail('REMOTE_URL'); }
    if (url.hostname !== 'github.com' || !['https:', 'ssh:'].includes(url.protocol) || url.password ||
        (url.protocol === 'https:' && url.username) || url.search || url.hash || url.port) fail('REMOTE_URL');
    name = url.pathname.replace(/^\//, '');
  }
  if (name.replace(/\.git$/, '').toLowerCase() !== 'faust-s/uslugovod.ru') fail('WRONG_REMOTE_REPOSITORY');
}

async function main(args) {
  if (args.length !== 5) fail('USAGE_SITE_T2_KNOWLEDGE_T3_PLATFORM_ZIP');
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.version !== 'v22.23.5') fail('QUALIFIED_LINUX_NODE_REQUIRED');
  const [site, t2, core, assistant, archive] = args.map(p => realpathSync(resolve(p)));
  if ([site, t2, core, assistant, archive].some((a, i, all) => all.slice(i + 1).some(b => !separated(a, b)))) fail('SEPARATE_INPUTS_REQUIRED');
  if (process.env.IWXA_T2_PRODUCT_CHALLENGE || process.env.IWXA_T2_CAPABILITY_CONTROL_PLANE) fail('ORDINARY_PRODUCT_ONLY');
  const imported = p => import(pathToFileURL(join(site, p)).href);
  // Check Git pins before importing executable source from a supplied checkout.
  for (const [root, expected] of [[site, pins.site], [t2, pins.t2], [core, pins.core], [assistant, pins.assistant]]) {
    if (git(root, 'rev-parse', 'HEAD') !== expected || git(root, 'status', '--porcelain', '--untracked-files=all')) fail('EXACT_CLEAN_CHECKOUT_REQUIRED');
  }
  if (git(site, 'branch', '--show-current') !== branch) fail('WORK_BRANCH_REQUIRED');
  const { verifyCleanCheckout, snapshotReleaseTree, releaseTreeIdentity, verifyRetentionSize } = await imported('scripts/prepare-d07-private-release.mjs');
  const { resolveReleaseNpmCli, withQualifiedReleaseManifest, runQualifiedNpmBuild } = await imported('scripts/lib/d07-qualified-build-command.mjs');
  const { verifyPlatformArchive } = await imported('scripts/t3-platform-inputs.mjs');
  verifyCleanCheckout(site, pins.site, { branch, requireFreshOutput: true });
  verifyCleanCheckout(t2, pins.t2); verifyCleanCheckout(core, pins.core); verifyCleanCheckout(assistant, pins.assistant);
  requireArchive(archive); verifyPlatformArchive(archive);
  const npm = resolveReleaseNpmCli();
  if (execFileSync(process.execPath, [npm, '--version'], { encoding: 'utf8' }).trim() !== '10.9.9' ||
      execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim() !== '1.3.2') fail('QUALIFIED_NPM_BUN_REQUIRED');
  // Stop before a long rebuild if the actual authorized Git remote is not writable.
  requireSiteRemote(git(site, 'remote', 'get-url', '--push', '--all', 'origin'));
  requireSiteRemote(git(site, 'remote', 'get-url', '--all', 'origin'));
  requireRemoteHead(git(site, 'ls-remote', '--exit-code', 'origin', remoteRef));
  git(site, 'push', '--dry-run', '--porcelain', '--no-follow-tags', 'origin', 'HEAD:' + remoteRef);
  console.log('D07_RECOVERY_PREFLIGHT=PASS');
  const cleanEnv = { ...process.env };
  delete cleanEnv.IWXA_T2_SOURCE_DIR;
  delete cleanEnv.VITE_D07_T3;
  const run = (file, argv, env = {}) => execFileSync(file, argv, {
    cwd: site, stdio: 'inherit', env: { ...cleanEnv, ...env },
  });
  const node = (script, argv = [], env = {}) => run(process.execPath, ['--import', 'tsx', 'scripts/' + script, ...argv], env);
  const temp = mkdtempSync(join(tmpdir(), 'd07-recover-qualified-'));
  let complete = false;
  try {
    run('bun', ['install', '--frozen-lockfile']);
    verifyCleanCheckout(site, pins.site, { branch, requireFreshOutput: true });
    run(process.execPath, ['scripts/build-d07-integrated-site.mjs'], { IWXA_T2_SOURCE_DIR: t2, VITE_D07_T3: '1' });
    verifyCleanCheckout(site, pins.site, { branch });
    const host = join(temp, 'host'), support = join(temp, 'support'), dist = join(site, 'dist');
    // The original Host compiler requires npm_execpath. Use its real npm entry.
    run(process.execPath, [npm, 'run', 't3:prepare-host', '--', join(core, 'packages/t3-core'), host, archive, assistant]);
    node('prepare-d07-local-kernel-input.mjs', [dist, t2, support]);
    node('retain-d07-t3-inputs.mjs', [host, support, archive]);
    const identity = withQualifiedReleaseManifest(join(site, 'package.json'), qualified => {
      runQualifiedNpmBuild(site, { env: cleanEnv });
      return { ...requireQualifiedTree(releaseTreeIdentity(snapshotReleaseTree(dist))), qualifiedManifestSha256: hash(qualified) };
    });
    if (git(site, 'rev-parse', 'HEAD') !== pins.site || git(site, 'status', '--porcelain', '--untracked-files=no')) fail('TRACKED_SOURCE_CHANGED');
    if (verifyRetentionSize(site) !== pins.retainedFiles) fail('RETENTION_COUNT');
    const untracked = git(site, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
    if (untracked.some(p => !allowedInput(p))) fail('UNEXPECTED_UNTRACKED_FILE');
    requireRemoteHead(git(site, 'ls-remote', '--exit-code', 'origin', remoteRef));
    git(site, 'add', '-f', '--', ...groups);
    const staged = requireRetentionPaths(git(site, 'diff', '--cached', '--name-only', '-z', '--no-renames').split('\0').filter(Boolean));
    const retainedBytes = requireRetentionBytes(staged.reduce((total, path) => total + lstatSync(join(site, path)).size, 0));
    node('verify-d07-retained-index.mjs');
    complete = true;
    console.log('D07_RECOVERY_READY_TO_COMMIT=' + JSON.stringify({
      source: pins.site, qualificationRun: pins.qualificationRun, qualificationHead: pins.qualificationHead,
      recoveryRun: pins.recoveryRun, ...identity, retainedFiles: staged.length, retainedBytes,
      reusedQualification: true, stagedInputsOnly: true, remoteWrite: false, browserStatus: 'NOT_RUN', productAccepted: false,
    }));
  } finally {
    // Preserve a failed preparation for authorized local diagnosis, not public artifacts.
    if (complete) rmSync(temp, { recursive: true, force: true });
    else console.error('D07_RECOVERY_PRIVATE_WORK_RETAINED=' + temp);
  }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    const message = String(error?.message ?? '');
    console.error(/^D07_(RECOVERY|PRIVATE_RELEASE|RELEASE_COMMAND|T3_PLATFORM)_[A-Z0-9_]+$/.test(message)
      ? message : 'D07_RECOVERY_OPERATION_FAILED');
    process.exitCode = 1;
  });
}
