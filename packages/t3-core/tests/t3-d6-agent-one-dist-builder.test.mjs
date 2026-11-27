import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {buildOriginalAgentOneDist,requireOriginalAgentT2Product,
  materializeOriginalAgentT2Product,buildOriginalAgentOneDistFromQualifiedKernel}
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


test('G4 universal Agent One Dist rejects preauthorized Atlas or any default recipient',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'t3-no-default-recipient-'));
  try{
    const qualified=join(temp,'original-qualified-kernel');
    const profilePath=join(temp,'owned-agent-profile.json');
    const output=join(temp,'nonexistent-original-agent-dist');
    mkdirSync(qualified);
    const profile={
      schema:'IWXA_AGENT_ORIGINAL_T2_PRODUCT_PROFILE/1',
      productId:'iwxa.personal-agent',
      serviceId:'iwxa.personal-agent.workspace',
      configVersion:'0.6.0',origin:'http://127.0.0.1:18883',
      workspaceProfile:'generic',localStoreName:'iwxa-local',
      kernelVersion:'0.3.6',runtimeContract:'1.3.0',
      qualifiedArtifactId:'iwxa-kernel-k036-same-store-history-20261019-qualified.1',
      authorizedNativeOwner:'ORIGINAL_T3_SIGNED_EMPLOYEE',
      authorizedResultRecipient:null,installedAgentT3Mode:'EXPLICIT_OPT_IN',
    };
    for(const recipient of ['iwxa.atlas','domain:bazmed','*']){
      writeFileSync(profilePath,JSON.stringify({
        ...profile,authorizedResultRecipient:recipient,
      }));
      await assert.rejects(()=>materializeOriginalAgentT2Product({
        qualifiedKernelDist:qualified,agentProfile:profilePath,
        outputRoot:output,
      }),/T3_AGENT_ONE_DIST_OWNING_AGENT_PRODUCT_PROFILE_INVALID/);
      assert.equal(existsSync(output),false);
    }
    // The full positive test is the real original T2 browser/One Dist
    // qualification. This unit test MUST NOT fake a qualified T2 runtime.
  }finally{rmSync(temp,{recursive:true,force:true});}
});

// Invalid role must fail even before reading the qualified artifact.
test('native SOURCE selection cannot silently fall back to local or recipient assembly',async()=>{
  for(const opts of [{installedNetworkPilotRole:'SOURCE'},
    {desktopAgentControlOnly:true,installedNetworkPilotRole:'RECIPIENT'},
    {desktopAgentControlOnly:true,installedNetworkPilotRole:'LOCAL_T3'}]){
    await assert.rejects(()=>buildOriginalAgentOneDistFromQualifiedKernel(opts),
      /INSTALLED_T4_PILOT_PROFILE_REQUIRED/);
  }
});
