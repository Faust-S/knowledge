import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const SNAP = resolve(process.cwd(), "src/kernel-client/contracts/runtime-1.2.0");
const EXPECTED_SCHEMAS = [
  "asset.schema.json",
  "current-manifest.schema.json",
  "domain-config.schema.json",
  "import-export.schema.json",
  "iwxa-event.schema.json",
  "object.schema.json",
  "package-manifest.schema.json",
  "package-schema.schema.json",
  "relation.schema.json",
  "service-passport.schema.json",
  "service-schema-declaration.schema.json",
  "validation-report.schema.json",
  "workspace.schema.json",
];

const EXPECTED_CAPABILITY_SCHEMAS = [
  "IWXA_T2_Capability_Bootstrap_Instance_Schema_v0.3.1.json",
  "IWXA_T2_Capability_Grant_Schema_v0.3.1.json",
  "IWXA_T2_Capability_Guard_Contract_v0.3.1.json",
  "IWXA_T2_Capability_Issuance_Policy_Schema_v0.3.1.json",
  "IWXA_T2_Capability_Lifetime_Resolution_Contract_v0.3.1.json",
  "IWXA_T2_Capability_Receipt_Schema_v0.3.1.json",
  "IWXA_T2_Capability_Service_Declaration_Schema_v0.3.1.json",
  "IWXA_T2_Capability_Signature_Profile_Registry_v0.3.1.json",
  "IWXA_T2_Capability_Trusted_Issuer_Entry_Schema_v0.3.1.json",
  "IWXA_T2_Package_Manifest_1.1_Capability_FROZEN_Schema_v0.3.1.json",
];

describe("runtime-1.2.0 snapshot", () => {
  it("snapshot directory exists", () => {
    expect(existsSync(SNAP)).toBe(true);
  });
  it("index.ts exists", () => {
    expect(existsSync(resolve(SNAP, "index.ts"))).toBe(true);
  });
  it("error-catalogue.ts exists", () => {
    expect(existsSync(resolve(SNAP, "error-catalogue.ts"))).toBe(true);
  });
  it("has exactly 13 runtime schemas matching inventory", () => {
    const found = readdirSync(resolve(SNAP, "schemas"))
      .filter((f) => f.endsWith(".schema.json"))
      .sort();
    expect(found).toEqual([...EXPECTED_SCHEMAS].sort());
    expect(found).toHaveLength(13);
  });
  it("has exactly 10 frozen capability schemas", () => {
    const found = readdirSync(resolve(SNAP, "schemas/capability"))
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect(found).toEqual([...EXPECTED_CAPABILITY_SCHEMAS].sort());
    expect(found).toHaveLength(10);
  });
  it("provenance holds Phase D metadata", () => {
    const p = JSON.parse(readFileSync(resolve(SNAP, "provenance.json"), "utf8"));
    expect(p.snapshot_version).toBe("runtime-1.2.0");
    expect(p.runtime_version).toBe("0.3.5");
    expect(p.contract_version).toBe("1.2.0");
    expect(p.contract_status).toBe("phase-d-candidate-not-locked");
    expect(p.source_kernel_verified_baseline_sha256).toBe("4b40dcbb0a9dfca1db8cad17c7c204ab8801c8b1d95ff249cedee64ebb3563fe");
    expect(p.capability_freeze_version).toBe("0.4.2");
    expect(p.capability_freeze_sha256).toBe("97d2353d237867385a6f77d04ea2fd1312b4d510e6474c4858218384c10c7024");
    expect(p.legacy_capability_schema_snapshot_version).toBe("0.3.1");
    expect(p.legacy_capability_schema_snapshot_sha256).toBe("05fc2ba1a6e2974ee746c5bb7e43359dd1454aaba4e5b5b2e2676b28e17d9cfe");
    expect(p.security04_authority).toBe("Kernel-only; Workspace consumes authorization view and never verifies trust metadata");
    expect(p.source_package_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.local_store_name).toBe("iwxa-local");
    expect(p.local_store_db_version).toBe(6);
  });
  it("public-api.ts does not define contract types", () => {
    const src = readFileSync(resolve(SNAP, "public-api.ts"), "utf8");
    expect(/\b(interface|type)\s+[A-Z]/.test(src)).toBe(false);
    expect(src).toMatch(/export \* from "\.\/index"/);
  });
  it("snapshot files do not import Workspace UI", () => {
    for (const f of ["index.ts", "error-catalogue.ts", "public-api.ts"]) {
      const src = readFileSync(resolve(SNAP, f), "utf8");
      expect(src).not.toMatch(/from ["'].*\/(features|shell|renderers|components|profiles)\//);
      expect(src).not.toMatch(/\bfetch\s*\(/);
    }
  });
  it("schemas contain no remote $schema URLs beyond json-schema.org meta", () => {
    for (const s of EXPECTED_SCHEMAS) {
      const j = JSON.parse(readFileSync(resolve(SNAP, "schemas", s), "utf8"));
      if (j.$schema) {
        expect(j.$schema).toMatch(/^https:\/\/json-schema\.org\//);
      }
    }
  });
  it("legacy v1 contract directory is untouched", () => {
    expect(existsSync(resolve(process.cwd(), "src/kernel-client/contracts/v1"))).toBe(true);
  });
});
