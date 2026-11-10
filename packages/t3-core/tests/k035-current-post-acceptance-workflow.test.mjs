import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
test('retired Stage-D workflow cannot reintroduce mandatory technical approval',()=>{
 assert.equal(existsSync(new URL('../../../../../.github/workflows/IWXA_T2_K035_CURRENT_POST_ACCEPTANCE_STAGE_D_20260918.yml',import.meta.url)),false);
 const cli=readFileSync(new URL('../scripts/factory2-domain-run-cli.mjs',import.meta.url),'utf8');
 assert.ok(cli.includes("state.sourceOrigin==='CANONICAL_GIT_HEAD_TREE'?'GIT_ENGINEERING_READY'"));
});
