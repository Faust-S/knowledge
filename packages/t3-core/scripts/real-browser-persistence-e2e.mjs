import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const FAMILY = "iwxa.persistence.e2e";
const OWNER_ID = "iwxa.persistence.e2e.owner";
const COMMAND_ID = "persistence.write";
const OBJECT_ID = "object-1";
const PRIMARY_DB = "iwxa-t2-real-browser-primary";
const ISOLATED_DB = "iwxa-t2-real-browser-isolated";

const root = process.cwd();
const resultPath = resolve(process.argv[2] ?? "real-browser-persistence.json");

function mime(path) {
  if (path.endsWith(".mjs") || path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname === "/") {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end("<!doctype html><html><head><meta charset=\"utf-8\"><link rel=\"icon\" href=\"data:,\"></head><body>IWXA T2 real browser persistence qualification</body></html>");
        return;
      }
      const candidate = resolve(root, `.${pathname}`);
      const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
      if (candidate !== root && !candidate.startsWith(rootPrefix)) throw new Error("PATH_TRAVERSAL");
      const info = await stat(candidate).catch(() => null);
      if (!info?.isFile()) throw new Error("NOT_FOUND");
      const body = await readFile(candidate);
      res.statusCode = 200;
      res.setHeader("content-type", mime(candidate));
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
      if (!address || typeof address === "string") {
        reject(new Error("PERSISTENCE_SERVER_ADDRESS_INVALID"));
        return;
      }
      resolveListen({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function deleteDatabases(page, names) {
  await page.evaluate(async (dbNames) => {
    const deleteOne = (name) => new Promise((resolveDelete, rejectDelete) => {
      const request = globalThis.indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolveDelete();
      request.onerror = () => rejectDelete(request.error ?? new Error(`deleteDatabase failed for ${name}`));
      request.onblocked = () => rejectDelete(new Error(`deleteDatabase blocked for ${name}`));
    });
    for (const name of dbNames) await deleteOne(name);
  }, names);
}

async function seedPrimary(page, dbName) {
  return page.evaluate(async ({ dbName, family, ownerId, commandId, objectId }) => {
    const { IndexedDbCanonicalAdapter, OwnerWriteGateway } = await import("/src/persistence/index.mjs");
    const { CanonicalInstant } = await import("/src/foundation/time.mjs");
    const { ExactDecimal } = await import("/src/foundation/exact-decimal.mjs");
    const gateway = new OwnerWriteGateway({ adapter: new IndexedDbCanonicalAdapter({ dbName }) });
    gateway.registerOwner({ family, ownerId, commands: [commandId], headKind: "source" });
    await gateway.execute({
      family,
      ownerId,
      commandId,
      objectId,
      recordId: "browser-r1",
      expectedRevisionId: null,
      knowledgeAt: new CanonicalInstant(100n),
      payload: { label: "first", amount: ExactDecimal.parse("12.3400") },
      refs: { provenanceId: "browser-evidence-1" },
    });
    await gateway.execute({
      family,
      ownerId,
      commandId,
      objectId,
      recordId: "browser-r2",
      expectedRevisionId: "browser-r1",
      knowledgeAt: new CanonicalInstant(200n),
      payload: { label: "second", amount: ExactDecimal.parse("99.005") },
      refs: { provenanceId: "browser-evidence-2" },
    });
    const head = await gateway.head(family, objectId);
    return { recordId: head?.recordId ?? null, revision: head?.revision ?? null };
  }, { dbName, family: FAMILY, ownerId: OWNER_ID, commandId: COMMAND_ID, objectId: OBJECT_ID });
}

async function readSnapshot(page, dbName) {
  return page.evaluate(async ({ dbName, family, objectId }) => {
    const { IndexedDbCanonicalAdapter, OwnerWriteGateway } = await import("/src/persistence/index.mjs");
    const gateway = new OwnerWriteGateway({ adapter: new IndexedDbCanonicalAdapter({ dbName }) });
    const head = await gateway.head(family, objectId);
    const record = await gateway.record("browser-r2");
    const history = await gateway.history(family, objectId);
    const audit = await gateway.audit();
    return {
      head: head == null ? null : {
        recordId: head.recordId,
        revision: head.revision,
        sourceHeadRef: head.sourceHeadRef,
        ownerId: head.ownerId,
      },
      record: record == null ? null : {
        recordId: record.recordId,
        previousRevisionId: record.previousRevisionId,
        revision: record.revision,
        ownerId: record.ownerId,
        commandId: record.commandId,
        knowledgeAt: record.knowledgeAt.epochNanoseconds.toString(),
        label: record.payload?.label ?? null,
        amount: record.payload?.amount?.toString?.() ?? null,
        provenanceId: record.refs?.provenanceId ?? null,
      },
      historyIds: history.map((entry) => entry.recordId),
      auditIds: audit.map((entry) => entry.recordId),
    };
  }, { dbName, family: FAMILY, objectId: OBJECT_ID });
}

function observePage(page, diagnostics) {
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error?.message ?? error)));
  page.on("requestfailed", (request) => diagnostics.requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "unknown"}`));
  page.on("response", (response) => {
    if (response.status() >= 400) diagnostics.badResponses.push(`${response.status()} ${response.url()}`);
  });
}

function persistResult(result) {
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], badResponses: [] };
let server;
let browser;
let origin = null;
let browserVersion = null;

try {
  ({ server, origin } = await startServer());
  browser = await chromium.launch({ headless: true });
  browserVersion = browser.version();

  const context = await browser.newContext();
  const page = await context.newPage();
  observePage(page, diagnostics);
  await page.goto(origin, { waitUntil: "load" });
  await deleteDatabases(page, [PRIMARY_DB, ISOLATED_DB]);

  const seeded = await seedPrimary(page, PRIMARY_DB);
  await page.reload({ waitUntil: "load" });
  const afterReload = await readSnapshot(page, PRIMARY_DB);
  const isolatedDb = await readSnapshot(page, ISOLATED_DB);

  const isolatedContext = await browser.newContext();
  const isolatedPage = await isolatedContext.newPage();
  observePage(isolatedPage, diagnostics);
  await isolatedPage.goto(origin, { waitUntil: "load" });
  const isolatedContextSnapshot = await readSnapshot(isolatedPage, PRIMARY_DB);
  await isolatedContext.close();
  await context.close();

  const checks = {
    seededSecondRevision: seeded.recordId === "browser-r2" && seeded.revision === 2,
    reloadHeadReadback: afterReload.head?.recordId === "browser-r2" && afterReload.head?.revision === 2 && afterReload.head?.sourceHeadRef === "browser-r2",
    reloadRecordReadback: afterReload.record?.recordId === "browser-r2" && afterReload.record?.previousRevisionId === "browser-r1" && afterReload.record?.revision === 2,
    canonicalValueReadback: afterReload.record?.knowledgeAt === "200" && afterReload.record?.amount === "99.005",
    ownerAndProvenanceReadback: afterReload.record?.ownerId === OWNER_ID && afterReload.record?.commandId === COMMAND_ID && afterReload.record?.provenanceId === "browser-evidence-2",
    appendHistoryReadback: JSON.stringify(afterReload.historyIds) === JSON.stringify(["browser-r1", "browser-r2"]),
    appendAuditReadback: JSON.stringify(afterReload.auditIds) === JSON.stringify(["browser-r1", "browser-r2"]),
    sameOriginDbNameIsolation: isolatedDb.head === null && isolatedDb.record === null && isolatedDb.historyIds.length === 0 && isolatedDb.auditIds.length === 0,
    browserContextIsolation: isolatedContextSnapshot.head === null && isolatedContextSnapshot.record === null && isolatedContextSnapshot.historyIds.length === 0 && isolatedContextSnapshot.auditIds.length === 0,
    pageErrorsEmpty: diagnostics.pageErrors.length === 0,
    consoleErrorsEmpty: diagnostics.consoleErrors.length === 0,
    requestFailuresEmpty: diagnostics.requestFailures.length === 0,
    badResponsesEmpty: diagnostics.badResponses.length === 0,
  };
  const pass = Object.values(checks).every(Boolean);
  const result = {
    schemaVersion: "iwxa.t2.real-browser-persistence.v1",
    status: pass ? "PASS" : "FAIL",
    release_ready: false,
    commit: process.env.GITHUB_SHA ?? null,
    runner: {
      os: process.env.RUNNER_OS ?? process.platform,
      arch: process.env.RUNNER_ARCH ?? process.arch,
      image: process.env.ImageOS ?? null,
    },
    browser: { engine: "chromium", version: browserVersion },
    origin,
    adapter: "IndexedDbCanonicalAdapter",
    source: "src/persistence/canonical-persistence.mjs",
    checks,
    seeded,
    afterReload,
    isolatedDb,
    isolatedContext: isolatedContextSnapshot,
    diagnostics,
    projectProcessWriteOwner: "PROJECT_PROCESS_WRITE_OWNER_UNBOUND",
  };
  persistResult(result);
  console.log(JSON.stringify(result, null, 2));
  if (!pass) process.exitCode = 1;
} catch (error) {
  const failure = {
    schemaVersion: "iwxa.t2.real-browser-persistence.v1",
    status: "FAIL",
    release_ready: false,
    commit: process.env.GITHUB_SHA ?? null,
    runner: {
      os: process.env.RUNNER_OS ?? process.platform,
      arch: process.env.RUNNER_ARCH ?? process.arch,
      image: process.env.ImageOS ?? null,
    },
    browser: { engine: "chromium", version: browserVersion },
    origin,
    adapter: "IndexedDbCanonicalAdapter",
    source: "src/persistence/canonical-persistence.mjs",
    diagnostics,
    error: { message: String(error?.message ?? error), stack: String(error?.stack ?? "") },
    projectProcessWriteOwner: "PROJECT_PROCESS_WRITE_OWNER_UNBOUND",
  };
  persistResult(failure);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolveClose) => server.close(() => resolveClose()));
}
