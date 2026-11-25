import test from "node:test";
import assert from "node:assert/strict";
import {parseAdviceReceipts,verifyAdviceReceipts} from "./verify-advice-receipts.mjs";
const attempt={ok:true,busyObserved:true,workerCount:1,milliseconds:42};
const scenario=(scenario,offline,id)=>({scenario,offline,expectedId:id,selectedId:id==="abstain"?null:id,
 exactSource:true,validChoice:id!=="abstain",expectedChoice:true,abstained:id==="abstain",
 semanticAcceptance:false,busyObserved:true,workerCount:1});
function fixture(){
 return {
  model:[{profile:"light",adapter:"nonfallback-reported",groundedAdvice:true,actualInference:true,
   serverStopped:true,browserRestarted:true,semanticAcceptance:false,productAccepted:false,crossServiceScenarios:3,
   online:{...attempt},onlinePrice:{...attempt},offline:{...attempt},missingCost:{...attempt}}],
  initial:[scenario("cost",false,"verify_cost_completeness"),scenario("price",false,"verify_margin"),
   scenario("cost",true,"verify_consumption"),scenario("missing-cost",true,"request_material_price")],
  extended:[["materials-shortage","verify_shortage"],["materials-unrelated","abstain"],["route-capacity","verify_capacity"]]
   .map(([name,id])=>({...scenario(name,true,id),expectAbstention:id==="abstain",sameWorker:true,
    sourceUnchanged:true,controlsUnchanged:true,workspaceUnchanged:true,milliseconds:42})),
  release:[{offline:false,ok:true,cacheReady:true,workerExit:true},{offline:true,ok:true,cacheReady:true,workerExit:true}],
  cancel:[{cancelled:true,workers:0,externalRequests:0,ready:false}],
 };
}
test("seven independently identified observations pass without declaring semantic or product acceptance",()=>{
 const r=verifyAdviceReceipts(fixture());
 assert.equal(r.qualificationPassed,true);
 assert.equal(r.engineeringPassed,true);
 assert.deepEqual(r.exactSource,{passed:7,total:7});
 assert.deepEqual(r.correctChoice,{passed:7,total:7});
 assert.equal(r.semanticAcceptance,false);
 assert.equal(r.productAccepted,false);
});
test("wrong selection remains an engineering success but fails recommendation qualification",()=>{
 const f=fixture();f.initial[0].selectedId="verify_consumption";f.initial[0].expectedChoice=false;
 const r=verifyAdviceReceipts(f);
 assert.equal(r.engineeringPassed,true);assert.equal(r.qualificationPassed,false);
 assert.deepEqual(r.exactSource,{passed:7,total:7});assert.deepEqual(r.correctChoice,{passed:6,total:7});
 assert.ok(r.failures.some(x=>x.code==="CHOICE_MISMATCH"&&x.scope==="cost:false"));
});
test("a claimed correct choice does not override an incorrect or absent identity",()=>{
 for(const mutate of [f=>f.initial[0].selectedId="verify_consumption",f=>f.initial[0].expectedId="verify_consumption",
  f=>delete f.initial[0].selectedId,f=>f.extended[1].selectedId="verify_shortage",
  f=>f.extended[2].expectedId="verify_dependencies"]){
  const f=fixture();mutate(f);assert.equal(verifyAdviceReceipts(f).qualificationPassed,false);
 }
});
test("unrelated question must abstain, while relevant questions may not",()=>{
 for(const mutate of [f=>f.extended[1].abstained=false,f=>f.extended[1].validChoice=true,
  f=>f.extended[0].abstained=true,f=>f.initial[1].abstained=true,f=>f.extended[1].expectAbstention=false]){
  const f=fixture();mutate(f);assert.equal(verifyAdviceReceipts(f).qualificationPassed,false);
 }
});
test("changed native source, controls, workspace, worker or network state rejects continuity",()=>{
 for(const flag of ["exactSource","sameWorker","sourceUnchanged","controlsUnchanged","workspaceUnchanged","offline"]){
  const f=fixture();f.extended[2][flag]=false;assert.equal(verifyAdviceReceipts(f).qualificationPassed,false);
 }
});
test("model execution, genuine cancellation and both resource releases remain required",()=>{
 for(const mutate of [f=>f.model[0].adapter="fallback",f=>f.model[0].profile="balanced",
  f=>f.model[0].actualInference=false,f=>f.model[0].serverStopped=false,
  f=>f.model[0].browserRestarted=false,f=>f.model[0].online.busyObserved=false,
  f=>f.model[0].offline.workerCount=0,f=>f.release[1].workerExit=false,
  f=>f.cancel[0].externalRequests=1,f=>f.cancel[0].workers=1]){
  const f=fixture();mutate(f);const r=verifyAdviceReceipts(f);assert.equal(r.engineeringPassed,false);assert.equal(r.qualificationPassed,false);
 }
});
test("missing and duplicate observations cannot produce a positive result",()=>{
 for(const mutate of [f=>f.initial.pop(),f=>f.extended.pop(),f=>f.initial[3]={...f.initial[0]},
  f=>f.extended[2]={...f.extended[0]},f=>f.model.push({...f.model[0]}),f=>f.release[1]={...f.release[0]}]){
  const f=fixture();mutate(f);assert.equal(verifyAdviceReceipts(f).qualificationPassed,false);
 }
});
test("archived four-scenario evidence is supported only under explicit legacy options",()=>{
 const f=fixture();f.extended=[];delete f.model[0].crossServiceScenarios;
 for(const r of f.initial){delete r.expectedId;delete r.selectedId;}
 assert.equal(verifyAdviceReceipts(f,{crossService:false}).qualificationPassed,false);
 const legacy=verifyAdviceReceipts(f,{crossService:false,requireIdentity:false});
 assert.equal(legacy.qualificationPassed,true);assert.deepEqual(legacy.exactSource,{passed:4,total:4});
 f.initial[0].expectedChoice=false;
 assert.equal(verifyAdviceReceipts(f,{crossService:false,requireIdentity:false}).qualificationPassed,false);
});
test("receipt parser reads only declared prefix records and rejects malformed ones",()=>{
 const f=fixture(),prefix={model:"D05_T3_REAL_MODEL_PASS ",initial:"D05_T3_MODEL_ADVICE_EVIDENCE ",
  extended:"D05_T3_MODEL_CROSS_SERVICE_EVIDENCE ",release:"D05_T3_MODEL_CACHE_RELEASE ",cancel:"D05_T3_MODEL_CANCEL_PASS "};
 const log=Object.entries(f).flatMap(([k,rows])=>rows.map(r=>prefix[k]+JSON.stringify(r))).join("\n");
 assert.deepEqual(parseAdviceReceipts("ignored text\n"+log),f);
 for(const s of ["not-json","[]","null","false"])
  assert.throws(()=>parseAdviceReceipts(prefix.model+s),/D05_ADVICE_RECEIPT_/);
});
