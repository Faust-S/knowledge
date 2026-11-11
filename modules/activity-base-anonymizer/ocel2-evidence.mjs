// Owner-local OCEL 2.0 JSON restricted-profile reader for synthetic evidence.
// Produces a non-transferable object-centric observation view, not BPMN/DMN,
// IWXA Standard conformance, anonymization, or a replacement T3 reader.
import {ActivityHold, sha256Canonical} from './engine.mjs';

export const OCEL2_SYNTHETIC_SCHEMA = 'IWXA_SYNTHETIC_OCEL2_PINNED/0.1';
export const OCEL2_VIEW_SCHEMA = 'IWXA_OCEL2_INTERNAL_OBJECT_VIEW/0.1';
const ATTRIBUTE_TYPES = new Set(['string', 'time', 'integer', 'float', 'boolean']);
const MAX_OBJECTS = 2000;
const MAX_EVENTS = 10000;
const MAX_TYPES = 256;
const MAX_RELATIONS = 32;
const TAG = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
const SHA = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function need(ok, code) { if (!ok) throw new ActivityHold(code); }
function shape(value, keys, required, code) {
  need(value && typeof value === 'object' && !Array.isArray(value), code);
  const present = Object.keys(value);
  need(present.every((k) => keys.includes(k)) && required.every((k) => present.includes(k)), code);
}
function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19);
}
function typedValue(value, type) {
  if (type === 'time') return iso(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'float') return typeof value === 'number' && Number.isFinite(value);
  return type === 'boolean' && typeof value === 'boolean';
}
function namesOfTypes(defs, code) {
  need(Array.isArray(defs) && defs.length > 0 && defs.length <= MAX_TYPES, code);
  const result = new Map();
  for (const def of defs) {
    shape(def, ['name', 'attributes'], ['name', 'attributes'], code);
    need(TAG(def.name) && !result.has(def.name) && Array.isArray(def.attributes) && def.attributes.length <= MAX_TYPES, code);
    const attributes = new Map();
    for (const attr of def.attributes) {
      shape(attr, ['name', 'type'], ['name', 'type'], code);
      need(TAG(attr.name) && ATTRIBUTE_TYPES.has(attr.type) && !attributes.has(attr.name), code);
      attributes.set(attr.name, attr.type);
    }
    result.set(def.name, attributes);
  }
  return result;
}
function validateAttributes(items, defs, objectAttribute) {
  need(Array.isArray(items) && items.length <= MAX_TYPES, 'OCEL_ATTRIBUTES_INVALID');
  const used = new Set();
  for (const attr of items) {
    shape(attr, objectAttribute ? ['name', 'time', 'value'] : ['name', 'value'],
      objectAttribute ? ['name', 'time', 'value'] : ['name', 'value'], 'OCEL_ATTRIBUTE_SHAPE_INVALID');
    const def = defs.get(attr.name);
    need(def && typedValue(attr.value, def) && (!objectAttribute || iso(attr.time)), 'OCEL_ATTRIBUTE_TYPE_OR_TIME_INVALID');
    const key = `${attr.name}\0${objectAttribute ? attr.time : ''}`;
    need(!used.has(key), 'OCEL_ATTRIBUTE_DUPLICATE');
    used.add(key);
  }
}
function relationships(items, allowEmpty, code) {
  need(Array.isArray(items) && items.length <= MAX_RELATIONS && (allowEmpty || items.length > 0), code);
  const pairs = new Set();
  for (const item of items) {
    shape(item, ['objectId', 'qualifier'], ['objectId', 'qualifier'], code);
    need(TAG(item.objectId) && TAG(item.qualifier), code);
    const key = `${item.objectId}\0${item.qualifier}`;
    need(!pairs.has(key), 'OCEL_RELATION_DUPLICATE');
    pairs.add(key);
  }
}

