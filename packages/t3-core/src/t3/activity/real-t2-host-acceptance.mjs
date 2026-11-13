import assert from "node:assert/strict";
import { canonical } from "./index.mjs";
import { readT3ActivityInLiveBrowser, compareT3ActivityAfterColdRestart } from "./t2-host-witness.mjs";

// Live qualification only: a verified, disposable T2 Host must already be running.
// This module does not build a Kernel, impersonate IWXA, or emulate persistence.
export const LIVE_T2_BINDINGS = Object.freeze({
  objects: [{
    schema_id: "iwxa.demo.note", schema_version: "1.0.0", semantic_kind: "Entity",
    links: [{ field: "dependency_ids", relation: "declared_dependency", many: true }],
  }],
  events: [
    { event_type: "t3.activity.created", semantic_kind: "Event" },
    { event_type: "t3.activity.updated", semantic_kind: "Event",
      object_links: [{ field: "affected", qualifier: "related_requirement", many: true }] },
    { event_type: "t3.activity.linked", semantic_kind: "Event" },
  ],
  relations: [{ kind: "depends_on", relation: "depends_on" }],
});

function required(value, label) {
  assert.equal(typeof value, "string", label + "_REQUIRED");
  assert.ok(value.trim(), label + "_REQUIRED");
  return value;
}

function pageRequired(page) {
  assert.equal(typeof page?.evaluate, "function", "REAL_BROWSER_PAGE_REQUIRED");
  return page;
}

const REQUIRED_WRITES = [
  "t1.createWorkspace", "t1.putObject", "t1.putRelation",
];

export async function createRealT2ActivityFixture(page, {
  workspace_id,
  foreign_workspace_id,
  writer_service_id,
} = {}) {
  pageRequired(page);
  required(workspace_id, "WORKSPACE");
  required(foreign_workspace_id, "FOREIGN_WORKSPACE");
  required(writer_service_id, "WRITER_SERVICE");
  assert.notEqual(workspace_id, foreign_workspace_id, "WORKSPACES_NOT_DISTINCT");

  return page.evaluate(async ({ workspace_id, foreign_workspace_id, writer_service_id, REQUIRED_WRITES }) => {
    if (typeof globalThis.IWXA?.connect !== "function") throw new Error("REAL_T2_IWXA_REQUIRED");
    const session = await globalThis.IWXA.connect({ service_id: writer_service_id });
    if (session.contract_version !== "1.3.0" || session.runtime_version !== "0.3.6" ||
        session.service?.service_id !== writer_service_id ||
        REQUIRED_WRITES.some(op => !session.granted_operations.includes(op))) {
      throw new Error("REAL_T2_WRITER_CONTRACT_MISMATCH");
    }
    const workspace = await session.t1.createWorkspace({ workspace_id, profile: "generic" });
    if (workspace.workspace_id !== workspace_id) throw new Error("T2_WORKSPACE_RECEIPT_MISMATCH");

    const make = (object_id, title) => session.t1.putObject({
      workspace_id, object_id, schema_id: "iwxa.demo.note",
      schema_version: "1.0.0", base_revision: 0,
      data: { title }, extensions: {},
      event: { event_type: "t3.activity.created", payload: {} },
    });
    const a = await make("activity:a", "Synthetic A");
    const b = await make("activity:b", "Synthetic B");
    const updated = await session.t1.putObject({
      workspace_id, object_id: a.object.object_id,
      schema_id: "iwxa.demo.note", schema_version: "1.0.0",
      base_revision: a.object.revision,
      data: { title: "Synthetic A updated", dependency_ids: ["activity:b"] },
      extensions: {},
      event: { event_type: "t3.activity.updated",
        payload: { affected: [{ object_id: b.object.object_id, revision: b.object.revision }] } },
    });
    const link = await session.t1.putRelation({
      workspace_id, relation_id: "relation:a-to-b",
      from_object_id: a.object.object_id, to_object_id: b.object.object_id,
      kind: "depends_on", event: { event_type: "t3.activity.linked", payload: {} },
    });
    await session.t1.createWorkspace({ workspace_id: foreign_workspace_id, profile: "generic" });
    const foreign = await session.t1.putObject({
      workspace_id: foreign_workspace_id, object_id: "foreign:unrelated",
      schema_id: "iwxa.demo.note", schema_version: "1.0.0", base_revision: 0,
      data: { title: "Foreign synthetic data" }, extensions: {},
      event: { event_type: "t3.activity.created", payload: {} },
    });
    if (!a.event?.event_id || !b.event?.event_id ||
        !updated.event?.event_id || !link.event?.event_id ||
        link.relation?.relation_id !== "relation:a-to-b" || !foreign.event?.event_id) {
      throw new Error("T2_KERNEL_RECEIPTS_MISSING");
    }
    return {
      workspace_id, foreign_workspace_id,
      object_ids: [a.object.object_id, b.object.object_id],
      revisions: { a_initial: a.object.revision, a_current: updated.object.revision,
        b_current: b.object.revision },
      event_ids: [a.event.event_id, b.event.event_id, updated.event.event_id, link.event.event_id],
      relation_id: link.relation.relation_id,
    };
  }, { workspace_id, foreign_workspace_id, writer_service_id, REQUIRED_WRITES });
}

