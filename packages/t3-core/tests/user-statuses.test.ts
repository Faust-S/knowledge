/**
 * User-facing status tests:
 *
 *   - The workspace catalog surface (Overview) MUST NOT compute or show a
 *     "backup" state. That belongs to the packages centre (T2-05). The
 *     catalog also MUST NOT call `listEventsSince`.
 *   - Recovery contract is not part of v1 kernel granted_operations. It
 *     only flips to `available` when a future kernel exposes the canonical
 *     three operations. TrashView has been removed from the shell entirely
 *     — v1 does not surface restore/purge.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { capabilities } from "../src/kernel-client/capabilities";
import { createDevMockClient } from "../src/kernel-client/dev-mock";

const overview = readFileSync(
  path.resolve("src/modules/base/features/overview/OverviewView.tsx"),
  "utf8",
);

describe("Overview: no backup surface in T2-02 catalog", () => {
  it("does not derive backup from updated_at or export receipts", () => {
    expect(overview).not.toMatch(/backupStatus/);
    expect(overview).not.toMatch(/BackupState/);
    expect(overview).not.toMatch(/BACKUP_LABELS/);
    expect(overview).not.toMatch(/last_export_at/);
  });

  it("never calls listEventsSince from the catalog surface", () => {
    expect(overview).not.toMatch(/listEventsSince/);
    expect(overview).not.toMatch(/package\.exported/);
  });

  it("does not render the legacy backup status strings", () => {
    expect(overview).not.toMatch(/Резервная копия/);
    expect(overview).not.toMatch(/Состояние резервной копии/);
  });
});


describe("Trash view has been removed from v1 shell", () => {
  it("no TrashView.tsx exists in the source tree", () => {
    expect(existsSync(path.resolve("src/modules/base/features/trash/TrashView.tsx"))).toBe(false);
  });
});

describe("Capabilities: recovery contract available in Baseline 1.2 full mode", () => {
  it("v1 dev-mock (full mode) reports recoveryContract=available", () => {
    const c = capabilities(createDevMockClient({ mode: "full" }));
    expect(c.recoveryContract).toBe("available");
    expect(c.canRestore).toBe(true);
    expect(c.canPurge).toBe(true);
  });

  it("stripping recovery ops from a full session downgrades to unavailable", () => {
    const base = createDevMockClient({ mode: "full" });
    const session = {
      ...base,
      granted_operations: base.granted_operations.filter(
        (op) =>
          op !== "t1.restoreWorkspace" &&
          op !== "t1.purgePreview" &&
          op !== "t1.purgeCommit",
      ),
    };
    const c = capabilities(session);
    expect(c.canRestore).toBe(false);
    expect(c.canPurge).toBe(false);
    expect(c.recoveryContract).toBe("unavailable");
  });

  it("partial purge grant (preview without commit) does NOT enable purge", () => {
    const base = createDevMockClient({ mode: "full" });
    const session = {
      ...base,
      granted_operations: [
        ...base.granted_operations.filter(
          (op) => op !== "t1.purgeCommit" && op !== "t1.purgePreview",
        ),
        "t1.purgePreview",
      ],
    };
    const c = capabilities(session);
    expect(c.canPurge).toBe(false);
  });
});
