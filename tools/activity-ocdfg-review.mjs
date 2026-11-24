// Local Activity review operation for an existing, qualified Agent ToolProviderPort.
 // Receives the two native JSON artifacts via stdin, never arbitrary paths.
import {reviewExternalOcDfg} from '../modules/activity-base-anonymizer/ocel2-evidence.mjs';
const LIMIT=8*1024*1024;
function fail(code){throw Object.assign(new Error(code),{code});}
function write(value){process.stdout.write(JSON.stringify(value)+'\n');}
function hold(code){return {status:'HOLD',code,source_binding:'UNVERIFIED_LOCAL_COPY',
 epistemic_status:'UNVERIFIED_LOCAL_EVENT_RECORDS',anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};}
async function readInput(){
 const chunks=[];let length=0;
 for await(const part of process.stdin){
  const bytes=Buffer.isBuffer(part)?part:Buffer.from(part);length+=bytes.length;
  if(length>LIMIT)fail('OCDFG_CLI_INPUT_LIMIT');
  chunks.push(bytes);
 }
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 catch{fail('OCDFG_CLI_INVALID_JSON');}
}
try{
 if(process.argv.length!==2)fail('OCDFG_CLI_ARGUMENTS_NOT_SUPPORTED');
 const args=await readInput();
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==2||
  !Object.hasOwn(args,'ocel2')||!Object.hasOwn(args,'ocdfg'))fail('OCDFG_CLI_INPUT_SHAPE');
 const result=await reviewExternalOcDfg(args.ocel2,args.ocdfg);
 if(Buffer.byteLength(JSON.stringify(result),'utf8')>LIMIT)fail('OCDFG_CLI_OUTPUT_LIMIT');
 write(result);if(result.status!=='MATCHED_LOCAL_MODEL')process.exitCode=2;
}catch(error){
 const code=typeof error?.code==='string'&&/^OC(?:EL|DFG)_[A-Z0-9_]{1,80}$/.test(error.code)
  ?error.code:'OCDFG_CLI_FAILED';
 write(hold(code));process.exitCode=2;
}
