const KINDS = new Set([
  "Entity", "Statement", "Event", "State", "Activity", "Process",
  "Observation", "Decision", "Result", "Evidence", "Provenance",
]);

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value, code) {
  if (typeof value !== "string" || !value.trim()) fail(code);
  return value;
}

function positiveRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail("INVALID_REVISION");
  return value;
}

function canonical(value, stack = new Set()) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) fail("NON_JSON_VALUE");
    if (value === undefined || typeof value === "function" || typeof value === "symbol") {
      fail("NON_JSON_VALUE");
    }
    return JSON.stringify(value);
  }
  if (stack.has(value)) fail("CYCLIC_RECORD");
  stack.add(value);
  const output = Array.isArray(value)
    ? "[" + value.map((item) => canonical(item, stack)).join(",") + "]"
    : "{" + Object.keys(value).sort().map((key) =>
        JSON.stringify(key) + ":" + canonical(value[key], stack)).join(",") + "}";
  stack.delete(value);
  return output;
}

function makeBindings(bindings) {
  if (!object(bindings) || !Array.isArray(bindings.objects) ||
      !Array.isArray(bindings.events)) fail("INVALID_BINDINGS");
  const schemas = new Map();
  const eventTypes = new Map();

  for (const entry of bindings.objects) {
    if (!object(entry)) fail("INVALID_SCHEMA_BINDING");
    const schemaId = nonempty(entry.schema_id, "INVALID_SCHEMA_BINDING");
    const schemaVersion = nonempty(entry.schema_version, "INVALID_SCHEMA_BINDING");
    if (!KINDS.has(entry.semantic_kind)) fail("INVALID_SEMANTIC_KIND");
    const key = JSON.stringify([schemaId, schemaVersion]);
    if (schemas.has(key)) fail("DUPLICATE_SCHEMA_BINDING");
    const links = entry.links ?? [];
    if (!Array.isArray(links)) fail("INVALID_LINK_BINDING");
    const used = new Set();
    for (const link of links) {
      if (!object(link) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(link.field ?? "") ||
          typeof link.relation !== "string" ||
          !/^[a-z][a-z0-9_.-]*$/.test(link.relation)) fail("INVALID_LINK_BINDING");
      if (used.has(link.field + ":" + link.relation)) fail("DUPLICATE_LINK_BINDING");
      used.add(link.field + ":" + link.relation);
    }
    schemas.set(key, { semantic_kind: entry.semantic_kind, links });
  }

  for (const entry of bindings.events) {
    if (!object(entry)) fail("INVALID_EVENT_BINDING");
    const eventType = nonempty(entry.event_type, "INVALID_EVENT_BINDING");
    if (entry.semantic_kind !== "Event" && entry.semantic_kind !== "Observation") {
      fail("INVALID_EVENT_BINDING");
    }
    if (eventTypes.has(eventType)) fail("DUPLICATE_EVENT_BINDING");
    eventTypes.set(eventType, entry.semantic_kind);
  }
  return { schemas, eventTypes };
}

function dedupe(items, idField, conflictCode) {
  const unique = new Map();
  for (const row of items) {
    if (!object(row)) fail("INVALID_SOURCE_RECORD");
    const id = nonempty(row[idField], "INVALID_SOURCE_ID");
    const digest = canonical(row);
    const previous = unique.get(id);
    if (previous) {
      if (previous.digest !== digest) fail(conflictCode);
    } else {
      unique.set(id, { row, digest });
    }
  }
  return [...unique.values()].map((record) => record.row);
}

function byId(a, b) {
  return a.localeCompare(b, "en");
}