export async function readRealT2ActivitySource(page, { workspace_id, reader_service_id } = {}) {
  pageRequired(page);
  required(workspace_id, "WORKSPACE");
  required(reader_service_id, "READER_SERVICE");
  return page.evaluate(async ({ workspace_id, reader_service_id }) => {
    if (typeof globalThis.IWXA?.connect !== "function") throw new Error("REAL_T2_IWXA_REQUIRED");
    const session = await globalThis.IWXA.connect({ service_id: reader_service_id });
    const allowed = new Set([
      "t0.validate", "t1.listWorkspaces", "t1.getWorkspace",
      "t1.listObjects", "t1.getObject", "t1.listAssets",
      "t1.getAsset", "t1.listEventsSince",
    ]);
    const mandatory = ["t1.getWorkspace", "t1.listObjects", "t1.getObject", "t1.listEventsSince"];
    if (session.contract_version !== "1.3.0" || session.runtime_version !== "0.3.6" ||
        session.service?.service_id !== reader_service_id ||
        mandatory.some(op => !session.granted_operations.includes(op)) ||
        session.granted_operations.some(op => !allowed.has(op))) {
      throw new Error("T2_INDEPENDENT_READER_NOT_READ_ONLY");
    }
    const workspace = await session.t1.getWorkspace(workspace_id);
    const objects = await session.t1.listObjects({ workspace_id, include_deleted: true });
    const events = await session.t1.listEventsSince(workspace_id);
    const details = [];
    for (const record of objects) {
      details.push(await session.t1.getObject(workspace_id, record.object_id));
    }
    return { workspace, objects, events, details };
  }, { workspace_id, reader_service_id });
}

export function verifyRealT2Receipts(snapshot, receipts) {
  assert.equal(snapshot.workspace?.workspace_id, receipts.workspace_id, "T2_WORKSPACE_NOT_READ_BACK");
  assert.equal(snapshot.objects?.length, 2, "T2_OBJECTS_NOT_READ_BACK");
  assert.deepEqual(new Set(snapshot.objects.map(x => x.object_id)), new Set(receipts.object_ids));
  assert.ok(snapshot.objects.every(x => x.workspace_id === receipts.workspace_id));
  assert.equal(snapshot.objects.find(x => x.object_id === "activity:a")?.revision,
    receipts.revisions.a_current, "T2_OBJECT_REVISION_MISMATCH");
  for (const id of receipts.event_ids) {
    assert.ok(snapshot.events.some(x => x.event_id === id), "T2_HISTORY_RECEIPT_NOT_FOUND");
  }
  assert.ok(snapshot.details.some(x => x.relations.outgoing.some(r =>
    r.relation_id === receipts.relation_id)), "T2_RELATION_NOT_READ_BACK");
}

