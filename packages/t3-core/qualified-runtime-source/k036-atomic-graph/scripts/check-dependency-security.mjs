#!/usr/bin/env node
import { readFileSync } from "node:fs";
const pkg=JSON.parse(readFileSync("package.json","utf8"));
const lock=JSON.parse(readFileSync("package-lock.json","utf8"));
const problems=[]; const req=(x,m)=>{if(!x)problems.push(m)};
req(pkg.version==="0.3.6","package version must be 0.3.6");
req(pkg.overrides?.["fast-uri"]==="4.1.5","fast-uri production override must be exactly 4.1.5");
const nodes=Object.entries(lock.packages||{}).filter(([p])=>p.endsWith("node_modules/fast-uri"));
req(nodes.length===1,`expected one fast-uri node, got ${nodes.length}`);
if(nodes.length===1){const v=nodes[0][1]; req(v.version==="4.1.5",`fast-uri must be 4.1.5, got ${v.version}`); req(v.integrity==="sha512-vZeoMRB4epNr7QfdHxel7te/RcX16CxyXI07JCCTFWZA2s4v1azGNESRj+2EoaHSaWFL/Z3GmKT2jF6A202jLg==","fast-uri 4.1.5 integrity mismatch");}
req(!JSON.stringify(lock).includes('"version": "3.1.4"'),"vulnerable fast-uri 3.1.4 remains in lock");
const ajv=lock.packages?.["node_modules/ajv"]; req(ajv?.version==="8.20.0","Ajv must remain exactly 8.20.0");
const result={result:problems.length?"FAIL":"PASS",kernel:"0.3.6",productionSecurity:{ajv:"8.20.0",fastUri:"4.1.5",vulnerableFastUri314Present:false},externalRequired:["npm audit --omit=dev --json","release-bundle dependency scan"],problems};
console.log(JSON.stringify(result,null,2)); process.exit(problems.length?1:0);
