// @vitest-environment jsdom
/**
 * PROMPT_08 §3 — all source and schema diagnostics discovered during a
 * single load must be preserved in `diagnostics[]`, even when the first
 * blocking error is already known. `error` holds the first blocking issue;
 * `diagnostics` holds the full list. Technical details survive round-trip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadHostConfig } from "../src/config/host-config/load-host-config";
import { HostConfigError } from "../src/config/host-config/errors";
import genericShell from "../fixtures/host-configs/generic/domain-shell.json";

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
const badJson = () =>
  Promise.resolve(new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } }));
const http503 = () =>
  Promise.resolve(new Response("nope", { status: 503, headers: { "content-type": "text/plain" } }));

beforeEach(() => { origFetch = globalThis.fetch; });
afterEach(() => { if (origFetch) globalThis.fetch = origFetch; });

describe("host-config diagnostic preservation (PROMPT_08 §3)", () => {
  it("multiple source failures are all reported", async () => {
    installFetch((url) => {
      if (url.endsWith("/domain.json")) return badJson();
      if (url.endsWith("/domain-shell.json")) return http503();
      return json({ nonsense: true });
    });
    const res = await loadHostConfig({ forceProduction: true, runtimeOrigin: "https://x.test" });
    const codes = res.diagnostics.map((d) => d.code);
    expect(codes).toContain("domain-config-invalid-json");
    expect(codes).toContain("shell-config-http-error");
    // No fixture used.
    expect(res.fixture).toBeNull();
    expect(res.status).toBe("error");
  });

  it("HostConfigError preserves diagnostic code + details via error cause", () => {
    const err = new HostConfigError({
      code: "runtime-version-mismatch",
      message: "boom",
      details: { got: "9.9.9", expected: "0.1.0" },
    });
    expect(err.code).toBe("runtime-version-mismatch");
    expect(err.cause).toEqual({ got: "9.9.9", expected: "0.1.0" });
    expect(err.diagnostic.details).toEqual({ got: "9.9.9", expected: "0.1.0" });
  });

  it("network-error keeps 'network-error' reason in details", async () => {
    installFetch(() => Promise.reject(new Error("offline")));
    const res = await loadHostConfig({ forceProduction: true, runtimeOrigin: "https://x.test" });
    const d = res.diagnostics[0];
    expect(d.code.endsWith("http-error")).toBe(true);
    expect((d.details as { reason: string }).reason).toBe("network-error");
    expect((d.details as { status: number }).status).toBe(0);
  });

  it("shell schema errors are surfaced (not swallowed by later checks)", async () => {
    // Break the shell payload; domain + workspace are valid via injection.
    const res = await loadHostConfig({
      injected: {
        domain: (await import("../fixtures/host-configs/generic/domain.json")).default,
        shell: { ...genericShell, brand: undefined },
        workspace: (await import("../fixtures/host-configs/generic/workspace.config.json")).default,
      },
    });
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("shell-schema-invalid");
    // Details carry AJV errors (array of ErrorObject).
    expect(Array.isArray(res.error?.details)).toBe(true);
  });
});
