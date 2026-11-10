import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  validateProductLogicSuccessor,
  validateCapabilitySecurityArchitecture,
  validatePrivateStandardSuccessor,
  validateArchitectureCheckpoint,
  validateRuntimeContractSuccessor,
  Factory2SuccessorError,
} from '../src/factory2/control-plane/successors.mjs';

const product=(name)=>JSON.parse(readFileSync(new URL('../../product/'+name,import.meta.url),'utf8'));

test('Factory 2 Product Logic remains domain-scoped and has no generic writers',()=>{
  const x=validateProductLogicSuccessor(product('FACTORY2_PRODUCT_LOGIC_SUCCESSOR_2026-09-24.json'));
  assert.equal(x.authorityModel.sourceTruthBinding,'DOMAIN_SCOPED');
  assert.equal(x.authorityModel.genericResultWriter,false);
  assert.equal(x.authorityModel.genericAcceptanceWriter,false);
});
test('Factory 2 Capability/Security architecture keeps Kernel authorization authoritative',()=>{
  const x=validateCapabilitySecurityArchitecture(product('FACTORY2_CAPABILITY_SECURITY_ARCHITECTURE_2026-09-24.json'));
  assert.equal(x.kernelTarget,'0.3.5');
  assert.equal(x.boundaries.kernelOwnsAuthorizationDecision,true);
  assert.equal(x.boundaries.workspaceVerifiesTrustMetadata,false);
});
test('Factory 2 Private Standard preserves no-synthetic-authority invariants',()=>{
  const x=validatePrivateStandardSuccessor(product('FACTORY2_PRIVATE_STANDARD_SUCCESSOR_2026-09-24.json'));
  assert.ok(x.invariants.includes('OWNER_APPROVAL_MUST_NOT_BE_SYNTHESIZED'));
  assert.equal(x.ownerApprovalGranted,false);
});
test('Factory 2 architecture checkpoint is non-self-pinned and excludes D01 authority',()=>{
  const x=validateArchitectureCheckpoint(product('FACTORY2_ARCHITECTURE_CHECKPOINT_2026-09-24.json'));
  assert.equal(x.selfPinnedHeadStoredInTree,false);
  assert.equal(x.boundaries.d01FactoryAuthority,false);
});
test('Factory 2 Runtime Contract successor does not import predecessor acceptance',()=>{
  const x=validateRuntimeContractSuccessor(product('FACTORY2_RUNTIME_CONTRACT_SUCCESSOR_2026-09-24.json'));
  assert.equal(x.predecessorAcceptance.transferable,false);
  assert.equal(x.generation2AcceptanceGranted,false);
});
test('attempted synthetic Product Logic generic Result writer is rejected',()=>{
  const x=product('FACTORY2_PRODUCT_LOGIC_SUCCESSOR_2026-09-24.json');
  x.authorityModel.genericResultWriter=true;
  assert.throws(()=>validateProductLogicSuccessor(x),(e)=>e instanceof Factory2SuccessorError&&e.code==='FACTORY2_PRODUCT_LOGIC_AUTHORITY_INVALID');
});
