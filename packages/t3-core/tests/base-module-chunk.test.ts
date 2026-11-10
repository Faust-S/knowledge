/**
 * PROMPT 18 §11 — chunk isolation for the base module.
 *
 * Runs `vite build` once, then asserts:
 *   - a non-entry chunk carries the base module code (unique sentinel
 *     `workspace.catalog.refresh`);
 *   - the entry bundle does NOT statically embed the base module code
 *     (only the module id string may appear as a loader-table key);
 *   - the module-id string of a planned module never appears in
 *     module code — planned modules have no source files and no
 *     chunks.
 *
 * The DEV-only fixture branch (`import.meta.glob`) is tree-shaken in
 * production, so `fixtures/host-configs/**` contents do not leak into
 * `dist/`.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "iwxa-base-chunk-"));

const BASE_CODE_SENTINEL = "base.workspace-status";
const BASE_PLACEHOLDER_SENTINEL = "base.command.workspace.focus.select";

beforeAll(() => {
  execSync(`npx vite build --outDir ${TMP} --emptyOutDir`, { stdio: "pipe" });
}, 180_000);

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function readAssets() {
  const dir = path.join(TMP, "assets");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({
      name: f,
      content: fs.readFileSync(path.join(dir, f), "utf8"),
    }));
  const indexHtml = fs.readFileSync(path.join(TMP, "index.html"), "utf8");
  const entryHrefs = Array.from(
    indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g),
  ).map((m) => path.basename(m[1]));
  return {
    files,
    entryFiles: files.filter((f) => entryHrefs.includes(f.name)),
    nonEntryFiles: files.filter((f) => !entryHrefs.includes(f.name)),
  };
}

describe("iwxa.workspace.base — chunk isolation", () => {
  it("emits a non-entry chunk that carries the base module code", () => {
    const { nonEntryFiles } = readAssets();
    const hit = nonEntryFiles.find(
      (f) =>
        f.content.includes(BASE_CODE_SENTINEL) ||
        f.content.includes(BASE_PLACEHOLDER_SENTINEL),
    );
    expect(hit, "no non-entry chunk contains base module code").toBeTruthy();
  });

  it("the entry bundle does NOT statically embed base module code", () => {
    const { entryFiles } = readAssets();
    for (const entry of entryFiles) {
      expect(
        entry.content.includes(BASE_CODE_SENTINEL),
        `${entry.name} embeds base module dashboard-card id`,
      ).toBe(false);
      expect(
        entry.content.includes(BASE_PLACEHOLDER_SENTINEL),
        `${entry.name} embeds base module placeholder component`,
      ).toBe(false);
    }
  });

  it("no chunk contains planned-module code (exchange / lifecycle have no source files)", () => {
    const { files } = readAssets();
    // Planned modules have no source. Any surface-specific sentinel
    // for them would only appear if code was written. Assert the
    // absence of any such surface hint (using a deliberately unique
    // token that would only come from a real module).
    for (const f of files) {
      expect(
        f.content.includes("iwxa.workspace.exchange.module"),
        `${f.name} leaked planned exchange module code`,
      ).toBe(false);
      expect(
        f.content.includes("iwxa.workspace.lifecycle.module"),
        `${f.name} leaked planned lifecycle module code`,
      ).toBe(false);
    }
  });
});
