/**
 * Source-level assertions for the Baseline 1.2 real-kernel harness.
 * Reads the harness source directly — no kernel artifact required.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const harness = readFileSync(
  resolve(process.cwd(), "scripts/real-kernel-e2e.mjs"),
  "utf8",
);

describe("real-kernel harness — Baseline 1.2 surface", () => {
  const mustInclude = [
    "t2.exportPreview",
    "t2.confirmExport",
    "t1.softDeleteWorkspace",
    "t1.restoreWorkspace",
    "t1.purgePreview",
    "t1.purgeCancel",
    "t1.purgeCommit",
    "/workspace/exchange/",
    "/workspace/lifecycle/",
    'data-testid="host-dashboard-surface"',
    'data-testid="rich-workspace-read-model"',
    'data-testid="rich-workspace-saved-view-previews"',
    '"Объекты", "rich-workspace-master-detail"',
    '"Очереди", "rich-workspace-queues"',
    '"Сравнение", "rich-workspace-compare"',
    '"Receipts", "rich-workspace-receipts-boundary"',
  ];
  for (const token of mustInclude) {
    it(`references ${token}`, () => {
      expect(harness).toContain(token);
    });
  }

  const mustNotInclude = [
    "v1 has no recovery contract",
    "purge_asserted: false",
  ];
  for (const token of mustNotInclude) {
    it(`does not reference legacy phrase: ${token}`, () => {
      expect(harness).not.toContain(token);
    });
  }

  it("ships the favicon required by the disposable workspace host", () => {
    expect(existsSync(resolve(process.cwd(), "public", "favicon.ico"))).toBe(true);
  });
});
