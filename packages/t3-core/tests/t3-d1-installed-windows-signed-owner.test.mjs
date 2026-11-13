// Windows product owner composition: actual DPAPI CurrentUser custody +
// canonical signed CORP operation gate + ORIGINAL Kernel AccessRegistry.
// Issuers are temporary CI-only TEST fixtures; no installed GUI is certified.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {digest,iso,signRecord} from "../src/t3/access/core.mjs";
import {emptyVault,importVaultKey} from "../src/t3/access/local-vault.mjs";
import {createWindowsOriginalVaultCustody}
  from "../src/t3/access/windows-original-vault-custody.mjs";
import {createT3InstalledWindowsSignedControlOwner}
  from "../src/t3/installed-original-control-host.mjs";
import {createSubjectKernelBinding}
  from "../src/t3/subject-access-binding.mjs";
import {NOW,time,model,originalKernelFixture,command}
  from "./support/t3-two-corp-original-authority.mjs";

const windows=process.platform==="win32";
test("installed Windows signed Control uses original Registry JIT + DPAPI for two corporate Workspaces and signed revocation",{
  skip:!windows,timeout:120000,
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"iwxa-t3-native-corp-owner-"));
  const vaultPath=join(root,"original-credential-vault.json");
  try{
    const fixture=model(),kernel=originalKernelFixture();
    const enrolled=emptyVault();
    for(const entry of Object.values(fixture.all)){
      const keyId=entry.issuedCredential.publicKeyRef;
      importVaultKey(enrolled,{
        keyId,subjectId:entry.context.actor_id,
        privateKeyPem:entry.credentialPrivateKeyPem,
        expectedPublicKeyPem:fixture.policy.keys[keyId].publicKey,
      });
    }
    const custody=createWindowsOriginalVaultCustody({vaultPath});
    await custody.provision(enrolled);
    const disk=readFileSync(vaultPath,"utf8");
    assert.equal(disk.includes("PRIVATE KEY"),false);
    let selected=fixture.all.north.context;
    const originalInputFor=async context=>{
      const entry=Object.values(fixture.all)
        .find(x=>x.context.organization_id===context.organization_id);
      assert.ok(entry);
      return {
        profile:entry.profile,selection:entry.selection,
        descriptors:entry.descriptors,credential:entry.issuedCredential,
        enrollment:entry.enrollment,
      };
    };
    const build=()=>createT3InstalledWindowsSignedControlOwner({
      registryKernel:kernel.api,registryWorkspaceId:"ws:host-registry",
      trustedPolicy:fixture.policy,vaultPath,
      currentContext:()=>selected,
      actionFor:op=>{
        if(op!=="t1.putObject")throw Error("UNSUPPORTED_ORIGINAL_OPERATION");
        return "object.write";
      },
      operationDigest:({operation,input,context})=>
        digest({operation,input,context}),
      organizationInputFor:originalInputFor,
      clock:time,
    });
    let owner=build();
    assert.equal((await owner.ownerFor({scope:"activity",operation:"activity.read"})),null);
    assert.equal((await owner.registry.commitSignedState(fixture.state)).revision,1);
    let signed=await owner.ownerFor({scope:"kernel",operation:"putObject"});
    let bound=createSubjectKernelBinding({kernel:kernel.api,access:signed,clock:time});
    const a=await bound.putObject(command("north"));
    assert.equal(a.object.workspace_id,"ws:north");
    await assert.rejects(bound.putObject(command("south")),
      {code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
    selected=fixture.all.south.context;
    const b=await bound.putObject(command("south"));
    assert.equal(b.object.workspace_id,"ws:south");
    assert.equal(b.object.revision,1);
    const list=await owner.credentialInventory();
    assert.deepEqual(Object.keys(list).sort(),["key:cred-north","key:cred-south"]);
    assert.equal(JSON.stringify(list).includes("PRIVATE KEY"),false);
    const revoked={...fixture.all.north.status,sequence:2,
      issuedAt:iso(NOW-1000),entries:[{
        grantId:"grant:north",state:"REVOKED",
        effectiveAt:iso(NOW-1500),evidenceRef:"evidence:revoked-north",
      }]};
    const next=structuredClone(fixture.state);
    next.statuses["issuer:north"]=signRecord(
      revoked,fixture.all.north.issuerSigner);
    next.statusFloor["issuer:north"]=2;
    assert.equal((await owner.registry.commitSignedState(next)).revision,2);
    selected=fixture.all.north.context;
    await assert.rejects(bound.putObject({
      ...command("north"),object_id:"item:revoked-native",
    }),{code:"T3_ACCESS_NOT_PERMITTED"});
    assert.equal(await kernel.api.getObject("ws:north","item:revoked-native"),null);
    // Reconstruct the trusted signed owner and DPAPI signer from scratch
    // against the same ORIGINAL Kernel state, without caching rights.
    owner=build();
    signed=await owner.ownerFor({scope:"kernel",operation:"putObject"});
    bound=createSubjectKernelBinding({kernel:kernel.api,access:signed,clock:time});
    await assert.rejects(bound.putObject({
      ...command("north"),object_id:"item:revoked-reopened",
    }),{code:"T3_ACCESS_NOT_PERMITTED"});
    selected=fixture.all.south.context;
    const resumed=await bound.putObject({
      ...command("south"),object_id:"item:after-reopen",
    });
    assert.equal(resumed.object.workspace_id,"ws:south");
    assert.equal(resumed.object.revision,1);
    assert.equal((await owner.registry.getStatus()).sequences["issuer:north"],2);
    assert.equal((await owner.registry.getStatus()).sequences["issuer:south"],1);
    console.log("T3_D1_WINDOWS_ORIGINAL_SIGNED_OWNER_DPAPI_KERNEL_PASS",JSON.stringify({
      windowsDpapi:true,originalKernelFacade:true,
      originalSignedRegistry:true,independentCorporateIssuers:2,
      independentlyIssuedCredentialKeys:2,signedNorthRevoked:true,
      southActiveAfterOwnerReconstruction:true,originalKernelWrites:3,
      nativeWindowCompiledSeparately:true,
      installedWindowsGuiAccepted:false,productionIssuerUsed:false,
    }));
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("installed Windows issuer owner composition refuses non-Windows fallback",()=>{
  if(windows)return;
  assert.throws(()=>createT3InstalledWindowsSignedControlOwner(),
    {code:"T3_D1_INSTALLED_HOST_WINDOWS_NATIVE_REQUIRED"});
});