// Only the documented JSON collections and simple attributes are supported.
// This is deliberately NOT a full OCEL 2.0 interchange validator.
function validateRestrictedJson(raw) {
  shape(raw, ['eventTypes', 'objectTypes', 'events', 'objects'],
    ['eventTypes', 'objectTypes', 'events', 'objects'], 'OCEL_TOP_LEVEL_UNSUPPORTED');
  const eventTypes = namesOfTypes(raw.eventTypes, 'OCEL_EVENT_TYPE_INVALID');
  const objectTypes = namesOfTypes(raw.objectTypes, 'OCEL_OBJECT_TYPE_INVALID');
  need(Array.isArray(raw.objects) && raw.objects.length > 0 && raw.objects.length <= MAX_OBJECTS,
    'OCEL_OBJECT_LIMIT_OR_MISSING');
  need(Array.isArray(raw.events) && raw.events.length > 0 && raw.events.length <= MAX_EVENTS,
    'OCEL_EVENT_LIMIT_OR_MISSING');
  const objects = new Map();
  for (const object of raw.objects) {
    shape(object, ['id', 'type', 'attributes', 'relationships'],
      ['id', 'type', 'attributes'], 'OCEL_OBJECT_SHAPE_INVALID');
    need(TAG(object.id) && objectTypes.has(object.type) && !objects.has(object.id),
      'OCEL_OBJECT_ID_OR_TYPE_INVALID');
    validateAttributes(object.attributes, objectTypes.get(object.type), true);
    if (object.relationships !== undefined) relationships(object.relationships, true, 'OCEL_O2O_INVALID');
    objects.set(object.id, object);
  }
  let o2oCount = 0;
  for (const object of raw.objects) {
    for (const link of object.relationships ?? []) {
      need(objects.has(link.objectId), 'OCEL_O2O_DANGLING_OBJECT');
      o2oCount += 1;
    }
  }
  const events = new Map();
  const byObject = new Map([...objects.keys()].map((id) => [id, []]));
  let sharedEventCount = 0;
  for (const event of raw.events) {
    shape(event, ['id', 'type', 'time', 'attributes', 'relationships'],
      ['id', 'type', 'time', 'attributes', 'relationships'], 'OCEL_EVENT_SHAPE_INVALID');
    need(TAG(event.id) && eventTypes.has(event.type) && !events.has(event.id),
      'OCEL_EVENT_ID_OR_TYPE_INVALID');
    need(iso(event.time), 'OCEL_EVENT_TIMESTAMP_INVALID');
    validateAttributes(event.attributes, eventTypes.get(event.type), false);
    relationships(event.relationships, false, 'OCEL_E2O_INVALID');
    // Multiple qualifiers on the same event-object pair cannot be treated
    // as independent occurrences of that event for the object's history.
    const linked = new Set();
    for (const relation of event.relationships) {
      need(objects.has(relation.objectId), 'OCEL_E2O_DANGLING_OBJECT');
      need(!linked.has(relation.objectId), 'OCEL_E2O_AMBIGUOUS_QUALIFIER');
      linked.add(relation.objectId);
      byObject.get(relation.objectId).push(event);
    }
    if (linked.size > 1) sharedEventCount += 1;
    events.set(event.id, event);
  }
  return {objects, events, byObject, eventTypes, objectTypes, sharedEventCount, o2oCount};
}

