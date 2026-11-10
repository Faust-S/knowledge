#!/usr/bin/env node
// One-way source adoption: qualified T2 becomes the T3 source baseline.
// Run in a disposable checkout with an authorized local T2 checkout.
// Never writes into the T2 repository and never fetches a remote implicitly.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PIN_HEAD = "9c64951cd78411283e8a416641c36d71e169fc1d";
const PIN_TREE = "56e55a9458aeb3ce540ef87dbc2dd9549ae2fcb2";
const UPSTREAM_ROOT = "t2/current/final-successor/canonical-source/";
const CODE_FOLDERS = ["src/", "tests/", "scripts/", "fixtures/", "public/"];
const ROOT_FILES = new Set([
  ".gitignore", "package.json", "package-lock.json", "tsconfig.json",
  "eslint.config.mjs", "vite.config.ts", "vitest.config.ts",
  "index.html", "exchange.html", "lifecycle.html", "studio.html",
]);

function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function git(repo, ...args) {
  return execFileSync("git", ["-C",repo,...args], {encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
}
function safeInside(root, path) {
  const r=relative(root,path);
  return r.length>0 && r!==".." && !r.startsWith(".."+sep) && !isAbsolute(r);
}
function selectable(path) {
  if (path.endsWith(".md") || path.startsWith("docs/")) return false;
  if (ROOT_FILES.has(path)) return true;
  return CODE_FOLDERS.some(folder=>path.startsWith(folder));
}
const args = process.argv.slice(2);
if (args.length!==2) {
  process.stderr.write("Usage: node tools/import-qualified-t2.mjs /temporary/T2 /knowledge/checkout\n");
  process.exit(2);
}
const source=resolve(args[0]), targetRepo=resolve(args[1]);
assert.equal(git(source,"rev-parse","HEAD"),PIN_HEAD,"T2_WRONG_HEAD");
assert.equal(git(source,"rev-parse","HEAD^{tree}"),PIN_TREE,"T2_WRONG_TREE");
assert.equal(git(source,"status","--porcelain"),"","T2_SOURCE_MUST_BE_CLEAN");
const targetRoot=join(targetRepo,"packages","t3-core");
assert.ok(safeInside(targetRepo,targetRoot),"TARGET_OUTSIDE_KNOWLEDGE");
assert.equal(git(targetRepo,"rev-parse","--show-toplevel"),targetRepo,"TARGET_NOT_REPOSITORY_ROOT");
assert.notEqual(source,targetRepo,"T2_AND_T3_MUST_BE_DISTINCT");
const paths=execFileSync("git",["-C",source,"ls-tree","-r","-z","--name-only","HEAD",UPSTREAM_ROOT],{encoding:"buffer"})
  .toString("utf8").split("\0").filter(Boolean);
let adopted=0, identical=0, omitted=0, unsafe=0;
const conflicts=[],manifest=[];
for (const path of paths) {
  const relativePath=path.slice(UPSTREAM_ROOT.length);
  if (!selectable(relativePath)) {omitted++;continue;}
  const from=join(source,path),to=join(targetRoot,relativePath);
  if (!safeInside(source,from)||!safeInside(targetRoot,to)) throw new Error("INVALID_SOURCE_PATH");
  const st=lstatSync(from);
  if (st.isSymbolicLink()||!st.isFile()) {unsafe++;continue;}
  let bytes=readFileSync(from);
  // The adopted code is T3, not a separately running T2 package.
  // Keep package.json and npm lockfile root identities synchronized.
  if (relativePath==="package.json" || relativePath==="package-lock.json") {
    const payload=JSON.parse(bytes.toString("utf8"));
    payload.name="@iwxa/t3-core";
    payload.version="0.3.0-dev.0";
    if (relativePath==="package-lock.json") {
      payload.packages[""].name=payload.name;
      payload.packages[""].version=payload.version;
    }
    bytes=Buffer.from(JSON.stringify(payload,null,2)+"\\n");
  }
  const digest=sha(bytes);
  if (/(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{15}|ghp_[A-Za-z0-9]{20})/.test(bytes.toString("utf8"))) {
    unsafe++;continue;
  }
  if (existsSync(to)) {
    if (!lstatSync(to).isFile()||sha(readFileSync(to))!==digest) {
      conflicts.push(relativePath);continue;
    }
    identical++;
  } else {
    mkdirSync(dirname(to),{recursive:true});
    writeFileSync(to,bytes,{flag:"wx"});
    adopted++;
  }
  manifest.push({path:relativePath,sha256:digest});
}
if (conflicts.length || unsafe) {
  process.stderr.write(JSON.stringify({status:"INCOMPLETE",adopted,identical,omitted,unsafe,conflicts},null,2)+"\n");
  process.exitCode=1;
} else {
  const report={
    schema:"IWXA_T3_T2_SOURCE_ADOPTION_V1",t2Head:PIN_HEAD,t2Tree:PIN_TREE,
    root:UPSTREAM_ROOT,adopted,identical,omitted,unsafe,
    files:manifest.length,sourceDigest:sha(Buffer.from(JSON.stringify(manifest))),
    policy:"CODE_AND_TESTS_ONLY_NO_PRIVATE_DOCUMENTATION",sourceUnchanged:true,
  };
  const output=resolve(targetRepo,"packages/t3-core/UPSTREAM_SOURCE_PIN.json");
  writeFileSync(output,JSON.stringify(report,null,2)+"\n");
  process.stdout.write(JSON.stringify(report)+"\n");
}
