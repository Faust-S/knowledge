import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  FACTORY2_EXECUTABLE_PRODUCTS,
  FACTORY2_CONTROL_PLANE,
  FACTORY2_LEGACY_DELIVERY_REQUIREMENTS,
  validateFactory2Definition,
  evaluateFactory2Completeness,
  Factory2CompletenessError,
} from '../src/modules/base/features/factory2/factory2-completeness.mjs';

const product=(name)=>new URL('../../product/'+name,import.meta.url);
const definition=()=>JSON.parse(readFileSync(product('FACTORY2_DEFINITION_2026-09-24.json'),'utf8'));
const audit=()=>JSON.parse(readFileSync(product('FACTORY1_TO_FACTORY2_COMPLETENESS_AUDIT_2026-09-24.json'),'utf8'));
const currentState=()=>JSON.parse(readFileSync(new URL('../../CURRENT_PRODUCT_STATE.json',import.meta.url),'utf8'));

test('Factory 2 definition preserves all six Factory 1 executable products and all ten control-plane elements',()=>{
  const d=validateFactory2Definition(definition());
  assert.equal(d.artifactName,'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.1.zip');
  assert.equal(d.factoryId,'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2');
  assert.equal(d.generation,2);
  assert.equal(d.factoryVersion,'2.1.0');
  assert.equal(currentState().factory2.artifactName,d.artifactName);
  assert.deepEqual(d.executableProducts.map(x=>x.id).sort(),[...FACTORY2_EXECUTABLE_PRODUCTS].sort());
  assert.deepEqual(d.controlPlane.map(x=>x.id).sort(),[...FACTORY2_CONTROL_PLANE].sort());
  assert.deepEqual(d.legacyDeliveryRequirements.map(x=>x.id).sort(),[...FACTORY2_LEGACY_DELIVERY_REQUIREMENTS].sort());
  assert.equal(d.t25.requiredCapabilityCount,44);
  for(const id of ['domain-development-kit','one-day-domain-bundle','self-contained-fresh-extract-canary']) assert.ok(FACTORY2_LEGACY_DELIVERY_REQUIREMENTS.includes(id));
});
test('current audit fails closed while incomplete products remain, even when none are missing',()=>{
  const result=evaluateFactory2Completeness(definition(),audit());
  assert.equal(result.status,'FACTORY2_GAPS_REMAIN');
  assert.equal(result.releaseCandidateAllowed,false);
  assert.equal(result.productCounts.MISSING,0);
  assert.ok(result.productCounts.PARTIAL>=1);
});
test('D01 or another prior experimental domain run cannot satisfy Factory 2 acceptance',()=>{
  const x=audit(); x.realDomainBoundary.d01FactoryAuthority=true;
  assert.throws(()=>evaluateFactory2Completeness(definition(),x),(e)=>e instanceof Factory2CompletenessError&&e.code==='FACTORY2_DOMAIN_RUN_AUTHORITY_FORBIDDEN');
});
test('a silent legacy product drop is rejected',()=>{
  const x=definition(); x.executableProducts=x.executableProducts.filter((p)=>p.id!=='domain-studio');
  assert.throws(()=>validateFactory2Definition(x),(e)=>e instanceof Factory2CompletenessError&&e.code==='FACTORY2_LEGACY_SET_INCOMPLETE');
});
test('Factory 2 cannot claim release-ready while any predecessor/control/delivery gap remains',()=>{
  const x=audit(); x.claimedReleaseReady=true;
  assert.throws(()=>evaluateFactory2Completeness(definition(),x),(e)=>e instanceof Factory2CompletenessError&&e.code==='FACTORY2_FALSE_RELEASE_CLAIM');
});

test('Factory 2 delivery definition cannot regress to a reference-only archive',()=>{
  const d=definition();
  assert.ok(d.legacyDeliveryRequirements.some(x=>x.id==='self-contained-fresh-extract-canary'&&x.required===true));
  assert.ok(d.legacyDeliveryRequirements.some(x=>x.id==='domain-development-kit'&&x.required===true));
  assert.ok(d.legacyDeliveryRequirements.some(x=>x.id==='one-day-domain-bundle'&&x.required===true));
});
