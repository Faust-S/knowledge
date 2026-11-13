#!/usr/bin/env node
// Run only after a domain site's T3 successor and original Host/Kernel have
// been assembled into ONE final dist. Never run against the original T2.
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, readFileSync,
  realpathSync, writeFileSync, copyFileSync, cpSync} from "node:fs";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {materializePwaManifest} from "./t3-pwa-manifest.mjs";

const SCHEMA = "iwxa.t3.domain-offline/1";
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src/t3/domain-mode");
const badFiles = new Set([".env", ".env.local", "package.json", "AGENTS.md",
  "package-lock.json", "bun.lock", "tsconfig.json", "vite.config.ts"]);
const denyDirs = new Set([".git", "node_modules", ".vite", "__tests__", "tests"]);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

function fail(reason) {throw Error("T3_DOMAIN_OFFLINE_" + reason);}
function scan(root) {
  const files = [];
  function walk(dir) {
    for (const row of readdirSync(dir, {withFileTypes: true})) {
      if (row.isSymbolicLink()) fail("SYMLINK_FORBIDDEN");
      // Apache configuration is shipped but cannot be retrieved as a
      // browser asset. Including it would fail every complete installation.
      if (row.isFile() && row.name === ".htaccess") continue;
      if (denyDirs.has(row.name)) fail("DEVELOPMENT_DIRECTORY_IN_DIST");
      const path = join(dir, row.name);
      if (row.isDirectory()) walk(path);
      else if (row.isFile()) {
        if (badFiles.has(row.name) || row.name.startsWith(".env") ||
            row.name.endsWith(".map") || row.name.endsWith(".log")) {
          fail("DEVELOPMENT_FILE_IN_DIST:" + row.name);
        }
        files.push(path);
      } else fail("NON_FILE_ENTRY");
      if (files.length > 50000) fail("TOO_MANY_FILES");
    }
  }
  walk(root);
  return files.sort();
}
function checkPageAssets(html, page, siteOrigin) {
  // <a> links and canonical/social meta URLs are not executable resources.
  // External page dependencies must not silently disappear in offline mode.
  const tags = html.match(/<(?:script|iframe|img|source|video|audio|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (/^<link/i.test(tag) &&
        !/\brel\s*=\s*["']?(?:stylesheet|modulepreload|preload|icon)\b/i.test(tag)) continue;
    const urls = [...tag.matchAll(/\b(?:src|srcset|href|poster)\s*=\s*["']([^"']+)["']/gi)];
    for (const match of urls) {
      for (const url of match[1].split(",").map(x=>x.trim().split(/\s+/)[0])) {
        if (!/^https?:\/\//i.test(url)) continue;
        if (new URL(url).origin !== siteOrigin) fail("CROSS_ORIGIN_ASSET:" + page);
      }
    }
  }
}
function inject(html, path, assistant, appleIcon) {
  const assistantMarker = '<script type="module" src="/_iwxa/t3-assistant/assistant.js" data-iwxa-t3-assistant></script>';
  const marker = '<script type="module" src="/t3-domain-mode.mjs" data-iwxa-t3-domain-mode></script>';
  const pwaLink = '<link rel="manifest" href="/t3-app-manifest.json" data-iwxa-t3-pwa>';
  const appleLink = '<link rel="apple-touch-icon" href="' + appleIcon +
    '" data-iwxa-t3-apple-touch>';
  const iosStandalone = '<meta name="apple-mobile-web-app-capable" content="yes" data-iwxa-t3-ios>';
  if (!/<\/body>/i.test(html)) fail("HTML_BODY_REQUIRED:" + path);
  const scripts = (html.includes("data-iwxa-t3-domain-mode") ? "" : marker) +
    (assistant && !html.includes("data-iwxa-t3-assistant") ? "\n" + assistantMarker : "");
  // Replace only manifest metadata; keep the site's visible DOM and scripts.
  let result=html;
  if(!result.includes("data-iwxa-t3-pwa")) {
    result=result.replace(/<link\b[^>]*\brel=["']manifest["'][^>]*>/gi,"");
    if(/<\/head>/i.test(result))result=result.replace(/<\/head>/i,pwaLink+"\n</head>");
    else if(/<body\b/i.test(result))
      result=result.replace(/<body\b/i,"<head>"+pwaLink+"</head>\n<body");
    else fail("HTML_BODY_REQUIRED:"+path);
  }
  const iosParts = [];
  // Preserve native site branding. Only fill omitted Apple installation hints.
  if(!/<link\b[^>]*\brel=["']apple-touch-icon["'][^>]*>/i.test(result))
    iosParts.push(appleLink);
  if(!/<meta\b[^>]*\bname=["']apple-mobile-web-app-capable["'][^>]*>/i.test(result))
    iosParts.push(iosStandalone);
  if(iosParts.length)result=result.replace(/<\/head>/i,iosParts.join("\n")+"\n</head>");
  return scripts ? result.replace(/<\/body>/i, scripts + "\n</body>") : result;
}
export function materializeDomainMode(distRoot, assistantDistRoot = null) {
  if (typeof distRoot !== "string" || !distRoot.trim()) fail("DIST_REQUIRED");
  const root = realpathSync(resolve(distRoot));
  for (const required of ["index.html", "workspace/index.html",
      "_iwxa/domain.json", "_iwxa/domain-shell.json",
      "_iwxa/service-catalog.json"]) {
    if (!existsSync(join(root, required))) fail("ONE_DIST_INCOMPLETE:" + required);
  }
  const runtimeDir = join(root, "_iwxa/runtime");
  if (!existsSync(runtimeDir) ||
      !scan(runtimeDir).some(path => /[\\/]runtime\.m?js$/.test(path))) {
    fail("ORIGINAL_KERNEL_RUNTIME_MISSING");
  }
  const domain = JSON.parse(readFileSync(join(root, "_iwxa/domain.json"), "utf8"));
  const domainOrigin = domain?.domain?.origin || domain?.runtime?.origin ||
    domain?.origin || null;
  // The real deployment origin must be discoverable, not synthesized.
  if (typeof domainOrigin !== "string" || !/^https:\/\/[^/]+$/.test(domainOrigin)) {
    fail("ORIGIN_UNKNOWN");
  }
  if (assistantDistRoot) {
    const assistantRoot = realpathSync(resolve(assistantDistRoot));
    if (assistantRoot === root || root.startsWith(assistantRoot + sep) ||
        assistantRoot.startsWith(root + sep)) fail("ASSISTANT_STAGE_OVERLAP");
    const candidate = join(assistantRoot, "assistant.js");
    if (!existsSync(candidate) || !scan(assistantRoot).includes(candidate)) {
      fail("COMPILED_ASSISTANT_REQUIRED");
    }
    const target = join(root, "_iwxa/t3-assistant");
    if (existsSync(target)) fail("ASSISTANT_ALREADY_STAGED");
    mkdirSync(target, {recursive:true});
    cpSync(assistantRoot, target, {recursive:true});
  }
  const htmlPages = scan(root).filter(x => x.endsWith(".html"));
  if (!htmlPages.includes(join(root, "index.html")) ||
      !htmlPages.includes(join(root, "workspace/index.html"))) {
    fail("SITE_AND_WORKSPACE_REQUIRED");
  }
  const pwa=materializePwaManifest(root,domainOrigin);
  const appleIcon=pwa.manifest.icons.find(icon=>
    icon.type==="image/png" && icon.sizes?.split(/\s+/).includes("192x192"))?.src;
  if(!appleIcon || !/^\/[a-zA-Z0-9._/-]+$/.test(appleIcon))
    fail("PWA_APPLE_ICON_MISSING");
  const replacements = [];
  const pages = [];
  for (const page of htmlPages) {
    const before = readFileSync(page, "utf8");
    checkPageAssets(before, relative(root, page), domainOrigin);
    const path = "/" + relative(root, page).split(sep).join("/");
    const route = path.endsWith("/index.html") ? path.slice(0,-"index.html".length) : path;
    const title = (before.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] || route).trim();
    pages.push({path:route,title:title.slice(0,150)});
    replacements.push([page, inject(before, relative(root,page), !!assistantDistRoot,
      appleIcon)]);
  }
  for (const [path, content] of replacements) writeFileSync(path, content);
  copyFileSync(join(scriptRoot, "t3-domain-mode.mjs"), join(root, "t3-domain-mode.mjs"));
  copyFileSync(join(scriptRoot, "t3-sw.js"), join(root, "t3-sw.js"));
  const files = [];
  const aliases = [];
  for (const file of scan(root)) {
    const path = "/" + relative(root, file).split(sep).join("/");
    if (path.startsWith("/_iwxa/diagnostics/")) fail("DIAGNOSTICS_IN_PRODUCT_DIST");
    if (path === "/t3-offline-manifest.json") continue;
    const bytes = readFileSync(file);
    const entry = {path,sha256:sha(bytes),bytes:bytes.length};
    files.push(entry);
    if (path.endsWith("/index.html")) {
      const alias = path.slice(0, -"index.html".length);
      aliases.push({...entry,path:alias,source:path});
    }
  }
  files.sort((a,b) => a.path.localeCompare(b.path, "en"));
  aliases.sort((a,b) => a.path.localeCompare(b.path, "en"));
  const all = [...files,...aliases];
  if (new Set(all.map(x=>x.path)).size !== all.length ||
      !all.some(x=>x.path === "/") || !all.some(x=>x.path === "/workspace/")) {
    fail("ALIAS_COLLISION");
  }
  const total = all.reduce((sum,x)=>sum+x.bytes,0);
  if (!Number.isSafeInteger(total) || total <= 0) fail("SIZE_INVALID");
  const version = sha(Buffer.from(all.map(x =>
    [x.path,x.source||"",x.sha256,x.bytes].join("\0")).join("\n")));
  const manifest = {schema:SCHEMA,version,complete_static_tree:true,
    domain_origin:domainOrigin,files:all,total_bytes:total,
    pages:pages.sort((a,b)=>a.path.localeCompare(b.path,"en"))};
  writeFileSync(join(root,"t3-offline-manifest.json"),JSON.stringify(manifest));
  return {domain_origin:domainOrigin,version,files:all.length,
    total_bytes:total,site_pages:htmlPages.length,
    assistant_installed_in_single_dist:!!assistantDistRoot,
    original_kernel_unchanged:true,local_model_installation_separate:true};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 && process.argv.length !== 5) fail("USAGE_FINAL_DIST");
  if (process.argv.length === 5 && process.argv[3] !== "--assistant-dist") fail("USAGE_ASSISTANT_DIST");
  console.log(JSON.stringify(materializeDomainMode(process.argv[2],process.argv[4] || null)));
}
