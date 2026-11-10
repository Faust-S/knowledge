// A2 synthetic-only disclosure screen. Never a proof of anonymity or a serializer.
// No IO, network, T3 grants, `.iwxa` export or human/organizational authority.
import {analyzeSnapshot, A1_SCHEMA, ActivityHold} from './engine.mjs';

export const RISK_SCHEMA = 'IWXA_A2_INTERNAL_SYNTHETIC_RISK/0.1';
const MIN_INDEPENDENT_TRACES = 3;
const EVENT_KEYS = new Set([
  'event_id', 'subject_scope', 'case_ref', 'process_binding', 'state_binding',
  'role_binding', 'ordinal', 'status', 'source_id', 'source_revision',
  'actor_ref', 'payload', 'occurred_at', 'exact_amount', 'counterparty_ref',
]);
const PIN_KEYS = new Set(['source_id', 'revision', 'subject_scope', 'events_sha256']);
const AUTHORITY_KEYS = new Set(['authority_ref', 'rights_ref', 'grant', 'credential',
  'credentials', 'access_token', 'secret_key', 'signature', 'private_key']);

function band(n) { return n >= 50 ? '50+' : n >= 10 ? '10-49' : n >= 3 ? '3-9' : 'LESS_THAN_3'; }
function failed(reasons) { return {
  schema: RISK_SCHEMA,
  status: 'HOLD',
  reason_codes: [...new Set(reasons)].sort(),
  residual_risk: 'HIGH_OR_UNDETERMINED',
  anonymity: 'NOT_ESTABLISHED',
  export_allowed: false,
  iwxa_package: null,
  structural_candidate: null,
}; }

// Only fields explicitly excluded from every derived candidate may be accepted.
function knownKeys(obj, allowed) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) &&
    Object.keys(obj).every((k) => allowed.has(k));
}

export async function screenSyntheticDisclosure(snapshot) {
  // Never allow caller-provided approval or caller-provided verification receipts.
  const analysis = await analyzeSnapshot(snapshot);
  const {preview} = analysis;
  const reasons = [];
  if (snapshot.schema !== A1_SCHEMA || preview.provenance_verification !== 'SYNTHETIC_DIGEST_MATCH_NOT_AUTHORITY') {
    reasons.push('A1_PINNED_SYNTHETIC_SOURCE_REQUIRED');
  }
  if (preview.unverified_event_count) reasons.push('UNVERIFIED_STEPS_IN_STRUCTURE');
  if (!knownKeys(snapshot, new Set(['schema', 'selected_subject', 'events', 'source_versions']))) {
    reasons.push('UNREVIEWED_SNAPSHOT_FIELDS');
  }
  if (!Array.isArray(snapshot.source_versions) || snapshot.source_versions.some((pin) => !knownKeys(pin, PIN_KEYS))) {
    reasons.push('UNREVIEWED_SOURCE_PIN_FIELDS');
  }

  const byCase = new Map();
  for (const event of snapshot.events) {
    if (!knownKeys(event, EVENT_KEYS)) {
      const unknown = Object.keys(event).filter((k) => !EVENT_KEYS.has(k));
      reasons.push(unknown.some((k) => AUTHORITY_KEYS.has(k)) ?
        'ACTIVE_AUTHORITY_CANNOT_TRANSFER' : 'UNREVIEWED_EVENT_FIELDS');
    }
    if (event.relationship_refs !== undefined || event.essential_relation !== undefined) {
      reasons.push('UNVERIFIED_RELATIONSHIP_DEPENDENCY');
    }
    if (!byCase.has(event.case_ref)) byCase.set(event.case_ref, []);
    byCase.get(event.case_ref).push(event);
  }

  // A repeated state, edge, or actor alias is NOT sufficient: an entire ordered
  // trace and its role assignments must recur across distinct cases.
  const patternsByProcess = new Map();
  for (const trace of byCase.values()) {
    const ordered = [...trace].sort((a, b) => a.ordinal - b.ordinal);
    const process = ordered[0].process_binding;
    const signature = JSON.stringify(ordered.map((e) => [e.state_binding, e.role_binding, e.status]));
    if (!patternsByProcess.has(process)) patternsByProcess.set(process, new Map());
    const patterns = patternsByProcess.get(process);
    patterns.set(signature, (patterns.get(signature) ?? 0) + 1);
  }
  const processGraphs = preview.processes;
  for (const patterns of patternsByProcess.values()) {
    if ([...patterns.values()].some((count) => count < MIN_INDEPENDENT_TRACES)) {
      reasons.push('RARE_FULL_TRACE_OR_ROLE_PATTERN');
    }
  }
  for (const process of processGraphs) {
    if (process.trace_count < MIN_INDEPENDENT_TRACES ||
      process.observed_successions.some((edge) => edge.trace_occurrences < MIN_INDEPENDENT_TRACES)) {
      reasons.push('RARE_STATE_OR_TRANSITION');
    }
  }
  if (reasons.length) return {preview, risk: failed(reasons)};

  // This remains an owner-local candidate. No raw identifiers, provenance,
  // digests, timestamps, money, case IDs, source names or exact frequencies.
  // A real-world external linkage attack has NOT been measured.
  const sanitized = processGraphs.map((p) => ({
    process_id: p.id,
    cohort_band: band(p.trace_count),
    states: p.states.map((s) => ({state_id: s.id, structural_roles: [...s.roles]})),
    observed_order: p.observed_successions.map((e) => ({
      from: e.from, to: e.to, relation: 'OBSERVED_ORDER_NOT_CAUSAL_DEPENDENCY',
      cohort_band: band(e.trace_occurrences),
    })),
  }));
  return {preview, risk: {
    schema: RISK_SCHEMA,
    status: 'STRUCTURE_PRESERVED_REVIEW_REQUIRED',
    reason_codes: ['EXTERNAL_POPULATION_REIDENTIFICATION_UNMEASURED',
      'T3_RIGHTS_AND_SOURCE_AUTHORITY_UNVERIFIED'],
    residual_risk: 'UNDETERMINED',
    anonymity: 'NOT_ESTABLISHED',
    export_allowed: false,
    iwxa_package: null,
    structural_candidate: sanitized,
  }};
}

export {ActivityHold};