function reconstruct(validated) {
  const eventNames = [...validated.eventTypes.keys()].sort(cmp);
  const objectNames = [...validated.objectTypes.keys()].sort(cmp);
  const eventAlias = new Map(eventNames.map((name, i) => [name, `activity_${String(i + 1).padStart(3, '0')}`]));
  const objectAlias = new Map(objectNames.map((name, i) => [name, `object_type_${String(i + 1).padStart(3, '0')}`]));
  const views = [];
  let ties = 0;
  let unobserved = 0;
  let rare = 0;
  for (let index = 0; index < objectNames.length; index++) {
    const type = objectNames[index];
    const relevant = [...validated.objects.values()].filter((item) => item.type === type);
    if (!relevant.length) unobserved += 1;
    const edges = new Map();
    const states = new Set();
    const patterns = new Map();
    let observed = 0;
    for (const object of relevant) {
      const events = [...validated.byObject.get(object.id)].sort((a, b) =>
        cmp(a.time, b.time) || cmp(a.id, b.id));
      if (!events.length) { unobserved += 1; continue; }
      // An arbitrary lexical tie-breaker is never evidence for event order.
      const hasTimeTie = events.some((event, j) => j > 0 && event.time === events[j - 1].time);
      if (hasTimeTie) ties += 1;
      const pattern = JSON.stringify(events.map((event) => [event.type,
        event.relationships.filter((r) => r.objectId === object.id).map((r) => r.qualifier),
        event.relationships.filter((r) => r.objectId !== object.id)
          .map((r) => [validated.objects.get(r.objectId).type, r.qualifier]).sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)))]));
      patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
      observed += 1;
      for (const event of events) states.add(eventAlias.get(event.type));
      if (hasTimeTie) continue; // Do not infer a route through an ambiguous event order.
      for (let j = 1; j < events.length; j++) {
        const edge = `${eventAlias.get(events[j - 1].type)}\0${eventAlias.get(events[j].type)}`;
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    if ([...patterns.values()].some((n) => n < 3)) rare += 1;
    const transitions = [...edges].map(([edge, count]) => {
      const [from, to] = edge.split('\0');
      return {from, to, object_trace_occurrences: count,
        relation: 'OBJECT_LOCAL_OBSERVED_TIME_ORDER_NOT_CAUSAL_DEPENDENCY'};
    }).sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
    views.push({id: `object_view_${String(index + 1).padStart(3, '0')}`,
      object_type_alias: objectAlias.get(type),
      observed_object_count: observed,
      unobserved_object_count: relevant.length - observed,
      activity_aliases: [...states].sort(cmp),
      observed_successions: transitions,
      branching: transitions.some((edge) => transitions.filter((other) => other.from === edge.from).length > 1) ?
        'OBSERVED_VARIANTS_NOT_DECISION_RULES' : 'NO_BRANCH_EVIDENCE'});
  }
  const highRisk = ties > 0 || rare > 0 || unobserved > 0 || validated.o2oCount > 0;
  const reasons = [
    ...(ties ? ['AMBIGUOUS_SAME_TIME_OBJECT_EVENTS'] : []),
    ...(rare ? ['RARE_OBJECT_TRACE_TOPOLOGY'] : []),
    ...(unobserved ? ['UNOBSERVED_OBJECTS'] : []),
    ...(validated.o2oCount ? ['O2O_DEPENDENCY_REQUIRES_RISK_REVIEW'] : []),
    'EXTERNAL_POPULATION_REIDENTIFICATION_UNMEASURED',
    'T3_AUTHORITY_AND_OBJECT_BINDINGS_UNVERIFIED',
  ].sort(cmp);
  return {
    schema: OCEL2_VIEW_SCHEMA,
    stage: 'OCEL2_JSON_SYNTHETIC_RESTRICTED_EVIDENCE_ONLY',
    standard_readiness: {
      ocel2: 'JSON_RESTRICTED_PROFILE_PARSED_NOT_FULL_STANDARD_CONFORMANCE',
      xes: 'NOT_DERIVED_SINGLE_CASE_NOT_ASSUMED',
      bpmn: 'CANDIDATE_OBSERVED_ORDER_ONLY_NO_BPMN_XML',
      dmn: 'UNKNOWN_NO_VALIDATED_DECISION_RULES',
      cmmn: 'UNKNOWN_NO_CASE_PLAN_DERIVED',
      prov: 'SYNTHETIC_DIGEST_ONLY_NO_W3C_PROV_ATTESTATION',
    },
    object_views: views,
    event_type_count: eventNames.length,
    object_type_count: objectNames.length,
    shared_event_count: validated.sharedEventCount,
    declared_object_link_count: validated.o2oCount,
    status: highRisk ? 'HOLD' : 'STRUCTURE_PRESERVED_REVIEW_REQUIRED',
    reason_codes: reasons,
    anonymity: 'NOT_ESTABLISHED',
    residual_risk: 'UNDETERMINED',
    export_allowed: false,
    iwxa_package: null,
    source_integrity: 'SYNTHETIC_DIGEST_MATCH_NOT_HOST_AUTHORITY',
  };
}

