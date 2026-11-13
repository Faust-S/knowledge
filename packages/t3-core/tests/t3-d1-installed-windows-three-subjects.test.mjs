// Product-bound Node qualification of ONE original AccessRegistry/Kernel port,
// ONE DPAPI-encrypted vault, and explicit PERSONAL/North/South user selection.
// All issuers are CI-only Ed25519 TEST fixtures, never a production credential.
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
  digest,iso,keyObjectSigner,signRecord,verifiedChain,validateStatusSnapshot,
} from "../src/t3/access/core.mjs";
import {emptyVault,generateVaultKey,importVaultKey}
  from "../src/t3/access/local-vault.mjs";
import {
  createT3InstalledSubjectSession,createT3InstalledWindowsSignedControlOwner,
} from "../src/t3/installed-original-control-host.mjs";
import {createOrganizationalOperationGate}
  from "../src/t3/access/organizational-operation.mjs";
import {createSubjectKernelBinding}
  from "../src/t3/subject-access-binding.mjs";
import {NOW,time,model,originalKernelFixture,command}
  from "./support/t3-two-corp-original-authority.mjs";

test("Windows original Control: PERSONAL + two CORP select, DPAPI JIT, revoked North and fresh owner",{
  skip:process.platform!=="win32",timeout:120000,
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"t3-d1-three-subjects-"));
  const vaultPath=join(root,"original-vault.json");
  let session=null;
  try{
    const fixture=model(),kernel=originalKernelFixture();
    const vault=emptyVault();
    // These are the SAME corporate-issued TEST keys and original enrollment
    // records used by the existing independent two-organization qualification.
    for(const entry of Object.values(fixture.all)){
      const keyId=entry.issuedCredential.publicKeyRef;
      importVaultKey(vault,{keyId,subjectId:entry.context.actor_id,
        privateKeyPem:entry.credentialPrivateKeyPem,
        expectedPublicKeyPem:fixture.policy.keys[keyId].publicKey});
    }
    const actor="person:operator",ws="ws:personal";
    const personalCredential=generateVaultKey(vault,{
      keyId:"key:cred-personal",subjectId:actor,
      createdAt:iso(NOW-30000),
    });
    // One TEST-only personal local issuer, alongside the two original CORP
    // issuers in the SAME pinned trust policy/Kernel registry.
    const kp=generateKeyPairSync("ed25519");
    const issuer=keyObjectSigner("key:issuer-personal",kp.privateKey);
    const policy=fixture.policy;
    policy.keys[issuer.keyId]={
      subjectId:actor,environment:"TEST",status:"ACTIVE",
      uses:["GRANT","STATUS"],
      publicKey:kp.publicKey.export({type:"spki",format:"pem"}).toString(),
      notBefore:iso(NOW-600000),expiresAt:iso(NOW+86400000),
    };
    policy.keys[personalCredential.keyId]={
      subjectId:actor,environment:"TEST",status:"ACTIVE",
      uses:["PROOF"],publicKey:personalCredential.publicKeyPem,
      notBefore:iso(NOW-600000),expiresAt:iso(NOW+86400000),
    };
    policy.authorities["issuer:personal"]={
      principalId:actor,issuerKeys:[issuer.keyId],statusKeys:[issuer.keyId],
      audiences:["host:t3"],resources:[ws],actions:["object.write"],
      purposes:["purpose:work"],roles:["role:member"],
      rightClasses:["ACTION"],membershipEpoch:1,
      maxTtlSeconds:3600,maxDelegationDepth:0,
    };
    const personalGrant={
      kind:"GRANT",id:"grant:personal",lineageId:"lineage:personal",
      renewalOf:null,parentGrantId:null,authorityId:"issuer:personal",
      principalId:actor,holderId:actor,roleId:"role:member",
      rightClass:"ACTION",realmId:policy.realmId,environment:"TEST",
      audience:"host:t3",resources:[ws],actions:["object.write"],
      purposes:["purpose:work"],issuedAt:iso(NOW-30000),
      notBefore:iso(NOW-20000),expiresAt:iso(NOW+600000),
      remainingDepth:0,membershipEpoch:1,
      policyId:policy.id,policyVersion:policy.version,
      evidenceRefs:["evidence:personal-issuer"],
    };
    const personalStatus={
      kind:"STATUS",id:"status:personal",environment:"TEST",
      realmId:policy.realmId,authorityId:"issuer:personal",sequence:1,
      membershipEpoch:1,issuedAt:iso(NOW-2000),validUntil:iso(NOW+600000),
      entries:[{grantId:personalGrant.id,state:"ACTIVE",
        effectiveAt:iso(NOW-2500),evidenceRef:"evidence:active-personal"}],
    };
    fixture.state.grants[personalGrant.id]=signRecord(personalGrant,issuer);
    fixture.state.statuses["issuer:personal"]=signRecord(personalStatus,issuer);
    fixture.state.statusFloor["issuer:personal"]=1;
    assert.equal(fixture.state.policy,policy);
    const {createWindowsOriginalVaultCustody}=await import(
      "../src/t3/access/windows-original-vault-custody.mjs");
    const custody=createWindowsOriginalVaultCustody({vaultPath});
    await custody.provision(vault);
    assert.equal(readFileSync(vaultPath,"utf8").includes("PRIVATE KEY"),false);

    const personalContext={
      kind:"PERSONAL",context_id:"context:personal",actor_id:actor,
      principal_id:actor,role_id:"role:member",
      grant_id:personalGrant.id,realm_id:policy.realmId,
      audience:"host:t3",resource:ws,purpose:"purpose:work",
      workspace_id:ws,organization_id:null,scope_revision:1,
    };
    const choices=[
      {selectionId:"personal",label:"Личный контур",context:personalContext},
      {selectionId:"north",label:"North",
        context:fixture.all.north.context},
      {selectionId:"south",label:"South",
        context:fixture.all.south.context},
    ];
    const originalInputFor=async context=>{
      const entry=Object.values(fixture.all).find(row=>
        row.context.organization_id===context.organization_id);
      assert.ok(entry,"NO_UNVERIFIED_ORGANIZATION_FALLBACK");
      return {profile:entry.profile,selection:entry.selection,
        descriptors:entry.descriptors,credential:entry.issuedCredential,
        enrollment:entry.enrollment};
    };
    let owner=null;
    const newSession=()=>createT3InstalledSubjectSession({
      readCandidates:async()=>structuredClone(choices),
      validateSelection:async context=>{
        try{
          const state=await owner.registry.readState();
          const authority=context.kind==="PERSONAL"
            ?"issuer:personal":
            "issuer:"+context.organization_id.slice("org:".length);
          const grant=verifiedChain(context.grant_id,state,NOW).at(-1);
          const status=validateStatusSnapshot(authority,state,NOW);
          if(grant.principalId!==context.principal_id||
             !grant.resources.includes(context.workspace_id)||
             !status.entries.some(e=>e.grantId===context.grant_id&&
               e.state==="ACTIVE"))return false;
          if(context.kind==="PERSONAL")return true;
          const issuerInput=await originalInputFor(context);
          const gate=createOrganizationalOperationGate({registry:owner.registry});
          const preview=await gate.preview({
            ...issuerInput,
            operation:{
              operationId:"native:explicit-select",productId:"IWXA_CONTROL_CENTER",
              audience:context.audience,resource:context.workspace_id,
              action:"object.write",purpose:context.purpose,
              payloadDigest:digest({contextId:context.context_id}),
            },asOf:iso(NOW),
          });
          return preview.organizationId===context.organization_id&&
            preview.workspaceId===context.workspace_id;
        }catch{return false;}
      },
    });
    const build=()=>createT3InstalledWindowsSignedControlOwner({
      registryKernel:kernel.api,registryWorkspaceId:"ws:host-registry",
      trustedPolicy:policy,vaultPath,subjectSession:session,
      personalCredentialKeyId:personalCredential.keyId,
      actionFor:operation=>{
        if(operation!=="t1.putObject")throw Error("ORIGINAL_OPERATION_REQUIRED");
        return "object.write";
      },
      operationDigest:({operation,input,context})=>
        digest({operation,input,context}),
      organizationInputFor:originalInputFor,clock:time,
    });
    session=newSession();owner=build();
    assert.equal(await owner.ownerFor({scope:"kernel",operation:"putObject"}),null);
    assert.deepEqual((await owner.availableContexts()).map(x=>x.selectionId),
      ["personal","north","south"]);
    assert.deepEqual(Object.keys(await owner.credentialInventory()).sort(),[
      "key:cred-north","key:cred-personal","key:cred-south",
    ]);
    assert.equal((await owner.registry.commitSignedState(fixture.state)).revision,1);
    let invalidations=0;
    const off=owner.subscribeInvalidation(()=>{invalidations++;});
    const selectedPersonal=await owner.selectContext({
      selectionId:"personal",userConfirmed:true,
    });
    assert.equal(selectedPersonal.contextEpoch,2);
    const personalPort=await owner.ownerFor({scope:"kernel",operation:"putObject"});
    const personalBinding=createSubjectKernelBinding({
      kernel:kernel.api,access:personalPort,clock:time,
    });
    const personalCommand={...command("north"),
      workspace_id:ws,object_id:"item:personal",
      data:{title:"Signed personal original Kernel receipt"}};
    const personalReceipt=await personalBinding.putObject(personalCommand);
    assert.equal(personalReceipt.object.workspace_id,ws);
    await assert.rejects(personalBinding.putObject(command("north")),
      {code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});

    await owner.selectContext({selectionId:"north",userConfirmed:true});
    await assert.rejects(personalBinding.putObject({
      ...personalCommand,object_id:"item:personal-stale",
    }),{code:"T3_D1_INSTALLED_HOST_SUBJECT_SESSION_STALE_OWNER"});
    const northPort=await owner.ownerFor({scope:"kernel",operation:"putObject"});
    const northBinding=createSubjectKernelBinding({
      kernel:kernel.api,access:northPort,clock:time,
    });
    assert.equal((await northBinding.putObject(command("north")))
      .object.workspace_id,"ws:north");
    await owner.selectContext({selectionId:"south",userConfirmed:true});
    await assert.rejects(northBinding.putObject({
      ...command("north"),object_id:"item:north-stale",
    }),{code:"T3_D1_INSTALLED_HOST_SUBJECT_SESSION_STALE_OWNER"});
    const southPort=await owner.ownerFor({scope:"kernel",operation:"putObject"});
    const southBinding=createSubjectKernelBinding({
      kernel:kernel.api,access:southPort,clock:time,
    });
    assert.equal((await southBinding.putObject(command("south")))
      .object.workspace_id,"ws:south");

    // Signed, immutable STATUS sequence advances in the ORIGINAL Kernel.
    const revoked={...fixture.all.north.status,sequence:2,
      issuedAt:iso(NOW-1000),entries:[{
        grantId:"grant:north",state:"REVOKED",
        effectiveAt:iso(NOW-1500),evidenceRef:"evidence:north-revoked",
      }]};
    const state2=structuredClone(fixture.state);
    state2.statuses["issuer:north"]=signRecord(
      revoked,fixture.all.north.issuerSigner);
    state2.statusFloor["issuer:north"]=2;
    assert.equal((await owner.registry.commitSignedState(state2)).revision,2);
    owner.invalidateSignedState();
    assert.equal(await owner.ownerFor({scope:"kernel",operation:"putObject"}),null);
    await assert.rejects(owner.selectContext({
      selectionId:"north",userConfirmed:true,
    }),{code:"T3_D1_INSTALLED_HOST_SUBJECT_SESSION_SELECTION_NOT_VERIFIED"});
    assert.equal(await kernel.api.getObject("ws:north","item:north-stale"),null);
    assert.equal(invalidations,4);
    off();
    session.close();

    // Cold Node owner reconstruction: no silent PERSONAL/CORP fallback.
    // The underlying Kernel/Store and original DPAPI vault remain untouched.
    session=newSession();owner=build();
    assert.equal(owner.currentEpoch(),1);
    assert.equal(await owner.ownerFor({scope:"kernel",operation:"putObject"}),null);
    await assert.rejects(owner.selectContext({
      selectionId:"north",userConfirmed:true,
    }),{code:"T3_D1_INSTALLED_HOST_SUBJECT_SESSION_SELECTION_NOT_VERIFIED"});
    await owner.selectContext({selectionId:"south",userConfirmed:true});
    const reloadedSouth=createSubjectKernelBinding({
      kernel:kernel.api,clock:time,
      access:await owner.ownerFor({scope:"kernel",operation:"putObject"}),
    });
    assert.equal((await reloadedSouth.putObject({
      ...command("south"),object_id:"item:south-after-reopen",
    })).object.revision,1);
    await owner.selectContext({selectionId:"personal",userConfirmed:true});
    const reloadedPersonal=createSubjectKernelBinding({
      kernel:kernel.api,clock:time,
      access:await owner.ownerFor({scope:"kernel",operation:"putObject"}),
    });
    assert.equal((await reloadedPersonal.putObject({
      ...personalCommand,object_id:"item:personal-after-reopen",
    })).object.revision,1);
    assert.equal((await owner.registry.getStatus()).sequences["issuer:north"],2);
    assert.equal((await owner.registry.getStatus()).sequences["issuer:south"],1);
    assert.equal((await owner.registry.getStatus()).sequences["issuer:personal"],1);
    assert.equal(readFileSync(vaultPath,"utf8").includes("PRIVATE KEY"),false);
    console.log("T3_D1_WINDOWS_THREE_SUBJECTS_ONE_ORIGINAL_REGISTRY_PASS",
      JSON.stringify({selected:["PERSONAL","North","South"],
        originalKernelFacade:true,oneOriginalSignedRegistry:true,
        windowsDpapiOriginalVault:true,threeIndependentCredentials:true,
        nativeContextSelectionConfirmed:true,
        staleOwnerRefused:true,revokedNorthDenied:true,
        southAfterColdOwner:true,personalAfterColdOwner:true,
        installedGuiAccepted:false,realProductionIssuer:false,
        realKernelBrowserInSameTest:false}));
  }finally{
    session?.close();
    rmSync(root,{recursive:true,force:true});
  }
});
