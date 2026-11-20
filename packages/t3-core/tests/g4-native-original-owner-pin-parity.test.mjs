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
  resolve(root,'.github/workflows/t3-installed-original-admin-center.yml'),'utf8');
test('source Agent D3 witness uses the exact installed original private T3 Owner SHA',()=>{
  const owner=installed.match(/repository: Faust-S\/T3\s*\r?\n\s*ref: ([a-f0-9]{40})\b/);
  assert.ok(owner,'installed original T3 private checkout pin required');
  assert.match(T3_ORIGINAL_NATIVE_EMPLOYEE_PIN,/^[a-f0-9]{40}$/);
  assert.equal(ORIGINAL_PRIVATE_SOURCE_PIN,owner[1],
    'original source qualification must use installed private Owner');
  assert.equal(T3_ORIGINAL_NATIVE_EMPLOYEE_PIN,owner[1],
    'source-only Agent witness cannot silently test a different signed Owner');
});
test('original signed D3 Agent source is the SAME SHA installed by G4 Windows',()=>{
  const installedAgent=readFileSync(
    resolve(root,'.github/workflows/t3-g4-installed-current-agent06.yml'),'utf8');
  const match=installedAgent.match(
    /repository: Faust-S\/iwxa-personal-agent\s*\r?\n\s*ref: ([a-f0-9]{40})\b/);
  assert.ok(match,'current installed Agent checkout pin must exist');
  assert.equal(AGENT_ORIGINAL_PIN,match[1],
    'source D3 must qualify the exact currently installed Agent revision');
});
test('private Agent employee port stays pinned and is not silently a test stub',()=>{
  assert.match(AGENT_ORIGINAL_PIN,/^[a-f0-9]{40}$/);
  assert.notEqual(AGENT_ORIGINAL_PIN,T3_ORIGINAL_NATIVE_EMPLOYEE_PIN);
});
