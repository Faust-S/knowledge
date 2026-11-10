import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadHostConfig } from "../src/config/host-config/load-host-config";
import genericDomain from "../fixtures/host-configs/generic/domain.json";
import genericShell from "../fixtures/host-configs/generic/domain-shell.json";
import genericWorkspace from "../fixtures/host-configs/generic/workspace.config.json";

type FetchMock = ReturnType<typeof vi.fn>;

function makeResp(body: unknown, init: { status?: number; contentType?: string } = {}) {
  const status = init.status ?? 200;
  const contentType = init.contentType ?? "application/json";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return Promise.resolve(
    new Response(text, {
      status,
      headers: { "content-type": contentType },
    }),
  );
}

let origFetch: typeof fetch | undefined;
let fetchMock: FetchMock;

function installFetch(handler: (path: string) => Promise<Response>) {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    return handler(url);
  }) as unknown as FetchMock;
  origFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

beforeEach(() => {
  origFetch = globalThis.fetch;
});
afterEach(() => {
  if (origFetch) globalThis.fetch = origFetch;
});

describe("host-config loading (three files, independent)", () => {
  it("production: missing domain.json is a blocking error, no fixture fallback", async () => {
    installFetch(() => makeResp("not found", { status: 404, contentType: "text/plain" }));
    const res = await loadHostConfig({ forceProduction: true, runtimeOrigin: "https://x.test" });
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("domain-config-missing");
    expect(res.domain).toBeNull();
  });

  it("production: missing shell.json → shell-missing", async () => {
    installFetch((url) => {
      if (url.endsWith("/domain.json")) return makeResp(genericDomain);
      if (url.endsWith("/domain-shell.json"))
        return makeResp("nope", { status: 404, contentType: "text/plain" });
      return makeResp(genericWorkspace);
    });
    const res = await loadHostConfig({ forceProduction: true, runtimeOrigin: "https://x.test" });
    expect(res.error?.code).toBe("domain-shell-missing");
  });

  it("production: missing workspace.config.json → workspace-missing", async () => {
    installFetch((url) => {
      if (url.endsWith("/workspace.config.json"))
        return makeResp("", { status: 404, contentType: "text/plain" });
      if (url.endsWith("/domain.json")) return makeResp(genericDomain);
      return makeResp(genericShell);
    });
    const res = await loadHostConfig({ forceProduction: true, runtimeOrigin: "https://x.test" });
    expect(res.error?.code).toBe("workspace-config-missing");
  });

  it("production: invalid JSON → invalid-json diagnostic", async () => {
    installFetch((url) => {
      if (url.endsWith("/domain.json"))
        return makeResp("{not-json", { contentType: "application/json" });
      if (url.endsWith("/domain-shell.json")) return makeResp(genericShell);
      return makeResp(genericWorkspace);
    });
    const res = await loadHostConfig({ forceProduction: true, runtimeOrigin: "https://x.test" });
    expect(res.error?.code).toBe("domain-config-invalid-json");
  });

  it("production: HTTP 5xx → http-error diagnostic", async () => {
    installFetch((url) => {
      if (url.endsWith("/domain-shell.json"))
        return makeResp("boom", { status: 502, contentType: "text/plain" });
      if (url.endsWith("/domain.json")) return makeResp(genericDomain);
      return makeResp(genericWorkspace);
    });
    const res = await loadHostConfig({ forceProduction: true, runtimeOrigin: "https://x.test" });
    expect(res.error?.code).toBe("shell-config-http-error");
  });

  it("never fetches /_iwxa/domain-key.json", async () => {
    installFetch((url) => {
      if (url.endsWith("/domain.json")) return makeResp(genericDomain);
      if (url.endsWith("/domain-shell.json")) return makeResp(genericShell);
      if (url.endsWith("/workspace.config.json")) return makeResp(genericWorkspace);
      return makeResp("no", { status: 404, contentType: "text/plain" });
    });
    await loadHostConfig({
      forceProduction: true,
      runtimeOrigin: "https://synthetic.iwxa.dev",
    });
    const calls = (fetchMock.mock.calls as unknown as Array<[unknown]>).map(([u]) => String(u));
    expect(calls.every((u) => !u.includes("domain-key"))).toBe(true);
  });

  it("production: happy path with matching runtime origin → ready", async () => {
    installFetch((url) => {
      if (url.endsWith("/domain.json")) return makeResp(genericDomain);
      if (url.endsWith("/domain-shell.json")) return makeResp(genericShell);
      return makeResp(genericWorkspace);
    });
    const res = await loadHostConfig({
      forceProduction: true,
      runtimeOrigin: "https://synthetic.iwxa.dev",
    });
    expect(res.status).toBe("ready");
    expect(res.domain?.domain_id).toBe("synthetic.generic");
    expect(res.shell?.domain_id).toBe("synthetic.generic");
    expect(res.workspace?.profile).toBe("generic");
    expect(res.error).toBeNull();
  });
});
