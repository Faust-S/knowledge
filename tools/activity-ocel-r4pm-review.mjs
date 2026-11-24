// Optional local Agent invocation: explicitly selected OCEL 2.0 copy via
// stdin. The original Activity reader prepares the alias-only ordinal log;
// the original Rust4PM engine independently discovers the OC-DFG.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareLocalOcel2Discovery} from '../modules/activity-base-anonymizer/ocel2-evidence.mjs';
import {compareRust4pmDiscovery} from '../modules/activity-base-anonymizer/r4pm-comparison.mjs';
const LIMIT = 8 * 1024 * 1024;
function fail(code) { throw Object.assign(new Error(code), {code}); }
function emit(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
async function read() {
  const chunks = []; let size = 0;
  for await (const part of process.stdin) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > LIMIT) fail('OCEL_R4PM_INPUT_LIMIT');
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); }
  catch { fail('OCEL_R4PM_INVALID_JSON'); }
}
try {
  if (process.argv.length !== 2) fail('OCEL_R4PM_ARGUMENTS_NOT_SUPPORTED');
  const raw = await read();
  const prepared = await prepareLocalOcel2Discovery(raw);
  const input = JSON.stringify(prepared.ocel2);
  if (Buffer.byteLength(input, 'utf8') > LIMIT) fail('OCEL_R4PM_PROJECTED_INPUT_LIMIT');
  // Qualified interpreter is configured by the local Agent runtime, not input.
  const python = process.env.IWXA_ACTIVITY_R4PM_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const worker = fileURLToPath(new URL('./activity-r4pm-worker.py', import.meta.url));
  const child = spawnSync(python, ['-I', worker], {
    input, encoding: 'utf8', timeout: 30000, maxBuffer: LIMIT,
    shell: false, windowsHide: true,
  });
  if (child.error || child.status !== 0) fail('OCEL_R4PM_ENGINE_UNAVAILABLE_OR_FAILED');
  let external;
  try { external = JSON.parse(child.stdout); } catch { fail('OCEL_R4PM_ENGINE_OUTPUT_INVALID'); }
  const result = compareRust4pmDiscovery(prepared, external);
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > LIMIT) fail('OCEL_R4PM_OUTPUT_LIMIT');
  emit(result);
} catch (error) {
  const code = typeof error?.code === 'string' && /^OCEL_[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code : 'OCEL_R4PM_REVIEW_FAILED';
  emit({status: 'HOLD', code, source_authority: 'UNVERIFIED_LOCAL_COPY',
    anonymity: 'NOT_ESTABLISHED', export_allowed: false, iwxa_package: null});
  process.exitCode = 2;
}
