// Optional local invocation entry point for a qualified Personal Agent adapter.
// Reads supplied native route models only. No access to Kernel, Workspace,
// network, files by path, authority, automatic publication or .iwxa export.
import {reviewD05ResultSelection} from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const INPUT_LIMIT=8*1024*1024, OUTPUT_LIMIT=8*1024*1024;
function hold(code){return {status:'HOLD',code,source_authority:'UNVERIFIED_LOCAL_COPY',
  anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};}
function fail(code){throw Object.assign(new Error(code),{code});}
function write(value){process.stdout.write(JSON.stringify(value)+'\n');}
async function readInput(){
 const chunks=[];let length=0;
 for await(const part of process.stdin){
  const bytes=Buffer.isBuffer(part)?part:Buffer.from(part);
  length+=bytes.length;
  if(length>INPUT_LIMIT)fail('D05_ROUTE_CLI_INPUT_LIMIT');
  chunks.push(bytes);
 }
 try{
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 }catch{fail('D05_ROUTE_CLI_INVALID_JSON');}
}
try{
 const args=process.argv.slice(2);
 const draft=args.length===1&&args[0]==='--technology-draft';
 if(args.length&&!draft)fail('D05_ROUTE_CLI_ARGUMENTS_NOT_SUPPORTED');
 const records=await readInput();
 const result=reviewD05ResultSelection(records,{includeTechnologyDraft:draft});
 if(Buffer.byteLength(JSON.stringify(result),'utf8')>OUTPUT_LIMIT)fail('D05_ROUTE_CLI_OUTPUT_LIMIT');
 write(result);
}catch(error){
 const code=typeof error?.code==='string'&&/^D05_ROUTE_[A-Z0-9_]{1,80}$/.test(error.code)
  ?error.code:'D05_ROUTE_CLI_FAILED';
 write(hold(code));process.exitCode=2;
}
