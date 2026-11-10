#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

const root = process.cwd();
const EXPECTED_KERNEL_SOURCE_SHA256 = "66244a39530cfbc2711140cbaadae1861d72324a2038b849e9bd08f3a86e9c25";
const EXPECTED_RUNTIME = "0.3.6";
const EXPECTED_CONTRACT = "1.2.0";
const pilotRoot = resolve(root, "fixtures/host-configs/learn-pilot");
const workspaceDist = resolve(process.env.IWXA_WORKSPACE_DIST ?? resolve(root, "dist"));
const kernelArtifactDir = resolve(process.env.IWXA_KERNEL_ARTIFACT_DIR ?? "");
const stageDir = resolve(process.env.IWXA_LEARN_STAGE_DIR ?? resolve(root, ".learn-pilot-stage"));
const kernelSourceZip = process.env.IWXA_KERNEL_SOURCE_ZIP ? resolve(process.env.IWXA_KERNEL_SOURCE_ZIP) : null;

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const fail = (code, details = {}) => {
  console.log(JSON.stringify({ schema: "IWXA_T2_LEARN_PILOT_STAGE_V1", status: "FAIL", code, ...details }, null, 2));
  process.exit(1);
};

function resolveIwxaRoot(raw) {
  if (!raw || !existsSync(raw) || !statSync(raw).isDirectory()) return null;
  if (existsSync(resolve(raw, "_iwxa/current.json"))) return resolve(raw, "_iwxa");
  if (existsSync(resolve(raw, "current.json"))) return raw;
  if (existsSync(resolve(raw, "overlay/_iwxa/current.json"))) return resolve(raw, "overlay/_iwxa");
  return null;
}

function treeDigest(dir) {
  const rows = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = resolve(current, name);
      const st = statSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) rows.push(`${sha256File(path)}  ${relative(dir, path).replaceAll("\\", "/")}\n`);
    }
  };
  walk(dir);
  return { files: rows.length, sha256_manifest_digest: createHash("sha256").update(rows.join("")).digest("hex") };
}

for (const name of ["domain.json", "domain-shell.json", "workspace.config.json"]) {
  if (!existsSync(resolve(pilotRoot, name))) fail("PILOT_CONFIG_MISSING", { file: name });
}
if (!existsSync(workspaceDist) || !statSync(workspaceDist).isDirectory()) fail("WORKSPACE_DIST_MISSING", { workspace_dist: workspaceDist });
if (!existsSync(resolve(workspaceDist, "index.html"))) fail("WORKSPACE_DIST_INVALID", { missing: "index.html" });

const iwxaRoot = resolveIwxaRoot(kernelArtifactDir);
if (!iwxaRoot) fail("KERNEL_EXECUTABLE_OVERLAY_MISSING", { kernel_artifact_dir: kernelArtifactDir });
const currentPath = resolve(iwxaRoot, "current.json");
const loaderPath = resolve(iwxaRoot, "loader.js");
const validatorPath = resolve(iwxaRoot, "validator.js");
const domainKernelPath = resolve(iwxaRoot, "domain.json");
for (const [id, path] of Object.entries({ loader: loaderPath, validator: validatorPath, kernel_domain: domainKernelPath })) {
  if (!existsSync(path)) fail("KERNEL_EXECUTABLE_OVERLAY_INCOMPLETE", { missing: id, path });
}
const current = readJson(currentPath);
if (current.runtime_version !== EXPECTED_RUNTIME || current.contract_version !== EXPECTED_CONTRACT) {
  fail("KERNEL_RUNTIME_BINDING_MISMATCH", { actual_runtime: current.runtime_version ?? null, actual_contract: current.contract_version ?? null });
}
const runtimeUrl = typeof current.runtime_url === "string" ? current.runtime_url : "";
const runtimeRelative = runtimeUrl.startsWith("/_iwxa/") ? runtimeUrl.slice("/_iwxa/".length) : runtimeUrl.replace(/^\//, "");
const runtimePath = resolve(iwxaRoot, runtimeRelative);
if (!runtimeRelative || !existsSync(runtimePath)) fail("KERNEL_EXECUTABLE_OVERLAY_INCOMPLETE", { missing: "runtime", runtime_url: runtimeUrl, runtime_path: runtimePath });

let kernelSource = { provided: false, exact: null, sha256: null, file: null };
if (kernelSourceZip) {
  if (!existsSync(kernelSourceZip) || !statSync(kernelSourceZip).isFile()) fail("KERNEL_SOURCE_ZIP_MISSING", { path: kernelSourceZip });
  const actual = sha256File(kernelSourceZip);
  if (actual !== EXPECTED_KERNEL_SOURCE_SHA256) fail("KERNEL_SOURCE_SHA_MISMATCH", { expected: EXPECTED_KERNEL_SOURCE_SHA256, actual });
  kernelSource = { provided: true, exact: true, sha256: actual, file: basename(kernelSourceZip) };
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(resolve(stageDir, "_iwxa"), { recursive: true });
mkdirSync(resolve(stageDir, "workspace"), { recursive: true });
cpSync(iwxaRoot, resolve(stageDir, "_iwxa"), { recursive: true });
cpSync(workspaceDist, resolve(stageDir, "workspace"), { recursive: true });
cpSync(resolve(pilotRoot, "domain.json"), resolve(stageDir, "_iwxa/domain.json"));
cpSync(resolve(pilotRoot, "domain-shell.json"), resolve(stageDir, "_iwxa/domain-shell.json"));
cpSync(resolve(pilotRoot, "workspace.config.json"), resolve(stageDir, "workspace/workspace.config.json"));

const domain = readJson(resolve(stageDir, "_iwxa/domain.json"));
const workspace = readJson(resolve(stageDir, "workspace/workspace.config.json"));
if (domain.domain_id !== "ru.iwxa.learn" || domain.origin !== "https://learn.iwxa.ru" || workspace.profile !== "learning") {
  fail("MATERIALIZED_CONFIG_IDENTITY_MISMATCH");
}

const receipt = {
  schema: "IWXA_T2_LEARN_PILOT_STAGE_V1",
  status: "PASS",
  domain_id: domain.domain_id,
  origin: domain.origin,
  workspace_profile: workspace.profile,
  workspace_service_id: workspace.workspace_service_id,
  runtime_version: current.runtime_version,
  contract_version: current.contract_version,
  runtime_url: runtimeUrl,
  kernel_source: kernelSource,
  executable_kernel: {
    current_sha256: sha256File(currentPath),
    loader_sha256: sha256File(loaderPath),
    validator_sha256: sha256File(validatorPath),
    runtime_sha256: sha256File(runtimePath),
  },
  workspace_dist: treeDigest(workspaceDist),
  stage_tree: treeDigest(stageDir),
  boundary: {
    workspace_build_mounted_at: "/workspace/",
    kernel_overlay_mounted_at: "/_iwxa/",
    host_owned_configs_override_kernel_domain: true,
    learning_business_write_owner: "NOT_BOUND_NO_AUTHORITY_INVENTED",
  },
};
writeFileSync(resolve(stageDir, "LEARN_PILOT_STAGE_RECEIPT.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
