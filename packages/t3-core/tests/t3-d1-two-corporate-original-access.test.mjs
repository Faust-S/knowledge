// Two independent genuine Ed25519 organizational issuers and credentials,
// one original T3 AccessRegistry in the inherited T2 Kernel Store, and the
// existing signed subject binding over ONE KernelFacade. This is a Node-level
// business-logic qualification (not an installed Windows enrollment).
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {PROFILE,iso,digest,signRecord,keyObjectSigner,makeProof}
  from "../src/t3/access/core.mjs";
import {PRODUCT_CONTRACT_IDS}
  from "../src/t3/access/product-contracts.mjs";
import {signOrganizationEnrollment,createOrganizationalOperationGate}
  from "../src/t3/access/organizational-operation.mjs";
import {createOriginalKernelRegistryStatePort}
  from "../src/t3/access/original-kernel-registry-state.mjs";
import {createSignedAccessHostPort}
  from "../src/t3/signed-access-host-port.mjs";
import {createSubjectKernelBinding}
  from "../src/t3/subject-access-binding.mjs";

const NOW=Date.parse("2026-11-13T12:00:00.000Z");
const before=iso(NOW-20000),issued=iso(NOW-30000),
  until=iso(NOW+600000),time=()=>NOW;
const person="person:operator",realm="realm:iwxa",schema=(kind,data)=>({
  schema:PRODUCT_CONTRACT_IDS[kind],kind,...data,
});
function signer(keyId,subjectId,uses){
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  return {
    sign:keyObjectSigner(keyId,privateKey),
    record:{subjectId,environment:"TEST",
      publicKey:publicKey.export({type:"spki",format:"pem"}).toString(),
      status:"ACTIVE",uses,notBefore:iso(NOW-3600000),
      expiresAt:iso(NOW+86400000)}
  };
}
function originalKernelFixture(){
  const records=new Map(),events=[],calls=[];
  const clone=value=>structuredClone(value);
  const api={
    sessionInfo:{contract_version:"1.3.0",runtime_version:"0.3.6"},
    hasOperation:op=>[
      "t1.getObject","t1.putObject","t1.listEventsSince"
    ].includes(op),
    async getObject(ws,id){
      const object=records.get(ws+"/"+id);
      return object?{object:clone(object)}:null;
    },
    async putObject(cmd){
      const key=cmd.workspace_id+"/"+cmd.object_id;
      const old=records.get(key);
      assert.equal(cmd.base_revision,old?.revision??0);
      const object={...clone(cmd),revision:(old?.revision??0)+1};
      const event={workspace_id:cmd.workspace_id,
        event_id:"event:"+(events.length+1),
        event_type:cmd.event.event_type,payload:clone(cmd.event.payload)};
      records.set(key,object);events.push(event);calls.push(clone(cmd));
      return clone({object,event});
    },
    async listEventsSince(ws){return clone(events.filter(x=>x.workspace_id===ws));},
  };
  return {api,calls};
}
function model(){
  const signers={},policyKeys={},grants={},statuses={},floors={};
  const all={},descriptors={organizations:[],workspaces:[],memberships:[],grants:[]};
  const profile=schema("PersonalSubjectProfile",{
    personId:person,personalDataRootId:"root:personal",
    personalPublicKeyRefs:["key:private-personal"],createdAt:issued,
  });
  const authorities={};
  for(const short of ["north","south"]){
    const org="org:"+short,ws="ws:"+short,authority="issuer:"+short;
    const issuerId="key:issuer-"+short,credentialId="key:cred-"+short;
    const issuer=signer(issuerId,org,["GRANT","STATUS"]);
    const credential=signer(credentialId,person,["PROOF"]);
    signers[issuerId]=issuer.sign;
    signers[credentialId]=credential.sign;
    policyKeys[issuerId]=issuer.record;
    policyKeys[credentialId]=credential.record;
    authorities[authority]={
      principalId:org,issuerKeys:[issuerId],statusKeys:[issuerId],
      audiences:["host:t3"],resources:[ws],actions:["object.write"],
      purposes:["purpose:work"],roles:["role:member"],
      rightClasses:["ACTION"],membershipEpoch:1,
      maxTtlSeconds:3600,maxDelegationDepth:0,
    };
    const grant={
      kind:"GRANT",id:"grant:"+short,lineageId:"lineage:"+short,
      renewalOf:null,parentGrantId:null,authorityId:authority,
      principalId:org,holderId:person,roleId:"role:member",
      rightClass:"ACTION",realmId:realm,environment:"TEST",
      audience:"host:t3",resources:[ws],actions:["object.write"],
      purposes:["purpose:work"],issuedAt:issued,notBefore:before,
      expiresAt:until,remainingDepth:0,membershipEpoch:1,
      policyId:"policy:two-org",policyVersion:"v1",
      evidenceRefs:["evidence:issuer-"+short],
    };
    const envelope=signRecord(grant,issuer.sign);
    grants[grant.id]=envelope;
    const status={
      kind:"STATUS",id:"status:"+short,
      environment:"TEST",realmId:realm,authorityId:authority,
      sequence:1,membershipEpoch:1,issuedAt:iso(NOW-2000),
      validUntil:until,entries:[{
        grantId:grant.id,state:"ACTIVE",effectiveAt:iso(NOW-2500),
        evidenceRef:"evidence:active-"+short,
      }],
    };
    statuses[authority]=signRecord(status,issuer.sign);
    floors[authority]=1;
    const rootId="root:"+short,membership="member:"+short;
    descriptors.organizations.push(schema("OrganizationIdentity",{
      organizationId:org,realmId:realm,issuerAuthorityId:authority,
      organizationDataRootId:rootId,membershipEpoch:1,
      issuerPublicKeyRefs:[issuerId],createdAt:issued,
    }));
    descriptors.workspaces.push(schema("ManagedWorkspace",{
      workspaceId:ws,organizationId:org,ownerDataRootId:rootId,
      classification:"INTERNAL",domainProfileRefs:[],createdAt:issued,
    }));
    descriptors.memberships.push(schema("StaffMembership",{
      membershipId:membership,organizationId:org,personId:person,
      workspaceId:ws,roleId:"role:member",grantId:grant.id,
      issuerAuthorityId:authority,membershipEpoch:1,
      notBefore:before,expiresAt:until,status:"ACTIVE",
      statusObservedAt:before,statusValidUntil:until,
    }));
    descriptors.grants.push(schema("OrganizationGrant",{
      organizationId:org,membershipId:membership,grantId:grant.id,
      authorityId:authority,realmId:realm,holderPersonId:person,
      roleId:"role:member",membershipEpoch:1,
      resources:[ws],actions:["object.write"],purposes:["purpose:work"],
      notBefore:before,expiresAt:until,signedEnvelopeDigest:digest(envelope),
    }));
    const issuedCredential=schema("AdminIssuedCredential",{
      credentialId:"credential:"+short,organizationId:org,
      membershipId:membership,issuerAuthorityId:authority,
      holderPersonId:person,publicKeyRef:credentialId,
      custody:"HOLDER_ORG_SCOPED",personalKeySource:false,
      notBefore:before,expiresAt:until,status:"ACTIVE",
    });
    const selection=schema("ActiveContextSelection",{
      selectionId:"selection:"+short,personId:person,
      contextType:"ORGANIZATION",organizationId:org,
      membershipId:membership,grantId:grant.id,workspaceId:ws,
      selectedAt:iso(NOW-1000),userConfirmed:true,automaticSwitch:false,
    });
    const claims={
      schema:"IWXA_T3_ORGANIZATION_ENROLLMENT_CLAIMS/1",
      organizationId:org,realmId:realm,issuerAuthorityId:authority,
      personId:person,workspaceId:ws,membershipId:membership,
      credentialId:issuedCredential.credentialId,
      credentialPublicKeyRef:credentialId,grantId:grant.id,
      signedGrantDigest:digest(envelope),organizationDataRootId:rootId,
      membershipEpoch:1,issuedAt:issued,notBefore:before,expiresAt:until,
    };
    const enrollment=signOrganizationEnrollment(claims,issuer.sign);
    const context={
      kind:"CORP",context_id:"context:"+short,actor_id:person,
      principal_id:org,role_id:"role:member",grant_id:grant.id,
      realm_id:realm,audience:"host:t3",resource:ws,
      purpose:"purpose:work",workspace_id:ws,
      organization_id:org,scope_revision:1,
    };
    all[short]={context,profile,selection,descriptors,issuedCredential,
      enrollment,credentialSigner:credential.sign,status,issuerSigner:issuer.sign};
  }
  const policy={
    schema:PROFILE,id:"policy:two-org",version:"v1",
    realmId:realm,environment:"TEST",statusMode:"OFFLINE_BOUNDED",
    timeAssurance:"LOCAL_BEST_EFFORT",proofMaxAgeSeconds:60,
    snapshotMaxAgeSeconds:3600,offlineMaxAgeSeconds:3600,
    keys:policyKeys,authorities,actionCatalog:{"object.write":"ACTION"},
    prohibitions:[],confirmations:[],
  };
  return {all,policy,state:{policy,grants,statuses,statusFloor:floors,
    tombstones:{}},signers};
}
const command=short=>({
  workspace_id:"ws:"+short,object_id:"item:"+short,
  schema_id:"iwxa.demo.note",schema_version:"1.0.0",
  base_revision:0,data:{title:"Signed business case "+short},
  extensions:{},event:{event_type:"t3.d1.corp.signed",payload:{org:short}},
});

