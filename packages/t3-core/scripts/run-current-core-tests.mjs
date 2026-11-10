#!/usr/bin/env node
// Execute every active Node unit test on Windows, Linux and macOS.
// Historical/experimental test generations have been removed from this tree.
import {readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const testsDir=join(root,'tests');
if(process.argv.length>2){
 console.error('CORE_TEST_RUNNER_UNKNOWN_ARGUMENTS');
 process.exit(2);
}
const names=readdirSync(testsDir,{withFileTypes:true})
 .filter(entry=>entry.isFile()&&entry.name.endsWith('.test.mjs'))
 .map(entry=>join(testsDir,entry.name)).sort();
if(names.length===0){
 console.error('CORE_TEST_SET_EMPTY');
 process.exit(2);
}
const result=spawnSync(process.execPath,['--test',...names],{
 cwd:root,stdio:'inherit',shell:false,
});
if(result.error)console.error('CORE_TEST_RUNNER_FAILED:',result.error.message);
process.exit(result.status??1);
