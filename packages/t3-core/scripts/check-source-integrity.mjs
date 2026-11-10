#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
const ROOT=process.cwd();
const pkg=JSON.parse(readFileSync(join(ROOT,"package.json"),"utf8"));
const manifestName=`SOURCE_SHA256SUMS_${pkg.version}.txt`;
const manifestPath=join(ROOT,manifestName);
if(!existsSync(manifestPath)){console.error(`[workspace-source-integrity] missing ${manifestName}`);process.exit(2);}
const hash=(b)=>createHash("sha256").update(b).digest("hex");
const expected=new Map();
for(const line of readFileSync(manifestPath,"utf8").split(/\r?\n/)){
 if(!line.trim()) continue; const m=line.match(/^([0-9a-f]{64})\s{2}\.\/(.+)$/);
 if(!m){console.error(`[workspace-source-integrity] malformed: ${line}`);process.exit(2);} expected.set(m[2].replaceAll("\\","/"),m[1]);
}
let bad=0;
for(const [rel,want] of expected){const p=join(ROOT,...rel.split("/"));if(!existsSync(p)){console.error(`[workspace-source-integrity] MISSING ${rel}`);bad++;continue;}const got=hash(readFileSync(p));if(got!==want){console.error(`[workspace-source-integrity] HASH ${rel}`);bad++;}}
const excluded=new Set(["node_modules","dist","release","release-health","artifacts","coverage",".tmp"]);
const allowed=new Set([manifestName]); const actual=[];
function walk(dir){for(const name of readdirSync(dir).sort()){const p=join(dir,name), rel=relative(ROOT,p).split(sep).join("/"); if(excluded.has(rel.split("/")[0]))continue; const st=statSync(p); if(st.isDirectory())walk(p); else actual.push(rel);}}
walk(ROOT); const es=new Set(expected.keys());
for(const rel of actual){if(es.has(rel)||allowed.has(rel))continue;console.error(`[workspace-source-integrity] UNEXPECTED ${rel}`);bad++;}
if(bad){console.error(`[workspace-source-integrity] FAIL mismatches=${bad}`);process.exit(1);}console.log(`[workspace-source-integrity] PASS tracked=${expected.size} full-file-set=${actual.length}`);
