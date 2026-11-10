import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const subjectRoot = resolve(scriptDir, '../../kernel-successors/k036-atomic-graph');
const subject = JSON.parse(readFileSync(resolve(subjectRoot, 'SOURCE_SUBJECT.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function inside(root, path) {
  const result = resolve(root, path); const rel = relative(root, result);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('SOURCE_PATH_ESCAPE');
  return result;
}
export function materializeQualifiedSuccessor(baseRoot, outputRoot) {
  baseRoot = realpathSync(baseRoot); outputRoot = resolve(outputRoot);
  const checkout = realpathSync(resolve(scriptDir, '../../../../..'));
  const rel = relative(checkout, outputRoot);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('OUTPUT_MUST_BE_OUTSIDE_WORKTREE');
  if (existsSync(outputRoot)) throw new Error('OUTPUT_ALREADY_EXISTS');
  const base = resolve(baseRoot, 'kernel-source-base/IWXA_Domain_Kernel_0.3.5_RU_CANDIDATE');
  const predecessor = JSON.parse(readFileSync(resolve(subjectRoot, 'SUCCESSOR_BASE_MANIFEST.json'), 'utf8'));
  if (predecessor.predecessor.sourcePackageSha256 !== subject.predecessor.sourcePackageSha256) throw new Error('PREDECESSOR_AUTHORITY_MISMATCH');
  const exactPackage = resolve(baseRoot, 'exact-products', subject.predecessor.sourcePackage);
  if (sha(readFileSync(exactPackage)) !== subject.predecessor.sourcePackageSha256) throw new Error('EXACT_PACKAGE_MISMATCH');
  const sourcePaths = new Map(predecessor.inventory.map(row => [row.path.split('/').slice(1).join('/'), row.sha256]));
  const changes = new Map(subject.overlay.map(row => [row.path, row]));
  const bytes = new Map();
  // Verify EVERY predecessor file, including files replaced by an overlay, before writing.
  for (const [path, expected] of sourcePaths) {
    const file = inside(base, path);
    if (realpathSync(file) !== file || sha(readFileSync(file)) !== expected) throw new Error('EXACT_BASE_MISMATCH:' + path);
  }
  for (const row of subject.inventory) {
    const change = changes.get(row.path);
    if (change && change.predecessorSha256 !== (sourcePaths.get(row.path) ?? null)) throw new Error('OVERLAY_BASE_MISMATCH:' + row.path);
    const file = inside(change ? resolve(subjectRoot, 'source-overlay') : base, row.path);
    if (realpathSync(file) !== file) throw new Error('SOURCE_SYMLINK');
    const contents = readFileSync(file);
    if (sha(contents) !== row.sha256 || contents.length !== row.bytes) throw new Error('SUCCESSOR_BYTES_MISMATCH:' + row.path);
    bytes.set(row.path, contents);
  }
  const tree = sha(Buffer.from(subject.inventory.map(row => `${row.path}\0${row.sha256}\n`).join('')));
  if (tree !== subject.sourceTreeSha256) throw new Error('SUCCESSOR_TREE_MISMATCH');
  mkdirSync(outputRoot, { recursive: true });
  for (const [path, contents] of bytes) { const file = inside(outputRoot, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, contents); }
  copyFileSync(resolve(subjectRoot, 'SOURCE_SUBJECT.json'), resolve(outputRoot, 'SUCCESSOR_SOURCE_SUBJECT.json'));
  return { status: 'EXACT_SUCCESSOR_MATERIALIZED', kernelVersion: subject.kernelVersion, contractVersion: subject.runtimeContract, sourceTreeSha256: tree, outputRoot, productionActivation: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: materialize-k036-atomic-graph-qualified.mjs <exact-base-output-root> <new-successor-root>');
  console.log(JSON.stringify(materializeQualifiedSuccessor(process.argv[2], process.argv[3]), null, 2));
}
