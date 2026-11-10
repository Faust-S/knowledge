import assert from 'node:assert/strict';
import test from 'node:test';
import {screenSyntheticDisclosure} from '../modules/activity-base-anonymizer/risk.mjs';
import {buildSyntheticExample, sha256Canonical, ActivityHold} from '../modules/activity-base-anonymizer/engine.mjs';

const copy = (data) => structuredClone(data);
async function repin(data) {
  for (const pin of data.source_versions) {
    const records = data.events.filter((e) => e.source_id === pin.source_id && e.source_revision === pin.revision);
    pin.events_sha256 = await sha256Canonical(records.sort((a,b) => a.event_id.localeCompare(b.event_id, 'en')));
  }
  return data;
}
const analyze = async (change) => {
  const data = await buildSyntheticExample();
  if (change) change(data);
  return screenSyntheticDisclosure(await repin(data));
};
const reasons = (result) => result.risk.reason_codes;

test('A2 keeps repeated graphs as internal review candidates only', async () => {
  const {preview, risk} = await analyze();
  assert.equal(risk.status, 'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
  assert.equal(risk.anonymity, 'NOT_ESTABLISHED');
  assert.equal(risk.residual_risk, 'UNDETERMINED');
  assert.equal(risk.export_allowed, false);
  assert.equal(risk.iwxa_package, null);
  assert.equal(preview.processes.length, 2);
  assert.equal(risk.structural_candidate.length, 2);
  assert.ok(risk.structural_candidate.every((p) => p.cohort_band === '3-9'));
  assert.ok(risk.structural_candidate.every((p) => p.observed_order.every((e) => e.cohort_band === '3-9')));
});

test('A2 structural candidate excludes direct IDs, email, exact timestamps, amount, secrets and hashes', async () => {
  const source = await buildSyntheticExample();
  for (const e of source.events) {
    e.payload = {email: 'alexandra.smith@example.invalid', customer_id: 'CUSTOMER-SECRET-34',
      commercial_secret: 'MARGIN_142.733', health: 'PRIVATE_HEALTH_VALUE', token: 'ACCESS_SECRET_345'};
    e.occurred_at = '2026-09-17T21:09:27.333Z';
    e.exact_amount = 142733;
    e.counterparty_ref = 'PRIVATE_ORG_528';
  }
  const input = await repin(source);
  const result = await screenSyntheticDisclosure(input);
  assert.equal(result.risk.status, 'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
  const serialized = JSON.stringify(result.risk);
  for (const key of ['alexandra', 'CUSTOMER-SECRET', 'PRIVATE_ORG', '142733', 'MARGIN_',
    'PRIVATE_HEALTH_VALUE', 'ACCESS_SECRET', '2026-09-17', 'RARE_SYNTHETIC_ACTOR',
    'synthetic_subject_a', input.source_versions[0].events_sha256,
    'source_001', 'fulfilment_case_1', 'approved', 'reviewer']) {
    assert.equal(serialized.includes(key), false, key);
  }
  assert.equal(serialized.includes('trace_occurrences'), false);
});

test('rare full trace holds even when most stages and roles are common', async () => {
  const result = await analyze((data) => {
    const one = data.events.find((e) => e.case_ref === 'fulfilment_case_1' && e.ordinal === 3);
    one.state_binding = 'special_case_unique_step';
  });
  assert.equal(result.risk.status, 'HOLD');
  assert.ok(reasons(result).includes('RARE_FULL_TRACE_OR_ROLE_PATTERN'));
  assert.equal(result.risk.structural_candidate, null);
});

test('rare role within otherwise identical stages holds', async () => {
  const result = await analyze((data) => {
    data.events.find((e) => e.case_ref === 'service_case_2' && e.ordinal === 2).role_binding = 'unique_officer';
  });
  assert.equal(result.risk.status, 'HOLD');
  assert.ok(reasons(result).includes('RARE_FULL_TRACE_OR_ROLE_PATTERN'));
});

test('cohort less than three unique cases holds even when order is preserved', async () => {
  const result = await analyze((data) => {
    data.events = data.events.filter((e) => e.case_ref !== 'service_case_3');
  });
  assert.equal(result.risk.status, 'HOLD');
  assert.ok(reasons(result).includes('RARE_FULL_TRACE_OR_ROLE_PATTERN'));
});

test('rare graph cannot be silently generalized by deleting essential stage', async () => {
  const result = await analyze((data) => {
    data.events.find((e) => e.case_ref === 'fulfilment_case_3' && e.ordinal === 4).state_binding = 'nonreproducible_rare_dependency';
  });
  assert.equal(result.risk.status, 'HOLD');
  assert.equal(result.risk.structural_candidate, null);
});

test('single relationship link never moves into a derived workflow', async () => {
  const result = await analyze((data) => {
    data.events[0].relationship_refs = ['rare_supplier_for_exact_client_99'];
  });
  assert.equal(result.risk.status, 'HOLD');
  assert.ok(reasons(result).includes('UNVERIFIED_RELATIONSHIP_DEPENDENCY'));
  assert.equal(JSON.stringify(result.risk).includes('rare_supplier'), false);
});

test('unapproved active authority in a source produces HOLD without leaking key', async () => {
  const result = await analyze((data) => { data.events[0].credential = 'PRIVATE_WORKPLACE_ACCESS_KEY'; });
  assert.equal(result.risk.status, 'HOLD');
  assert.ok(reasons(result).includes('ACTIVE_AUTHORITY_CANNOT_TRANSFER'));
  assert.equal(JSON.stringify(result.risk).includes('PRIVATE_WORKPLACE'), false);
});

test('unknown synthetic field holds, rather than assuming it contains no identifiers', async () => {
  const result = await analyze((data) => { data.events[0].unique_commercial_field = 'Top supplier secret'; });
  assert.equal(result.risk.status, 'HOLD');
  assert.ok(reasons(result).includes('UNREVIEWED_EVENT_FIELDS'));
});

test('unverified event is not presented as replayable', async () => {
  const result = await analyze((data) => { data.events[0].status = 'inferred'; });
  assert.equal(result.risk.status, 'HOLD');
  assert.ok(reasons(result).includes('UNVERIFIED_STEPS_IN_STRUCTURE'));
});

test('source mutation without repinning is refused before any risk verdict', async () => {
  const data = await buildSyntheticExample();
  data.events[0].payload.token = 'INJECTED_SECRET';
  await assert.rejects(screenSyntheticDisclosure(data),
    (e) => e instanceof ActivityHold && e.code === 'SOURCE_PIN_DIGEST_MISMATCH');
});

test('A0 source alone is insufficient for A2', async () => {
  const data = await buildSyntheticExample();
  data.schema = 'IWXA_SYNTHETIC_A0_SNAPSHOT/0.1';
  delete data.source_versions;
  const {risk} = await screenSyntheticDisclosure(data);
  assert.equal(risk.status, 'HOLD');
  assert.ok(reasons({risk}).includes('A1_PINNED_SYNTHETIC_SOURCE_REQUIRED'));
});

test('repeated records with sensitive values changed give exactly the same A2 structure', async () => {
  const source = await buildSyntheticExample();
  const second = copy(source);
  second.events.forEach((e) => {e.payload.secret = 'DIFFERENT_SECURE_SOURCE_SECRET'; e.actor_ref = 'DIFFERENT_NAME';});
  await repin(second);
  const firstRisk = (await screenSyntheticDisclosure(source)).risk;
  const secondRisk = (await screenSyntheticDisclosure(second)).risk;
  assert.deepEqual(firstRisk, secondRisk);
  assert.deepEqual(source, await buildSyntheticExample());
});

test('does not claim anonymous or produce transferable package even with repeated traces', async () => {
  const {risk} = await analyze();
  assert.equal(JSON.stringify(risk).includes('ANONYMOUS'), false);
  assert.equal(risk.export_allowed, false);
  assert.equal(risk.iwxa_package, null);
});