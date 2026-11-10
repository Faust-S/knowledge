/**
 * Real-kernel Stage C integration test (Baseline 1.2).
 *
 * Drives the frozen v1 kernel through the harness in
 * `scripts/real-kernel-e2e.mjs` and asserts the full receipt boolean
 * matrix (export_confirmed, import_committed, import_cancelled,
 * restore_asserted, purge_cancelled, purge_asserted,
 * static_routes_asserted).
 *
 * The kernel artifact lives outside this repo. When it is missing the
 * test SKIPs with the reason `REAL_KERNEL_ARTIFACT_MISSING`. Setting
 * `IWXA_REAL_KERNEL_REQUIRED=1` (or `CI=true`) converts the skip into
 * a hard failure. The dev-mock is NEVER substituted.
 */
import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

function locateKernelArtifact(): string | null {
  const looksLikeIwxa = (dir: string) =>
    existsSync(resolve(dir, "domain.json")) &&
    existsSync(resolve(dir, "loader.js"));

  const candidates = [
    process.env.IWXA_KERNEL_ARTIFACT_DIR,
    resolve(process.cwd(), "real-kernel"),
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    const p = resolve(raw);
    if (!existsSync(p) || !statSync(p).isDirectory()) continue;
    const inner = resolve(p, "_iwxa");
    if (
      existsSync(inner) &&
      statSync(inner).isDirectory() &&
      looksLikeIwxa(inner)
    ) {
      return p;
    }
    if (looksLikeIwxa(p)) return p;
  }
  return null;
}

describe("real-kernel integration (Baseline 1.2)", () => {
  const artifact = locateKernelArtifact();
  const required =
    process.env.IWXA_REAL_KERNEL_REQUIRED === "1" || process.env.CI === "true";

  if (!artifact) {
    const reason =
      "REAL_KERNEL_ARTIFACT_MISSING: expected either " +
      "<dir>/_iwxa/{domain.json,loader.js} or <dir>/{domain.json,loader.js} " +
      "under $IWXA_KERNEL_ARTIFACT_DIR or ./real-kernel";
    if (required) {
      it("real kernel artifact is present", () => {
        throw new Error(reason);
      });
    } else {
      it.skip(`skipped — ${reason}`, () => {});
    }
    return;
  }

  it(
    "Stage C: envelope + main WS + export + import + cancel + restore + purge + routes",
    async () => {
      const { runRealKernelRoundtrip } = await import(
        /* @vite-ignore */ "../../scripts/real-kernel-e2e.mjs"
      );
      const receipt = await runRealKernelRoundtrip({ artifactDir: artifact });

      expect(receipt.source).toBe("real-kernel");

      // Envelope
      expect(receipt.envelope.contract_version).toBe("1.2.0");
      expect(receipt.envelope.runtime_version).toBe("0.3.5");
      expect(receipt.envelope.granted_levels).toEqual(
        expect.arrayContaining(["T1", "T2"]),
      );
      for (const op of [
        "t1.createWorkspace",
        "t1.listWorkspaces",
        "t1.getWorkspace",
        "t1.putObject",
        "t1.listObjects",
        "t1.getObject",
        "t1.softDeleteWorkspace",
        "t1.restoreWorkspace",
        "t1.purgePreview",
        "t1.purgeCommit",
        "t1.purgeCancel",
        "t2.exportPreview",
        "t2.exportPackage",
        "t2.confirmExport",
        "t2.importPreview",
        "t2.importCommit",
        "t2.importCancel",
      ]) {
        expect(receipt.envelope.granted_operations).toContain(op);
      }

      // Boolean receipt matrix — all must be true.
      expect(receipt.export_confirmed).toBe(true);
      expect(receipt.import_committed).toBe(true);
      expect(receipt.import_cancelled).toBe(true);
      expect(receipt.restore_asserted).toBe(true);
      expect(receipt.purge_cancelled).toBe(true);
      expect(receipt.purge_asserted).toBe(true);
      expect(receipt.static_routes_asserted).toBe(true);

      // DOM verification at the canonical object route of the main WS.
      expect(receipt.dom.route).toBe(
        `#/workspace/${receipt.main_workspace_id}/object/${receipt.object_id}`,
      );
      expect(receipt.dom.object_view_visible).toBe(true);
      expect(receipt.dom.dom_contains_object_id).toBe(true);

      expect(receipt.console_errors).toEqual([]);
      expect(receipt.page_errors).toEqual([]);
      expect(receipt.request_failures).toEqual([]);
      expect(receipt.bad_responses).toEqual([]);
    },
    180_000,
  );
});
