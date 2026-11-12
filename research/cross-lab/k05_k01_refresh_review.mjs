/** K05 optional review of K01's OWN single-pass project refresh.
 * Never initiates source reads, refreshes context, selects fields or approves a Task.
 * The host must first call its existing K01 refreshProjectContinuation() once.
 */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {verifyK01ProjectEvidence} from './k05_k01_evidence_check.mjs';

export const K05_K01_REFRESH_REVIEW='IWXA_K05_K01_REFRESH_REVIEW/0.1';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const hex=/^[a-f0-9]{64}$/;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=code=>{throw Error('K05_K01_REFRESH_'+code)};
const REJECTED=new Set(['workspace_changed','task_changed','permissions_changed',
 'request_mismatch','scope_changed','selected_source_missing']);
const active=new Set(['CURRENT','UPDATED','INCOMPLETE']);
const hashList=(rows,prop)=>rows.map(x=>sha(x[prop])).sort();

function meaningfulClaims(checked){
 return checked.observations.map(x=>JSON.stringify([
  x.id,x.sourceRef,x.revision,x.evidenceRef,x.sha256
 ])).sort();
}
function validateChangeSet(refresh){
 if(!Array.isArray(refresh.fieldChanges)||refresh.fieldChanges.length>64||
    !Array.isArray(refresh.sourceChanges)||refresh.sourceChanges.length>96||
    !obj(refresh.issueChanges)||!Array.isArray(refresh.issueChanges.appeared)||
    !Array.isArray(refresh.issueChanges.resolved)||
    refresh.issueChanges.appeared.length>200||
    refresh.issueChanges.resolved.length>200||
    typeof refresh.catalogChanged!=='boolean')
  fail('OWNER_REFRESH_SHAPE_CHANGED');
 const allowedKinds=new Set(['SOURCE_ADDED','SOURCE_REMOVED','SOURCE_REVISED',
   'APPROVAL_CHANGED','METADATA_CHANGED']);
 for(const change of refresh.sourceChanges)
  if(!obj(change)||typeof change.sourceRef!=='string'||
     !allowedKinds.has(change.kind))fail('OWNER_CHANGE_UNSUPPORTED');
 for(const field of refresh.fieldChanges)
  if(!obj(field)||typeof field.fieldKey!=='string'||!Array.isArray(field.kinds)||
     !field.kinds.every(k=>['RESTORED','UNAVAILABLE','VALUE_CHANGED',
       'SOURCE_CHANGED','REVISION_CHANGED','EVIDENCE_CHANGED',
       'EPISTEMIC_CHANGED'].includes(k)))fail('OWNER_FIELD_CHANGE_UNSUPPORTED');
}

