#!/usr/bin/env node
/**
 * verify-chunks.mjs — post-build assertion on the emitted JS chunks.
 *
 * Rules for a regular (non-health) build:
 *   1. No chunk contains health-profile sentinels (`iwxa.health.vault`,
 *      `HEALTH_ROUTES`, `sensitive-object`) — the profile must be tree-shaken.
 *   2. The entry chunk does not statically embed any profile-specific
 *      sentinel; each profile lives in its own async chunk (proving code
 *      splitting is not just claimed but actually enforced).
 *   3. Learning-chunk files do not contain organization sentinels and
 *      vice versa — the two profiles are in independent chunks.
 *   4. There is at least one chunk per non-health profile (learning,
 *      personal, organization) — otherwise the dynamic import collapsed.
 *
 * This script is meant to run against `dist/` produced by `vite build`.
 */
import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve("dist");
const ASSETS = path.join(DIST, "assets");

if (!fs.existsSync(ASSETS)) {
  console.error(`[verify-chunks] ${ASSETS} not found — run 'npm run build' first.`);
  process.exit(1);
}

const HEALTH_MODE = process.env.VITE_ENABLE_HEALTH_PROFILE === "true";

// Content-level sentinels: string literals that appear in the profile's
// route table or renderer output. Symbol names of exports (e.g. the
// identifier `LEARNING_ROUTES`) survive as property accesses in the entry
// chunk even when the module is code-split, so we only match on data.
const SENTINELS = {
  generic: ["Универсальный", "Универсальная оболочка"],
  learning: ["iwxa.learning.career", "iwxa.learning.lad", "career-route"],
  personal: ["iwxa.personal.journal", "iwxa.personal.projects", "activity-event"],
  organization: [
    "iwxa.org.diagnostics",
    "iwxa.org.actions",
    "diagnostic-case",
  ],
  health: ["iwxa.health.vault", "sensitive-object"],
};

// Read all JS chunks and index -> Buffer.
const files = fs
  .readdirSync(ASSETS)
  .filter((f) => f.endsWith(".js"))
  .map((f) => ({
    name: f,
    path: path.join(ASSETS, f),
    content: fs.readFileSync(path.join(ASSETS, f), "utf8"),
  }));

if (files.length === 0) {
  console.error(`[verify-chunks] no .js files under ${ASSETS}`);
  process.exit(1);
}

function chunksContaining(sentinels) {
  return files.filter((f) => sentinels.some((s) => f.content.includes(s)));
}

const errors = [];

// Locate entry chunk(s) by reading the HTML index.
const indexHtml = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const entryHrefs = Array.from(
  indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g),
).map((m) => path.basename(m[1]));
const entryFiles = files.filter((f) => entryHrefs.includes(f.name));

// Rule 2: the entry chunk must not embed profile sentinels directly.
for (const [name, sentinels] of Object.entries(SENTINELS)) {
  if (name === "health") continue;
  for (const entry of entryFiles) {
    for (const s of sentinels) {
      if (entry.content.includes(s)) {
        errors.push(
          `Entry chunk ${entry.name} statically embeds ${name} sentinel "${s}" — profile is not code-split`,
        );
      }
    }
  }
}

// Rule 4: each non-health profile has at least one dedicated chunk.
// Rule 4: each non-health profile — including generic — has at least one
// dedicated chunk. Regression guard against generic being pulled back
// into the entry via a static import.
for (const p of ["generic", "learning", "personal", "organization"]) {
  const hits = chunksContaining(SENTINELS[p]);
  if (hits.length === 0) {
    errors.push(`no chunk contains ${p} profile sentinels — dynamic import may have been dropped`);
  }
}

// Rule 3: learning-chunk vs organization-chunk isolation.
const learningChunks = chunksContaining(SENTINELS.learning).filter(
  (c) => !entryFiles.includes(c),
);
const organizationChunks = chunksContaining(SENTINELS.organization).filter(
  (c) => !entryFiles.includes(c),
);
for (const c of learningChunks) {
  for (const s of SENTINELS.organization) {
    if (c.content.includes(s)) {
      errors.push(
        `learning chunk ${c.name} unexpectedly contains organization sentinel "${s}"`,
      );
    }
  }
}
for (const c of organizationChunks) {
  for (const s of SENTINELS.learning) {
    if (c.content.includes(s)) {
      errors.push(
        `organization chunk ${c.name} unexpectedly contains learning sentinel "${s}"`,
      );
    }
  }
}

// Rule 1 / health-mode assertion.
const healthHits = chunksContaining(SENTINELS.health);
if (HEALTH_MODE) {
  if (healthHits.length === 0) {
    errors.push("build:health did not emit any chunk containing health sentinels");
  }
} else {
  for (const c of healthHits) {
    errors.push(
      `regular build unexpectedly ships health code in ${c.name} — should require build:health`,
    );
  }
}

// Rule 5: dev-mock must never leak into a production bundle.
const devMockHits = files.filter((f) => f.content.includes("IWXA_DEV_MOCK_MARKER"));
for (const c of devMockHits) {
  errors.push(`production build ships the dev-mock in ${c.name} (IWXA_DEV_MOCK_MARKER present)`);
}

if (errors.length > 0) {
  console.error("[verify-chunks] FAILED:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

console.log(
  `[verify-chunks] OK — ${files.length} chunks, ${entryFiles.length} entry, health=${HEALTH_MODE ? "included" : "absent"}`,
);
