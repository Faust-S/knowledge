// IWXA T3 - domain-wide browser offline mode. One first-party origin,
// no second Kernel/Store; public site resources only, not user data/model weights.
const SCHEMA = "iwxa.t3.domain-offline/1";
const PREFIX = "iwxa-t3-domain-snapshot:";
const MARKER = "/_iwxa/t3-domain-snapshot";
const MANIFEST_PATH = "/t3-offline-manifest.json";
const MODE_CACHE = "iwxa-t3-domain-mode-v1";
const ACTIVE_MARKER = "/_iwxa/t3-domain-mode-enabled";
async function isEnabled() {
  const cache = await caches.open(MODE_CACHE);
  return !!(await cache.match(ACTIVE_MARKER));
}
async function setEnabled(value) {
  const cache = await caches.open(MODE_CACHE);
  if (value) await cache.put(ACTIVE_MARKER, new Response("on"));
  else await cache.delete(ACTIVE_MARKER);
}
let current = null;
let installRunning = false;

// An explicit, short-lived WebLLM installation exception for the already
// selected model. Normal autonomous browsing and model inference remain
// cache-only; the original WebLLM cache owns the downloaded files.
let modelInstall = null;
const MODEL_INSTALL_MS = 15 * 60 * 1000;
function modelInstallSources(data) {
  let model, wasm;
  try {
    model = new URL(data?.model_url);
    wasm = new URL(data?.wasm_url);
  } catch { throw Error("T3_MODEL_INSTALL_SOURCE_INVALID"); }
  if (model.origin !== "https://huggingface.co" ||
      !/^\\/mlc-ai\\/[A-Za-z0-9][A-Za-z0-9._-]{1,128}$/.test(model.pathname) ||
      wasm.origin !== "https://raw.githubusercontent.com" ||
      !/^\\/mlc-ai\\/binary-mlc-llm-libs\\/main\\/web-llm-models\\/v0_2_87\\/base\\/[A-Za-z0-9._-]+\\.wasm$/.test(wasm.pathname) ||
      model.search || model.hash || model.username || model.password ||
      wasm.search || wasm.hash || wasm.username || wasm.password) {
    throw Error("T3_MODEL_INSTALL_SOURCE_INVALID");
  }
  return {modelPath:model.pathname,wasm:wasm.href};
}
function modelFetchAllowed(request, url) {
  if (!modelInstall) return false;
  if (Date.now() >= modelInstall.deadline) {
    modelInstall = null;
    return false;
  }
  if (request.method !== "GET" || url.username || url.password || url.hash ||
      (url.search && url.search !== "?download=true")) return false;
  return url.href === modelInstall.wasm ||
    (url.origin === "https://huggingface.co" &&
      url.pathname.startsWith(modelInstall.modelPath + "/resolve/") &&
      url.pathname.length > (modelInstall.modelPath + "/resolve/").length);
}
async function beginModelInstall(event, port) {
  try {
    const state = await installed();
    if (!state?.complete) throw Error("T3_MODEL_INSTALL_AUTONOMY_REQUIRED");
    if (event.source?.type !== "window" || !event.source.id ||
        new URL(event.source.url).origin !== self.location.origin) {
      throw Error("T3_MODEL_INSTALL_WINDOW_REQUIRED");
    }
    if (modelInstall && Date.now() < modelInstall.deadline) {
      throw Error("T3_MODEL_INSTALL_BUSY");
    }
    const sources = modelInstallSources(event.data);
    const token = crypto.randomUUID();
    modelInstall = {...sources,token,owner:event.source.id,
      deadline:Date.now() + MODEL_INSTALL_MS};
    port.postMessage({type:"MODEL_INSTALL_ALLOWED",token});
  } catch (error) {
    port.postMessage({type:"FAILED",message:String(error?.message || error)});
  }
}
function endModelInstall(event, port) {
  if (!modelInstall || event.source?.id !== modelInstall.owner ||
      event.data?.token !== modelInstall.token) {
    port.postMessage({type:"FAILED",message:"T3_MODEL_INSTALL_TOKEN_INVALID"});
    return;
  }
  modelInstall = null;
  port.postMessage({type:"MODEL_INSTALL_ENDED"});
}

