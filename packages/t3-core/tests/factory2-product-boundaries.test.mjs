import test from 'node:test';
import assert from 'node:assert/strict';
import {factory2CommonModulesDescriptor} from '../src/factory2/products/common-modules/common-modules.mjs';
import {factory2DomainKeysDescriptor,FACTORY2_DOMAIN_KEYS_SCHEMA_INVENTORY} from '../src/factory2/products/domain-keys/domain-keys.mjs';

test('Factory 2 Common Modules has an explicit current product boundary with no write authority',()=>{
  const x=factory2CommonModulesDescriptor();
  assert.equal(x.productId,'common-modules');
  assert.equal(x.generation,2);
  assert.equal(x.predecessor.version,'0.4.1');
  assert.equal(x.genericWriteAuthority,false);
  assert.equal(x.productionActivation,false);
  assert.equal(x.completeness,'PARTIAL');
});
test('Factory 2 Domain Keys is first-class and binds the exact current five-schema snapshot',()=>{
  const x=factory2DomainKeysDescriptor();
  assert.equal(x.productId,'domain-keys');
  assert.equal(x.predecessor.version,'2.4.5');
  assert.equal(x.currentSnapshot.schemaFamily,'keys-2.0');
  assert.equal(x.currentSnapshot.schemaCount,5);
  assert.equal(FACTORY2_DOMAIN_KEYS_SCHEMA_INVENTORY.length,5);
  assert.equal(new Set(FACTORY2_DOMAIN_KEYS_SCHEMA_INVENTORY).size,5);
  assert.equal(x.genericWriteAuthority,false);
});