export async function proveRealT2ReadOnlyProjection(page, {
  workspace_id, reader_service_id, writer_service_id,
  foreign_workspace_id, receipts,
} = {}) {
  const beforeSource = await readRealT2ActivitySource(page, { workspace_id, reader_service_id });
  verifyRealT2Receipts(beforeSource, receipts);
  const probe = await readT3ActivityInLiveBrowser(page, {
    workspace_id, service_id: reader_service_id, bindings: LIVE_T2_BINDINGS,
  });
  assert.equal(probe.source, "t2-live-kernel-client");
  assert.equal(probe.runtime_version, "0.3.6");
  assert.equal(probe.contract_version, "1.3.0");
  assert.deepEqual(probe.view.nodes.map(x => x.object_id), ["activity:a", "activity:b"]);
  assert.equal(probe.view.nodes.find(x => x.object_id === "activity:a")?.revision,
    receipts.revisions.a_current);
  assert.equal(probe.view.events.length, receipts.event_ids.length);
  const updatedEvent=probe.view.events.find(x=>x.event_type==="t3.activity.updated");
  assert.deepEqual(updatedEvent?.object_refs,[
    {object_id:"activity:a",revision:receipts.revisions.a_current,qualifier:"primary"},
    {object_id:"activity:b",revision:receipts.revisions.b_current,qualifier:"related_requirement"},
  ],"ORIGINAL_KERNEL_D2_QUALIFIED_E2O_NOT_PRESERVED");
  assert.equal(probe.view.relations.length, 2);
  assert.deepEqual(probe.view.relations.find(x=>x.relation==="declared_dependency"),{
    source_id:"activity:a",target_id:"activity:b",
    relation:"declared_dependency",source_revision:receipts.revisions.a_current,
  });
  assert.equal(probe.view.relations.find(x=>x.relation_id===receipts.relation_id)?.relation,
    "depends_on");
  assert.deepEqual(
    beforeSource.objects.find(x=>x.object_id==="activity:a")?.data?.dependency_ids,
    ["activity:b"], "ORIGINAL_T2_PLURAL_REFERENCES_NOT_PERSISTED");
  assert.ok(!canonical(probe.view).includes("Synthetic A updated"), "RAW_T2_OBJECT_LEAK");
  assert.ok(!canonical(probe.view).includes(foreign_workspace_id), "FOREIGN_WORKSPACE_LEAK");
  assert.ok(!canonical(probe.view).includes("foreign:unrelated"), "FOREIGN_OBJECT_LEAK");

  const afterSource = await readRealT2ActivitySource(page, { workspace_id, reader_service_id });
  assert.equal(canonical(beforeSource), canonical(afterSource), "PROJECTION_WROTE_TO_T2");
  const denied = await page.evaluate(async ({ workspace_id, reader_service_id }) => {
    const session = await globalThis.IWXA.connect({ service_id: reader_service_id });
    try {
      await session.t1.putObject({
        workspace_id, object_id: "read-only:forbidden",
        schema_id: "iwxa.demo.note", schema_version: "1.0.0",
        base_revision: 0, data: {}, event: { event_type: "forbidden", payload: {} },
      });
      return false;
    } catch { return true; }
  }, { workspace_id, reader_service_id });
  assert.equal(denied, true, "T2_READ_ONLY_SERVICE_WRITE_SUCCEEDED");
  await assert.rejects(() => readT3ActivityInLiveBrowser(page, {
    workspace_id, service_id: writer_service_id, bindings: LIVE_T2_BINDINGS,
  }), /T2_READER_HAS_WRITE_AUTHORITY/);
  return { source: beforeSource, projection: probe, denied_write: denied };
}

export function verifyRealT2ColdRestart(before, after) {
  // The owner runner must separately prove shutdown and reopening of the same
  // browser profile and origin. This comparison does NOT prove a restart.
  assert.equal(canonical(before.source), canonical(after.source), "T2_COLD_SOURCE_CHANGED");
  return compareT3ActivityAfterColdRestart(before.projection, after.projection);
}

export async function proveRealT2StaleRevisionDenied(page, {
  workspace_id, writer_service_id,
} = {}) {
  pageRequired(page);
  required(workspace_id, "WORKSPACE");
  required(writer_service_id, "WRITER_SERVICE");
  const refused = await page.evaluate(async ({ workspace_id, writer_service_id }) => {
    const session = await globalThis.IWXA.connect({ service_id: writer_service_id });
    try {
      await session.t1.putObject({
        workspace_id, object_id: "activity:a",
        schema_id: "iwxa.demo.note", schema_version: "1.0.0",
        base_revision: 0, data: { title: "Unaccepted stale update" },
        event: { event_type: "t3.activity.updated", payload: {} },
      });
      return { denied: false };
    } catch (error) {
      return { denied: true, code: String(error?.code ?? "") };
    }
  }, { workspace_id, writer_service_id });
  assert.equal(refused.denied, true, "T2_STALE_REVISION_WRITE_SUCCEEDED");
  return refused.code;
}

