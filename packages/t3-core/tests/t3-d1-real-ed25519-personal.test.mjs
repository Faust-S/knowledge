import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync} from "node:crypto";
import {PROFILE,signRecord,keyObjectSigner,makeProof,digest,evaluate}
  from "../src/t3/access/core.mjs";
import {createOriginalPersonalAccessCheck}
  from "../src/t3/access/original-personal-evaluator.mjs";
import {createSignedAccessHostPort}
  from "../src/t3/signed-access-host-port.mjs";
import {createSubjectKernelBinding}
  from "../src/t3/subject-access-binding.mjs";

const now=Date.parse("2026-11-13T12:00:00.000Z"), iso=n=>new Date(n).toISOString();
const key=(id,subject,uses)=>{
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  return {signer:keyObjectSigner(id,privateKey),record:{
    subjectId:subject,environment:"TEST",
    publicKey:publicKey.export({format:"pem",type:"spki"}).toString(),
    status:"ACTIVE",uses,notBefore:iso(now-100000),expiresAt:iso(now+86400000),
  }};
};
function fixture(){
  const issuer=key("key:issuer","issuer:local",["GRANT"]);
  const status=key("key:status","issuer:local",["STATUS"]);
  const actor=key("key:actor","person:owner",["PROOF"]);
  const context={
    kind:"PERSONAL",context_id:"context:local",actor_id:"person:owner",
    principal_id:"person:owner",role_id:"role:owner",grant_id:"grant:one",
    realm_id:"realm:local",audience:"host:t3",resource:"ws:personal",
    purpose:"purpose:work",workspace_id:"ws:personal",
    organization_id:null,scope_revision:1,
  };
  const policy={
    schema:PROFILE,id:"policy:local",version:"v1",realmId:"realm:local",
    environment:"TEST",statusMode:"OFFLINE_BOUNDED",
    timeAssurance:"LOCAL_BEST_EFFORT",proofMaxAgeSeconds:60,
    snapshotMaxAgeSeconds:3600,offlineMaxAgeSeconds:3600,
    keys:{"key:issuer":issuer.record,"key:status":status.record,
      "key:actor":actor.record},
    authorities:{"authority:local":{
      principalId:"person:owner",issuerKeys:["key:issuer"],
      statusKeys:["key:status"],audiences:["host:t3"],resources:["ws:personal"],
      actions:["object.write","object.read"],purposes:["purpose:work"],
      roles:["role:owner"],rightClasses:["ACTION"],membershipEpoch:1,
      maxTtlSeconds:3600,maxDelegationDepth:0,
    }},
    actionCatalog:{"object.write":"ACTION","object.read":"ACTION"},
    prohibitions:[],confirmations:[],
  };
  const grant={
    kind:"GRANT",id:"grant:one",lineageId:"lineage:one",renewalOf:null,
    parentGrantId:null,authorityId:"authority:local",
    principalId:"person:owner",holderId:"person:owner",roleId:"role:owner",
    rightClass:"ACTION",realmId:"realm:local",environment:"TEST",
    audience:"host:t3",resources:["ws:personal"],
    actions:["object.write","object.read"],purposes:["purpose:work"],
    issuedAt:iso(now-20000),notBefore:iso(now-19000),
    expiresAt:iso(now+600000),remainingDepth:0,membershipEpoch:1,
    policyId:"policy:local",policyVersion:"v1",evidenceRefs:["evidence:grant"],
  };
  const originalStatus={
    kind:"STATUS",id:"status:local",environment:"TEST",realmId:"realm:local",
    authorityId:"authority:local",sequence:1,membershipEpoch:1,
    issuedAt:iso(now-2000),validUntil:iso(now+600000),
    entries:[{grantId:"grant:one",state:"ACTIVE",
      effectiveAt:iso(now-3000),evidenceRef:"evidence:active"}],
  };
  const state={policy,grants:{"grant:one":signRecord(grant,issuer.signer)},
    statuses:{"authority:local":signRecord(originalStatus,status.signer)},
    statusFloor:{"authority:local":1},tombstones:{}};
  let subject=context,reads=0,proofs=0;
  let releaseProof=null;
  const signedCheck=createOriginalPersonalAccessCheck({
    clock:()=>now,
    randomUUID:(()=>{let n=0;return ()=>"nonce-"+String(++n).padStart(27,"0");})(),
    signProof:async({request,challenge,asOf})=>{
      proofs++;
      if(releaseProof)await releaseProof.promise;
      return makeProof(request,challenge,Date.parse(asOf),actor.signer);
    },
    readState:async()=>{reads++;return state;},
  });
  const owner=createSignedAccessHostPort({
    currentContext:()=>subject,
    actionFor:op=>op==="t1.putObject"?"object.write":"object.read",
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    canonicalDigest:digest,
    personal:{check:signedCheck},clock:()=>now,
  });
  const calls=[],data=new Map();
  const kernel={
    sessionInfo:{contract_version:"1.3.0",runtime_version:"0.3.6"},
    hasOperation:op=>["t1.putObject","t1.getWorkspace"].includes(op),
    async putObject(input){
      calls.push(input);
      data.set(input.workspace_id+"/"+input.object_id,input);
      return {object:{...input,revision:1},event:{
        workspace_id:input.workspace_id,event_id:"event:"+input.object_id,
      }};
    },
  };
  const binding=createSubjectKernelBinding({kernel,access:owner,clock:()=>now});
  return {
    binding,calls,data,state,issuer,status,actor,owner,context,
    get reads(){return reads;},get proofs(){return proofs;},
    setSubject:x=>{subject=x;},
    revoke:()=>{
      const updated={...originalStatus,sequence:2,issuedAt:iso(now-1000),
        entries:[{grantId:"grant:one",state:"REVOKED",
          effectiveAt:iso(now-1500),evidenceRef:"evidence:revocation"}]};
      state.statuses["authority:local"]=signRecord(updated,status.signer);
      state.statusFloor["authority:local"]=2;
    },
    suspendStatus:()=>{
      state.statuses["authority:local"]={...state.statuses["authority:local"],
        signature:"A".repeat(86)};
    },
    tamperGrant:()=>{
      state.grants["grant:one"].payload.actions=["object.read"];
    },
    deferProof:()=>{
      let resolve;
      const promise=new Promise(r=>{resolve=r;});
      releaseProof={promise,resolve};return resolve;
    },
  };
}
const command=(suffix)=>({
  workspace_id:"ws:personal",object_id:"item:"+suffix,
  schema_id:"iwxa.local-inference.draft",schema_version:"1.0.0",
  base_revision:0,data:{status:"DRAFT_UNTRUSTED",text:"local Ed25519 proof"},
  event:{event_type:"t3.local-inference.draft.saved",payload:{source:"BLI"}},
});

