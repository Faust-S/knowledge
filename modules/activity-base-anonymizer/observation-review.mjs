// Review a local output against the EXACT request bytes and candidate revision.
// No substitute ARX risk estimator, DP noise generator, publication or authorization.
import {ActivityHold,sha256Canonical} from './engine.mjs';
const LIMIT=8*1024*1024,MAX_ROWS=5000;
const PROFILES={arx:'ACTIVITY_ARX_COHORT_V1',opendp:'ACTIVITY_DP_AGGREGATE_V1'};
const METRICS=['CONTRIBUTING_ORGANIZATIONS','ACCEPTED_ORDER_COUNT','TOTAL_OPERATION_MINUTES'];
const COMMON='profile technology_sha256 observation_unit source_kind rows';
const RESULT='input_sha256 technology_sha256 observation_unit source_kind source_authority anonymity export_allowed iwxa_package status engine version scope';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===fields.split(' ').length&&fields.split(' ').every(k=>Object.hasOwn(x,k));
const int=(x,a,b)=>Number.isSafeInteger(x)&&x>=a&&x<=b;
const num=(x,a,b)=>typeof x==='number'&&Number.isFinite(x)&&x>=a&&x<=b;
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
async function bytesDigest(bytes){
 need(globalThis.crypto?.subtle,'LOCAL_DIGEST_UNAVAILABLE');
 return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function requestProfile(req){
 const arx=req?.profile===PROFILES.arx;
 need(exact(req,COMMON+(arx?' k columns':' metric public_bound epsilon_milli'))&&
  (arx||req.profile===PROFILES.opendp)&&hex(req.technology_sha256)&&req.observation_unit==='ORGANIZATION'&&
  ['DECLARED_MODEL','DECLARED_EXECUTION'].includes(req.source_kind)&&Array.isArray(req.rows)&&req.rows.length<=MAX_ROWS,
  'OBSERVATION_PROFILE_INVALID');
 const ids=new Set();
 for(const row of req.rows){
  need(exact(row,arx?'unit_id values':'unit_id value')&&token(row.unit_id)&&!ids.has(row.unit_id),'OBSERVATION_UNIT_INVALID');
  ids.add(row.unit_id);
 }
 if(arx){
  need(int(req.k,2,100)&&req.rows.length>=req.k&&Array.isArray(req.columns)&&req.columns.length>=1&&req.columns.length<=8,
   'ARX_COHORT_INVALID');
  const names=new Set();
  for(const [i,col] of req.columns.entries()){
   need(exact(col,'key hierarchy max_level')&&typeof col.key==='string'&&/^[a-z][a-z0-9_]{0,47}$/.test(col.key)&&
    !names.has(col.key)&&Array.isArray(col.hierarchy)&&col.hierarchy.length>=1&&col.hierarchy.length<=MAX_ROWS&&
    Array.isArray(col.hierarchy[0])&&int(col.hierarchy[0].length,1,5)&&int(col.max_level,0,col.hierarchy[0].length-1),
    'ARX_HIERARCHY_INVALID');
   names.add(col.key);
   const leaves=new Set(),parents=new Map(),width=col.hierarchy[0].length;
   for(const path of col.hierarchy){
    need(Array.isArray(path)&&path.length===width&&path.every(token)&&!leaves.has(path[0]),'ARX_HIERARCHY_INVALID');
    leaves.add(path[0]);
    for(let j=0;j<width-1;j++){
     const key=j+':'+path[j];
     need(!parents.has(key)||parents.get(key)===path[j+1],'ARX_HIERARCHY_INVALID');
     parents.set(key,path[j+1]);
    }
   }
   for(const row of req.rows)need(Array.isArray(row.values)&&row.values.length===req.columns.length&&leaves.has(row.values[i]),'ARX_ROW_INVALID');
  }
 }else{
  need(METRICS.includes(req.metric)&&int(req.public_bound,1,100000)&&int(req.epsilon_milli,50,1000)&&
   (req.metric!=='CONTRIBUTING_ORGANIZATIONS'||req.public_bound===1),'OPENDP_POLICY_INVALID');
  for(const row of req.rows)need(int(row.value,0,2000000000)&&
   (req.metric!=='CONTRIBUTING_ORGANIZATIONS'||row.value===1),'OPENDP_CONTRIBUTION_INVALID');
 }
 return arx?'arx':'opendp';
}
export async function reviewObservationResult(candidate,requestBytes,raw){
 need(candidate?.export_allowed===false&&candidate.anonymity==='NOT_ESTABLISHED'&&candidate.disclosure_review==='NOT_PERFORMED'&&
  candidate.iwxa_package===null&&['LOCAL_CANDIDATE_FOR_DISCLOSURE_REVIEW','LOCAL_CANDIDATE_NEEDS_REVIEW_INPUT'].includes(candidate.status)&&
  exact(candidate.technology,'terms route_parameters operations quality_checks'),'OBSERVATION_CANDIDATE_PROFILE');
 need(requestBytes instanceof Uint8Array&&requestBytes.byteLength>0&&requestBytes.byteLength<=LIMIT,'OBSERVATION_INPUT_LIMIT');
 // Freeze the bytes used for parsing and hashing across asynchronous operations.
 const bytes=requestBytes.slice();
 let req;
 try{req=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ActivityHold('OBSERVATION_JSON_INVALID');}
 const kind=requestProfile(req);
 const arx=kind==='arx';
 need(exact(raw,RESULT+(arx?' row_count k suppression_limit before_highest_sample_risk after_highest_sample_risk result_available levels':
  ' metric public_bound epsilon_milli adjacency delta privacy_map_at_one scale noisy_value budget_accounting'))&&
  raw.observation_unit==='ORGANIZATION'&&raw.source_kind===req.source_kind&&raw.source_authority==='UNVERIFIED_DECLARED_COHORT'&&
  raw.anonymity==='NOT_ESTABLISHED'&&raw.export_allowed===false&&raw.iwxa_package===null&&hex(raw.input_sha256)&&hex(raw.technology_sha256),
  'OBSERVATION_RESULT_PROFILE_INVALID');
 const technologyDigest=await sha256Canonical(candidate.technology);
 need(technologyDigest===req.technology_sha256&&raw.technology_sha256===technologyDigest,
  'OBSERVATION_TECHNOLOGY_CHANGED');
 need(await bytesDigest(bytes)===raw.input_sha256,'OBSERVATION_REQUEST_CHANGED');
 const base={source_kind:req.source_kind,observation_unit:'ORGANIZATION',source_match:'EXACT_REQUEST_AND_TECHNOLOGY_DIGEST',
  source_authority:'UNVERIFIED_DECLARED_COHORT_AND_LOCAL_TOOL_OUTPUT',privacy_conclusion:'NOT_ESTABLISHED',
  domain_validation:'NOT_PERFORMED',anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
 if(arx){
  need(raw.status==='LOCAL_ARX_COHORT_REVIEW'&&raw.engine==='ARX'&&raw.version==='3.9.2'&&
   raw.scope==='DECLARED_QUASI_IDENTIFIER_SAMPLE_ONLY'&&raw.row_count===req.rows.length&&raw.k===req.k&&raw.suppression_limit===0&&
   num(raw.before_highest_sample_risk,Number.MIN_VALUE,1)&&typeof raw.result_available==='boolean'&&Array.isArray(raw.levels),
   'ARX_RESULT_INVALID');
  if(raw.result_available){
   need(num(raw.after_highest_sample_risk,Number.MIN_VALUE,Math.min(raw.before_highest_sample_risk,1/req.k)+1e-12)&&
    raw.levels.length===req.columns.length,'ARX_RESULT_INVALID');
   for(const [i,l] of raw.levels.entries()){
    const c=req.columns[i];
    need(exact(l,'key level max_level')&&l.key===c.key&&l.max_level===c.max_level&&int(l.level,0,c.max_level),'ARX_RESULT_INVALID');
   }
  }else need(raw.after_highest_sample_risk===null&&raw.levels.length===0,'ARX_RESULT_INVALID');
  return {...base,kind:'arx',version:raw.version,row_count:raw.row_count,k:raw.k,result_available:raw.result_available,
   before_highest_sample_risk:raw.before_highest_sample_risk,after_highest_sample_risk:raw.after_highest_sample_risk,
   levels:raw.levels.map(l=>({...l})),suppression_limit:0};
 }
 need(raw.status==='LOCAL_OPENDP_AGGREGATE_PREVIEW'&&raw.engine==='OpenDP'&&raw.version==='0.16.0'&&
  raw.scope==='ONE_DECLARED_ORGANIZATION_CONTRIBUTION'&&raw.metric===req.metric&&raw.public_bound===req.public_bound&&
  raw.epsilon_milli===req.epsilon_milli&&raw.adjacency==='ADD_OR_REMOVE_ONE_ROW'&&raw.delta===0&&
  num(raw.privacy_map_at_one,Number.MIN_VALUE,req.epsilon_milli/1000)&&num(raw.scale,req.public_bound/(req.epsilon_milli/1000),1e9)&&
  int(raw.noisy_value,-2147483648,2147483647)&&raw.budget_accounting==='NOT_PERFORMED','OPENDP_RESULT_INVALID');
 return {...base,kind:'opendp',version:raw.version,metric:raw.metric,public_bound:raw.public_bound,
  epsilon_milli:raw.epsilon_milli,privacy_map_at_one:raw.privacy_map_at_one,scale:raw.scale,
  noisy_value:raw.noisy_value,delta:0,budget_accounting:'NOT_PERFORMED'};
}
