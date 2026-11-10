#!/usr/bin/env node
// static-check.mjs — enforces ARCHITECTURE_LOCK.md invariants.
// Rewritten in PROMPT 28: strips checks of removed files (MainArea,
// src/features/*, legacy shell routing), covers the current tree.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = process.cwd();
const errors = [];
const err = (m) => errors.push(m);

// -------- 1. package.json --------------------------------------------------
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
const forbiddenDeps = [
  /^@tanstack\/react-start$/,
  /^@tanstack\/start(\/|$)/,
  /^@tanstack\/router-plugin$/,
  /^next$/,
  /^remix$/,
  /^@remix-run\//,
  /^@supabase\//,
  /^vite-plugin-pwa$/,
  /^workbox-/,
  /^idb$/,
  /^dexie$/,
  /^localforage$/,
];
for (const name of Object.keys(allDeps)) {
  if (forbiddenDeps.some((r) => r.test(name))) err(`Forbidden dependency: ${name}`);
}

// -------- 2. Lockfile hygiene ---------------------------------------------
for (const lf of ["bun.lock", "yarn.lock", "pnpm-lock.yaml"]) {
  if (existsSync(join(root, lf))) err(`${lf} is forbidden: iwxa-workspace uses npm only`);
}
if (!existsSync(join(root, "package-lock.json"))) err("package-lock.json missing");

