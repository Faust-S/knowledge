#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const SNAP = resolve(ROOT, "src/kernel-client/contracts/runtime-1.2.0");
const PROVENANCE = resolve(SNAP, "provenance.json");
const CAPABILITY_FREEZE_SHA256 = "97d2353d237867385a6f77d04ea2fd1312b4d510e6474c4858218384c10c7024";
const LEGACY_CAPABILITY_FREEZE_SHA256 = "05fc2ba1a6e2974ee746c5bb7e43359dd1454aaba4e5b5b2e2676b28e17d9cfe";
const VERIFIED_KERNEL_019_SHA256 = "4b40dcbb0a9dfca1db8cad17c7c204ab8801c8b1d95ff249cedee64ebb3563fe";
const KERNEL_035_PACKAGE_SHA256 = "1c484218cfb86d776d57a3bd21f9b1ad606840e93711474a346dd1989352ce73";
const BASE_SCHEMAS = [
  "asset.schema.json", "current-manifest.schema.json", "domain-config.schema.json",
  "import-export.schema.json", "iwxa-event.schema.json", "object.schema.json",
  "package-manifest.schema.json", "package-schema.schema.json", "relation.schema.json",
  "service-passport.schema.json", "service-schema-declaration.schema.json",
  "validation-report.schema.json", "workspace.schema.json",
];
const CAPABILITY_SCHEMAS = [
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

const errors = [];
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

if (!existsSync(PROVENANCE)) errors.push("missing provenance.json");
let provenance = null;
if (existsSync(PROVENANCE)) {
  provenance = JSON.parse(readFileSync(PROVENANCE, "utf8"));
  const expected = {
    snapshot_version: "runtime-1.2.0",
    runtime_version: "0.3.5",
    contract_version: "1.2.0",
    contract_status: "phase-d-candidate-not-locked",
    source_project: "iwxa-domain-kernel",
    source_kernel_verified_baseline_sha256: VERIFIED_KERNEL_019_SHA256,
    capability_freeze_version: "0.4.2",
    capability_freeze_sha256: CAPABILITY_FREEZE_SHA256,
    local_store_name: "iwxa-local",
    local_store_db_version: 6,
  };
  for (const [k,v] of Object.entries(expected)) {
    if (provenance[k] !== v) errors.push(`provenance.${k} mismatch: ${String(provenance[k])}`);
  }
  if (provenance.source_package_sha256 !== KERNEL_035_PACKAGE_SHA256) {
    errors.push(`provenance.source_package_sha256 mismatch: expected exact Kernel 0.3.5 package ${KERNEL_035_PACKAGE_SHA256}, got ${String(provenance.source_package_sha256)}`);
  }
  if (!provenance.files || typeof provenance.files !== "object" || Array.isArray(provenance.files)) {
    errors.push("provenance.files missing");
  } else {
    for (const [rel, expectedHash] of Object.entries(provenance.files)) {
      const path = resolve(SNAP, rel);
      if (!existsSync(path)) { errors.push(`missing snapshot file: ${rel}`); continue; }
      const actual = sha(path);
      if (actual !== expectedHash) errors.push(`snapshot hash mismatch: ${rel}`);
    }
  }
}

const baseDir = resolve(SNAP, "schemas");
if (!existsSync(baseDir)) errors.push("missing schemas directory");
else {
  const found = readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".schema.json"))
    .map((e) => e.name).sort();
  if (JSON.stringify(found) !== JSON.stringify([...BASE_SCHEMAS].sort())) {
    errors.push(`base schema inventory mismatch: expected ${BASE_SCHEMAS.length}, got ${found.length}`);
  }
}
const capDir = resolve(SNAP, "schemas/capability");
if (!existsSync(capDir)) errors.push("missing capability schemas directory");
else {
  const found = readdirSync(capDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name).sort();
  if (JSON.stringify(found) !== JSON.stringify([...CAPABILITY_SCHEMAS].sort())) {
    errors.push(`capability schema inventory mismatch: expected ${CAPABILITY_SCHEMAS.length}, got ${found.length}`);
  }
}

// Optional byte-parity check against the exact unpacked Kernel 0.3.5 candidate.
if (provenance && (provenance.legacy_capability_schema_snapshot_version !== "0.3.1" || provenance.legacy_capability_schema_snapshot_sha256 !== LEGACY_CAPABILITY_FREEZE_SHA256)) errors.push("legacy capability compatibility snapshot provenance mismatch");
const kernelRoot = process.env.IWXA_KERNEL_ROOT ? resolve(process.env.IWXA_KERNEL_ROOT) : null;
if (kernelRoot) {
  const mappings = [
    ["index.ts", "src/public-contract/index.ts"],
    ["error-catalogue.ts", "src/public-contract/error-catalogue.ts"],
    ...BASE_SCHEMAS.map((n) => [`schemas/${n}`, `schemas/${n}`]),
    ...CAPABILITY_SCHEMAS.map((n) => [`schemas/capability/${n}`, `schemas/capability/${n}`]),
  ];
  for (const [snapRel, kernelRel] of mappings) {
    const a = resolve(SNAP, snapRel), b = resolve(kernelRoot, kernelRel);
    if (!existsSync(b)) { errors.push(`Kernel parity source missing: ${kernelRel}`); continue; }
    if (sha(a) !== sha(b)) errors.push(`Kernel byte parity mismatch: ${snapRel} != ${kernelRel}`);
  }
}

// The immutable historical snapshot remains a sibling; this verifier never rewrites it.
if (!existsSync(resolve(ROOT, "src/kernel-client/contracts/runtime-1.0.0"))) {
  errors.push("historical runtime-1.0.0 snapshot missing");
}

if (errors.length) {
  console.error("Runtime Contract 1.2.0 snapshot verification failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log(`Runtime Contract 1.2.0 snapshot verified: base=${BASE_SCHEMAS.length}, capability=${CAPABILITY_SCHEMAS.length}, provenance hashes PASS${kernelRoot ? ", Kernel byte parity PASS" : ""}.`);
