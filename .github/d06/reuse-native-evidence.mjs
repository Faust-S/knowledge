// Preserve the actual successful native witness, not its overall failed delivery job.
// This confirms no production-origin build or permanent retention.
import {readFileSync} from "node:fs";
function verifyNative(run,job,log){
  const require=(ok,code)=>{if(!ok)throw Error("D06_NATIVE_REUSE_"+code)};
  require(run.id===45683033434&&run.head_sha==="8fa5dd49f10b97dc910d0fb9b15373a304eb3fec"&&run.run_attempt===1&&run.event==="push"&&run.path===".github/workflows/d06-t3-release-gate.yml"&&run.status==="completed"&&run.conclusion==="failure","RUN");
  require(job.id===139448261827&&job.run_id===run.id&&job.name==="final-release-closure"&&job.status==="completed"&&job.conclusion==="failure"&&(job.head_sha===undefined||job.head_sha===run.head_sha)&&(job.run_attempt===undefined||job.run_attempt===1),"JOB");
  const step=(name,status)=>job.steps.filter(s=>s.name===name&&s.status==="completed"&&s.conclusion===status).length===1;
  for(const name of [
    "Validate one-shot trigger before any private checkout",
    "Validate explicit release request",
    "Reuse exact successful hardware model witness",
    "Verify immutable candidate revisions",
    "Reuse exact completed product evidence",
    "Check exact original assistant files and owner pack",
    "Install site dependencies once",
    "Install fixed Chromium only in the qualification environment",
    "Verify original public portable input",
    "Prepare compiled loopback Host",
    "Build exact HTTPS loopback candidate",
    "Real original T3 offline install, native save, cold restart and readback",
    "Independent recipient and physical .iwxa transfer with network disabled",
    "Run full D06 native Exchange and lifecycle witness at exact T3 origin",
  ]) require(step(name,"success"),"STEP");
  require(step("Reconcile static source integrity with prior 85 of 85 evidence","failure")&&step("Prepare compiled production Host","skipped"),"BOUNDARY");
  const lines=log.split(/\r?\n/).flatMap(raw=>{const match=raw.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z (.*)$/);return match&&!match[1].includes("\x1b")&&match[1].trim()?[match[1].trim()]:[]});
  const count=s=>lines.filter(x=>x===s).length;
  let prev=-1;
  for(const marker of [
    "D06_ONE_SHOT_REQUEST=PASS","D06_RELEASE_REQUEST=PASS","D06_FINAL_EXACT_PRIOR_HARDWARE_MODEL=PASS","D06_RELEASE_EXACT_PINS=PASS","D06_PRIOR_EXACT_STATIC_PRODUCT_EVIDENCE=PASS",
    "D06_PRIOR_E2E_COUNTS=85:0:0:0","D06_T3_ORIGINAL_INPUTS=PASS","D06_RELEASE_NPM_CI=PASS","D06_FINAL_BROWSER_VERSION=156.0.8078.4",
    "D06_STATIC_RECONCILE_COUNTS=START:0:0:0","D06_STATIC_RECONCILE_COMMAND=check:PASS","D06_STATIC_RECONCILE_COUNTS=check:0:0:0","D06_STATIC_RECONCILE_COMMAND=test:PASS","D06_STATIC_RECONCILE_COUNTS=test:0:0:0","D06_STATIC_RECONCILE_COMMAND=build_static:PASS","D06_STATIC_RECONCILE_COUNTS=build_static:1:0:0","D06_STATIC_TRACKED_ORDINAL=build_static:492","D06_STATIC_RECONCILE_SOURCE=FAIL",
    "D06_T3_ORIGINAL_PLATFORM_128_FILES=PASS","D06_LOOPBACK_PRISTINE_SOURCE=PASS","D06_T3_HOST_SOURCE_BUILD=PASS","D06_T3_HOST_READBACK=PASS","D06_T3_HOST_FILES=98","D06_T3_SHARED_WORKER_COUNT=1","D06_T3_OFFLINE_BUILD=PASS",
    "D06_T3_OFFLINE_EXCHANGE_INDEPENDENT_INSTALL=PASS","D06_T3_OFFLINE_EXCHANGE_FILE_SAVED=PASS","D06_T3_OFFLINE_EXCHANGE_FILE_CONSENT=PASS","D06_T3_OFFLINE_EXCHANGE_EXPORT=PASS","D06_T3_OFFLINE_EXCHANGE_IMPORT=PASS","D06_T3_OFFLINE_EXCHANGE_RECIPIENT_COLD_READBACK=PASS","D06_T3_OFFLINE_EXCHANGE_EXACT_KERNEL_EVIDENCE=PASS","D06_T3_OFFLINE_INDEPENDENT_EXCHANGE=PASS",
    "D06_NATIVE_STAGE=ITEM_HISTORY_RECIPIENT_COLD_READBACK","D06_NATIVE_STAGE=PD12_PORTABLE_CHILD_VERIFIED","D06_T3_PHYSICAL_DOWNLOAD=ITEM_HISTORY:PASS","D06_T3_PHYSICAL_DOWNLOAD=BACKUP:PASS","D06_T3_PHYSICAL_DOWNLOAD=PD12_PORTABLE:PASS","D06_T3_INHERITED_NATIVE_EXCHANGE=PASS","D06_FINAL_NATIVE_EXCHANGE=success"
  ]){
    const at=lines.indexOf(marker);
    require(count(marker)===1&&at>prev,"MARKERS");prev=at;
  }
  for(const marker of ["D06_T3_OFFLINE_PUBLIC_CONTROL=PASS","D06_T3_OFFLINE_NATIVE_PD01_SAVE=PASS","D06_T3_OFFLINE_COLD_NATIVE_READBACK=PASS","D06_T3_OFFLINE_INDEPENDENT_KERNEL_READBACK=PASS","D06_T3_NATIVE_OFFLINE_NO_MODEL=PASS"])require(count(marker)===2,"OFFLINE_WITNESS");
  require(!lines.some(x=>/^D06_T3_(?:HOST_SOURCE_BUILD|OFFLINE_BUILD|NATIVE_OFFLINE_NO_MODEL|OFFLINE_INDEPENDENT_EXCHANGE|INHERITED_NATIVE_EXCHANGE)=FAIL$|^D06_T3_PHYSICAL_DOWNLOAD=.*:FAIL$/.test(x)),"NATIVE_FAILURE");
  return true;
}
try {
  const a=process.argv.slice(2);
  if(a.length!==3)throw Error("D06_NATIVE_REUSE_USAGE");
  verifyNative(JSON.parse(readFileSync(a[0],"utf8")),JSON.parse(readFileSync(a[1],"utf8")),readFileSync(a[2],"utf8"));
  console.log("D06_PRIOR_EXACT_CHECK_TEST=PASS");
  console.log("D06_PRIOR_EXACT_NATIVE_OFFLINE=PASS");
  console.log("D06_PRIOR_EXACT_NATIVE_EXCHANGE=PASS");
} catch(error) {
  const code=String(error?.message??"");
  console.error(/^D06_NATIVE_REUSE_[A-Z_]+$/.test(code)?code:"D06_NATIVE_REUSE_EVIDENCE_INVALID");
  process.exitCode=1;
}
