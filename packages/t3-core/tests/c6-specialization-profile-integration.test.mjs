import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SourceJurisdictionSpecializationIndex,
} from '../src/modules/base/features/specialization/source-jurisdiction-specialization.mjs';
import {
  JurisdictionSourceProfileRegistry,
} from '../src/modules/base/features/specialization/jurisdiction-source-profiles.mjs';
import {
  JurisdictionProfileIntegrationError,
  qualifyJurisdictionSourceProfileIntegration,
  qualifySourceProfileBinding,
} from '../src/modules/base/features/specialization/jurisdiction-profile-integration.mjs';

function profileRegistry() {
  const registry=new JurisdictionSourceProfileRegistry();
  registry.registerRuProfile({
    id:'ru-base',
    jurisdictionId:'country-ru',
    authorityRef:'authority:ru-profile',
    identifierKinds:[{id:'ru.inn',scheme:'RU-INN'}],
    artifactKinds:[{id:'ru.source-document',scheme:'RU-SOURCE-DOC'}],
  });
  return registry;
}

function specializationIndex() {
  const index=new SourceJurisdictionSpecializationIndex();
  index.registerJurisdiction({id:'country-ru',scheme:'ISO-3166-1',code:'RU',label:'Russia'});
  return index;
}

function interval(from='2026-01-01T00:00:00Z',to=null){return {from,to};}

test('C6 profile integration requires an explicitly registered exact jurisdiction',()=>{
  const profiles=profileRegistry();
  const empty=new SourceJurisdictionSpecializationIndex();
  assert.throws(
    ()=>qualifyJurisdictionSourceProfileIntegration({
      specializationIndex:empty,
      profileRegistry:profiles,
      profileId:'ru-base',
    }),
    (error)=>error instanceof JurisdictionProfileIntegrationError
      && error.code==='PROFILE_JURISDICTION_NOT_REGISTERED',
  );

  const result=qualifyJurisdictionSourceProfileIntegration({
    specializationIndex:specializationIndex(),
    profileRegistry:profiles,
    profileId:'ru-base',
  });
  assert.equal(result.status,'PASS');
  assert.equal(result.profileId,'ru-base');
  assert.equal(result.jurisdictionId,'country-ru');
  assert.equal(result.inferredParentApplicability,false);
  assert.equal(result.authorityRoot,false);
  assert.equal(result.writeAuthorized,false);
});

test('C6 source/profile binding is fail-closed when no explicit current binding exists',()=>{
  const result=qualifySourceProfileBinding({
    specializationIndex:specializationIndex(),
    profileRegistry:profileRegistry(),
    sourceId:'source-1',
    profileId:'ru-base',
    effectiveAt:'2026-06-01T00:00:00Z',
    knownAt:'2026-06-01T00:00:00Z',
  });
  assert.equal(result.qualified,false);
  assert.equal(result.status,'NOT_QUALIFIED');
  assert.deepEqual(result.reasons,['PROFILE_NOT_EXPLICITLY_BOUND_TO_SOURCE']);
  assert.deepEqual(result.matchingBindingIds,[]);
  assert.equal(result.writeAuthorized,false);
});

test('C6 source/profile binding qualifies exactly one explicit current binding without inferring priority',()=>{
  const index=specializationIndex();
  index.appendBinding({
    id:'bind-ru',
    sourceId:'source-1',
    specializationId:'ru-base',
    jurisdictionIds:['country-ru'],
    effective:interval(),
    knowledge:interval(),
    provenanceId:'policy:ru',
  });
  const result=qualifySourceProfileBinding({
    specializationIndex:index,
    profileRegistry:profileRegistry(),
    sourceId:'source-1',
    profileId:'ru-base',
    effectiveAt:'2026-06-01T00:00:00Z',
    knownAt:'2026-06-01T00:00:00Z',
  });
  assert.equal(result.qualified,true);
  assert.equal(result.status,'PASS');
  assert.deepEqual(result.matchingBindingIds,['bind-ru']);
  assert.equal(result.selectedByPriority,false);
  assert.equal(result.inferredParentApplicability,false);
  assert.equal(result.writeAuthorized,false);
});

test('C6 source/profile binding refuses multiple current exact bindings instead of picking a winner',()=>{
  const index=specializationIndex();
  for(const id of ['bind-a','bind-b']){
    index.appendBinding({
      id,
      sourceId:'source-1',
      specializationId:'ru-base',
      jurisdictionIds:['country-ru'],
      effective:interval(),
      knowledge:interval(),
      provenanceId:`policy:${id}`,
    });
  }
  const result=qualifySourceProfileBinding({
    specializationIndex:index,
    profileRegistry:profileRegistry(),
    sourceId:'source-1',
    profileId:'ru-base',
    effectiveAt:'2026-06-01T00:00:00Z',
    knownAt:'2026-06-01T00:00:00Z',
  });
  assert.equal(result.qualified,false);
  assert.equal(result.status,'NOT_QUALIFIED');
  assert.deepEqual(result.reasons,['MULTIPLE_CURRENT_PROFILE_BINDINGS']);
  assert.deepEqual(result.matchingBindingIds,['bind-a','bind-b']);
  assert.equal(result.selectedByPriority,false);
  assert.equal(result.writeAuthorized,false);
});
