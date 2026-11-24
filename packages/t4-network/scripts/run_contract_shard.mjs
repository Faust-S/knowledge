import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// CI isolates the expensive ORIGINAL signed Access relay tests, not a
// simplified signer or a smaller qualification. Local npm test stays whole.
// Every native test belongs to exactly one shard: any future test not
// explicitly in recovery/migration is included by native-base.
const root=fileURLToPath(new URL('../',import.meta.url));
const native='tests/original-native-host-network-owner.test.mjs';
const all=readdirSync(new URL('../tests/',import.meta.url))
  .filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'tests/'+name);
if(!all.includes(native))throw Error('ORIGINAL_NATIVE_CONTRACT_FILE_MISSING');
const flags={
  'native-base':['--test-skip-pattern=^(K28|K30|K33) '],
  'native-recovery-write':['--test-name-pattern=^K28 existing signed relay resumes '],
  'native-recovery-other':['--test-name-pattern=^K28 ','--test-skip-pattern=^K28 existing signed relay resumes '],
  'native-migration':['--test-name-pattern=^K30 '],
  'native-resume':['--test-name-pattern=^K33 '],
};
const shard=process.argv[2];
if(process.argv.length!==3||!(shard==='core'||Object.hasOwn(flags,shard)))
  throw Error('T4_CONTRACT_SHARD_REQUIRED');
const files=shard==='core'?all.filter(path=>path!==native):[native];
if(!files.length)throw Error('T4_CONTRACT_SHARD_EMPTY');
console.log('T4_CONTRACT_SHARD',JSON.stringify({shard,files:files.length,flags:flags[shard]??[]}));
const result=spawnSync(process.execPath,['--experimental-strip-types','--test',...(flags[shard]??[]),...files],
  {cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)process.exitCode=result.status??1;