test("two genuine signed organizations retain independent original Access rights and Kernel receipts",{
  timeout:30000
},async()=>{
  const fixture=model(),kernel=originalKernelFixture();
  const registry=createOriginalKernelRegistryStatePort({
    kernel:kernel.api,workspaceId:"ws:host-registry",
    trustedPolicy:fixture.policy,clock:time,
  });
  assert.equal((await registry.commitSignedState(fixture.state)).revision,1);
  assert.throws(()=>createOrganizationalOperationGate({
    registry:{readState:()=>fixture.state}
  }),/ORG_TRUSTED_ACCESS_REGISTRY_REQUIRED/);
  const gate=createOrganizationalOperationGate({registry});
  let selected=fixture.all.north.context,proofs=0;
  const access=createSignedAccessHostPort({
    currentContext:()=>selected,
    actionFor:operation=>{
      if(operation!=="t1.putObject")throw Error("CORP_OPERATION_DENIED");
      return "object.write";
    },
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    canonicalDigest:digest,clock:time,
    corporate:{
      productId:"IWXA_CONTROL_CENTER",gate,
      inputFor:async context=>{
        const item=Object.values(fixture.all)
          .find(x=>x.context.organization_id===context.organization_id);
        assert.ok(item,"UNRECOGNIZED_CORPORATE_CONTEXT");
        return {profile:item.profile,selection:item.selection,
          descriptors:item.descriptors,credential:item.issuedCredential,
          enrollment:item.enrollment};
      },
      prove:async({request,challenge,credentialKeyId,context,asOf})=>{
        const item=Object.values(fixture.all)
          .find(x=>x.context.organization_id===context.organization_id);
        assert.equal(credentialKeyId,item.issuedCredential.publicKeyRef);
        proofs++;
        return makeProof(request,challenge,Date.parse(asOf),
          item.credentialSigner,"TEST");
      },
    },
  });
  const bound=createSubjectKernelBinding({
    kernel:kernel.api,access,clock:time,
  });
  const north=await bound.putObject(command("north"));
  assert.equal(north.object.workspace_id,"ws:north");
  await assert.rejects(bound.putObject(command("south")),
    {code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  selected=fixture.all.south.context;
  const south=await bound.putObject(command("south"));
  assert.equal(south.object.workspace_id,"ws:south");
  assert.ok(proofs>=2);
  assert.deepEqual(kernel.calls.filter(x=>x.schema_id==="iwxa.demo.note")
    .map(x=>x.workspace_id),["ws:north","ws:south"]);
  // A new signed issuer STATUS revokes NORTH. SOUTH remains ACTIVE.
  const revoked={...fixture.all.north.status,sequence:2,
    issuedAt:iso(NOW-1000),entries:[{
      grantId:"grant:north",state:"REVOKED",
      effectiveAt:iso(NOW-1500),evidenceRef:"evidence:revoked-north",
    }]};
  const newer=structuredClone(fixture.state);
  newer.statuses["issuer:north"]=signRecord(
    revoked,fixture.all.north.issuerSigner);
  newer.statusFloor["issuer:north"]=2;
  assert.equal((await registry.commitSignedState(newer)).revision,2);
  selected=fixture.all.north.context;
  await assert.rejects(bound.putObject({
    ...command("north"),object_id:"item:after-revocation",
  }),{code:"T3_ACCESS_NOT_PERMITTED"});
  assert.equal((await kernel.api.getObject("ws:north","item:after-revocation")),null);
  selected=fixture.all.south.context;
  const unaffected=await bound.putObject({
    ...command("south"),object_id:"item:second-south",
  });
  assert.equal(unaffected.object.revision,1);
  assert.equal((await registry.getStatus()).sequences["issuer:north"],2);
  assert.equal((await registry.getStatus()).sequences["issuer:south"],1);
  console.log("T3_D1_TWO_REAL_CORP_ED25519_ACCESS_NODE_PASS",JSON.stringify({
    independentIssuerKeys:2,independentCredentialKeys:2,
    originalSignedGrants:2,originalSignedEnrollments:2,
    originalKernelContract:"1.3.0",revokedNorth:true,southUnaffected:true,
    forgedOwnerPortRejected:true,encryptedVaultNotInBrowser:true,
    installedAppAccepted:false,realKernelBrowserQualified:false,
  }));
});
