import { createHash } from 'node:crypto';

export const CONTRACT_VERSION = 'IWXA.K02.INTEROP/0.1.0';
export const PLAN_BINDING_VERSION = 'IWXA.K02.PLAN_BINDING/0.1.0';
const HEX64 = /^[a-f0-9]{64}$/;
const TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
const SCHEMA_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']);
const MAX_JSON_BYTES = 1_000_000;

export class InteropError extends Error {
  constructor(code, detail = '') {
    super(code + (detail ? ':' + detail : ''));
    this.name = 'InteropError';
    this.code = code;
  }
}

function fail(code, detail = '') { throw new InteropError(code, detail); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function name(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(value)) fail('INVALID_DESCRIPTOR', field);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export function canonical(value) {
  let encoded;
  try { encoded = JSON.stringify(stable(value)); } catch { fail('INVALID_JSON'); }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_JSON_BYTES) fail('INVALID_JSON');
  try { if (JSON.stringify(JSON.parse(encoded)) === undefined) fail('INVALID_JSON'); } catch { fail('INVALID_JSON'); }
  return encoded;
}
export function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function requireKeys(value, keys, label) {
  if (!object(value) || Object.keys(value).some(k => !keys.includes(k))) fail('INVALID_DESCRIPTOR', label);
}
function checkSchema(schema, depth = 0) {
  if (!object(schema) || depth > 24) fail('UNSUPPORTED_SCHEMA', 'object_or_depth');
  for (const key of Object.keys(schema)) if (!SCHEMA_KEYS.has(key)) fail('UNSUPPORTED_SCHEMA', key);
  if (!TYPES.has(schema.type)) fail('UNSUPPORTED_SCHEMA', 'type');
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) fail('UNSUPPORTED_SCHEMA', 'enum');
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (key in schema && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]) || (key.startsWith('min') || key.startsWith('max')) && !Number.isInteger(schema[key]))) fail('UNSUPPORTED_SCHEMA', key);
  }
  if (schema.type === 'object') {
    if (!object(schema.properties) || schema.additionalProperties !== false || !Array.isArray(schema.required)) fail('UNSUPPORTED_SCHEMA', 'closed_object_required');
    if (new Set(schema.required).size !== schema.required.length || schema.required.some(k => typeof k !== 'string' || !(k in schema.properties))) fail('UNSUPPORTED_SCHEMA', 'required');
    for (const s of Object.values(schema.properties)) checkSchema(s, depth + 1);
  } else if (schema.type === 'array') {
    if (!schema.items || !object(schema.items)) fail('UNSUPPORTED_SCHEMA', 'items');
    checkSchema(schema.items, depth + 1);
  } else if (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined || schema.items !== undefined) fail('UNSUPPORTED_SCHEMA', 'mixed_type');
  canonical(schema);
  return schema;
}
export function validateSchema(schema) { return checkSchema(schema); }
function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'object') return object(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}
function walk(schema, value, path) {
  if (!typeMatches(value, schema.type)) fail('SCHEMA_VALUE_INVALID', path + ':type');
  if (schema.enum && !schema.enum.some(candidate => canonical(candidate) === canonical(value))) fail('SCHEMA_VALUE_INVALID', path + ':enum');
  if (schema.type === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail('SCHEMA_VALUE_INVALID', path + ':minLength');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail('SCHEMA_VALUE_INVALID', path + ':maxLength');
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) fail('SCHEMA_VALUE_INVALID', path + ':minimum');
    if (schema.maximum !== undefined && value > schema.maximum) fail('SCHEMA_VALUE_INVALID', path + ':maximum');
  }
  if (schema.type === 'object') {
    for (const k of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(schema.properties, k)) fail('SCHEMA_VALUE_INVALID', path + '.' + k + ':unknown');
    for (const k of schema.required) if (!Object.prototype.hasOwnProperty.call(value, k)) fail('SCHEMA_VALUE_INVALID', path + '.' + k + ':required');
    for (const [k, v] of Object.entries(value)) walk(schema.properties[k], v, path + '.' + k);
  }
  if (schema.type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('SCHEMA_VALUE_INVALID', path + ':minItems');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('SCHEMA_VALUE_INVALID', path + ':maxItems');
    value.forEach((v, i) => walk(schema.items, v, path + '[' + i + ']'));
  }
}
export function validatePayload(schema, value) {
  checkSchema(schema);
  canonical(value);
  walk(schema, value, '$');
  return value;
}
function positiveOrNull(value, name) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail('INVALID_DESCRIPTOR', name);
}
function capability(cap) {
  requireKeys(cap, ['kind', 'capabilityId', 'supported', 'unsupportedReason', 'inputSchema', 'outputSchema', 'effectClass', 'providerFeeUsd', 'latencyMsP50', 'inputModes', 'outputModes'], 'capability');
  if (!['tool', 'model'].includes(cap.kind)) fail('INVALID_DESCRIPTOR', 'kind');
  name(cap.capabilityId, 'capabilityId');
  if (typeof cap.supported !== 'boolean') fail('INVALID_DESCRIPTOR', 'supported');
  if (!cap.supported && (typeof cap.unsupportedReason !== 'string' || !cap.unsupportedReason)) fail('INVALID_DESCRIPTOR', 'unsupportedReason');
  name(cap.effectClass, 'effectClass');
  checkSchema(cap.inputSchema); checkSchema(cap.outputSchema);
  positiveOrNull(cap.providerFeeUsd, 'providerFeeUsd');
  positiveOrNull(cap.latencyMsP50, 'latencyMsP50');
  if (cap.kind === 'model' && (!Array.isArray(cap.inputModes) || !Array.isArray(cap.outputModes) || !cap.inputModes.every(x => typeof x === 'string') || !cap.outputModes.every(x => typeof x === 'string'))) fail('INVALID_DESCRIPTOR', 'model_modes');
}
function descriptor(desc) {
  requireKeys(desc, ['contractVersion', 'providerId', 'availability', 'unavailableReason', 'capabilities'], 'provider');
  if (desc.contractVersion !== CONTRACT_VERSION) fail('CONTRACT_VERSION_MISMATCH');
  name(desc.providerId, 'providerId');
  if (!['available', 'unavailable'].includes(desc.availability)) fail('INVALID_DESCRIPTOR', 'availability');
  if (desc.availability === 'unavailable' && (typeof desc.unavailableReason !== 'string' || !desc.unavailableReason)) fail('INVALID_DESCRIPTOR', 'unavailableReason');
  if (!Array.isArray(desc.capabilities)) fail('INVALID_DESCRIPTOR', 'capabilities');
  const seen = new Set();
  for (const cap of desc.capabilities) {
    capability(cap);
    const id = cap.kind + ':' + cap.capabilityId;
    if (seen.has(id)) fail('INVALID_DESCRIPTOR', 'duplicate_capability');
    seen.add(id);
  }
  canonical(desc);
  return desc;
}
export async function describeCapabilities(provider) {
  if (!provider || typeof provider.describeCapabilities !== 'function') fail('PROVIDER_UNAVAILABLE', 'missing_probe');
  return descriptor(await provider.describeCapabilities());
}
function requirement(req) {
  requireKeys(req, ['requirementId', 'kind', 'capabilityId', 'inputSchema', 'outputSchema', 'effectClass', 'required'], 'requirement');
  name(req.requirementId, 'requirementId');
  name(req.capabilityId, 'capabilityId');
  name(req.effectClass, 'effectClass');
  if (!['tool', 'model'].includes(req.kind) || typeof req.required !== 'boolean') fail('INVALID_DESCRIPTOR', 'requirement');
  checkSchema(req.inputSchema); checkSchema(req.outputSchema);
}
function rank(cap, providerId) {
  return [cap.providerFeeUsd === null ? Infinity : cap.providerFeeUsd, cap.latencyMsP50 === null ? Infinity : cap.latencyMsP50, providerId];
}
function cmp(a, b) {
  const x = rank(a.cap, a.provider.providerId), y = rank(b.cap, b.provider.providerId);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'en');
}
export function resolveRequirements(solution, available) {
  if (!object(solution) || typeof solution.solutionId !== 'string' || !Array.isArray(solution.requirements) || !Array.isArray(available)) fail('INVALID_DESCRIPTOR', 'resolution_input');
  name(solution.solutionId, 'solutionId');
  const providerIds = new Set();
  for (const provider of available) { descriptor(provider); if (providerIds.has(provider.providerId)) fail('INVALID_DESCRIPTOR', 'duplicate_provider'); providerIds.add(provider.providerId); }
  const reqIds = new Set(), selected = [], missing = [];
  for (const req of solution.requirements) {
    requirement(req);
    if (reqIds.has(req.requirementId)) fail('INVALID_DESCRIPTOR', 'duplicate_requirement');
    reqIds.add(req.requirementId);
    const candidates = [], causes = new Set();
    for (const provider of available) {
      const cap = provider.capabilities.find(c => c.kind === req.kind && c.capabilityId === req.capabilityId);
      if (!cap) continue;
      if (provider.availability !== 'available') { causes.add('UNAVAILABLE'); continue; }
      if (!cap.supported) { causes.add('UNSUPPORTED'); continue; }
      if (cap.effectClass !== req.effectClass) { causes.add('EFFECT_MISMATCH'); continue; }
      if (canonical(cap.inputSchema) !== canonical(req.inputSchema) || canonical(cap.outputSchema) !== canonical(req.outputSchema)) { causes.add('SCHEMA_MISMATCH'); continue; }
      candidates.push({ provider, cap });
    }
    candidates.sort(cmp);
    if (candidates.length) {
      const pick = candidates[0];
      selected.push({
        requirementId: req.requirementId, providerId: pick.provider.providerId,
        kind: req.kind, capabilityId: req.capabilityId, effectClass: req.effectClass,
        inputSchema: req.inputSchema, outputSchema: req.outputSchema,
        providerFeeUsd: pick.cap.providerFeeUsd, latencyMsP50: pick.cap.latencyMsP50,
        capabilityDigest: digest({ contractVersion: CONTRACT_VERSION, providerId: pick.provider.providerId, capability: pick.cap })
      });
    } else missing.push({ requirementId: req.requirementId, required: req.required,
      reason: ['UNAVAILABLE', 'UNSUPPORTED', 'SCHEMA_MISMATCH', 'EFFECT_MISMATCH'].find(x => causes.has(x)) || 'ABSENT' });
  }
  const requiredMissing = missing.some(m => m.required);
  const totalProviderFeeUsd = selected.every(s => s.providerFeeUsd !== null) ? selected.reduce((n,s) => n + s.providerFeeUsd, 0) : null;
  const estimatedLatencyMs = selected.every(s => s.latencyMsP50 !== null) ? selected.reduce((n,s) => n + s.latencyMsP50, 0) : null;
  return { contractVersion: CONTRACT_VERSION, solutionId: solution.solutionId, status: requiredMissing ? 'UNSUPPORTED' : 'SUPPORTED',
    selected, missing, estimates: { providerFeeUsd: totalProviderFeeUsd, latencyMs: estimatedLatencyMs, hostComputeCostUsd: null } };
}
export function buildInvocationPlan(task, selectedSkills, resolution) {
  if (!object(task) || !task.taskId || !task.solutionId || !Array.isArray(selectedSkills) || !object(resolution)) fail('INVALID_PLAN', 'inputs');
  name(task.taskId, 'taskId'); name(task.solutionId, 'solutionId');
  if (resolution.status !== 'SUPPORTED' || resolution.solutionId !== task.solutionId || resolution.contractVersion !== CONTRACT_VERSION) fail('INVALID_PLAN', 'unresolved');
  const covered = new Set(resolution.selected.map(s => s.capabilityId));
  if (resolution.selected.some(s => !object(s) || !HEX64.test(s.capabilityDigest ?? '') ||
      typeof s.providerId !== 'string' || typeof s.kind !== 'string' ||
      typeof s.capabilityId !== 'string')) fail('INVALID_PLAN', 'unbound_capability');
  const skills = [];
  for (const skill of selectedSkills) {
    if (!object(skill) || skill.schema !== 'IWXA.K02.SKILL/0.1.0' || typeof skill.skillId !== 'string' || !Array.isArray(skill.requiredCapabilities) || !skill.requiredCapabilities.every(x => covered.has(x)) || !skill.instructionRef || !skill.verification || !HEX64.test(skill.instructionDigest ?? '') ||
      !/^skills\/[A-Za-z0-9._/-]+$/.test(skill.instructionRef) ||
      skill.instructionRef.split('/').includes('..')) fail('INVALID_PLAN', 'skill_dependency');
    name(skill.skillId, 'skillId');
    validateSchema(skill.parametersSchema);
    skills.push({ skillId: skill.skillId, instructionRef: skill.instructionRef,
      instructionDigest: skill.instructionDigest, descriptorDigest: digest(skill), verification: skill.verification });
  }
  const body = { contractVersion: CONTRACT_VERSION, bindingVersion: PLAN_BINDING_VERSION,
    taskId: task.taskId, solutionId: task.solutionId,
    skills, steps: resolution.selected.map(s => ({ requirementId: s.requirementId, providerId: s.providerId,
      kind: s.kind, capabilityId: s.capabilityId, capabilityDigest: s.capabilityDigest,
      effectClass: s.effectClass,
      inputSchema: s.inputSchema, outputSchema: s.outputSchema, hostApprovalRequired: true,
      invocationAuthority: 'HOST_ONLY', invocationState: 'NOT_INVOKED', proofOfInvoke: null })),
    estimates: resolution.estimates };
  return { ...body, planDigest: digest(body) };
}
export function validateInvocationInput(step, input) {
  if (!object(step) || step.invocationAuthority !== 'HOST_ONLY') fail('INVALID_PLAN', 'step');
  return validatePayload(step.inputSchema, input);
}
export function validateInvocationOutput(step, output) {
  if (!object(step) || step.invocationAuthority !== 'HOST_ONLY') fail('INVALID_PLAN', 'step');
  return validatePayload(step.outputSchema, output);
}

