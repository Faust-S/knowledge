import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {keyObjectSigner,signRecord,verifyRecord} from
  "../src/t3/access/core.mjs";
import {strictJson} from "../src/t3/access/strict-json.mjs";
import {createOriginalVaultProofSigner,createOriginalVaultProofSession}
  from "../src/t3/access/original-vault-proof.mjs";
import {emptyVault,generateVaultKey,encryptVault,decryptVault,decryptVaultAsync,
  vaultPublicInventory,vaultPrivateKey}
  from "../src/t3/access/local-vault.mjs";

const now=Date.parse("2026-11-13T12:00:00.000Z");
const iso=n=>new Date(n).toISOString();
const passphrase="TEST_ONLY_NEVER_PRODUCTION_LOCAL_PASSPHRASE";
test("local original Ed25519 vault survives disk reload and signs verifiable proof",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t3-real-access-vault-"));
  try{
    const vault=emptyVault();
    generateVaultKey(vault,{keyId:"key:personal",subjectId:"person:local",
      createdAt:iso(now-20000)});
    const publicInventory=vaultPublicInventory(vault);
    const envelope=encryptVault(vault,passphrase);
    const path=join(root,"owner-keys.encrypted.json");
    writeFileSync(path,JSON.stringify(envelope));
    const diskBytes=readFileSync(path,"utf8");
    assert.equal(diskBytes.includes("BEGIN PRIVATE KEY"),false);
    assert.equal(diskBytes.includes("privateKeyPem"),false);
    const recovered=decryptVault(strictJson(diskBytes),passphrase);
    assert.deepEqual(vaultPublicInventory(recovered),publicInventory);
    const signer=keyObjectSigner("key:personal",
      vaultPrivateKey(recovered,"key:personal"));
    const signed=signRecord({
      kind:"PROOF",environment:"TEST",requestDigest:"0".repeat(64),
      challenge:"random-challenge"+String(now),
      issuedAt:iso(now),expiresAt:iso(now+60000),
    },signer);
    const keyRecord={
      subjectId:"person:local",environment:"TEST",status:"ACTIVE",
      uses:["PROOF"],publicKey:publicInventory["key:personal"].publicKeyPem,
      notBefore:iso(now-20000),expiresAt:iso(now+86400000),
    };
    const verified=verifyRecord(signed,{
      environment:"TEST",keys:{"key:personal":keyRecord},
    },now,"PROOF");
    assert.equal(verified.subjectId,"person:local");
    assert.equal(signed.keyId,"key:personal");
    const signFromDisk=createOriginalVaultProofSigner({
      keyId:"key:personal",
      readEncryptedVault:async()=>readFileSync(path,"utf8"),
      unlockPassphrase:async()=>passphrase,
    });
    const actorRequest={actorId:"person:local",principalId:"person:local"};
    const selected={kind:"PERSONAL",actor_id:"person:local",organization_id:null};
    const recoveredProof=await signFromDisk({
      request:actorRequest,context:selected,
      challenge:"unique-local-challenge-"+String(now),asOf:iso(now),
    });
    assert.equal(verifyRecord(recoveredProof,{
      environment:"TEST",keys:{"key:personal":keyRecord},
    },now,"PROOF").subjectId,"person:local");
    await assert.rejects(signFromDisk({
      request:{...actorRequest,actorId:"person:other"},context:selected,
      challenge:"unique-local-challenge-"+String(now),asOf:iso(now),
    }),{code:"T3_ACCESS_VAULT_SUBJECT_MISMATCH"});

  }finally{rmSync(root,{recursive:true,force:true});}
});
test("same original encrypted vault signs two separately pinned organization credentials after disk reopen",async()=>{
  const root=mkdtempSync(join(tmpdir(),"t3-two-corp-vault-"));
  try{
    const vault=emptyVault();
    const a=generateVaultKey(vault,{keyId:"key:corporate-a",
      subjectId:"person:operator",createdAt:iso(now-20000)});
    const b=generateVaultKey(vault,{keyId:"key:corporate-b",
      subjectId:"person:operator",createdAt:iso(now-20000)});
    const path=join(root,"credentials.encrypted.json");
    writeFileSync(path,JSON.stringify(encryptVault(vault,passphrase)));
    const disk=readFileSync(path,"utf8");
    assert.ok(!disk.includes("BEGIN PRIVATE KEY")&&
      !disk.includes("privateKeyPem"));
    const owner=(org,keyId)=>createOriginalVaultProofSigner({
      organizationId:org,keyId,
      readEncryptedVault:async()=>readFileSync(path,"utf8"),
      unlockPassphrase:async()=>passphrase,
    });
    const selected=org=>({
      kind:"CORP",actor_id:"person:operator",
      principal_id:org,organization_id:org,
      role_id:"role:member",grant_id:"grant:"+org,
      realm_id:"realm:local",audience:"host:t3",
      workspace_id:"ws:"+org,resource:"ws:"+org,
      purpose:"purpose:work",
    });
    const request=context=>({
      id:"op:"+context.organization_id,
      actorId:context.actor_id,principalId:context.principal_id,
      roleId:context.role_id,grantId:context.grant_id,
      realmId:context.realm_id,audience:context.audience,
      resource:context.workspace_id,purpose:context.purpose,
      action:"object.write",operationDigest:"0".repeat(64),
    });
    const contextA=selected("org:alpha"),contextB=selected("org:beta");
    const signerA=owner("org:alpha","key:corporate-a");
    const signerB=owner("org:beta","key:corporate-b");
    const ch="corporate-challenge-"+String(now);
    const args=(context,credentialKeyId)=>({
      request:request(context),context,challenge:ch,asOf:iso(now),
      credentialKeyId,
    });
    const proofA=await signerA(args(contextA,"key:corporate-a"));
    // Create a new closure, as an installed trusted Host does on reopen.
    const proofB=await owner("org:beta","key:corporate-b")(
      args(contextB,"key:corporate-b"));
    const policy={environment:"TEST",keys:{}};
    for(const [keyId,pub] of [["key:corporate-a",a],["key:corporate-b",b]])
      policy.keys[keyId]={
        subjectId:"person:operator",environment:"TEST",
        status:"ACTIVE",uses:["PROOF"],publicKey:pub.publicKeyPem,
        notBefore:iso(now-20000),expiresAt:iso(now+86400000),
      };
    assert.equal(verifyRecord(proofA,policy,now,"PROOF").subjectId,
      "person:operator");
    assert.equal(verifyRecord(proofB,policy,now,"PROOF").subjectId,
      "person:operator");
    assert.equal(proofA.keyId,"key:corporate-a");
    assert.equal(proofB.keyId,"key:corporate-b");
    await assert.rejects(signerA(args(contextB,"key:corporate-a")),
      {code:"T3_ACCESS_VAULT_ORGANIZATION_MISMATCH"});
    await assert.rejects(signerA(args(contextA,"key:corporate-b")),
      {code:"T3_ACCESS_VAULT_CREDENTIAL_MISMATCH"});
    await assert.rejects(signerA({...args(contextA,"key:corporate-a"),
      request:{...request(contextA),resource:"ws:org:beta"}}),
      {code:"T3_ACCESS_VAULT_ORGANIZATION_MISMATCH"});
    await assert.rejects(signerA({...args(contextA,"key:corporate-a"),
      context:{...contextA,grant_id:"grant:swapped"}}),
      {code:"T3_ACCESS_VAULT_ORGANIZATION_MISMATCH"});
    await assert.rejects(signerA({...args(contextA,"key:corporate-a"),
      request:{...request(contextA),actorId:"person:intruder"}}),
      {code:"T3_ACCESS_VAULT_SUBJECT_MISMATCH"});
    await assert.rejects(signerB({...args(contextB,"key:corporate-b"),
      context:{...contextB,kind:"PERSONAL",organization_id:null}}),
      {code:"T3_ACCESS_VAULT_ORGANIZATION_MISMATCH"});
    const wrongPass= createOriginalVaultProofSigner({
      organizationId:"org:alpha",keyId:"key:corporate-a",
      readEncryptedVault:async()=>readFileSync(path,"utf8"),
      unlockPassphrase:async()=>passphrase+"-incorrect",
    });
    await assert.rejects(wrongPass(args(contextA,"key:corporate-a")),
      {code:"VAULT_UNLOCK_FAILED"});
    console.log("T3_D1_TWO_CORP_EXISTING_ENCRYPTED_VAULT_PASS",
      JSON.stringify({distinctCorporateKeys:2,verifiedEd25519Proofs:2,
        wrongOrgDenied:true,wrongCredentialDenied:true,
        swappedContextDenied:true,wrongVaultPassphraseDenied:true,
        noPlaintextOnDisk:true,nativeOsCustodyAccepted:false}));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("wrong passphrase and altered ciphertext deny private-key recovery",()=>{
  const vault=emptyVault();
  generateVaultKey(vault,{keyId:"key:personal",subjectId:"person:local"});
  const encrypted=encryptVault(vault,passphrase);
  assert.throws(()=>decryptVault(encrypted,passphrase+"wrong"),
    {code:"VAULT_UNLOCK_FAILED"});
  const invalid=structuredClone(encrypted);
  invalid.ciphertext=(invalid.ciphertext[0]==="A"?"B":"A")+
    invalid.ciphertext.slice(1);
  assert.throws(()=>decryptVault(invalid,passphrase),
    {code:"VAULT_UNLOCK_FAILED"});
});
test("vault rejects ambiguous duplicate-key JSON before any signing",()=>{
  assert.throws(()=>strictJson('{"keys":{},"keys":{"untrusted":true}}'),
    /JSON_DUPLICATE_KEY/);
});
test("vault cannot silently overwrite an existing local signing identity",()=>{
  const vault=emptyVault();
  generateVaultKey(vault,{keyId:"key:owner",subjectId:"person:owner"});
  assert.throws(()=>generateVaultKey(vault,{keyId:"key:owner",
    subjectId:"person:owner"}),{code:"KEY_ALREADY_EXISTS"});
});


test("K96 original encrypted Vault unlock leaves the original Host event loop responsive and authenticates the exact envelope",async()=>{
  const vault=emptyVault();
  generateVaultKey(vault,{keyId:"key:personal",subjectId:"person:local"});
  generateVaultKey(vault,{keyId:"key:agreement",subjectId:"person:local",algorithm:"X25519"});
  const record=encryptVault(vault,passphrase),original=structuredClone(record);
  let progressed=false;
  const turn=new Promise(resolve=>setImmediate(()=>{progressed=true;resolve();}));
  const opening=decryptVaultAsync(record,passphrase).then(v=>{
    assert.equal(progressed,true);return v;
  });
  // The original envelope is pinned before the async scrypt dispatch.
  record.ciphertext="invalid";record.cipher.aad="changed";
  await turn;
  assert.deepEqual(await opening,vault);
  assert.deepEqual(decryptVault(original,passphrase),vault);
  await assert.rejects(decryptVaultAsync(original,passphrase+"wrong"),{code:"VAULT_UNLOCK_FAILED"});
  await assert.rejects(decryptVaultAsync({...original,kdf:{...original.kdf,N:16384}},passphrase),{code:"VAULT_KDF_INVALID"});
});


function scopedProofFixture(){
  const vault=emptyVault();
  const key=generateVaultKey(vault,{keyId:"key:personal",subjectId:"person:local"});
  const envelope=encryptVault(vault,passphrase);
  const context={kind:"PERSONAL",context_id:"context:local",actor_id:"person:local",
    principal_id:"person:local",organization_id:null,workspace_id:"ws:original",resource:"ws:original",
    role_id:"role:member",grant_id:"grant:original",realm_id:"realm:local",audience:"host:t3",
    purpose:"purpose:work",scope_revision:1};
  const request={id:"op:original",actorId:context.actor_id,principalId:context.principal_id,
    roleId:context.role_id,grantId:context.grant_id,realmId:context.realm_id,audience:context.audience,
    resource:context.resource,purpose:context.purpose,action:"object.read",operationDigest:"0".repeat(64)};
  const policy={environment:"TEST",keys:{"key:personal":{subjectId:"person:local",environment:"TEST",
    status:"ACTIVE",uses:["PROOF"],publicKey:key.publicKeyPem,notBefore:iso(now-2000),expiresAt:iso(now+86400000)}}};
  let current=now,hostActive=true,allowed=true,unlocks=0,reads=0,record=envelope,readHook=null;
  const session=createOriginalVaultProofSession({keyId:"key:personal",context,lifetimeMs:300000,
    clock:()=>current,isOriginalHostActive:()=>hostActive,authorizeOriginalVaultUse:()=>allowed,
    readEncryptedVault:async()=>{reads++;const value=structuredClone(record);await readHook?.(reads);return value;},
    unlockPassphrase:async()=>{unlocks++;return passphrase;}});
  return {session,context,request,policy,proof:(extra={})=>session.signProof({request,context,
    challenge:"scope-proof-challenge-"+reads,asOf:iso(current),...extra}),
    replace:()=>{record={...envelope,ciphertext:envelope.ciphertext+"A"};},
    deactivate:()=>{hostActive=false;},deny:()=>{allowed=false;},advance:ms=>{current+=ms;},
    hook:fn=>{readHook=fn;},get reads(){return reads;},get unlocks(){return unlocks;}};
}

test("K98 explicit original Vault proof lifetime unlocks one encrypted key and keeps fresh proof and exact context checks",async()=>{
  const f=scopedProofFixture();
  await assert.rejects(f.proof(),{code:"T3_ACCESS_VAULT_SESSION_LOCKED"});
  // An attempt before explicit owner admission must not unlock the key.
  assert.equal(f.unlocks,0);
  const a=f;
  try{
    await a.session.unlock();assert.equal(a.unlocks,1);assert.equal(a.session.active,true);
    const p1=await a.proof(),p2=await a.proof({request:{...a.request,id:"op:second"}});
    assert.notEqual(p1.signature,p2.signature);
    for(const p of [p1,p2])assert.equal(verifyRecord(p,a.policy,now,"PROOF").subjectId,"person:local");
    assert.equal(a.unlocks,1);assert.equal(a.reads,6);
    await assert.rejects(a.proof({request:{...a.request,resource:"ws:other"}}),{code:"T3_ACCESS_VAULT_SESSION_CONTEXT_CHANGED"});
    assert.equal(a.session.active,false);
    await assert.rejects(a.session.unlock(),{code:"T3_ACCESS_VAULT_SESSION_LOCKED"});
  }finally{a.session.close();f.session.close();}
});

test("K98 explicit Vault session fails closed on changed envelope, revoked owner or expiry, including during proof",async()=>{
  for(const [mutate,code] of [[f=>f.replace(),"T3_ACCESS_VAULT_SESSION_ENVELOPE_CHANGED"],
    [f=>f.deactivate(),"T3_ACCESS_VAULT_SESSION_DENIED"],
    [f=>f.deny(),"T3_ACCESS_VAULT_SESSION_DENIED"],
    [f=>f.advance(300000),"T3_ACCESS_VAULT_SESSION_EXPIRED"]]){
    const f=scopedProofFixture();
    try{await f.session.unlock();mutate(f);await assert.rejects(f.proof(),{code});
      assert.equal(f.session.active,false);assert.equal(f.unlocks,1);}
    finally{f.session.close();}
  }
  const f=scopedProofFixture();
  try{
    await f.session.unlock();f.hook(n=>{if(n===3)f.replace();});
    await assert.rejects(f.proof(),{code:"T3_ACCESS_VAULT_SESSION_ENVELOPE_CHANGED"});
    assert.equal(f.session.active,false);
  }finally{f.session.close();}
  const g=scopedProofFixture();
  try{
    await g.session.unlock();g.hook(n=>{if(n===4)g.session.close();});
    await assert.rejects(g.proof(),{code:"T3_ACCESS_VAULT_SESSION_LOCKED"});
    assert.equal(g.session.active,false);
  }finally{g.session.close();}
  const h=scopedProofFixture();
  try{
    h.hook(n=>{if(n===2)h.session.close();});
    await assert.rejects(h.session.unlock(),{code:"T3_ACCESS_VAULT_SESSION_LOCKED"});
    assert.equal(h.session.active,false);
    await assert.rejects(h.proof(),{code:"T3_ACCESS_VAULT_SESSION_LOCKED"});
  }finally{h.session.close();}
});
