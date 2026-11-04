import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { CONTRACT_VERSION, InteropError, validatePayload } from '../index.mjs';

const string = { type: 'string', minLength: 1 };
const candidate = { type: 'object', required: ['action', 'quote', 'start', 'end'], additionalProperties: false,
  properties: { action: { ...string, maxLength: 200 }, quote: { ...string, maxLength: 1000 },
    start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 1 } } };
export const AUDIT_INPUT = { type: 'object', required: ['transcript', 'candidates'], additionalProperties: false,
  properties: { transcript: { ...string, maxLength: 200000 }, candidates: { type: 'array', items: candidate, minItems: 1, maxItems: 100 } } };
const accepted = { ...candidate };
const rejected = { type: 'object', required: ['candidateIndex', 'reason'], additionalProperties: false,
  properties: { candidateIndex: { type: 'integer', minimum: 0 }, reason: { type: 'string', enum: ['SOURCE_SPAN_MISMATCH'] } } };
export const AUDIT_OUTPUT = { type: 'object', required: ['status', 'accepted', 'rejected', 'transcriptSha256'], additionalProperties: false,
  properties: { status: { type: 'string', enum: ['REVIEW_REQUIRED'] }, accepted: { type: 'array', items: accepted },
    rejected: { type: 'array', items: rejected }, transcriptSha256: string } };
const CAPABILITY = { kind: 'tool', capabilityId: 'evidence.exact.audit', supported: true, inputSchema: AUDIT_INPUT, outputSchema: AUDIT_OUTPUT,
  effectClass: 'PURE_COMPUTE', providerFeeUsd: 0, latencyMsP50: null };
const worker = fileURLToPath(new URL('./audit-worker.mjs', import.meta.url));

export class NodeEvidenceCliProvider {
  constructor(executable = process.execPath) { this.executable = executable; }
  async describeCapabilities() {
    return new Promise(resolve => {
      const child = spawn(this.executable, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let settled = false;
      const finish = available => {
        if (settled) return; settled = true;
        resolve({ contractVersion: CONTRACT_VERSION, providerId: 'node-evidence-cli',
          availability: available ? 'available' : 'unavailable',
          ...(!available ? { unavailableReason: 'NODE_CLI_UNAVAILABLE' } : {}),
          capabilities: [CAPABILITY] });
      };
      child.once('error', () => finish(false));
      child.once('exit', code => finish(code === 0));
    });
  }
  async invoke(operation, input, authorization) {
    if (operation !== 'evidence.exact.audit') throw new InteropError('UNSUPPORTED', 'operation');
    if (!authorization || authorization.hostApproved !== true) throw new InteropError('HOST_APPROVAL_REQUIRED');
    validatePayload(AUDIT_INPUT, input);
    const start = performance.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [worker], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', settled = false;
      const timer = setTimeout(() => { child.kill(); finish(new InteropError('PROVIDER_UNAVAILABLE', 'timeout')); }, 10000);
      function finish(error, value) {
        if (settled) return; settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      }
      child.on('error', () => finish(new InteropError('PROVIDER_UNAVAILABLE', 'spawn')));
      child.stdout.on('data', data => { stdout += data.toString(); if (Buffer.byteLength(stdout) > 750000) { child.kill(); finish(new InteropError('PROVIDER_UNAVAILABLE', 'oversized_output')); } });
      child.stderr.on('data', data => { stderr += data.toString(); if (stderr.length > 4000) stderr = stderr.slice(0,4000); });
      child.on('close', code => {
        if (settled) return;
        if (code !== 0) return finish(new InteropError('PROVIDER_UNAVAILABLE', 'worker_exit'));
        let output;
        try { output = JSON.parse(stdout); validatePayload(AUDIT_OUTPUT, output); }
        catch { return finish(new InteropError('INVALID_PROVIDER_OUTPUT')); }
        finish(null, { status: 'SUCCEEDED', output,
          observation: { providerId: 'node-evidence-cli', capabilityId: operation,
            transport: 'node-cli', durationMs: Math.max(0.001, performance.now() - start),
            actualProviderFeeUsd: 0, verifiedOutputDigest: createHash('sha256').update(JSON.stringify(output)).digest('hex') } });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(input));
    });
  }
}