export function projectActivitySnapshot({
  workspace_id, objects, events, bindings,
} = {}) {
  const workspaceId = nonempty(workspace_id, "INVALID_WORKSPACE");
  if (!Array.isArray(objects) || !Array.isArray(events)) fail("INVALID_SOURCE_COLLECTION");
  const { schemas, eventTypes } = makeBindings(bindings);

  const localObjects = dedupe(
    objects.filter((row) => object(row) && row.workspace_id === workspaceId),
    "object_id", "CONFLICTING_OBJECT_REVISION",
  );
  const localEvents = dedupe(
    events.filter((row) => object(row) && row.workspace_id === workspaceId),
    "event_id", "CONFLICTING_EVENT_ID",
  );

  const known = new Map();
  const nodes = [];
  const unmappedObjects = [];
  const unmappedEvents = [];
  const unresolved = [];
  const relations = [];
  const projectedEvents = [];

  for (const row of localObjects) {
    const objectId = nonempty(row.object_id, "INVALID_SOURCE_ID");
    const schemaId = nonempty(row.schema_id, "INVALID_SOURCE_SCHEMA");
    const schemaVersion = nonempty(row.schema_version, "INVALID_SOURCE_SCHEMA");
    const revision = positiveRevision(row.revision);
    const binding = schemas.get(JSON.stringify([schemaId, schemaVersion]));
    if (!binding) {
      unmappedObjects.push(objectId);
      continue;
    }
    if (!object(row.data)) fail("INVALID_BOUND_OBJECT_DATA");
    known.set(objectId, { row, binding });
    nodes.push({
      object_id: objectId,
      revision,
      schema_id: schemaId,
      schema_version: schemaVersion,
      semantic_kind: binding.semantic_kind,
    });
  }

  for (const [sourceId, item] of known) {
    for (const link of item.binding.links) {
      if (!Object.hasOwn(item.row.data, link.field)) continue;
      const targetId = item.row.data[link.field];
      if (typeof targetId !== "string" || !targetId.trim()) {
        unresolved.push({ source_id: sourceId, relation: link.relation, reason: "invalid_ref" });
        continue;
      }
      if (!known.has(targetId)) {
        unresolved.push({ source_id: sourceId, relation: link.relation, reason: "unknown_ref" });
        continue;
      }
      relations.push({
        source_id: sourceId, target_id: targetId, relation: link.relation,
        source_revision: item.row.revision,
      });
    }
  }

  for (const row of localEvents) {
    const eventId = nonempty(row.event_id, "INVALID_SOURCE_ID");
    const eventType = nonempty(row.event_type, "INVALID_EVENT_TYPE");
    const kind = eventTypes.get(eventType);
    if (!kind) {
      unmappedEvents.push(eventId);
      continue;
    }
    const occurredAt = nonempty(row.occurred_at, "INVALID_EVENT_TIME");
    if (!Number.isFinite(Date.parse(occurredAt))) fail("INVALID_EVENT_TIME");

    let objectRef = null;
    if (row.object_id !== undefined) {
      const objectId = nonempty(row.object_id, "INVALID_EVENT_OBJECT");
      const source = known.get(objectId);
      if (!source || (row.revision !== undefined &&
           (!Number.isSafeInteger(row.revision) || row.revision < 1 ||
            row.revision > source.row.revision))) {
        unresolved.push({ source_id: eventId, relation: "event_object", reason: "unverified_ref" });
      } else {
        objectRef = { object_id: objectId, revision: row.revision ?? source.row.revision };
      }
    }

    projectedEvents.push({
      event_id: eventId,
      event_type: eventType,
      semantic_kind: kind,
      occurred_at: occurredAt,
      ...(row.causation_id ? { causation_id: row.causation_id } : {}),
      ...(row.correlation_id ? { correlation_id: row.correlation_id } : {}),
      object_ref: objectRef,
    });
  }

  nodes.sort((a, b) => byId(a.object_id, b.object_id));
  relations.sort((a, b) => byId(
    a.source_id + "|" + a.relation + "|" + a.target_id,
    b.source_id + "|" + b.relation + "|" + b.target_id,
  ));
  projectedEvents.sort((a, b) => byId(a.event_id, b.event_id));
  unresolved.sort((a, b) => byId(
    a.source_id + "|" + a.relation, b.source_id + "|" + b.relation,
  ));
  unmappedObjects.sort(byId);
  unmappedEvents.sort(byId);

  return {
    workspace_id: workspaceId,
    nodes,
    events: projectedEvents,
    relations,
    unresolved,
    unmapped: { object_ids: unmappedObjects, event_ids: unmappedEvents },
  };
}
