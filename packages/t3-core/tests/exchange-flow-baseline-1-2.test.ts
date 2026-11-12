/**
 * PROMPT 23 §19 — Exchange flow Baseline 1.2 tests.
 *
 * Ten focused scenarios covering export freshness, download vs
 * confirm split, import mode/conflict enforcement, plan validation,
 * commit guard, token cancel semantics, and the host-owned catalog
 * refresh bus.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  INITIAL_EXPORT_STATE,
  exportReducer,
  selectionsEqual,
  toExportOptions,
} from "@/modules/exchange/features/state/export-machine";
import type { WorkspaceRecord } from "@/kernel-client";
import type { PackageArtifact, ExportPreview, ConfirmExportReceipt } from "@/kernel-client/contracts/v1";
import {
  INITIAL_IMPORT_STATE,
  importReducer,
  validateImportPlan,
  toKernelImportPlan,
  DEFAULT_CONFLICT_POLICY,
} from "@/modules/exchange/features/state/import-machine";
import type { ImportPreview, SecureImportPreview } from "@/kernel-client/contracts/v1";
import { catalogRefreshService } from "@/modules/base/services/catalog-refresh-service";


const ws = (id: string): WorkspaceRecord => ({
  workspace_id: id, profile: "generic", created_at: "", updated_at: "",
  created_by_service: "svc", updated_by_service: "svc", schema_version: "1.0.0",
  deleted_at: null,
} as unknown as WorkspaceRecord);

const preview: ExportPreview = {
  workspaces: ["a"],
  counts: { workspaces: 1, objects: 2, events: 3, relations: 0, assets: 0, schemas: 1 },
  approx_bytes: 42,
  summary: { included: { workspaces: 1, objects: 2, events: 3, relations: 0, assets: 0, schemas: 1 },
             excluded_by_permission: { workspaces: 0, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
             scope_mode: "workspace" },
  unsupported: [], conflicts: [],
};

const artifact: PackageArtifact = {
  filename: "a.iwxa", bytes: new Uint8Array([1, 2, 3]), size: 3,
  package_digest: "sha256-a", semantic_digest: "sem-a",
  manifest: {
    format: "iwxa.package", format_version: "1.0", encryption: "none", created_at: "",
    workspaces: ["a"], workspace_states: [], options: {
      include_history: true, include_assets: true, include_relations: true, include_schemas: true,
    },
    counts: preview.counts, files: [], package_digest: "sha256-a", semantic_digest: "sem-a",
  },
  validation: { format: "iwxa.package.validation", ok: true, checked_at: "",
    file_count: 0, object_count: 2, schema_issues: [], path_issues: [] },
  summary: preview.summary,
};

const receipt: ConfirmExportReceipt = {
  confirmed_at: "2026-07-25T12:00:00Z", package_digest: "sha256-a",
  workspace_ids: ["a"], confirmations: 1,
};

describe("Exchange Baseline 1.2 — export state machine", () => {
  it("§3 freshness: option change past ready invalidates preview, artifact, receipt and ack", () => {
    let s = INITIAL_EXPORT_STATE;
    s = exportReducer(s, { type: "load-workspaces" });
    s = exportReducer(s, { type: "workspaces-loaded", catalog: [ws("a")], initialWorkspaces: ["a"] });
    s = exportReducer(s, { type: "preview-started" });
    s = exportReducer(s, { type: "preview-succeeded", preview });
    s = exportReducer(s, { type: "ack-sensitive", value: true });
    s = exportReducer(s, { type: "package-started" });
    s = exportReducer(s, { type: "package-succeeded", artifact });
    expect(s.status).toBe("package-ready");
    // toggle an unrelated flag
    s = exportReducer(s, { type: "set-selection", selection: { include_history: false } });
    expect(s.preview).toBeNull();
    expect(s.artifact).toBeNull();
    expect(s.receipt).toBeNull();
    expect(s.ackSensitive).toBe(false);
    expect(s.status).toBe("ready");
  });

  it("§5 download and confirm are separate actions with distinct states", () => {
    let s = INITIAL_EXPORT_STATE;
    s = exportReducer(s, { type: "load-workspaces" });
    s = exportReducer(s, { type: "workspaces-loaded", catalog: [ws("a")], initialWorkspaces: ["a"] });
    s = exportReducer(s, { type: "preview-started" });
    s = exportReducer(s, { type: "preview-succeeded", preview });
    s = exportReducer(s, { type: "ack-sensitive", value: true });
    s = exportReducer(s, { type: "package-started" });
    s = exportReducer(s, { type: "package-succeeded", artifact });
    s = exportReducer(s, { type: "download-initiated" });
    expect(s.status).toBe("download-initiated");
    expect(s.receipt).toBeNull();
    s = exportReducer(s, { type: "ack-file-saved", value: true });
    s = exportReducer(s, { type: "confirm-started" });
    s = exportReducer(s, { type: "confirm-succeeded", receipt });
    expect(s.status).toBe("confirmed");
    expect(s.receipt?.confirmed_at).toBe("2026-07-25T12:00:00Z");
    expect(s.receipt?.package_digest).toBe("sha256-a");
  });

  it("§3 selectionsEqual detects order-independent workspace equality", () => {
    expect(selectionsEqual(
      { workspaces: ["a", "b"], include_history: true, include_assets: true, include_relations: true, include_schemas: true },
      { workspaces: ["b", "a"], include_history: true, include_assets: true, include_relations: true, include_schemas: true },
    )).toBe(true);
  });

  it("toExportOptions round-trips selection fields", () => {
    const o = toExportOptions({
      workspaces: ["x"], include_history: false, include_assets: true,
      include_relations: true, include_schemas: false,
    });
    expect(o).toEqual({
      workspaces: ["x"], include_history: false, include_assets: true,
      include_relations: true, include_schemas: false,
    });
  });
});

const importPreviewBody: ImportPreview = {
  format: "iwxa.import.preview", format_version: "1.0",
  manifest: {
    format: "iwxa.package", format_version: "1.0", encryption: "none", created_at: "",
    workspaces: ["a"], workspace_states: [],
    options: { include_history: true, include_assets: true, include_relations: true, include_schemas: true },
    counts: { workspaces: 1, objects: 1, events: 0, relations: 0, assets: 0, schemas: 1 },
    files: [], package_digest: "d", semantic_digest: "sd",
  },
  package_digest: "d", semantic_digest: "sd", bytes: 10,
  totals: { files: 0, workspaces: 1, objects: 1, events: 0, relations: 0, assets: 0, schemas: 1 },
  workspaces: [{ workspace_id: "a", exists_locally: false, incoming_objects: 1,
    incoming_events: 0, incoming_relations: 0, incoming_assets: 0 }],
  schemas: [], objects: [], conflicts: [], unsupported: [], warnings: [],
  invalid: { envelopes: 0, dependencies: 0, schema_validation: 0, schema_conflicts: 0 },
  included: { workspaces: 1, objects: 1, events: 0, relations: 0, assets: 0, schemas: 1 },
  excluded_by_permission: { workspaces: 0, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  scope_mode: "workspace",
} as unknown as ImportPreview;

const secure: SecureImportPreview = {
  preview_token: "tok", package_digest: "d", semantic_digest: "sd",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  allowed_modes: ["selective", "merge"],
  preview: importPreviewBody,
};

describe("Exchange Baseline 1.2 — import state machine", () => {
  it("§8 preview-succeeded seeds plan from allowed_modes and preview workspaces", () => {
    let s0 = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    const s = importReducer(s0, {
      type: "preview-succeeded",
      handle: { ...secure, allowed_modes: secure.allowed_modes },
    });
    expect(s.status).toBe("preview-ready");
    expect(s.plan.mode).toBe("selective");
    expect(s.plan.include_workspaces).toEqual(["a"]);
    expect(s.plan.conflict).toBe(DEFAULT_CONFLICT_POLICY);
  });

  it("§10, §11 ImportMode restricted to allowed_modes; ConflictPolicy default is 'fail'", () => {
    const issues = validateImportPlan(
      { mode: "full", conflict: "fail", include_workspaces: ["a"],
        include_history: true, include_assets: true, include_relations: true },
      ["selective", "merge"],
      ["a"], [],
    );
    expect(issues.some((v) => v.includes("allowed_modes"))).toBe(true);
    expect(DEFAULT_CONFLICT_POLICY).toBe("fail");
  });

  it("§12 plan validation rejects selective mode without workspaces and unknown workspaces", () => {
    const empty = validateImportPlan(
      { mode: "selective", conflict: "fail", include_workspaces: [],
        include_history: true, include_assets: true, include_relations: true },
      ["selective"], ["a"], [],
    );
    expect(empty.length).toBeGreaterThan(0);
    const unknown = validateImportPlan(
      { mode: "selective", conflict: "skip", include_workspaces: ["z"],
        include_history: true, include_assets: true, include_relations: true },
      ["selective"], ["a"], [],
    );
    expect(unknown.some((v) => v.includes("отсутствует"))).toBe(true);
  });

  it("§8, §14 cancel returns to a clean cancelled state (no token, no handle)", () => {
    let s = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    s = importReducer(s, { type: "preview-succeeded", handle: secure });
    s = importReducer(s, { type: "cancel", reason: "explicit" });
    expect(s.status).toBe("cancelled");
    expect(s.handle).toBeNull();
    expect(s.receipt).toBeNull();
  });

  it("§9 expire clears state with 'preview_token_expired'", () => {
    let s = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    s = importReducer(s, { type: "preview-succeeded", handle: secure });
    s = importReducer(s, { type: "expire" });
    expect(s.status).toBe("expired");
    expect(s.error).toBe("preview_token_expired");
  });

  it("§13 commit-started blocked when plan has validation issues", () => {
    let s = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    s = importReducer(s, { type: "preview-succeeded", handle: secure });
    s = importReducer(s, { type: "set-plan", plan: { mode: "full" } });
    expect(s.planValidation.length).toBeGreaterThan(0);
    const s2 = importReducer(s, { type: "commit-started" });
    expect(s2.status).toBe("preview-ready");
  });

  it("toKernelImportPlan preserves mode, conflict, and toggles", () => {
    const p = toKernelImportPlan({
      mode: "selective", conflict: "overwrite", include_workspaces: ["a"],
      include_history: false, include_assets: true, include_relations: false,
    });
    expect(p).toEqual({
      mode: "selective", conflict: "overwrite", include_workspaces: ["a"],
      include_history: false, include_assets: true, include_relations: false,
    });
  });
});

describe("Exchange Baseline 1.2 — catalog refresh service (§16, rewired PROMPT 29 §5)", () => {
  beforeEach(() => catalogRefreshService.activate());

  it("delivers reason to subscribers and unsubscribe stops delivery", () => {
    const seen: string[] = [];
    const off = catalogRefreshService.subscribe((r) => seen.push(r));
    catalogRefreshService.notify("import.committed");
    catalogRefreshService.notify("manual");
    off();
    catalogRefreshService.notify("workspace.mutated");
    expect(seen).toEqual(["import.committed", "manual"]);
  });

  it("isolates listener errors so one failure does not block others", () => {
    const seen: string[] = [];
    catalogRefreshService.subscribe(() => { throw new Error("boom"); });
    catalogRefreshService.subscribe(() => seen.push("ok"));
    catalogRefreshService.notify("manual");
    expect(seen).toEqual(["ok"]);
  });
});


describe("Exchange Baseline 1.2 — static entry (§17)", () => {
  it("workspace/exchange/index.html is a Vite multi-entry (exchange.html at project root, base=/workspace/exchange/)", () => {
    const html = readFileSync(path.resolve("exchange.html"), "utf8");
    expect(html).toMatch(/base href="\/workspace\/exchange\/"/);
    expect(html).toMatch(/src\/main\.tsx/);
    const vite = readFileSync(path.resolve("vite.config.ts"), "utf8");
    expect(vite).toMatch(/exchange\.html/);
    expect(vite).toMatch(/rollupOptions/);
  });
});
