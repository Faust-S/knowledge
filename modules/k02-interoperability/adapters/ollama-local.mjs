import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CONTRACT_VERSION, InteropError, validatePayload } from '../index.mjs';

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const LOOPBACK = 'http://127.0.0.1:11434';
const MAX_RESPONSE_BYTES = 256_000;
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

export const MODEL_INPUT = Object.freeze({
  type: 'object', additionalProperties: false, required: ['system', 'prompt', 'max_output_tokens'],
  properties: {
    system: { type: 'string', maxLength: 8192 },
    prompt: { type: 'string', minLength: 1, maxLength: 16384 },
    max_output_tokens: { type: 'integer', minimum: 1, maximum: 128 },
  },
});
export const MODEL_OUTPUT = Object.freeze({
  type: 'object', additionalProperties: false, required: ['text', 'model', 'model_digest'],
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 16384 },
    model: { type: 'string', minLength: 1, maxLength: 160 },
    model_digest: { type: 'string', minLength: 64, maxLength: 64 },
  },
});
export const MODEL_CAPABILITY_ID = 'text.generate';

async function boundedJson(response) {
  const sizeHeader = response.headers?.get?.('content-length');
  if (sizeHeader !== null && sizeHeader !== undefined && Number(sizeHeader) > MAX_RESPONSE_BYTES) {
    throw new InteropError('INVALID_PROVIDER_OUTPUT', 'oversized_response');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new InteropError('INVALID_PROVIDER_OUTPUT', 'missing_body');
  }
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new InteropError('INVALID_PROVIDER_OUTPUT', 'oversized_response');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } catch {
    throw new InteropError('INVALID_PROVIDER_OUTPUT', 'invalid_json');
  }
}
function failedResponse(response) {
  if (response.status === 404) return new InteropError('PROVIDER_UNAVAILABLE', 'MODEL_OR_ENDPOINT_NOT_FOUND');
  return new InteropError('PROVIDER_UNAVAILABLE', 'HTTP_' + response.status);
}
function numberOfTokens(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new InteropError('INVALID_PROVIDER_OUTPUT', label);
  return value;
}
function durationNs(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new InteropError('INVALID_PROVIDER_OUTPUT', label);
  return value;
}

