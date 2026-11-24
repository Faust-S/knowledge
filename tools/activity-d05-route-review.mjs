// Optional local invocation entry point for a qualified Personal Agent adapter.
// Reads supplied native route models only. No access to Kernel, Workspace,
// network, files by path, authority, automatic publication or .iwxa export.
import {reviewD05ResultSelection,prepareD05TechnologyProposal,prepareD05DisclosureCandidate} from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
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
 const mode=args.length===0?'--compare':args.length===1?args[0]:null;
 if(!['--compare','--technology-draft','--technology-proposal','--disclosure-candidate'].includes(mode)||
   (args.length&&mode==='--compare'))fail('D05_ROUTE_CLI_ARGUMENTS_NOT_SUPPORTED');
 const input=await readInput();
 let result;
 if(mode==='--compare'||mode==='--technology-draft'){
   result=reviewD05ResultSelection(input,{includeTechnologyDraft:mode==='--technology-draft'});
 }else{
   const expected=['records','group_id','model_number','proposal',
     ...(mode==='--disclosure-candidate'?['parameter_decisions']:[])];
   if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).length!==expected.length||!expected.every(k=>Object.hasOwn(input,k))||
     typeof input.group_id!=='string'||!Number.isSafeInteger(input.model_number)||
     input.model_number<1)fail('D05_ROUTE_CLI_PROPOSAL_INVALID');
   const review=reviewD05ResultSelection(input.records,{includeTechnologyDraft:true});
   result=mode==='--technology-proposal'?
     prepareD05TechnologyProposal(review,input.group_id,input.model_number,input.proposal):
     prepareD05DisclosureCandidate(review,input.group_id,input.model_number,input.proposal,input.parameter_decisions);
 }
 if(Buffer.byteLength(JSON.stringify(result),'utf8')>OUTPUT_LIMIT)fail('D05_ROUTE_CLI_OUTPUT_LIMIT');
 write(result);
}catch(error){
 const code=typeof error?.code==='string'&&/^D05_ROUTE_[A-Z0-9_]{1,80}$/.test(error.code)
  ?error.code:'D05_ROUTE_CLI_FAILED';
 write(hold(code));process.exitCode=2;
}