export async function verifyRealT2UnknownAndTombstone(page, {
  workspace_id, reader_service_id, writer_service_id,
} = {}) {
  const unknown = await readT3ActivityInLiveBrowser(page, {
    workspace_id, service_id: reader_service_id,
    bindings: { objects: [], events: [], relations: [] },
  });
  assert.deepEqual(unknown.view.unmapped.object_ids, ["activity:a", "activity:b"]);
  assert.equal(unknown.view.nodes.length, 0, "UNKNOWN_SCHEMA_AS_FACT");

  const deletion = await page.evaluate(async ({ workspace_id, writer_service_id }) => {
    const session = await globalThis.IWXA.connect({ service_id: writer_service_id });
    const original = await session.t1.getObject(workspace_id, "activity:b");
    return session.t1.deleteObject({
      workspace_id, object_id: "activity:b", base_revision: original.object.revision,
      event: { event_type: "t3.activity.deleted", payload: {} },
    });
  }, { workspace_id, writer_service_id });
  assert.ok(deletion.object?.deleted && deletion.event?.event_id, "T2_REAL_TOMBSTONE_MISSING");
  const projected = await readT3ActivityInLiveBrowser(page, {
    workspace_id, service_id: reader_service_id, bindings: LIVE_T2_BINDINGS,
  });
  assert.deepEqual(projected.view.nodes.map(x => x.object_id), ["activity:a"]);
  assert.ok(projected.view.unresolved.some(x => x.reason === "deleted_ref"),
    "DELETED_RELATION_TARGET_NOT_UNRESOLVED");
  return { tombstone_event_id: deletion.event.event_id };
}


/**
 * D4: export exactly one owner-selected Workspace with the ORIGINAL T2
 * Exchange. Keep the exact byte array for TWO independent consumer profiles.
 * No new .iwxa parser, serializer, envelope or shared Store.
 */
export async function exportSelectedRealT2Iwxa(page, {
  workspace_id, writer_service_id,
} = {}) {
  pageRequired(page);
  required(workspace_id, "WORKSPACE");
  required(writer_service_id, "WRITER_SERVICE");
  return page.evaluate(async ({workspace_id, writer_service_id}) => {
    const session=await globalThis.IWXA.connect({service_id:writer_service_id});
    const artifact=await session.t2.exportPackage({
      workspaces:[workspace_id],include_history:true,
      include_relations:true,include_schemas:true,
    });
    if (!(artifact.bytes instanceof Uint8Array) || artifact.bytes.length!==artifact.size ||
        typeof artifact.package_digest!=="string") {
      throw new Error("T3_D4_ORIGINAL_EXPORT_BYTES_REQUIRED");
    }
    const confirmed=await session.t2.confirmExport({
      package_digest:artifact.package_digest,workspace_ids:[workspace_id],
    });
    if (confirmed.package_digest!==artifact.package_digest ||
        confirmed.workspace_ids?.length!==1 ||
        confirmed.workspace_ids[0]!==workspace_id) {
      throw new Error("T3_D4_EXACT_SELECTED_EXPORT_CONFIRMATION_REQUIRED");
    }
    return {
      workspace_id,bytes:[...artifact.bytes],
      size:artifact.bytes.length,package_digest:artifact.package_digest,
      selected_workspaces:[...confirmed.workspace_ids],
    };
  }, {workspace_id,writer_service_id});
}

/**
 * D4: another real consumer runs the original parser and exact
 * importPreview -> importCommit in its OWN browser profile and Store.
 * Caller must create a distinct persistent Chromium profile externally.
 */
