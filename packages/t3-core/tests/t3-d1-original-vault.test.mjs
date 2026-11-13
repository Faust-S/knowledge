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
