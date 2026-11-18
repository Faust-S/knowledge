import test from 'node:test';
import assert from 'node:assert/strict';
import {originalImportPaths,originalImportTarget,runOriginalPrivateOwnerSourceCheck}
  from '../scripts/qualify-original-private-d3-owner.mjs';

test('bounded original import walker recognizes native ESM imports',()=>{
  const text=`import x from '../access-control/core.mjs';\n`+
    `export {x} from './helper.mjs';\n`+
    `import '../reconciliation/engine.mjs';\n`+
    `const x=await import('./dynamic.mjs');`;
  assert.deepEqual(originalImportPaths(text),[
    '../access-control/core.mjs','./helper.mjs',
    '../reconciliation/engine.mjs','./dynamic.mjs']);
  assert.equal(originalImportTarget('interop/runtime.mjs','../access-control/core.mjs'),
    'access-control/core.mjs');
  assert.equal(originalImportTarget('interop/runtime.mjs','./helper.mjs'),
    'interop/helper.mjs');
});

test('bounded private file importer rejects foreign paths and non-JS extensions',()=>{
  for(const value of ['../../secrets/token','../unrelated/private.mjs',
    '../interop/secrets.env','https://evil.example/x.mjs','../../../etc/passwd']){
    assert.throws(()=>originalImportTarget('interop/runtime.mjs',value),/T3_PRIVATE_IMPORT/);
  }
});

test('missing scoped credential is refused before any network access',async()=>{
  await assert.rejects(runOriginalPrivateOwnerSourceCheck({token:''}),
    {message:'T3_KNOWLEDGE_READ_TOKEN_NOT_AVAILABLE'});
});

test('fetches only transitive original test modules without cloning or credentials in child',async()=>{
  const files={
    'tests/admin-original-host-port.test.mjs':
      "import test from 'node:test'; import assert from 'node:assert/strict';"+
      "import {proof} from '../interop/tiny.mjs';"+
      "test('native D3 compares every signed field independent of original JSON key order',()=>{"+
      "assert.equal(proof,42);assert.equal(process.env.T3_READ_TOKEN,undefined)});",
    'interop/tiny.mjs': 'export const proof=42;',
  };
  const requested=[];
  const response=await runOriginalPrivateOwnerSourceCheck({token:'not-real-token',assets:[],
    testFiles:['tests/admin-original-host-port.test.mjs'],
    fetchFile:async path=>{
      requested.push(path);
      if(!(path in files))throw Error('UNEXPECTED_PRIVATE_MODULE_REQUEST');
      return Buffer.from(files[path]);
    }});
  assert.deepEqual(requested.sort(),Object.keys(files).sort());
  assert.equal(response.tests,1);
  assert.equal(response.passed,1);
  assert.equal(response.count,2);
});
