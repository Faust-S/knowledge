import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CONTRACT_VERSION, InteropError, validatePayload } from '../index.mjs';
import { GIT_INPUT, GIT_OUTPUT } from './git-cli.mjs';

const MAX_BYTES = 200_000;
const FULL_SHA = /^[a-f0-9]{40}$/;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!\.git(?:\/|$))[A-Za-z0-9][A-Za-z0-9._\/-]{0,299}$/;
const DIGEST = /^[a-f0-9]{40}$/;
const CAPABILITY = Object.freeze({
  kind: 'tool', capabilityId: 'source.git.show', supported: true,
  inputSchema: GIT_INPUT, outputSchema: GIT_OUTPUT, effectClass: 'HOST_AUTHORIZED_READ',
  providerFeeUsd: 0, latencyMsP50: null,
});

async function readSmallJson(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 600_000) throw new InteropError('INVALID_PROVIDER_OUTPUT', 'oversized_response');
  if (!response.body) throw new InteropError('INVALID_PROVIDER_OUTPUT', 'no_response_body');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 600_000) throw new InteropError('INVALID_PROVIDER_OUTPUT', 'oversized_response');
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(parts, size).toString('utf8')); }
  catch { throw new InteropError('INVALID_PROVIDER_OUTPUT', 'invalid_json'); }
}
function authHeaders() {
  return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'IWXA-K02-Public-Read-Only' };
}
function httpError(response) {
  if (response.status === 403 || response.status === 429) return new InteropError('PROVIDER_UNAVAILABLE', 'RATE_LIMITED_OR_DENIED');
  if (response.status === 404) return new InteropError('PROVIDER_UNAVAILABLE', 'SOURCE_NOT_FOUND');
  return new InteropError('PROVIDER_UNAVAILABLE', 'HTTP_' + response.status);
}
function decodeGithubFile(raw) {
  if (!raw || raw.type !== 'file' || raw.encoding !== 'base64' || typeof raw.content !== 'string' || !DIGEST.test(raw.sha)) {
    throw new InteropError('INVALID_PROVIDER_OUTPUT', 'file_metadata');
  }
  const b64 = raw.content.replace(/\s/g, '');
  if (!b64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) {
    throw new InteropError('INVALID_PROVIDER_OUTPUT', 'base64');
  }
  const data = Buffer.from(b64, 'base64');
  if (data.length > MAX_BYTES || raw.size !== data.length) throw new InteropError('INVALID_PROVIDER_OUTPUT', 'size');
  const header = Buffer.from('blob ' + data.length + '\0');
  const actualBlobSha = createHash('sha1').update(header).update(data).digest('hex');
  if (actualBlobSha !== raw.sha) throw new InteropError('INVALID_PROVIDER_OUTPUT', 'git_blob_sha_mismatch');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw new InteropError('INVALID_PROVIDER_OUTPUT', 'non_utf8'); }
  return content;
}

export class GitHubPublicRestProvider {
  constructor({ owner, repo, fetchImpl = globalThis.fetch } = {}) {
    if (!COMPONENT.test(owner ?? '') || !COMPONENT.test(repo ?? '')) throw new InteropError('INVALID_DESCRIPTOR', 'public_repository');
    if (typeof fetchImpl !== 'function') throw new InteropError('PROVIDER_UNAVAILABLE', 'no_fetch');
    this.owner = owner;
    this.repo = repo;
    this.fetchImpl = fetchImpl;
  }
  get repoUrl() { return 'https://api.github.com/repos/' + this.owner + '/' + this.repo; }
  async request(url) {
    try {
      return await this.fetchImpl(url, {
        method: 'GET', headers: authHeaders(), redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new InteropError('PROVIDER_UNAVAILABLE', 'PUBLIC_API_NETWORK_ERROR');
    }
  }
  async describeCapabilities() {
    let reason;
    try {
      const response = await this.request(this.repoUrl);
      if (response.status !== 200) reason = httpError(response).message;
    } catch (e) { reason = e.message; }
    return { contractVersion: CONTRACT_VERSION, providerId: 'github-public-rest',
      availability: reason ? 'unavailable' : 'available',
      ...(reason ? { unavailableReason: reason } : {}),
      capabilities: [CAPABILITY] };
  }
  async invoke(operation, input, authorization) {
    if (operation !== 'source.git.show') throw new InteropError('UNSUPPORTED', 'operation');
    if (!authorization || authorization.hostApproved !== true) throw new InteropError('HOST_APPROVAL_REQUIRED');
    validatePayload(GIT_INPUT, input);
    if (!FULL_SHA.test(input.revision) || !SAFE_PATH.test(input.path)) throw new InteropError('INVALID_SOURCE_REF');
    const start = performance.now();
    const fileUrl = this.repoUrl + '/contents/' + input.path.split('/').map(encodeURIComponent).join('/') + '?ref=' + input.revision;
    const response = await this.request(fileUrl);
    if (response.status !== 200) throw httpError(response);
    const data = await readSmallJson(response);
    const content = decodeGithubFile(data);
    const output = { sourceRef: 'github:' + this.owner + '/' + this.repo + '@' + input.revision + ':' + input.path,
      revision: input.revision, content,
      sha256: createHash('sha256').update(content, 'utf8').digest('hex') };
    validatePayload(GIT_OUTPUT, output);
    const durationMs = Math.max(0.001, performance.now() - start);
    return { status: 'SUCCEEDED', output,
      observation: { providerId: 'github-public-rest', capabilityId: operation,
        transport: 'github-public-rest', durationMs, actualProviderFeeUsd: 0,
        gitBlobSha1: data.sha, verifiedOutputDigest: createHash('sha256').update(JSON.stringify(output)).digest('hex') } };
  }
}
