#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const SNAP = resolve(ROOT, "src/config/schemas/keys-2.0");
const SCHEMAS = [
  "domain-config.schema.json",
  "domain-key.schema.json",
  "domain-shell.schema.json",
  "workspace-config.schema.json",
  "workspace-module-manifest.schema.json",
];
const errors = [];
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

if (!existsSync(SNAP)) errors.push("missing snapshot directory");
const provPath = resolve(SNAP, "provenance.json");
let provenance = null;
if (!existsSync(provPath)) errors.push("missing provenance.json");
else provenance = JSON.parse(readFileSync(provPath, "utf8"));

if (existsSync(SNAP)) {
  const found = readdirSync(SNAP).filter((f) => f.endsWith(".schema.json")).sort();
  const expected = [...SCHEMAS].sort();
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    errors.push(`schema inventory mismatch: expected ${expected.join(",")}, got ${found.join(",")}`);
  }
  for (const name of SCHEMAS) {
    const file = resolve(SNAP, name);
    if (!existsSync(file)) { errors.push(`missing snapshot file: ${name}`); continue; }
    const expectedHash = provenance?.files?.[name];
    if (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedHash)) {
      errors.push(`provenance hash missing/invalid: ${name}`);
    } else if (sha(file) !== expectedHash) {
      errors.push(`snapshot hash mismatch: ${name}`);
    }
  }
}

if (provenance) {
  if (provenance.source_package !== "IWXA_Domain_Keys_2.0_RU") errors.push("provenance.source_package invalid");
  if (provenance.package_version !== "2.0") errors.push("provenance.package_version invalid");
  if (provenance.schema_count !== 5) errors.push("provenance.schema_count != 5");
  if (provenance.status !== "workspace-host-derived-from-domain-keys-2.0") errors.push("provenance.status invalid");
  if (!provenance.source_files || typeof provenance.source_files !== "object") errors.push("provenance.source_files missing");
  if (!provenance.derived_files || typeof provenance.derived_files !== "object") errors.push("provenance.derived_files missing");
  for (const name of ["domain-config.schema.json","domain-key.schema.json","domain-shell.schema.json"]) {
    if (provenance.files?.[name] !== provenance.source_files?.[name]) errors.push(`unchanged source parity mismatch: ${name}`);
  }
  for (const name of ["workspace-config.schema.json","workspace-module-manifest.schema.json"]) {
    if (typeof provenance.derived_files?.[name] !== "string") errors.push(`derived provenance missing: ${name}`);
  }
}

if (errors.length) {
  console.error("Domain Keys 2.0 snapshot verification failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log(`Domain Keys 2.0 Workspace-derived schema set verified: ${SCHEMAS.length}/5 schemas, source/current provenance hashes PASS.`);
