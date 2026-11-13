// CI-only REAL Ed25519 issuer fixtures for two independent organizations.
// All production code remains in src/t3/access and original T2 Kernel.
// Never ship test keys, invented organization identities or a second Store.
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {PROFILE,iso,digest,signRecord,keyObjectSigner}
  from "../../src/t3/access/core.mjs";
import {PRODUCT_CONTRACT_IDS}
  from "../../src/t3/access/product-contracts.mjs";
import {signOrganizationEnrollment}
  from "../../src/t3/access/organizational-operation.mjs";
export const NOW=Date.now();
export const before=iso(NOW-20000),issued=iso(NOW-30000),
  until=iso(NOW+600000);export const time=()=>NOW;
const person="person:operator",realm="realm:iwxa",schema=(kind,data)=>({
  schema:PRODUCT_CONTRACT_IDS[kind],kind,...data,
});
function signer(keyId,subjectId,uses){
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  return {
    sign:keyObjectSigner(keyId,privateKey),
    // Public test fixture only: imported into the ORIGINAL encrypted vault
    // by the trusted Host. Never copied into compiled AppShell or dist.
    privateKeyPem:privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    record:{subjectId,environment:"TEST",
      publicKey:publicKey.export({type:"spki",format:"pem"}).toString(),
      status:"ACTIVE",uses,notBefore:iso(NOW-3600000),
      expiresAt:iso(NOW+86400000)}
  };
}
export function originalKernelFixture(){
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
// The default preserves existing write-only corporate qualifications.
// The compiled AppShell case explicitly grants normal Workspace/BLI actions.
// These test records cannot issue permissions outside the authentic evaluator.
const ACTIONS=Object.freeze({
  "t1.getWorkspace":"workspace.read",
  "t1.createWorkspace":"workspace.create",
  "t1.listObjects":"object.read",
  "t1.getObject":"object.read",
  "t1.listEventsSince":"event.read",
  "t1.putObject":"object.write",
});
export function model({operations=["t1.putObject"]}={}){
  assert.ok(Array.isArray(operations)&&operations.length>0&&
    operations.every(op=>Object.hasOwn(ACTIONS,op))&&
    new Set(operations).size===operations.length);
  const actions=[...new Set(operations.map(op=>ACTIONS[op]))];
  const catalog=Object.fromEntries(actions.map(action=>[action,"ACTION"]));
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
      audiences:["host:t3"],resources:[ws],actions,
      purposes:["purpose:work"],roles:["role:member"],
      rightClasses:["ACTION"],membershipEpoch:1,
      maxTtlSeconds:3600,maxDelegationDepth:0,
    };
    const grant={
      kind:"GRANT",id:"grant:"+short,lineageId:"lineage:"+short,
      renewalOf:null,parentGrantId:null,authorityId:authority,
      principalId:org,holderId:person,roleId:"role:member",
      rightClass:"ACTION",realmId:realm,environment:"TEST",
      audience:"host:t3",resources:[ws],actions,
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
      resources:[ws],actions,purposes:["purpose:work"],
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
      enrollment,credentialSigner:credential.sign,
      credentialPrivateKeyPem:credential.privateKeyPem,
      status,issuerSigner:issuer.sign};
  }
  const policy={
    schema:PROFILE,id:"policy:two-org",version:"v1",
    realmId:realm,environment:"TEST",statusMode:"OFFLINE_BOUNDED",
    timeAssurance:"LOCAL_BEST_EFFORT",proofMaxAgeSeconds:60,
    snapshotMaxAgeSeconds:3600,offlineMaxAgeSeconds:3600,
    keys:policyKeys,authorities,actionCatalog:catalog,
    prohibitions:[],confirmations:[],
  };
  return {all,policy,state:{policy,grants,statuses,statusFloor:floors,
    tombstones:{}},signers};
}
export const command=short=>({
  workspace_id:"ws:"+short,object_id:"item:"+short,
  schema_id:"iwxa.demo.note",schema_version:"1.0.0",
  base_revision:0,data:{title:"Signed business case "+short},
  extensions:{},event:{event_type:"t3.d1.corp.signed",payload:{org:short}},
});