function assertTrustedPlan(plan, trustedPlanDigest) {
  if (!object(plan) || plan.contractVersion !== CONTRACT_VERSION ||
      plan.bindingVersion !== PLAN_BINDING_VERSION ||
      !HEX64.test(trustedPlanDigest ?? '') || !HEX64.test(plan.planDigest ?? '') ||
      trustedPlanDigest !== plan.planDigest) fail('INVALID_PLAN', 'untrusted_plan');
  const body = { ...plan };
  delete body.planDigest;
  if (digest(body) !== trustedPlanDigest || !Array.isArray(plan.steps) ||
      !Array.isArray(plan.skills)) fail('INVALID_PLAN', 'plan_changed');
  const seen = new Set();
  for (const step of plan.steps) {
    if (!object(step) || typeof step.requirementId !== 'string' ||
        seen.has(step.requirementId) || typeof step.providerId !== 'string' ||
        !HEX64.test(step.capabilityDigest ?? '') ||
        !['model', 'tool'].includes(step.kind) ||
        step.hostApprovalRequired !== true ||
        step.invocationAuthority !== 'HOST_ONLY' ||
        step.invocationState !== 'NOT_INVOKED' || step.proofOfInvoke !== null) {
      fail('INVALID_PLAN', 'step_binding');
    }
    seen.add(step.requirementId);
  }
  return plan;
}

