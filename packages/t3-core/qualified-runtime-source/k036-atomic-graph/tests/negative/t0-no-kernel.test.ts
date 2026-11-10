/**
 * Negative: T0 works when the kernel (LocalStore) is unavailable.
 *
 * Contract: `createConnect` returns an `IWXAClient` whose `t0` is safe to
 * call without ever touching IndexedDB. Only `t1` (writes) and `t2`
 * (outbound) require the kernel; T0 must stay operational.
 */

import { describe, it, expect } from "vitest";
import { createConnect, ConnectError, type ServicePassport } from "../../src/runtime/public-api";
import { makeTestTierHandlers } from "../helpers/test-tier-handlers";
import { describeError } from "../../src/errors";

const passport: ServicePassport = {
  service_id: "demo",
  service_version: "1.0.0",
  base_path: "/demo",
  supported_levels: ["T0"],
  input_object_types: [],
  output_object_types: [],
  schemas: {},
  permissions: {
    workspace: { list: false, read: false, create: false, soft_delete: false, restore: false, purge: false },
    objects: { read: [], write: [], delete: [] },
    events: { read_scope: "service" },
    packages: { export: false, import: false, export_scope: "readable_objects", import_scope: "writable_objects" },
  },
};

const domain = {
  modules: [{ service_id: "demo", base_path: "/demo" }],
  enabled_capabilities: ["T0" as const],
};
const current = {
  runtime_version: "0.1.0",
  runtime_url: "/_iwxa/runtime/0.1.0/runtime.js",
  contract_version: "1.2.0",
  min_loader: 1,
  status: "active" as const,
};

describe("negative/t0-without-kernel", () => {
  it("connect() succeeds and t0.validate returns without touching any store", async () => {
    const connect = createConnect({
      loadPassport: async () => passport,
      makeTierHandlers: makeTestTierHandlers,
    });
    const client = await connect({ service_id: "demo" }, { domain, current, origin: "https://demo" });
    expect(client.mode).toBe("full");
    expect(client.contract_version).toBe("1.3.0");
    const out = (await client.t0.validate({ objects: [] })) as { tier: string; ok: boolean };
    expect(out.tier).toBe("t0");
    expect(out.ok).toBe(true);
  });

  it("t1.putObject throws typed ConnectError when the mode disallows writes", async () => {
    const connect = createConnect({
      loadPassport: async () => passport,
      makeTierHandlers: makeTestTierHandlers,
    });
    const client = await connect(
      { service_id: "demo" },
      { domain: { ...domain, read_only: true }, current, origin: "https://demo" },
    );
    expect(client.mode).toBe("read-only");
    let raised: unknown = null;
    try {
      await client.t1.putObject({
        workspace_id: "ws-1",
        object_id: "obj-1",
        schema_id: "demo.thing",
        schema_version: "1.0.0",
        data: {},
        event: { event_type: "demo.thing.created", payload: {} },
      });
    } catch (e) {
      raised = e;
    }
    expect(raised).toBeInstanceOf(ConnectError);
    const desc = describeError(raised);
    expect(desc.code).toBe("MISSING_LEVEL");
  });

  it("passport lookup failure surfaces as UNKNOWN_SERVICE — never a silent null", async () => {
    const connect = createConnect({ loadPassport: async () => null, makeTierHandlers: makeTestTierHandlers });
    let raised: unknown = null;
    try {
      await connect({ service_id: "demo" }, { domain, current, origin: "https://demo" });
    } catch (e) {
      raised = e;
    }
    expect(raised).toBeInstanceOf(ConnectError);
    expect((raised as ConnectError).code).toBe("UNKNOWN_SERVICE");
  });

  it("update-required current.json blocks connect (no T0 either)", async () => {
    const connect = createConnect({ loadPassport: async () => passport, makeTierHandlers: makeTestTierHandlers });
    let raised: unknown = null;
    try {
      await connect(
        { service_id: "demo" },
        { domain, current: { ...current, status: "update-required" }, origin: "https://demo" },
      );
    } catch (e) {
      raised = e;
    }
    expect(raised).toBeInstanceOf(ConnectError);
    expect((raised as ConnectError).code).toBe("UPDATE_REQUIRED");
  });
});
