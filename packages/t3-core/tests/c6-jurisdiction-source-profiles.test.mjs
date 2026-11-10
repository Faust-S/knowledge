import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JurisdictionSourceProfileError,
  JurisdictionSourceProfileRegistry,
} from '../src/modules/base/features/specialization/jurisdiction-source-profiles.mjs';

function evidenceLedger() {
  const ids = new Set(['ru-rule-2025', 'ru-rule-2026']);
  return { get(id) { if (!ids.has(id)) throw new Error('missing'); return { id }; } };
}

function registry() {
  const value = new JurisdictionSourceProfileRegistry({ evidenceLedger: evidenceLedger() });
  value.registerRuProfile({
    id: 'ru-base',
    jurisdictionId: 'country-ru',
    authorityRef: 'authority:ru-profile',
    identifierKinds: [
      { id: 'ru.inn', scheme: 'RU-INN' },
      { id: 'ru.kpp', scheme: 'RU-KPP' },
    ],
    artifactKinds: [
      { id: 'ru.source-document', scheme: 'RU-SOURCE-DOC' },
    ],
  });
  return value;
}

function interval(from, to = null) { return { from, to }; }

test('C6 RU source profile carries only explicitly declared identifiers and artifacts', () => {
  const value = registry();
  const profile = value.profile('ru-base');
  assert.equal(profile.countryCode, 'RU');
  assert.equal(profile.profileClass, 'RU_JURISDICTION_SOURCE');
  assert.deepEqual(profile.identifierKinds.map((entry) => entry.id), ['ru.inn', 'ru.kpp']);
  assert.deepEqual(profile.artifactKinds.map((entry) => entry.id), ['ru.source-document']);
  assert.equal(profile.canonicalOntology, false);
  assert.equal(profile.authorityRoot, false);
  assert.deepEqual(value.specializationDescriptor('ru-base'), {
    specializationId: 'ru-base', jurisdictionIds: ['country-ru'], inferredParentApplicability: false,
  });

  assert.throws(
    () => new JurisdictionSourceProfileRegistry().registerRuProfile({
      id: 'incomplete-ru', jurisdictionId: 'country-ru', authorityRef: 'authority:ru', identifierKinds: [], artifactKinds: [],
    }),
    (error) => error instanceof JurisdictionSourceProfileError && error.code === 'MISSING_RU_IDENTIFIER_KINDS',
  );
});

