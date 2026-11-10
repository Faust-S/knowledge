import assert from "node:assert/strict";
import test from "node:test";
import { projectActivitySnapshot } from "../../src/t3/activity/index.mjs";

const workspace = "ws:d06-one";
const bindings = {
  objects: [
    { schema_id: "d06.requirement", schema_version: "1.0.0", semantic_kind: "Entity" },
    {
      schema_id: "d06.order", schema_version: "1.0.0", semantic_kind: "Process",
      links: [{ field: "requirement_id", relation: "depends_on" }],
    },
  ],
  events: [{ event_type: "d06.order.confirmed", semantic_kind: "Event" }],
};
function obj(id, schema, data = {}, revision = 1, ws = workspace) {
  return {
    object_id: id, workspace_id: ws, schema_id: schema,
    schema_version: "1.0.0", revision, data,
    created_by_service: "d06", updated_by_service: "d06",
    created_at: "2026-11-10T09:00:00Z", updated_at: "2026-11-10T09:00:00Z",
    extensions: {},
  };
}
function evt(id, objectId, ws = workspace) {
  return {
    event_id: id, workspace_id: ws, event_type: "d06.order.confirmed",
    service_id: "d06", object_id: objectId, revision: 2,
    occurred_at: "2026-11-10T10:00:00Z",
    causation_id: "draft-approved", correlation_id: "order-42",
    payload: { secret_notes: "private text must never appear in projection" },
  };
}
const requirement = obj("requirement:1", "d06.requirement", { amount: 100 });
const order = obj(
  "order:42", "d06.order",
  { requirement_id: "requirement:1", buyer_name: "Private Buyer" },
  2,
);
const options = () => ({
  workspace_id: workspace,
  objects: [requirement, order],
  events: [evt("event:confirm-42", "order:42")],
  bindings,
});

test("D06: explicit semantic kinds, process link, source revisions and event", () => {
  const view = projectActivitySnapshot(options());
  assert.equal(view.workspace_id, workspace);
  assert.deepEqual(view.nodes.map((n) => [n.object_id, n.semantic_kind, n.revision]), [
    ["order:42", "Process", 2], ["requirement:1", "Entity", 1],
  ]);
  assert.deepEqual(view.relations, [{
    source_id: "order:42", target_id: "requirement:1",
    relation: "depends_on", source_revision: 2,
  }]);
  assert.equal(view.events[0].semantic_kind, "Event");
  assert.equal(view.events[0].object_ref.revision, 2);
  assert.equal(view.events[0].correlation_id, "order-42");
  assert.equal(view.unresolved.length, 0);
});

test("D10: second independent subject/domain binding", () => {
  const view = projectActivitySnapshot({
    workspace_id: "ws:d10",
    objects: [
      obj("campaign:9", "d10.campaign", { budget: 9 }, 1, "ws:d10"),
      obj("sale:2", "d10.sale", { campaign_id: "campaign:9" }, 3, "ws:d10"),
    ],
    events: [],
    bindings: {
      objects: [
        { schema_id: "d10.sale", schema_version: "1.0.0", semantic_kind: "Result",
          links: [{ field: "campaign_id", relation: "attributed_to" }] },
        { schema_id: "d10.campaign", schema_version: "1.0.0", semantic_kind: "Activity" },
      ],
      events: [],
    },
  });
  assert.equal(view.nodes.length, 2);
  assert.equal(view.relations[0].relation, "attributed_to");
  assert.equal(view.nodes[1].semantic_kind, "Result");
});

test("does not transmit object payload, event payload or invent a Task", () => {
  const source = options();
  const before = JSON.stringify(source);
  const result = projectActivitySnapshot(source);
  assert.equal(JSON.stringify(source), before);
  const projected = JSON.stringify(result);
  assert.ok(!projected.includes("Private Buyer"));
  assert.ok(!projected.includes("secret_notes"));
  assert.ok(!projected.includes("amount"));
  assert.ok(!projected.includes('"Task"'));
});

test("foreign workspace data are omitted", () => {
  const source = options();
  source.objects.push(obj("foreign:1", "d06.order", { requirement_id: "requirement:1" }, 1, "ws:other"));
  source.events.push(evt("event:foreign", "foreign:1", "ws:other"));
  const result = projectActivitySnapshot(source);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.events.length, 1);
  assert.ok(!JSON.stringify(result).includes("foreign"));
});

