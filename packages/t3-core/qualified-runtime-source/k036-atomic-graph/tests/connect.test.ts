import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createConnect,
  ConnectError,
  isValidServiceId,
  type ServicePassport,
  type DomainLike,
  type CurrentLike,
} from "../src/runtime/public-api";
import { makeTestTierHandlers } from "./helpers/test-tier-handlers";

// ---------------------------------------------------------------------------
// Canonical domain and passport fixtures — snake_case, no serviceId anywhere.
// ---------------------------------------------------------------------------

const domain: DomainLike = {
  domain_id: "learn.iwxa.ru",
  modules: [
    { service_id: "ru.iwxa.learn.career", base_path: "/career/" },
    { service_id: "ru.iwxa.learn.study", base_path: "/study/" },
  ],
  enabled_capabilities: ["T0", "T1", "T2"],
};
const current: CurrentLike = {
  runtime_version: "0.1.0",
  runtime_url: "/_iwxa/runtime/0.1.0/runtime.js",
  contract_version: "1.2.0",
  min_loader: 1,
  status: "active",
};

const FULL_PERMISSIONS = {
  workspace: { list: true, read: true, create: true, soft_delete: true, restore: false, purge: true },
  objects: { read: ["career.role"], write: ["career.role"], delete: ["career.role"] },
  events: { read_scope: "workspace" as const },
  packages: { export: true, import: true, export_scope: "readable_objects", import_scope: "writable_objects" },
};
const T0_ONLY_PERMISSIONS = {
  workspace: { list: false, read: false, create: false, soft_delete: false, restore: false, purge: false },
  objects: { read: [], write: [], delete: [] },
  events: { read_scope: "service" as const },
  packages: { export: false, import: false, export_scope: "readable_objects", import_scope: "writable_objects" },
};

const careerPassport: ServicePassport = {
  service_id: "ru.iwxa.learn.career",
  service_version: "1.0.0",
  base_path: "/career/",
  supported_levels: ["T0", "T1", "T2"],
  input_object_types: ["career.role"],
  output_object_types: ["career.role"],
  schemas: { "career.role": { schema_version: "1.0.0", preserve_unknown: true, json_schema: { type: "object" }, embedded: {} } },
  permissions: FULL_PERMISSIONS,
};

const coursesPassport: ServicePassport = {
  service_id: "ru.iwxa.learn.study",
  service_version: "0.9.0",
  base_path: "/study/",
  supported_levels: ["T0"],
  input_object_types: [],
  output_object_types: ["courses.course"],
  schemas: { "courses.course": { schema_version: "1.0.0", preserve_unknown: true, json_schema: { type: "object" }, embedded: {} } },
  permissions: T0_ONLY_PERMISSIONS,
};

const origin = "https://learn.iwxa.ru";
const baselinePassports: Record<string, ServicePassport> = {
  "ru.iwxa.learn.career": careerPassport,
  "ru.iwxa.learn.study": coursesPassport,
};

function makeConnect(overrides: Record<string, ServicePassport> = {}) {
  const passports = { ...baselinePassports, ...overrides };
  return createConnect({
    loadPassport: async (id) => passports[id] ?? null,
    makeTierHandlers: makeTestTierHandlers,
  });
}

// ---------------------------------------------------------------------------
// Positive path — real module registration.
// ---------------------------------------------------------------------------

