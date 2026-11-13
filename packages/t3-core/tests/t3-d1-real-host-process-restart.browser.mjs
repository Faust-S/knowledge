// Three INDEPENDENT Node Host processes exercise TWO COLD RESTARTS of the
// original T2 Kernel/Store with exactly the same persistent Chromium profile.
// Both restarted processes unlock the ORIGINAL encrypted actor vault and
// re-read the revoked signed STATUS from the original Object/Event Store.
// No standalone T3 application. Issuance is CI-only.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {createServer as createTcpServer} from "node:net";
import {
  cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import {
  PROFILE,digest,iso,signRecord,keyObjectSigner
} from "../src/t3/access/core.mjs";
import {
  emptyVault,generateVaultKey,encryptVault,decryptVault,vaultPrivateKey
} from "../src/t3/access/local-vault.mjs";
import {createOriginalVaultProofSigner}
  from "../src/t3/access/original-vault-proof.mjs";
import {createOriginalPersonalAccessCheck}
  from "../src/t3/access/original-personal-evaluator.mjs";
import {createOriginalKernelRegistryStatePort,ORIGINAL_REGISTRY_SCHEMA}
  from "../src/t3/access/original-kernel-registry-state.mjs";
import {createSignedAccessHostPort}
  from "../src/t3/signed-access-host-port.mjs";
import {createSubjectKernelBinding}
  from "../src/t3/subject-access-binding.mjs";
import {materializeIntegrationHost,serveRealKernelHost}
  from "../scripts/real-kernel-e2e.mjs";
import {assertQualifiedKernelArtifact}
  from "../src/factory2/products/domain-completion/independent-browser-witness.mjs";

const script=fileURLToPath(import.meta.url);
const SERVICE="iwxa.workspace.integration",VERSION="0.3.6",CONTRACT="1.3.0";
const ARTIFACT="iwxa-kernel-k036-same-store-history-20261019-qualified.1";
const REGISTRY_WS="t3-process-access",PERSONAL_WS="t3-process-personal";
const OBJECT="document:one",DENIED_OBJECT="document:revoked-after-process";
const PASSPHRASE="CI_TEST_ONLY_NOT_A_PRODUCT_DEFAULT_PASSPHRASE";
const readJson=path=>JSON.parse(readFileSync(path,"utf8"));
const put=(root,path,value)=>{
  const dest=join(root,path);
  mkdirSync(join(dest,".."),{recursive:true});
  writeFileSync(dest,typeof value==="string"?value:JSON.stringify(value));
};
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const command=id=>({
  workspace_id:PERSONAL_WS,object_id:id,
  schema_id:"iwxa.demo.note",schema_version:"1.0.0",
  base_revision:0,extensions:{},
  data:{title:"Original signed Access after complete Host process restart"},
  event:{event_type:"t3.d1.real.host.process",payload:{}},
});
function buildSignedMaterial(now) {
  const vault=emptyVault();
  const issuer=generateVaultKey(vault,{keyId:"key:issuer",
    subjectId:"issuer:local",createdAt:iso(now-30000)});
  const status=generateVaultKey(vault,{keyId:"key:status",
    subjectId:"issuer:local",createdAt:iso(now-30000)});
  const actor=generateVaultKey(vault,{keyId:"key:actor",
    subjectId:"person:local",createdAt:iso(now-30000)});
  const key=(created,subjectId,uses)=>({
    subjectId,environment:"TEST",publicKey:created.publicKeyPem,
    status:"ACTIVE",uses,notBefore:iso(now-600000),expiresAt:iso(now+86400000)
  });
  const policy={
    schema:PROFILE,id:"policy:personal",version:"v1",
    realmId:"realm:personal",environment:"TEST",
    statusMode:"OFFLINE_BOUNDED",timeAssurance:"LOCAL_BEST_EFFORT",
    proofMaxAgeSeconds:60,snapshotMaxAgeSeconds:3600,offlineMaxAgeSeconds:3600,
    keys:{
      "key:issuer":key(issuer,"issuer:local",["GRANT"]),
      "key:status":key(status,"issuer:local",["STATUS"]),
      "key:actor":key(actor,"person:local",["PROOF"]),
    },
    authorities:{"authority:personal":{
      principalId:"person:local",issuerKeys:["key:issuer"],
      statusKeys:["key:status"],audiences:["host:t3"],
      resources:[PERSONAL_WS],actions:["object.write"],
      purposes:["purpose:work"],roles:["role:member"],
      rightClasses:["ACTION"],membershipEpoch:1,
      maxTtlSeconds:3600,maxDelegationDepth:0,
    }},
    actionCatalog:{"object.write":"ACTION"},prohibitions:[],confirmations:[],
  };
  const selected={
    kind:"PERSONAL",context_id:"context:personal",actor_id:"person:local",
    principal_id:"person:local",role_id:"role:member",grant_id:"grant:personal",
    realm_id:"realm:personal",audience:"host:t3",resource:PERSONAL_WS,
    purpose:"purpose:work",workspace_id:PERSONAL_WS,organization_id:null,
    scope_revision:1,
  };
  const grant={
    kind:"GRANT",id:"grant:personal",lineageId:"lineage:personal",
    renewalOf:null,parentGrantId:null,authorityId:"authority:personal",
    principalId:"person:local",holderId:"person:local",
    roleId:"role:member",rightClass:"ACTION",
    realmId:"realm:personal",environment:"TEST",audience:"host:t3",
    resources:[PERSONAL_WS],actions:["object.write"],purposes:["purpose:work"],
    issuedAt:iso(now-30000),notBefore:iso(now-20000),
    expiresAt:iso(now+1200000),remainingDepth:0,membershipEpoch:1,
    policyId:"policy:personal",policyVersion:"v1",
    evidenceRefs:["evidence:issuer"],
  };
  const signStatus=payload=>signRecord(payload,
    keyObjectSigner("key:status",vaultPrivateKey(vault,"key:status")));
  const active={
    kind:"STATUS",id:"status:personal",environment:"TEST",
    realmId:"realm:personal",authorityId:"authority:personal",
    sequence:1,membershipEpoch:1,issuedAt:iso(now-2000),
    validUntil:iso(now+600000),
    entries:[{grantId:"grant:personal",state:"ACTIVE",
      effectiveAt:iso(now-2500),evidenceRef:"evidence:active"}],
  };
  const revoked={...active,sequence:2,issuedAt:iso(now-1000),
    entries:[{grantId:"grant:personal",state:"REVOKED",
      effectiveAt:iso(now-1200),evidenceRef:"evidence:revoked"}]};
  const state={
    policy,grants:{"grant:personal":signRecord(grant,
      keyObjectSigner("key:issuer",vaultPrivateKey(vault,"key:issuer")))},
    statuses:{"authority:personal":signStatus(active)},
    statusFloor:{"authority:personal":1},tombstones:{},
  };
  return {encrypted:encryptVault(vault,PASSPHRASE),policy,selected,
    initial:state,revoked:{
      ...structuredClone(state),
      statuses:{"authority:personal":signStatus(revoked)},
      statusFloor:{"authority:personal":2},
    }};
}
async function storeBridge(page){
  const original=await page.evaluate(async({SERVICE,CONTRACT,VERSION})=>{
    const s=await window.IWXA.connect({service_id:SERVICE});
    if(s.contract_version!==CONTRACT || s.runtime_version!==VERSION)
      throw Error("NOT_ORIGINAL_0_3_6_KERNEL");
    return {contract:s.contract_version,version:s.runtime_version};
  },{SERVICE,CONTRACT,VERSION});
  assert.equal(original.version,VERSION);
  const call=(method,...args)=>page.evaluate(async({SERVICE,method,args})=>{
    const s=await IWXA.connect({service_id:SERVICE});
    if(method==="getObject")return s.t1.getObject(...args);
    if(method==="putObject")return s.t1.putObject(...args);
    if(method==="listEventsSince")return s.t1.listEventsSince(...args);
    throw Error("UNKNOWN_ORIGINAL_METHOD");
  },{SERVICE,method,args});
  return Object.freeze({
    sessionInfo:{contract_version:original.contract,runtime_version:VERSION},
    hasOperation:op=>["t1.getObject","t1.putObject","t1.listEventsSince"].includes(op),
    getObject:(...args)=>call("getObject",...args),
    putObject:(...args)=>call("putObject",...args),
    listEventsSince:(...args)=>call("listEventsSince",...args),
  });
}
function signedOwner(statePort,root,trusted) {
  const actorProof=createOriginalVaultProofSigner({
    keyId:"key:actor",
    readEncryptedVault:async()=>readFileSync(join(root,"keys.enc.json"),"utf8"),
    unlockPassphrase:async()=>PASSPHRASE,
  });
  const check=createOriginalPersonalAccessCheck({
    readState:()=>statePort.readState(),signProof:actorProof,clock:Date.now,
  });
  return createSignedAccessHostPort({
    currentContext:()=>trusted.selected,
    actionFor:op=>{
      if(op!=="t1.putObject")throw Error("T3_D1_OWNER_METHOD_NOT_GRANTED");
      return "object.write";
    },
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    canonicalDigest:digest,personal:{check},clock:Date.now,
  });
}
async function phase(variant,root,port) {
  const dist=join(root,"dist");
  let live=null,context=null;
  try{
    live=await serveRealKernelHost(dist,{listenPort:port});
    assert.equal(live.origin,"https://127.0.0.1:"+port);
    context=await chromium.launchPersistentContext(join(root,"browser-profile"),{
      headless:true,ignoreHTTPSErrors:true,
      args:["--no-sandbox","--ignore-certificate-errors"],
    });
    const page=context.pages()[0]||await context.newPage();
    await page.goto(live.origin+"/workspace/");
    await page.waitForFunction(()=>typeof window.IWXA?.connect==="function");
    const kernel=await storeBridge(page);
    if(variant==="initialize"){
      await page.evaluate(async({SERVICE,workspaces})=>{
        const session=await IWXA.connect({service_id:SERVICE});
        for(const id of workspaces)
          await session.t1.createWorkspace({workspace_id:id,profile:"generic"});
      },{SERVICE,workspaces:[REGISTRY_WS,PERSONAL_WS]});
      const signed=buildSignedMaterial(Date.now());
      put(root,"keys.enc.json",signed.encrypted);
      put(root,"trusted-public.json",{policy:signed.policy,selected:signed.selected});
      const statePort=createOriginalKernelRegistryStatePort({
        kernel,workspaceId:REGISTRY_WS,trustedPolicy:signed.policy,
      });
      assert.equal((await statePort.commitSignedState(signed.initial)).revision,1);
      const bound=createSubjectKernelBinding({
        kernel,access:signedOwner(statePort,root,signed),
      });
      const receipt=await bound.putObject(command(OBJECT));
      assert.equal(receipt?.object?.revision,1);
      assert.equal(receipt?.event?.workspace_id,PERSONAL_WS);
      assert.equal((await statePort.commitSignedState(signed.revoked)).revision,2);
      assert.equal((await statePort.getStatus()).sequences["authority:personal"],2);
      await assert.rejects(bound.putObject(command(DENIED_OBJECT)),
        {code:"T3_ACCESS_NOT_PERMITTED"});
      console.log("T3_D1_HOST_PROCESS_PHASE_ONE",JSON.stringify({
        pid:process.pid,originalKernel:VERSION,originalWrite:true,
        signedStatusSequence:2,originalStore:true,
      }));
    }else if(variant==="cold"||variant==="cold2"){
      const trusted=readJson(join(root,"trusted-public.json"));
      const vault=decryptVault(readJson(join(root,"keys.enc.json")),PASSPHRASE);
      assert.deepEqual(Object.keys(vault.keys).sort(),[
        "key:actor","key:issuer","key:status"]);
      const statePort=createOriginalKernelRegistryStatePort({
        kernel,workspaceId:REGISTRY_WS,trustedPolicy:trusted.policy,
      });
      const status=await statePort.getStatus();
      assert.equal(status.sequences["authority:personal"],2,
        "new Host must recover real signed STATUS from original Kernel Store");
      const bound=createSubjectKernelBinding({
        kernel,access:signedOwner(statePort,root,trusted),
      });
      await assert.rejects(bound.putObject(command(DENIED_OBJECT)),
        {code:"T3_ACCESS_NOT_PERMITTED"});
      const old=await kernel.getObject(PERSONAL_WS,OBJECT);
      const denied=await kernel.getObject(PERSONAL_WS,DENIED_OBJECT);
      const events=await kernel.listEventsSince(PERSONAL_WS);
      assert.equal(old?.object?.revision,1);
      assert.equal(denied?.object??null,null);
      assert.ok(events.some(e=>e.event_type==="t3.d1.real.host.process"));
      console.log(variant==="cold2"?"T3_D1_HOST_PROCESS_PHASE_THREE":"T3_D1_HOST_PROCESS_PHASE_TWO",JSON.stringify({
        pid:process.pid,originalKernel:VERSION,signedActorVaultRecovered:true,
        signedStatusSequence:2,originalKernelColdRead:true,
        originalKernelWriteCountAfterRevoke:0,
      }));
    }else throw Error("UNKNOWN_PHASE");
  }finally{
    if(context)await context.close().catch(()=>{});
    if(live?.server?.listening){
      live.server.closeAllConnections();
      await new Promise(resolve=>live.server.close(resolve));
    }
  }
}
async function freePort(){
  const srv=createTcpServer();
  await new Promise((resolve,reject)=>{
    srv.once("error",reject);srv.listen(0,"127.0.0.1",resolve);
  });
  const result=srv.address().port;
  await new Promise(resolve=>srv.close(resolve));
  return result;
}
if(process.argv[2]==="--phase"){
  const [, , ,variant,root,p]=process.argv;
  await phase(variant,root,Number(p));
}else{
  test("two cold original Host restarts recover encrypted Ed25519 actor and revoked STATUS",{
    timeout:270000
  },async()=>{
    const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
    assert.ok(qualified&&existsSync(join(qualified,
      "_iwxa/runtime/0.3.6/runtime.js")),"ORIGINAL_KERNEL_REQUIRED");
    const root=mkdtempSync(join(tmpdir(),"t3-real-host-process-"));
    try{
      const dist=join(root,"dist");mkdirSync(dist);
      cpSync(join(qualified,"_iwxa"),join(dist,"_iwxa"),{recursive:true});
      assertQualifiedKernelArtifact(dist,{kernel:VERSION,contract:CONTRACT,
        artifactId:ARTIFACT});
      const initialHash=sha(readFileSync(join(dist,"_iwxa/runtime/0.3.6/runtime.js")));
      const port=await freePort(),origin="https://127.0.0.1:"+port;
      const host=materializeIntegrationHost(dist,origin);
      host.domain.runtime.kernel_release=VERSION;
      host.domain.runtime.runtime_version=VERSION;
      host.workspaceConfig.host.required_runtime_version=VERSION;
      host.workspaceConfig.host.required_contract_version=CONTRACT;
      host.domain.security.allowed_object_classes.push(ORIGINAL_REGISTRY_SCHEMA);
      host.passport.input_object_types.push(ORIGINAL_REGISTRY_SCHEMA);
      host.passport.output_object_types.push(ORIGINAL_REGISTRY_SCHEMA);
      host.passport.schemas[ORIGINAL_REGISTRY_SCHEMA]={
        schema_version:"1.0.0",preserve_unknown:true,
        json_schema:{type:"object"},embedded:{},
      };
      host.passport.permissions.objects.read.push(ORIGINAL_REGISTRY_SCHEMA);
      host.passport.permissions.objects.write.push(ORIGINAL_REGISTRY_SCHEMA);
      put(dist,"_iwxa/domain.json",host.domain);
      put(dist,"workspace/workspace.config.json",host.workspaceConfig);
      const pass="_iwxa/services/"+SERVICE+".json";
      put(dist,pass,host.passport);
      put(dist,"_iwxa/service-catalog.json",{
        count:1,entries:[{
          service_id:SERVICE,service_version:host.passport.service_version,
          base_path:host.passport.base_path,
          supported_levels:host.passport.supported_levels,
          file:pass,sha256:sha(readFileSync(join(dist,pass))),
        }]
      });
      put(dist,"workspace/index.html",'<html lang="ru"><head><title>Host</title></head>'+
        '<body><script src="/_iwxa/loader.js"></script></body></html>');
      const stage=variant=>{
        const out=execFileSync(process.execPath,
          [script,"--phase",variant,root,String(port)],{
            cwd:process.cwd(),env:{...process.env},
            encoding:"utf8",timeout:90000,maxBuffer:1024*1024,
          });
        const phaseName={initialize:"ONE",cold:"TWO",cold2:"THREE"}[variant];
        const line=out.trim().split(/\r?\n/).find(value=>
          value.startsWith("T3_D1_HOST_PROCESS_PHASE_"+phaseName));
        assert.ok(line,"MISSING_CHILD_PHASE_EVIDENCE: "+out.slice(-2000));
        return JSON.parse(line.slice(line.indexOf("{")));
      };
      const first=stage("initialize");
      const encryptedVaultDigest=sha(readFileSync(join(root,"keys.enc.json")));
      const second=stage("cold"),third=stage("cold2");
      assert.equal(new Set([first.pid,second.pid,third.pid]).size,3,
        "two cold Host startups must use fresh operating-system processes");
      assert.equal(first.originalStore,true);
      for(const restored of [second,third]){
        assert.equal(restored.signedActorVaultRecovered,true);
        assert.equal(restored.signedStatusSequence,2);
        assert.equal(restored.originalKernelColdRead,true);
        assert.equal(restored.originalKernelWriteCountAfterRevoke,0);
      }
      assert.equal(sha(readFileSync(join(root,"keys.enc.json"))),
        encryptedVaultDigest,"cold Host must not rewrite existing encrypted keys");
      assert.equal(sha(readFileSync(join(dist,
        "_iwxa/runtime/0.3.6/runtime.js"))),initialHash);
      console.log("T3_D1_TWO_COLD_NODE_HOST_PROCESS_RESTART_STATUS_PASS",JSON.stringify({
        independentHostProcesses:3,coldRestarts:2,originalKernel:"0.3.6",
        originalRuntimeContract:"1.3.0",oneOriginalKernelStore:true,
        originalAccessEvaluator:true,unchangedEncryptedVault:true,
        revokedSequenceRecoveredInBothColdProcesses:2,
        revokedWriteRejectedAfterBothRestarts:true,
        originalKernelReadbackAfterBothRestarts:true,
        syntheticIssuerOnly:true,corporateEnrollmentsInThisTest:false,
      }));
    }finally{rmSync(root,{recursive:true,force:true});}
  });
}