test("missing referenced object is explicit; no fabricated entity", () => {
  const source = options();
  source.objects = [order];
  const result = projectActivitySnapshot(source);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.relations.length, 0);
  assert.deepEqual(result.unresolved, [{
    source_id: "order:42", relation: "depends_on", reason: "unknown_ref",
  }]);
});

test("unsupported schema and event are not asserted as known semantics", () => {
  const source = options();
  source.objects.push(obj("other:9", "unmapped.unknown"));
  source.events.push({ ...evt("event:unsupported", "order:42"), event_type: "unmapped.event" });
  const result = projectActivitySnapshot(source);
  assert.deepEqual(result.unmapped.object_ids, ["other:9"]);
  assert.deepEqual(result.unmapped.event_ids, ["event:unsupported"]);
});

test("different schema version does not inherit a binding", () => {
  const source = options();
  source.objects[0] = { ...requirement, schema_version: "2.0.0" };
  const result = projectActivitySnapshot(source);
  assert.deepEqual(result.unmapped.object_ids, ["requirement:1"]);
  assert.deepEqual(result.unresolved[0], {
    source_id: "order:42", relation: "depends_on", reason: "unknown_ref",
  });
});

test("same event replay is idempotent; conflicting payload refuses", () => {
  const source = options();
  source.events.push(structuredClone(source.events[0]));
  assert.equal(projectActivitySnapshot(source).events.length, 1);
  source.events[1].payload.secret_notes = "changed";
  assert.throws(() => projectActivitySnapshot(source), { code: "CONFLICTING_EVENT_ID" });
});

test("conflicting object revisions cannot silently select latest", () => {
  const source = options();
  source.objects.push({ ...order, revision: 3 });
  assert.throws(() => projectActivitySnapshot(source), { code: "CONFLICTING_OBJECT_REVISION" });
});

test("duplicate records in different order produce identical view", () => {
  const source = options();
  const view1 = projectActivitySnapshot(source);
  const view2 = projectActivitySnapshot({
    ...source, objects: [...source.objects].reverse(), events: [...source.events].reverse(),
    bindings: { objects: [...bindings.objects].reverse(), events: [...bindings.events] },
  });
  assert.deepEqual(view1, view2);
});

test("unknown/future object revision on event is not treated as proven link", () => {
  const source = options();
  source.events[0] = { ...source.events[0], revision: 99 };
  const result = projectActivitySnapshot(source);
  assert.equal(result.events[0].object_ref, null);
  assert.deepEqual(result.unresolved, [{
    source_id: "event:confirm-42", relation: "event_object", reason: "unverified_ref",
  }]);
});

test("invalid relation target stays unresolved", () => {
  const source = options();
  source.objects[1] = { ...order, data: { requirement_id: 5 } };
  const result = projectActivitySnapshot(source);
  assert.equal(result.relations.length, 0);
  assert.equal(result.unresolved[0].reason, "invalid_ref");
});

test("unknown semantic kind and duplicate bindings fail", () => {
  const source = options();
  source.bindings = {
    objects: [{ schema_id: "d06.order", schema_version: "1.0.0", semantic_kind: "Task" }],
    events: [],
  };
  assert.throws(() => projectActivitySnapshot(source), { code: "INVALID_SEMANTIC_KIND" });
  source.bindings = { objects: [bindings.objects[0], bindings.objects[0]], events: [] };
  assert.throws(() => projectActivitySnapshot(source), { code: "DUPLICATE_SCHEMA_BINDING" });
});

test("missing inputs and malformed source are explicit errors", () => {
  assert.throws(() => projectActivitySnapshot(), { code: "INVALID_WORKSPACE" });
  assert.throws(() => projectActivitySnapshot({
    workspace_id: workspace, objects: {}, events: [], bindings,
  }), { code: "INVALID_SOURCE_COLLECTION" });
  const source = options();
  source.objects[1] = { ...order, revision: 0 };
  assert.throws(() => projectActivitySnapshot(source), { code: "INVALID_REVISION" });
});

test("a cyclic source record cannot become a silent digest", () => {
  const source = options();
  source.objects[1] = { ...order, data: {} };
  source.objects[1].data.loop = source.objects[1].data;
  assert.throws(() => projectActivitySnapshot(source), { code: "CYCLIC_RECORD" });
});
