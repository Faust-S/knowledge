/**
 * Negative tests for the dangerous-operations surface.
 *
 * Focus areas (from the "Опасные операции" mandate):
 *   - No local PURGE_PHRASE constant; purge confirmation must come from a
 *     kernel-provided preview. When the kernel does not expose the
 *     recovery contract, purge / restore are unavailable — the shell does
 *     NOT substitute a local flow.
 *   - Imports use only the kernel's typed pipeline. The shell enforces an
 *     `.iwxa` extension gate and a size ceiling before touching the
 *     kernel, and never parses the package as JSON or opens the ZIP.
 *   - Writes are gated by named capabilities. `limited` does not auto-
 *     grant writes. `read-only` never lights up dangerous buttons.
 *   - When the session is missing, the shell says so explicitly and never
 *     offers an export it cannot run.
 *
 * These tests deliberately avoid rendering React trees — this project
 * ships without @testing-library/react — and rely on:
 *   (a) source-level assertions against the shell files,
 *   (b) capability-predicate assertions,
 *   (c) adapter-level rejections against the dev-mock client, and
 *   (d) registry-level assertions on the error taxonomy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { capabilities } from "../src/kernel-client/capabilities";
import { adapter } from "../src/kernel-client/adapter";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { describeError } from "../src/errors/registry";

// ---------------------------------------------------------------------------
// 1. Source-level guarantees against backdoor flows
// ---------------------------------------------------------------------------
describe("shell source: no PURGE_PHRASE, no backdoor writes, no local ZIP parsing", () => {
  const files = [
    "src/modules/exchange/features/packages/ImportView.tsx",
    "src/modules/exchange/features/packages/ExportView.tsx",
  ];
  const src = files
    .map((f) => readFileSync(path.resolve(f), "utf8"))
    .join("\n");

  it("does not define PURGE_PHRASE or a hard-coded 'PURGE' confirmation literal", () => {
    expect(src).not.toMatch(/PURGE_PHRASE/);
    expect(src).not.toMatch(/["']PURGE["']/);
  });

  it("does not write through workspace/restore|import/pending backdoor call sites", () => {
    // Detect actual call expressions, not documentation prose that names
    // the forbidden paths in order to warn future maintainers about them.
    expect(src).not.toMatch(/\.write\s*\(\s*["']workspace\/restore\/pending/);
    expect(src).not.toMatch(/\.write\s*\(\s*["']workspace\/import\/pending/);
    expect(src).not.toMatch(/session\.workspace\.write\s*\(/);
  });


  it("does not JSON.parse package bytes and does not depend on a ZIP library", () => {
    expect(src).not.toMatch(/JSZip|jszip|new\s+JSZip/);
    expect(src).not.toMatch(/JSON\.parse\s*\(\s*[a-zA-Z_]*bytes/);
  });

  it("only surfaces import through kernel.importPreview / importCommit (façade)", () => {
    const importView = readFileSync(
      path.resolve("src/modules/exchange/features/packages/ImportView.tsx"),
      "utf8",
    );
    expect(importView).toMatch(/kernel\.importPreview/);
    expect(importView).toMatch(/kernel\.importCommit/);
    // ImportView enforces the shell-side guards
    expect(importView).toMatch(/\.iwxa/);
    expect(importView).toMatch(/MAX_PACKAGE_BYTES/);
    expect(importView).toMatch(/commitGuardRef/);
  });
});

// ---------------------------------------------------------------------------
// 2. Capability gating
// ---------------------------------------------------------------------------
describe("capability gating for dangerous operations", () => {
  it("limited mode does NOT auto-grant write, import, restore or purge", () => {
    const c = capabilities(createDevMockClient({ mode: "limited" }));
    expect(c.canWrite).toBe(false);
    expect(c.canWriteObject).toBe(false);
    expect(c.canCreateWorkspace).toBe(false);
    expect(c.canImportPackage).toBe(false);
    expect(c.canRestore).toBe(false);
    expect(c.canPurge).toBe(false);
  });

  it("read-only mode blocks every destructive action", () => {
    const c = capabilities(createDevMockClient({ mode: "read-only" }));
    expect(c.canWrite).toBe(false);
    expect(c.canWriteObject).toBe(false);
    expect(c.canImportPackage).toBe(false);
    expect(c.canRestore).toBe(false);
    expect(c.canPurge).toBe(false);
  });

  it("Baseline 1.2 exposes the recovery surface — canRestore/canPurge flip on in full mode", () => {
    const c = capabilities(createDevMockClient({ mode: "full" }));
    expect(c.recoveryContract).toBe("available");
    expect(c.canRestore).toBe(true);
    expect(c.canPurge).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Adapter-level enforcement
// ---------------------------------------------------------------------------
describe("adapter refuses dangerous operations in unsafe modes", () => {
  it("putObject in a read-only session is rejected (t1.putObject not granted)", () => {
    const session = createDevMockClient({ mode: "read-only" });
    expect(() =>
      adapter.putObject(session, {
        workspace_id: "w",
        object_id: "n",
        schema_id: "iwxa.demo.note",
        schema_version: "1.0.0",
        data: {},
        event: { event_type: "note.written" },
      }),
    ).toThrow(/t1\.putObject/);
  });

  it("importCommit in a limited session is rejected (t2.importCommit not granted)", () => {
    const session = createDevMockClient({ mode: "limited" });
    expect(() =>
      adapter.importCommit(session, {
        preview_token: "tok-fake",
        package_digest: "sha256-fake",
        plan: { mode: "selective", include_workspaces: [] },
      }),
    ).toThrow(/t2\.importCommit/);
  });


  it("corrupted bytes throw a typed PackageCorruptedError — no `corrupted` sentinel field", async () => {
    const { PackageCorruptedError } = await import(
      "../src/kernel-client/errors"
    );
    const session = createDevMockClient({ mode: "full" });
    await expect(
      adapter.importPreview(session, new Uint8Array([0xff, 0x00, 0x13, 0x37])),
    ).rejects.toBeInstanceOf(PackageCorruptedError);
  });
});


// ---------------------------------------------------------------------------
// 4. Error registry: kernel-unavailable must not offer export
// ---------------------------------------------------------------------------
describe("kernel_unavailable never offers export", () => {
  it("registry omits export_iwxa and safeMessage explains the state", () => {
    const desc = describeError("kernel_unavailable");
    expect(desc.actions).not.toContain("export_iwxa");
    expect(desc.safeMessage).toMatch(/ядро/i);
    expect(desc.safeMessage).toMatch(/экспорт/i);
    expect(desc.safeMessage).toMatch(/браузер/i);
  });

  it("BaseRouteFrame renders an explicit kernel-unavailable panel when session is null", () => {
    const main = readFileSync(
      path.resolve("src/modules/base/routes/route-shell.tsx"),
      "utf8",
    );
    expect(main).toMatch(/kernel-unavailable-panel/);
    expect(main).toMatch(/Ядро недоступно/);
    expect(main).toMatch(/Экспорт \.iwxa невозможен/);
    expect(main).toMatch(/Не очищайте данные браузера/);
  });
});
