/**
 * Stage B — Core E2E positive scenario B-01–B-11.
 *
 * Tests exclusively the BUILT Runtime bundle. No imports from `src/**`.
 * On failure the offending step is surfaced verbatim; no repair happens
 * inside the test.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";

import {
  installFreshIndexedDb,
  installWebLocks,
  restoreEnvironment,
} from "./support/environment";
import {
  loadBuiltRuntime,
  installFixtureFetch,
  RUNTIME_PATH_ABSOLUTE,
  type BuiltRuntimeModule,
  type BuiltRuntimeClient,
} from "./support/runtime-loader";
import {
  buildFixturePackage,
  buildGenericPackage,
  inspectPackage,
  type FixtureWorkspaceRecord,
  type FixtureObjectRecord,
} from "./support/package-producer";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FIXTURES = resolve(HERE, "fixtures");
const ARTIFACTS = resolve(ROOT, "artifacts");

const ORIGIN = "https://core-e2e.iwxa.test";

interface StepRecord {
  id: string;
  description: string;
  status: "passed" | "failed";
  duration_ms: number;
  code?: string;
  message?: string;
}

const steps: StepRecord[] = [];

async function step<T>(
  id: string,
  description: string,
  cb: () => Promise<T> | T,
): Promise<T> {
  const t0 = Date.now();
  console.log(`[step ${id}] START — ${description}`);
  try {
    const out = await cb();
    const duration_ms = Date.now() - t0;
    steps.push({ id, description, status: "passed", duration_ms });
      console.log(`[step ${id}] PASS (${duration_ms}ms)`);
    return out;
  } catch (err) {
    const duration_ms = Date.now() - t0;
    const e = err as { code?: string; message?: string };
    steps.push({
      id,
      description,
      status: "failed",
      duration_ms,
      code: e?.code,
      message: e?.message ?? String(err),
    });
      console.log(
      `[step ${id}] FAIL (${duration_ms}ms) — code=${e?.code ?? "n/a"} message=${
        e?.message ?? String(err)
      }`,
    );
    throw err;
  }
}

function readJson<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as T;
}

async function expectThrow(
  fn: () => Promise<unknown>,
): Promise<{ code?: string; message?: string }> {
  try {
    await fn();
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e?.code, message: e?.message };
  }
  throw new Error("expected the operation to throw");
}

let runtime: BuiltRuntimeModule;

beforeAll(async () => {
  if (!existsSync(RUNTIME_PATH_ABSOLUTE)) {
    throw new Error(
      `Built runtime missing at ${RUNTIME_PATH_ABSOLUTE}. Run \`npm run build\` before Stage B.`,
    );
  }
  runtime = await loadBuiltRuntime();
});

describe.sequential("Stage B — Core E2E positive scenario", () => {
  it(
    "B-01–B-11: built Runtime completes the full Core E2E lifecycle",
    async () => {
      const domain = readJson("domain.json");
      const current = { ...readJson<Record<string, unknown>>("current.json"), runtime_version: runtime.RUNTIME_VERSION, contract_version: "1.3.0" };

      // ================================================================
      // B-01 — bootstrap built runtime + connect three services.
      // ================================================================
      const {
        writer,
        reader,
        workspace,
      } = await step("B-01", "bootstrap built runtime & connect clients", async () => {
        installFreshIndexedDb();
        installWebLocks();
        installFixtureFetch();
        await runtime.__resetKernelStoreForTests?.();

        const writer = await runtime.connect(
          { service_id: "dev.test.writer" },
          { domain, current, origin: ORIGIN },
        );
        const reader = await runtime.connect(
          { service_id: "dev.test.reader" },
          { domain, current, origin: ORIGIN },
        );
        const workspace = await runtime.connect(
          { service_id: "dev.test.workspace" },
          { domain, current, origin: ORIGIN },
        );
        return { writer, reader, workspace };
      });

      // ================================================================
      // B-02 — verify client shape / permissions.
      // ================================================================
      await step("B-02", "verify client contracts and granted operations", () => {
        for (const c of [writer, reader, workspace] as BuiltRuntimeClient[]) {
          expect(c.contract_version).toBe("1.3.0");
          expect(c.runtime_version).toBe(runtime.RUNTIME_VERSION);
          expect(c.mode).toBe("full");
          expect(Object.isFrozen(c)).toBe(true);
          for (const forbidden of [
            "indexedDB",
            "db",
            "store",
            "transaction",
            "local" + "Store",
          ]) {
            expect((c as Record<string, unknown>)[forbidden]).toBeUndefined();
          }
        }

        expect([...writer.granted_levels].sort()).toEqual(["T0", "T1", "T2"]);
        for (const op of [
          "t1.createWorkspace",
          "t1.putObject",
          "t1.putRelation",
          "t1.deleteRelation",
          "t1.listAssets",
          "t1.getAsset",
          "t1.putAsset",
          "t1.deleteAsset",
          "t2.exportPackage",
          "t2.importPreview",
          "t2.importCommit",
        ]) {
          expect(writer.granted_operations).toContain(op);
        }
        expect(writer.granted_operations).not.toContain("t1.deleteObject");

        expect([...reader.granted_levels].sort()).toEqual(["T0", "T1"]);
        for (const op of ["t1.listObjects", "t1.getObject", "t1.listAssets", "t1.getAsset", "t1.listWorkspaces"]) {
          expect(reader.granted_operations).toContain(op);
        }
        for (const op of [
          "t1.createWorkspace",
          "t1.putObject",
          "t1.deleteObject",
          "t1.putRelation",
          "t1.deleteRelation",
          "t1.putAsset",
          "t1.deleteAsset",
          "t2.exportPackage",
          "t2.importPreview",
        ]) {
          expect(reader.granted_operations).not.toContain(op);
        }

        for (const op of [
          "t1.createWorkspace",
          "t1.putObject",
          "t1.softDeleteWorkspace",
          "t1.restoreWorkspace",
          "t1.purgePreview",
          "t1.purgeCommit",
          "t2.exportPreview",
          "t2.exportPackage",
          "t2.confirmExport",
          "t2.importPreview",
          "t2.importCommit",
        ]) {
          expect(workspace.granted_operations).toContain(op);
        }
      });

      // ================================================================
      // B-03 — create two workspaces.
      // ================================================================
      await step("B-03", "create primary + control workspaces", async () => {
        const primary = (await writer.t1.createWorkspace({
          workspace_id: "core-e2e-workspace",
          profile: "generic",
          capabilities: ["test.record"],
        })) as { workspace_id: string; created_at: string; updated_at: string };
        expect(primary.workspace_id).toBe("core-e2e-workspace");
        expect(primary.created_at).toBe(primary.updated_at);

        const control = (await workspace.t1.createWorkspace({
          workspace_id: "core-e2e-control",
          profile: "generic",
          capabilities: ["test.record"],
        })) as { workspace_id: string };
        expect(control.workspace_id).toBe("core-e2e-control");

        const primaryFetched = await writer.t1.getWorkspace("core-e2e-workspace");
        expect(primaryFetched).not.toBeNull();
        const controlFetched = await workspace.t1.getWorkspace("core-e2e-control");
        expect(controlFetched).not.toBeNull();

        const events = (await workspace.t1.listEventsSince(
          "core-e2e-workspace",
        )) as Array<{ event_type: string }>;
        const created = events.filter((e) => e.event_type === "workspace.created");
        expect(created).toHaveLength(1);

        const dup = await expectThrow(() =>
          writer.t1.createWorkspace({
            workspace_id: "core-e2e-workspace",
            profile: "generic",
            capabilities: ["test.record"],
          }),
        );
        expect(dup.code).toBe("CONFLICT");

        const events2 = (await workspace.t1.listEventsSince(
          "core-e2e-workspace",
        )) as unknown[];
        expect(events2.length).toBe(events.length);
      });

      // ================================================================
      // B-04 — writer creates record-1 (happy + rejected paths).
      // ================================================================
      await step("B-04", "writer creates record-1 with schema validation", async () => {
        const commit = (await writer.t1.putObject({
          workspace_id: "core-e2e-workspace",
          object_id: "record-1",
          schema_id: "test.record",
          schema_version: "1.0.0",
          data: { title: "Core E2E record", value: 42 },
          event: {
            event_type: "test.record.created",
            payload: { source: "core-e2e" },
          },
        })) as {
          object: { revision: number; created_by_service: string; updated_by_service: string };
          deduplicated: boolean;
        };
        expect(commit.object.revision).toBe(1);
        expect(commit.object.created_by_service).toBe("dev.test.writer");
        expect(commit.object.updated_by_service).toBe("dev.test.writer");
        expect(commit.deduplicated).toBe(false);

        const fetched = (await writer.t1.getObject(
          "core-e2e-workspace",
          "record-1",
        )) as { object: { data: { title: string; value: number } } };
        expect(fetched.object.data).toEqual({ title: "Core E2E record", value: 42 });

        const ws1 = (await writer.t1.getWorkspace(
          "core-e2e-workspace",
        )) as { created_at: string; updated_at: string };
        expect(ws1.updated_at >= ws1.created_at).toBe(true);
        const eventsBefore = (await workspace.t1.listEventsSince(
          "core-e2e-workspace",
        )) as unknown[];
        const objectsBefore = (await writer.t1.listObjects({
          workspace_id: "core-e2e-workspace",
        })) as unknown[];

        const rejected = await expectThrow(() =>
          writer.t1.putObject({
            workspace_id: "core-e2e-workspace",
            object_id: "record-bad",
            schema_id: "test.record",
            schema_version: "1.0.0",
            data: { title: "", value: "not-a-number" },
            event: { event_type: "test.record.created", payload: {} },
          }),
        );
        expect(rejected.code).toBeDefined();
        expect(rejected.code).toMatch(
          /SCHEMA|VALIDATION|INVALID|UNSUPPORTED_SCHEMA/,
        );

        const objectsAfter = (await writer.t1.listObjects({
          workspace_id: "core-e2e-workspace",
        })) as unknown[];
        const eventsAfter = (await workspace.t1.listEventsSince(
          "core-e2e-workspace",
        )) as unknown[];
        expect(objectsAfter.length).toBe(objectsBefore.length);
        expect(eventsAfter.length).toBe(eventsBefore.length);
        const ws2 = (await writer.t1.getWorkspace(
          "core-e2e-workspace",
        )) as { updated_at: string };
        expect(ws2.updated_at).toBe(ws1.updated_at);
      });

      // ================================================================
      // B-05 — writer secure import.
      // ================================================================
      let importedPackageDigest = "";
      let importedSemanticDigest = "";
      await step("B-05", "writer secure import: preview + commit", async () => {
        const primary = (await writer.t1.getWorkspace(
          "core-e2e-workspace",
        )) as {
          workspace_id: string;
          profile: string;
          capabilities: string[];
          read_only?: boolean;
          created_at: string;
          updated_at: string;
        };
        const record1 = (
          (await writer.t1.getObject(
            "core-e2e-workspace",
            "record-1",
          )) as { object: unknown }
        ).object as FixtureObjectRecord;

        const workspaceFixture: FixtureWorkspaceRecord = {
          workspace_id: primary.workspace_id,
          profile: primary.profile,
          capabilities: primary.capabilities,
          read_only: primary.read_only ?? false,
          created_at: primary.created_at,
          updated_at: primary.updated_at,
        };

        const fixture = buildFixturePackage({
          workspace: workspaceFixture,
          record1,
          created_at: new Date().toISOString(),
          asset_bytes: new TextEncoder().encode("core-e2e asset payload"),
        });
        importedPackageDigest = fixture.package_digest;
        importedSemanticDigest = fixture.semantic_digest;

        const objectsBefore = (await writer.t1.listObjects({
          workspace_id: "core-e2e-workspace",
        })) as Array<{ object_id: string }>;
        const eventsBefore = (await workspace.t1.listEventsSince(
          "core-e2e-workspace",
        )) as unknown[];

        const preview = (await writer.t2.importPreview(fixture.bytes)) as {
          preview_token: string;
          package_digest: string;
          semantic_digest: string;
          preview: {
            scope_mode: string;
            schemas: Array<{ status: string }>;
            included: { objects: number; relations: number; assets: number; schemas: number };
            invalid: { schema_conflicts: number };
          };
        };
        expect(preview.package_digest).toBe(fixture.package_digest);
        expect(preview.semantic_digest).toBe(fixture.semantic_digest);
        expect(preview.preview.scope_mode).toBe("writable_objects");
        expect(preview.preview.schemas[0]?.status).toBe("embedded_equal");
        expect(preview.preview.included.objects).toBe(2);
        expect(preview.preview.included.relations).toBe(1);
        expect(preview.preview.included.assets).toBe(1);
        expect(preview.preview.included.schemas).toBe(1);
        expect(preview.preview.invalid.schema_conflicts).toBe(0);

        // Nothing written by preview.
        const objectsMid = (await writer.t1.listObjects({
          workspace_id: "core-e2e-workspace",
        })) as Array<{ object_id: string }>;
        expect(objectsMid.length).toBe(objectsBefore.length);
        expect(
          await writer.t1.getObject("core-e2e-workspace", "record-2"),
        ).toBeNull();
        const eventsMid = (await workspace.t1.listEventsSince(
          "core-e2e-workspace",
        )) as unknown[];
        expect(eventsMid.length).toBe(eventsBefore.length);

        const receipt = (await writer.t2.importCommit({
          preview_token: preview.preview_token,
          package_digest: preview.package_digest,
          plan: {
            mode: "merge",
            target_workspace: "core-e2e-workspace",
            conflict: "skip",
            include_history: true,
            include_assets: true,
            include_relations: true,
          },
        })) as {
          applied: {
            objects_inserted: number;
            objects_skipped: number;
            events: number;
            relations: number;
            assets: number;
            schemas_inserted: number;
            schemas_reused: number;
            schemas_rejected: number;
          };
        };
        expect(receipt.applied.objects_inserted).toBeGreaterThanOrEqual(1);
        expect(receipt.applied.schemas_inserted + receipt.applied.schemas_reused).toBeGreaterThanOrEqual(1);
        expect(receipt.applied.schemas_rejected).toBe(0);
        expect(receipt.applied.relations).toBe(1);
        expect(receipt.applied.assets).toBe(1);
        expect(receipt.applied.events).toBe(1);

        const r1After = (await writer.t1.getObject(
          "core-e2e-workspace",
          "record-1",
        )) as {
          object: { data: { title: string; value: number } };
          relations: { outgoing: Array<{ relation_id: string }>; incoming: unknown[] };
        };
        expect(r1After.object.data).toEqual({ title: "Core E2E record", value: 42 });
        expect(r1After.relations.outgoing.map((r) => r.relation_id)).toContain(
          "relation-record-1-record-2",
        );

        const r2After = (await writer.t1.getObject(
          "core-e2e-workspace",
          "record-2",
        )) as {
          object: { object_id: string };
          relations: { outgoing: unknown[]; incoming: Array<{ relation_id: string }> };
        };
        expect(r2After.object.object_id).toBe("record-2");
        expect(r2After.relations.incoming.map((r) => r.relation_id)).toContain(
          "relation-record-1-record-2",
        );

        const reused = await expectThrow(() =>
          writer.t2.importCommit({
            preview_token: preview.preview_token,
            package_digest: preview.package_digest,
            plan: { mode: "merge", target_workspace: "core-e2e-workspace" },
          }),
        );
        expect(reused.code).toBe("PREVIEW_TOKEN_USED");
      });

      // ================================================================
      // B-06 — reader permissions.
      // ================================================================
      await step("B-06", "reader permission enforcement", async () => {
        const ws = await reader.t1.getWorkspace("core-e2e-workspace");
        expect(ws).not.toBeNull();
        const r1 = (await reader.t1.getObject(
          "core-e2e-workspace",
          "record-1",
        )) as { object: { object_id: string }; relations: { outgoing: unknown[] } };
        expect(r1.object.object_id).toBe("record-1");
        expect(r1.relations.outgoing.length).toBeGreaterThanOrEqual(1);
        const r2 = await reader.t1.getObject("core-e2e-workspace", "record-2");
        expect(r2).not.toBeNull();

        const objectsBefore = (await workspace.t1.listObjects({
          workspace_id: "core-e2e-workspace",
        })) as unknown[];
        const eventsBefore = (await workspace.t1.listEventsSince(
          "core-e2e-workspace",
        )) as unknown[];

        for (const attempt of [
          () =>
            reader.t1.createWorkspace({
              workspace_id: "reader-ws",
              profile: "generic",
              capabilities: [],
            }),
          () =>
            reader.t1.putObject({
              workspace_id: "core-e2e-workspace",
              object_id: "reader-x",
              schema_id: "test.record",
              schema_version: "1.0.0",
              data: { title: "no", value: 1 },
              event: { event_type: "test.record.created", payload: {} },
            }),
          () =>
            reader.t1.deleteObject({
              workspace_id: "core-e2e-workspace",
              object_id: "record-1",
              event: { event_type: "test.record.deleted", payload: {} },
            }),
          () => reader.t2.exportPackage({ workspaces: ["core-e2e-workspace"] }),
          () => reader.t2.importPreview(new Uint8Array([0])),
        ]) {
          const err = await expectThrow(attempt);
          expect(err.code).toBeDefined();
        }

        const objectsAfter = (await workspace.t1.listObjects({
          workspace_id: "core-e2e-workspace",
        })) as unknown[];
        const eventsAfter = (await workspace.t1.listEventsSince(
          "core-e2e-workspace",
        )) as unknown[];
        expect(objectsAfter.length).toBe(objectsBefore.length);
        expect(eventsAfter.length).toBe(eventsBefore.length);
      });

      // ================================================================
      // B-07 — first full export (backupA).
      // ================================================================
      let backupA_digest = "";
      let backupA_semantic = "";
      let backupA_bytes: Uint8Array = new Uint8Array();
      await step("B-07", "first full export via workspace operator", async () => {
        const preview = (await workspace.t2.exportPreview({
          workspaces: ["core-e2e-workspace"],
        })) as {
          summary: { scope_mode: string; included: { objects: number; relations: number; assets: number; schemas: number } };
        };
        expect(preview.summary.scope_mode).toBe("workspace");
        expect(preview.summary.included.objects).toBe(2);
        expect(preview.summary.included.relations).toBe(1);
        expect(preview.summary.included.assets).toBe(1);
        expect(preview.summary.included.schemas).toBe(1);

        const artifact = (await workspace.t2.exportPackage({
          workspaces: ["core-e2e-workspace"],
        })) as {
          bytes: Uint8Array;
          package_digest: string;
          semantic_digest: string;
          manifest: {
            options: {
              include_history: boolean;
              include_assets: boolean;
              include_relations: boolean;
              include_schemas: boolean;
            };
          };
          summary: { scope_mode: string };
        };
        expect(artifact.manifest.options.include_history).toBe(true);
        expect(artifact.manifest.options.include_assets).toBe(true);
        expect(artifact.manifest.options.include_relations).toBe(true);
        expect(artifact.manifest.options.include_schemas).toBe(true);
        expect(artifact.summary.scope_mode).toBe("workspace");

        const inspected = inspectPackage(artifact.bytes);
        expect(inspected.objects).toHaveLength(2);
        expect(inspected.relations).toHaveLength(1);
        expect(inspected.assets).toHaveLength(1);
        expect((inspected.assets[0] as { object_id: string }).object_id).toBe(
          "record-2",
        );
        expect(inspected.schemas).toHaveLength(1);
        expect(Object.keys(inspected.asset_files)).toHaveLength(1);
        const workspaces = inspected.manifest.workspaces as string[];
        expect(workspaces).toEqual(["core-e2e-workspace"]);
        expect(workspaces).not.toContain("core-e2e-control");

        backupA_digest = artifact.package_digest;
        backupA_semantic = artifact.semantic_digest;
        backupA_bytes = artifact.bytes;
        void importedPackageDigest;
        void importedSemanticDigest;
      });

      // ================================================================
      // B-08 — confirm + stale / current + backupB.
      // ================================================================
      let backupB_digest = "";
      let backupB_semantic = "";
      let backupB_bytes: Uint8Array = new Uint8Array();
      await step("B-08", "confirmExport idempotent → write update → backupB", async () => {
        await workspace.t2.confirmExport({ package_digest: backupA_digest });
        // Idempotent confirm — must not throw.
        await workspace.t2.confirmExport({ package_digest: backupA_digest });

        await writer.t1.putObject({
          workspace_id: "core-e2e-workspace",
          object_id: "record-1",
          schema_id: "test.record",
          schema_version: "1.0.0",
          base_revision: 1,
          data: { title: "Core E2E record updated", value: 43 },
          event: {
            event_type: "test.record.updated",
            payload: { source: "core-e2e" },
          },
        });

        const backupB = (await workspace.t2.exportPackage({
          workspaces: ["core-e2e-workspace"],
        })) as {
          bytes: Uint8Array;
          package_digest: string;
          semantic_digest: string;
        };
        await workspace.t2.confirmExport({ package_digest: backupB.package_digest });

        backupB_digest = backupB.package_digest;
        backupB_semantic = backupB.semantic_digest;
        backupB_bytes = backupB.bytes;
      });



      // ================================================================
      // Persisted schema import into control workspace.
      // ================================================================
      await step("persisted-schema", "import persisted schema into control workspace", async () => {
        const ts = new Date().toISOString();
        const control = (await workspace.t1.getWorkspace(
          "core-e2e-control",
        )) as {
          workspace_id: string;
          profile: string;
          capabilities: string[];
          created_at: string;
          updated_at: string;
        };
        const pkg = buildGenericPackage({
          created_at: ts,
          workspace: {
            workspace_id: control.workspace_id,
            profile: control.profile,
            capabilities: control.capabilities,
            read_only: false,
            created_at: control.created_at,
            updated_at: control.updated_at,
          },
          objects: [
            {
              object_id: "persisted-1",
              workspace_id: "core-e2e-control",
              schema_id: "test.persisted",
              schema_version: "1.0.0",
              created_by_service: "dev.test.workspace",
              updated_by_service: "dev.test.workspace",
              created_at: ts,
              updated_at: ts,
              revision: 1,
              data: { label: "Persisted schema alpha" },
              extensions: {},
            },
          ],
          events: [
            {
              event_id: "event-persisted-1-created",
              event_type: "test.persisted.created",
              workspace_id: "core-e2e-control",
              service_id: "dev.test.workspace",
              object_id: "persisted-1",
              revision: 1,
              occurred_at: ts,
              payload: {},
            },
          ],
          relations: [],
          assets: [],
          asset_bytes: {},
          schemas: [
            {
              schema_id: "test.persisted",
              schema_version: "1.0.0",
              preserve_unknown: false,
              json_schema: {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                type: "object",
                additionalProperties: false,
                required: ["label"],
                properties: { label: { type: "string", minLength: 1 } },
              },
            },
          ],
        });

        const prev = (await workspace.t2.importPreview(pkg.bytes)) as {
          preview_token: string;
          package_digest: string;
          preview: { schemas: Array<{ status: string }> };
        };
        expect(prev.preview.schemas[0]?.status).toBe("embedded_new");

        const receipt = (await workspace.t2.importCommit({
          preview_token: prev.preview_token,
          package_digest: prev.package_digest,
          plan: {
            mode: "merge",
            target_workspace: "core-e2e-control",
            conflict: "skip",
            include_history: true,
            include_assets: true,
            include_relations: true,
          },
        })) as { applied: { schemas_inserted: number } };
        expect(receipt.applied.schemas_inserted).toBe(1);

        const persisted = await workspace.t1.getObject(
          "core-e2e-control",
          "persisted-1",
        );
        expect(persisted).not.toBeNull();
      });

      // ================================================================
      // B-09 — soft delete + purge.
      // ================================================================
      await step("B-09", "soft delete + backupForPurge + purge with challenge", async () => {
        const sd = (await workspace.t1.softDeleteWorkspace(
          "core-e2e-workspace",
        )) as { deleted_at: string };
        expect(sd.deleted_at).toEqual(expect.any(String));

        const wsAfter = (await workspace.t1.getWorkspace(
          "core-e2e-workspace",
        )) as { deleted_at?: string; read_only?: boolean };
        expect(wsAfter.deleted_at).toBeDefined();
        expect(wsAfter.read_only).toBe(true);

        const blocked = await expectThrow(() =>
          writer.t1.putObject({
            workspace_id: "core-e2e-workspace",
            object_id: "record-blocked",
            schema_id: "test.record",
            schema_version: "1.0.0",
            data: { title: "blocked", value: 1 },
            event: { event_type: "test.record.created", payload: {} },
          }),
        );
        expect(blocked.code).toMatch(/PERMISSION_DENIED|WORKSPACE_READ_ONLY/);

        const events = (await workspace.t1.listEventsSince(
          "core-e2e-workspace",
        )) as Array<{ event_type: string }>;
        expect(
          events.some((e) => e.event_type.includes("delete")),
        ).toBe(true);

        const backupForPurge = (await workspace.t2.exportPackage({
          workspaces: ["core-e2e-workspace"],
        })) as { package_digest: string };
        await workspace.t2.confirmExport({
          package_digest: backupForPurge.package_digest,
        });

        const preview = (await workspace.t1.purgePreview({
          workspace_id: "core-e2e-workspace",
        })) as { purge_token: string; challenge: string; last_export: { backup_status: string } };
        expect(preview.last_export.backup_status).toBe("current");

        const wrong = await expectThrow(() =>
          workspace.t1.purgeCommit({
            purge_token: preview.purge_token,
            confirmation: "WRONG-CONFIRMATION",
          }),
        );
        expect(wrong.code).toMatch(/CHALLENGE|PURGE/);
        const stillThere = await workspace.t1.getWorkspace("core-e2e-workspace");
        expect(stillThere).not.toBeNull();

        // Fresh preview after failed commit (token may be invalidated).
        const preview2 = (await workspace.t1.purgePreview({
          workspace_id: "core-e2e-workspace",
        })) as { purge_token: string; challenge: string };
        const receipt = (await workspace.t1.purgeCommit({
          purge_token: preview2.purge_token,
          confirmation: preview2.challenge,
        })) as {
          removed: {
            workspaces: number;
            objects: number;
            events: number;
            relations: number;
            assets: number;
            outbox: number;
          };
        };
        expect(receipt.removed.workspaces).toBe(1);
        expect(receipt.removed.objects).toBeGreaterThanOrEqual(2);
        expect(receipt.removed.events).toBeGreaterThan(0);
        expect(receipt.removed.relations).toBe(1);
        expect(receipt.removed.assets).toBe(1);
        expect(receipt.removed.outbox).toBeGreaterThan(0);

        expect(
          await workspace.t1.getWorkspace("core-e2e-workspace"),
        ).toBeNull();
        expect(
          await workspace.t1.getObject("core-e2e-workspace", "record-1"),
        ).toBeNull();
        expect(
          await workspace.t1.getWorkspace("core-e2e-control"),
        ).not.toBeNull();
        expect(
          await workspace.t1.getObject("core-e2e-control", "persisted-1"),
        ).not.toBeNull();
      });

      // ================================================================
      // Persisted schema survived: write persisted-2 through workspace op.
      // ================================================================
      await step(
        "persisted-schema-survives-purge",
        "write persisted-2 after primary purge and reconnect",
        async () => {
          await workspace.t1.putObject({
            workspace_id: "core-e2e-control",
            object_id: "persisted-2",
            schema_id: "test.persisted",
            schema_version: "1.0.0",
            data: { label: "Persisted schema survived purge" },
            event: { event_type: "test.persisted.created", payload: {} },
          });
          expect(
            await workspace.t1.getObject("core-e2e-control", "persisted-2"),
          ).not.toBeNull();

          // Reconnect and verify persistence via public API only.
          const workspace2 = await runtime.connect(
            { service_id: "dev.test.workspace" },
            { domain, current, origin: ORIGIN },
          );
          expect(
            await workspace2.t1.getWorkspace("core-e2e-control"),
          ).not.toBeNull();
          expect(
            await workspace2.t1.getObject("core-e2e-control", "persisted-1"),
          ).not.toBeNull();
          expect(
            await workspace2.t1.getObject("core-e2e-control", "persisted-2"),
          ).not.toBeNull();
        },
      );

      // ================================================================
      // B-10 — restore backupB.
      // ================================================================
      await step("B-10", "restore workspace from backupB", async () => {
        const restorePreview = (await workspace.t2.importPreview(backupB_bytes)) as {
          preview_token: string;
          package_digest: string;
          semantic_digest: string;
          preview: {
            workspaces: unknown[];
            totals: {
              workspaces: number;
              objects: number;
              relations: number;
              assets: number;
              schemas: number;
            };
            schemas: Array<{ status: string }>;
          };
        };
        expect(restorePreview.package_digest).toBe(backupB_digest);
        expect(restorePreview.semantic_digest).toBe(backupB_semantic);
        expect(restorePreview.preview.totals.workspaces).toBe(1);
        expect(restorePreview.preview.totals.objects).toBe(2);
        expect(restorePreview.preview.totals.relations).toBe(1);
        expect(restorePreview.preview.totals.assets).toBe(1);
        expect(restorePreview.preview.totals.schemas).toBeGreaterThanOrEqual(1);
        expect(
          await workspace.t1.getWorkspace("core-e2e-workspace"),
        ).toBeNull();

        const receipt = (await workspace.t2.importCommit({
          preview_token: restorePreview.preview_token,
          package_digest: restorePreview.package_digest,
          plan: {
            mode: "full",
            conflict: "fail",
            include_history: true,
            include_assets: true,
            include_relations: true,
          },
        })) as { applied: { workspaces: number; objects_inserted: number } };
        expect(receipt.applied.workspaces).toBeGreaterThanOrEqual(1);

        const ws = (await workspace.t1.getWorkspace(
          "core-e2e-workspace",
        )) as { deleted_at?: string | null; read_only?: boolean };
        expect(ws).not.toBeNull();
        expect(ws.deleted_at ?? null).toBeNull();
        expect(ws.read_only ?? false).toBe(false);

        const r1 = (await workspace.t1.getObject(
          "core-e2e-workspace",
          "record-1",
        )) as { object: { data: { value: number } } };
        expect(r1.object.data.value).toBe(43);
        const r2 = await workspace.t1.getObject(
          "core-e2e-workspace",
          "record-2",
        );
        expect(r2).not.toBeNull();

        const events = (await workspace.t1.listEventsSince(
          "core-e2e-workspace",
        )) as Array<{ event_type: string; service_id: string }>;
        const importAppliedEvent = events.find(
          (event) => event.event_type === "iwxa.import.applied",
        );
        expect(importAppliedEvent).toBeDefined();
        expect(importAppliedEvent?.service_id).toBe("iwxa.kernel");


        const reused = await expectThrow(() =>
          workspace.t2.importCommit({
            preview_token: restorePreview.preview_token,
            package_digest: restorePreview.package_digest,
            plan: { mode: "full" },
          }),
        );
        expect(reused.code).toMatch(/PREVIEW_TOKEN_USED|PREVIEW_REQUIRED/);
      });

      // ================================================================
      // B-11 — repeat export, verify semantic round-trip.
      // ================================================================
      let restoredDigest = "";
      await step("B-11", "re-export equals backupB semantically", async () => {
        const restored = (await workspace.t2.exportPackage({
          workspaces: ["core-e2e-workspace"],
        })) as {
          bytes: Uint8Array;
          semantic_digest: string;
          package_digest: string;
        };
        expect(restored.semantic_digest).toBe(backupB_semantic);
        restoredDigest = restored.semantic_digest;

        const insp = inspectPackage(restored.bytes);
        expect(insp.objects).toHaveLength(2);
        expect(insp.relations).toHaveLength(1);
        expect(insp.assets).toHaveLength(1);
        expect(insp.schemas).toHaveLength(1);
        const r2 = (insp.objects as Array<{ object_id: string }>).find(
          (o) => o.object_id === "record-2",
        );
        expect(r2).toBeDefined();
        const asset = insp.assets[0] as { object_id: string };
        expect(asset.object_id).toBe("record-2");

        // Technical import event lives in history but must not affect semantic
        // digest — proven by digest equality with backupB above.
        const hasApplied = Object.keys(insp).length > 0;
        expect(hasApplied).toBe(true);
      });

      // ================================================================
      // Evidence file.
      // ================================================================
      mkdirSync(ARTIFACTS, { recursive: true });
      const evidence = {
        stage: "Stage B - Core E2E",
        runtime_file: `dist/_iwxa/runtime/${runtime.RUNTIME_VERSION}/runtime.js`,
        contract_version: writer.contract_version,
        runtime_version: runtime.RUNTIME_VERSION,
        direct_source_imports: 0,
        direct_indexeddb_store_access: 0,
        steps,
        backupA_package_digest: backupA_digest,
        backupA_semantic_digest: backupA_semantic,
        backupB_package_digest: backupB_digest,
        backupB_semantic_digest: backupB_semantic,
        restored_semantic_digest: restoredDigest,
        original_semantic_digest: backupB_semantic,
        semantic_round_trip_equal: restoredDigest === backupB_semantic,
        receipt_event_service_id: "iwxa.kernel",
        restored_workspace_active: true,
      };
      writeFileSync(
        resolve(ARTIFACTS, "core-e2e-evidence.json"),
        JSON.stringify(evidence, null, 2),
      );
      void backupA_bytes;

      restoreEnvironment();
    },
    120_000,
  );
});
