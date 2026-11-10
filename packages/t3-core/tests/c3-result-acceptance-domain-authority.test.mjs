import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESULT_ACCEPTANCE_AUTHORITY,
  ResultAcceptanceAuthorityError,
  assertDomainNativeResultAuthorityBinding,
  commonResultAcceptanceWriteAuthority,
} from '../src/modules/base/features/project-process/result-acceptance-authority.mjs';
import {
  normalizeAcceptance,
  normalizeResult,
} from '../src/modules/base/features/project-process/project-process.mjs';
import { PROJECT_PROCESS_SOURCE_CONTRACT } from '../src/modules/base/owners/project-process-source-contract.mjs';

function binding(overrides={}) {
  return {
    domainId:'D03',
    acceptedNativeResultRef:'artbazy:accepted-native-result',
    acceptanceCriteriaRefs:['criteria:quality','criteria:evidence'],
    resultProducer:'artbazy',
    canonicalAuthorityCore:'artbazy',
    stableIdentity:{
      workspace_id:'ws-1',
      object_id:'result-1',
      schema_id:'artbazy.result',
      schema_version:'1.0.0',
      created_by_service:'artbazy',
      updated_by_service:'artbazy',
    },
    provenanceRefs:['event:1','receipt:1'],
    exchangeEligibility:'policy:eligible',
    outboundProjectionRef:'projection:minimal',
    sourceRetainedContextRef:'context:source',
    ...overrides,
  };
}

test('C3 Result/Acceptance source-truth authority is domain-bound, not common-owner-bound', () => {
  assert.equal(RESULT_ACCEPTANCE_AUTHORITY.sourceTruthRule.ownership,'DOMAIN_BOUND');
  assert.equal(
    RESULT_ACCEPTANCE_AUTHORITY.sourceTruthRule.resultProducerSeparatedFromCanonicalAuthorityCore,
    true,
  );
  assert.deepEqual(commonResultAcceptanceWriteAuthority(),{
    result:false,
    acceptance:false,
    ownerId:'iwxa.project-process.owner',
    reason:'RESULT_AND_ACCEPTANCE_SOURCE_TRUTH_ARE_DOMAIN_BOUND',
  });
  assert.equal(
    Object.values(PROJECT_PROCESS_SOURCE_CONTRACT.bindings).some((binding) => binding.family === 'iwxa.result'),
    false,
  );
  assert.equal(
    Object.values(PROJECT_PROCESS_SOURCE_CONTRACT.bindings).some((binding) => binding.family === 'iwxa.acceptance'),
    false,
  );
});

test('domain-native Result binding requires producer, canonical authority, acceptance criteria, identity and provenance', () => {
  const value=assertDomainNativeResultAuthorityBinding(binding());
  assert.equal(value.sourceTruthBinding,true);
  assert.equal(value.resultProducer,'artbazy');
  assert.equal(value.canonicalAuthorityCore,'artbazy');
  assert.deepEqual(value.acceptanceCriteriaRefs,['criteria:quality','criteria:evidence']);
  assert.equal(value.stableIdentity.created_by_service,'artbazy');
  assert.deepEqual(value.provenanceRefs,['event:1','receipt:1']);
});

test('domain-native Result authority fails closed for unresolved or common authority', () => {
  assert.throws(
    () => assertDomainNativeResultAuthorityBinding(binding({canonicalAuthorityCore:'OWNER_DECISION_REQUIRED'})),
    (error) => error instanceof ResultAcceptanceAuthorityError
      && error.code === 'RESULT_AUTHORITY_OWNER_DECISION_REQUIRED',
  );
  assert.throws(
    () => assertDomainNativeResultAuthorityBinding(binding({resultProducer:'iwxa.project-process.owner'})),
    (error) => error?.code === 'COMMON_RESULT_PRODUCER_FORBIDDEN',
  );
  assert.throws(
    () => assertDomainNativeResultAuthorityBinding(binding({canonicalAuthorityCore:'iwxa.project-process.owner'})),
    (error) => error?.code === 'COMMON_RESULT_AUTHORITY_FORBIDDEN',
  );
});

test('common Result and Acceptance remain non-source-truth projections even when caller self-promotes them', () => {
  const result=normalizeResult({
    workspaceId:'ws-1',
    resultId:'result-1',
    projectId:'project-1',
    workId:'work-1',
    resultType:'artifact',
    value:{qualified:true},
    evidenceRefs:['evidence:1'],
    sourceTruth:true,
  });
  const acceptance=normalizeAcceptance({
    workspaceId:'ws-1',
    acceptanceId:'acceptance-1',
    projectId:'project-1',
    resultId:'result-1',
    criteria:[{criterionId:'quality',required:true,satisfied:true,evidenceRefs:['evidence:1']}],
    sourceTruth:true,
    derived:false,
  });
  assert.equal(result.sourceTruth,false);
  assert.equal(acceptance.sourceTruth,false);
  assert.equal(acceptance.derived,true);
});
