#!/usr/bin/env node
// release:verify:health — inspects release-health/workspace-health-static.zip.
// Requires:
//   - at least one health-* chunk present under workspace/assets/;
//   - no source maps;
//   - no domain.json;
//   - no kernel/loader code;
//   - no mock chunks.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readStoredZip } from "./zip-store.mjs";

const root = process.cwd();
const zipPath = join(root, "release-health", "workspace-health-static.zip");
const sumsPath = join(root, "release-health", "SHA256SUMS.txt");

if (!existsSync(zipPath)) {
  console.error("❌ release-health/workspace-health-static.zip missing — run `npm run release:prepare:health`");
  process.exit(1);
}
if (!existsSync(sumsPath)) {
  console.error("❌ release-health/SHA256SUMS.txt missing");
  process.exit(1);
}

const zipEntries = readStoredZip(zipPath);
const listing = [...zipEntries.keys()].sort();

const errors = [];
const err = (m) => errors.push(m);

const FORBIDDEN_EXACT = [
  "workspace/domain.json",
  "workspace/_iwxa/loader.js",
  "workspace/_iwxa/loader.js.placeholder",
  "workspace/sw.js",
  "workspace/service-worker.js",
  "workspace/manifest.webmanifest",
  "workspace/manifest.json",
];
const FORBIDDEN_PATTERNS = [
  { re: /\.map$/, msg: "source map" },
  { re: /(^|\/)(fixtures|tests|__tests__|__mocks__)\//, msg: "test artefact" },
  { re: /(^|\/)(mock|kernel)[.-].*\.(m?js|cjs|ts)$/i, msg: "kernel/mock code" },
  { re: /(^|\/)_iwxa\//, msg: "kernel directory" },
];

for (const entry of listing) {
  if (FORBIDDEN_EXACT.includes(entry)) err(`forbidden entry in zip: ${entry}`);
  for (const { re, msg } of FORBIDDEN_PATTERNS) {
    if (re.test(entry)) err(`forbidden ${msg} in zip: ${entry}`);
  }
}

// Health chunk must be present.
const healthChunks = listing.filter((e) => /^workspace\/assets\/health[.-].*\.js$/.test(e));
if (healthChunks.length === 0)
  err(`no health-*.js chunk found in workspace/assets/ — build:health did not emit one`);

// Health chunk content must contain a health-profile sentinel.
if (healthChunks.length > 0) {
  const content = zipEntries.get(healthChunks[0])?.toString("utf8") ?? "";
  if (!/iwxa\.health\.vault|sensitive-object/.test(content))
    err(`health chunk ${healthChunks[0]} does not contain expected health sentinels`);
}

// Scan JS asset content for T3 UI placeholders and legacy T2-02 form
// strings/test ids that must never ship in production assets.
const FORBIDDEN_ASSET_STRINGS = [
  "Действия сервисов",
  "Переход в сервис",
  "Передача контекста между сервисами",
  "intent-канал",
  "new-workspace-technical-id",
  "new-workspace-profile-input",
];
const jsAssets = listing.filter((e) => /^workspace\/assets\/.*\.js$/.test(e));
for (const asset of jsAssets) {
  const content = zipEntries.get(asset)?.toString("utf8") ?? "";
  for (const s of FORBIDDEN_ASSET_STRINGS) {
    if (content.includes(s)) err(`forbidden string "${s}" found in ${asset}`);
  }
}

const requiredRoutes = [
  ["workspace/index.html", "/workspace/"],
  [
    "workspace/exchange/index.html",
    "/workspace/exchange/",
  ],
  [
    "workspace/lifecycle/index.html",
    "/workspace/lifecycle/",
  ],
];

for (const [entry, expectedBase] of requiredRoutes) {
  if (!listing.includes(entry)) {
    err(`missing required entry: ${entry}`);
    continue;
  }

  const html = zipEntries.get(entry)?.toString("utf8") ?? "";

  if (
    !html.includes(
      `<base href="${expectedBase}"`,
    )
  ) {
    err(
      `${entry} must include ` +
      `<base href="${expectedBase}">`,
    );
  }
}

for (const forbidden of [
  "workspace/exchange.html",
  "workspace/lifecycle.html",
]) {
  if (listing.includes(forbidden)) {
    err(`forbidden flat route: ${forbidden}`);
  }
}

const sums = readFileSync(sumsPath, "utf8");
if (!/workspace-health-static\.zip$/m.test(sums))
  err(`SHA256SUMS.txt is missing an entry for workspace-health-static.zip`);

if (errors.length) {
  console.error("\n❌ release:verify:health failed:");
  for (const m of errors) console.error(" - " + m);
  process.exit(1);
}

console.log("✅ release:verify:health passed");
console.log(`   entries in zip: ${listing.length}`);
console.log(`   health chunks : ${healthChunks.length}`);
