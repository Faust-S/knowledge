// Existing Agent tool invocation may supply an accepted local Task bundle.
// This review is never an authority or .iwxa exporter.
import {reviewD05SimPyComparison} from '../modules/activity-base-anonymizer/d05-simpy-review.mjs';
const LIMIT=8*1024*1024,fail=code=>{throw Object.assign(new Error(code),{code});};
try{
 if(process.argv.length!==2)fail('SIMPY_REVIEW_ARGUMENTS_INVALID');
 let size=0;const chunks=[];
 for await(const chunk of process.stdin){size+=chunk.length;if(size>LIMIT)fail('SIMPY_INPUT_LIMIT');chunks.push(chunk);}
 let input;
 try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail('SIMPY_JSON_INVALID');}
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==3||
   !['candidate','request_text','result'].every(k=>Object.hasOwn(input,k))||typeof input.request_text!=='string')fail('SIMPY_REVIEW_PROFILE');
 const result=await reviewD05SimPyComparison(input.candidate,new TextEncoder().encode(input.request_text),input.result);
 const out=JSON.stringify(result)+'\n';if(Buffer.byteLength(out)>LIMIT)fail('SIMPY_OUTPUT_LIMIT');
 process.stdout.write(out);
}catch(e){
 const code=typeof e?.code==='string'&&/^(SIMPY|LOCAL_DIGEST)_[A-Z0-9_]{1,80}$/.test(e.code)?e.code:'SIMPY_REVIEW_FAILED';
 process.stdout.write(JSON.stringify({status:'HOLD',code,anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null})+'\n');process.exitCode=2;
}
