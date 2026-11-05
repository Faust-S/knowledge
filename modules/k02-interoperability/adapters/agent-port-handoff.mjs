import {
  CONTRACT_VERSION, PLAN_BINDING_VERSION, InteropError,
  verifyInvocationReadiness, validateInvocationInput,
} from '../index.mjs';

export const AGENT_PORT_HANDOFF_VERSION = 'IWXA.K02.AGENT_PORT_HANDOFF/0.1.0';

const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,199}$/;
const LOCAL_NATIVE_IDS = new Set(['OLLAMA_LOCAL_V1', 'IWXA_BASIC_RUNTIME_V1']);

function invalid(reason) { throw new InteropError('INVALID_HANDOFF', reason); }
function dict(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fields(obj, required, allowed, label) {
  if (!dict(obj)) invalid(label);
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) invalid(label + '_extra');
  for (const k of required) if (!Object.hasOwn(obj, k)) invalid(label + '_missing_' + k);
}
function identifier(value, name) { if (typeof value !== 'string' || !ID.test(value)) invalid(name); }
function sha(value, name) { if (typeof value !== 'string' || !HEX64.test(value)) invalid(name); }
function selectedStep(plan, requirementId, kind) {
  const s = plan.steps.find(row => row.requirementId === requirementId);
  if (!s || s.kind !== kind || s.hostApprovalRequired !== true ||
      s.invocationAuthority !== 'HOST_ONLY' || s.invocationState !== 'NOT_INVOKED' ||
      s.proofOfInvoke !== null) invalid('wrong_selected_kind_or_state');
  return s;
}
function envelope(plan, step, readiness, targetPort, portRequest) {
  if (readiness.status !== 'MATCHED_NOT_AUTHORIZED') invalid('readiness');
  return {
    schema: AGENT_PORT_HANDOFF_VERSION,
    contractVersion: CONTRACT_VERSION,
    bindingVersion: PLAN_BINDING_VERSION,
    status: 'REQUEST_DRAFT_NOT_AUTHORIZED',
    targetPort: { contractId: targetPort, contractVersion: '1.0.0' },
    selected: {
      requirementId: step.requirementId,
      providerId: step.providerId,
      capabilityId: step.capabilityId,
      capabilityDigest: step.capabilityDigest,
      k02PlanDigest: plan.planDigest,
    },
    nativeBindingVerified: false,
    hostAuthorityGranted: false,
    resultProduced: false,
    portRequest,
  };
}

// Pure mapping into existing PA.PORT.MODEL_PROVIDER@1.0.0 request shape.
// Does NOT create the private in-process _authorized_local_model context.
// The host must independently resolve and authorize its native binding.
export async function draftAgentModelRequest({
  plan, trustedPlanDigest, requirementId, provider, nativeBinding, input, requestId,
}) {
  const ready = await verifyInvocationReadiness(plan, requirementId, provider, trustedPlanDigest);
  const step = selectedStep(plan, requirementId, 'model');
  if (step.effectClass !== 'MODEL_INFERENCE') invalid('model_effect_class');
  if (step.capabilityId !== 'text.generate') invalid('model_capability_not_supported_by_port_mapping');
  validateInvocationInput(step, input);
  if (!dict(input) || typeof input.system !== 'string' || typeof input.prompt !== 'string' ||
      !Number.isSafeInteger(input.max_output_tokens) || input.max_output_tokens < 1 ||
      input.max_output_tokens > 65536) invalid('native_model_payload_shape');
  fields(nativeBinding, ['logicalProviderId','providerBindingDigest'],
    ['logicalProviderId','providerBindingDigest','localModelPin'], 'model_native_binding');
  identifier(nativeBinding.logicalProviderId, 'logical_provider_id');
  sha(nativeBinding.providerBindingDigest, 'native_model_binding_digest');
  if (nativeBinding.providerBindingDigest === step.capabilityDigest ||
      nativeBinding.providerBindingDigest === plan.planDigest) invalid('k02_digest_not_native_binding');
  identifier(requestId, 'request_id');
  const payload = {
    system: input.system,
    prompt: input.prompt,
    max_output_tokens: input.max_output_tokens,
  };
  if (step.providerId === 'ollama-local-pinned' && !Object.hasOwn(nativeBinding,'localModelPin')) {
    invalid('local_model_pin_required');
  }
  if (step.modelPin !== undefined && !Object.hasOwn(nativeBinding, 'localModelPin')) {
    throw new InteropError('BINDING_CHANGED', 'missing_selected_model_pin');
  }
  if (Object.hasOwn(nativeBinding, 'localModelPin')) {
    if (!LOCAL_NATIVE_IDS.has(nativeBinding.logicalProviderId)) invalid('local_port_identity');
    const pin = nativeBinding.localModelPin;
    fields(pin, ['name','digest'], ['name','digest'], 'local_model_pin');
    identifier(pin.name, 'local_model_name');
    sha(pin.digest, 'local_model_digest');
    if (provider.modelName !== undefined && provider.modelName !== pin.name) {
      throw new InteropError('BINDING_CHANGED', 'local_model_name');
    }
    if (provider.expectedDigest !== undefined && provider.expectedDigest !== pin.digest) {
      throw new InteropError('BINDING_CHANGED', 'local_model_digest');
    }
    if (step.modelPin &&
        (step.modelPin.name !== pin.name || step.modelPin.digest !== pin.digest)) {
      throw new InteropError('BINDING_CHANGED', 'selected_model_pin');
    }
    payload.local_model = { name: pin.name, digest: pin.digest };
  }
  return envelope(plan, step, ready, 'PA.PORT.MODEL_PROVIDER', {
    logical_provider_id: nativeBinding.logicalProviderId,
    binding_ref: {
      slot_id: 'model',
      provider_id: nativeBinding.logicalProviderId,
      binding_digest: nativeBinding.providerBindingDigest,
    },
    payload,
    request_id: requestId,
  });
}

