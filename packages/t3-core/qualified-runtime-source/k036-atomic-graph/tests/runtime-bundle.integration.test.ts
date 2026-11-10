/**
 * Runtime bundle integration test.
 *
 * IMPORTANT: this test imports the ACTUAL bundled Runtime file that the
 * loader would fetch in production:
 *
 *   dist/_iwxa/runtime/v1/runtime.js
 *
 * It does NOT import src/runtime/public-api.ts. If build-runtime.mjs is
 * broken or drifts from src/runtime/, this test fails.
 *
 * Full round-trip covered:
 *   1. connect() with a valid domain + passport
 *   2. t1.createWorkspace
 *   3. t1.putObject / t1.getObject
 *   4. t1.listEventsSince
 *   5. t2.exportPreview + t2.exportPackage
 *   6. soft-delete + purgeAfterExport (via t1.deleteObject + local reset)
 *   7. t2.importPreview + t2.importCommit
 *   8. verify state is byte-for-byte restored
 */

import "fake-indexeddb/auto";
import FDBFactory from "fake-indexeddb/lib/FDBFactory";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it, vi } from "vitest";

// --- polyfill navigator.locks (kernel refuses bulk ops without it) --------
{
  const held = new Set<string>();
  const locks = {
    async request(
      name: string,
      _opts: unknown,
      cb: (lock: unknown) => Promise<unknown>,
    ) {
      while (held.has(name)) await new Promise((r) => setTimeout(r, 0));
      held.add(name);
      try {
        return await cb({ name });
      } finally {
        held.delete(name);
      }
    },
  };
  const g = globalThis as { navigator?: { locks?: unknown } };
  if (!g.navigator) {
    Object.defineProperty(globalThis, "navigator", {
      value: { locks },
      configurable: true,
      writable: true,
    });
  } else if (!g.navigator.locks) {
    try {
      (g.navigator as { locks?: unknown }).locks = locks;
    } catch {
      Object.defineProperty(g.navigator, "locks", { value: locks, configurable: true });
    }
  }
}

// --- passport + domain fixtures (snake_case, canonical) --------------------

const SERVICE_ID = "ru.iwxa.learn.career";
const BASE_PATH = "/career/";

const passport = {
  service_id: SERVICE_ID,
  service_version: "1.0.0",
  base_path: BASE_PATH,
  supported_levels: ["T0", "T1", "T2"],
  input_object_types: ["career.role"],
  output_object_types: ["career.role"],
  schemas: { "career.role": { schema_version: "1.0.0", preserve_unknown: true, json_schema: { type: "object" }, embedded: {} } },
  permissions: {
    workspace: { list: true, read: true, create: true, soft_delete: true, restore: false, purge: true },
    objects: {
      read: ["career.role"],
      write: ["career.role"],
      delete: ["career.role"],
    },
    events: { read_scope: "workspace" },
    packages: { export: true, import: true, export_scope: "readable_objects", import_scope: "writable_objects" },
  },
};

// Canonical FULL domain.json — every field required by
// validateDomainConfig() (config_schema_version 1.0.0). The Runtime
// bundle refuses to grant a client for anything less.
const KERNEL_VERSION = (JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as { version: string }).version;

const ORIGIN = "https://learn.iwxa.ru";
const domain = {
  config_schema_version: "1.0.0",
  config_version: "1.1.0",
  status: "active",
  domain_id: "learn.iwxa.ru",
  origin: ORIGIN,
  local_store_name: "iwxa-local",
  workspace_profile: "learning",
  brand: { name: "IWXA Learn" },
  runtime: { engine: "iwxa-kernel" },
  modules: [{ service_id: SERVICE_ID, base_path: BASE_PATH }],
  enabled_profiles: ["production"],
  enabled_capabilities: ["T0", "T1", "T2"],
  handoff: {
    enabled: false,
    receive_path: "/iwxa/handoff/receive",
    allowed_origins: [],
    require_preview: true,
    default_expiry_seconds: 3600,
  },
  service_worker: { mode: "disabled", future_path: "/iwxa-sw.js", future_scope: "/" },
  diagnostics: { enabled: true },
  security: {},
  release: {},
};
const current = {
  runtime_version: KERNEL_VERSION,
  runtime_url: `/_iwxa/runtime/${KERNEL_VERSION}/runtime.js`,
  contract_version: "1.2.0",
  min_loader: 1,
  status: "active" as const,
};

