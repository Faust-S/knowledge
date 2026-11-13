// Real in-memory Ed25519 authority for product E2E tests, NOT an IAM
// implementation or installed issuer. Uses the ORIGINAL T3 Access evaluator
// now owned by knowledge and keeps ephemeral private keys on the Node host.
import {generateKeyPairSync} from "node:crypto";
import {PROFILE,signRecord,keyObjectSigner,digest}
  from "../../src/t3/access/core.mjs";
import {emptyVault,generateVaultKey,encryptVault}
  from "../../src/t3/access/local-vault.mjs";
import {createOriginalVaultProofSigner}
  from "../../src/t3/access/original-vault-proof.mjs";
import {createOriginalPersonalAccessCheck}
  from "../../src/t3/access/original-personal-evaluator.mjs";
import {createSignedAccessHostPort}
  from "../../src/t3/signed-access-host-port.mjs";

const iso=value=>new Date(value).toISOString();
const PERSONAL_ACTIONS=Object.freeze({
  "t1.getWorkspace":"workspace.read",
  "t1.createWorkspace":"workspace.create",
  "t1.getObject":"object.read",
  "t1.listObjects":"object.read",
  "t1.listEventsSince":"event.read",
  "t1.putObject":"object.write",
  // D4: permissions for the ORIGINAL T2 recipient Exchange operations.
  // Only the test issuer grants these; no runtime IAM or new importer.
  "t2.importPreview":"package.import.preview",
  "t2.importCommit":"package.import.commit",
});
function createSigner(name,subject,uses,now){
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  return {provider:keyObjectSigner("key:"+name,privateKey),
    policyKey:{
      subjectId:subject,environment:"TEST",
      publicKey:publicKey.export({type:"spki",format:"pem"}).toString(),
      status:"ACTIVE",uses,notBefore:iso(now-600000),
      expiresAt:iso(now+86400000),
    },
  };
}
export function createTemporaryOriginalPersonalAuthority({
  workspaceId,now=Date.now(),readSignedState=null,clock=()=>now,
  operations=["t1.putObject"],
}={}){
  if(typeof workspaceId!=="string"||workspaceId.length<6||
     !Number.isSafeInteger(now)||typeof clock!=="function"||
     (readSignedState!==null&&typeof readSignedState!=="function")||
     !Array.isArray(operations)||operations.length===0||
     operations.some(op=>!Object.hasOwn(PERSONAL_ACTIONS,op))||
     new Set(operations).size!==operations.length)
    throw Error("D1_REAL_PERSONAL_TEST_INPUT_REQUIRED");
  const permitted=new Set(operations);
  const actions=[...new Set(operations.map(op=>PERSONAL_ACTIONS[op]))];
  const catalog=Object.fromEntries(actions.map(action=>[action,"ACTION"]));
  const issuer=createSigner("issuer","issuer:local",["GRANT"],now);
  const status=createSigner("status","issuer:local",["STATUS"],now);
  const actorVault=emptyVault();
  const actorKey=generateVaultKey(actorVault,{
    keyId:"key:actor",subjectId:"person:local",createdAt:iso(now-30000),
  });
  // CI-only secret, never a runtime default. Product Host supplies its own
  // authorized unlock callback and stores only the ciphertext at rest.
  const testPassphrase="CI_TEST_ONLY_NOT_A_PRODUCTION_VAULT_PASSWORD";
  const encryptedActorVault=encryptVault(actorVault,testPassphrase);
  const actor={policyKey:{
    subjectId:"person:local",environment:"TEST",
    publicKey:actorKey.publicKeyPem,status:"ACTIVE",uses:["PROOF"],
    notBefore:iso(now-600000),expiresAt:iso(now+86400000),
  }};
  const vaultProof=createOriginalVaultProofSigner({
    keyId:"key:actor",
    readEncryptedVault:async()=>JSON.stringify(encryptedActorVault),
    unlockPassphrase:async()=>testPassphrase,
  });
  const selected=Object.freeze({
    kind:"PERSONAL",context_id:"context:personal",actor_id:"person:local",
    principal_id:"person:local",role_id:"role:member",
    grant_id:"grant:personal",realm_id:"realm:personal",audience:"host:t3",
    resource:workspaceId,purpose:"purpose:work",workspace_id:workspaceId,
    organization_id:null,scope_revision:1,
  });
  const policy={
    schema:PROFILE,id:"policy:personal",version:"v1",
    realmId:"realm:personal",environment:"TEST",
    statusMode:"OFFLINE_BOUNDED",timeAssurance:"LOCAL_BEST_EFFORT",
    proofMaxAgeSeconds:60,snapshotMaxAgeSeconds:3600,
    offlineMaxAgeSeconds:3600,
    keys:{"key:issuer":issuer.policyKey,"key:status":status.policyKey,
      "key:actor":actor.policyKey},
    authorities:{"authority:personal":{
      principalId:"person:local",issuerKeys:["key:issuer"],
      statusKeys:["key:status"],audiences:["host:t3"],
      resources:[workspaceId],actions,
      purposes:["purpose:work"],roles:["role:member"],
      rightClasses:["ACTION"],membershipEpoch:1,
      maxTtlSeconds:3600,maxDelegationDepth:0,
    }},
    actionCatalog:catalog,
    prohibitions:[],confirmations:[],
  };
  const grant={
    kind:"GRANT",id:"grant:personal",lineageId:"lineage:personal",
    renewalOf:null,parentGrantId:null,authorityId:"authority:personal",
    principalId:"person:local",holderId:"person:local",
    roleId:"role:member",rightClass:"ACTION",
    realmId:"realm:personal",environment:"TEST",audience:"host:t3",
    resources:[workspaceId],actions,purposes:["purpose:work"],
    issuedAt:iso(now-30000),notBefore:iso(now-20000),
    expiresAt:iso(now+1200000),remainingDepth:0,membershipEpoch:1,
    policyId:"policy:personal",policyVersion:"v1",
    evidenceRefs:["evidence:issuer"],
  };
  const statusBase={
    kind:"STATUS",id:"status:personal",environment:"TEST",
    realmId:"realm:personal",authorityId:"authority:personal",
    sequence:1,membershipEpoch:1,issuedAt:iso(now-2000),
    validUntil:iso(now+600000),
    entries:[{grantId:"grant:personal",state:"ACTIVE",
      effectiveAt:iso(now-2500),evidenceRef:"evidence:active"}],
  };
  const state={
    policy,grants:{"grant:personal":signRecord(grant,issuer.provider)},
    statuses:{"authority:personal":signRecord(statusBase,status.provider)},
    statusFloor:{"authority:personal":1},tombstones:{},
  };
  let proofCount=0,registryReads=0;
  const access=createSignedAccessHostPort({
    currentContext:()=>selected,
    actionFor:operation=>{
      if(!permitted.has(operation))throw Error("D1_OPERATION_DENIED");
      return PERSONAL_ACTIONS[operation];
    },
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    canonicalDigest:digest,
    personal:{check:createOriginalPersonalAccessCheck({
      clock,
      readState:async()=>{registryReads++;return readSignedState
        ?readSignedState():state;},
      signProof:async(input)=>{
        proofCount++;
        return vaultProof(input);
      },
    })},
    clock,
  });
  return Object.freeze({
    access,
    get proofCount(){return proofCount;},
    get registryReads(){return registryReads;},
    snapshotSignedState(){return structuredClone(state);},
    revoke(){
      const withdrawn={
        ...statusBase,sequence:2,issuedAt:iso(now-1000),
        entries:[{grantId:"grant:personal",state:"REVOKED",
          effectiveAt:iso(now-1200),evidenceRef:"evidence:revoked"}],
      };
      state.statuses["authority:personal"]=signRecord(withdrawn,status.provider);
      state.statusFloor["authority:personal"]=2;
    },
  });
}
