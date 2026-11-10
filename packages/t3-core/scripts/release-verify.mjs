#!/usr/bin/env node
// release:verify — inspects release/workspace-static.zip and confirms
// the shipped bundle is a clean, static /workspace/ SPA with no
// forbidden artefacts (domain.json, loader placeholder, kernel code,
// service worker, PWA manifest, source maps, fixtures, mocks).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readStoredZip } from "./zip-store.mjs";

const root = process.cwd();
const zipPath = join(root, "release", "workspace-static.zip");
const sumsPath = join(root, "release", "SHA256SUMS.txt");

if (!existsSync(zipPath)) {
  console.error("❌ release/workspace-static.zip missing — run `npm run release:prepare`");
  process.exit(1);
}
if (!existsSync(sumsPath)) {
  console.error("❌ release/SHA256SUMS.txt missing");
  process.exit(1);
}

const zipEntries = readStoredZip(zipPath);
const listing = [...zipEntries.keys()].sort();

const errors = [];
const err = (m) => errors.push(m);

const FORBIDDEN_EXACT = [
  "workspace/domain.json",
  "workspace/_iwxa/loader.js.placeholder",
  "workspace/sw.js",
  "workspace/service-worker.js",
  "workspace/manifest.webmanifest",
  "workspace/manifest.json",
  "workspace/vitest.config.js",
  "workspace/vitest.config.ts",
];
const FORBIDDEN_PATTERNS = [
  { re: /\.map$/, msg: "source map" },
  { re: /(^|\/)(fixtures|tests|__tests__|__mocks__)\//, msg: "test artefact" },
  { re: /(^|\/)(mock|kernel)[.-].*\.(m?js|cjs|ts)$/i, msg: "kernel/mock code" },
  { re: /(^|\/)workbox-sw\.js$/, msg: "workbox service worker" },
  // Regular release must NOT ship the health profile chunk. Health lives
  // in a separate release-health/ artefact produced by build:health +
  // release:prepare:health.
  { re: /(^|\/)assets\/health[.-].*\.js$/, msg: "health chunk in regular release" },
];


for (const entry of listing) {
  if (FORBIDDEN_EXACT.includes(entry)) err(`forbidden entry in zip: ${entry}`);
  for (const { re, msg } of FORBIDDEN_PATTERNS) {
    if (re.test(entry)) err(`forbidden ${msg} in zip: ${entry}`);
  }
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

// Required directory routes with correct <base href>.
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

  if (entry === "workspace/index.html" && /Lovable App|Lovable Generated Project/.test(html))
    err(`workspace/index.html still uses template default title/description`);
}

for (const forbidden of [
  "workspace/exchange.html",
  "workspace/lifecycle.html",
]) {
  if (listing.includes(forbidden)) {
    err(`forbidden flat route: ${forbidden}`);
  }
}

// SHA256SUMS must contain workspace-static.zip.
const sums = readFileSync(sumsPath, "utf8");
if (!/workspace-static\.zip$/m.test(sums))
  err(`SHA256SUMS.txt is missing an entry for workspace-static.zip`);

if (errors.length) {
  console.error("\n❌ release:verify failed:");
  for (const m of errors) console.error(" - " + m);
  process.exit(1);
}

console.log("✅ release:verify passed");
console.log(`   entries in zip: ${listing.length}`);
console.log(`   base href: /workspace/`);