describe("connect() — real module (ru.iwxa.learn.career → /career/)", () => {
  const connect = makeConnect({
    "ru.iwxa.learn.career": careerPassport,
    "ru.iwxa.learn.study": coursesPassport,
  });

  it("resolves the module and returns a sealed client with the canonical contract", async () => {
    const client = await connect(
      { service_id: "ru.iwxa.learn.career" },
      { domain, current, origin },
    );
    expect(client.contract_version).toBe("1.3.0");
    expect(client.runtime_version).toBe("0.1.0");
    expect(client.mode).toBe("full");
    expect(client.granted_levels).toEqual(["T0", "T1", "T2"]);
    expect(client.service).toEqual({
      service_id: "ru.iwxa.learn.career",
      base_path: "/career/",
      service_version: "1.0.0",
    });
    expect(client.granted_operations).toEqual(
      expect.arrayContaining([
        "t0.validate",
        "t1.listWorkspaces",
        "t1.putObject",
        "t1.deleteObject",
        "t1.putRelation",
        "t1.deleteRelation",
        "t1.listAssets",
        "t1.getAsset",
        "t1.putAsset",
        "t1.deleteAsset",
        "t2.exportPackage",
        "t2.importCommit",
      ]),
    );
    expect(typeof client.t0.validate).toBe("function");
    expect(typeof client.t1.putObject).toBe("function");
    expect(typeof client.t2.exportPackage).toBe("function");
  });

  it("never exposes IDBDatabase or raw db handles", async () => {
    const client = await connect(
      { service_id: "ru.iwxa.learn.career" },
      { domain, current, origin },
    );
    for (const k of Object.keys(client)) {
      const low = k.toLowerCase();
      expect(low).not.toContain("idb");
      expect(low).not.toContain("indexeddb");
      expect(low).not.toContain("localstore");
    }
  });

  it("second module (courses, T0 only) also connects and reports T0 only", async () => {
    const c = await connect(
      { service_id: "ru.iwxa.learn.study" },
      { domain, current, origin },
    );
    expect(c.granted_levels).toEqual(["T0"]);
    expect(c.service.base_path).toBe("/study/");
    expect(c.granted_operations).toEqual(["t0.validate"]);
  });

  it("passes required_levels when they are a subset of granted levels", async () => {
    const c = await connect(
      { service_id: "ru.iwxa.learn.career", required_levels: ["T0", "T1"] },
      { domain, current, origin },
    );
    expect(c.granted_levels).toEqual(["T0", "T1", "T2"]);
  });

  it("modes: read-only disables t1 writes; emergency-export disables t2 outbound", async () => {
    const ro = await connect(
      { service_id: "ru.iwxa.learn.career" },
      { domain: { ...domain, read_only: true }, current, origin },
    );
    expect(ro.mode).toBe("read-only");
    expect(ro.granted_operations).not.toContain("t1.putObject");
    expect(ro.granted_operations).not.toContain("t2.exportPackage");
    await expect(ro.t0.validate({ objects: [] })).resolves.toMatchObject({ tier: "t0", ok: true });
    await expect(
      ro.t1.putObject({
        workspace_id: "ws-1",
        object_id: "obj-1",
        schema_id: "career.role",
        schema_version: "1.0.0",
        data: {},
        event: { event_type: "career.role.created", payload: {} },
      }),
    ).rejects.toMatchObject({ code: "MISSING_LEVEL" });

    const ee = await connect(
      { service_id: "ru.iwxa.learn.career" },
      { domain: { ...domain, emergency_export: true }, current, origin },
    );
    expect(ee.mode).toBe("emergency-export");
    expect(ee.granted_operations).not.toContain("t2.exportPackage");
    await expect(ee.t2.exportPackage({ workspaces: ["ws-1"] })).rejects.toMatchObject({
      code: "MISSING_LEVEL",
    });
  });
});

// ---------------------------------------------------------------------------
// Negative — required contract failures.
// ---------------------------------------------------------------------------

