import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { CONTRACT_VERSION, InteropError, validatePayload } from '../index.mjs';

const run = promisify(execFile);
const string = { type: 'string', minLength: 1 };
export const GIT_INPUT = { type: 'object', required: ['revision', 'path'], additionalProperties: false, properties: { revision: { ...string, maxLength: 40 }, path: { ...string, maxLength: 300 } } };
export const GIT_OUTPUT = { type: 'object', required: ['sourceRef', 'revision', 'content', 'sha256'], additionalProperties: false,
  properties: { sourceRef: string, revision: string, content: { type: 'string' }, sha256: string } };
const CAPABILITY = { kind: 'tool', capabilityId: 'source.git.show', supported: true, inputSchema: GIT_INPUT, outputSchema: GIT_OUTPUT,
  effectClass: 'HOST_AUTHORIZED_READ', providerFeeUsd: 0, latencyMsP50: null };
const HEX40 = /^[a-f0-9]{40}$/;
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!\.git(?:\/|$))[A-Za-z0-9][A-Za-z0-9._\/-]{0,299}$/;

export class GitCliProvider {
  constructor(repoPath) { this.repoPath = repoPath; }
  async describeCapabilities() {
    try {
      await run('git', ['--version'], { timeout: 5000 });
      await run('git', ['-C', this.repoPath, 'rev-parse', '--is-inside-work-tree'], { timeout: 5000 });
      return { contractVersion: CONTRACT_VERSION, providerId: 'git-cli', availability: 'available', capabilities: [CAPABILITY] };
    } catch {
      return { contractVersion: CONTRACT_VERSION, providerId: 'git-cli', availability: 'unavailable', unavailableReason: 'GIT_CLI_OR_REPOSITORY_UNAVAILABLE', capabilities: [CAPABILITY] };
    }
  }
  async invoke(operation, input, authorization) {
    if (operation !== 'source.git.show') throw new InteropError('UNSUPPORTED', 'operation');
    if (!authorization || authorization.hostApproved !== true) throw new InteropError('HOST_APPROVAL_REQUIRED');
    validatePayload(GIT_INPUT, input);
    if (!HEX40.test(input.revision) || !SAFE_PATH.test(input.path)) throw new InteropError('INVALID_SOURCE_REF');
    const start = performance.now();
    let stdout;
    try {
      ({ stdout } = await run('git', ['-C', this.repoPath, 'show', input.revision + ':' + input.path], { timeout: 10000, maxBuffer: 750000, encoding: 'utf8' }));
    } catch { throw new InteropError('PROVIDER_UNAVAILABLE', 'git_show_failed'); }
    const output = { sourceRef: 'git:' + input.revision + ':' + input.path, revision: input.revision,
      content: stdout, sha256: createHash('sha256').update(stdout).digest('hex') };
    validatePayload(GIT_OUTPUT, output);
    return { status: 'SUCCEEDED', output, observation: { providerId: 'git-cli', capabilityId: operation,
      transport: 'git-cli', durationMs: Math.max(0.001, performance.now() - start), actualProviderFeeUsd: 0, verifiedOutputDigest: createHash('sha256').update(JSON.stringify(output)).digest('hex') } };
  }
}
