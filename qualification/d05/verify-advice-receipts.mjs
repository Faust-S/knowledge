// Independent verification of bounded D05 model receipts. No product
// code, raw model output, source facts or credentials are read or emitted.
const initial=Object.freeze({
 "cost:false":"verify_cost_completeness",
 "price:false":"verify_margin",
 "cost:true":"verify_consumption",
 "missing-cost:true":"request_material_price",
});
const extended=Object.freeze({
 "materials-shortage":"verify_shortage",
 "materials-unrelated":"abstain",
 "route-capacity":"verify_capacity",
});
const prefixes=Object.freeze({
 model:"D05_T3_REAL_MODEL_PASS ",
 initial:"D05_T3_MODEL_ADVICE_EVIDENCE ",
 extended:"D05_T3_MODEL_CROSS_SERVICE_EVIDENCE ",
 release:"D05_T3_MODEL_CACHE_RELEASE ",
 cancel:"D05_T3_MODEL_CANCEL_PASS ",
});
export function parseAdviceReceipts(log){
 if(typeof log!=="string")throw Error("D05_ADVICE_LOG_REQUIRED");
 const out=Object.fromEntries(Object.keys(prefixes).map(k=>[k,[]]));
 for(const line of log.split(/\r?\n/)){
  for(const [kind,prefix] of Object.entries(prefixes)){
   if(!line.startsWith(prefix))continue;
   let value;
   try{value=JSON.parse(line.slice(prefix.length));}
   catch{throw Error("D05_ADVICE_RECEIPT_JSON");}
   if(!value||typeof value!=="object"||Array.isArray(value))throw Error("D05_ADVICE_RECEIPT_OBJECT");
   out[kind].push(value);
  }
 }
 return out;
}
export function verifyAdviceReceipts(receipts,{profile="light",crossService=true,requireIdentity=true}={}){
 const failures=[],observations=[];
 const problem=(scope,code)=>failures.push(Object.freeze({scope,code}));
 const group=k=>{
  if(!Array.isArray(receipts?.[k])){problem(k,"RECEIPTS_MISSING");return [];}
  return receipts[k];
 };
 const model=group("model");
 if(model.length!==1)problem("model","RECEIPT_COUNT");
 const m=model[0];
 if(!m||m.profile!==profile||m.adapter!=="nonfallback-reported"||
    m.groundedAdvice!==true||m.actualInference!==true||m.serverStopped!==true||
    m.browserRestarted!==true||m.semanticAcceptance!==false||m.productAccepted!==false)
  problem("model","EXECUTION_OR_IDENTITY");
 if(crossService&&m?.crossServiceScenarios!==3)problem("model","CROSS_SERVICE_COUNT");
 for(const k of ["online","onlinePrice","offline","missingCost"]){
  const r=m?.[k];
  if(r?.ok!==true||r.busyObserved!==true||!Number.isSafeInteger(r.workerCount)||r.workerCount<1||
     !Number.isSafeInteger(r.milliseconds)||r.milliseconds<0)
   problem(k,"GENERATION_NOT_CONFIRMED");
 }
 const cancellation=group("cancel");
 if(cancellation.length!==1||cancellation[0]?.cancelled!==true||
    cancellation[0].workers!==0||cancellation[0].externalRequests!==0||cancellation[0].ready!==false)
  problem("cancel","INSTALLATION_CONSENT");
 const releases=group("release");
 for(const offline of [false,true]){
  const rows=releases.filter(r=>r?.offline===offline);
  if(rows.length!==1||rows[0].ok!==true||rows[0].cacheReady!==true||rows[0].workerExit!==true)
   problem(offline?"offline-release":"online-release","WORKER_RELEASE");
 }
 if(releases.length!==2)problem("release","RECEIPT_COUNT");
 const engineeringPassed=failures.length===0;
 function verifyGroup(kind,expected,keyOf){
  const seen=new Set();
  const rows=group(kind);
  if(rows.length!==Object.keys(expected).length)problem(kind,"OBSERVATION_COUNT");
  for(const row of rows){
   const key=keyOf(row);
   if(!Object.hasOwn(expected,key)||seen.has(key)){problem(kind,"UNEXPECTED_OR_DUPLICATE_SCENARIO");continue;}
   seen.add(key);
   const id=expected[key],abstain=id==="abstain",isExtended=kind==="extended";
   const exact=row?.exactSource===true;
   const choice=row?.expectedChoice===true&&row.abstained===abstain&&row.validChoice===!abstain&&
    (!requireIdentity&&!isExtended||(row.expectedId===id&&row.selectedId===(abstain?null:id)));
   if(!exact)problem(key,"SOURCE_CHANGED");
   if(!choice)problem(key,"CHOICE_MISMATCH");
   if(row?.busyObserved!==true||row.semanticAcceptance!==false)problem(key,"OBSERVATION_INCOMPLETE");
   if(isExtended){
    for(const flag of ["sameWorker","sourceUnchanged","controlsUnchanged","workspaceUnchanged","offline"])
     if(row?.[flag]!==true)problem(key,"CONTINUITY_"+flag.toUpperCase());
    if(row.expectAbstention!==abstain||!Number.isSafeInteger(row.milliseconds)||row.milliseconds<0)
     problem(key,"CROSS_SERVICE_OBSERVATION");
   }else if(!Number.isSafeInteger(row.workerCount)||row.workerCount<1)problem(key,"WORKER_NOT_OBSERVED");
   observations.push(Object.freeze({scenario:key,exactSource:exact,correctChoice:choice}));
  }
  for(const key of Object.keys(expected))if(!seen.has(key))problem(key,"OBSERVATION_MISSING");
 }
 verifyGroup("initial",initial,r=>typeof r?.offline==="boolean"?String(r.scenario)+":"+r.offline:"");
 if(crossService)verifyGroup("extended",extended,r=>String(r?.scenario??""));
 else if(group("extended").length)problem("extended","UNREQUESTED_OBSERVATIONS");
 const expectedCount=Object.keys(initial).length+(crossService?Object.keys(extended).length:0);
 return Object.freeze({
  engineeringPassed,
  exactSource:{passed:observations.filter(r=>r.exactSource).length,total:expectedCount},
  correctChoice:{passed:observations.filter(r=>r.correctChoice).length,total:expectedCount},
  observations:Object.freeze(observations),failures:Object.freeze(failures),
  qualificationPassed:failures.length===0,
  semanticAcceptance:false,productAccepted:false,
 });
}