// This is a compatibility check, NOT an execution grant. The host alone
// supplies the trusted digest and the authority to invoke its existing port.
export async function verifyInvocationReadiness(plan, requirementId, provider, trustedPlanDigest) {
  assertTrustedPlan(plan, trustedPlanDigest);
  const step = plan.steps.find(x => x.requirementId === requirementId);
  if (!step) fail('INVALID_PLAN', 'requirement_not_in_plan');
  const current = await describeCapabilities(provider);
  if (current.availability !== 'available') fail('PROVIDER_UNAVAILABLE', 'provider_no_longer_available');
  if (current.providerId !== step.providerId) fail('BINDING_CHANGED', 'provider_id');
  const cap = current.capabilities.find(x => x.kind === step.kind && x.capabilityId === step.capabilityId);
  if (!cap || !cap.supported || cap.effectClass !== step.effectClass ||
      canonical(cap.inputSchema) !== canonical(step.inputSchema) ||
      canonical(cap.outputSchema) !== canonical(step.outputSchema) ||
      digest({ contractVersion: CONTRACT_VERSION, providerId: current.providerId, capability: cap }) !== step.capabilityDigest) {
    fail('BINDING_CHANGED', 'capability');
  }
  return { status: 'MATCHED_NOT_AUTHORIZED', planDigest: trustedPlanDigest,
    requirementId, providerId: current.providerId, capabilityDigest: step.capabilityDigest };
}

// Host supplies the originally selected descriptor and loaded raw instruction
// bytes. Neither text nor descriptor confers permission to call a runtime.
export function verifySkillBinding(plan, skillId, skillDescriptor, instructionBytes, trustedPlanDigest) {
  assertTrustedPlan(plan, trustedPlanDigest);
  const selected = plan.skills.find(x => x.skillId === skillId);
  if (!selected || !object(skillDescriptor) || skillDescriptor.skillId !== skillId ||
      digest(skillDescriptor) !== selected.descriptorDigest ||
      skillDescriptor.instructionRef !== selected.instructionRef ||
      skillDescriptor.instructionDigest !== selected.instructionDigest) {
    fail('BINDING_CHANGED', 'skill_descriptor');
  }
  if (!(instructionBytes instanceof Uint8Array) ||
      instructionBytes.byteLength > 1_000_000 ||
      createHash('sha256').update(instructionBytes).digest('hex') !== selected.instructionDigest) {
    fail('BINDING_CHANGED', 'skill_instructions');
  }
  return { status: 'MATCHED_NOT_ACTIVATED', skillId, instructionDigest: selected.instructionDigest };
}