describe("connect() — negative", () => {
  const connect = makeConnect({
    "ru.iwxa.learn.career": careerPassport,
    "ru.iwxa.learn.study": coursesPassport,
  });

  it("unknown service (not in domain.modules) → UNKNOWN_SERVICE", async () => {
    await expect(
      connect({ service_id: "ru.iwxa.ghost" }, { domain, current, origin }),
    ).rejects.toBeInstanceOf(ConnectError);
    await expect(
      connect({ service_id: "ru.iwxa.ghost" }, { domain, current, origin }),
    ).rejects.toMatchObject({ code: "UNKNOWN_SERVICE" });
  });

  it("wrong base_path (passport ≠ domain module) → BASE_PATH_MISMATCH", async () => {
    const bad = makeConnect({
      "ru.iwxa.learn.career": { ...careerPassport, base_path: "/other/" },
    });
    await expect(
      bad({ service_id: "ru.iwxa.learn.career" }, { domain, current, origin }),
    ).rejects.toMatchObject({ code: "BASE_PATH_MISMATCH" });
  });

  it("passport of a different service → PASSPORT_INVALID", async () => {
    const bad = makeConnect({
      "ru.iwxa.learn.career": { ...careerPassport, service_id: "ru.iwxa.learn.study" },
    });
    await expect(
      bad({ service_id: "ru.iwxa.learn.career" }, { domain, current, origin }),
    ).rejects.toMatchObject({ code: "PASSPORT_INVALID" });
  });

  it("level not allowed by domain (supported_levels ⊄ enabled_capabilities) → LEVEL_NOT_ALLOWED", async () => {
    const restricted: DomainLike = { ...domain, enabled_capabilities: ["T0"] };
    await expect(
      connect({ service_id: "ru.iwxa.learn.career" }, { domain: restricted, current, origin }),
    ).rejects.toMatchObject({ code: "LEVEL_NOT_ALLOWED" });
  });

  it("required_levels missing from granted → MISSING_LEVEL", async () => {
    await expect(
      connect(
        { service_id: "ru.iwxa.learn.study", required_levels: ["T1"] },
        { domain, current, origin },
      ),
    ).rejects.toMatchObject({ code: "MISSING_LEVEL" });
  });

  it("malformed passport (missing fields, bad shape) → PASSPORT_INVALID", async () => {
    const scenarios: unknown[] = [
      // missing service_version
      { service_id: "ru.iwxa.learn.career", base_path: "/career/", supported_levels: ["T0"], input_object_types: [], output_object_types: [], schemas: {} },
      // supported_levels contains a foreign level
      { ...careerPassport, supported_levels: ["T0", "ADMIN"] as unknown as ServicePassport["supported_levels"] },
      // base_path is not absolute
      { ...careerPassport, base_path: "career/" },
      // schemas is an array
      { ...careerPassport, schemas: [] as unknown as Record<string, unknown> },
      // input_object_types is not an array
      { ...careerPassport, input_object_types: "x" as unknown as string[] },
    ];
    for (const p of scenarios) {
      const bad = makeConnect({ "ru.iwxa.learn.career": p as ServicePassport });
      await expect(
        bad({ service_id: "ru.iwxa.learn.career" }, { domain, current, origin }),
      ).rejects.toMatchObject({ code: "PASSPORT_INVALID" });
    }
  });

  it("malformed service_id (slashes, '..', empty) is rejected before passport lookup", async () => {
    for (const id of ["../etc", "a/b", "..", "", ".foo"]) {
      await expect(
        connect({ service_id: id } as never, { domain, current, origin }),
      ).rejects.toMatchObject({ code: "UNKNOWN_SERVICE" });
    }
    // sanity
    expect(isValidServiceId("ru.iwxa.learn.career")).toBe(true);
    expect(isValidServiceId("a/b")).toBe(false);
    expect(isValidServiceId("..")).toBe(false);
  });

  it("update-required from current.json → UPDATE_REQUIRED", async () => {
    await expect(
      connect(
        { service_id: "ru.iwxa.learn.career" },
        { domain, current: { ...current, status: "update-required" }, origin },
      ),
    ).rejects.toMatchObject({ code: "UPDATE_REQUIRED" });
  });
});

// ---------------------------------------------------------------------------
// loader.js — integration (snake_case wire, canonical passport shape).
// ---------------------------------------------------------------------------