export function reviewK01ProjectRefresh({
 saved, ownerRefresh, previousAuthorizedDocuments, currentAuthorizedDocuments
}){
 const started=performance.now();
 if(!obj(saved)||saved.contractVersion!=='0.1.1'||
    !obj(ownerRefresh)||ownerRefresh.contractVersion!=='0.1.0'||
    !['REJECTED',...active].includes(ownerRefresh.status)||
    ownerRefresh.requiresReview!== (ownerRefresh.status!=='CURRENT')||
    ownerRefresh.reusable !== (ownerRefresh.status==='CURRENT'))
  fail('OWNER_REFRESH_CONTRACT_INVALID');
 validateChangeSet(ownerRefresh);
 const rejected=ownerRefresh.status==='REJECTED';
 if(rejected){
  // For permissions_changed and workspace_changed the owner must not
  // re-open old private snapshots. The receipt itself is not a source proof.
  if(ownerRefresh.latest!==null||!REJECTED.has(ownerRefresh.reason)||
     ownerRefresh.fieldChanges.length!==0||
     ownerRefresh.issueChanges.appeared.length!==0||
     ownerRefresh.issueChanges.resolved.length!==0)
    fail('OWNER_REJECTION_INVALID');
  return {
   schema:K05_K01_REFRESH_REVIEW,status:'NOT_REUSABLE',
   reason:ownerRefresh.reason,ownerStatus:'REJECTED',
   pastSourceProof:'NOT_CHECKED_AFTER_REJECTION',
   currentSourceProof:'NOT_AVAILABLE',
   changeCounts:{fields:0,sources:ownerRefresh.sourceChanges.length,
    issuesAppeared:0,issuesResolved:0},
   metrics:{k05HostReads:0,k05RehashedSourceBytes:0,
    k05WallMs:Number((performance.now()-started).toFixed(6)),
    ownerRefreshReads:null,ownerRefreshNetworkMs:null,
    humanReviewSeconds:null},
   quality:{humanGold:false,precision:null,recall:null,f1:null,
    semanticTruth:'NOT_MEASURED',taskAccepted:false},
  };
 }
 if(ownerRefresh.reason!==null||!obj(ownerRefresh.latest)||
    !['0.1.1'].includes(ownerRefresh.latest.contractVersion)||
    !Array.isArray(previousAuthorizedDocuments)||
    !Array.isArray(currentAuthorizedDocuments))
  fail('ACTIVE_REFRESH_SHAPE_INVALID');
 const oldProof=verifyK01ProjectEvidence(saved,previousAuthorizedDocuments);
 const newProof=verifyK01ProjectEvidence(ownerRefresh.latest,currentAuthorizedDocuments);
 if(oldProof.status!=='SOURCE_LINES_VERIFIED_NOT_SEMANTIC_GOLD'||
    newProof.status!=='SOURCE_LINES_VERIFIED_NOT_SEMANTIC_GOLD')
  fail('K05_SOURCE_PROOF_UNAVAILABLE');
 const sameClaims=JSON.stringify(meaningfulClaims(oldProof))===
    JSON.stringify(meaningfulClaims(newProof));
 if(ownerRefresh.status==='CURRENT'){
  if(!sameClaims||saved.catalogBinding!==ownerRefresh.latest.catalogBinding||
     saved.projection.requestBinding!==ownerRefresh.latest.projection.requestBinding||
     saved.requiredComplete!==ownerRefresh.latest.requiredComplete||
     JSON.stringify(saved.sourceRevisions)!==JSON.stringify(ownerRefresh.latest.sourceRevisions)||
     JSON.stringify(saved.issues)!==JSON.stringify(ownerRefresh.latest.issues)||
     ownerRefresh.catalogChanged||ownerRefresh.fieldChanges.length||
     ownerRefresh.sourceChanges.length||ownerRefresh.issueChanges.appeared.length||
     ownerRefresh.issueChanges.resolved.length)
   fail('FORGED_CURRENT_WITH_CHANGED_SOURCES');
 }else if(ownerRefresh.status==='INCOMPLETE'&&ownerRefresh.latest.requiredComplete!==false)
  fail('FORGED_INCOMPLETE');
 else if(ownerRefresh.status==='UPDATED'&&ownerRefresh.latest.requiredComplete!==true)
  fail('FORGED_UPDATED');
 const review=ownerRefresh.status!=='CURRENT';
 return {
  schema:K05_K01_REFRESH_REVIEW,
  status:review?'REVIEW_REQUIRED':'SOURCE_BOUND_REUSABLE',
  reason:review?'OWNER_REFRESH_'+ownerRefresh.status:null,
  ownerStatus:ownerRefresh.status,
  pastSourceProof:'PINNED_LINES_VERIFIED_HISTORICAL_ONLY',
  currentSourceProof:'PINNED_LINES_VERIFIED_ON_OWNER_SUPPLIED_SNAPSHOTS',
  originalClaimCount:oldProof.confirmed,latestClaimCount:newProof.confirmed,
  unchangedClaims:sameClaims,
  changedFieldDigests:hashList(ownerRefresh.fieldChanges,'fieldKey'),
  changedSourceDigests:hashList(ownerRefresh.sourceChanges,'sourceRef'),
  changeCounts:{fields:ownerRefresh.fieldChanges.length,
   sources:ownerRefresh.sourceChanges.length,
   issuesAppeared:ownerRefresh.issueChanges.appeared.length,
   issuesResolved:ownerRefresh.issueChanges.resolved.length},
  metrics:{k05HostReads:0,
   k05RehashedSourceBytes:oldProof.metrics.sourceBytesRehashed+
                            newProof.metrics.sourceBytesRehashed,
   k05WallMs:Number((performance.now()-started).toFixed(6)),
   ownerRefreshReads:null,ownerRefreshNetworkMs:null,
   humanReviewSeconds:null},
  quality:{humanGold:false,precision:null,recall:null,f1:null,
   semanticTruth:'NOT_MEASURED',taskAccepted:false},
 };
}
