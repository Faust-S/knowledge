#!/usr/bin/env node
/**
 * Build gate for ACTIVE T2 Host runtime. Historical frozen snapshots are out of scope.
 * Every domain materialized from this canonical Host inherits this gate.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const failures = [];
const expect = (ok, detail) => { if (!ok) failures.push(detail); };
const contract = "1.3.0";
const kernel = "0.3.6";

for (const id of ["base", "exchange", "lifecycle", "view-state"]) {
  const manifest = json(`src/modules/${id}/manifest.json`);
  expect(manifest.compatibility?.runtime_contract === contract, `module ${id}: runtime != ${contract}`);
}
const moduleSchema = json("src/config/schemas/keys-2.0/workspace-module-manifest.schema.json");
expect(moduleSchema.properties?.compatibility?.properties?.runtime_contract?.const === contract,
  "active module manifest schema is not locked to 1.3.0");
const hostSchema = json("src/config/schemas/keys-2.0/workspace-config.schema.json");
expect(hostSchema.properties?.host?.properties?.required_contract_version?.const === contract,
  "active Workspace Host schema is not locked to 1.3.0");
expect(hostSchema.properties?.host?.properties?.required_runtime_version?.const === kernel,
  "active Workspace Host schema is not locked to Kernel 0.3.6");
// Scan every materialized Host configuration, including domain-specific
// fixtures added after staging. A new T2 domain cannot bypass this rule.
const hostFixtures = join(root, "fixtures/host-configs");
for (const profile of readdirSync(hostFixtures, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name)) {
  const dir = join(hostFixtures, profile);
  expect(existsSync(join(dir, "workspace.config.json")) &&
    existsSync(join(dir, "domain.json")), `incomplete Host fixture ${profile}`);
  if (!existsSync(join(dir, "workspace.config.json")) ||
      !existsSync(join(dir, "domain.json"))) continue;
  const workspace = json(`fixtures/host-configs/${profile}/workspace.config.json`);
  const domain = json(`fixtures/host-configs/${profile}/domain.json`);
  expect(workspace.host?.required_contract_version === contract &&
    workspace.host?.required_runtime_version === kernel &&
    domain.runtime?.runtime_version === kernel,
    `active Host fixture ${profile} is not on the single runtime`);
}
// A build-time overlay is part of active source. Check every TS/TSX import,
// rather than maintaining a hand-curated list that could miss a new domain.
function activeSources(directory) {
  const found = [];
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (entry.name === "contracts" && directory === join(root, "src/kernel-client")) continue;
    // Immutable Factory 2.1 files are evidence, not the active Host runtime.
    if (entry.name === "factory2" && directory === join(root, "src")) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...activeSources(absolute));
    else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) found.push(absolute);
  }
  return found;
}
for (const file of activeSources(join(root, "src"))) {
  const value = readFileSync(file, "utf8");
  expect(!/from\s*["'][^"']*(?:contracts\/v1|contracts\/runtime-1\.2\.0)["']/.test(value),
    `obsolete contract import: ${file.slice(root.length + 1)}`);
}

if (failures.length) {
  console.error("T2_ACTIVE_RUNTIME_CONTRACT_HOLD");
  for (const failure of failures) console.error(" -", failure);
  process.exitCode = 1;
} else {
  console.log("T2_ACTIVE_RUNTIME_CONTRACT_SOURCE_PASS: Kernel 0.3.6 / Runtime Contract 1.3.0");
}
