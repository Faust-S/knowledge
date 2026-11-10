import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const binding = JSON.parse(readFileSync(
  new URL('../../authority/G4_C1_EXACT_AUTHORITY_BINDING_2026-09-09.json', import.meta.url),
  'utf8',
));

test('recovered exact C1 binding pins accepted semantic root and source locks', () => {
  assert.equal(binding.schema, 'IWXA_T2_G4_C1_EXACT_AUTHORITY_BINDING_V1');
  assert.equal(binding.authority_archive.sha256, '7fcb4ed2f34d2244fd737f076dc2a2de33042ee41509d0cc19870078d70ffd6e');
  assert.equal(binding.authority_archive.semantic_root_sha256, 'f546ac83cc57fcddc7555e9dc5e8720df8553086f771be0d9a08cf8384969786');
  assert.equal(binding.source_lock_verification.result, 'PASS_5_OF_5_EXACT_PATH_AND_SHA256_MATCH');
});

test('recovered C1 policy forbids same-identity reactivation and invented total order', () => {
  assert.equal(
    binding.time_event_semantic_policy.machine_profile_locks.terminal_lineage,
    'SOURCE_RETRACTED_OR_REVOKED_NEVER_REACTIVATES_SAME_ENTRY_IDENTITY',
  );
  assert.equal(binding.time_event_semantic_policy.authority_total_order_tuple, null);
  assert.equal(binding.time_event_semantic_policy.authority_total_order_tuple_present, false);
  assert.equal(binding.time_event_semantic_policy.authority_tie_break_rule_present, false);
  assert.deepEqual(
    binding.time_event_semantic_policy.canonical_semantics,
    ['BITEMPORAL_EFFECTIVE_AND_KNOWLEDGE_TIME', 'CAUSAL_PARTIAL_ORDER', 'DELAYED_EVIDENCE_PRESERVATION'],
  );
});
