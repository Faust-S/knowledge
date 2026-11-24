// Optional local call from the existing Agent ToolProviderPort adapter.
// Stdin only: one exact upstream result or a pair of exact results.
// No filesystem paths, network, Kernel, grant, task creation or export.
import {reviewR4pmResult,compareR4pmReviews,R4PM_RESULT_MAX_BYTES}
 from '../modules/activity-base-anonymizer/r4pm-result-review.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
try{
 if(process.argv.length!==2)fail('R4PM_CLI_ARGUMENTS_NOT_SUPPORTED');
 const chunks=[];let size=0;
 for await(const part of process.stdin){
  const bytes=Buffer.isBuffer(part)?part:Buffer.from(part);
  size+=bytes.length;if(size>R4PM_RESULT_MAX_BYTES)fail('R4PM_CLI_INPUT_LIMIT');
  chunks.push(bytes);
 }
 let raw;
 try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 catch{fail('R4PM_CLI_INVALID_JSON');}
 let result;
 if(Array.isArray(raw)){
  if(raw.length!==2)fail('R4PM_CLI_COMPARISON_PAIR_REQUIRED');
  result=compareR4pmReviews(reviewR4pmResult(raw[0]),reviewR4pmResult(raw[1]));
 }else result=reviewR4pmResult(raw);
 if(Buffer.byteLength(JSON.stringify(result),'utf8')>R4PM_RESULT_MAX_BYTES)fail('R4PM_CLI_OUTPUT_LIMIT');
 write(result);
}catch(error){
 const code=typeof error?.code==='string'&&/^R4PM_[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'R4PM_CLI_FAILED';
 write({status:'HOLD',code,source_authority:'UNVERIFIED_LOCAL_TOOL_OUTPUT',
  anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null});
 process.exitCode=2;
}
