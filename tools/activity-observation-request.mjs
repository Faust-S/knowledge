// Internal Agent invocation boundary; no arbitrary paths, remote IO, Task or export.
import {prepareObservationRequest,reviewObservationResult} from '../modules/activity-base-anonymizer/observation-review.mjs';
const LIMIT=8*1024*1024;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
try{
 const args=process.argv.slice(2);
 if(args.length!==1||!['--prepare','--review'].includes(args[0]))fail('OBSERVATION_CLI_ARGUMENTS_INVALID');
 let length=0;const chunks=[];
 for await(const chunk of process.stdin){
  length+=chunk.length;if(length>LIMIT)fail('OBSERVATION_INPUT_LIMIT');chunks.push(chunk);
 }
 let input;
 try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail('OBSERVATION_JSON_INVALID');}
 let value;
 if(args[0]==='--prepare'){
  if(!exact(input,['candidate','cohort']))fail('OBSERVATION_CLI_PROFILE_INVALID');
  value=await prepareObservationRequest(input.candidate,input.cohort);
 }else{
  if(!exact(input,['candidate','request_text','result'])||typeof input.request_text!=='string')fail('OBSERVATION_CLI_PROFILE_INVALID');
  value=await reviewObservationResult(input.candidate,new TextEncoder().encode(input.request_text),input.result);
 }
 const text=JSON.stringify(value)+'\n';
 if(Buffer.byteLength(text)>LIMIT)fail('OBSERVATION_OUTPUT_LIMIT');
 process.stdout.write(text);
}catch(error){
 const code=typeof error?.code==='string'&&/^(OBSERVATION|ARX|OPENDP|LOCAL_DIGEST)_[A-Z0-9_]{1,80}$/.test(error.code)?
  error.code:'OBSERVATION_CLI_FAILED';
 process.stdout.write(JSON.stringify({status:'HOLD',code,anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null})+'\n');
 process.exitCode=2;
}
