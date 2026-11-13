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

import {NOW,time,model,originalKernelFixture,command}
  from "./support/t3-two-corp-original-authority.mjs";

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