export class OllamaLocalModelProvider {
  constructor({ modelName, expectedDigest, fetchImpl = globalThis.fetch,
    providerId = 'ollama-local-pinned', thinkingMode = 'auto', latencyMsP50 = null } = {}) {
    if (typeof modelName !== 'string' || !MODEL_NAME.test(modelName) || modelName.toLowerCase().endsWith(':cloud')) {
      throw new InteropError('INVALID_DESCRIPTOR', 'model_name');
    }
    if (typeof expectedDigest !== 'string' || !DIGEST.test(expectedDigest)) {
      throw new InteropError('INVALID_DESCRIPTOR', 'expected_model_digest');
    }
    if (typeof providerId !== 'string' || !MODEL_NAME.test(providerId) ||
      providerId.length > 160 || !['auto','enabled','disabled'].includes(thinkingMode)) {
      throw new InteropError('INVALID_DESCRIPTOR', 'provider_id_or_thinking_mode');
    }
    if (latencyMsP50 !== null &&
      (typeof latencyMsP50 !== 'number' || !Number.isFinite(latencyMsP50) || latencyMsP50<0)) {
      throw new InteropError('INVALID_DESCRIPTOR','latency_observation');
    }
    if (typeof fetchImpl !== 'function') throw new InteropError('PROVIDER_UNAVAILABLE', 'fetch_unavailable');
    this.modelName = modelName;
    this.expectedDigest = expectedDigest;
    this.fetchImpl = fetchImpl;
    this.providerId = providerId;
    this.thinkingMode = thinkingMode;
    this.latencyMsP50 = latencyMsP50;
  }
  async request(path, options, timeoutMs) {
    // Deliberately fixed loopback origin. Host controls transport, credentials and consent.
    try {
      return await this.fetchImpl(LOOPBACK + path, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new InteropError('PROVIDER_UNAVAILABLE', 'LOOPBACK_UNREACHABLE');
    }
  }
  async assertPinnedModel() {
    const response = await this.request('/api/tags', { method: 'GET', headers: { Accept: 'application/json' } }, 5000);
    if (response.status !== 200) throw failedResponse(response);
    const data = await boundedJson(response);
    if (!data || !Array.isArray(data.models)) throw new InteropError('INVALID_PROVIDER_OUTPUT', 'models_missing');
    const found = data.models.filter(m => m && m.name === this.modelName);
    if (found.length !== 1) throw new InteropError('PROVIDER_UNAVAILABLE', 'MODEL_NOT_INSTALLED');
    if (found[0].digest !== this.expectedDigest) throw new InteropError('PROVIDER_UNAVAILABLE', 'MODEL_DIGEST_CHANGED');
    return { modelName: this.modelName, modelDigest: this.expectedDigest };
  }
  async describeCapabilities() {
    let reason = null;
    try { await this.assertPinnedModel(); }
    catch (e) { reason = e instanceof InteropError ? e.code + ':' + e.message : 'MODEL_UNAVAILABLE'; }
    return {
      contractVersion: CONTRACT_VERSION, providerId: this.providerId,
      availability: reason === null ? 'available' : 'unavailable',
      ...(reason !== null ? { unavailableReason: reason } : {}),
      capabilities: [{
        kind: 'model', capabilityId: MODEL_CAPABILITY_ID,
        supported: true, inputSchema: MODEL_INPUT, outputSchema: MODEL_OUTPUT,
        effectClass: 'MODEL_INFERENCE', providerFeeUsd: 0, latencyMsP50: this.latencyMsP50,
        inputModes: ['text'], outputModes: ['text'],
        modelPin: { name: this.modelName, digest: this.expectedDigest },
      }],
    };
  }
  async invoke(operation, input, authorization) {
    if (operation !== MODEL_CAPABILITY_ID) throw new InteropError('UNSUPPORTED', 'operation');
    if (!authorization || authorization.hostApproved !== true ||
      authorization.pinnedModelDigest !== this.expectedDigest) {
      throw new InteropError('HOST_APPROVAL_REQUIRED');
    }
    validatePayload(MODEL_INPUT, input);
    await this.assertPinnedModel();
    const start = performance.now();
    const response = await this.request('/api/generate', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({
        model: this.modelName, system: input.system, prompt: input.prompt, stream: false,
        options: { temperature: 0, seed: 7, num_predict: input.max_output_tokens },
        ...(this.thinkingMode === 'auto' ? {} : { think: this.thinkingMode === 'enabled' }),
        keep_alive: '5m',
      }),
    }, 120_000);
    if (response.status !== 200) throw failedResponse(response);
    const raw = await boundedJson(response);
    const durationMs = Math.max(0.001, performance.now() - start);
    if (!raw || raw.done !== true || raw.model !== this.modelName || typeof raw.response !== 'string'
      || raw.response.trim().length === 0 || Buffer.byteLength(raw.response, 'utf8') > 16_384) {
      throw new InteropError('INVALID_PROVIDER_OUTPUT', 'inference_response');
    }
    const promptTokens = numberOfTokens(raw.prompt_eval_count, 'prompt_eval_count');
    const completionTokens = numberOfTokens(raw.eval_count, 'eval_count');
    if (completionTokens === 0) throw new InteropError('INVALID_PROVIDER_OUTPUT', 'zero_completion_tokens');
    const totalDurationNs = durationNs(raw.total_duration, 'total_duration');
    const generationDurationNs = durationNs(raw.eval_duration, 'eval_duration');
    // Do not certify output from a different model when local model tags mutate mid-call.
    await this.assertPinnedModel();
    const output = { text: raw.response, model: this.modelName, model_digest: this.expectedDigest };
    validatePayload(MODEL_OUTPUT, output);
    return {
      status: 'SUCCEEDED', output,
      observation: {
        providerId: this.providerId, capabilityId: operation, transport: 'ollama-local-http',
        thinkingMode: this.thinkingMode,
        modelName: this.modelName, modelDigest: this.expectedDigest,
        durationMs, promptTokens, completionTokens,
        totalDurationNs, generationDurationNs,
        actualProviderFeeUsd: 0, hostComputeCostUsd: null,
        outputSha256: createHash('sha256').update(raw.response, 'utf8').digest('hex'),
        proofClass: 'REAL_LOCAL_MODEL_INFERENCE_NOT_PRODUCT_TASK',
      },
    };
  }
}
