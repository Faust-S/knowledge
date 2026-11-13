/**
 * Real Kernel + Universal Workspace integration harness.
 *
 * Builds a disposable composite host outside the source tree. The Kernel
 * artifact remains authoritative for /_iwxa loader/runtime/validator bytes;
 * only domain-owned host configuration/passport/control-plane files are
 * synthesized for this integration domain.
 */
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:https";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, stat } from "node:fs/promises";

const RUNTIME_VERSION = "0.3.5";
const CONTRACT_VERSION = "1.2.0";
const SERVICE_ID = "iwxa.workspace.integration";
const SCHEMA_ID = "iwxa.demo.note";

// Temporary loopback TLS only. No reusable private key is embedded or persisted.
function loadLoopbackTlsMaterial() {
  const temp = mkdtempSync(join(tmpdir(), "iwxa-t3-test-tls-"));
  const keyFile = join(temp, "key.pem");
  const certFile = join(temp, "cert.pem");
  try {
    const generated = spawnSync("openssl", [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
      "-noenc", "-keyout", keyFile, "-out", certFile, "-days", "1",
      "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
    ], { encoding: "utf8", timeout: 15000 });
    if (generated.error || generated.status !== 0) {
      throw new Error("T2_QUALIFICATION_EPHEMERAL_TLS_GENERATION_FAILED");
    }
    return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}


// Synthetic-host assets referenced by domain-shell.json. The v7 collect-all
// run proved the real runtime lifecycle but exposed two unattributed 404
// console errors because this disposable host advertised shell assets it did
// not materialize. Keep the assets local/test-only and serve every configured
// path so a zero-console/page-error assertion remains meaningful.
const SYNTHETIC_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32" role="img" aria-label="IWXA"><rect width="64" height="32" rx="6" fill="#111827"/><text x="32" y="21" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#ffffff">IWXA</text></svg>\n`;
const SYNTHETIC_TOKENS_CSS = `:root { --iwxa-integration-host: 1; }\n`;

export function resolveIwxaSourceDir(input) {
  if (!input) return null;
  const p = resolve(input);
  if (!existsSync(p) || !statSync(p).isDirectory()) return null;
  const looksLikeIwxa = (dir) =>
    existsSync(resolve(dir, "domain.json")) && existsSync(resolve(dir, "loader.js"));
  const inner = resolve(p, "_iwxa");
  if (existsSync(inner) && statSync(inner).isDirectory() && looksLikeIwxa(inner)) return inner;
  if (looksLikeIwxa(p)) return p;
  return null;
}

function mime(p) {
  if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".html")) return "text/html";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".ico")) return "image/x-icon";
  if (p.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

export function serveRealKernelHost(root, { independentWitness = false, previewOrigin = false, controlHandler = null } = {}) {
  const { key, cert } = loadLoopbackTlsMaterial();
  const server = createServer({ key, cert }, async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const decoded = decodeURIComponent(url.pathname);
      // The optional original Control route attaches to THIS qualified
      // original Host, never a parallel server or service worker.
      if (decoded.startsWith('/api/t3/') && typeof controlHandler === 'function') {
        const owned = await controlHandler(req,res);
        if (owned || res.headersSent) return;
      }
      if (independentWitness && decoded === '/__t2_independent_readback__') {
        res.setHeader('content-type', 'text/html');
        res.setHeader('content-security-policy', "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'self'; frame-ancestors 'none'");
        res.end('<!doctype html><title>T2 independent Kernel reader</title><script src="/_iwxa/loader.js"></script>');
        return;
      }
      let p = resolve(root, "." + decoded);
      if (!p.startsWith(resolve(root))) throw new Error("path traversal");
      const s = await stat(p).catch(() => null);
      if (s?.isDirectory()) p = resolve(p, "index.html");
      let body = await readFile(p);
      if (previewOrigin && ['/_iwxa/domain.json','/_iwxa/domain-shell.json'].includes(decoded)) {
        const config = JSON.parse(body); config.origin = 'https://' + req.headers.host;
        body = Buffer.from(JSON.stringify(config));
      }
      res.setHeader("content-type", mime(p));
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("REAL_KERNEL_SERVER_ADDRESS_INVALID"));
      resolveListen({ server, origin: `https://127.0.0.1:${address.port}` });
    });
  });
}

