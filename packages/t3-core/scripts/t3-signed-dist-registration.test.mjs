import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assembleSignedControlDist} from './assemble-signed-control-dist.mjs';

const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const put=(root,path,content)=>{
  const full=join(root,path);mkdirSync(join(full,'..'),{recursive:true});
  writeFileSync(full,content);
};
function sample({bli=true,worker=true,passportSha=true}={}){
  const root=mkdtempSync(join(tmpdir(),'t3-d1-d5-dist-test-'));
  const original=join(root,'original'),compiled=join(root,'compiled'),output=join(root,'dist');
  const passport={
    service_id:'iwxa.workspace.integration',service_version:'1.0.0',
    base_path:'/workspace/',supported_levels:['T0','T1','T2'],
    input_object_types:['iwxa.demo.note'],output_object_types:['iwxa.demo.note'],
    schemas:{'iwxa.demo.note':{schema_version:'1.0.0'}},
    permissions:{workspace:{read:true},
      objects:{read:['iwxa.demo.note'],write:['iwxa.demo.note'],delete:[]}},
  };
  const config={
    workspace_service_id:'iwxa.workspace.integration',base_path:'/workspace/',
    module_loading:{strategy:'compile-time-registry',allow_remote_modules:false},
    security:{trusted_build_modules_only:true},
    modules:[{module_id:'iwxa.workspace.base',state:'active'}],
  };
  const domain={origin:'http://127.0.0.1:38089',
    security:{allowed_object_classes:['iwxa.demo.note']}};
  put(original,'_iwxa/loader.js','ORIGINAL_T2_LOADER');
  put(original,'_iwxa/runtime/0.3.6/runtime.js','ORIGINAL_T2_KERNEL');
  put(original,'_iwxa/domain.json',JSON.stringify(domain));
  put(original,'_iwxa/domain-shell.json','{}');
  put(original,'workspace/workspace.config.json',JSON.stringify(config));
  put(original,'workspace/favicon.ico','ICON');
  const passportPath='_iwxa/services/iwxa.workspace.integration.json';
  put(original,passportPath,JSON.stringify(passport));
  put(original,'_iwxa/service-catalog.json',JSON.stringify({
    count:1,entries:[{service_id:passport.service_id,
      file:passportPath,sha256:passportSha?hash(join(original,passportPath)):'bad'}],
  }));
  const html='<!doctype html><base href="/workspace/">'+
    '<script type="module" src="/workspace/assets/app.js"></script>';
  for(const name of ['signed-workspace.html','isolated-signed-workspace.html',
    'trusted-kernel-realm.html'])put(compiled,name,html);
  const marks=bli?'iwxa.t3.local-inference.panel iwxa.t3.local-inference.launcher '+
    'iwxa.t3.local-inference.open':'original-app';
  put(compiled,'assets/app.js',marks);
  if(worker)put(compiled,'assets/model-worker-TEST.js','IWXA_NETWORK_DENIED_IN_WORKER');
  return {root,original,compiled,output,passportPath};
}
const run=s=>assembleSignedControlDist({t2Dist:s.original,
  t3Build:s.compiled,outputDir:s.output,testOnlyUnqualifiedFixture:true});
test('signed T3 dist registers original BLI1 service and preserves inherited Kernel',()=>{
  const s=sample();
  try{
    const before=hash(join(s.original,s.passportPath));
    const result=run(s);
    assert.equal(result.local_inference_registered,true);
    const cfg=JSON.parse(readFileSync(join(s.output,'workspace/workspace.config.json')));
    const mod=cfg.modules.find(row=>row.module_id==='iwxa.t3.local-inference');
    assert.equal(mod?.state,'active');
    assert.deepEqual(mod.required_operations,['t1.getWorkspace']);
    const pass=JSON.parse(readFileSync(join(s.output,s.passportPath)));
    assert.ok(pass.schemas['iwxa.local-inference.draft']);
    assert.ok(pass.permissions.objects.write.includes('iwxa.local-inference.draft'));
    const catalog=JSON.parse(readFileSync(join(s.output,'_iwxa/service-catalog.json')));
    assert.equal(catalog.entries[0].sha256,hash(join(s.output,s.passportPath)));
    assert.notEqual(catalog.entries[0].sha256,before);
    assert.equal(hash(join(s.original,s.passportPath)),before);
    assert.equal(readFileSync(join(s.output,'_iwxa/loader.js'),'utf8'),'ORIGINAL_T2_LOADER');
    assert.equal(readFileSync(join(s.output,'_iwxa/runtime/0.3.6/runtime.js'),'utf8'),'ORIGINAL_T2_KERNEL');
  }finally{rmSync(s.root,{recursive:true,force:true});}
});
test('non-BLI build keeps the inherited service unchanged',()=>{
  const s=sample({bli:false,worker:false});
  try{
    const before=hash(join(s.original,s.passportPath));
    assert.equal(run(s).local_inference_registered,false);
    assert.equal(hash(join(s.output,s.passportPath)),before);
    const cfg=JSON.parse(readFileSync(join(s.output,'workspace/workspace.config.json')));
    assert.equal(cfg.modules.some(x=>x.module_id==='iwxa.t3.local-inference'),false);
  }finally{rmSync(s.root,{recursive:true,force:true});}
});
test('incomplete model module cannot produce a signed dist',()=>{
  for(const variant of [{bli:true,worker:false},{bli:false,worker:true}]){
    const s=sample(variant);
    try{
      assert.throws(()=>run(s),/LOCAL_INFERENCE_COMPILED_MODULE_INCOMPLETE/);
      assert.equal(existsSync(s.output),false);
    }finally{rmSync(s.root,{recursive:true,force:true});}
  }
});
test('tampered inherited passport cannot gain new object permissions',()=>{
  const s=sample({passportSha:false});
  try{
    assert.throws(()=>run(s),/ORIGINAL_SERVICE_PASSPORT_INTEGRITY/);
    assert.equal(existsSync(s.output),false);
  }finally{rmSync(s.root,{recursive:true,force:true});}
});
test('preexisting incompatible BLI schema rejects publication, leaves original intact',()=>{
  const s=sample();
  try{
    const path=join(s.original,s.passportPath);
    const p=JSON.parse(readFileSync(path,'utf8'));
    p.schemas['iwxa.local-inference.draft']={schema_version:'9.9.9'};
    writeFileSync(path,JSON.stringify(p));
    const catalogPath=join(s.original,'_iwxa/service-catalog.json');
    const cat=JSON.parse(readFileSync(catalogPath,'utf8'));
    cat.entries[0].sha256=hash(path);
    writeFileSync(catalogPath,JSON.stringify(cat));
    assert.throws(()=>run(s),/T3_D5_MODULE_SCHEMA_CONFLICT/);
    assert.equal(existsSync(s.output),false);
  }finally{rmSync(s.root,{recursive:true,force:true});}
});
