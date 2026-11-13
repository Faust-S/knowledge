import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const route = readFileSync(new URL('../docs/T3_ACTIVITY_PROCESS_EVIDENCE_AI_ROUTING_RU.md', import.meta.url), 'utf8');
test('AI routes identify single T3 owner and all six flows without private checkout', () => {
  assert.match(route, /packages\/t3-core\//);
  assert.match(route, /modules\/activity-base-anonymizer\//);
  for (const id of ['PROCESS_CAPTURE','MODEL_VERIFICATION','GRANT_OR_REVOCATION','DERIVE_AND_ANONYMIZE','TRANSFER_AND_REUSE','OPTIMIZATION'])
    assert.match(route, new RegExp('\\b'+id+'\\b'));
  assert.match(route, /No private checkout/);
  assert.match(route, /not new public Kernel methods/);
  assert.match(route, /T3_READY=false/);
  assert.match(route, /read-only/);
});
