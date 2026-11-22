// Reuse the EXACT private signed corporate Owner qualified in the installed
// Admin Windows D3. A source-only Agent run on an older signer cannot be
// accepted as matching the installed release. No source checkout or tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {T3_ORIGINAL_NATIVE_EMPLOYEE_PIN} from '../scripts/qualify-native-corporate-agent-process.mjs';
import {AGENT_ORIGINAL_PIN} from '../scripts/qualify-original-agent-d3-port.mjs';
import {ORIGINAL_PRIVATE_SOURCE_PIN} from '../scripts/qualify-original-private-d3-owner.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const installed=readFileSync(
  resolve(root,'.github/workflows/t3-admin-v8-full-owner-employee-d2.yml'),'utf8');
test('source Agent D3 witness uses the exact installed original private T3 Owner SHA',()=>{
  const owner=installed.match(/repository: Faust-S\/T3\s*\r?\n\s*ref: ([a-f0-9]{40})\b/);
  assert.ok(owner,'installed original T3 private checkout pin required');
  assert.match(installed,/-RequireD2Read -RequireOriginalEmployeeRegistry/,
    'installed Owner must carry both signed Activity and the employee registry');
  assert.match(T3_ORIGINAL_NATIVE_EMPLOYEE_PIN,/^[a-f0-9]{40}$/);
  assert.equal(ORIGINAL_PRIVATE_SOURCE_PIN,owner[1],
    'original source qualification must use installed private Owner');
  assert.equal(T3_ORIGINAL_NATIVE_EMPLOYEE_PIN,owner[1],
    'source-only Agent witness cannot silently test a different signed Owner');
});
test('original signed D3 Agent source is the exact released 0.6.2 SHA',()=>{
  // Prior public qualification 45068406431 pinned and ran this exact
  // release source; native installed qualification remains a SEPARATE gate.
  assert.equal(AGENT_ORIGINAL_PIN,
    '39a4f49ed9a5c0781c4a4769e9603ca8fb1e8d23',
    'source D3 cannot silently use the old 0.6 employee release');
});
test('private Agent employee port stays pinned and is not silently a test stub',()=>{
  assert.match(AGENT_ORIGINAL_PIN,/^[a-f0-9]{40}$/);
  assert.notEqual(AGENT_ORIGINAL_PIN,T3_ORIGINAL_NATIVE_EMPLOYEE_PIN);
});
