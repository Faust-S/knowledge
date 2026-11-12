/** K05 optional, source-first readback for K01's *existing* project projection.
 * The host provides authorized, already-read bytes. K05 does not fetch,
 * rank, compile context, adjudicate business decisions or approve Tasks.
 */
import {createHash} from 'node:crypto';

const hash=(value)=>createHash('sha256').update(value,'utf8').digest('hex');
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const revision=/^sha256:[a-f0-9]{64}$/;
const line=/^line:([1-9][0-9]*)$/;
const fail=(code)=>{throw Error('K05_K01_EVIDENCE_'+code);};

export function verifyK01ProjectEvidence(result,authorizedDocuments){
 if(!obj(result)||result.contractVersion!=='0.1.0'||!obj(result.projection)||
    !Array.isArray(result.projection.selected)||!Array.isArray(result.covered)||
    !Array.isArray(result.issues)||!Array.isArray(authorizedDocuments))
   fail('INPUT_INVALID');
 const documents=new Map();
 for(const source of authorizedDocuments){
  if(!obj(source)||typeof source.sourceRef!=='string'||
     typeof source.workspaceRef!=='string'||!revision.test(source.revision??'')||
     typeof source.content!=='string'||documents.has(source.sourceRef)||
     source.workspaceRef!==result.workspaceRef)fail('SOURCE_CATALOG_INVALID');
  documents.set(source.sourceRef,source);
 }
 const checked=[],seen=new Set(),hashed=new Set();
 let hashBytes=0;
 for(const claim of result.projection.selected){
  if(!obj(claim)||typeof claim.id!=='string'||!claim.id.startsWith('field:')||
     seen.has(claim.id)||typeof claim.sourceRef!=='string'||
     !revision.test(claim.revision??'')||!line.test(claim.evidenceRef??'')||
     typeof claim.excerpt!=='string'||!claim.excerpt||
     typeof claim.sha256!=='string'||!/^[a-f0-9]{64}$/.test(claim.sha256))
    fail('EVIDENCE_SHAPE_INVALID');
  seen.add(claim.id);
  const source=documents.get(claim.sourceRef);
  if(!source||source.revision!==claim.revision)fail('SOURCE_REVISION_MISMATCH');
  if(!hashed.has(source.sourceRef)){
   hashed.add(source.sourceRef);
   hashBytes+=Buffer.byteLength(source.content,'utf8');
   if('sha256:'+hash(source.content)!==source.revision)fail('SOURCE_BYTES_MISMATCH');
  }
  const row=Number(line.exec(claim.evidenceRef)[1]);
  const actual=source.content.split(/\r?\n/)[row-1];
  if(actual!==claim.excerpt||hash(actual)!==claim.sha256)
   fail('LOCATOR_OR_EXCERPT_MISMATCH');
  checked.push({id:claim.id,sourceRef:claim.sourceRef,
   revision:claim.revision,evidenceRef:claim.evidenceRef,sha256:claim.sha256});
 }
 const covered=result.covered.map(x=>'field:'+x);
 if(covered.length!==seen.size||new Set(covered).size!==seen.size||
    covered.some(id=>!seen.has(id)))
   fail('COVERAGE_INCONSISTENT');
 const unknown=result.issues.filter(i=>['contradiction','source_unavailable',
   'ambiguous_lines','missing','approval_required','budget_exceeded'].includes(i.type));
 if(unknown.some(i=>seen.has('field:'+i.fieldKey)))fail('UNRESOLVED_FIELD_SELECTED');
 return {
  status:'SOURCE_LINES_VERIFIED_NOT_SEMANTIC_GOLD',
  confirmed:checked.length,
  unresolved:unknown.length,
  sourceRefs:[...hashed].sort(),
  observations:checked.sort((a,b)=>a.id.localeCompare(b.id)),
  metrics:{hostReadsByK05:0,sourceBytesRehashed:hashBytes,
   humanCorrectionSeconds:null,computeCostUsd:null},
  epistemic:{semanticsIndependentlyVerified:false,humanGold:false,
   taskAccepted:false,agentResultReadback:'NOT_TESTED'},
 };
}
