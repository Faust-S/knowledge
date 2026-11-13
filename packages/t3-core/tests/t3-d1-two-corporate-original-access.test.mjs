// Two independent genuine Ed25519 organizational issuers and credentials,
// one original T3 AccessRegistry in the inherited T2 Kernel Store, and the
// existing signed subject binding over ONE KernelFacade. This is a Node-level
// business-logic qualification (not an installed Windows enrollment).
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {PROFILE,iso,digest,signRecord,keyObjectSigner}
  from "../src/t3/access/core.mjs";
import {emptyVault,importVaultKey,encryptVault}
  from "../src/t3/access/local-vault.mjs";
import {createOriginalVaultProofSigner}
  from "../src/t3/access/original-vault-proof.mjs";
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

import {NOW,time,model,originalKernelFixture,command}
  from "./support/t3-two-corp-original-authority.mjs";

test("two genuine signed organizations retain independent original Access rights and Kernel receipts",{
  timeout:30000
},async()=>{
  const fixture=model(),kernel=originalKernelFixture();
  // Both separate organization-issued keys live in the SAME encrypted
  // original Vault. No test-only in-memory signer is used for JIT proofs.
  const vault=emptyVault();
  for(const entry of Object.values(fixture.all)){
    const keyId=entry.issuedCredential.publicKeyRef;
    importVaultKey(vault,{keyId,subjectId:entry.context.actor_id,
      privateKeyPem:entry.credentialPrivateKeyPem,
      expectedPublicKeyPem:fixture.policy.keys[keyId].publicKey});
  }
  const encrypted=encryptVault(vault,"TEST_ONLY_CORP_CREDENTIAL_PASSPHRASE");
  const credentialSigners=Object.fromEntries(
    Object.values(fixture.all).map(entry=>[
      entry.context.organization_id,createOriginalVaultProofSigner({
        keyId:entry.issuedCredential.publicKeyRef,
        organizationId:entry.context.organization_id,
        readEncryptedVault:async()=>encrypted,
        unlockPassphrase:async()=> "TEST_ONLY_CORP_CREDENTIAL_PASSPHRASE",
      }),
    ]));
  const signer=credentialSigners["org:north"];
  const wrongOrg=fixture.all.south.context;
  const badRequest={
    actorId:wrongOrg.actor_id,principalId:wrongOrg.principal_id,
    grantId:wrongOrg.grant_id,resource:wrongOrg.resource,
    roleId:wrongOrg.role_id,audience:wrongOrg.audience,
    realmId:wrongOrg.realm_id,purpose:wrongOrg.purpose,
  };
  await assert.rejects(signer({
    request:badRequest,context:wrongOrg,
    credentialKeyId:fixture.all.north.issuedCredential.publicKeyRef,
    challenge:"test-unique-corporate-challenge",asOf:iso(NOW),
  }),{code:"T3_ACCESS_VAULT_ORGANIZATION_MISMATCH"});
  const northContext=fixture.all.north.context;
  const northRequest={
    actorId:northContext.actor_id,
    principalId:northContext.principal_id,
    grantId:northContext.grant_id,resource:northContext.resource,
    roleId:northContext.role_id,audience:northContext.audience,
    realmId:northContext.realm_id,purpose:northContext.purpose,
  };
  await assert.rejects(signer({
    request:northRequest,context:northContext,
    credentialKeyId:fixture.all.south.issuedCredential.publicKeyRef,
    challenge:"test-unique-corporate-challenge",asOf:iso(NOW),
  }),{code:"T3_ACCESS_VAULT_CREDENTIAL_MISMATCH"});
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
        return credentialSigners[context.organization_id]({
          request,challenge,credentialKeyId,context,asOf,
        });
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
    twoSeparateCredentialsRecoveredFromOriginalEncryptedVault:true,
    installedAppAccepted:false,realKernelBrowserQualified:false,
  }));
});