test("real original Ed25519 grant, proof and status authorize one T2 Kernel write",async()=>{
  const f=fixture();
  const out=await f.binding.putObject(command("one"));
  assert.equal(out.object.workspace_id,"ws:personal");
  assert.equal(f.calls.length,1);
  assert.equal(f.reads,1);
  assert.equal(f.proofs,1);
});
test("signed revocation after first receipt denies the next write, not the old receipt",async()=>{
  const f=fixture();
  assert.equal((await f.binding.putObject(command("before"))).object.object_id,"item:before");
  f.revoke();
  await assert.rejects(f.binding.putObject(command("after")),
    {code:"T3_ACCESS_NOT_PERMITTED"});
  assert.deepEqual(f.calls.map(x=>x.object_id),["item:before"]);
  assert.equal(f.reads,2);
});
test("cryptographic grant or status tampering never reaches original Kernel",async()=>{
  for(const attack of ["tamperGrant","suspendStatus"]){
    const f=fixture();f[attack]();
    await assert.rejects(f.binding.putObject(command(attack)),
      {code:"T3_ACCESS_NOT_PERMITTED"});
    assert.equal(f.calls.length,0);
  }
});
test("changing selected subject cannot cross its existing signed Workspace",async()=>{
  const f=fixture();
  f.setSubject({...f.context,workspace_id:"ws:another",
    resource:"ws:another",scope_revision:2});
  await assert.rejects(f.binding.putObject(command("foreign")),
    {code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  assert.equal(f.calls.length,0);
});
test("revocation while authentic actor is signing is checked just-in-time",async()=>{
  const f=fixture();
  const resume=f.deferProof();
  const pending=f.binding.putObject(command("concurrent"));
  // Wait until the proof provider has been called before changing authority.
  for(let n=0;n<100&&f.proofs===0;n++)
    await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.proofs,1);
  f.revoke();resume();
  await assert.rejects(pending,{code:"T3_ACCESS_NOT_PERMITTED"});
  assert.equal(f.calls.length,0);
  assert.equal(f.reads,1);
});
test("public personal proof path never invents a corporate issuer or saved key",()=>{
  assert.throws(()=>createOriginalPersonalAccessCheck({readState:()=>null}),
    {code:"T3_ACCESS_ORIGINAL_CALLBACK_REQUIRED"});
  assert.equal(typeof evaluate,"function");
  assert.equal(typeof createSignedAccessHostPort,"function");
});