export async function inspectSyntheticOcel2(envelope) {
  shape(envelope, ['schema', 'selected_subject', 'source_pin', 'ocel2'],
    ['schema', 'selected_subject', 'source_pin', 'ocel2'], 'OCEL_ENVELOPE_INVALID');
  need(envelope.schema === OCEL2_SYNTHETIC_SCHEMA, 'OCEL_SYNTHETIC_ENVELOPE_REQUIRED');
  need(TAG(envelope.selected_subject), 'OCEL_SELECTED_SUBJECT_REQUIRED');
  shape(envelope.source_pin, ['source_id', 'revision', 'subject_scope', 'ocel_sha256'],
    ['source_id', 'revision', 'subject_scope', 'ocel_sha256'], 'OCEL_SOURCE_PIN_INVALID');
  need(TAG(envelope.source_pin.source_id) && TAG(envelope.source_pin.revision) &&
    SHA(envelope.source_pin.ocel_sha256), 'OCEL_SOURCE_PIN_INVALID');
  need(envelope.selected_subject === envelope.source_pin.subject_scope,
    'OCEL_FOREIGN_SUBJECT_REJECTED');
  const validated = validateRestrictedJson(envelope.ocel2);
  const digest = await sha256Canonical(envelope.ocel2);
  need(digest === envelope.source_pin.ocel_sha256, 'OCEL_SOURCE_PIN_DIGEST_MISMATCH');
  return reconstruct(validated);
}

export async function buildSyntheticOcel2Example() {
  const eventTypes = ['registered', 'allocated', 'completed'].map((name) => ({
    name, attributes: [{name: 'privateNote', type: 'string'}],
  }));
  const objectTypes = ['order', 'resource'].map((name) => ({name, attributes: []}));
  const objects = [];
  const events = [];
  for (let i = 1; i <= 3; i++) {
    objects.push({id: `ORDER_PRIVATE_${i}`, type: 'order', attributes: []},
      {id: `RESOURCE_PRIVATE_${i}`, type: 'resource', attributes: []});
    const time = (minute) => `2026-01-0${i}T12:0${minute}:00Z`;
    events.push({id: `EVENT_PRIVATE_${i}_A`, type: 'registered', time: time(0),
      attributes: [{name: 'privateNote', value: 'person.name@example.invalid'}],
      relationships: [{objectId: `ORDER_PRIVATE_${i}`, qualifier: 'case'}]},
    {id: `EVENT_PRIVATE_${i}_B`, type: 'allocated', time: time(1),
      attributes: [{name: 'privateNote', value: 'SYNTH_SECRET_NEVER_TRANSFER'}],
      relationships: [{objectId: `ORDER_PRIVATE_${i}`, qualifier: 'case'},
        {objectId: `RESOURCE_PRIVATE_${i}`, qualifier: 'used'}]},
    {id: `EVENT_PRIVATE_${i}_C`, type: 'completed', time: time(2),
      attributes: [{name: 'privateNote', value: 'synthetic'}],
      relationships: [{objectId: `ORDER_PRIVATE_${i}`, qualifier: 'case'}]});
  }
  const ocel2 = {eventTypes, objectTypes, events, objects};
  return {schema: OCEL2_SYNTHETIC_SCHEMA,
    selected_subject: 'SYNTH_SUBJECT_PRIVATE',
    source_pin: {source_id: 'SYNTH_PRIVATE_SOURCE', revision: 'revision-01',
      subject_scope: 'SYNTH_SUBJECT_PRIVATE', ocel_sha256: await sha256Canonical(ocel2)},
    ocel2};
}