// --- mock global fetch so defaultLoadPassport() sees our passport ---------

const capabilityControlPlane = {
  schema_version: "0.3.1",
  snapshot_id: "test-runtime-bundle",
  resolver_id: "iwxa.test.control-plane",
  trusted_issuers: [],
  issuance_policies: [],
  services: [{
    schema_version: "0.3.1", service_id: SERVICE_ID, capability_control: "NONE",
    capability_ceiling: [], activation_any_of: [], operation_guards: [],
  }],
};

globalThis.fetch = vi.fn(async (url: string | URL) => {
  const u = String(url);
  if (u.endsWith("/_iwxa/security/capability-control-plane.json")) {
    return new Response(JSON.stringify(capabilityControlPlane), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.endsWith(`/_iwxa/services/${SERVICE_ID}.json`)) {
    return new Response(JSON.stringify(passport), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(null, { status: 404 });
}) as unknown as typeof fetch;

// --- resolve & import the BUILT bundle -------------------------------------

const BUNDLE = resolve(process.cwd(), "dist", "_iwxa", "runtime", KERNEL_VERSION, "runtime.js");

type BuiltRuntime = {
  connect: (req: unknown, ctx: unknown) => Promise<{
    contract_version: string;
    runtime_version: string;
    mode: string;
    granted_levels: string[];
    granted_operations: string[];
    service: { service_id: string; base_path: string; service_version: string };
    authorization: { forWorkspace: (workspace_id: string) => Promise<unknown>; hasCapability: (workspace_id: string, capability_id: string) => Promise<boolean> };
    t0: { validate: (input: unknown) => Promise<unknown> };
    t1: Record<string, (...args: unknown[]) => Promise<unknown>>;
    t2: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }>;
  RUNTIME_VERSION: string;
  __resetKernelStoreForTests: () => void;
};


let runtime: BuiltRuntime;

beforeAll(async () => {
  // Always rebuild — the whole point is to exercise the CURRENT source.
  execSync("node scripts/build-runtime.mjs", { stdio: "inherit" });
  if (!existsSync(BUNDLE)) throw new Error("build-runtime.mjs did not emit " + BUNDLE);
  const st = statSync(BUNDLE);
  if (st.size < 5_000) {
    throw new Error(
      `Runtime bundle at ${BUNDLE} is suspiciously small (${st.size} bytes) — build likely failed.`,
    );
  }
  runtime = (await import(pathToFileURL(BUNDLE).href)) as BuiltRuntime;
  expect(typeof runtime.connect).toBe("function");
  expect(runtime.RUNTIME_VERSION).toBe(KERNEL_VERSION);
});

describe("built runtime — canonical public contract", () => {
  it("returns the exact canonical top-level shape and no leaked IDB", async () => {
    const client = await runtime.connect(
      { service_id: SERVICE_ID },
      { domain, current, origin: ORIGIN },
    );
    expect(Object.keys(client).sort()).toEqual(
      [
        "authorization",
        "contract_version",
        "granted_levels",
        "granted_operations",
        "mode",
        "runtime_version",
        "service",
        "t0",
        "t1",
        "t2",
      ].sort(),
    );
    expect(client.contract_version).toBe("1.3.0");
    expect(client.runtime_version).toBe(KERNEL_VERSION);
    expect(client.service).toEqual({
      service_id: SERVICE_ID,
      base_path: BASE_PATH,
      service_version: "1.0.0",
    });
    expect(client.granted_levels).toEqual(["T0", "T1", "T2"]);
    expect(client.granted_operations).toEqual(
      expect.arrayContaining([
        "t0.validate",
        "t1.listWorkspaces",
        "t1.putObject",
        "t1.deleteObject",
        "t2.exportPackage",
        "t2.importCommit",
      ]),
    );
    // t0/t1/t2 are plain method objects, NOT callable.
    expect(typeof client.t0).toBe("object");
    expect(typeof client.t1).toBe("object");
    expect(typeof client.t2).toBe("object");
    expect(typeof client.t0.validate).toBe("function");
    for (const m of [
      "listWorkspaces",
      "getWorkspace",
      "createWorkspace",
      "listObjects",
      "getObject",
      "putObject",
      "deleteObject",
      "putRelation",
      "deleteRelation",
      "listAssets",
      "getAsset",
      "putAsset",
      "deleteAsset",
      "listEventsSince",
    ])
      expect(typeof client.t1[m]).toBe("function");
    for (const m of ["exportPreview", "exportPackage", "importPreview", "importCommit", "importCancel"])
      expect(typeof client.t2[m]).toBe("function");
  });

  it("T0 works even when IndexedDB is missing (structured payload check)", async () => {
    const g = globalThis as { indexedDB?: unknown };
    const saved = g.indexedDB;
    const client = await runtime.connect(
      { service_id: SERVICE_ID },
      { domain, current, origin: ORIGIN },
    );
    try {
      delete g.indexedDB;
      const okObject = await client.t0.validate({
        objects: [
          {
            object_id: "r-1",
            workspace_id: "ws-1",
            schema_id: "career.role",
            schema_version: "1.0.0",
            created_by_service: SERVICE_ID,
            updated_by_service: SERVICE_ID,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            revision: 1,
            data: { title: "Dev" },
            extensions: {},
          },
        ],
      });
      expect(okObject).toMatchObject({
        tier: "t0",
        service_id: SERVICE_ID,
        ok: true,
      });
      expect(Array.isArray((okObject as { objects?: unknown[] }).objects)).toBe(true);
      await expect(client.t0.validate({ objects: [{ schema_id: "foreign.type" }] })).rejects.toMatchObject({
        code: "PASSPORT_INVALID",
      });
      await expect(client.t1.listWorkspaces()).rejects.toMatchObject({
        code: "KERNEL_UNAVAILABLE",
      });
    } finally {
      g.indexedDB = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// The main round-trip.

describe("built runtime — full round-trip (create → put → export → wipe → import → verify)", () => {
  it("preserves state byte-for-byte across export & re-import", async () => {
    // Fresh IDB for this test so no cross-test bleed.
    (globalThis as { indexedDB: unknown }).indexedDB = new FDBFactory() as unknown as IDBFactory;
    runtime.__resetKernelStoreForTests();

    const client = await runtime.connect(
      { service_id: SERVICE_ID },
      { domain, current, origin: ORIGIN },
    );
    expect(client.mode).toBe("full");


    // --- 1. createWorkspace ------------------------------------------------
    const ws = (await client.t1.createWorkspace({
      workspace_id: "ws-career-1",
      profile: "personal",
      capabilities: ["career.read", "career.write"],
    })) as { workspace_id: string; profile: string };
    expect(ws.workspace_id).toBe("ws-career-1");

    // --- 2. putObject (canonical: object_id + schema_version) --------------
    const put = (await client.t1.putObject({
      workspace_id: "ws-career-1",
      object_id: "role-42",
      schema_id: "career.role",
      schema_version: "1.0.0",
      data: { title: "Staff Engineer", org: "IWXA", started_at: "2024-01-01" },
      event: { event_type: "career.role.created", payload: { object_id: "role-42" } },
    })) as { object: { object_id: string; revision: number }; event: { event_id: string } };
    expect(put.object.object_id).toBe("role-42");
    expect(put.object.revision).toBe(1);

    await client.t1.putObject({
      workspace_id: "ws-career-1",
      object_id: "role-43",
      schema_id: "career.role",
      schema_version: "1.0.0",
      data: { title: "Principal Engineer", org: "IWXA", started_at: "2025-01-01" },
      event: { event_type: "career.role.created", payload: { object_id: "role-43" } },
    });

    await client.t1.putRelation({
      workspace_id: "ws-career-1",
      relation_id: "rel-role-42-43",
      from_object_id: "role-42",
      to_object_id: "role-43",
      kind: "related-role",
      event: { event_type: "relation.created", idempotency_key: "rel-role-42-43:create" },
    });

    await client.t1.putAsset({
      workspace_id: "ws-career-1",
      asset_id: "asset-role-42",
      object_id: "role-42",
      mime: "image/png",
      bytes: new Uint8Array([1, 2, 3, 4]),
      base_revision: 0,
      event: { event_type: "asset.created", idempotency_key: "asset-role-42:create" },
    });

    // --- 3. getObject / listObjects + relation/asset read -----------------
    const got = (await client.t1.getObject("ws-career-1", "role-42")) as {
      object: { data: { title: string } };
    };
    expect(got.object.data.title).toBe("Staff Engineer");

    const listed = (await client.t1.listObjects({
      workspace_id: "ws-career-1",
      schema_id: "career.role",
    })) as unknown[];
    expect(listed).toHaveLength(2);
    expect((await client.t1.getObject("ws-career-1", "role-42") as { relations: { outgoing: Array<{ relation_id: string }> } }).relations.outgoing.map((r) => r.relation_id)).toContain("rel-role-42-43");
    expect(Array.from((await client.t1.getAsset("ws-career-1", "asset-role-42") as { bytes: Uint8Array }).bytes)).toEqual([1, 2, 3, 4]);

    // --- 4. listEventsSince ------------------------------------------------
    const events = (await client.t1.listEventsSince("ws-career-1", "")) as unknown[];
    expect(events.length).toBeGreaterThanOrEqual(1);

    // --- 5. t2.exportPreview + t2.exportPackage ---------------------------
    const preview = (await client.t2.exportPreview({
      workspaces: ["ws-career-1"],
    })) as { counts: { workspaces: number; objects: number } };
    expect(preview.counts.workspaces).toBe(1);
    expect(preview.counts.objects).toBe(2);

    const artifact = (await client.t2.exportPackage({
      workspaces: ["ws-career-1"],
    })) as { bytes: Uint8Array; manifest: { semantic_digest: string; package_digest: string } };
    expect(artifact.bytes).toBeInstanceOf(Uint8Array);
    expect(artifact.bytes.byteLength).toBeGreaterThan(0);
    const originalSemantic = artifact.manifest.semantic_digest;
    expect(originalSemantic).toMatch(/^[a-f0-9]{64}$/);

    // --- 6. wipe local kernel (simulate uninstall / fresh browser) --------
    (globalThis as { indexedDB: unknown }).indexedDB = new FDBFactory() as unknown as IDBFactory;
    runtime.__resetKernelStoreForTests();
    const client2 = await runtime.connect(
      { service_id: SERVICE_ID },
      { domain, current, origin: ORIGIN },
    );

    // Sanity: the new store is empty.
    const empty = (await client2.t1.listWorkspaces()) as unknown[];
    expect(empty).toEqual([]);

    // --- 7. importPreview + importCommit (token flow) ---------------------
    const impPreview = (await client2.t2.importPreview(artifact.bytes)) as {
      preview_token: string;
      package_digest: string;
      semantic_digest: string;
      expires_at: string;
      allowed_modes: string[];
      preview: { totals: { objects: number; workspaces: number } };
    };
    expect(impPreview.preview.totals.workspaces).toBe(1);
    expect(impPreview.preview.totals.objects).toBe(2);
    expect(impPreview.semantic_digest).toBe(originalSemantic);
    expect(impPreview.preview_token).toMatch(/^[a-f0-9]{32}$/);
    expect(impPreview.allowed_modes).toEqual(
      expect.arrayContaining(["full", "selective", "cancel"]),
    );

    const receipt = (await client2.t2.importCommit({
      preview_token: impPreview.preview_token,
      package_digest: impPreview.package_digest,
      plan: { mode: "full" },
    })) as {
      applied: { workspaces: number; objects_inserted: number };
      semantic_digest: string;
    };
    expect(receipt.applied.workspaces).toBe(1);
    expect(receipt.applied.objects_inserted).toBe(2);
    expect(receipt.semantic_digest).toBe(originalSemantic);

    // --- 8. verify full restoration ---------------------------------------
    const restored = (await client2.t1.getObject("ws-career-1", "role-42")) as {
      object: { data: { title: string; org: string } };
    };
    expect(restored.object.data).toEqual({
      title: "Staff Engineer",
      org: "IWXA",
      started_at: "2024-01-01",
    });
    const restoredWithRelations = (await client2.t1.getObject("ws-career-1", "role-42")) as {
      relations: { outgoing: Array<{ relation_id: string }> };
    };
    expect(restoredWithRelations.relations.outgoing.map((r) => r.relation_id)).toContain("rel-role-42-43");
    const restoredAsset = (await client2.t1.getAsset("ws-career-1", "asset-role-42")) as { bytes: Uint8Array };
    expect(Array.from(restoredAsset.bytes)).toEqual([1, 2, 3, 4]);

    // Full round-trip: re-exporting the imported workspace with the same
    // parameters must reproduce the original semantic_digest. The
    // technical `iwxa.import.applied` event is excluded by the canonical
    // semantic algorithm, not removed from the store — so it must still
    // be present in history even though the digest matches.
    const listedEvents = (await client2.t1.listEventsSince(
      "ws-career-1",
    )) as Array<{ event_type: string }>;
    expect(
      listedEvents.some((e) => e.event_type === "iwxa.import.applied"),
    ).toBe(true);

    const restoredArtifact = (await client2.t2.exportPackage({
      workspaces: ["ws-career-1"],
    })) as { manifest: { semantic_digest: string } };
    expect(restoredArtifact.manifest.semantic_digest).toBe(originalSemantic);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Defence-in-depth: the built runtime must refuse to grant a client when
// the domain object handed to `connect()` is not a fully-valid, current-
// origin-matching, secret-free 1.0.0 DomainConfig. These are exercised
// against the ACTUAL bundle (not the TS source).

describe("built runtime — refuses to bring up on invalid domain / origin / secrets", () => {
  it("rejects a domain missing config_schema_version with CONFIG_INVALID", async () => {
    const bad = { ...domain } as Record<string, unknown>;
    delete bad.config_schema_version;
    await expect(
      runtime.connect({ service_id: SERVICE_ID }, { domain: bad, current, origin: ORIGIN }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("rejects an unknown top-level field with CONFIG_INVALID", async () => {
    const bad = { ...domain, sneaky_field: 1 } as Record<string, unknown>;
    await expect(
      runtime.connect({ service_id: SERVICE_ID }, { domain: bad, current, origin: ORIGIN }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("rejects an origin mismatch with ORIGIN_MISMATCH (does NOT open IDB)", async () => {
    await expect(
      runtime.connect(
        { service_id: SERVICE_ID },
        { domain, current, origin: "https://attacker.example" },
      ),
    ).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });
  });

  it("rejects a missing origin under strict_origin with ORIGIN_MISMATCH", async () => {
    await expect(
      runtime.connect({ service_id: SERVICE_ID }, { domain, current }),
    ).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });
  });

  it("rejects a secret-like key anywhere in the tree with SECRET_FIELD_FORBIDDEN", async () => {
    const bad = {
      ...domain,
      security: { ...domain.security, api_key: "leak-me" },
    } as Record<string, unknown>;
    await expect(
      runtime.connect({ service_id: SERVICE_ID }, { domain: bad, current, origin: ORIGIN }),
    ).rejects.toMatchObject({ code: "SECRET_FIELD_FORBIDDEN" });
  });

  it("rejects service_worker.mode != 'disabled' with CONFIG_INVALID", async () => {
    const bad = {
      ...domain,
      service_worker: { ...domain.service_worker, mode: "enabled" },
    } as Record<string, unknown>;
    await expect(
      runtime.connect({ service_id: SERVICE_ID }, { domain: bad, current, origin: ORIGIN }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("rejects local_store_name != 'iwxa-local' with CONFIG_INVALID", async () => {
    const bad = { ...domain, local_store_name: "custom" } as Record<string, unknown>;
    await expect(
      runtime.connect({ service_id: SERVICE_ID }, { domain: bad, current, origin: ORIGIN }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("rejects an unsupported config_schema_version with UPDATE_REQUIRED", async () => {
    const bad = { ...domain, config_schema_version: "9.9.9" } as Record<string, unknown>;
    await expect(
      runtime.connect({ service_id: SERVICE_ID }, { domain: bad, current, origin: ORIGIN }),
    ).rejects.toMatchObject({ code: "UPDATE_REQUIRED" });
  });
});



