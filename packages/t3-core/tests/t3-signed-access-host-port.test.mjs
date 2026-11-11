import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSignedAccessHostPort } from "../src/t3/signed-access-host-port.mjs";
import { createSubjectKernelBinding } from "../src/t3/subject-access-binding.mjs";

// Contract-only doubles, never a signed registry or evidence of real owner E2E.
const now=Date.parse("2026-11-11T08:00:00.000Z");
const hash=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const contexts=[
  {kind:"PERSONAL",context_id:"personal",actor_id:"person:1",principal_id:"person:1",
   role_id:"role:member",grant_id:"grant:personal",realm_id:"realm:personal",
   audience:"host:t3",resource:"ws:personal",purpose:"purpose:work",
   workspace_id:"ws:personal",scope_revision:1,organization_id:null},
  ...[1,2].map(n=>({kind:"CORP",context_id:"corp:"+n,actor_id:"person:1",
   principal_id:"org:"+n,role_id:"role:member",grant_id:"grant:"+n,
   realm_id:"realm:"+n,audience:"host:t3",resource:"ws:"+n,purpose:"purpose:work",
   workspace_id:"ws:"+n,scope_revision:1,organization_id:"org:"+n})),
];
function fixture() {
  let current=0,revoked=false,mutatePreview=false,mutateDecision=false,proofKey="credential:1";
  const calls=[], objects=new Map();
  const owner={
    currentContext:()=>contexts[current],
    actionFor:op=>op==="t1.putObject"?"object.write":"object.read",
    operationDigest:({operation,input,context})=>hash({operation,input,context}),
    canonicalDigest:hash,
    personal:{check:request=>({
      schema:"IWXA_T3_AUTHORIZATION_DECISION/1",outcome:revoked?"DENIED":"PERMITTED",
      allowed:!revoked,evidenceOnly:true,requestDigest:hash(request),
      policyDigest:hash("policy"),validUntil:new Date(now+60000).toISOString(),
      statusObservedAt:new Date(now).toISOString(),evaluatedAt:new Date(now).toISOString(),
      statusSequence:1,authorityPath:[{grantId:request.grantId}],
    })},
    corporate:{
      inputFor:context=>({contextId:context.context_id}),
      prove:({credentialKeyId})=>({keyId:proofKey||credentialKeyId,payload:"synthetic"}),
      gate:{
        preview:input=>{
          const c=contexts[current];
          const request={
            id:"org:"+hash(input).slice(0,55),
            actorId:c.actor_id,principalId:c.principal_id,roleId:c.role_id,
            grantId:c.grant_id,audience:input.operation.audience,
            resource:mutatePreview?"ws:other":input.operation.resource,
            action:input.operation.action,purpose:input.operation.purpose,
            realmId:c.realm_id,operationDigest:hash({bound:input}),
          };
          calls.push("preview");
          return {schema:"IWXA_T3_ORGANIZATION_OPERATION_PREVIEW/1",
            authorized:false,subjectType:"ORGANIZATION",organizationId:c.organization_id,
            workspaceId:c.workspace_id,credentialKeyId:"credential:1",
            scopeDigest:request.operationDigest,request};
        },
        authorize:(input,{challenge,proof})=>{
          calls.push("authorize");
          const preview=owner.corporate.gate.preview(input);
          return {
            schema:"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1",
            outcome:revoked?"DENIED":"PERMITTED",allowed:!revoked,
            evidenceOnly:true,productionActivation:false,
            requestDigest:mutateDecision?hash("tampered"):hash(preview.request),
            policyDigest:hash("policy"),operationDigest:preview.request.operationDigest,
            evidenceDigest:hash({input,challenge,proof}),
            grantId:preview.request.grantId,organizationId:preview.organizationId,
            workspaceId:preview.workspaceId,statusSequence:2,
            validUntil:new Date(now+60000).toISOString(),
            doesNotTransferData:true,doesNotAcceptCorporateCopy:true,
          };
        },
      },
    },
    clock:()=>now,
    randomUUID:()=>Math.random().toString(36).padEnd(32,"0").slice(0,32),
  };
  // The synthetic gate's preview is deterministic for the same input, despite
  // challenge generation. Host's real gate owns all signature validations.
  const access=createSignedAccessHostPort(owner);
  const kernel={
    sessionInfo:{contract_version:"1.3.0"},
    hasOperation:()=>true,
    async putObject(x){calls.push("kernel");objects.set(x.workspace_id+"/"+x.object_id,x);return {object:x};},
    async getObject(ws,id){calls.push("kernel");return {object:objects.get(ws+"/"+id)};},
  };
  return {access,binding:createSubjectKernelBinding({access,kernel,clock:()=>now}),
    calls,objects,select:n=>current=n,revoke:()=>{revoked=true},
    badPreview:()=>{mutatePreview=true},badDecision:()=>{mutateDecision=true},
    badProof:()=>{proofKey="credential:wrong"}};
}
test("personal direct signed-owner decision reaches inherited Kernel through D1",async()=>{
  const f=fixture();
  const x=await f.binding.putObject({workspace_id:"ws:personal",object_id:"item:1",base_revision:0});
  assert.equal(x.object.workspace_id,"ws:personal");
  assert.deepEqual(f.calls,["kernel"]);
});
test("two corporate contexts use organizational preview and separate decision schema",async()=>{
  const f=fixture();
  for(let n=1;n<=2;n++){
    f.select(n);
    const x=await f.binding.putObject({workspace_id:"ws:"+n,object_id:"item:"+n,base_revision:0});
    assert.equal(x.object.workspace_id,"ws:"+n);
  }
  assert.equal(f.calls.filter(x=>x==="authorize").length,2);
  assert.equal(f.calls.filter(x=>x==="kernel").length,2);
});
test("revoked personal and corporate decisions never call Kernel",async()=>{
  const f=fixture();f.revoke();
  await assert.rejects(f.binding.putObject({workspace_id:"ws:personal",object_id:"x"}),{code:"T3_ACCESS_NOT_PERMITTED"});
  f.select(1);
  await assert.rejects(f.binding.putObject({workspace_id:"ws:1",object_id:"x"}),{code:"T3_ACCESS_NOT_PERMITTED"});
  assert.equal(f.calls.includes("kernel"),false);
});
test("corporate preview resource mismatch refuses before proof or Kernel",async()=>{
  const f=fixture();f.select(1);f.badPreview();
  await assert.rejects(f.binding.putObject({workspace_id:"ws:1",object_id:"x"}),{code:"T3_OWNER_CORPORATE_PREVIEW_MISMATCH"});
  assert.equal(f.calls.includes("authorize"),false);
  assert.equal(f.calls.includes("kernel"),false);
});
test("corporate decision request digest tamper cannot authorize",async()=>{
  const f=fixture();f.select(1);f.badDecision();
  await assert.rejects(f.binding.putObject({workspace_id:"ws:1",object_id:"x"}),{code:"T3_OWNER_CORPORATE_DECISION_UNBOUND"});
  assert.equal(f.calls.includes("kernel"),false);
});
test("wrong corporate proof key does not bypass enrollment credential",async()=>{
  const f=fixture();f.select(1);f.badProof();
  await assert.rejects(f.binding.putObject({workspace_id:"ws:1",object_id:"x"}),{code:"T3_OWNER_CORPORATE_PROOF_UNAVAILABLE"});
  assert.equal(f.calls.includes("kernel"),false);
});
test("cross-workspace requests are rejected before the owner is called",async()=>{
  const f=fixture();f.select(2);
  await assert.rejects(f.binding.putObject({workspace_id:"ws:1",object_id:"x"}),{code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  assert.equal(f.calls.length,0);
});
