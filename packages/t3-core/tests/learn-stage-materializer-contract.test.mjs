import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
test('canonical Host keeps external domains outside its module loader table',()=>{
 const source=readFileSync(new URL('../src/composition/product-module-extensions.ts',import.meta.url),'utf8');
 assert.match(source,/Object.freeze\(\{\s*\/\/ T2_EXTERNAL_DOMAIN_MODULES\s*\}\)/);
 assert.equal(existsSync(new URL('../../checkpoints/historical/materialize-learn-pilot-host-CYCLE16.mjs.txt',import.meta.url)),false);
});
