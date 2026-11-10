import { canonicalClone } from '../../../../persistence/canonical-codec.mjs';
import { CanonicalInstant } from '../../../../foundation/time.mjs';

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LongitudinalContextPolicyError(`${label} must be a non-empty string`, 'INVALID_LONGITUDINAL_CONTEXT_FIELD');
  }
  return value.trim();
}

function requireScope(value) {
  if (!value || (value.kind !== 'job' && value.kind !== 'process')) {
    throw new LongitudinalContextPolicyError('scope.kind must be job or process', 'INVALID_LONGITUDINAL_CONTEXT_SCOPE');
  }
  return Object.freeze({ kind: value.kind, id: requireText(value.id, 'scope.id') });
}

function requireHeadMap(input, label, { allowEmpty = false } = {}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  ) {
    throw new LongitudinalContextPolicyError(`${label} must be a plain object`, 'INVALID_LONGITUDINAL_CONTEXT_HEADS');
  }
  const seenIds = new Set();
  const entries = Object.entries(input)
    .map(([id, headRef]) => {
      const normalizedId = requireText(id, `${label} id`);
      if (seenIds.has(normalizedId)) {
        throw new LongitudinalContextPolicyError(
          `${label} contains duplicate ids after normalization: ${normalizedId}`,
          'INVALID_LONGITUDINAL_CONTEXT_HEADS',
        );
      }
      seenIds.add(normalizedId);
      return [normalizedId, requireText(headRef, `${label}.${id}`)];
    })
    .sort(([left], [right]) => left.localeCompare(right));
  if (!allowEmpty && entries.length === 0) {
    throw new LongitudinalContextPolicyError(`${label} must contain at least one exact head`, 'MISSING_LONGITUDINAL_CONTEXT_SOURCE');
  }
  return Object.freeze(Object.fromEntries(entries));
}

function requireInstant(value, label) {
  try {
    return value instanceof CanonicalInstant ? value : CanonicalInstant.parse(value);
  } catch {
    throw new LongitudinalContextPolicyError(`${label} must be a canonical instant`, 'INVALID_LONGITUDINAL_CONTEXT_TIME');
  }
}

function deepFreezeCanonical(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeCanonical(child, seen);
  return Object.freeze(value);
}

function requireCanonicalValue(value) {
  if (value === undefined) {
    throw new LongitudinalContextPolicyError('value is required', 'MISSING_LONGITUDINAL_CONTEXT_VALUE');
  }
  try {
    return deepFreezeCanonical(canonicalClone(value));
  } catch {
    throw new LongitudinalContextPolicyError(
      'value must be canonical persistable data',
      'INVALID_LONGITUDINAL_CONTEXT_VALUE',
    );
  }
}

function exactHeadsMatch(expected, current) {
  if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
  return Object.entries(expected).every(([id, headRef]) => current[id] === headRef);
}

function normalizeActiveRefs(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((entry) => typeof entry === 'string' && entry.length > 0));
}

export class LongitudinalContextPolicyError extends Error {
  constructor(message, code = 'LONGITUDINAL_CONTEXT_POLICY_ERROR') {
    super(message);
    this.name = 'LongitudinalContextPolicyError';
    this.code = code;
  }
}

export function normalizeLongitudinalContextAdmission(input) {
  if (!input || typeof input !== 'object') {
    throw new LongitudinalContextPolicyError('context admission input is required', 'INVALID_LONGITUDINAL_CONTEXT_ADMISSION');
  }
  const retentionUntil = requireInstant(input.retentionUntil, 'retentionUntil');
  return Object.freeze({
    schema: 'IWXA_T2_LONGITUDINAL_CONTEXT_V1',
    contextId: requireText(input.contextId, 'contextId'),
    workspaceId: requireText(input.workspaceId, 'workspaceId'),
    subjectId: requireText(input.subjectId, 'subjectId'),
    scope: requireScope(input.scope),
    value: requireCanonicalValue(input.value),
    admission: Object.freeze({
      actorId: requireText(input.actorId, 'actorId'),
      operationId: requireText(input.operationId, 'operationId'),
      purpose: requireText(input.purpose, 'purpose'),
      needType: requireText(input.needType, 'needType'),
      retentionUntil,
      authorityRef: requireText(input.authorityRef, 'authorityRef'),
      permissionRef: requireText(input.permissionRef, 'permissionRef'),
    }),
    sourceHeads: requireHeadMap(input.sourceHeads, 'sourceHeads'),
    dependencyHeads: requireHeadMap(input.dependencyHeads ?? {}, 'dependencyHeads', { allowEmpty: true }),
    sourceTruth: false,
    authorityRoot: false,
    durableAdmission: true,
  });
}