test('C6 RU rules are bitemporal/effective-dated and preserve provenance instead of latest-wins mutation', () => {
  const value = registry();
  value.appendRule({
    id: 'rule-old', profileId: 'ru-base', ruleKind: 'identifier-policy', subjectRef: 'ru.inn',
    payload: { mode: 'legacy' },
    effective: interval('2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    knowledge: interval('2025-01-01T00:00:00Z'), provenanceId: 'ru-rule-2025',
  });
  value.appendRule({
    id: 'rule-new', profileId: 'ru-base', ruleKind: 'identifier-policy', subjectRef: 'ru.inn',
    payload: { mode: 'current' },
    effective: interval('2026-01-01T00:00:00Z'),
    knowledge: interval('2026-01-01T00:00:00Z'), provenanceId: 'ru-rule-2026',
  });

  assert.deepEqual(value.rulesAt({ profileId: 'ru-base', effectiveAt: '2025-06-01T00:00:00Z', knownAt: '2026-06-01T00:00:00Z' }).map((rule) => rule.id), ['rule-old']);
  assert.deepEqual(value.rulesAt({ profileId: 'ru-base', effectiveAt: '2026-06-01T00:00:00Z', knownAt: '2026-06-01T00:00:00Z' }).map((rule) => rule.id), ['rule-new']);
  assert.equal(value.rulesAt({ profileId: 'ru-base', effectiveAt: '2026-06-01T00:00:00Z', knownAt: '2026-06-01T00:00:00Z' })[0].provenanceId, 'ru-rule-2026');
});

test('C6 source adapters may target only declared jurisdiction identifiers/artifacts', () => {
  const value = registry();
  assert.throws(
    () => value.registerAdapter({
      id: 'bad', sourceKind: '1C', sourceSchemaRef: '1c:counterparty:v1', profileId: 'ru-base',
      mappings: [{ id: 'unknown-id', sourcePath: 'INN', targetRole: 'identifier', targetRef: 'ru.unknown' }],
    }),
    (error) => error instanceof JurisdictionSourceProfileError && error.code === 'UNDECLARED_PROFILE_IDENTIFIER',
  );
});

test('C6 1C read-import maps only declared fields, preserves source envelope and never captures source schema as ontology', () => {
  const value = registry();
  value.registerAdapter({
    id: '1c-counterparty', sourceKind: '1C', sourceSchemaRef: '1c:counterparty:v1', profileId: 'ru-base',
    mappings: [
      { id: 'inn', sourcePath: 'INN', targetRole: 'identifier', targetRef: 'ru.inn', required: true },
      { id: 'name', sourcePath: 'Description', targetRole: 'domain-field', targetFamily: 'counterparty', targetField: 'displayName' },
      { id: 'doc', sourcePath: 'SourceDocument', targetRole: 'artifact', targetRef: 'ru.source-document' },
    ],
  });
  const preview = value.readImportPreview({
    adapterId: '1c-counterparty', sourceRecordId: '1c:42',
    sourcePayload: { INN: '7700000000', Description: 'Example', SourceDocument: { ref: 'doc:1' }, Unexpected1CField: 'keep-as-source-only' },
    effectiveAt: '2026-06-01T00:00:00Z', knownAt: '2026-06-01T00:00:00Z',
  });
  assert.equal(preview.qualification.qualified, true);
  assert.deepEqual(preview.identifierCandidates.map((item) => item.targetRef), ['ru.inn']);
  assert.deepEqual(preview.fieldCandidates.map((item) => [item.targetFamily, item.targetField]), [['counterparty', 'displayName']]);
  assert.equal(preview.sourceEnvelope.payload.Unexpected1CField, 'keep-as-source-only');
  assert.equal(preview.undeclaredSourceFieldsPromoted, false);
  assert.equal(preview.ontologyCapture, false);
  assert.equal(preview.schemaInferred, false);
  assert.deepEqual(preview.ontologyMutationPlan, []);
  assert.equal(preview.writeRequested, false);
  assert.equal(preview.ownerCommand, null);
});

test('C6 import qualification fails closed when a required declared mapping is absent without issuing a write', () => {
  const value = registry();
  value.registerAdapter({
    id: 'general-ru', sourceKind: 'GENERAL', sourceSchemaRef: 'csv:counterparty:v1', profileId: 'ru-base',
    mappings: [
      { id: 'inn', sourcePath: 'tax.inn', targetRole: 'identifier', targetRef: 'ru.inn', required: true },
      { id: 'name', sourcePath: 'name', targetRole: 'domain-field', targetFamily: 'counterparty', targetField: 'displayName' },
    ],
  });
  const preview = value.readImportPreview({
    adapterId: 'general-ru', sourceRecordId: 'row:7', sourcePayload: { name: 'No identifier', extra: 5 },
    effectiveAt: '2026-06-01T00:00:00Z', knownAt: '2026-06-01T00:00:00Z',
  });
  assert.equal(preview.qualification.qualified, false);
  assert.deepEqual(preview.qualification.missingRequiredMappingIds, ['inn']);
  assert.equal(preview.writeAuthorized, false);
  assert.equal(preview.ownerCommandRequiredForCommit, true);
});

test('C6 source adapter mapping rejects unsafe paths and unknown provenance fails closed', () => {
  const value = registry();
  assert.throws(
    () => value.registerAdapter({
      id: 'unsafe', sourceKind: 'GENERAL', sourceSchemaRef: 'json:v1', profileId: 'ru-base',
      mappings: [{ id: 'x', sourcePath: '__proto__.x', targetRole: 'domain-field', targetFamily: 'x', targetField: 'x' }],
    }),
    (error) => error instanceof JurisdictionSourceProfileError && error.code === 'INVALID_SOURCE_PATH',
  );
  assert.throws(
    () => value.appendRule({
      id: 'missing-evidence', profileId: 'ru-base', ruleKind: 'artifact-policy', subjectRef: 'ru.source-document', payload: {},
      effective: interval('2026-01-01T00:00:00Z'), knowledge: interval('2026-01-01T00:00:00Z'), provenanceId: 'missing',
    }),
    (error) => error instanceof JurisdictionSourceProfileError && error.code === 'UNKNOWN_JURISDICTION_SOURCE_PROVENANCE',
  );
});


test('C6 read-import fails closed on ambiguous mappings to the same canonical target', () => {
  const value=registry();
  value.registerAdapter({
    id:'ambiguous-target',sourceKind:'GENERAL',sourceSchemaRef:'json:counterparty:v1',profileId:'ru-base',
    mappings:[
      {id:'name-a',sourcePath:'nameA',targetRole:'domain-field',targetFamily:'counterparty',targetField:'displayName',required:true},
      {id:'name-b',sourcePath:'nameB',targetRole:'domain-field',targetFamily:'counterparty',targetField:'displayName',required:true},
    ],
  });
  const preview=value.readImportPreview({
    adapterId:'ambiguous-target',
    sourceRecordId:'row:ambiguous',
    sourcePayload:{nameA:'Alpha',nameB:'Beta'},
    effectiveAt:'2026-06-01T00:00:00Z',
    knownAt:'2026-06-01T00:00:00Z',
  });
  assert.equal(preview.qualification.qualified,false);
  assert.deepEqual(preview.qualification.missingRequiredMappingIds,[]);
  assert.deepEqual(preview.qualification.ambiguousTargetKeys,['domain-field:counterparty:displayName']);
  assert.equal(preview.writeAuthorized,false);
  assert.equal(preview.ownerCommand,null);
});

test('C6 read-import canonical snapshot resists prototype keys and caller mutation', () => {
  const value=registry();
  value.registerAdapter({
    id:'safe-envelope',sourceKind:'GENERAL',sourceSchemaRef:'json:safe:v1',profileId:'ru-base',
    mappings:[
      {id:'name',sourcePath:'name',targetRole:'domain-field',targetFamily:'counterparty',targetField:'displayName'},
    ],
  });
  const payload=JSON.parse('{"__proto__":{"polluted":true},"name":"Stable","nested":{"value":1}}');
  const preview=value.readImportPreview({
    adapterId:'safe-envelope',
    sourceRecordId:'row:safe',
    sourcePayload:payload,
    effectiveAt:'2026-06-01T00:00:00Z',
    knownAt:'2026-06-01T00:00:00Z',
  });
  payload.name='Mutated';
  payload.nested.value=9;
  assert.equal({}.polluted,undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(preview.sourceEnvelope.payload,'__proto__'),true);
  assert.equal(preview.sourceEnvelope.payload.name,'Stable');
  assert.equal(preview.sourceEnvelope.payload.nested.value,1);
  assert.equal(Object.isFrozen(preview.sourceEnvelope.payload),true);
  assert.equal(Object.isFrozen(preview.sourceEnvelope.payload.nested),true);
});

test('C6 read-import rejects non-canonical or cyclic payload values', () => {
  const value=registry();
  value.registerAdapter({
    id:'canonical-only',sourceKind:'GENERAL',sourceSchemaRef:'json:canonical:v1',profileId:'ru-base',
    mappings:[
      {id:'name',sourcePath:'name',targetRole:'domain-field',targetFamily:'counterparty',targetField:'displayName'},
    ],
  });
  assert.throws(
    ()=>value.readImportPreview({
      adapterId:'canonical-only',sourceRecordId:'row:function',
      sourcePayload:{name:'x',bad:()=>true},
      effectiveAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',
    }),
    (error)=>error instanceof JurisdictionSourceProfileError
      && error.code==='INVALID_JURISDICTION_SOURCE_VALUE',
  );
  const cyclic={name:'x'};cyclic.self=cyclic;
  assert.throws(
    ()=>value.readImportPreview({
      adapterId:'canonical-only',sourceRecordId:'row:cycle',sourcePayload:cyclic,
      effectiveAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',
    }),
    (error)=>error instanceof JurisdictionSourceProfileError
      && error.code==='INVALID_JURISDICTION_SOURCE_VALUE',
  );
});


test('C6 read-import uses one canonical snapshot and rejects accessor/hidden/symbol fields', () => {
  const value=registry();
  value.registerAdapter({
    id:'snapshot-once',sourceKind:'GENERAL',sourceSchemaRef:'json:snapshot:v1',profileId:'ru-base',
    mappings:[
      {id:'name',sourcePath:'name',targetRole:'domain-field',targetFamily:'counterparty',targetField:'displayName'},
    ],
  });

  let reads=0;
  const accessor={};
  Object.defineProperty(accessor,'name',{enumerable:true,get(){reads+=1;return reads===1?'first':'second';}});
  assert.throws(
    ()=>value.readImportPreview({
      adapterId:'snapshot-once',sourceRecordId:'row:accessor',sourcePayload:accessor,
      effectiveAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',
    }),
    (error)=>error instanceof JurisdictionSourceProfileError
      && error.code==='INVALID_JURISDICTION_SOURCE_VALUE',
  );
  assert.equal(reads,0);

  const hidden={name:'Stable'};
  Object.defineProperty(hidden,'secret',{enumerable:false,value:'hidden'});
  const symbolic={name:'Stable'};
  symbolic[Symbol('secret')]='hidden';
  for(const sourcePayload of [hidden,symbolic]){
    assert.throws(
      ()=>value.readImportPreview({
        adapterId:'snapshot-once',sourceRecordId:'row:hidden',sourcePayload,
        effectiveAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',
      }),
      (error)=>error instanceof JurisdictionSourceProfileError
        && error.code==='INVALID_JURISDICTION_SOURCE_VALUE',
    );
  }
});
