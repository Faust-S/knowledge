import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createControlLoopbackOwner} from "../src/t3/control-loopback-owner.mjs";
import {createSubjectKernelBinding} from "../src/t3/subject-access-binding.mjs";

const origin="http://127.0.0.1:19183",token="x".repeat(44);
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const now=new Date().toISOString(),until=new Date(Date.now()+3600000).toISOString();

function fixture(){
  let epoch=1,selected="PERSONAL",revoked=false,decisions=0;
  const writes=[],reads=[];
  const context=()=>({
    kind:"CORP",context_id:"corp:"+selected,actor_id:"person:worker",
    principal_id:"org:"+selected,role_id:"role:member",grant_id:"grant:"+selected,
    realm_id:"realm:"+selected,audience:"host:t3",resource:"ws:"+selected,
    purpose:"workspace.work",workspace_id:"ws:"+selected,
    organization_id:"org:"+selected,scope_revision:epoch,
  });
  const respond=(value,status=200)=>new Response(JSON.stringify(value),
    {status,headers:{"content-type":"application/json"}});
  const fetchImpl=async(url,options={})=>{
    assert.ok(url.startsWith(origin+"/api/t3/"));
    assert.equal(options.headers.Authorization,"Bearer "+token);
    if(url.endsWith("/context-epoch")){
      assert.equal(options.method,"GET");
      return respond({contextEpoch:epoch});
    }
    if(url.endsWith("/owner-events"))return respond({error:"NOT_EXERCISED"},404);
    const input=JSON.parse(options.body);
    assert.equal(options.headers["Content-Type"],"application/json");
    const callerEpoch=Number(options.headers["X-IWXA-Context-Epoch"]);
    if(callerEpoch!==epoch)return respond({error:"STALE_CONTEXT_OPERATION"},400);
    if(input.verb==="select"){
      return respond({available:selected!=="PERSONAL" &&
        (input.operation==="getWorkspace"||input.operation==="putObject"||
          input.operation==="activity.read"),contextEpoch:epoch});
    }
    if(selected==="PERSONAL")return respond({error:"T3_D1_ACCESS_OWNER_REQUIRED"},400);
    if(input.verb==="context")return respond({context:context()});
    if(input.verb==="action")return respond({action:input.kernelOperation==="t1.putObject"?
      "object.write":"workspace.read"});
    if(input.verb==="digest")return respond({digest:hash({
      operation:input.kernelOperation,input:input.command,context:input.context})});
    if(input.verb==="authorize"){
      decisions++;
      const r=input.request,c=context();
      return respond({decision:{schema:"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1",
        allowed:!revoked,outcome:revoked?"DENIED":"PERMITTED",
        evidenceOnly:true,productionActivation:false,
        requestDigest:hash(r),policyDigest:hash("policy"),
        operationDigest:hash("signed-operation"),evidenceDigest:hash("evidence"),
        statusSequence:epoch,validUntil:until,
        organizationId:c.organization_id,workspaceId:c.workspace_id,grantId:r.grantId,
        doesNotTransferData:true,doesNotAcceptCorporateCopy:true}});
    }
    return respond({error:"INVALID_OPERATION"},400);
  };
  const kernel={
    sessionInfo:{contract_version:"1.3.0",runtime_version:"0.3.6"},
    hasOperation:op=>["t1.getWorkspace","t1.putObject"].includes(op),
    async getWorkspace(id){reads.push(id);return {workspace_id:id};},
    async putObject(command){
      writes.push(command.workspace_id);
      return {object:{...command,revision:1},event:{event_id:"evt:1",workspace_id:command.workspace_id,object_id:command.object_id,revision:1}};
    },
  };
  return {fetchImpl,kernel,writes,reads,context,
    select:org=>{selected=org;epoch++;},revoke:()=>{revoked=true;},
    decisions:()=>decisions};
}

test("trusted loopback port requires the original Control session and loopback origin",()=>{
  assert.throws(()=>createControlLoopbackOwner({origin:"https://example.com",token}),
    {code:"T3_D1_TRUSTED_LOCAL_ORIGIN_REQUIRED"});
  assert.throws(()=>createControlLoopbackOwner({origin,token:"fake"}),
    {code:"T3_D1_TRUSTED_CONTROL_SESSION_REQUIRED"});
});

test("PERSONAL cannot reuse organizational rights; genuine Host remains fail-closed",async()=>{
  const f=fixture();
  const owner=createControlLoopbackOwner({origin,token,fetchImpl:f.fetchImpl});
  assert.equal(owner.requireSignedOwner,true);
  assert.equal(await owner.signedKernelAccess("putObject"),null);
  assert.equal(await owner.signedActivityAccess(),null);
  assert.equal(f.writes.length,0);
});

test("the original subject Kernel binding uses selected local owner, blocks foreign and revoked writes",async()=>{
  const f=fixture();
  const owner=createControlLoopbackOwner({origin,token,fetchImpl:f.fetchImpl});
  f.select("north");
  const port=await owner.signedKernelAccess("putObject");
  assert.ok(port);
  const bound=createSubjectKernelBinding({kernel:f.kernel,access:port});
  const receipt=await bound.putObject({workspace_id:"ws:north",
    object_id:"item:1",base_revision:0,schema_id:"demo",schema_version:"1.0.0",
    data:{title:"North"},event:{event_type:"created"}});
  assert.equal(receipt.object.workspace_id,"ws:north");
  assert.deepEqual(f.writes,["ws:north"]);
  assert.equal(f.decisions(),1);
  await assert.rejects(bound.putObject({workspace_id:"ws:south",object_id:"item:2",
    data:{title:"Denied"}}),{code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  assert.deepEqual(f.writes,["ws:north"]);
  f.select("south");
  await assert.rejects(bound.putObject({workspace_id:"ws:north",
    object_id:"item:3",data:{}}),{code:"STALE_CONTEXT_OPERATION"});
  const south=await owner.signedKernelAccess("getWorkspace");
  assert.ok(south);
  const read=createSubjectKernelBinding({kernel:f.kernel,access:south});
  assert.equal((await read.getWorkspace("ws:south")).workspace_id,"ws:south");
  f.revoke();
  await assert.rejects(read.getWorkspace("ws:south"),{code:"T3_ACCESS_NOT_PERMITTED"});
  assert.deepEqual(f.reads,["ws:south"]);
});