export async function importSelectedRealT2Iwxa(page, {
  archive, source_workspace_id, target_workspace_id, writer_service_id,
} = {}) {
  pageRequired(page);
  required(source_workspace_id,"SOURCE_WORKSPACE");
  required(target_workspace_id,"TARGET_WORKSPACE");
  required(writer_service_id,"WRITER_SERVICE");
  assert.notEqual(source_workspace_id,target_workspace_id,"T3_D4_CONSUMER_WORKSPACE_NOT_DISTINCT");
  assert.equal(archive?.workspace_id,source_workspace_id);
  assert.deepEqual(archive?.selected_workspaces,[source_workspace_id]);
  assert.equal(archive?.size,archive?.bytes?.length);
  return page.evaluate(async ({archive,source_workspace_id,target_workspace_id,writer_service_id})=>{
    const session=await globalThis.IWXA.connect({service_id:writer_service_id});
    const before=await session.t1.listWorkspaces();
    if (!Array.isArray(before)||before.some(w=>w.workspace_id===source_workspace_id ||
      w.workspace_id===target_workspace_id)) {
      throw new Error("T3_D4_INDEPENDENT_EMPTY_CONSUMER_REQUIRED");
    }
    const bytes=Uint8Array.from(archive.bytes);
    const preview=await session.t2.importPreview(bytes);
    if(preview.package_digest!==archive.package_digest ||
       preview.preview?.package_digest!==archive.package_digest ||
       !preview.allowed_modes?.includes("new-workspace") ||
       preview.preview?.manifest?.workspaces?.length!==1 ||
       preview.preview.manifest.workspaces[0]!==source_workspace_id) {
      throw new Error("T3_D4_ORIGINAL_PARSER_PREVIEW_MISMATCH");
    }
    const committed=await session.t2.importCommit({
      preview_token:preview.preview_token,package_digest:preview.package_digest,
      plan:{
        mode:"new-workspace",
        workspace_id_map:{[source_workspace_id]:target_workspace_id},
        include_history:true,include_relations:true,
      },
    });
    if(committed.package_digest!==archive.package_digest ||
       committed.mode!=="new-workspace" ||
       committed.workspace_id_map?.[source_workspace_id]!==target_workspace_id){
      throw new Error("T3_D4_ORIGINAL_CONSUMER_IMPORT_RECEIPT_MISMATCH");
    }
    const workspace=await session.t1.getWorkspace(target_workspace_id);
    const objects=await session.t1.listObjects({workspace_id:target_workspace_id});
    const events=await session.t1.listEventsSince(target_workspace_id);
    const linked=events.find(row=>row.event_type==="t3.activity.updated");
    const linkedObjects=linked?.payload?.affected;
    if(!Array.isArray(linkedObjects)||linkedObjects.length!==1 ||
       linkedObjects[0].object_id!=="activity:b" || linkedObjects[0].revision!==1){
      throw new Error("T3_D4_ORIGINAL_EXCHANGE_LOST_QUALIFIED_EVENT_LINKS");
    }
    if(workspace?.workspace_id!==target_workspace_id ||
       objects.length!==2 || events.length<4){
      throw new Error("T3_D4_CONSUMER_OWNER_READBACK_MISSING");
    }
    return {workspace_id:target_workspace_id,
      package_digest:committed.package_digest,import_id:committed.import_id,
      objects:objects.length,events:events.length,
      qualified_event_links:linkedObjects.length,
      relations:committed.applied?.relations??null};
  },{archive,source_workspace_id,target_workspace_id,writer_service_id});
}

export async function roundTripRealT2Iwxa(page, {
  workspace_id, restored_workspace_id, writer_service_id,
} = {}) {
  pageRequired(page);
  for (const [label, value] of Object.entries({
    workspace_id, restored_workspace_id, writer_service_id,
  })) required(value, label);
  assert.notEqual(workspace_id, restored_workspace_id, "RESTORE_SCOPE_NOT_DISTINCT");

  return page.evaluate(async ({ workspace_id, restored_workspace_id, writer_service_id }) => {
    const s = await globalThis.IWXA.connect({ service_id: writer_service_id });
    const artifact = await s.t2.exportPackage({
      workspaces: [workspace_id], include_history: true,
      include_relations: true, include_schemas: true,
    });
    if (!(artifact.bytes instanceof Uint8Array) ||
        !artifact.package_digest || artifact.bytes.length !== artifact.size) {
      throw new Error("ORIGINAL_T2_EXPORT_BYTES_MISSING");
    }
    const confirmation = await s.t2.confirmExport({
      package_digest: artifact.package_digest, workspace_ids: [workspace_id],
    });
    if (confirmation.package_digest !== artifact.package_digest) {
      throw new Error("T2_EXPORT_CONFIRM_MISMATCH");
    }
    const preview = await s.t2.importPreview(artifact.bytes);
    if (!preview.allowed_modes.includes("new-workspace")) {
      throw new Error("NEW_WORKSPACE_IMPORT_NOT_ALLOWED");
    }
    const receipt = await s.t2.importCommit({
      preview_token: preview.preview_token, package_digest: preview.package_digest,
      plan: { mode: "new-workspace", workspace_id_map: {
        [workspace_id]: restored_workspace_id,
      }, include_history: true, include_relations: true },
    });
    if (receipt.package_digest !== artifact.package_digest ||
        receipt.mode !== "new-workspace") throw new Error("T2_IMPORT_RECEIPT_MISMATCH");
    const restored = await s.t1.getWorkspace(restored_workspace_id);
    const objects = await s.t1.listObjects({ workspace_id: restored_workspace_id });
    const events = await s.t1.listEventsSince(restored_workspace_id);
    if (restored?.workspace_id !== restored_workspace_id ||
        objects.length !== 2 || events.length < 4) {
      throw new Error("T2_RESTORED_SOURCE_MISSING");
    }
    return { restored_workspace_id, package_digest: artifact.package_digest,
      byte_size: artifact.bytes.length, objects: objects.length,
      events: events.length, relations: receipt.applied.relations,
      import_id: receipt.import_id };
  }, { workspace_id, restored_workspace_id, writer_service_id });
}
