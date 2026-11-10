#!/usr/bin/env node
/**
 * Build / check / lock the public IWXA Runtime Contract 1.2.0.
 *
 * ─── Determinism ────────────────────────────────────────────────────────────
 *   Two `contract:build` runs from identical source MUST produce the same
 *   SHA-256 for every emitted file AND for the ZIP artifact. To achieve that:
 *
 *     * `contract-manifest.json` contains ONLY:
 *         - contract_version
 *         - runtime_compatibility
 *         - files: [{ path, sha256, bytes }]  (sorted by path)
 *         - aggregate_sha256
 *       Every field flows deterministically from source. No timestamp.
 *
 *     * Release wall-clock is written to `build-metadata.json`, which is
 *       NOT covered by the contract-lock and is stripped from the ZIP.
 *
 *     * ZIP entries are written with fixed mtime = SOURCE_DATE_EPOCH
 *       (default 0 → 1970-01-01), the same order, and identical fflate
 *       compression settings.
 *
 * ─── Lock ───────────────────────────────────────────────────────────────────
 *   `contracts/locks/1.2.0.json` freezes the aggregate hash + per-file
 *   hashes of the public contract. It is created ONCE via
 *
 *       IWXA_ALLOW_CONTRACT_LOCK_UPDATE=1 npm run contract:lock
 *
 *   and never updated by ordinary builds. `contract:check` compares a
 *   fresh build to the lock and fails with CONTRACT_VERSION_BUMP_REQUIRED
 *   if any covered file changed at the same CONTRACT_VERSION.
 *
 * ─── Subcommands ────────────────────────────────────────────────────────────
 *     node scripts/build-contracts.mjs build   (default; emits + zips)
 *     node scripts/build-contracts.mjs check   (regenerates to tmp, diffs)
 *     node scripts/build-contracts.mjs lock    (requires env flag)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  readdirSync,
  statSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zipSync, strToU8 } from "fflate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_VERSION = "1.3.0";
const RUNTIME_COMPAT = ">=0.3.6 <0.4.0";
const OUT_DIR = join(ROOT, "dist", "_iwxa", "contracts", CONTRACT_VERSION);
const ARTIFACTS_DIR = join(ROOT, "artifacts");
const LOCK_DIR = join(ROOT, "contracts", "locks");
const LOCK_PATH = join(LOCK_DIR, `${CONTRACT_VERSION}.json`);
// ZIP DOS-date format starts at 1980-01-01. Any earlier value trips fflate.
const SOURCE_DATE_EPOCH = 315532800; // fixed 1980-01-01 UTC for reproducible ZIP metadata

// ---------------------------------------------------------------------------

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}
function sh(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

/**
 * Emit the contract to `dest` deterministically. Returns
 *   { files: [{path, sha256, bytes}], aggregate_sha256, manifestBytes, zipBytes }.
 *
 * The write layout under `dest`:
 *   dest/
 *     iwxa-client.d.ts
 *     error-catalogue.json
 *     schemas/*.schema.json
 *     contract-manifest.json          (deterministic — covered by lock)
 *     build-metadata.json             (wall-clock — NOT in lock, NOT in zip)
 */