// Pure mapping into existing PA.PORT.TOOL_PROVIDER@1.0.0 request shape.
// Native descriptor and binding digests MUST come from the owning host.
// A K02 plan digest is never substituted for the native tool-plan digest.
export async function draftAgentToolRequest({
  plan, trustedPlanDigest, requirementId, provider, nativeBinding, input, requestId,
}) {
  const ready = await verifyInvocationReadiness(plan, requirementId, provider, trustedPlanDigest);
  const step = selectedStep(plan, requirementId, 'tool');
  validateInvocationInput(step, input);
  if (!dict(input)) invalid('native_tool_arguments_object_required');
  fields(nativeBinding, ['logicalProviderId','providerSlot','providerBindingDigest','descriptorDigest'],
    ['logicalProviderId','providerSlot','providerBindingDigest','descriptorDigest','nativeToolPlanDigest'],
    'tool_native_binding');
  identifier(nativeBinding.logicalProviderId, 'logical_provider_id');
  identifier(nativeBinding.providerSlot, 'provider_slot');
  sha(nativeBinding.providerBindingDigest, 'native_tool_binding_digest');
  sha(nativeBinding.descriptorDigest, 'native_tool_descriptor_digest');
  if ([nativeBinding.providerBindingDigest, nativeBinding.descriptorDigest].includes(plan.planDigest) ||
      [nativeBinding.providerBindingDigest, nativeBinding.descriptorDigest].includes(step.capabilityDigest)) {
    invalid('k02_digest_not_native_binding');
  }
  identifier(requestId, 'request_id');
  const hasNativePlan = Object.hasOwn(nativeBinding,'nativeToolPlanDigest');
  if (hasNativePlan) {
    sha(nativeBinding.nativeToolPlanDigest, 'native_tool_plan_digest');
    if (nativeBinding.nativeToolPlanDigest === plan.planDigest ||
        nativeBinding.nativeToolPlanDigest === step.capabilityDigest) {
      invalid('k02_digest_not_native_plan');
    }
  }
  return envelope(plan, step, ready, 'PA.PORT.TOOL_PROVIDER', {
    logical_provider_id: nativeBinding.logicalProviderId,
    tool_descriptor_ref: {
      tool_id: step.capabilityId,
      descriptor_digest: nativeBinding.descriptorDigest,
      provider_slot: nativeBinding.providerSlot,
      provider_binding_digest: nativeBinding.providerBindingDigest,
    },
    operation: step.capabilityId,
    target: null,
    arguments: input,
    idempotency_key_or_none: null,
    request_id: requestId,
    tool_plan_digest_or_none: hasNativePlan ? nativeBinding.nativeToolPlanDigest : null,
  });
}