describe("loader.js — integration", () => {
  const loaderPath = resolve(__dirname, "../overlay/_iwxa/loader.js");
  const loaderSrc = readFileSync(loaderPath, "utf8");

  let originalFetch: typeof fetch;
  let originalWindow: unknown;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWindow = (globalThis as { window?: unknown }).window;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as { window?: unknown }).window = originalWindow;
    delete (globalThis as { IWXA?: unknown }).IWXA;
  });

  function runLoader(
    fakeWindow: Record<string, unknown>,
    dynImport: (url: string) => Promise<unknown>,
  ) {
    (globalThis as { window?: unknown }).window = fakeWindow;
    (globalThis as Record<string, unknown>).__iwxa_dyn_import__ = dynImport;
    // Rewrite BOTH dynamic imports (validator + runtime) into a single stub.
    const src = loaderSrc
      .replace(
        /import\(\s*\/\*[^*]*\*\/\s*VALIDATOR_URL\s*\)/,
        "globalThis.__iwxa_dyn_import__(VALIDATOR_URL)",
      )
      .replace(
        /import\(\s*\/\*[^*]*\*\/\s*current\.runtime_url\s*\)/,
        "globalThis.__iwxa_dyn_import__(current.runtime_url)",
      );
    (0, eval)(src);
  }

  it("dispatches connect requests to the runtime with snake_case payload", async () => {
    const domainJson = {
      config_schema_version: "1.0.0",
      domain_id: "learn.iwxa.ru",
      modules: [{ service_id: "ru.iwxa.learn.career", base_path: "/career/" }],
      enabled_capabilities: ["T0", "T1", "T2"],
    };
    const currentJson = {
      runtime_version: "0.1.0",
      runtime_url: "runtime://0.1.0",
      contract_version: "1.2.0",
      min_loader: 1,
      status: "active",
    };

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/domain.json")) return { ok: true, json: async () => domainJson } as Response;
      if (url.endsWith("/current.json")) return { ok: true, json: async () => currentJson } as Response;
      if (url.endsWith("/services/ru.iwxa.learn.career.json"))
        return { ok: true, json: async () => careerPassport } as Response;
      throw new Error("unexpected fetch " + url);
    }) as unknown as typeof fetch;

    const runtimeConnect = vi.fn(async (req: unknown, ctx: unknown) => ({
      contract_version: "1.2.0",
      runtime_version: "0.1.0",
      service: { service_id: "ru.iwxa.learn.career", base_path: "/career/", service_version: "1.0.0" },
      mode: "full",
      granted_levels: ["T0"],
      granted_operations: ["t0.validate"],
      t0: { validate: async () => "t0" },
      t1: { listWorkspaces: async () => [] },
      t2: { exportPreview: async () => ({}) },
      _echo: { req, ctx },
    }));

    const dynImport = async (url: string) => {
      if (url === "/_iwxa/validator.js") {
        return { validateDomainConfig: (raw: unknown) => ({ ok: true, config: raw }) };
      }
      expect(url).toBe("runtime://0.1.0");
      return { connect: runtimeConnect };
    };

    const fakeWindow: Record<string, unknown> = { location: { origin: "https://learn.iwxa.ru" } };
    runLoader(fakeWindow, dynImport);

    const api = fakeWindow.IWXA as {
      connect: (r: unknown) => Promise<unknown>;
      version: number;
    };
    expect(api.version).toBe(1);

    const client = (await api.connect({
      service_id: "ru.iwxa.learn.career",
      required_levels: ["T0"],
    })) as { service: { service_id: string }; _echo: { req: unknown } };

    expect(runtimeConnect).toHaveBeenCalledOnce();
    expect(client.service.service_id).toBe("ru.iwxa.learn.career");
    expect(client._echo.req).toEqual({
      service_id: "ru.iwxa.learn.career",
      required_levels: ["T0"],
    });
  });

  it("rejects when current.json.min_loader exceeds loader version", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/domain.json")) return { ok: true, json: async () => ({}) } as Response;
      if (url.endsWith("/current.json"))
        return {
          ok: true,
          json: async () => ({
            runtime_version: "99.0.0",
            runtime_url: "x",
            contract_version: "1.2.0",
            min_loader: 999,
          }),
        } as Response;
      throw new Error("unexpected");
    }) as unknown as typeof fetch;

    const fakeWindow: Record<string, unknown> = { location: { origin: "https://x" } };
    runLoader(fakeWindow, async (url: string) => {
      if (url === "/_iwxa/validator.js") {
        return { validateDomainConfig: (raw: unknown) => ({ ok: true, config: raw }) };
      }
      return { connect: () => Promise.resolve(null) };
    });
    const api = fakeWindow.IWXA as { connect: (r: unknown) => Promise<unknown> };
    await expect(api.connect({ service_id: "demo" })).rejects.toMatchObject({
      code: "UPDATE_REQUIRED",
    });
  });
});
