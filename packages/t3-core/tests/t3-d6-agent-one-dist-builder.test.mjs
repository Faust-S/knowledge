import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {buildOriginalAgentOneDist,requireOriginalAgentT2Product}
  from '../scripts/build-original-agent-one-dist.mjs';

test('original qualified T2 One Dist product builder cannot package a signed test Host as Personal Agent',()=>{
  const temp=mkdtempSync(join(tmpdir(),'t3-real-agent-product-'));
  const t2=join(temp,'t2-real-domain'),build=join(temp,'signed-ui');
  const output=join(temp,'one-dist'),receipt=join(temp,'one-dist-receipt.json');
  const put=(path,body)=>{
    const full=join(t2,path);mkdirSync(dirname(full),{recursive:true});
    writeFileSync(full,typeof body==='string'?body:JSON.stringify(body));
  };
  try{
    const serviceId='iwxa.personal-agent.workspace';
    mkdirSync(build,{recursive:true});
    const domain={domain_id:'iwxa.personal-agent',
      runtime:{kernel_release:'0.3.6',runtime_version:'0.3.6'},
      modules:[{service_id:serviceId}]};
    const config={domain_id:'iwxa.personal-agent',
      workspace_service_id:serviceId,
      host:{required_runtime_version:'0.3.6',
        required_contract_version:'1.3.0'}};
    put('_iwxa/domain.json',domain);
    put('workspace/workspace.config.json',config);
    assert.equal(requireOriginalAgentT2Product(t2).serviceId,serviceId);
    put('_iwxa/domain.json',{...domain,
      domain_id:'integration.workspace.iwxa.test'});
    assert.throws(()=>requireOriginalAgentT2Product(t2),
      /ORIGINAL_PRODUCT_IDENTITY_OR_RUNTIME_REQUIRED/);
    assert.throws(()=>buildOriginalAgentOneDist({
      t2Dist:t2,t3Build:build,outputDir:output,receiptPath:receipt}),
      /ORIGINAL_PRODUCT_IDENTITY_OR_RUNTIME_REQUIRED/);
    assert.equal(existsSync(output),false);
    assert.equal(existsSync(receipt),false);
    put('_iwxa/domain.json',domain);
    put('workspace/workspace.config.json',{...config,host:{
      ...config.host,required_contract_version:'1.2.0'}});
    assert.throws(()=>requireOriginalAgentT2Product(t2),
      /ORIGINAL_PRODUCT_IDENTITY_OR_RUNTIME_REQUIRED/);
    // There is deliberately no fabricated positive receipt. Only the
    // original production-qualified T2 assembler can produce that.
  }finally{rmSync(temp,{recursive:true,force:true});}
});
