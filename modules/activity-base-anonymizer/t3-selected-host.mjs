// Host-side consumer of the ORIGINAL T3 D2 Workspace reader. No copy of T3.
// No Store/Kernel, issuer, Web server, new exchange carrier or telemetry.
// The trusted owner supplies the existing selected ModuleContext, signed D1
// Activity read port and original readActivityFromWorkspaceContext function.
// Output is an INTERNAL structural preview, never anonymized or exportable.

export const T3_SELECTED_VIEW_SCHEMA = 'IWXA_ACTIVITY_T3_SELECTED_INTERNAL_VIEW/0.1';
const ALLOWED_KINDS = new Set([
  'Entity', 'Statement', 'Event', 'State', 'Activity', 'Process',
  'Observation', 'Decision', 'Result', 'Evidence', 'Provenance',
]);
const MAX_NODES = 2000;
const MAX_EVENTS = 10000;
const MAX_RELATIONS = 10000;
const MIN_REPEATED_OBJECTS = 3;
const TAG = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 256 && value.trim().length > 0;
const RECORD = value => value && typeof value === 'object' && !Array.isArray(value);
const BY_ID = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export class T3ActivityHold extends Error {
  constructor(code) { super(code); this.name = 'T3ActivityHold'; this.code = code; }
}
const need = (ok, code) => { if (!ok) throw new T3ActivityHold(code); };
const band = n => n >= 50 ? '50+' : n >= 10 ? '10-49' : n >= 3 ? '3-9' : 'LESS_THAN_3';
const alias = (prefix, n) => `${prefix}_${String(n + 1).padStart(3, '0')}`;
const safeReason = reasons => [...new Set(reasons)].sort(BY_ID);
const only = (object, allowed) => RECORD(object) && Object.keys(object).every(key => allowed.includes(key));

function held(reasons) {
  return {
    schema: T3_SELECTED_VIEW_SCHEMA,
    status: 'HOLD',
    reason_codes: safeReason(reasons),
    host_source: 'T3_D2_SELECTED_WORKSPACE_INVOKED',
    semantic_mapping: 'T0_T1_D2_ONLY_NOT_OCEL2_CONFORMANCE',
    residual_risk: 'HIGH_OR_UNDETERMINED',
    anonymity: 'NOT_ESTABLISHED',
    export_allowed: false,
    iwxa_package: null,
    structural_candidate: null,
  };
}

