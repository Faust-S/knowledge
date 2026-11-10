// @vitest-environment node
/**
 * Documentation regression test — the frozen contract README MUST list the
 * canonical v1 method signatures used by this shell, and MUST NOT drift
 * back to the pre-canonical shapes (id-only objects, byte-based
 * importCommit, single-argument getObject, etc.).
 *
 * This checks documentation as data — not TypeScript types — so a stale
 * README cannot silently coexist with a correct implementation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const README = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "kernel-client",
    "contracts",
    "v1",
    "README.md",
  ),
  "utf8",
);

const REQUIRED_FORMS: readonly string[] = [
  "t1.getObject(workspace_id, object_id)",
  "t1.createWorkspace({ workspace_id, profile, capabilities?, read_only? })",
  "object_id",
  "schema_version",
  "base_revision",
  "t2.importPreview(bytes)",
  "t2.importCommit({ preview_token, package_digest, plan })",
  "t2.importCancel(preview_token)",
];

// Substrings that unambiguously identify the pre-canonical shapes. We look
// for prefixes (not full lines) so the check is robust to trailing type
// annotations while still catching the legacy signatures verbatim.
const FORBIDDEN_FORMS: readonly string[] = [
  "importCommit(zipBytes, plan)",
  "getObject(workspace_id, id)",
  "putObject({ workspace_id, schema_id, id",
  "deleteObject({ workspace_id, id",
];

describe("kernel-client/contracts/v1/README.md — canonical v1 documentation", () => {
  for (const needle of REQUIRED_FORMS) {
    it(`documents required form: ${needle}`, () => {
      expect(
        README.includes(needle),
        `README is missing required contract form: ${needle}`,
      ).toBe(true);
    });
  }

  for (const needle of FORBIDDEN_FORMS) {
    it(`does not mention legacy form: ${needle}`, () => {
      expect(
        README.includes(needle),
        `README still mentions removed pre-canonical form: ${needle}`,
      ).toBe(false);
    });
  }
});
