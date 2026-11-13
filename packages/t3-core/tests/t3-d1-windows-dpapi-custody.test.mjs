import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createWindowsOriginalVaultCustody} from
  "../src/t3/access/windows-original-vault-custody.mjs";
import {emptyVault,generateVaultKey} from "../src/t3/access/local-vault.mjs";
import {createOriginalVaultProofSigner} from
  "../src/t3/access/original-vault-proof.mjs";
import {verifyRecord} from "../src/t3/access/core.mjs";

const isWindows=process.platform==="win32";
test("DPAPI CurrentUser protects original PERSONAL + two CORP Ed25519 credentials across independent processes",{
  skip:!isWindows,
},async()=>{
  const dir=mkdtempSync(join(tmpdir(),"t3-d1-windows-custody-"));
  const vaultPath=join(dir,"original-vault.json");
  try{
    const vault=emptyVault();
    const now=Date.now();
    const issuedAt=new Date(now-60000).toISOString();
    const subjects=[
      ["key:personal","person:operator"],
      ["key:north","person:operator"],
      ["key:south","person:operator"],
    ];
    for(const [keyId,subjectId] of subjects)
      generateVaultKey(vault,{keyId,subjectId,createdAt:issuedAt});
    const custody=createWindowsOriginalVaultCustody({vaultPath});
    await custody.provision(vault);
    const disk=readFileSync(vaultPath,"utf8");
    assert.equal(disk.includes("BEGIN PRIVATE KEY"),false);
    assert.equal(disk.includes("privateKeyPem"),false);
    assert.equal(disk.includes("TEST_ONLY_NEVER_PRODUCTION"),false);
    assert.equal(JSON.parse(disk).osCustody.scope,"CURRENT_USER");
    await assert.rejects(custody.provision(vault),
      {code:"T3_WINDOWS_DPAPI_VAULT_EXISTS"});
    const selected=org=>org===null?{
      kind:"PERSONAL",actor_id:"person:operator",organization_id:null,
    }:{
      kind:"CORP",actor_id:"person:operator",principal_id:org,
      organization_id:org,role_id:"role:member",grant_id:"grant:"+org,
      realm_id:"realm:local",audience:"host:t3",
      workspace_id:"ws:"+org,resource:"ws:"+org,purpose:"purpose:work",
    };
    const request=context=>context.kind==="PERSONAL"
      ?{actorId:"person:operator",principalId:"person:operator"}
      :{actorId:"person:operator",principalId:context.principal_id,
        roleId:context.role_id,grantId:context.grant_id,
        realmId:context.realm_id,audience:context.audience,
        resource:context.resource,purpose:context.purpose,
        action:"object.write",operationDigest:"0".repeat(64)};
    const proofFor=async(org,keyId)=>{
      const context=selected(org);
      const signer=createOriginalVaultProofSigner({
        organizationId:org,keyId,...custody,
      });
      const proof=await signer({context,request:request(context),
        credentialKeyId:keyId,
        challenge:"win-dpapi-challenge-"+String(now),
        asOf:new Date(now).toISOString()});
      const key=vault.keys[keyId];
      const trust={environment:"TEST",keys:{[keyId]:{
        subjectId:key.subjectId,environment:"TEST",status:"ACTIVE",
        uses:["PROOF"],publicKey:key.publicKeyPem,notBefore:issuedAt,
        expiresAt:new Date(now+60000).toISOString(),
      }}};
      assert.equal(verifyRecord(proof,trust,now,"PROOF").subjectId,
        "person:operator");
      return proof;
    };
    await proofFor(null,"key:personal");
    await proofFor("org:north","key:north");
    await proofFor("org:south","key:south");
    await assert.rejects(proofFor("org:north","key:south"),
      {code:"T3_ACCESS_VAULT_CREDENTIAL_MISMATCH"});
    const script=`
      import {createWindowsOriginalVaultCustody} from "./src/t3/access/windows-original-vault-custody.mjs";
      import {createOriginalVaultProofSigner} from "./src/t3/access/original-vault-proof.mjs";
      const vaultPath=process.argv[1];
      const custody=createWindowsOriginalVaultCustody({vaultPath});
      const ctx={kind:"CORP",actor_id:"person:operator",principal_id:"org:south",
        organization_id:"org:south",role_id:"role:member",
        grant_id:"grant:org:south",realm_id:"realm:local",
        audience:"host:t3",workspace_id:"ws:org:south",
        resource:"ws:org:south",purpose:"purpose:work"};
      const signer=createOriginalVaultProofSigner({
        keyId:"key:south",organizationId:"org:south",...custody});
      const proof=await signer({
        context:ctx,credentialKeyId:"key:south",
        request:{actorId:ctx.actor_id,principalId:ctx.principal_id,
          roleId:ctx.role_id,grantId:ctx.grant_id,realmId:ctx.realm_id,
          audience:ctx.audience,resource:ctx.resource,purpose:ctx.purpose,
          action:"object.write",operationDigest:"0".repeat(64)},
        asOf:new Date().toISOString(),
        challenge:"cold-process-challenge-unique"});
      process.stdout.write(proof.keyId);
    `;
    const base=new URL("../",import.meta.url).pathname;
    const proc=spawnSync(process.execPath,
      ["--input-type=module","-e",script,vaultPath],{
        cwd:decodeURIComponent(base.replace(/^\\/,"")),
        encoding:"utf8",timeout:60000,windowsHide:true});
    assert.equal(proc.status,0,proc.stderr);
    assert.equal(proc.stdout,"key:south");
    const damaged=JSON.parse(disk);
    damaged.osCustody.protectedSecret="AAAA";
    writeFileSync(vaultPath,JSON.stringify(damaged));
    await assert.rejects(custody.unlockPassphrase(),
      {code:"T3_WINDOWS_DPAPI_UNSEAL_FAILED"});
    console.log("T3_D1_WINDOWS_DPAPI_CUSTODY_PASS",
      JSON.stringify({originalVault:true,personal:1,corporate:2,
        currentUserDpapi:true,separateWindowsNodeProcess:true,
        overwriteDenied:true,tamperDenied:true,
        installedWindowsControlAccepted:false}));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test("DPAPI custody refuses non-Windows platforms without fallback",()=>{
  if(isWindows)return;
  assert.throws(()=>createWindowsOriginalVaultCustody({
    vaultPath:"/tmp/not-a-windows-vault",
  }),{code:"T3_WINDOWS_DPAPI_REQUIRED"});
});