function writeJson(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function materializeIntegrationHost(root, origin) {
  const iwxa = resolve(root, "_iwxa");
  const workspace = resolve(root, "workspace");
  const domain = {
    config_schema_version: "1.0.0",
    config_version: "0.34.0-rc.20-integration",
    status: "development",
    domain_id: "integration.workspace.iwxa.test",
    origin,
    local_store_name: "iwxa-local",
    workspace_profile: "generic",
    brand: "IWXA Integration",
    runtime: {
      kernel_release: RUNTIME_VERSION,
      runtime_version: RUNTIME_VERSION,
      local_store_version: "6",
      package_version: "1.1",
      current_manifest_path: "/_iwxa/current.json",
    },
    modules: [{ service_id: SERVICE_ID, base_path: "/workspace/" }],
    enabled_profiles: ["generic"],
    enabled_capabilities: ["T0", "T1", "T2"],
    handoff: { enabled: false, receive_path: "/_iwxa/handoff/receive", allowed_origins: [], require_preview: true, default_expiry_seconds: 3600 },
    service_worker: { mode: "disabled", future_path: "/iwxa-sw.js", future_scope: "/" },
    diagnostics: { enabled: true, path: "/_iwxa/diagnostics/" },
    security: { allow_secrets: false, publish_source_maps: false, directory_listing: false, robots_indexing: false, direct_indexeddb_for_modules: false, module_service_worker: false, allowed_object_classes: [SCHEMA_ID] },
    release: { deployment_mode: "overlay", preserve_paths: ["/_iwxa/domain.json", "/workspace/"], release_must_exclude: ["/tests/", "/artifacts/"], backup_before_upload: true },
  };
  const shell = {
    shell_schema_version: "1.0.0",
    config_version: "0.34.0-rc.20-integration",
    domain_id: domain.domain_id,
    origin,
    brand: { name: "IWXA Integration", short_name: "IWXA", descriptor: "Real Kernel integration", home_path: "/", logo_path: "/_iwxa/brand/logo.svg", favicon_path: "/favicon.ico" },
    theme: { theme_id: "iwxa-default", tokens_path: "/_iwxa/tokens.css", font_loading: "system-stack", supports_dark_mode: true },
    layout: { header_variant: "domain", footer_variant: "domain", content_width: "wide", density: "comfortable", workspace_chrome: "integrated", mobile_navigation: "drawer" },
    navigation: { active_route_strategy: "longest-prefix", breadcrumbs: true, primary: [{ id: "workspace", label: "Workspace", path: "/workspace/", order: 0, kind: "workspace", match_prefix: "/workspace/" }], utility: [] },
    workspace_entry: { id: "workspace", label: "Workspace", path: "/workspace/", placement: "primary" },
    accessibility: { focus_visible: true, reduced_motion: "respect-system", minimum_contrast: "WCAG-AA" },
    release: { host_owned: true, preserve_on_kernel_overlay: true },
  };
  const workspaceConfig = {
    workspace_config_schema_version: "1.0.0",
    config_version: "0.34.0-rc.20-integration",
    domain_id: domain.domain_id,
    workspace_service_id: SERVICE_ID,
    base_path: "/workspace/",
    profile: "generic",
    shell_config_path: "/_iwxa/domain-shell.json",
    host: { required_contract_version: CONTRACT_VERSION, required_runtime_version: RUNTIME_VERSION, local_store_name: "iwxa-local", storage_access: "iwxa-client-only", direct_indexeddb: false },
    module_loading: { strategy: "compile-time-registry", allow_remote_modules: false, lazy_loading: "dynamic-import", unknown_module_policy: "disable-with-diagnostics" },
    navigation: { home_path: "/workspace/", back_to_domain_path: "/", inherit_domain_navigation: true, route_references: "opaque" },
    terminology: {},
    modules: [
      { module_id: "iwxa.workspace.base", state: "active", ui_mode: "standard", route_base: "/workspace/", slots: ["main"], required_levels: ["T0"], required_operations: [], object_schemas: [], dependencies: [] },
      { module_id: "iwxa.workspace.exchange", state: "active", ui_mode: "standard", route_base: "/workspace/exchange/", slots: [], required_levels: ["T2"], required_operations: [], object_schemas: [], dependencies: ["iwxa.workspace.base"] },
      { module_id: "iwxa.workspace.lifecycle", state: "active", ui_mode: "standard", route_base: "/workspace/lifecycle/", slots: [], required_levels: ["T1"], required_operations: [], object_schemas: [], dependencies: ["iwxa.workspace.base"] },
    ],
    unknown_objects: { preserve: true, viewer: "generic-inspector", editing: "read-only" },
    security: { trusted_build_modules_only: true, module_direct_indexeddb: false, executable_code_in_iwxa: false, remote_module_urls: false },
    release: { build_strategy: "per-domain-static-build", exclude_test_harness: true, exclude_unconfigured_modules: true },
  };
  const passport = {
    service_id: SERVICE_ID,
    service_version: "1.0.0",
    base_path: "/workspace/",
    supported_levels: ["T0", "T1", "T2"],
    input_object_types: [SCHEMA_ID],
    output_object_types: [SCHEMA_ID],
    schemas: { [SCHEMA_ID]: { schema_version: "1.0.0", preserve_unknown: true, json_schema: { type: "object" }, embedded: {} } },
    permissions: {
      workspace: { list: true, read: true, create: true, soft_delete: true, restore: true, purge: true },
      objects: { read: [SCHEMA_ID], write: [SCHEMA_ID], delete: [SCHEMA_ID] },
      events: { read_scope: "workspace" },
      packages: { export: true, import: true, export_scope: "readable_objects", import_scope: "writable_objects" },
    },
  };
  const controlPlane = {
    schema_version: "0.3.1",
    snapshot_id: "workspace-real-kernel-integration",
    resolver_id: "iwxa.test.control-plane",
    trusted_issuers: [],
    issuance_policies: [],
    services: [{ schema_version: "0.3.1", service_id: SERVICE_ID, capability_control: "NONE", capability_ceiling: [], activation_any_of: [], operation_guards: [] }],
  };
  writeJson(resolve(iwxa, "domain.json"), domain);
  writeJson(resolve(iwxa, "domain-shell.json"), shell);
  writeJson(resolve(workspace, "workspace.config.json"), workspaceConfig);
  writeJson(resolve(iwxa, `services/${SERVICE_ID}.json`), passport);
  writeJson(resolve(iwxa, "security/capability-control-plane.json"), controlPlane);

  mkdirSync(resolve(iwxa, "brand"), { recursive: true });
  writeFileSync(resolve(iwxa, "brand/logo.svg"), SYNTHETIC_LOGO_SVG);
  writeFileSync(resolve(iwxa, "tokens.css"), SYNTHETIC_TOKENS_CSS);
  const faviconSource = resolve(process.cwd(), "public/favicon.ico");
  if (!existsSync(faviconSource)) throw new Error(`REAL_KERNEL_FAVICON_SOURCE_MISSING: ${faviconSource}`);
  cpSync(faviconSource, resolve(root, "favicon.ico"));

  return { domain, shell, workspaceConfig, passport, controlPlane };
}

export async function validateSynthesizedDomain(iwxaDir, domain, origin) {
  const validatorPath = resolve(iwxaDir, "validator.js");
  if (!existsSync(validatorPath)) throw new Error(`REAL_KERNEL_VALIDATOR_MISSING: ${validatorPath}`);
  const validatorModule = await import(pathToFileURL(validatorPath).href + `?iwxa=${Date.now()}`);
  if (typeof validatorModule.validateDomainConfig !== "function") {
    throw new Error("REAL_KERNEL_VALIDATOR_EXPORT_MISSING: validateDomainConfig");
  }
  const result = validatorModule.validateDomainConfig(domain, { current_origin: origin });
  if (!result?.ok) {
    throw new Error(`REAL_KERNEL_DOMAIN_CONFIG_INVALID: ${result?.code ?? "UNKNOWN"}: ${result?.message ?? "validation failed"}`);
  }
}

export function validateSynthesizedWorkspaceHost({ domain, shell, workspaceConfig }, origin) {
  const issues = [];
  if (!origin.startsWith("https://")) issues.push("runtime origin must be https");
  if (domain.origin !== origin || shell.origin !== origin) issues.push("domain/shell origin mismatch");
  if (domain.domain_id !== shell.domain_id || domain.domain_id !== workspaceConfig.domain_id) issues.push("domain_id mismatch");
  if (domain.workspace_profile !== workspaceConfig.profile) issues.push("workspace profile mismatch");
  if (!domain.enabled_profiles.includes(workspaceConfig.profile)) issues.push("workspace profile not enabled");
  if (workspaceConfig.workspace_service_id !== SERVICE_ID) issues.push("workspace service mismatch");
  if (!domain.modules.some((m) => m.service_id === SERVICE_ID && m.base_path === "/workspace/")) issues.push("workspace module missing");
  if (workspaceConfig.host.required_contract_version !== CONTRACT_VERSION) issues.push("contract version mismatch");
  if (workspaceConfig.host.required_runtime_version !== RUNTIME_VERSION || domain.runtime.runtime_version !== RUNTIME_VERSION) issues.push("runtime version mismatch");
  if (workspaceConfig.host.local_store_name !== domain.local_store_name || domain.local_store_name !== "iwxa-local") issues.push("local store mismatch");
  if (issues.length) throw new Error(`REAL_KERNEL_WORKSPACE_HOST_INVALID: ${issues.join("; ")}`);
}

export async function runRealKernelRoundtrip({ artifactDir }) {
  const iwxaSrc = resolveIwxaSourceDir(artifactDir);
  if (!iwxaSrc) throw new Error(`REAL_KERNEL_ARTIFACT_INVALID: ${artifactDir}`);
  const wsBuild = resolve(process.cwd(), "dist");
  if (!existsSync(wsBuild)) throw new Error("REAL_KERNEL_WORKSPACE_BUILD_MISSING: run npm run build first");

  const integrationRoot = mkdtempSync(join(tmpdir(), "iwxa-real-kernel-"));
  mkdirSync(resolve(integrationRoot, "_iwxa"), { recursive: true });
  cpSync(iwxaSrc, resolve(integrationRoot, "_iwxa"), { recursive: true });
  cpSync(wsBuild, resolve(integrationRoot, "workspace"), { recursive: true });

  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { rmSync(integrationRoot, { recursive: true, force: true }); throw new Error("REAL_KERNEL_PLAYWRIGHT_MISSING"); }

  const { server, origin } = await serveRealKernelHost(integrationRoot);
  const synthesized = materializeIntegrationHost(integrationRoot, origin);
  validateSynthesizedWorkspaceHost(synthesized, origin);
  await validateSynthesizedDomain(resolve(integrationRoot, "_iwxa"), synthesized.domain, origin);
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const consoleErrors = [];
    const pageErrors = [];
    const requestFailures = [];
    const badResponses = [];
    const instrumentedPages = new WeakSet();
    const attachDiagnostics = (observedPage) => {
      if (instrumentedPages.has(observedPage)) return;
      instrumentedPages.add(observedPage);
      observedPage.on("pageerror", (e) => pageErrors.push(`${observedPage.url()} :: ${String(e)}`));
      observedPage.on("console", (m) => {
        if (m.type() === "error") {
          const loc = m.location();
          const source = loc?.url ? ` @ ${loc.url}:${loc.lineNumber ?? 0}:${loc.columnNumber ?? 0}` : "";
          consoleErrors.push(`${observedPage.url()} :: ${m.text()}${source}`);
        }
      });
      observedPage.on("requestfailed", (req) => requestFailures.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? "failed"}`));
      observedPage.on("response", (resp) => { if (resp.status() >= 400) badResponses.push(`${resp.status()} ${resp.request().method()} ${resp.url()}`); });
    };
    context.on("page", attachDiagnostics);
    const page = await context.newPage();
    attachDiagnostics(page);

    await page.goto(`${origin}/workspace/`, { waitUntil: "networkidle" });
    const controlPlaneProbe = await page.evaluate(async () => {
      try {
        const res = await fetch("/_iwxa/security/capability-control-plane.json", { cache: "no-store", credentials: "same-origin" });
        const text = await res.text();
        let body = null;
        try { body = JSON.parse(text); } catch { body = null; }
        return { ok: res.ok, status: res.status, url: res.url, schema_version: body?.schema_version ?? null, service_count: Array.isArray(body?.services) ? body.services.length : null, text: text.slice(0, 512) };
      } catch (error) {
        return { ok: false, status: 0, url: null, schema_version: null, service_count: null, text: String(error) };
      }
    });
    if (!controlPlaneProbe.ok || controlPlaneProbe.schema_version !== "0.3.1") {
      throw new Error(`REAL_KERNEL_CONTROL_PLANE_ENDPOINT_INVALID: ${JSON.stringify(controlPlaneProbe)}`);
    }
    try {
      await page.waitForFunction(() => typeof globalThis.IWXA?.connect === "function", undefined, { timeout: 30_000 });
    } catch (error) {
      const loaderState = await page.evaluate(() => ({
        iwxaType: typeof globalThis.IWXA,
        connectType: typeof globalThis.IWXA?.connect,
        location: globalThis.location.href,
      })).catch(() => null);
      throw new Error(`REAL_KERNEL_CONNECT_TIMEOUT: ${error?.message ?? error}; loaderState=${JSON.stringify(loaderState)}; console=${JSON.stringify(consoleErrors)}; requests=${JSON.stringify(requestFailures)}; badResponses=${JSON.stringify(badResponses)}`);
    }

    const mainWorkspaceId = `stagec-main-${Date.now()}`;
    const objectId = `stagec-object-${Date.now()}`;
    const restoreWorkspaceId = `stagec-restore-${Date.now()}`;
    const purgeWorkspaceId = `stagec-purge-${Date.now()}`;

    const scenario = await page.evaluate(async ({ mainWorkspaceId, objectId, restoreWorkspaceId, purgeWorkspaceId, serviceId, schemaId, runtimeVersion }) => {
      try {
      const client = await globalThis.IWXA.connect({ service_id: serviceId, required_levels: ["T1", "T2"] });
      const envelope = { contract_version: client.contract_version, runtime_version: client.runtime_version, granted_levels: client.granted_levels, granted_operations: client.granted_operations, mode: client.mode };
      if (envelope.contract_version !== "1.2.0" || envelope.runtime_version !== runtimeVersion) throw new Error("REAL_KERNEL_ENVELOPE_MISMATCH");
      const requiredOperations = ["t1.createWorkspace","t1.listWorkspaces","t1.getWorkspace","t1.putObject","t1.listObjects","t1.getObject","t1.softDeleteWorkspace","t1.restoreWorkspace","t1.purgePreview","t1.purgeCommit","t1.purgeCancel","t2.exportPreview","t2.exportPackage","t2.confirmExport","t2.importPreview","t2.importCommit","t2.importCancel"];
      const missingOps = requiredOperations.filter((op) => !client.granted_operations?.includes(op));
      if (missingOps.length) throw new Error(`REAL_KERNEL_INSUFFICIENT_GRANTS: ${missingOps.join(",")}`);
      await client.t1.createWorkspace({ workspace_id: mainWorkspaceId, profile: "generic" });
      await client.t1.putObject({ workspace_id: mainWorkspaceId, object_id: objectId, schema_id: schemaId, schema_version: "1.0.0", data: { title: "stage-c main" }, extensions: {}, base_revision: 0, event: { event_type: "test.object.created", payload: {} } });
      const mainWs = await client.t1.getWorkspace(mainWorkspaceId);
      const objList = await client.t1.listObjects({ workspace_id: mainWorkspaceId });
      const objFetched = await client.t1.getObject(mainWorkspaceId, objectId);
      if (!mainWs || !objList.some((o) => o.object_id === objectId) || objFetched?.object?.object_id !== objectId) throw new Error("REAL_KERNEL_OBJECT_LIFECYCLE_MISMATCH");
      const options = { workspaces: [mainWorkspaceId], include_history: true, include_assets: true, include_relations: true, include_schemas: true };
      const exportPreview = await client.t2.exportPreview(options);
      if (!exportPreview.workspaces?.includes(mainWorkspaceId)) throw new Error("REAL_KERNEL_EXPORT_PREVIEW_MISSING_WORKSPACE");
      const artifact = await client.t2.exportPackage(options);
      const confirmation = await client.t2.confirmExport({ package_digest: artifact.package_digest, workspace_ids: [mainWorkspaceId] });
      const importPreview = await client.t2.importPreview(artifact.bytes);
      const mode = importPreview.allowed_modes?.includes("full") ? "full" : "selective";
      const importReceipt = await client.t2.importCommit({ preview_token: importPreview.preview_token, package_digest: importPreview.package_digest, plan: { mode, include_workspaces: [mainWorkspaceId], include_history: true, include_assets: true, include_relations: true, conflict: "skip" } });
      const secondPreview = await client.t2.importPreview(artifact.bytes);
      const importCancelled = await client.t2.importCancel(secondPreview.preview_token);
      await client.t1.createWorkspace({ workspace_id: restoreWorkspaceId, profile: "generic" });
      await client.t1.softDeleteWorkspace(restoreWorkspaceId);
      await client.t1.restoreWorkspace(restoreWorkspaceId);
      const restored = await client.t1.getWorkspace(restoreWorkspaceId);
      await client.t1.createWorkspace({ workspace_id: purgeWorkspaceId, profile: "generic" });
      await client.t1.softDeleteWorkspace(purgeWorkspaceId);
      const firstPurge = await client.t1.purgePreview({ workspace_id: purgeWorkspaceId, acknowledge_no_backup: false });
      const purgeCancelled = await client.t1.purgeCancel(firstPurge.purge_token);
      const purgePreview = await client.t1.purgePreview({ workspace_id: purgeWorkspaceId, acknowledge_no_backup: true });
      const purgeReceipt = await client.t1.purgeCommit({ purge_token: purgePreview.purge_token, confirmation: purgePreview.challenge });
      const gone = await client.t1.getWorkspace(purgeWorkspaceId);
      globalThis.__IWXA_E2E__ = { workspace_id: mainWorkspaceId, object_id: objectId };
      return { envelope, exportConfirmed: confirmation.package_digest === artifact.package_digest, importCommitted: Boolean(importReceipt), importCancelled: importCancelled === true, restoreAsserted: Boolean(restored && restored.deleted_at == null), purgeCancelled: purgeCancelled === true, purgeAsserted: purgeReceipt.removed?.workspaces === 1 && gone == null };
      } catch (error) {
        const e = error;
        throw new Error(`REAL_KERNEL_SCENARIO_FAILED: name=${e?.name ?? "unknown"}; code=${e?.code ?? "none"}; message=${e?.message ?? String(e)}; details=${JSON.stringify(e?.details ?? null)}`);
      }
    }, { mainWorkspaceId, objectId, restoreWorkspaceId, purgeWorkspaceId, serviceId: SERVICE_ID, schemaId: SCHEMA_ID, runtimeVersion: RUNTIME_VERSION });

    let staticRoutesAsserted = true;
    for (const path of ["/workspace/", "/workspace/exchange/", "/workspace/lifecycle/"]) {
      const routePage = await context.newPage();
      attachDiagnostics(routePage);
      const resp = await routePage.goto(`${origin}${path}`, { waitUntil: "networkidle" });
      if (!resp || resp.status() >= 400) staticRoutesAsserted = false;
      await routePage.close();
    }
    const route = `#/workspace/${mainWorkspaceId}/object/${objectId}`;
    await page.goto(`${origin}/workspace/${route}`, { waitUntil: "networkidle" });
    const domVisible = await page.locator('[data-testid="object-view"]').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    const domObjectId = await page.locator('[data-testid="object-view"]').innerText().catch(() => "");

    await page.goto(`${origin}/workspace/#/overview`, { waitUntil: "networkidle" });
    const overviewVisible = await page.locator('[data-testid="host-dashboard-surface"]').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    const dashboardCardVisible = await page.locator('[data-testid^="dashboard-card-"]').first().isVisible().catch(() => false);

    await page.goto(`${origin}/workspace/#/workspace/${encodeURIComponent(mainWorkspaceId)}`, { waitUntil: "networkidle" });
    const workspaceDetailVisible = await page.locator('[data-testid="workspace-view"]').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    const richWorkspaceVisible = await page.locator('[data-testid="rich-workspace-read-model"]').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    const modeChecks = {};
    for (const [title, testId] of [
      ["Объекты", "rich-workspace-master-detail"],
      ["Очереди", "rich-workspace-queues"],
      ["Сравнение", "rich-workspace-compare"],
      ["Receipts", "rich-workspace-receipts-boundary"],
    ]) {
      await page.getByRole("button", { name: title, exact: true }).click();
      modeChecks[title] = await page.locator(`[data-testid="${testId}"]`).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    }
    const savedViewsVisible = await page.locator('[data-testid="rich-workspace-saved-view-previews"]').isVisible().catch(() => false)
      && await page.locator('[data-testid="rich-workspace-working-views"]').isVisible().catch(() => false);

    return { source: "real-kernel", envelope: scenario.envelope, control_plane_probe: controlPlaneProbe, main_workspace_id: mainWorkspaceId, object_id: objectId, export_confirmed: scenario.exportConfirmed, import_committed: scenario.importCommitted, import_cancelled: scenario.importCancelled, restore_asserted: scenario.restoreAsserted, purge_cancelled: scenario.purgeCancelled, purge_asserted: scenario.purgeAsserted, static_routes_asserted: staticRoutesAsserted, dom: { route, object_view_visible: domVisible, dom_contains_object_id: domObjectId.includes(objectId) }, ui: { overview_visible: overviewVisible, dashboard_card_visible: dashboardCardVisible, workspace_detail_visible: workspaceDetailVisible, rich_workspace_visible: richWorkspaceVisible, objects_mode_visible: modeChecks["Объекты"] === true, queues_mode_visible: modeChecks["Очереди"] === true, compare_mode_visible: modeChecks["Сравнение"] === true, receipts_mode_visible: modeChecks.Receipts === true, saved_views_visible: savedViewsVisible }, console_errors: consoleErrors, page_errors: pageErrors, request_failures: requestFailures, bad_responses: badResponses };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(integrationRoot, { recursive: true, force: true });
  }
}
