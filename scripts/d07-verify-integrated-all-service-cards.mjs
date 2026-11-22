/** D07 disposable-runner qualification: verify every individual professional
 * service is present in the actual one-dist ORIGINAL T2 deployment, not only
 * the standalone site. No private HTML, source or service IDs are printed.
 */
import {existsSync,readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";

const site=resolve(process.argv[2]??"site");
const {SUBJECT_PROTOCOLS}=await import(pathToFileURL(join(site,"src/domain/service-subject-protocols.ts")).href);
const {getServiceDirectory}=await import(pathToFileURL(join(site,"src/data/serviceDirectory.ts")).href);
const directory=getServiceDirectory();
const items=new Map(directory.map(x=>[x.categorySlug+"/"+x.slug,x]));
const root=join(site,"dist");
for(const name of ["workspace/index.html","_iwxa/runtime/0.3.6/runtime.js"]){
 if(!existsSync(join(root,name)))throw Error("D07_INTEGRATED_ORIGINAL_T2_MISSING");
}
if(SUBJECT_PROTOCOLS.length<92)throw Error("D07_INTEGRATED_PROFESSIONAL_COVERAGE_REGRESSION");
const seen=new Set();
let count=0,operations=0;
for(const p of SUBJECT_PROTOCOLS){
 const key=p.categorySlug+"/"+p.serviceSlug;
 if(seen.has(key))throw Error("D07_INTEGRATED_CARD_DUPLICATE");
 seen.add(key);
 const item=items.get(key);
 if(!item||!item.id||!p.operations?.length)throw Error("D07_INTEGRATED_CARD_SUBJECT_MISMATCH");
 const file=join(root,"uslugi",p.categorySlug,p.serviceSlug,"index.html");
 if(!existsSync(file))throw Error("D07_INTEGRATED_CARD_HTML_MISSING");
 const html=readFileSync(file,"utf8").replaceAll("&amp;","&");
 if(!html.includes('d07-professional-service-card')||
   !html.includes('d07-professional-start-order')||
   !html.includes('/workspace/?new=1')||
   !html.includes('serviceId='+encodeURIComponent(item.id)))
    throw Error("D07_INTEGRATED_CARD_EXACT_T2_CTA_MISSING");
 for(const op of p.operations){
  if(!html.includes('data-operation-id="'+op.id+'"'))
    throw Error("D07_INTEGRATED_CARD_OPERATION_MISSING");
  operations++;
 }
 count++;
}
if(count!==SUBJECT_PROTOCOLS.length||operations<count*5)
  throw Error("D07_INTEGRATED_CARD_OPERATION_COVERAGE_TOO_LOW");
console.log("D07_INTEGRATED_ALL_SUBJECT_CARD_HTML=PASS");
console.log("D07_INTEGRATED_FULL_CARD_COUNT="+count);
console.log("D07_INTEGRATED_DISPLAYED_OPERATIONS="+operations);
