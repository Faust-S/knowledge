import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const subjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../kernel-successors/k036-atomic-graph');
const commitPath = 'src/package/import/commit.ts';
const expectedCommitSha256 = 'f536c81c2a7660a15c4a147c4ced9d7b82fc4d0712a6cabd2d1aceb59fa7cb95';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function safeFile(root, path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || isAbsolute(path) ||
      path.split('/').some(part => part === '..' || part === '' || part === '.')) {
    throw new Error('K036_IMPORT_TIME_UNSAFE_PATH');
  }
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error('K036_IMPORT_TIME_PATH_ESCAPE');
  }
  return full;
}

/** Only the new-object insertion at original commit.ts:1009 may change. */
export function patchNewObjectImportTimestamp(source) {
  const lines = source.split('\n');
  const matches = lines.map((line, i) => ({ line, number: i + 1 }))
    .filter(({ line }) => /\bupdated_at\s*:\s*commitTs\b/.test(line));
  const inserts = matches.filter(({ number }) => number >= 1000 && number <= 1020);
  const overwrites = matches.filter(({ number }) => number >= 1040 && number <= 1070);
  if (inserts.length !== 1 || overwrites.length !== 1 || lines.length < 1146) {
    throw new Error('K036_IMPORT_TIME_SOURCE_SHAPE_CHANGED');
  }
  const original = inserts[0];
  // A missing/malformed required timestamp is a corrupt input, not a request to
  // substitute the import transaction time. Keep the literal incoming value.
  lines[original.number - 1] = original.line.replace(
    /updated_at\s*:\s*commitTs\b/,
    `updated_at: (() => {\n` +
    `          const incomingUpdatedAt = o.updated_at;\n` +
    `          if (typeof incomingUpdatedAt !== 'string' ||\n` +
    `              !Number.isFinite(Date.parse(incomingUpdatedAt))) {\n` +
    `            throw new Error('IMPORT_OBJECT_UPDATED_AT_INVALID');\n` +
    `          }\n` +
    `          return incomingUpdatedAt;\n` +
    `        })()`,
  );
  const patched = lines.join('\n');
  if (patched === source || !patched.includes('IMPORT_OBJECT_UPDATED_AT_INVALID') ||
      !patched.includes(overwrites[0].line)) {
    throw new Error('K036_IMPORT_TIME_PATCH_INVARIANT');
  }
  return { content: patched, originalLine: original.number, overwriteLine: overwrites[0].number };
}

/**
 * Read a byte-verified, materialized Kernel 0.3.6 source and create a separate,
 * explicitly UNQUALIFIED candidate without editing accepted Kernel artifacts.
 */
export function createK036ImportTimeCandidate(sourceArg, targetArg, subjectArg = subjectRoot) {
  const source = realpathSync(sourceArg);
  const target = resolve(targetArg);
  if (existsSync(target)) throw new Error('K036_IMPORT_TIME_OUTPUT_EXISTS');
  if (source === target || target.startsWith(source + sep) || source.startsWith(target + sep)) {
    throw new Error('K036_IMPORT_TIME_OVERLAPPING_PATHS');
  }
  const subject = JSON.parse(readFileSync(resolve(subjectArg, 'SOURCE_SUBJECT.json'), 'utf8'));
  if (subject.kernelVersion !== '0.3.6' || subject.runtimeContract !== '1.3.0' ||
      subject.releaseAccepted !== false || !Array.isArray(subject.inventory)) {
    throw new Error('K036_IMPORT_TIME_UNEXPECTED_SUBJECT');
  }
  const provenance = resolve(source, 'SUCCESSOR_SOURCE_SUBJECT.json');
  if (!existsSync(provenance) ||
      sha256(readFileSync(provenance)) !== sha256(readFileSync(resolve(subjectArg, 'SOURCE_SUBJECT.json')))) {
    throw new Error('K036_IMPORT_TIME_SOURCE_PROVENANCE');
  }
  const inventory = subject.inventory;
  if (inventory.filter(row => row.path === commitPath).length !== 1 ||
      inventory.find(row => row.path === commitPath).sha256 !== expectedCommitSha256) {
    throw new Error('K036_IMPORT_TIME_SOURCE_IDENTITY');
  }
  const tree = sha256(Buffer.from(inventory.map(row => `${row.path}\0${row.sha256}\n`).join('')));
  if (tree !== subject.sourceTreeSha256) throw new Error('K036_IMPORT_TIME_BASE_TREE_MISMATCH');
  const inputs = new Map();
  for (const row of inventory) {
    const file = safeFile(source, row.path);
    if (!lstatSync(file).isFile() || realpathSync(file) !== file) {
      throw new Error('K036_IMPORT_TIME_SOURCE_LINK:' + row.path);
    }
    const bytes = readFileSync(file);
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) {
      throw new Error('K036_IMPORT_TIME_SOURCE_HASH:' + row.path);
    }
    inputs.set(row.path, bytes);
  }
  const original = inputs.get(commitPath);
  const patched = patchNewObjectImportTimestamp(original.toString('utf8'));
  const patchedBytes = Buffer.from(patched.content, 'utf8');
  if (sha256(original) !== expectedCommitSha256 || patchedBytes.equals(original)) {
    throw new Error('K036_IMPORT_TIME_PATCH_FAILED');
  }
  mkdirSync(target, { recursive: true });
  for (const [path, bytes] of inputs) {
    const dst = safeFile(target, path);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, path === commitPath ? patchedBytes : bytes);
  }
  const result = {
    schema: 'IWXA_K036_IMPORT_TIMESTAMP_FIX_CANDIDATE_V1',
    status: 'SOURCE_PATCHED_UNQUALIFIED',
    sourceKernel: '0.3.6',
    sourceContract: '1.3.0',
    qualifiedSourceTreeSha256: tree,
    sourcePath: commitPath,
    beforeSha256: expectedCommitSha256,
    afterSha256: sha256(patchedBytes),
    importNewObjectLine: patched.originalLine,
    overwriteLineUnchanged: patched.overwriteLine,
    semantics: 'new objects preserve incoming updated_at; overwrite keeps commit time',
    requiredNextAction: 'independent tests, fresh runtime build, new artifact identity and qualification before any domain staging',
    productionActivation: false,
  };
  writeFileSync(resolve(target, 'IMPORT_TIMESTAMP_CANDIDATE.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) {
    throw new Error('Usage: create-k036-import-time-candidate.mjs <exact-materialized-k036-root> <fresh-candidate-root>');
  }
  console.log(JSON.stringify(createK036ImportTimeCandidate(process.argv[2], process.argv[3]), null, 2));
}
