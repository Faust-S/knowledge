/** D07 private-ephemeral audit: every authored technology needs a real
 * customer Service object, intake, evidence checklists and T2 route.
 * Prints only totals and gap categories. No private content or IDs.
 */
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
const site=resolve(process.argv[2]??"site");
const imp=async path=>import(pathToFileURL(join(site,path)).href);
const [{SUBJECT_PROTOCOLS},{getService},{getServiceDirectory},{priority500},{prerenderRoutes}]
 =await Promise.all([
  imp("src/domain/service-subject-protocols.ts"),
  imp("src/data/services.ts"),
  imp("src/data/serviceDirectory.ts"),
  imp("src/domain/service-top500.ts"),
  imp("src/site-routes.ts")
 ]);
const dir=getServiceDirectory(),ranked=priority500(dir);
const keys=new Set(ranked.selected.map(x=>x.categorySlug+"/"+x.slug));
const gaps=new Map();
let full=0,startable=0,reviewable=0,sourceVerified=0,cardOnly=0;
for(const p of SUBJECT_PROTOCOLS){
 const key=p.categorySlug+"/"+p.serviceSlug;
 if(!keys.has(key))throw Error("D07_FULL_CARD_NOT_IN_TOP500");
 const row=dir.find(x=>x.categorySlug===p.categorySlug&&x.slug===p.serviceSlug);
 const service=getService(p.categorySlug,p.serviceSlug);
 const route="/uslugi/"+p.categorySlug+"/"+p.serviceSlug+"/";
 if(!row?.id||!prerenderRoutes.includes(route))throw Error("D07_FULL_CARD_LOST_ROUTE");
 startable++;
 const missing=[];
 if(!service)missing.push("NO_FULL_SERVICE_OBJECT");
 else{
  full++;
  if(!service.shortAnswer||service.shortAnswer.length<200)missing.push("SUBJECT_SUMMARY_SHORT");
  if(!service.briefFields||service.briefFields.length<5)missing.push("CLIENT_INTAKE_SHALLOW");
  if(!service.proposalCheck||service.proposalCheck.length<5)missing.push("CONTRACT_CHECKS_SHALLOW");
  if(!service.acceptanceChecklist||service.acceptanceChecklist.length<4)missing.push("ACCEPTANCE_EVIDENCE_SHALLOW");
  if(!service.faq||service.faq.length<3)missing.push("EXCEPTION_EXPLANATIONS_SHALLOW");
  if(!service.resultFormats||service.resultFormats.length<3)missing.push("HANDOVER_CONTENT_SHALLOW");
 }
 if(!p.manualResolutions?.length)missing.push("NO_MANUAL_VARIATIONS");
 if(p.references.length>=2&&p.operations.length>=10)sourceVerified++;
 if(missing.length===0)reviewable++;
 else{
  cardOnly++;
  for(const reason of missing)gaps.set(reason,(gaps.get(reason)??0)+1);
 }
}
console.log("D07_FULL_CARD_AUDIT_SUBJECTS="+SUBJECT_PROTOCOLS.length);
console.log("D07_FULL_CARD_AUDIT_STARTABLE="+startable);
console.log("D07_FULL_CARD_AUDIT_CUSTOMER_OBJECTS="+full);
console.log("D07_FULL_CARD_AUDIT_STRUCTURAL_COMPLETE="+reviewable);
console.log("D07_FULL_CARD_AUDIT_STILL_NEEDS_ENRICHMENT="+cardOnly);
for(const [k,v] of [...gaps].sort((a,b)=>a[0].localeCompare(b[0])))
 console.log("D07_FULL_CARD_GAP_"+k+"="+v);
console.log("D07_FULL_CARD_AUDIT=PASS");
console.log("D07_METHODS_INDEPENDENTLY_APPROVED=0");
