// @vitest-environment jsdom
/**
 * PROMPT_08 §1 — dev fixture fallback is only allowed when ALL three real
 * host-config files are absent. A partially deployed triad is a blocking
 * error, never silently replaced by the generic fixture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadHostConfig } from "../src/config/host-config/load-host-config";
import genericDomain from "../fixtures/host-configs/generic/domain.json";
import genericShell from "../fixtures/host-configs/generic/domain-shell.json";
import genericWorkspace from "../fixtures/host-configs/generic/workspace.config.json";

let origFetch: typeof fetch | undefined;

function installFetch(handler: (url: string) => Promise<Response>) {
  origFetch = globalThis.fetch;
  globalThis.fetch = vi.fn((input: RequestInfo | URL) =>
    handler(typeof input === "string" ? input : String(input)),
  ) as unknown as typeof fetch;
}

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
const notFound = () =>
  Promise.resolve(new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } }));
const badJson = () =>
  Promise.resolve(new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } }));
const http500 = () =>
  Promise.resolve(new Response("boom", { status: 500, headers: { "content-type": "text/plain" } }));

beforeEach(() => {
  origFetch = globalThis.fetch;
});
afterEach(() => {
  if (origFetch) globalThis.fetch = origFetch;
});

describe("host-config partial deployment (PROMPT_08 §1)", () => {
  it("dev: all three missing → uses generic fixture set", async () => {
    installFetch(() => notFound());
    const res = await loadHostConfig();
    expect(res.status).toBe("ready");
    expect(res.fixture).toBe("generic");
    expect(res.workspace?.profile).toBe("generic");
  });

  it("dev: domain ready, shell missing, workspace ready → blocking error, no fixture", async () => {
    installFetch((url) => {
      if (url.endsWith("/domain.json")) return json(genericDomain);
      if (url.endsWith("/domain-shell.json")) return notFound();
      return json(genericWorkspace);
    });
    const res = await loadHostConfig();
    expect(res.status).toBe("error");
    expect(res.fixture).toBeNull();
    expect(res.error?.code).toBe("domain-shell-missing");
    expect(res.domain).toBeNull();
  });

  it("dev: two of three missing → blocking error with per-file diagnostics", async () => {
    installFetch((url) => {
      if (url.endsWith("/domain.json")) return json(genericDomain);
      return notFound();
    });
    const res = await loadHostConfig();
    expect(res.status).toBe("error");
    expect(res.fixture).toBeNull();
    const codes = res.diagnostics.map((d) => d.code).sort();
    expect(codes).toContain("domain-shell-missing");
    expect(codes).toContain("workspace-config-missing");
  });

  it("dev: invalid JSON in domain AND shell missing → invalid-json blocking, not fixture", async () => {
    installFetch((url) => {
      if (url.endsWith("/domain.json")) return badJson();
      if (url.endsWith("/domain-shell.json")) return notFound();
      return json(genericWorkspace);
    });
    const res = await loadHostConfig();
    expect(res.status).toBe("error");
    expect(res.fixture).toBeNull();
    const codes = res.diagnostics.map((d) => d.code);
    expect(codes[0]).toBe("domain-config-invalid-json");
    // Missing shell must still surface in diagnostics for completeness.
    expect(codes).toContain("domain-shell-missing");
  });

  it("dev: HTTP 500 on shell + workspace missing → error, no fixture", async () => {
    installFetch((url) => {
      if (url.endsWith("/domain.json")) return json(genericDomain);
      if (url.endsWith("/domain-shell.json")) return http500();
      return notFound();
    });
    const res = await loadHostConfig();
    expect(res.status).toBe("error");
    expect(res.fixture).toBeNull();
    expect(res.error?.code).toBe("shell-config-http-error");
  });

  it("dev: network failure is NOT treated as missing → blocking error", async () => {
    installFetch(() => Promise.reject(new TypeError("network")));
    const res = await loadHostConfig();
    expect(res.status).toBe("error");
    expect(res.fixture).toBeNull();
    // All three fetches failed with network-error, none as `missing`.
    for (const d of res.diagnostics) {
      expect(d.code.endsWith("http-error")).toBe(true);
      expect((d.details as { reason?: string }).reason).toBe("network-error");
    }
  });
});
