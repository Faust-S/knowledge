import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
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
    const north=selected("org:north");
    const pinnedNorth=createOriginalVaultProofSigner({
      organizationId:"org:north",keyId:"key:north",...custody});
    await assert.rejects(pinnedNorth({
      context:north,request:request(north),
      credentialKeyId:"key:south",
      challenge:"win-dpapi-challenge-"+String(now),
      asOf:new Date(now).toISOString(),
    }),{code:"T3_ACCESS_VAULT_CREDENTIAL_MISMATCH"});
    await assert.rejects(pinnedNorth({
      context:selected("org:south"),
      request:request(selected("org:south")),
      credentialKeyId:"key:north",
      challenge:"win-dpapi-challenge-"+String(now),
      asOf:new Date(now).toISOString(),
    }),{code:"T3_ACCESS_VAULT_ORGANIZATION_MISMATCH"});
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
    const base=fileURLToPath(new URL("../",import.meta.url));
    const proc=spawnSync(process.execPath,
      ["--input-type=module","-e",script,vaultPath],{
        cwd:base,
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

test("Windows DPAPI enrolls North then South into one original vault across Host processes, preserving PERSONAL",{
  skip:!isWindows,
},async()=>{
  const dir=mkdtempSync(join(tmpdir(),"t3-d1-windows-enrollment-"));
  const vaultPath=join(dir,"original-vault.json");
  const now=Date.now(),createdAt=new Date(now-20000).toISOString();
  try{
    const vault=emptyVault();
    const personal=generateVaultKey(vault,{
      keyId:"key:personal",subjectId:"person:member",createdAt});
    const issued=emptyVault();
    const north=generateVaultKey(issued,{
      keyId:"key:north",subjectId:"person:member",createdAt});
    const south=generateVaultKey(issued,{
      keyId:"key:south",subjectId:"person:member",createdAt});
    const custody=createWindowsOriginalVaultCustody({vaultPath});
    await custody.provision(vault);
    const initialRecord=JSON.parse(readFileSync(vaultPath,"utf8"));
    const toImport=key=>({
      keyId:key.keyId,subjectId:key.subjectId,
      privateKeyPem:key.privateKeyPem,
      expectedPublicKeyPem:key.publicKeyPem,createdAt,
    });
    const acceptedNorth=await custody.enrollCredential(toImport(north));
    assert.equal(acceptedNorth.publicKeyPem,north.publicKeyPem);
    assert.equal(acceptedNorth.privateKeyPem,undefined);
    const afterNorth=readFileSync(vaultPath,"utf8");
    assert.equal(JSON.parse(afterNorth).osCustody.protectedSecret,
      initialRecord.osCustody.protectedSecret);
    assert.equal(afterNorth.includes("BEGIN PRIVATE KEY"),false);
    // Wrong binding must not silently modify already issued keys.
    await assert.rejects(custody.enrollCredential({
      ...toImport(south),expectedPublicKeyPem:north.publicKeyPem,
    }),{code:"PUBLIC_KEY_MISMATCH"});
    assert.equal(readFileSync(vaultPath,"utf8"),afterNorth);
    await assert.rejects(custody.enrollCredential(toImport(north)),
      {code:"KEY_ALREADY_EXISTS"});
    assert.equal(readFileSync(vaultPath,"utf8"),afterNorth);
    const lock=vaultPath+".enrollment.lock";
    writeFileSync(lock,"another-host-is-enrolling");
    await assert.rejects(custody.enrollCredential(toImport(south)),
      {code:"T3_WINDOWS_DPAPI_ENROLLMENT_BUSY"});
    assert.equal(readFileSync(lock,"utf8"),"another-host-is-enrolling");
    rmSync(lock);
    assert.equal(readFileSync(vaultPath,"utf8"),afterNorth);
    // A different Windows Node process imports South through stdin:
    // no private key in shell arguments, env, repository or diagnostics.
    const code=`
      import {createWindowsOriginalVaultCustody} from "./src/t3/access/windows-original-vault-custody.mjs";
      let input="";
      for await(const chunk of process.stdin)input+=chunk.toString("utf8");
      const credential=JSON.parse(input);
      const custody=createWindowsOriginalVaultCustody({vaultPath:process.argv[1]});
      const publicKey=await custody.enrollCredential(credential);
      process.stdout.write(publicKey.keyId);
    `;
    const base=fileURLToPath(new URL("../",import.meta.url));
    const child=spawnSync(process.execPath,
      ["--input-type=module","-e",code,vaultPath],{
        cwd:base,input:JSON.stringify(toImport(south)),
        encoding:"utf8",windowsHide:true,timeout:90000,
      });
    assert.equal(child.status,0,child.stderr);
    assert.equal(child.stdout,"key:south");
    assert.equal(existsSync(lock),false);
    const inventory=await custody.inventory();
    assert.deepEqual(Object.keys(inventory).sort(),
      ["key:north","key:personal","key:south"]);
    assert.equal(inventory["key:personal"].publicKeyPem,
      personal.publicKeyPem);
    assert.equal(inventory["key:north"].publicKeyPem,north.publicKeyPem);
    assert.equal(inventory["key:south"].publicKeyPem,south.publicKeyPem);
    assert.equal(JSON.stringify(inventory).includes("PRIVATE KEY"),false);
    const context=org=>org===null?{
      kind:"PERSONAL",actor_id:"person:member",organization_id:null,
    }:{
      kind:"CORP",actor_id:"person:member",organization_id:org,
      principal_id:org,role_id:"role:member",grant_id:"grant:"+org,
      realm_id:"realm:local",audience:"host:t3",purpose:"purpose:work",
      workspace_id:"ws:"+org,resource:"ws:"+org,
    };
    const request=c=>c.kind==="PERSONAL"
      ?{actorId:"person:member",principalId:"person:member"}
      :{actorId:"person:member",principalId:c.principal_id,
        roleId:c.role_id,grantId:c.grant_id,realmId:c.realm_id,
        audience:c.audience,resource:c.resource,purpose:c.purpose};
    for(const [org,key] of [[null,personal],["org:north",north],["org:south",south]]){
      const ctx=context(org);
      const signer=createOriginalVaultProofSigner({
        ...createWindowsOriginalVaultCustody({vaultPath}),
        organizationId:org,keyId:key.keyId});
      const proof=await signer({
        request:request(ctx),context:ctx,credentialKeyId:key.keyId,
        challenge:"enrollment-test-challenge-"+String(now),
        asOf:new Date(now).toISOString(),
      });
      const policy={environment:"TEST",keys:{[key.keyId]:{
        subjectId:key.subjectId,environment:"TEST",status:"ACTIVE",
        uses:["PROOF"],publicKey:key.publicKeyPem,
        notBefore:createdAt,expiresAt:new Date(now+60000).toISOString(),
      }}};
      assert.equal(verifyRecord(proof,policy,now,"PROOF").subjectId,
        "person:member");
    }
    assert.equal(readFileSync(vaultPath,"utf8").includes("PRIVATE KEY"),false);
    console.log("T3_D1_WINDOWS_SEQUENTIAL_ENROLLMENT_PASS",
      JSON.stringify({originalVault:1,personal:1,corporate:2,
        independentlyEnrolledCorporateCredentials:2,
        preservedPersonal:true,independentHostProcesses:true,
        noPrivateKeyOnDisk:true,duplicateDenied:true,
        wrongIssuerPublicKeyDenied:true,busyHostDenied:true,
        installedWindowsControlAccepted:false}));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