export function evaluateLongitudinalContextEligibility({
  context,
  now,
  currentSourceHeads,
  currentDependencyHeads = {},
  activeAuthorityRefs = [],
  activePermissionRefs = [],
  purpose,
  needType,
}) {
  if (!context || context.schema !== 'IWXA_T2_LONGITUDINAL_CONTEXT_V1') {
    throw new LongitudinalContextPolicyError('normalized persistent context is required', 'INVALID_LONGITUDINAL_CONTEXT_RECORD');
  }
  const point = requireInstant(now, 'now');
  const axes = Object.freeze({
    source: exactHeadsMatch(context.sourceHeads, currentSourceHeads),
    dependencies: exactHeadsMatch(context.dependencyHeads, currentDependencyHeads),
    authority: normalizeActiveRefs(activeAuthorityRefs).has(context.admission.authorityRef),
    purposeNeed:
      context.admission.purpose === requireText(purpose, 'purpose') &&
      context.admission.needType === requireText(needType, 'needType'),
    retention: point.compare(context.admission.retentionUntil) < 0,
    permission: normalizeActiveRefs(activePermissionRefs).has(context.admission.permissionRef),
  });
  const failedAxes = Object.freeze(
    Object.entries(axes).filter(([, ok]) => !ok).map(([axis]) => axis),
  );
  return Object.freeze({
    eligible: failedAxes.length === 0,
    axes,
    failedAxes,
    policy: 'SOURCE_AND_DEPENDENCIES_AND_AUTHORITY_AND_PURPOSE_NEED_AND_RETENTION_AND_PERMISSION',
  });
}

export function planLongitudinalContextInvalidation({
  contexts,
  currentSourceHeads,
  currentDependencyHeads = {},
}) {
  const invalidated = [];
  const unaffected = [];
  const reasons = {};
  for (const context of contexts ?? []) {
    if (!context || context.schema !== 'IWXA_T2_LONGITUDINAL_CONTEXT_V1') {
      throw new LongitudinalContextPolicyError('normalized persistent context is required', 'INVALID_LONGITUDINAL_CONTEXT_RECORD');
    }
    const contextReasons = [];
    for (const [sourceId, headRef] of Object.entries(context.sourceHeads)) {
      if (currentSourceHeads?.[sourceId] !== headRef) contextReasons.push(`source:${sourceId}`);
    }
    for (const [dependencyId, revisionRef] of Object.entries(context.dependencyHeads)) {
      if (currentDependencyHeads?.[dependencyId] !== revisionRef) contextReasons.push(`dependency:${dependencyId}`);
    }
    if (contextReasons.length > 0) {
      invalidated.push(context.contextId);
      reasons[context.contextId] = Object.freeze(contextReasons.sort());
    } else {
      unaffected.push(context.contextId);
    }
  }
  invalidated.sort();
  unaffected.sort();
  return Object.freeze({
    invalidatedContextIds: Object.freeze(invalidated),
    unaffectedContextIds: Object.freeze(unaffected),
    reasons: Object.freeze(reasons),
    revalidationRequired: invalidated.length > 0,
    sourceTruthMutatedByPlan: false,
  });
}

export class LongitudinalContextUniverse {
  #byId = new Map();

  register(context) {
    if (!context || context.schema !== 'IWXA_T2_LONGITUDINAL_CONTEXT_V1') {
      throw new LongitudinalContextPolicyError('normalized persistent context is required', 'INVALID_LONGITUDINAL_CONTEXT_RECORD');
    }
    if (this.#byId.has(context.contextId)) {
      throw new LongitudinalContextPolicyError(`duplicate context identity: ${context.contextId}`, 'DUPLICATE_LONGITUDINAL_CONTEXT_ID');
    }
    this.#byId.set(context.contextId, context);
    return context;
  }

  get size() { return this.#byId.size; }

  purposeView({
    workspaceId,
    subjectId,
    purpose,
    needType,
    now,
    currentSourceHeads,
    currentDependencyHeads = {},
    activeAuthorityRefs = [],
    activePermissionRefs = [],
    scope = null,
  }) {
    const normalizedWorkspaceId = requireText(workspaceId, 'workspaceId');
    const normalizedSubjectId = requireText(subjectId, 'subjectId');
    const normalizedPurpose = requireText(purpose, 'purpose');
    const normalizedNeedType = requireText(needType, 'needType');
    const normalizedScope = scope == null ? null : requireScope(scope);
    const entries = [];

    for (const context of this.#byId.values()) {
      if (context.workspaceId !== normalizedWorkspaceId || context.subjectId !== normalizedSubjectId) continue;
      if (normalizedScope && (context.scope.kind !== normalizedScope.kind || context.scope.id !== normalizedScope.id)) continue;
      if (context.admission.purpose !== normalizedPurpose || context.admission.needType !== normalizedNeedType) continue;
      const eligibility = evaluateLongitudinalContextEligibility({
        context,
        now,
        currentSourceHeads,
        currentDependencyHeads,
        activeAuthorityRefs,
        activePermissionRefs,
        purpose: normalizedPurpose,
        needType: normalizedNeedType,
      });
      if (!eligibility.eligible) continue;
      entries.push(Object.freeze({
        contextId: context.contextId,
        scope: context.scope,
        value: context.value,
        sourceHeads: context.sourceHeads,
        dependencyHeads: context.dependencyHeads,
        eligibility,
      }));
    }
    entries.sort((left, right) => left.contextId.localeCompare(right.contextId));
    return Object.freeze({
      schema: 'IWXA_T2_PURPOSE_BOUNDED_CONTEXT_VIEW_V1',
      workspaceId: normalizedWorkspaceId,
      subjectId: normalizedSubjectId,
      purpose: normalizedPurpose,
      needType: normalizedNeedType,
      scope: normalizedScope,
      persisted: false,
      sourceTruth: false,
      authorityRoot: false,
      physicalWorkspaceCreated: false,
      entries: Object.freeze(entries),
    });
  }
}
