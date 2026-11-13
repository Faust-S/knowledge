// Regression: canonical original T2 0.3.6 Zod is STRICT for a passport
// child declaration. Portable .iwxa package schema is a different record.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const here=fileURLToPath(new URL('.',import.meta.url));
const root=new URL('../../src/kernel-client/contracts/runtime-1.3.0/schemas/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,root),'utf8'));
const service=read('service-schema-declaration.schema.json');
const pkg=read('package-schema.schema.json');

test('original T2 service passport child declaration uses outer schema id, not a package record',()=>{
  assert.deepEqual(service.required.sort(),[
    'schema_version','preserve_unknown','json_schema','embedded',
  ].sort());
  assert.deepEqual(Object.keys(service.properties).sort(),service.required.sort());
  assert.equal(service.additionalProperties,false);
  assert.equal(service.properties.json_schema.properties.type.const,'object');
  assert.deepEqual(service.properties.embedded.additionalProperties.required.sort(),
    ['schema_id','schema_version'].sort());
  assert.equal(Object.hasOwn(service.properties,'schema_id'),false);
  assert.equal(Object.hasOwn(service.properties,'canonical_sha256'),false);
  assert.ok(pkg.required.includes('schema_id'));
  assert.ok(pkg.required.includes('canonical_sha256'));
});
