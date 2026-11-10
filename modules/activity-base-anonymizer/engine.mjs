// Pure, offline, synthetic-only analysis kernel. No IO, permissions, network or export.
export const A0_SCHEMA = 'IWXA_SYNTHETIC_A0_SNAPSHOT/0.1';
export const A1_SCHEMA = 'IWXA_SYNTHETIC_A1_SNAPSHOT/0.1';
export const CANDIDATE_SCHEMA = 'IWXA_ACTIVITY_INTERNAL_CANDIDATE/0.2';
const MAX_EVENTS = 10000;
const MAX_SOURCES = 512;
const VALID_TAG = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim().length > 0;
const VALID_SHA = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export class ActivityHold extends Error {
  constructor(code) { super(code); this.name = 'ActivityHold'; this.code = code; }
}
function need(condition, code) { if (!condition) throw new ActivityHold(code); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
export async function sha256Canonical(value) {
  need(Boolean(globalThis.crypto?.subtle), 'LOCAL_DIGEST_UNAVAILABLE');
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export async function analyzeSnapshot(snapshot) {
  need(snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot), 'INVALID_INPUT');
  const isA0 = snapshot.schema === A0_SCHEMA;
  const isA1 = snapshot.schema === A1_SCHEMA;
  need(isA0 || isA1, 'UNSUPPORTED_OR_NON_SYNTHETIC_INPUT');
  need(VALID_TAG(snapshot.selected_subject), 'SUBJECT_SELECTION_REQUIRED');
  need(Array.isArray(snapshot.events) && snapshot.events.length > 0 && snapshot.events.length <= MAX_EVENTS,
    'EVENT_SELECTION_INVALID');

  const sourcePins = new Map();
  const bySource = new Map();
  const seenEventIds = new Set();
  if (isA1) {
    need(Array.isArray(snapshot.source_versions) && snapshot.source_versions.length > 0 &&
      snapshot.source_versions.length <= MAX_SOURCES, 'SOURCE_PINS_REQUIRED');
    for (const pin of snapshot.source_versions) {
      need(pin && typeof pin === 'object' && VALID_TAG(pin.source_id) && VALID_TAG(pin.revision) &&
        VALID_SHA(pin.events_sha256), 'SOURCE_PIN_INVALID');
      need(pin.subject_scope === snapshot.selected_subject, 'SOURCE_SUBJECT_MISMATCH');
      const key = `${pin.source_id}\0${pin.revision}`;
      need(!sourcePins.has(key), 'SOURCE_PIN_DUPLICATE');
      sourcePins.set(key, pin);
      bySource.set(key, []);
    }
  }

  const cases = new Map();
  const roleTags = new Set();
  let unverified = 0;
  const internalEvidence = [];
  for (const event of snapshot.events) {
    need(event && typeof event === 'object' && !Array.isArray(event), 'EVENT_INVALID');
    need(event.subject_scope === snapshot.selected_subject, 'SUBJECT_SCOPE_VIOLATION');
    need(['observed', ...(isA1 ? ['reported', 'inferred', 'proposed'] : [])].includes(event.status),
      'EVENT_EPISTEMIC_INVALID');
    need(['case_ref', 'process_binding', 'state_binding', 'role_binding'].every((key) => VALID_TAG(event[key])),
      'EVENT_BINDINGS_REQUIRED');
    need(Number.isInteger(event.ordinal) && event.ordinal > 0 && event.ordinal <= MAX_EVENTS,
      'EVENT_ORDINAL_INVALID');
    if (isA1) {
      need(VALID_TAG(event.event_id) && !seenEventIds.has(event.event_id), 'EVENT_ID_MISSING_OR_DUPLICATE');
      seenEventIds.add(event.event_id);
      need(VALID_TAG(event.source_id) && VALID_TAG(event.source_revision), 'EVENT_SOURCE_REQUIRED');
      const key = `${event.source_id}\0${event.source_revision}`;
      need(sourcePins.has(key), 'EVENT_SOURCE_UNPINNED');
      bySource.get(key).push(event);
      // Detailed source identity is internal-only and must never be serialized into a preview/package.
      internalEvidence.push(Object.freeze({event_id: event.event_id, source_id: event.source_id,
        revision: event.source_revision, status: event.status}));
    }
    if (!cases.has(event.case_ref)) cases.set(event.case_ref, {process: event.process_binding, events: []});
    const found = cases.get(event.case_ref);
    need(found.process === event.process_binding, 'CASE_PROCESS_CONFLICT');
    found.events.push({ordinal: event.ordinal, state: event.state_binding,
      role: event.role_binding, status: event.status});
    if (event.status === 'observed') roleTags.add(event.role_binding);
    else unverified += 1;
  }

  if (isA1) {
    for (const [key, pin] of sourcePins) {
      const events = bySource.get(key);
      need(events.length > 0, 'SOURCE_PIN_NOT_USED');
      const sorted = [...events].sort((a, b) => a.event_id.localeCompare(b.event_id, 'en'));
      const actual = await sha256Canonical(sorted);
      need(actual === pin.events_sha256, 'SOURCE_PIN_DIGEST_MISMATCH');
    }
  }

  const processesByName = new Map();
  for (const {process, events} of cases.values()) {
    const ordered = events.sort((a, b) => a.ordinal - b.ordinal);
    need(ordered.every((item, index) => item.ordinal === index + 1), 'CASE_SEQUENCE_GAP_OR_DUPLICATE');
    if (!processesByName.has(process)) processesByName.set(process, []);
    processesByName.get(process).push(ordered);
  }
  const roles = [...roleTags].sort();
  const roleAliases = new Map(roles.map((role, i) => [role, `role_${String(i + 1).padStart(3, '0')}`]));
  const processes = [];
  const sortedProcessNames = [...processesByName.keys()].sort();
  for (const [processIndex, name] of sortedProcessNames.entries()) {
    const traces = processesByName.get(name);
    const states = [...new Set(traces.flat().filter((e) => e.status === 'observed').map((e) => e.state))].sort();
    if (!states.length) continue;
    const stateAliases = new Map(states.map((state, i) => [state, `state_${String(i + 1).padStart(3, '0')}`]));
    const stateRoles = new Map(states.map((s) => [s, new Set()]));
    const succession = new Map();
    for (const trace of traces) {
      for (const event of trace) if (event.status === 'observed') stateRoles.get(event.state).add(event.role);
      for (let i = 0; i < trace.length - 1; i++) {
        const left = trace[i], right = trace[i + 1];
        // No shortcut over UNKNOWN/reported/inferred/proposed: never invent completed steps.
        if (left.status !== 'observed' || right.status !== 'observed') continue;
        const key = `${left.state}\0${right.state}`;
        succession.set(key, (succession.get(key) ?? 0) + 1);
      }
    }
    const edges = [...succession].map(([key, count]) => {
      const [from, to] = key.split('\0');
      return {from: stateAliases.get(from), to: stateAliases.get(to), trace_occurrences: count,
        relation: 'OBSERVED_ORDER_NOT_CAUSAL_DEPENDENCY'};
    }).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    processes.push({id: `process_${String(processIndex + 1).padStart(3, '0')}`, trace_count: traces.length,
      states: states.map((state) => ({id: stateAliases.get(state),
        roles: [...stateRoles.get(state)].sort().map((r) => roleAliases.get(r))})),
      observed_successions: edges});
  }
  need(processes.length > 0, 'NO_OBSERVED_STAGES');
  const preview = {
    schema: CANDIDATE_SCHEMA,
    stage: isA1 ? 'A1_SYNTHETIC_PROVENANCE_CHECKED_NOT_HOST_ATTESTED' : 'A0_SYNTHETIC_BASELINE',
    processes,
    role_count: roles.length,
    selected_case_count: cases.size,
    unverified_event_count: unverified,
    source_pin_count: sourcePins.size,
    provenance_verification: isA1 ? 'SYNTHETIC_DIGEST_MATCH_NOT_AUTHORITY' : 'NOT_PERFORMED',
    anonymous: false, export_allowed: false, iwxa_package: null,
    risk_assessment: 'NOT_PERFORMED',
  };
  return {preview, internalEvidence};
}

export async function buildSyntheticExample() {
  const events = [];
  const specs = [
    ['fulfilment', [['new','coordinator'], ['triaged','reviewer'], ['approved','reviewer'],
      ['in_progress','worker'], ['finished','worker']]],
    ['service', [['new','coordinator'], ['reviewed','reviewer'], ['in_progress','worker'], ['finished','worker']]],
  ];
  for (const [process, steps] of specs) for (let caseNo = 1; caseNo <= 3; caseNo++) {
    for (let index = 0; index < steps.length; index++) {
      const [state, role] = steps[index];
      events.push({event_id: `${process}_${caseNo}_${index + 1}`, subject_scope: 'synthetic_subject_a',
        case_ref: `${process}_case_${caseNo}`, process_binding: process, state_binding: state,
        role_binding: role, ordinal: index + 1, status: 'observed',
        source_id: 'synthetic_source_001', source_revision: 'synthetic_revision_001',
        actor_ref: 'RARE_SYNTHETIC_ACTOR_Z9',
        payload: {email: 'private@example.invalid', secret: 'SYNTHETIC_TOKEN_NEVER_RELEASE'}});
    }
  }
  const sorted = [...events].sort((a, b) => a.event_id.localeCompare(b.event_id, 'en'));
  return {schema: A1_SCHEMA, selected_subject: 'synthetic_subject_a',
    source_versions: [{source_id: 'synthetic_source_001', revision: 'synthetic_revision_001',
      subject_scope: 'synthetic_subject_a', events_sha256: await sha256Canonical(sorted)}], events};
}