// -------- 3. Vite / index.html base ---------------------------------------
if (!pkg.scripts?.["build:static:check"]) err("Missing script build:static:check");
const viteCfg = readFileSync(join(root, "vite.config.ts"), "utf8");
if (!/base:\s*["']\/workspace\/["']/.test(viteCfg))
  err(`vite.config.ts must set base: "/workspace/"`);
const html = readFileSync(join(root, "index.html"), "utf8");
if (!/<base\s+href=["']\/workspace\/["']/.test(html))
  err(`index.html must include <base href="/workspace/">`);

// -------- 4. dist static-only artifacts -----------------------------------
const dist = join(root, "dist");
if (!existsSync(dist)) err("dist/ not found — did vite build run?");
else {
  const forbiddenDistNames = ["_server", "server", "functions", "worker", "_worker.js"];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) {
        if (forbiddenDistNames.includes(entry)) err(`dist forbidden: ${p}`);
        walk(p);
      } else if (forbiddenDistNames.includes(entry)) {
        err(`dist forbidden: ${p}`);
      }
    }
  };
  walk(dist);
  if (!existsSync(join(dist, "index.html"))) err("dist/index.html missing");
}

// -------- 5. src source scan — forbidden runtime patterns ------------------
const forbiddenPatterns = [
  { re: /indexedDB\s*\.\s*open\s*\(/, msg: "direct indexedDB.open()" },
  { re: /navigator\s*\.\s*serviceWorker/, msg: "service worker" },
  { re: /from\s+["'](idb|dexie|localforage)["']/, msg: "forbidden storage lib" },
  { re: /from\s+["']@supabase\//, msg: "supabase import" },
  { re: /from\s+["']@tanstack\/react-start["']/, msg: "tanstack start" },
  { re: /from\s+["']next\//, msg: "next.js import" },
  { re: /fetch\(\s*["']\/api\//, msg: 'backend fetch("/api/...")' },
];
const scanExt = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const walkSrc = (dir, cb) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walkSrc(p, cb);
    } else if (scanExt.has(extname(entry))) {
      cb(p, readFileSync(p, "utf8"));
    }
  }
};
walkSrc(join(root, "src"), (p, src) => {
  for (const { re, msg } of forbiddenPatterns) {
    if (re.test(src)) err(`${p}: ${msg}`);
  }
});

// -------- 6. PROMPT 28 — shell is pure Host chrome -------------------------
{
  const shellDir = join(root, "src/shell");
  for (const forbidden of ["Navigation.tsx", "useHashRoute.ts", "views.ts"]) {
    if (existsSync(join(shellDir, forbidden))) {
      err(`PROMPT 28: src/shell/${forbidden} must be removed`);
    }
  }
  const shellFiles = readdirSync(shellDir);
  const expected = ["AppShell.tsx", "ActionBar.tsx", "Header.tsx", "index.ts", "routing.ts"];
  for (const f of expected) {
    if (!shellFiles.includes(f)) err(`PROMPT 28: missing src/shell/${f}`);
  }

  const appShellSrc = readFileSync(join(shellDir, "AppShell.tsx"), "utf8");
  const stripped = appShellSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (/useHashRoute|parseHash|formatRoute|MAIN_NAV_VIEWS/.test(stripped)) {
    err("PROMPT 28: AppShell.tsx must not reference legacy hash-routing symbols");
  }
  if (/openExchangeCrossBase|openLifecycleTrashCrossBase|window\.location\.assign/.test(stripped)) {
    err("PROMPT 28: AppShell.tsx must not perform manual cross-base navigation");
  }
  if (!/useHostRouteFocus\(/.test(appShellSrc)) {
    err("PROMPT 28: AppShell.tsx must use useHostRouteFocus for main-region focus");
  }
  if (!/useLegacyRouteMigrations\(/.test(appShellSrc)) {
    err("PROMPT 28: AppShell.tsx must invoke useLegacyRouteMigrations");
  }
  if (!/HostModuleNavigation\b/.test(appShellSrc)) {
    err("PROMPT 28: AppShell.tsx must render HostModuleNavigation");
  }
}

// -------- 7. PROMPT 28 — Host Router owns legacy redirects -----------------
{
  const migrationFile = join(root, "src/workspace-host/router/legacy-route-migrations.ts");
  if (!existsSync(migrationFile)) err("PROMPT 28: legacy-route-migrations.ts missing");
  else {
    const src = readFileSync(migrationFile, "utf8");
    for (const legacy of ["#/packages", "#/trash"]) {
      if (!src.includes(`"${legacy}"`)) err(`PROMPT 28: migration for ${legacy} missing`);
    }
    if (!/replace:\s*true/.test(src)) {
      err("PROMPT 28: legacy migrations must use replace: true semantics");
    }
  }
  for (const req of [
    "src/workspace-host/router/use-host-route-focus.ts",
    "src/workspace-host/router/host-breadcrumb-route.ts",
    "src/workspace-host/router/use-host-route-match.ts",
    "src/workspace-host/rendering/HostModuleNavigation.tsx",
  ]) {
    if (!existsSync(join(root, req))) err(`PROMPT 28: required file missing — ${req}`);
  }
}

// -------- 8. PROMPT 28 — CurrentWorkspaceFacade owner gating ---------------
{
  const facadeSrc = readFileSync(join(root, "src/workspace-contract/module-context.ts"), "utf8");
  if (!/claim\(ws:\s*WorkspaceRecord \| null\)/.test(facadeSrc)) {
    err("PROMPT 28 §9: CurrentWorkspaceFacade must expose claim(ws)");
  }
  if (!/release\(\)/.test(facadeSrc)) {
    err("PROMPT 28 §9: CurrentWorkspaceFacade must expose release()");
  }
  const ctxSrc = readFileSync(join(root, "src/workspace-host/context/create-module-context.ts"), "utf8");
  if (!/iwxa\.workspace\.base/.test(ctxSrc)) {
    err("PROMPT 28 §9: create-module-context must gate claim/release to iwxa.workspace.base");
  }
  if (!/current-workspace-claim-denied/.test(ctxSrc)) {
    err("PROMPT 28 §9: create-module-context must emit current-workspace-claim-denied diagnostic");
  }
}

// -------- 9. Kernel adapter contract (T3-01) -------------------------------
{
  const adapterFile = join(root, "src/kernel-client/adapter/index.ts");
  if (!existsSync(adapterFile)) err("T3-01: adapter/index.ts missing");
  else {
    const src = readFileSync(adapterFile, "utf8");
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (/session\.mode/.test(stripped)) err("T3-01: adapter must not read session.mode");
    if (/capabilities\s*\(/.test(src)) err("T3-01: adapter must not use capabilities()");
    if (/\.canWrite\b/.test(src)) err("T3-01: adapter must not use aggregate canWrite");
    if (/JSZip|new\s+JSZip|jszip/.test(src)) err("T3-01: adapter must not assemble .iwxa packages");
    if (!/requireOperation\s*\(/.test(src)) err("T3-01: adapter must call requireOperation()");
    const REQUIRED_OPS = [
      "t1.listWorkspaces","t1.getWorkspace","t1.createWorkspace","t1.listObjects",
      "t1.getObject","t1.putObject","t1.deleteObject","t1.listEventsSince",
      "t1.softDeleteWorkspace","t1.restoreWorkspace","t1.purgePreview",
      "t1.purgeCommit","t1.purgeCancel",
      "t2.exportPreview","t2.exportPackage","t2.confirmExport",
      "t2.importPreview","t2.importCommit","t2.importCancel",
    ];
    for (const op of REQUIRED_OPS) {
      if (!src.includes(`"${op}"`)) err(`T3-01: adapter missing op guard: ${op}`);
    }
  }
  // Production source must not statically import dev-mock.
  walkSrc(join(root, "src"), (p, src) => {
    if (p.endsWith("dev-mock.ts")) return;
    if (/from\s+["'][^"']*dev-mock["']/.test(src)) {
      if (!/import\.meta\.env\.DEV/.test(src) && !/\bimport\s*\(/.test(src)) {
        err(`T3-01: static import of dev-mock in production source: ${p}`);
      }
    }
  });
}

// -------- 10. Host-config triad bootstrap (PROMPT_08) ---------------------
{
  const appSrc = readFileSync(join(root, "src/App.tsx"), "utf8");
  if (/useDomainConfig|loadDomainConfig|fetchDomainConfigRaw|health_build_required/.test(appSrc)) {
    err("PROMPT_08: src/App.tsx must not use legacy single-file domain loader");
  }
  const domainCfgSrc = readFileSync(join(root, "src/config/domain-config.ts"), "utf8");
  const stripped = domainCfgSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (/\bfetch\s*\(/.test(stripped)) {
    err("PROMPT_08: src/config/domain-config.ts must not perform network fetches");
  }
  if (!/Legacy projection only\. Not a configuration loader\./.test(domainCfgSrc)) {
    err("PROMPT_08: src/config/domain-config.ts must carry the 'Legacy projection only' banner");
  }
  const invSrc = readFileSync(join(root, "src/config/host-config/cross-file-invariants.ts"), "utf8");
  if (!/workspace-profile-mismatch/.test(invSrc) || !/workspace-profile-disabled/.test(invSrc)) {
    err("PROMPT_08: cross-file-invariants missing profile invariants");
  }
  if (!/local-store-name-mismatch/.test(invSrc)) {
    err("PROMPT_08: cross-file-invariants must emit local-store-name-mismatch");
  }
  walkSrc(join(root, "src"), (p, src) => {
    if (/fetch\([^)]*domain-key\.json/.test(src)) {
      err(`${p}: must not fetch /_iwxa/domain-key.json`);
    }
  });
}

// -------- 11. Workspace Contract (PROMPT_12) -------------------------------
{
  const ctxSrc = readFileSync(join(root, "src/workspace-contract/module-context.ts"), "utf8");
  const stripped = ctxSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const REQUIRED_KERNEL_METHODS = [
    "listWorkspaces", "getWorkspace", "createWorkspace",
    "listObjects", "getObject", "listEventsSince",
    "putObject", "deleteObject",
    "softDeleteWorkspace", "restoreWorkspace",
    "purgePreview", "purgeCommit", "purgeCancel",
    "exportPreview", "exportPackage", "confirmExport",
    "importPreview", "importCommit", "importCancel",
    "hasOperation",
  ];
  for (const m of REQUIRED_KERNEL_METHODS) {
    if (!new RegExp(`\\b${m}\\s*[?:(]`).test(stripped)) {
      err(`PROMPT_12: KernelFacade missing method ${m}`);
    }
  }
  if (/navigateHash|currentHash/.test(stripped)) {
    err("PROMPT_12 §3: RouterFacade must not expose navigateHash/currentHash");
  }
  if (!/navigate\s*\(\s*route:\s*RouteRef/.test(stripped)) {
    err("PROMPT_12 §3: RouterFacade.navigate must accept RouteRef");
  }
  const noStrings = stripped
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  for (const forbidden of [
    /export\s+.*\bsession\b\s*:/,
    /export\s+.*\badapter\b\s*:/,
    /window\.IWXA/,
    /:\s*IDBDatabase\b/,
    /\bindexedDB\b/,
  ]) {
    if (forbidden.test(noStrings)) {
      err(`PROMPT_12 §2: module-context.ts must not expose ${forbidden}`);
    }
  }
  const contribSrc = readFileSync(join(root, "src/workspace-contract/contributions/index.ts"), "utf8");
  const cStripped = contribSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (/\bpattern\s*:\s*string/.test(cStripped)) {
    err("PROMPT_12 §4: RouteContribution must not carry raw `pattern`");
  }
  if (/\bpath\s*:\s*string/.test(cStripped)) {
    err("PROMPT_12 §4: NavigationContribution must not carry raw `path`");
  }
  if (!/routeRef\s*:\s*RouteRef/.test(cStripped)) {
    err("PROMPT_12 §4: contributions must reference routes via RouteRef");
  }
  const defSrc = readFileSync(join(root, "src/workspace-contract/module-definition.ts"), "utf8");
  if (!/validateWorkspaceModuleManifest\s*\(/.test(defSrc)) {
    err("PROMPT_12 §6: defineWorkspaceModule must call validateWorkspaceModuleManifest");
  }
  if (/\beval\s*\(|new\s+Function\s*\(/.test(defSrc)) {
    err("PROMPT_12 §7: eval / new Function forbidden in workspace-contract");
  }
}

// -------- 12. Host Router isolation (PROMPT_16) ---------------------------
{
  const routerRoot = join(root, "src/workspace-host/router");
  if (!existsSync(routerRoot)) err("PROMPT_16: workspace-host/router missing");
  else {
    walkSrc(routerRoot, (p, src) => {
      for (const { re, msg } of [
        { re: /https?:\/\//, msg: "remote URL literal in router" },
        { re: /\bmintIntent\b|\bconsumeIntent\b|\bhandoff\b/, msg: "T3 handoff terminology" },
      ]) {
        if (re.test(src)) err(`PROMPT_16: ${p}: ${msg}`);
      }
    });
    const facadeSrc = readFileSync(join(routerRoot, "create-router-facade.ts"), "utf8");
    for (const bad of [/navigateHash/, /currentHash/, /location\.hash/, /window\.history/, /URLSearchParams/]) {
      if (bad.test(facadeSrc)) err(`PROMPT_16 §8: RouterFacade must not reference ${bad}`);
    }
    const facadeKeys = facadeSrc.match(/const facade[\s\S]*?=\s*\{([\s\S]*?)\};/);
    if (!facadeKeys || !/navigate\s*\(/.test(facadeKeys[1]) || !/current\s*\(/.test(facadeKeys[1])) {
      err("PROMPT_16 §8: RouterFacade must expose exactly navigate + current");
    }
  }
}

// -------- 13. PROMPT 29 — global refresh buses removed --------------------
{
  const eventsDir = join(root, "src/workspace-host/events");
  if (existsSync(eventsDir)) {
    err("PROMPT 29 §5: src/workspace-host/events/ must be removed");
  }
  walkSrc(join(root, "src"), (p, src) => {
    if (/workspace-host\/events\//.test(src)) {
      err(`PROMPT 29 §5: ${p} imports removed workspace-host/events`);
    }
    for (const banned of [
      /\bemitCatalogRefresh\b/,
      /\bsubscribeCatalogRefresh\b/,
      /\bemitLifecycleRefresh\b/,
      /\bsubscribeLifecycleRefresh\b/,
      /\b__resetCatalogRefreshBusForTests\b/,
      /\b__resetLifecycleRefreshBusForTests\b/,
    ]) {
      if (banned.test(src)) {
        err(`PROMPT 29 §5: ${p} references removed global refresh bus symbol`);
      }
    }
  });
  // Module-owned services must exist and register through commands.
  const baseCmd = join(root, "src/modules/base/commands.ts");
  if (!existsSync(baseCmd)) err("PROMPT 29 §6: src/modules/base/commands.ts missing");
  else if (!/workspace\.catalog\.refresh/.test(readFileSync(baseCmd, "utf8"))) {
    err("PROMPT 29 §6: base commands must register workspace.catalog.refresh");
  }
  const lifecycleCmd = join(root, "src/modules/lifecycle/commands.ts");
  if (!existsSync(lifecycleCmd)) err("PROMPT 29 §7: lifecycle commands.ts missing");
  else if (!/lifecycle\.trash\.refresh/.test(readFileSync(lifecycleCmd, "utf8"))) {
    err("PROMPT 29 §7: lifecycle commands must register lifecycle.trash.refresh");
  }
}



if (errors.length) {
  console.error("\n❌ static-check failed:");
  for (const m of errors) console.error(" - " + m);
  process.exit(1);
}
console.log("✅ static-check passed");
