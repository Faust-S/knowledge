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

export function canonical(value, stack = new Set()) {
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
    : "{" + Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) =>
        JSON.stringify(key) + ":" + canonical(value[key], stack)).join(",") + "}";
  stack.delete(value);
  return output;
}

function makeBindings(bindings) {
  if (!object(bindings) || !Array.isArray(bindings.objects) ||
      !Array.isArray(bindings.events)) fail("INVALID_BINDINGS");
  const schemas = new Map();
  const eventTypes = new Map();
  const relationKinds = new Map();
  const relationBindings = bindings.relations ?? [];
  if (!Array.isArray(relationBindings)) fail("INVALID_RELATION_BINDINGS");

  for (const entry of relationBindings) {
    if (!object(entry) || typeof entry.kind !== "string" ||
        !/^[a-z][a-z0-9_.-]*$/.test(entry.kind) ||
        typeof entry.relation !== "string" ||
        !/^[a-z][a-z0-9_.-]*$/.test(entry.relation)) fail("INVALID_RELATION_BINDING");
    if (relationKinds.has(entry.kind)) fail("DUPLICATE_RELATION_BINDING");
    relationKinds.set(entry.kind, entry.relation);
  }

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
      if (link.many !== undefined && typeof link.many !== "boolean")
        fail("INVALID_LINK_BINDING");
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
    // Interpret Event payload references only through exact, declared bindings.
    const objectLinks = entry.object_links ?? [];
    if (!Array.isArray(objectLinks)) fail("INVALID_EVENT_OBJECT_BINDING");
    const used = new Set();
    for (const link of objectLinks) {
      if (!object(link) ||
          !/^[A-Za-z][A-Za-z0-9_]*$/.test(link.field ?? "") ||
          !/^[a-z][a-z0-9_.-]*$/.test(link.qualifier ?? "") ||
          (link.many !== undefined && typeof link.many !== "boolean")) {
        fail("INVALID_EVENT_OBJECT_BINDING");
      }
      const key = JSON.stringify([link.field, link.qualifier]);
      if (used.has(key)) fail("DUPLICATE_EVENT_OBJECT_BINDING");
      used.add(key);
    }
    eventTypes.set(eventType, { semantic_kind: entry.semantic_kind, object_links: objectLinks });
  }
  return { schemas, eventTypes, relationKinds };
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
  workspace_id, objects, events, relations: sourceRelations = [], bindings,
} = {}) {
  const workspaceId = nonempty(workspace_id, "INVALID_WORKSPACE");
  if (!Array.isArray(objects) || !Array.isArray(events) ||
      !Array.isArray(sourceRelations)) fail("INVALID_SOURCE_COLLECTION");
  const { schemas, eventTypes, relationKinds } = makeBindings(bindings);

  const localObjects = dedupe(
    objects.filter((row) => object(row) && row.workspace_id === workspaceId),
    "object_id", "CONFLICTING_OBJECT_REVISION",
  );
  const localEvents = dedupe(
    events.filter((row) => object(row) && row.workspace_id === workspaceId),
    "event_id", "CONFLICTING_EVENT_ID",
  );

  const localRelations = dedupe(
    sourceRelations.filter((row) => object(row) && row.workspace_id === workspaceId),
    "relation_id", "CONFLICTING_RELATION_ID",
  );
  const deletedObjects = new Set();
  const known = new Map();
  const nodes = [];
  const unmappedObjects = [];
  const unmappedEvents = [];
  const unmappedRelations = [];
  const unresolved = [];
  const relations = [];
  const projectedEvents = [];

  for (const row of localObjects) {
    const objectId = nonempty(row.object_id, "INVALID_SOURCE_ID");
    const schemaId = nonempty(row.schema_id, "INVALID_SOURCE_SCHEMA");
    const schemaVersion = nonempty(row.schema_version, "INVALID_SOURCE_SCHEMA");
    const revision = positiveRevision(row.revision);
    if (row.deleted === true) {
      deletedObjects.add(objectId);
      continue;
    }
    const binding = schemas.get(JSON.stringify([schemaId, schemaVersion]));
    if (!binding) {
      unmappedObjects.push(objectId);
      continue;
    }
    if (binding.links.length > 0 && !object(row.data)) fail("INVALID_BOUND_OBJECT_DATA");
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
      // A domain can explicitly declare a plural reference field (e.g.
      // dependencies or kit components). Never infer a graph edge from an
      // arbitrary array of data: only version-pinned bindings opt in.
      const raw = item.row.data[link.field];
      const targets = link.many === true
        ? Array.isArray(raw) ? raw : [null]
        : [raw];
      const visited = new Set();
      for (const targetId of targets) {
        if (typeof targetId !== "string" || !targetId.trim()) {
          unresolved.push({ source_id: sourceId, relation: link.relation,
            reason: "invalid_ref" });
          continue;
        }
        if (visited.has(targetId)) fail("DUPLICATE_LINK_TARGET");
        visited.add(targetId);
        if (!known.has(targetId)) {
          unresolved.push({ source_id: sourceId, relation: link.relation,
            reason: deletedObjects.has(targetId) ? "deleted_ref" : "unknown_ref" });
          continue;
        }
        relations.push({
          source_id: sourceId, target_id: targetId, relation: link.relation,
          source_revision: item.row.revision,
        });
      }
    }
  }

  for (const row of localRelations) {
    const relationId = nonempty(row.relation_id, "INVALID_RELATION_ID");
    const kind = nonempty(row.kind, "INVALID_RELATION_KIND");
    const relation = relationKinds.get(kind);
    if (!relation) {
      unmappedRelations.push(relationId);
      continue;
    }
    const fromId = nonempty(row.from_object_id, "INVALID_RELATION_OBJECT");
    const toId = nonempty(row.to_object_id, "INVALID_RELATION_OBJECT");
    if (!known.has(fromId) || !known.has(toId)) {
      unresolved.push({ source_id: relationId, relation,
        reason: deletedObjects.has(fromId) || deletedObjects.has(toId)
          ? "deleted_ref" : "unknown_ref" });
      continue;
    }
    relations.push({
      relation_id: relationId,
      source_id: fromId, target_id: toId, relation,
      source_revision: known.get(fromId).row.revision,
    });
  }

  for (const row of localEvents) {
    const eventId = nonempty(row.event_id, "INVALID_SOURCE_ID");
    const eventType = nonempty(row.event_type, "INVALID_EVENT_TYPE");
    const binding = eventTypes.get(eventType);
    if (!binding) {
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
        unresolved.push({ source_id: eventId, relation: "event_object",
          reason: deletedObjects.has(objectId) ? "deleted_ref" : "unverified_ref" });
      } else {
        objectRef = { object_id: objectId, revision: row.revision ?? source.row.revision };
      }
    }

    // Old bindings keep the exact legacy object_ref shape. A configured
    // event type may additionally expose source-qualified E2O references.
    const objectRefs = binding.object_links.length ? [] : null;
    if (objectRefs && objectRef) {
      objectRefs.push({ ...objectRef, qualifier: "primary" });
    }
    if (objectRefs) {
      const seen = new Set(objectRefs.map((ref) => ref.object_id));
      for (const link of binding.object_links) {
        if (!object(row.payload) || !Object.hasOwn(row.payload, link.field)) continue;
        const raw = row.payload[link.field];
        const candidates = link.many === true
          ? Array.isArray(raw) ? raw : [null] : [raw];
        for (const candidate of candidates) {
          if (!object(candidate) || typeof candidate.object_id !== "string" ||
              !candidate.object_id.trim() ||
              !Number.isSafeInteger(candidate.revision) || candidate.revision < 1) {
            unresolved.push({
              source_id: eventId, relation: "event_object:" + link.qualifier,
              reason: "invalid_ref",
            });
            continue;
          }
          // A single event/object relationship has one qualified meaning in
          // this profile. Never silently select among conflicting qualifiers.
          if (seen.has(candidate.object_id)) fail("DUPLICATE_EVENT_OBJECT_REF");
          seen.add(candidate.object_id);
          const target = known.get(candidate.object_id);
          if (!target) {
            unresolved.push({
              source_id: eventId, relation: "event_object:" + link.qualifier,
              reason: deletedObjects.has(candidate.object_id) ? "deleted_ref" : "unknown_ref",
            });
            continue;
          }
          if (candidate.revision > target.row.revision) {
            unresolved.push({
              source_id: eventId, relation: "event_object:" + link.qualifier,
              reason: "unverified_ref",
            });
            continue;
          }
          objectRefs.push({
            object_id: candidate.object_id,
            revision: candidate.revision,
            qualifier: link.qualifier,
          });
        }
      }
      objectRefs.sort((a, b) => byId(a.object_id, b.object_id) ||
        byId(a.qualifier, b.qualifier) || a.revision - b.revision);
    }
    projectedEvents.push({
      event_id: eventId,
      event_type: eventType,
      semantic_kind: binding.semantic_kind,
      occurred_at: occurredAt,
      ...(row.causation_id ? { causation_id: row.causation_id } : {}),
      ...(row.correlation_id ? { correlation_id: row.correlation_id } : {}),
      object_ref: objectRef,
      ...(objectRefs ? { object_refs: objectRefs } : {}),
    });
  }

  nodes.sort((a, b) => byId(a.object_id, b.object_id));
  relations.sort((a, b) => byId(
    a.source_id + "|" + a.relation + "|" + a.target_id + "|" + (a.relation_id ?? ""),
    b.source_id + "|" + b.relation + "|" + b.target_id + "|" + (b.relation_id ?? ""),
  ));
  projectedEvents.sort((a, b) => byId(a.event_id, b.event_id));
  unresolved.sort((a, b) => byId(
    a.source_id + "|" + a.relation + "|" + a.reason,
    b.source_id + "|" + b.relation + "|" + b.reason,
  ));
  unmappedObjects.sort(byId);
  unmappedEvents.sort(byId);
  unmappedRelations.sort(byId);

  return {
    workspace_id: workspaceId,
    nodes,
    events: projectedEvents,
    relations,
    unresolved,
    unmapped: { object_ids: unmappedObjects, event_ids: unmappedEvents,
      relation_ids: unmappedRelations },
  };
}
