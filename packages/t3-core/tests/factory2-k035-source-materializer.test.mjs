import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {materializeFactory2K035Products} from '../scripts/factory2-k035-source-materializer.mjs';

const canonicalRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repositoryRoot=resolve(canonicalRoot,'../../../..');
const authorityPath=resolve(canonicalRoot,'../canonical-source-inputs/k035-rc20/SOURCE_AUTHORITY.json');

test('Factory 2 materializes exact current K035 Kernel and Workspace base bytes from current source inputs',()=>{
  const out=mkdtempSync(join(tmpdir(),'factory2-k035-'));
  const receipt=materializeFactory2K035Products({authorityPath,repositoryRoot,outputRoot:out});
  assert.equal(receipt.status,'PASS');
  assert.equal(receipt.kernelTarget,'0.3.5');
  assert.equal(receipt.historicalRecoveryRequired,false);
  assert.equal(receipt.components.kernel.sha256,'1c484218cfb86d776d57a3bd21f9b1ad606840e93711474a346dd1989352ce73');
  assert.equal(receipt.components.workspace.sha256,'bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e');
  assert.equal(receipt.chunks.reduce((sum,row)=>sum+row.sizeBytes,0),29488550);
  assert.ok(readFileSync(join(out,receipt.components.kernel.artifact)).length>0);
  assert.ok(readFileSync(join(out,receipt.components.workspace.artifact)).length>0);
});
