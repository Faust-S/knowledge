/** Independent D07 T2 plan parity check.
 * Execute inside temporary private site checkout with node --import tsx.
 * Only status/counts reach public GitHub logs; no private operation text.
 */
import {readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
const site=resolve(process.argv[2]??"site");
const generated=resolve(process.argv[3]??"");
const {SUBJECT_PROTOCOLS}=await import(pathToFileURL(join(site,"src/domain/service-subject-protocols.ts")).href);
const {getServiceDirectory}=await import(pathToFileURL(join(site,"src/data/serviceDirectory.ts")).href);
const directory=getServiceDirectory();
const byKey=new Map(directory.map(x=>[x.categorySlug+"/"+x.slug,x]));
const catalog=JSON.parse(readFileSync(generated,"utf8"));
if(!catalog.generated||catalog.version!==1||!Array.isArray(catalog.services))
  throw Error("D07_T2_PLAN_CATALOG_NOT_GENERATED");
const suggestionsByKey=new Map();
for(const row of catalog.services){
 const key=row.categorySlug+"/"+row.serviceSlug;
 if(suggestionsByKey.has(key))throw Error("D07_T2_PLAN_DUPLICATE");
 suggestionsByKey.set(key,row);
}
if(SUBJECT_PROTOCOLS.length<92)throw Error("D07_T2_SUBJECT_PROTOCOL_REGRESSION");
let verified=0,operations=0;
for(const p of SUBJECT_PROTOCOLS){
 const key=p.categorySlug+"/"+p.serviceSlug;
 const source=byKey.get(key),row=suggestionsByKey.get(key);
 if(!source||!row||row.serviceId!==source.id||
    row.categorySlug!==p.categorySlug||row.serviceSlug!==p.serviceSlug)
    throw Error("D07_T2_PLAN_SERVICE_ID_MISMATCH");
 if(row.works.length!==p.operations.length)
    throw Error("D07_T2_PLAN_OPERATION_COUNT_MISMATCH");
 for(let i=0;i<p.operations.length;i++){
   const from=p.operations[i],to=row.works[i];
   if(!to||to.operationId!==from.id||to.title!==from.title||
      to.billing!==from.billing||to.source!=="d07-subject-protocol"||
      !to.scope.includes(from.action)||!to.scope.includes(from.precondition)||
      !to.scope.includes(from.outcome)||!to.acceptanceCriteria?.includes(from.verification)||
      !to.acceptanceCriteria?.includes(from.evidence))
      throw Error("D07_T2_PLAN_OPERATION_CONTENT_MISMATCH");
   operations++;
 }
 verified++;
}
if(verified!==SUBJECT_PROTOCOLS.length)throw Error("D07_T2_PLAN_PARITY_INCOMPLETE");
console.log("D07_T2_SUBJECT_PLANS_EXACT_PARITY=PASS");
console.log("D07_T2_SUBJECT_PLAN_COUNT="+verified);
console.log("D07_T2_SUBJECT_OPERATION_COUNT="+operations);
