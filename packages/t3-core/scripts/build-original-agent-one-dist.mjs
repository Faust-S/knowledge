#!/usr/bin/env node
// Product-specific delivery of the EXISTING T2 qualified One Dist to Agent.
// This is only an immutable build recipe around the original T2/T3 assembler.
// It creates no Kernel/Host/Store/Exchange, signer, identity, or archive codec.
import {readFileSync,writeFileSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assembleSignedControlDist} from './assemble-signed-control-dist.mjs';

const PRODUCT='iwxa.personal-agent';
const fail=code=>{throw Error('T3_AGENT_ONE_DIST_'+code);};
const inside=(root,child)=>{
  const delta=relative(root,child);
  return delta===''||(!delta.startsWith('..')&&!isAbsolute(delta));
};
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));

/** Validate the *real* Agent T2 product identity, not a qualified
 * integration.workspace.iwxa.test kernel fixture. Original T2 product
 * completion and runtime digest verification remain the assembler's job.
 */
export function requireOriginalAgentT2Product(t2Dist){
  const root=resolve(t2Dist);
  const domain=readJson(resolve(root,'_iwxa/domain.json'));
  const config=readJson(resolve(root,'workspace/workspace.config.json'));
  const service=config?.workspace_service_id;
  if(domain?.domain_id!==PRODUCT||config?.domain_id!==PRODUCT||
     typeof service!=='string'||!service.startsWith(PRODUCT)||
     !Array.isArray(domain?.modules)||
     !domain.modules.some(m=>m?.service_id===service)||
     domain?.runtime?.kernel_release!=='0.3.6'||
     domain?.runtime?.runtime_version!=='0.3.6'||
     config?.host?.required_contract_version!=='1.3.0'||
     config?.host?.required_runtime_version!=='0.3.6')
    fail('ORIGINAL_PRODUCT_IDENTITY_OR_RUNTIME_REQUIRED');
  return Object.freeze({productId:PRODUCT,serviceId:service});
}

/** Use only the original qualified assembler and return its native receipt.
 * A new recipient never gets implied rights from these build-time bytes.
 */
export function buildOriginalAgentOneDist({t2Dist,t3Build,outputDir,receiptPath}={}){
  if(![t2Dist,t3Build,outputDir,receiptPath].every(
     x=>typeof x==='string'&&x.trim()))fail('FOUR_PATHS_REQUIRED');
  const source=resolve(t2Dist),compiled=resolve(t3Build);
  const output=resolve(outputDir),receipt=resolve(receiptPath);
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','..','..');
  if([output,receipt].some(p=>inside(root,p)||inside(source,p)||
     inside(compiled,p))||inside(output,receipt)||inside(receipt,output)||
     output===receipt||existsSync(output)||existsSync(receipt))
    fail('IMMUTABLE_OUTPUT_OUTSIDE_SOURCE_REQUIRED');
  requireOriginalAgentT2Product(source);
  // No testOnlyUnqualifiedFixture. The exact original 0.3.6 Runtime 1.3.0
  // qualified digest, service passport and compiled source are checked by
  // the existing assembler, and the original Agent D6 schema is registered.
  const original=assembleSignedControlDist({t2Dist:source,t3Build:compiled,
    outputDir:output,installedOriginalAgentD6:true});
  if(original.original_runtime_unchanged!==true||
     original.original_agent_d6_schema_registered!==true||
     original.workspace_service_id!==
       readJson(resolve(output,'workspace/workspace.config.json')).workspace_service_id||
     original.original_qualified_artifact!==
       'iwxa-kernel-k036-same-store-history-20261019-qualified.1'){
    rmSync(output,{recursive:true,force:true});
    fail('ORIGINAL_QUALIFIED_ASSEMBLY_REQUIRED');
  }
  try{
    mkdirSync(dirname(receipt),{recursive:true});
    writeFileSync(receipt,JSON.stringify(original,null,2)+'\n',
      {encoding:'utf8',flag:'wx'});
  }catch(error){
    rmSync(output,{recursive:true,force:true});
    throw error;
  }
  return Object.freeze({schema:original.schema,productId:PRODUCT,
    original_qualified_artifact:original.original_qualified_artifact,
    original_agent_d6_schema_registered:true,original_runtime_unchanged:true,
    output,receipt});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==8||
     args.some((v,i)=>i%2===0&&![
       '--t2-dist','--t3-build','--output','--receipt'].includes(v))||
     new Set(args.filter((_,i)=>i%2===0)).size!==4)
    fail('USAGE_T2_DIST_T3_BUILD_OUTPUT_RECEIPT');
  const opts=Object.fromEntries(args.filter((_,i)=>i%2===0)
    .map((key,i)=>[key,args[2*i+1]]));
  const result=buildOriginalAgentOneDist({
    t2Dist:opts['--t2-dist'],t3Build:opts['--t3-build'],
    outputDir:opts['--output'],receiptPath:opts['--receipt']});
  process.stdout.write(JSON.stringify(result)+'\n');
}