async function emitContract(dest) {
  ensureDir(dest);

  // ---- 1. Generate .d.ts through the isolated tsconfig -------------------
  const dtsRoot = join(ROOT, "dist", "contracts-dts");
  if (existsSync(dtsRoot)) rmSync(dtsRoot, { recursive: true, force: true });
  sh(process.execPath, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.contracts.json"]);

  const files = [];
  const contents = new Map(); // path -> Buffer, insertion order

  function addFile(destName, bytes) {
    const abs = join(dest, destName);
    ensureDir(dirname(abs));
    writeFileSync(abs, bytes);
    files.push({ path: destName, sha256: sha256(bytes), bytes: bytes.length });
    contents.set(destName, bytes);
  }

  // ---- 2. iwxa-client.d.ts (flat bundle, deterministic order) ------------
  function collectDts(dir) {
    const out = [];
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) out.push(...collectDts(p));
      else if (p.endsWith(".d.ts")) out.push(p);
    }
    return out;
  }
  const dtsFiles = collectDts(dtsRoot);
  // Bundle: strip relative cross-file `import`/`export ... from './...'`
  // statements — every declaration is present in the concatenated file, so
  // relative module specifiers would leak into the consumer as unresolved
  // imports (see §3 contract-consumer test).
  const RELATIVE_MOD_LINE = /^\s*(?:import|export)[^;]*?\bfrom\s+["'](?:\.\/|\.\.\/)[^"']+["']\s*;?\s*$/;
  const bundledDts = dtsFiles
    .map((p) => {
      const src = readFileSync(p, "utf8")
        .split(/\r?\n/)
        .filter((line) => !RELATIVE_MOD_LINE.test(line))
        .join("\n");
      return `// -------- ${relative(dtsRoot, p).split(sep).join("/")} --------\n${src}`;
    })
    .join("\n\n");
  addFile("iwxa-client.d.ts", Buffer.from(bundledDts, "utf8"));

  // ---- 3. JSON Schemas (strict allowlist — §1) ---------------------------
  const REQUIRED_CONTRACT_SCHEMAS = [
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
    "capability/IWXA_T2_Capability_Bootstrap_Instance_Schema_v0.3.1.json",
    "capability/IWXA_T2_Capability_Grant_Schema_v0.3.1.json",
    "capability/IWXA_T2_Capability_Guard_Contract_v0.3.1.json",
    "capability/IWXA_T2_Capability_Issuance_Policy_Schema_v0.3.1.json",
    "capability/IWXA_T2_Capability_Lifetime_Resolution_Contract_v0.3.1.json",
    "capability/IWXA_T2_Capability_Receipt_Schema_v0.3.1.json",
    "capability/IWXA_T2_Capability_Service_Declaration_Schema_v0.3.1.json",
    "capability/IWXA_T2_Capability_Signature_Profile_Registry_v0.3.1.json",
    "capability/IWXA_T2_Capability_Trusted_Issuer_Entry_Schema_v0.3.1.json",
    "capability/IWXA_T2_Package_Manifest_1.1_Capability_FROZEN_Schema_v0.3.1.json",
  ];
  const schemasDir = join(ROOT, "schemas");
  for (const name of REQUIRED_CONTRACT_SCHEMAS) {
    const p = join(schemasDir, name);
    if (!existsSync(p)) {
      throw new Error(`[contract:build] required schema missing: ${name}`);
    }
    addFile(`schemas/${name}`, readFileSync(p));
  }


  // ---- 4. Error catalogue ------------------------------------------------
  const esbuild = await import("esbuild");
  const catBundle = join(ROOT, "dist", "contracts-dts", "error-catalogue.mjs");
  await esbuild.build({
    entryPoints: [join(ROOT, "src", "public-contract", "error-catalogue.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2020",
    outfile: catBundle,
    logLevel: "silent",
  });
  const catHash = sha256(readFileSync(catBundle));
  const mod = await import(`${pathToFileURL(catBundle).href}?sha256=${catHash}`);
  const catalogue = mod.toCataloguePayload();
  addFile(
    "error-catalogue.json",
    Buffer.from(JSON.stringify(catalogue, null, 2) + "\n", "utf8"),
  );

  // ---- 5. Deterministic contract-manifest.json ---------------------------
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const aggregate_sha256 = sha256(
    Buffer.from(files.map((f) => `${f.sha256}  ${f.path}`).join("\n") + "\n", "utf8"),
  );
  const manifest = {
    contract_version: CONTRACT_VERSION,
    runtime_compatibility: RUNTIME_COMPAT,
    files,
    aggregate_sha256,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(join(dest, "contract-manifest.json"), manifestBytes);
  contents.set("contract-manifest.json", manifestBytes);

  // ---- 6. build-metadata.json (deterministic provenance, NOT in ZIP/lock) --
  const current = JSON.parse(readFileSync(join(ROOT, "overlay", "_iwxa", "current.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (typeof current.released_at !== "string" || Number.isNaN(Date.parse(current.released_at))) {
    throw new Error("[contract:build] overlay/_iwxa/current.json.released_at must be a valid timestamp");
  }
  const buildMeta = {
    contract_version: CONTRACT_VERSION,
    source_runtime_version: pkg.version,
    generated_at: current.released_at,
    source_date_epoch: SOURCE_DATE_EPOCH,
  };
  writeFileSync(
    join(dest, "build-metadata.json"),
    JSON.stringify(buildMeta, null, 2) + "\n",
  );

  // ---- 7. Deterministic ZIP ---------------------------------------------
  const zipInput = {};
  // Ordered: manifest first, then files sorted by path.
  const ordered = [
    ["contract-manifest.json", contents.get("contract-manifest.json")],
    ...files.map((f) => [f.path, contents.get(f.path)]),
  ];
  for (const [path, bytes] of ordered) {
    // fflate accepts [Uint8Array, opts]; use a fixed ZIP mtime.
    zipInput[path] = [
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      { mtime: new Date(SOURCE_DATE_EPOCH * 1000) },
    ];
  }
  const zipBytes = zipSync(zipInput, { level: 9 });

  return { files, aggregate_sha256, manifestBytes, zipBytes };
}

// ---------------------------------------------------------------------------

async function cmdBuild() {
  console.log(`[contract:build] contract=${CONTRACT_VERSION}`);
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  ensureDir(OUT_DIR);
  ensureDir(ARTIFACTS_DIR);

  const { files, aggregate_sha256, zipBytes } = await emitContract(OUT_DIR);

  // Post-build guarantee — every required artifact must be present.
  const REQUIRED_PATHS = new Set([
    "iwxa-client.d.ts",
    "error-catalogue.json",
    "schemas/asset.schema.json",
    "schemas/current-manifest.schema.json",
    "schemas/domain-config.schema.json",
    "schemas/import-export.schema.json",
    "schemas/iwxa-event.schema.json",
    "schemas/object.schema.json",
    "schemas/package-manifest.schema.json",
    "schemas/package-schema.schema.json",
    "schemas/relation.schema.json",
    "schemas/service-passport.schema.json",
    "schemas/service-schema-declaration.schema.json",
    "schemas/validation-report.schema.json",
    "schemas/workspace.schema.json",
    "schemas/capability/IWXA_T2_Capability_Bootstrap_Instance_Schema_v0.3.1.json",
    "schemas/capability/IWXA_T2_Capability_Grant_Schema_v0.3.1.json",
    "schemas/capability/IWXA_T2_Capability_Guard_Contract_v0.3.1.json",
    "schemas/capability/IWXA_T2_Capability_Issuance_Policy_Schema_v0.3.1.json",
    "schemas/capability/IWXA_T2_Capability_Lifetime_Resolution_Contract_v0.3.1.json",
    "schemas/capability/IWXA_T2_Capability_Receipt_Schema_v0.3.1.json",
    "schemas/capability/IWXA_T2_Capability_Service_Declaration_Schema_v0.3.1.json",
    "schemas/capability/IWXA_T2_Capability_Signature_Profile_Registry_v0.3.1.json",
    "schemas/capability/IWXA_T2_Capability_Trusted_Issuer_Entry_Schema_v0.3.1.json",
    "schemas/capability/IWXA_T2_Package_Manifest_1.1_Capability_FROZEN_Schema_v0.3.1.json",
  ]);
  const got = new Set(files.map((f) => f.path));
  for (const req of REQUIRED_PATHS) {
    if (!got.has(req)) throw new Error(`[contract:build] missing artifact: ${req}`);
  }
  if (!existsSync(join(OUT_DIR, "contract-manifest.json"))) {
    throw new Error(`[contract:build] contract-manifest.json not written`);
  }

  const zipPath = join(ARTIFACTS_DIR, `iwxa-runtime-contract-${CONTRACT_VERSION}.zip`);

  writeFileSync(zipPath, zipBytes);

  console.log(`[contract:build] files=${files.length} aggregate=${aggregate_sha256}`);
  console.log(`[contract:build] artifact=${relative(ROOT, zipPath)} bytes=${zipBytes.length}`);
}

async function cmdCheck() {
  console.log(`[contract:check] contract=${CONTRACT_VERSION}`);
  if (!existsSync(LOCK_PATH)) {
    console.error(
      `[contract:check] Lock file missing: ${relative(ROOT, LOCK_PATH)}\n` +
        `Run \`IWXA_ALLOW_CONTRACT_LOCK_UPDATE=1 npm run contract:lock\` once after acceptance.`,
    );
    process.exit(2);
  }
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));

  const tmp = mkdtempSync(join(tmpdir(), "iwxa-contract-check-"));
  try {
    const { files, aggregate_sha256 } = await emitContract(tmp);

    // 1. File list must be identical (set + order-agnostic).
    const lockPaths = lock.files.map((f) => f.path).sort();
    const gotPaths = files.map((f) => f.path).sort();
    const missing = lockPaths.filter((p) => !gotPaths.includes(p));
    const added = gotPaths.filter((p) => !lockPaths.includes(p));
    const changed = [];
    for (const f of files) {
      const l = lock.files.find((x) => x.path === f.path);
      if (l && l.sha256 !== f.sha256) changed.push(f.path);
    }
    const drift = missing.length + added.length + changed.length > 0
      || aggregate_sha256 !== lock.aggregate_sha256;

    if (drift) {
      console.error(`[contract:check] FAILED — CONTRACT_VERSION_BUMP_REQUIRED`);
      if (missing.length) console.error(`  missing: ${missing.join(", ")}`);
      if (added.length) console.error(`  added:   ${added.join(", ")}`);
      if (changed.length) console.error(`  changed: ${changed.join(", ")}`);
      if (aggregate_sha256 !== lock.aggregate_sha256) {
        console.error(`  aggregate lock=${lock.aggregate_sha256}`);
        console.error(`  aggregate got =${aggregate_sha256}`);
      }
      console.error(
        `\nAt CONTRACT_VERSION=${CONTRACT_VERSION} the public contract is frozen.\n` +
          `Either revert the source change or bump CONTRACT_VERSION (see §9 in FINAL_AUDIT).`,
      );
      process.exit(1);
    }
    console.log(`[contract:check] OK — aggregate=${aggregate_sha256}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function cmdLock() {
  if (process.env.IWXA_ALLOW_CONTRACT_LOCK_UPDATE !== "1") {
    console.error(
      `[contract:lock] Refused — set IWXA_ALLOW_CONTRACT_LOCK_UPDATE=1 to overwrite\n` +
        `${relative(ROOT, LOCK_PATH)}. This is a one-time operation after acceptance.`,
    );
    process.exit(2);
  }
  const tmp = mkdtempSync(join(tmpdir(), "iwxa-contract-lock-"));
  try {
    const { files, aggregate_sha256 } = await emitContract(tmp);
    ensureDir(LOCK_DIR);
    const lock = {
      contract_version: CONTRACT_VERSION,
      runtime_compatibility: RUNTIME_COMPAT,
      files: files.map(({ path, sha256 }) => ({ path, sha256 })),
      aggregate_sha256,
    };
    writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + "\n");
    console.log(`[contract:lock] wrote ${relative(ROOT, LOCK_PATH)}`);
    console.log(`[contract:lock] aggregate_sha256=${aggregate_sha256}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const cmd = process.argv[2] ?? "build";
if (cmd === "build") await cmdBuild();
else if (cmd === "check") await cmdCheck();
else if (cmd === "lock") await cmdLock();
else {
  console.error(`Usage: build-contracts.mjs [build|check|lock]`);
  process.exit(64);
}
