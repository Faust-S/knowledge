import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src/modules/base/features/workspaces/workspace-id.ts");

describe("workspace-id source hygiene", () => {
  const source = readFileSync(SRC, "utf8");
  it("never uses Math.random", () => {
    expect(source).not.toMatch(/Math\.random/);
  });
});

describe("generateWorkspaceId", () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
    vi.resetModules();
  });

  const setCrypto = (value: unknown) => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value,
    });
  };

  it("prefixes with ws- and passes isSafeOpaqueId", async () => {
    const { generateWorkspaceId, isValidWorkspaceId } = await import(
      "../src/modules/base/features/workspaces/workspace-id"
    );
    const { isSafeOpaqueId } = await import("../src/shell/routing");
    const id = generateWorkspaceId();
    expect(id.startsWith("ws-")).toBe(true);
    expect(id.length).toBeLessThanOrEqual(128);
    expect(isSafeOpaqueId(id)).toBe(true);
    expect(isValidWorkspaceId(id)).toBe(true);
  });

  it("uses Web Crypto randomUUID when available", async () => {
    const spy = vi.fn(() => "550e8400-e29b-41d4-a716-446655440000");
    setCrypto({ randomUUID: spy });
    vi.resetModules();
    const { generateWorkspaceId } = await import(
      "../src/modules/base/features/workspaces/workspace-id"
    );
    const id = generateWorkspaceId();
    expect(spy).toHaveBeenCalled();
    expect(id).toBe("ws-550e8400-e29b-41d4-a716-446655440000");
  });

  it("falls back to getRandomValues when randomUUID is absent", async () => {
    const getRandomValues = vi.fn(<T extends ArrayBufferView>(arr: T): T => {
      const view = arr as unknown as Uint8Array;
      for (let i = 0; i < view.length; i++) view[i] = i + 1;
      return arr;
    });
    setCrypto({ getRandomValues });
    vi.resetModules();
    const { generateWorkspaceId } = await import(
      "../src/modules/base/features/workspaces/workspace-id"
    );
    const id = generateWorkspaceId();
    expect(getRandomValues).toHaveBeenCalled();
    expect(id.startsWith("ws-")).toBe(true);
  });

  it("throws when Web Crypto is unavailable", async () => {
    setCrypto(undefined);
    vi.resetModules();
    const { generateWorkspaceId } = await import(
      "../src/modules/base/features/workspaces/workspace-id"
    );
    expect(() => generateWorkspaceId()).toThrow(/Web Crypto/);
  });

  it("two calls produce different ids", async () => {
    const uuids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    let i = 0;
    setCrypto({ randomUUID: () => uuids[i++] });
    vi.resetModules();
    const { generateWorkspaceId } = await import(
      "../src/modules/base/features/workspaces/workspace-id"
    );
    expect(generateWorkspaceId()).not.toBe(generateWorkspaceId());
  });
});

// keep vitest happy with a shared beforeEach hook slot
beforeEach(() => {});
