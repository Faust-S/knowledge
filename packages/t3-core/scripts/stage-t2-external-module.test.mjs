import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {stageT2ExternalModule} from './stage-t2-external-module.mjs';
function sample(){
 const dir=mkdtempSync(join(tmpdir(),'t2-domain-')),host=join(dir,'host'),src=join(dir,'source');
 mkdirSync(join(host,'src/composition'),{recursive:true});mkdirSync(join(host,'src/modules'),{recursive:true});mkdirSync(src);
 writeFileSync(join(host,'src/composition/product-module-extensions.ts'),
 'export const PRODUCT_MODULE_EXTENSIONS: ModuleLoaderTable = Object.freeze({\n});');
 writeFileSync(join(src,'index.ts'),'export default {};');
 const manifest={module_id:'iwxa.domain.advice-logistics',compatibility:{workspace_contract:'0.1.0',runtime_contract:'1.3.0'},security:{direct_indexeddb:false,remote_code:false,iwxa_executable_payload:false}};
 writeFileSync(join(src,'manifest.json'),JSON.stringify(manifest));
 return {host,src};
}
test('real module is attached only to disposable Host',()=>{
 const v=sample();const result=stageT2ExternalModule({stageRoot:v.host,sourceDir:v.src,moduleId:'iwxa.domain.advice-logistics',moduleDirectory:'advice-logistics'});
 assert.equal(result.authorityGranted,false);
 assert.match(readFileSync(join(v.host,'src/composition/product-module-extensions.ts'),'utf8'),/iwxa\.domain\.advice-logistics/);
 assert.equal(readFileSync(join(v.src,'index.ts'),'utf8'),'export default {};');
});
test('duplicate module and unsafe identifier fail closed',()=>{
 const v=sample(),args={stageRoot:v.host,sourceDir:v.src,moduleId:'iwxa.domain.advice-logistics',moduleDirectory:'advice-logistics'};
 stageT2ExternalModule(args);
 assert.throws(()=>stageT2ExternalModule(args),/ALREADY_PRESENT/);
 assert.throws(()=>stageT2ExternalModule({...args,moduleDirectory:'../escape'}),/ID_INVALID/);
});

test('CLI executes shared staging helper and leaves canonical source unchanged',()=>{
 const v=sample();const script=fileURLToPath(new URL('./stage-t2-external-module.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[script,v.host,v.src,'iwxa.domain.advice-logistics','advice-logistics'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).authorityGranted,false);
 assert.ok(readFileSync(join(v.host,'src/composition/product-module-extensions.ts'),'utf8').includes('iwxa.domain.advice-logistics'));
});
test('a second domain can join existing domain loaders',()=>{
 const v=sample();stageT2ExternalModule({stageRoot:v.host,sourceDir:v.src,moduleId:'iwxa.domain.advice-logistics',moduleDirectory:'advice-logistics'});
 const other=join(v.host,'..','d06-source');mkdirSync(other);writeFileSync(join(other,'index.ts'),'export default {};');
 const m=JSON.parse(readFileSync(join(v.src,'manifest.json'),'utf8'));m.module_id='iwxa.domain.komplektovod';
 writeFileSync(join(other,'manifest.json'),JSON.stringify(m));
 stageT2ExternalModule({stageRoot:v.host,sourceDir:other,moduleId:'iwxa.domain.komplektovod',moduleDirectory:'komplektovod'});
 const table=readFileSync(join(v.host,'src/composition/product-module-extensions.ts'),'utf8');
 for(const id of ['iwxa.domain.advice-logistics','iwxa.domain.komplektovod'])assert.ok(table.includes(id));
});

test('cross-domain command conflict is rejected before Host mutation',()=>{
 const v=sample();
 const put=(source,id,command)=>{
   const m=JSON.parse(readFileSync(join(v.src,'manifest.json'),'utf8'));
   m.module_id=id;m.contributions={commands:[{id:command}]};
   writeFileSync(join(source,'manifest.json'),JSON.stringify(m));
 };
 put(v.src,'iwxa.domain.advice-logistics','shared.command');
 stageT2ExternalModule({stageRoot:v.host,sourceDir:v.src,moduleId:'iwxa.domain.advice-logistics',moduleDirectory:'advice-logistics'});
 const other=join(v.host,'..','conflicting-domain');mkdirSync(other);writeFileSync(join(other,'index.ts'),'export default {};');
 put(other,'iwxa.domain.komplektovod','shared.command');
 const composition=join(v.host,'src/composition/product-module-extensions.ts');
 const before=readFileSync(composition,'utf8');
 assert.throws(()=>stageT2ExternalModule({stageRoot:v.host,sourceDir:other,moduleId:'iwxa.domain.komplektovod',moduleDirectory:'komplektovod'}),/CONTRIBUTION_COLLISION/);
 assert.equal(readFileSync(composition,'utf8'),before);
 assert.equal(existsSync(join(v.host,'src/modules/komplektovod')),false);
});
test('built-in command conflict is rejected before Host mutation',()=>{
 const v=sample();const base=join(v.host,'src/modules/base');mkdirSync(base);
 writeFileSync(join(base,'manifest.json'),JSON.stringify({module_id:'iwxa.workspace.base',contributions:{commands:[{id:'workspace.focus.select'}]}}));
 const m=JSON.parse(readFileSync(join(v.src,'manifest.json'),'utf8'));
 m.contributions={commands:[{id:'workspace.focus.select'}]};
 writeFileSync(join(v.src,'manifest.json'),JSON.stringify(m));
 assert.throws(()=>stageT2ExternalModule({stageRoot:v.host,sourceDir:v.src,moduleId:'iwxa.domain.advice-logistics',moduleDirectory:'advice-logistics'}),/CONTRIBUTION_COLLISION/);
 assert.equal(existsSync(join(v.host,'src/modules/advice-logistics')),false);
});