function inspectProjection(view) {
  need(only(view, ['workspace_id','nodes','events','relations','unresolved','unmapped']),
    'T3_D2_SHAPE_UNSUPPORTED');
  need(TAG(view.workspace_id), 'T3_D2_WORKSPACE_UNAVAILABLE');
  need(Array.isArray(view.nodes) && view.nodes.length >= 1 && view.nodes.length <= MAX_NODES &&
    Array.isArray(view.events) && view.events.length <= MAX_EVENTS &&
    Array.isArray(view.relations) && view.relations.length <= MAX_RELATIONS &&
    Array.isArray(view.unresolved) && RECORD(view.unmapped), 'T3_D2_BOUNDS_INVALID');
  need(['object_ids','event_ids','relation_ids'].every(k => Array.isArray(view.unmapped[k])),
    'T3_D2_UNMAPPED_SHAPE_INVALID');
  const reasons = [];
  if (view.unresolved.length > 0) reasons.push('T3_D2_UNRESOLVED_SOURCE_LINK');
  if (Object.values(view.unmapped).some(items => items.length > 0))
    reasons.push('T3_D2_UNMAPPED_SOURCE_RECORD');

  const nodes = new Map();
  const typeGroups = new Map();
  for (const row of view.nodes) {
    need(only(row, ['object_id','revision','schema_id','schema_version','semantic_kind']) &&
      TAG(row.object_id) && TAG(row.schema_id) && TAG(row.schema_version) &&
      ALLOWED_KINDS.has(row.semantic_kind) && Number.isSafeInteger(row.revision) && row.revision >= 1,
      'T3_D2_NODE_INVALID');
    need(!nodes.has(row.object_id), 'T3_D2_DUPLICATE_NODE');
    nodes.set(row.object_id, row);
    const typeKey = JSON.stringify([row.schema_id, row.schema_version, row.semantic_kind]);
    if (!typeGroups.has(typeKey)) typeGroups.set(typeKey, []);
    typeGroups.get(typeKey).push(row.object_id);
  }
  const events = new Set();
  const eventsByObject = new Map([...nodes.keys()].map(id => [id, []]));
  const eventKinds = new Set();
  for (const event of view.events) {
    need(only(event, ['event_id','event_type','semantic_kind','occurred_at',
      'causation_id','correlation_id','object_ref']) && TAG(event.event_id) &&
      TAG(event.event_type) && ['Event','Observation'].includes(event.semantic_kind) &&
      typeof event.occurred_at === 'string' && Number.isFinite(Date.parse(event.occurred_at)),
      'T3_D2_EVENT_INVALID');
    need(!events.has(event.event_id), 'T3_D2_DUPLICATE_EVENT');
    events.add(event.event_id);
    const ref = event.object_ref;
    if (ref === null) { reasons.push('T3_D2_EVENT_OBJECT_UNVERIFIED'); continue; }
    need(only(ref, ['object_id','revision']) && TAG(ref.object_id) &&
      Number.isSafeInteger(ref.revision) && ref.revision >= 1,
      'T3_D2_EVENT_REFERENCE_INVALID');
    const bound = nodes.get(ref.object_id);
    need(bound && ref.revision <= bound.revision, 'T3_D2_EVENT_REFERENCE_STALE');
    eventKinds.add(JSON.stringify([event.event_type, event.semantic_kind]));
    eventsByObject.get(ref.object_id).push(event);
  }
  if (view.events.length === 0) reasons.push('T3_D2_NO_OBSERVED_ACTIVITY');
  // D2 exposes one optional object_ref per event. Never invent OCEL 2.0
  // many-to-many E2O links or claim a full OCEL-compliant source view.
  const relationKinds = new Map();
  for (const relation of view.relations) {
    need(only(relation, ['relation_id','source_id','target_id','relation','source_revision']) &&
      TAG(relation.source_id) && TAG(relation.target_id) && TAG(relation.relation) &&
      Number.isSafeInteger(relation.source_revision) && relation.source_revision >= 1,
      'T3_D2_RELATION_INVALID');
    const source = nodes.get(relation.source_id);
    const target = nodes.get(relation.target_id);
    need(source && target && source.revision >= relation.source_revision,
      'T3_D2_RELATION_REFERENCE_INVALID');
    const key = JSON.stringify([
      source.schema_id, source.schema_version, target.schema_id,
      target.schema_version, relation.relation,
    ]);
    relationKinds.set(key, (relationKinds.get(key) ?? 0) + 1);
  }

  const activityNames = [...eventKinds].sort(BY_ID);
  const eventAliases = new Map(activityNames.map((value, i) => [value, alias('event_type', i)]));
  const typeKeys = [...typeGroups.keys()].sort(BY_ID);
  const typeAliases = new Map(typeKeys.map((key, i) => [key, alias('object_type', i)]));
  const candidate = [];
  for (const typeKey of typeKeys) {
    const objectIds = typeGroups.get(typeKey);
    const traces = new Map();
    const edges = new Map();
    for (const objectId of objectIds) {
      const rows = [...eventsByObject.get(objectId)].sort((a, b) =>
        Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
      // Equal timestamps do not establish an order, even if event_id sorts.
      if (rows.some((row, i) => i > 0 &&
        Date.parse(row.occurred_at) === Date.parse(rows[i - 1].occurred_at))) {
        reasons.push('T3_D2_OBJECT_EVENT_ORDER_UNKNOWN');
        continue;
      }
      if (!rows.length) { reasons.push('T3_D2_OBJECT_WITHOUT_EVENTS'); continue; }
      const pattern = rows.map(row => eventAliases.get(JSON.stringify([
        row.event_type, row.semantic_kind,
      ])));
      const signature = JSON.stringify(pattern);
      traces.set(signature, (traces.get(signature) ?? 0) + 1);
      for (let i = 1; i < pattern.length; i++) {
        const key = JSON.stringify([pattern[i - 1], pattern[i]]);
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    if (objectIds.length < MIN_REPEATED_OBJECTS ||
      [...traces.values()].some(count => count < MIN_REPEATED_OBJECTS) ||
      [...edges.values()].some(count => count < MIN_REPEATED_OBJECTS)) {
      reasons.push('T3_D2_RARE_OBJECT_ROUTE');
    }
    candidate.push({
      object_type: typeAliases.get(typeKey),
      cohort_band: band(objectIds.length),
      observed_event_kinds: activityNames.filter(name =>
        objectIds.some(id => eventsByObject.get(id).some(row =>
          JSON.stringify([row.event_type, row.semantic_kind]) === name)))
        .map(name => eventAliases.get(name)),
      object_local_successions: [...edges].map(([key, count]) => {
        const [from, to] = JSON.parse(key);
        return {from, to, cohort_band: band(count),
          relation: 'OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY'};
      }).sort((a, b) => BY_ID(a.from + a.to, b.from + b.to)),
    });
  }
  if (relationKinds.size) {
    if ([...relationKinds.values()].some(count => count < MIN_REPEATED_OBJECTS))
      reasons.push('T3_D2_RARE_OBJECT_RELATION');
    // A verified source relation can still be rare or sensitive: never auto-release.
    reasons.push('T3_D2_RELATION_PRIVACY_REVIEW_REQUIRED');
  }
  if (reasons.length) return held(reasons);
  return {
    schema: T3_SELECTED_VIEW_SCHEMA,
    status: 'STRUCTURE_PRESERVED_REVIEW_REQUIRED',
    reason_codes: ['EXTERNAL_LINKAGE_RISK_UNMEASURED',
      'T3_SIGNED_OWNER_RESULT_NOT_INDEPENDENTLY_ATTESTED',
      'OCEL2_FULL_CONFORMANCE_NOT_ESTABLISHED'],
    host_source: 'T3_D2_SELECTED_WORKSPACE_INVOKED',
    semantic_mapping: 'T0_T1_D2_ONLY_NOT_OCEL2_CONFORMANCE',
    residual_risk: 'UNDETERMINED',
    anonymity: 'NOT_ESTABLISHED',
    export_allowed: false,
    iwxa_package: null,
    structural_candidate: candidate,
  };
}

/**
 * Called ONLY inside an existing trusted T3 Host. It never grants access.
 * The original T3 function owns selected Workspace consistency, per-read
 * signed Access and exact D2 source enumeration. No direct Kernel bypass.
 */
export async function inspectSelectedT3Activity({
  context,
  signedAccess,
  bindings,
  readActivityFromWorkspaceContext,
} = {}) {
  need(RECORD(context) && RECORD(context.kernel) && RECORD(context.currentWorkspace) &&
    typeof context.currentWorkspace.get === 'function' &&
    typeof context.currentWorkspace.subscribe === 'function',
    'T3_TRUSTED_HOST_CONTEXT_REQUIRED');
  need(RECORD(signedAccess) &&
    ['currentContext','authorize','verifyDecisionBinding','actionFor',
      'operationDigest'].every(key => typeof signedAccess[key] === 'function'),
    'T3_SIGNED_ACTIVITY_OWNER_REQUIRED');
  need(typeof readActivityFromWorkspaceContext === 'function',
    'T3_ORIGINAL_D2_READER_REQUIRED');
  const selected = context.currentWorkspace.get();
  const selectedId = selected?.workspace_id;
  need(TAG(selectedId), 'T3_SELECTED_WORKSPACE_REQUIRED');
  const owner = signedAccess.currentContext();
  need(RECORD(owner) && owner.workspace_id === selectedId &&
    ['PERSONAL','CORP'].includes(owner.kind), 'T3_SIGNED_CONTEXT_MISMATCH');
  // No raw IDs, source references or owner identity in the returned object.
  const identity = JSON.stringify(owner);
  let view;
  try {
    view = await readActivityFromWorkspaceContext(context, {bindings, signedAccess});
  } catch (error) {
    // Any exception from T3/Access is fail-closed. Never reflect a raw
    // permission/owner/source message into UI or a portable artifact.
    if (error instanceof T3ActivityHold) throw error;
    throw new T3ActivityHold('T3_AUTHORITATIVE_READ_REFUSED');
  }
  need(context.currentWorkspace.get() === selected &&
    JSON.stringify(signedAccess.currentContext()) === identity,
    'T3_SELECTED_CONTEXT_CHANGED_AFTER_READ');
  need(RECORD(view) && view.workspace_id === selectedId,
    'T3_SOURCE_WORKSPACE_MISMATCH');
  return inspectProjection(view);
}

/**
 * The existing signed T3 Host calls this in its trusted runtime, not in the
 * Activity renderer. Only two narrow callbacks cross the UI boundary.
 * No Access, Workspace context, original Kernel or source rows are returned.
 */
export function createTrustedT3ReviewPort({
  context, signedAccess, bindings, readActivityFromWorkspaceContext,
  subscribeOwnerInvalidation,
} = {}) {
  need(typeof subscribeOwnerInvalidation === 'function' &&
    typeof context?.currentWorkspace?.subscribe === 'function',
    'T3_TRUSTED_HOST_INVALIDATION_REQUIRED');
  return Object.freeze({
    readSelected: () => inspectSelectedT3Activity({
      context, signedAccess, bindings, readActivityFromWorkspaceContext,
    }),
    subscribeInvalidation(listener) {
      need(typeof listener === 'function', 'T3_TRUSTED_HOST_INVALIDATION_REQUIRED');
      let stopSelection = null;
      let stopOwner = null;
      try {
        stopSelection = context.currentWorkspace.subscribe(listener);
        stopOwner = subscribeOwnerInvalidation(listener);
        need(typeof stopSelection === 'function' && typeof stopOwner === 'function',
          'T3_TRUSTED_HOST_INVALIDATION_REQUIRED');
      } catch {
        if (typeof stopSelection === 'function') stopSelection();
        throw new T3ActivityHold('T3_TRUSTED_HOST_INVALIDATION_REQUIRED');
      }
      return () => {stopSelection(); stopOwner();};
    },
  });
}