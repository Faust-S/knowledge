#!/usr/bin/env node
// Compose dist/ from three sources:
//   (a) the Vite build of the diagnostics React app  → dist/_iwxa/diagnostics/
//   (b) the static overlay from overlay/_iwxa/       → dist/_iwxa/{loader.js,current.json,services/,domain.json}
//   (c) the esbuild bundle of src/runtime/entry.ts   → dist/_iwxa/runtime/<version>/runtime.js
//
// Everything under dist/ lives strictly beneath dist/_iwxa/. The runtime is
// NEVER hand-authored — src/runtime/ is the single source of truth.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { buildRuntime, RUNTIME_VERSION } from "./build-runtime.mjs";
import { buildValidator } from "./build-validator.mjs";
import { execSync } from "node:child_process";
import { copyDirectoryTreeSync } from "./copy-tree-portable.mjs";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const OVERLAY = join(ROOT, "overlay", "_iwxa");
const DIAG_OUT = join(DIST, "_iwxa", "diagnostics");

if (!existsSync(OVERLAY)) {
  console.error("overlay/_iwxa/ is missing — cannot build.");
  process.exit(1);
}

// 0a. Verify canonical generated runtime-version bytes. Builds MUST NOT mutate tracked source.
execFileSync(process.execPath, [join(ROOT, "scripts", "sync-runtime-version.mjs"), "--check"], { cwd: ROOT, stdio: "inherit" });

// 0b. Universal service-catalog parity gate. Builds MUST NOT rewrite it.
try {
  execFileSync(process.execPath, [join(ROOT, "scripts", "check-service-catalog.mjs"), "--check"], {
    cwd: ROOT,
    stdio: "inherit",
  });
} catch {
  console.error("[build.mjs] service catalog check failed — aborting build.");
  process.exit(1);
}

// 1. Clean dist.
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIAG_OUT, { recursive: true });

// 2. Vite build → dist/_iwxa/diagnostics/
const viteBin = join(ROOT, "node_modules", "vite", "bin", "vite.js");
try {
  execFileSync(process.execPath, [viteBin, "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
} catch (e) {
  console.error("vite build failed:", e?.message ?? e);
  process.exit(1);
}

// 3. Generate validator directly into dist; never write generated files into tracked overlay/.
try {
  const { outFile: vFile } = await buildValidator({ outFile: join(DIST, "_iwxa", "validator.js") });
  console.log("[build.mjs] validator bundled →", vFile);
} catch (e) {
  console.error("[build.mjs] validator bundle failed:", e?.message ?? e);
  process.exit(1);
}

// 4. Copy overlay/_iwxa/* into dist/_iwxa/.
console.log("[build.mjs] copying overlay from", OVERLAY, "to", join(DIST, "_iwxa"));
try {
  copyDirectoryTreeSync(OVERLAY, join(DIST, "_iwxa"));
} catch (e) {
  console.error("[build.mjs] overlay copy failed:", e?.message ?? e);
  process.exit(1);
}

// 5. Bundle the versioned Runtime.
try {
  const currentPath = join(DIST, "_iwxa", "current.json");
  const current = JSON.parse(readFileSync(currentPath, "utf8"));
  const expectedUrl = `/_iwxa/runtime/${RUNTIME_VERSION}/runtime.js`;
  if (current.runtime_version !== RUNTIME_VERSION) {
    console.error(
      `[build.mjs] current.json.runtime_version="${current.runtime_version}" but package.json.version="${RUNTIME_VERSION}"`,
    );
    process.exit(1);
  }
  if (current.runtime_url !== expectedUrl) {
    console.error(
      `[build.mjs] current.json.runtime_url="${current.runtime_url}" but expected "${expectedUrl}"`,
    );
    process.exit(1);
  }
  if (current.contract_version !== "1.3.0") {
    console.error(
      `[build.mjs] current.json.contract_version must be "1.3.0", got "${current.contract_version}"`,
    );
    process.exit(1);
  }
  if (current.min_loader !== 1) {
    console.error(
      `[build.mjs] current.json.min_loader must be 1, got ${current.min_loader}`,
    );
    process.exit(1);
  }
  const { outFile } = await buildRuntime();
  console.log("[build.mjs] runtime bundled →", outFile);
} catch (e) {
  console.error("[build.mjs] runtime bundle failed:", e?.message ?? e);
  process.exit(1);
}

console.log(
  `build OK: dist/_iwxa/{diagnostics,loader.js,current.json,runtime/${RUNTIME_VERSION}/runtime.js,services,domain.json}`,
);



