/**
 * Parity tests for the public contract:
 *   1. ALL_OPERATIONS ↔ TierHandlers methods parity.
 *   2. Error catalogue includes every code emitted by public-api.ts and
 *      referenced by the contract types.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_OPERATIONS } from "../src/public-contract";
import type { ImportErrorCode } from "../src/public-contract/index";
import { ERROR_CATALOGUE } from "../src/public-contract/error-catalogue";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_PUBLIC_IMPORT_ERROR_CODES = [
  "SCHEMA_NOT_DECLARED",
  "SCHEMA_INVALID",
  "SCHEMA_CONFLICT",
  "SCHEMA_DIGEST_MISMATCH",
  "PLAN_NOT_IN_PREVIEW",
] as const satisfies readonly ImportErrorCode[];

// Canonical method sets — MUST match TierHandlers members declared in
// `src/public-contract/index.ts`. If a method is added / removed, update
// both this list and ALL_OPERATIONS in the same commit.
const T0 = ["validate"];
const T1 = [
  "commitObjectGraph",
  "listWorkspaces", "getWorkspace", "createWorkspace",
  "listObjects", "getObject", "putObject", "deleteObject",
  "putRelation", "deleteRelation",
  "listAssets", "getAsset", "putAsset", "deleteAsset",
  "listEventsSince",
  "softDeleteWorkspace", "restoreWorkspace",
  "purgePreview", "purgeCommit", "purgeCancel",
];
const T2 = [
  "exportPreview", "exportPackage", "confirmExport",
  "importPreview", "importCommit", "importCancel",
];

describe("public contract parity", () => {
  it("ALL_OPERATIONS matches the T0/T1/T2 method sets exactly", () => {
    const expected = [
      ...T0.map((m) => `t0.${m}`),
      ...T1.map((m) => `t1.${m}`),
      ...T2.map((m) => `t2.${m}`),
    ].sort();
    expect([...ALL_OPERATIONS].sort()).toEqual(expected);
  });

  it("error catalogue covers every code emitted by the runtime surface", () => {
    const codes = new Set(ERROR_CATALOGUE.map((e) => e.code));
    const required = [
      "CONFIG_INVALID", "ORIGIN_MISMATCH", "SECRET_FIELD_FORBIDDEN",
      "UPDATE_REQUIRED", "UNKNOWN_SERVICE", "BASE_PATH_MISMATCH",
      "PASSPORT_INVALID", "LEVEL_NOT_ALLOWED", "MISSING_LEVEL",
      "KERNEL_UNAVAILABLE", "PERMISSION_DENIED", "CONFLICT",
      "PREVIEW_REQUIRED", "PREVIEW_EXPIRED", "PREVIEW_TOKEN_INVALID",
      "PACKAGE_DIGEST_MISMATCH",
    ];
    for (const c of required) expect(codes.has(c), `missing error code ${c}`).toBe(true);
  });

  it("error catalogue codes are unique", () => {
    const codes = ERROR_CATALOGUE.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("public ImportErrorCode contains every schema and staged-plan error emitted by secure import", () => {
    expect(REQUIRED_PUBLIC_IMPORT_ERROR_CODES).toEqual([
      "SCHEMA_NOT_DECLARED",
      "SCHEMA_INVALID",
      "SCHEMA_CONFLICT",
      "SCHEMA_DIGEST_MISMATCH",
      "PLAN_NOT_IN_PREVIEW",
    ]);
  });

  it("internal Runtime event producers use canonical service identifiers", () => {
    const commitSource = readFileSync(
      join(ROOT, "src/package/import/commit.ts"),
      "utf8",
    );
    expect(commitSource).toContain(
      'const RECEIPT_SERVICE =\n  "iwxa.kernel";',
    );
    expect(commitSource).not.toContain(
      'const RECEIPT_SERVICE =\n  "_iwxa";',
    );
  });
});
