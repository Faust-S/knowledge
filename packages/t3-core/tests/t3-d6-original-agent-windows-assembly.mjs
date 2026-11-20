// Real Windows product assembly: use the ORIGINAL qualified T2 0.3.6
// Runtime 1.3.0, the existing T3 signed-control builder and native Agent
// product profile. No mock Kernel, alternative Host, signer or new Store.
// This runs before the optional BLI WebGPU Worker is compiled.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,readdirSync,mkdirSync}
  from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildOriginalAgentOneDistFromQualifiedKernel}
  from '../scripts/build-original-agent-one-dist.mjs';
import {assertQualifiedKernelArtifact}
  from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';

const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
assert.ok(qualified&&existsSync(qualified),'T3_WINDOWS_ORIGINAL_K036_REQUIRED');
const id='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const root=mkdtempSync(join(tmpdir(),'iwxa-t3-desktop-agent-real-'));
try{
  const profile=join(root,'original-agent-product.json');
  // Exactly the non-secret product profile that the installed Agent 0.6
  // uses. Native Windows checkout binds its own immutable Agent revision.
  writeFileSync(profile,JSON.stringify({
    schema:'IWXA_AGENT_ORIGINAL_T2_PRODUCT_PROFILE/1',
    productId:'iwxa.personal-agent',
    serviceId:'iwxa.personal-agent.workspace',
    configVersion:'0.6.0',origin:'http://127.0.0.1:18883',
    workspaceProfile:'generic',localStoreName:'iwxa-local',
    kernelVersion:'0.3.6',runtimeContract:'1.3.0',
    qualifiedArtifactId:id,
    authorizedNativeOwner:'ORIGINAL_T3_SIGNED_EMPLOYEE',
    authorizedResultRecipient:null,
    installedAgentT3Mode:'EXPLICIT_OPT_IN',
  }));
  assertQualifiedKernelArtifact(qualified,{kernel:'0.3.6',
    contract:'1.3.0',artifactId:id});
  const output=join(root,'one-dist'),receipt=join(root,'one-dist-receipt.json');
  const built=await buildOriginalAgentOneDistFromQualifiedKernel({
    qualifiedKernelDist:qualified,agentProfile:profile,
    t3Build:resolve('dist'),outputDir:output,receiptPath:receipt,
    desktopAgentControlOnly:true,
  });
  assert.equal(built.productId,'iwxa.personal-agent');
  assert.equal(built.original_runtime_unchanged,true);
  const original=JSON.parse(readFileSync(receipt,'utf8'));
  assert.equal(original.original_agent_d6_schema_registered,true);
  assert.equal(original.local_inference_registered,false);
  assert.equal(original.original_qualified_artifact,id);
  assert.equal(sha(join(output,'_iwxa/runtime/0.3.6/runtime.js')),
    sha(join(qualified,'_iwxa/runtime/0.3.6/runtime.js')));
  assert.ok(!readdirSync(join(output,'workspace/assets'))
    .some(name=>/^model-worker-[A-Za-z0-9_-]+\.js$/.test(name)));
  const cliDist=join(root,'cli-one-dist');
  const cliReceipt=join(root,'cli-one-dist-receipt.json');
  const cli=spawnSync(process.execPath,[
    resolve('scripts/build-original-agent-one-dist.mjs'),
    '--qualified-kernel-dist',qualified,'--agent-profile',profile,
    '--t3-build',resolve('dist'),'--output',cliDist,
    '--receipt',cliReceipt,'--desktop-agent-control',
  ],{timeout:120000,encoding:'utf8',maxBuffer:4*1024*1024,
    windowsHide:true});
  assert.equal(cli.status,0,cli.stderr?.slice(0,1300));
  assert.equal(JSON.parse(cli.stdout).original_agent_d6_schema_registered,true);
  assert.equal(JSON.parse(readFileSync(cliReceipt,'utf8')).local_inference_registered,false);
  assert.equal(sha(join(cliDist,'_iwxa/loader.js')),
    sha(join(qualified,'_iwxa/loader.js')));
  // Reproduce exactly how the installed native Agent invokes the public
  // builder: Windows PowerShell 5.1, a redirected Node stdout file, original
  // signed-only build and an independent sibling JSON receipt.
  const psRoot=join(root,'installed-layout','build');
  mkdirSync(psRoot,{recursive:true});
  const psScript=join(root,'original-ps51-invocation.ps1');
  writeFileSync(psScript,[
    'param([string]$Builder,[string]$Qualified,[string]$ProductProfile,',
    '  [string]$Compiled,[string]$Dist,[string]$Receipt,[string]$Log)',
    '$ErrorActionPreference = \'Stop\'',
    '& node.exe $Builder --qualified-kernel-dist $Qualified --agent-profile $ProductProfile --t3-build $Compiled --output $Dist --receipt $Receipt --desktop-agent-control > $Log',
    'if($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $Dist -PathType Container) -or !(Test-Path -LiteralPath $Receipt -PathType Leaf)){throw \'T3_WINDOWS_ORIGINAL_PS51_CLI_NO_RECEIPT\'}',
    'Write-Output \'T3_WINDOWS_ORIGINAL_PS51_CLI_PASS\'',
  ].join('\n')+'\n');
  const psDist=join(psRoot,'original-agent-one-dist');
  const psReceipt=join(psRoot,'original-agent-one-dist-receipt.json');
  const psLog=join(root,'original-agent-one-dist-build.json');
  const ps=spawnSync('powershell.exe',[
    '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
    '-File',psScript,'-Builder',resolve('scripts/build-original-agent-one-dist.mjs'),
    '-Qualified',qualified,'-ProductProfile',profile,
    '-Compiled',resolve('dist'),'-Dist',psDist,
    '-Receipt',psReceipt,'-Log',psLog,
  ],{timeout:120000,encoding:'utf8',windowsHide:true,
    maxBuffer:4*1024*1024});
  assert.equal(ps.status,0,ps.stderr?.slice(0,1500));
  assert.ok(ps.stdout.includes('T3_WINDOWS_ORIGINAL_PS51_CLI_PASS'));
  assert.equal(JSON.parse(readFileSync(psReceipt,'utf8')).local_inference_registered,false);
  const redirected=readFileSync(psLog);
  assert.equal(redirected[0],0xff,'PS5.1 redirected Node JSON must carry UTF-16LE BOM');
  assert.equal(redirected[1],0xfe);
  // The installed Agent must parse BOM-aware, not force UTF8 here.
  assert.equal(JSON.parse(redirected.subarray(2).toString('utf16le'))
    .original_runtime_unchanged,true);
  console.log('T3_WINDOWS_ORIGINAL_AGENT_PS51_BUILD_AND_RECEIPT_PASS');
  console.log('T3_WINDOWS_ORIGINAL_AGENT_DESKTOP_ONE_DIST_DIRECT_CLI_PASS');
}finally{
  rmSync(root,{recursive:true,force:true,maxRetries:3});
}
