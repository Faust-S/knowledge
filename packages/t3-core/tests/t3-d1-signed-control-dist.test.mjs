import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {assembleSignedControlDist} from '../scripts/assemble-signed-control-dist.mjs';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'t3-d1-assemble-'));
  const t2=join(dir,'t2'),t3=join(dir,'compiled'),out=join(dir,'out');
  const put=(root,path,content)=>{
    const target=join(root,path);mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,content);
  };
  put(t2,'_iwxa/loader.js','original loader');
  put(t2,'_iwxa/runtime/0.3.6/runtime.js','original Kernel 0.3.6');
  put(t2,'_iwxa/domain.json',JSON.stringify({origin:'http://127.0.0.1:18883'}));
  put(t2,'_iwxa/domain-shell.json','{}');
  put(t2,'_iwxa/service-catalog.json',JSON.stringify({count:1,entries:[{service_id:'test.original'}]}));
  put(t2,'workspace/workspace.config.json',JSON.stringify({workspace_service_id:'test.original'}));
  put(t2,'workspace/index.html','<p>Original T2 unchanged</p>');
  put(t2,'workspace/assets/original.js','Original T2 chunk');
  put(t3,'signed-workspace.html','<base href="/workspace/"><script type="module" src="/workspace/assets/signed-123.js"></script>');
  put(t3,'assets/signed-123.js','console.log("signed")');
  put(t3,'assets/shared-456.css','body{}');
  put(t3,'favicon.ico','icon');
  return {dir,t2,t3,out,put,run:()=>assembleSignedControlDist({t2Dist:t2,t3Build:t3,outputDir:out})};
}
test('assemble installed Control one-dist from original Kernel, preserving every original asset',()=>{
  const f=fixture();
  try{
    const result=f.run();
    assert.equal(result.origin,'http://127.0.0.1:18883');
    assert.equal(result.original_runtime_unchanged,true);
    assert.equal(result.signed_assets,2);
    assert.equal(readFileSync(join(f.out,'workspace/index.html'),'utf8'),'<p>Original T2 unchanged</p>');
    assert.equal(readFileSync(join(f.out,'_iwxa/runtime/0.3.6/runtime.js'),'utf8'),'original Kernel 0.3.6');
    assert.equal(readFileSync(join(f.out,'workspace/assets/signed-123.js'),'utf8'),'console.log("signed")');
    assert.equal(readFileSync(join(f.out,'workspace/assets/original.js'),'utf8'),'Original T2 chunk');
    assert.equal(readFileSync(join(f.out,'workspace/favicon.ico'),'utf8'),'icon');
    assert.throws(()=>f.run(),/T3_D1_DIST_OUTPUT_ALREADY_EXISTS/);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('refuse workspace asset collisions before modifying the original T2 or writing output',()=>{
  const f=fixture();
  try{
    f.put(f.t2,'workspace/assets/signed-123.js','Different T2 asset');
    assert.throws(()=>f.run(),/T3_D1_DIST_SIGNED_ASSET_COLLISION/);
    assert.equal(existsSync(f.out),false);
    assert.equal(readFileSync(join(f.t2,'workspace/assets/signed-123.js'),'utf8'),'Different T2 asset');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('refuse non-local or missing Control origin and an absent original service',()=>{
  const f=fixture();
  try{
    f.put(f.t2,'_iwxa/domain.json',JSON.stringify({origin:'https://example.test'}));
    assert.throws(()=>f.run(),/T3_D1_DIST_PINNED_LOOPBACK_ORIGIN_REQUIRED/);
    f.put(f.t2,'_iwxa/domain.json',JSON.stringify({origin:'http://127.0.0.1:18883'}));
    f.put(f.t2,'_iwxa/service-catalog.json','{"entries":[]}');
    assert.throws(()=>f.run(),/T3_D1_DIST_ORIGINAL_WORKSPACE_SERVICE_REQUIRED/);
    assert.equal(existsSync(f.out),false);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
