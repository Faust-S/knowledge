import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { compareLiveT2Readback } from "./live-iwxa-client.mjs";

const MODULES = Object.freeze([
  "index.mjs", "kernel-reader.mjs", "live-iwxa-client.mjs",
]);
// Reuse the already-staged real T2 browser Host to exercise the D5 draft
// write/readback without loading a model or a second Runtime.
const WORKSPACE_DRAFT = "local-inference-draft.mjs";
const PUBLIC_MOUNT = "/_t3/activity/";

function deny(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function inside(root, child) {
  const rel = relative(root, child);
  return rel.length > 0 && rel !== ".." && !rel.startsWith(".." + sep) &&
    !isAbsolute(rel);
}

function regularFile(path) {
  return existsSync(path) && lstatSync(path).isFile() &&
    !lstatSync(path).isSymbolicLink();
}

// Use only after the owning T2 verifier has authenticated the qualified
// Kernel bytes in an ephemeral test Host. Never call with a production dist.
export function stageT3ActivityWitness({ sourceDir, hostRoot } = {}) {
  if (typeof sourceDir !== "string" || typeof hostRoot !== "string") {
    deny("WITNESS_PATHS_REQUIRED");
  }
  const source = realpathSync(resolve(sourceDir));
  const host = realpathSync(resolve(hostRoot));
  const temporary = realpathSync(resolve(tmpdir()));
  if (!inside(temporary, host)) deny("TEST_HOST_MUST_BE_TEMPORARY");
  if (!regularFile(join(host, "_iwxa", "current.json"))) {
    deny("REAL_T2_HOST_STAGE_REQUIRED");
  }
  const target = resolve(host, "." + PUBLIC_MOUNT);
  if (!inside(host, target) || existsSync(target)) {
    deny("TEST_WITNESS_TARGET_NOT_EMPTY");
  }
  const contents = [...MODULES, WORKSPACE_DRAFT].map((name) => {
    const file = name === WORKSPACE_DRAFT
      ? join(source, "..", name) : join(source, name);
    if (!regularFile(file)) deny("WITNESS_SOURCE_INVALID");
    return { name, bytes: readFileSync(file) };
  });
  const assets = [];
  try {
    mkdirSync(target, { recursive: true });
    for (const item of contents) {
      const dest = join(target, item.name);
      writeFileSync(dest, item.bytes, { flag: "wx" });
      const sha256 = createHash("sha256").update(item.bytes).digest("hex");
      if (!regularFile(dest) ||
          createHash("sha256").update(readFileSync(dest)).digest("hex") !== sha256) {
        deny("WITNESS_STAGE_READBACK_FAILED");
      }
      assets.push({ path: PUBLIC_MOUNT + item.name, sha256 });
    }
    return Object.freeze({
      test_only: true,
      mount: PUBLIC_MOUNT,
      assets,
      cleanup() {
        rmSync(target, { recursive: true, force: true });
      },
    });
  } catch (error) {
    if (inside(host, target)) rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

export async function readT3ActivityInLiveBrowser(page, {
  workspace_id,
  service_id,
  bindings,
  expected_runtime_version = "0.3.6",
} = {}) {
  if (!page || typeof page.evaluate !== "function") {
    deny("REAL_BROWSER_PAGE_REQUIRED");
  }
  if (!bindings || typeof bindings !== "object") deny("BINDINGS_REQUIRED");
  return page.evaluate(async (args) => {
    if (!globalThis.IWXA?.connect) throw new Error("REAL_T2_IWXA_REQUIRED");
    const imported = await import(args.module_url);
    return imported.readFromLiveT2Kernel({
      bootstrap: globalThis.IWXA,
      service_id: args.service_id,
      workspace_id: args.workspace_id,
      bindings: args.bindings,
      expected_runtime_version: args.expected_runtime_version,
    });
  }, { workspace_id, service_id, bindings, expected_runtime_version,
    module_url: `${PUBLIC_MOUNT}live-iwxa-client.mjs` });
}

// This compares two LIVE results only. The owning browser witness must
// independently assert process shutdown/reopen and persisted T2 receipts.
export function compareT3ActivityAfterColdRestart(before, after) {
  return compareLiveT2Readback(before, after);
}
