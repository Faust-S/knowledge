import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {keyObjectSigner,signRecord,verifyRecord} from
  "../src/t3/access/core.mjs";
import {strictJson} from "../src/t3/access/strict-json.mjs";
import {createOriginalVaultProofSigner}
  from "../src/t3/access/original-vault-proof.mjs";
import {emptyVault,generateVaultKey,encryptVault,decryptVault,
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