function responseError() {
  return new Response("T3 autonomous mode: this resource is not installed on this device.", {
    status: 503, statusText: "T3 offline resource unavailable",
    headers: {"content-type": "text/plain; charset=utf-8"}
  });
}
function hex(buffer) {
  return Array.from(new Uint8Array(buffer), x => x.toString(16).padStart(2, "0")).join("");
}
function validate(manifest) {
  if (!manifest || manifest.schema !== SCHEMA || typeof manifest.version !== "string" ||
      !/^[a-f0-9]{64}$/.test(manifest.version) ||
      !Array.isArray(manifest.files) || manifest.files.length < 4 ||
      manifest.files.length > 50000 || manifest.complete_static_tree !== true) {
    throw new Error("T3_DOMAIN_MANIFEST_INVALID");
  }
  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" ||
        !file.path.startsWith("/") || file.path.includes("?") || file.path.includes("#") ||
        file.path.includes("\\") || file.path.includes("//") ||
        file.path.split("/").includes("..") ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
        seen.has(file.path) ||
        (file.source !== undefined &&
          (typeof file.source !== "string" || !file.source.startsWith("/") ||
           file.source.includes("..") || file.source.includes("//")))) {
      throw new Error("T3_DOMAIN_FILE_INVALID");
    }
    seen.add(file.path);
  }
  for (const file of manifest.files) {
    if (file.source && (!seen.has(file.source) || file.source === file.path)) {
      throw new Error("T3_DOMAIN_FILE_SOURCE_UNKNOWN");
    }
  }
  for (const required of ["/", "/workspace/", "/_iwxa/domain.json",
      "/t3-domain-mode.mjs", "/t3-sw.js"]) {
    if (!seen.has(required)) throw new Error("T3_DOMAIN_REQUIRED_ASSET_MISSING");
  }
  return manifest;
}
async function snapshotComplete(cache, metadata) {
  const keys = new Set((await cache.keys()).map(req => new URL(req.url).pathname));
  return metadata.files.every(file => keys.has(file.path));
}
async function installed() {
  // Opt-out survives Service Worker termination, browser restart and tabs.
  // Cached assets alone must NEVER silently reactivate autonomous mode.
  if (!await isEnabled()) { current = null; return null; }
  if (current) return current;
  const names = (await caches.keys()).filter(x => x.startsWith(PREFIX)).reverse();
  for (const name of names) {
    const cache = await caches.open(name);
    const entry = await cache.match(MARKER);
    if (!entry) continue;
    try {
      const metadata = validate(await entry.json());
      if (name !== PREFIX + metadata.version) continue;
      current = {name, files: new Set(metadata.files.map(x => x.path)), manifest: metadata,
        complete: await snapshotComplete(cache, metadata)};
      return current;
    } catch { /* Ignore incomplete snapshots. */ }
  }
  return null;
}
async function installSnapshot(port, expectedVersion = null) {
  if (installRunning) {
    port.postMessage({type: "FAILED", message: "T3_DOMAIN_INSTALL_BUSY"});
    return;
  }
  installRunning = true;
  let pending = null;
  try {
    // The worker fetches its own same-origin manifest; the page cannot
    // supply arbitrary cache URLs or impersonate another domain.
    const result = await fetch(MANIFEST_PATH, {cache: "no-store", credentials: "same-origin"});
    if (!result.ok) throw new Error("T3_DOMAIN_MANIFEST_UNAVAILABLE");
    const manifest = validate(await result.json());
    if (expectedVersion !== null && manifest.version !== expectedVersion) {
      throw new Error("T3_DOMAIN_VERSION_CHANGED_RECONFIRM");
    }
    const name = PREFIX + manifest.version;
    const cache = await caches.open(name);
    // A complete identical snapshot is immutable; never overwrite its
    // files while attempting to reinstall it.
    const complete = await cache.match(MARKER);
    if (complete) {
      try {
        const old = validate(await complete.json());
        if (old.version === manifest.version && await snapshotComplete(cache, old)) {
          current = {name, files: new Set(old.files.map(x => x.path)), manifest: old,
            complete: true};
          await setEnabled(true);
          port.postMessage({type: "READY", version: old.version, files: old.files.length});
          return;
        }
      } catch { throw Error("T3_DOMAIN_SNAPSHOT_CONFLICT"); }
    }
    pending = name;
    let count = 0;
    for (const file of manifest.files) {
      const url = new URL(file.path, self.location.origin);
      if (url.origin !== self.location.origin) throw new Error("T3_DOMAIN_CROSS_ORIGIN_FORBIDDEN");
      const from = new URL(file.source || file.path, self.location.origin).href;
      const response = file.source
        ? await cache.match(from) : await fetch(from, {cache: "reload", credentials: "same-origin"});
      if (!response || !response.ok || response.type === "opaque") {
        throw new Error("T3_DOMAIN_FETCH_FAILED:" + file.path);
      }
      const bytes = await response.clone().arrayBuffer();
      if (bytes.byteLength !== file.bytes ||
          hex(await crypto.subtle.digest("SHA-256", bytes)) !== file.sha256) {
        throw new Error("T3_DOMAIN_INTEGRITY_MISMATCH:" + file.path);
      }
      await cache.put(url.href, response.clone());
      count++;
      if (count % 8 === 0 || count === manifest.files.length) {
        port.postMessage({type: "PROGRESS", done: count, total: manifest.files.length});
      }
    }
    // Only this marker makes the cache eligible for cache-only fetches.
    await cache.put(MARKER, new Response(JSON.stringify(manifest), {
      headers: {"content-type": "application/json"}
    }));
    // Do not delete an older complete snapshot until the new one is ready.
    current = {name, files: new Set(manifest.files.map(x => x.path)), manifest,
      complete: true};
    await setEnabled(true);
    port.postMessage({type: "READY", version: manifest.version, files: count});
  } catch (error) {
    if (pending && (!current || current.name !== pending)) await caches.delete(pending);
    port.postMessage({type: "FAILED", message: String(error?.message || error)});
  } finally {
    installRunning = false;
  }
}
async function checkUpdate(port) {
  try {
    const state = await installed();
    if (!state) throw new Error("T3_DOMAIN_NOT_INSTALLED");
    // The only permitted automatic network request is NONE. This fetch runs
    // exclusively after the user asks to check the same-origin release.
    const response = await fetch(MANIFEST_PATH, {cache: "no-store", credentials: "same-origin"});
    if (!response.ok) throw new Error("T3_DOMAIN_UPDATE_CHECK_UNAVAILABLE");
    const manifest = validate(await response.json());
    // Developer localhost fixtures can use a production HTTPS domain.json,
    // but a deployed HTTPS origin must match its own immutable release.
    if (self.location.protocol === "https:" &&
        manifest.domain_origin !== self.location.origin) {
      throw new Error("T3_DOMAIN_UPDATE_ORIGIN_MISMATCH");
    }
    const available = manifest.version !== state.manifest.version || state.complete !== true;
    port.postMessage({type: "UPDATE_STATUS", available,
      version: manifest.version, currentVersion: state.manifest.version,
      files: manifest.files.length, totalBytes: manifest.total_bytes});
  } catch (error) {
    port.postMessage({type: "FAILED", message: String(error?.message || error)});
  }
}
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  if (event.data?.type === "T3_INSTALL") {
    const port = event.ports?.[0];
    if (!port) return;
    event.waitUntil(installSnapshot(port, event.data?.expectedVersion ?? null));
  } else if (event.data?.type === "T3_CHECK_UPDATE") {
    const port = event.ports?.[0];
    if (port) event.waitUntil(checkUpdate(port));
  } else if (event.data?.type === "T3_STATUS") {
    const port = event.ports?.[0];
    if (port) event.waitUntil(installed().then(state => port.postMessage({
      type: "STATUS", active: !!state, complete: state?.complete === true,
      version: state?.manifest.version ?? null
    })));
  } else if (event.data?.type === "T3_PAGES") {
    const port = event.ports?.[0];
    if (port) event.waitUntil(installed().then(state => {
      const allowed = state?.files || new Set();
      const pages = Array.isArray(state?.manifest?.pages)
        ? state.manifest.pages.filter(x => typeof x?.path === "string" &&
          typeof x?.title === "string" && allowed.has(x.path)).slice(0,3000)
        : [];
      port.postMessage({type: "PAGES", pages});
    }));
  } else if (event.data?.type === "T3_MODEL_INSTALL_BEGIN") {
    const port = event.ports?.[0];
    if (port) event.waitUntil(beginModelInstall(event,port));
  } else if (event.data?.type === "T3_MODEL_INSTALL_END") {
    const port = event.ports?.[0];
    if (port) endModelInstall(event,port);
  } else if (event.data?.type === "T3_DISABLE") {
    const port = event.ports?.[0];
    if (port) event.waitUntil((async () => {
      try {
        await setEnabled(false);
        current = null;
        modelInstall = null;
        port.postMessage({type: "DISABLED"});
      } catch (error) {
        port.postMessage({type: "FAILED", message: String(error?.message || error)});
      }
    })());
  }
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (!["http:", "https:"].includes(url.protocol)) return;
  event.respondWith((async () => {
    const snapshot = await installed();
    if (!snapshot) return fetch(request); // No opt-in => normal domain site.
    if (url.origin !== self.location.origin || request.method !== "GET") {
      // Permission lasts only during a separately confirmed WebLLM install,
      // and only for its exact model repo and pinned upstream WASM library.
      // It never permits a general remote fallback.
      return modelFetchAllowed(request,url) ? fetch(request) : responseError();
    }
    // Queries are not used as cache keys. They cannot cause network egress.
    const path = url.pathname;
    if (!snapshot.files.has(path)) return responseError();
    const cache = await caches.open(snapshot.name);
    return await cache.match(new URL(path, self.location.origin).href) || responseError();
  })());
});
