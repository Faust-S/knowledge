import {createT4OriginalSignedOperationAccess} from './original-signed-route-access.mjs';
import {normalizeT4OriginalReplacementOwnerRequest} from './original-replacement-owner-history-carrier.mjs';
import {T4_REPLACEMENT_ELIGIBILITY_REQUEST} from './original-network-replacement-owner-eligibility.mjs';
import {T4_REPLACEMENT_SOURCE_ADMISSION_REQUEST,T4_REPLACEMENT_RECIPIENT_DIFF_REQUEST,T4_REPLACEMENT_SOURCE_CONTENT_REQUEST} from './original-network-replacement-owner-history.mjs';
import {T4_SOURCE_EVENT_WINDOW_REQUEST,T4_SOURCE_EVENT_WINDOW_OWNER_ACTION,T4_SOURCE_EVENT_WINDOW_PEER_ACTION} from './original-source-event-window.mjs';
import {T4_RECIPIENT_RESULT_REQUEST,T4_RECIPIENT_RESULT_OWNER_ACTION,T4_RECIPIENT_RESULT_PEER_ACTION} from './original-recipient-result-read.mjs';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Object.assign(Error(code),{code,outcome:'DENIED'});};
const OWNER='t4.network.original.replacement.owner.read-history';
const PEER='t4.network.original.replacement.peer.read-history';
const ports=new WeakSet();
export const isT4OriginalSignedReplacementHistoryAccess=p=>!!p&&ports.has(p);

// The original Access evaluator and grant are shared with topology and the
// Vault. This consumer cannot issue a grant or authenticate a remote caller.
// The owner must ALSO verify original caller/connection evidence separately.
export function createT4OriginalSignedReplacementHistoryAccess({access,expectedContext,workspaceId,technicalWorkspaceId,
  originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,localNodeRef,scopeRef,ownerEpoch,getMode,clock=Date.now,enableOriginalEligibilityRead=false,enableOriginalSourceWindowRead=false,enableOriginalRecipientResultRead=false}={}){
  if(typeof enableOriginalRecipientResultRead!=='boolean'||typeof enableOriginalSourceWindowRead!=='boolean'||typeof enableOriginalEligibilityRead!=='boolean'||![workspaceId,technicalWorkspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,localNodeRef,scopeRef].every(ID)||
    technicalWorkspaceId===workspaceId||sourceNodeRef===recipientNodeRef||![sourceNodeRef,recipientNodeRef].includes(localNodeRef)||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1)fail('REPLACEMENT_HISTORY_SIGNED_SCOPE_INVALID');
  const identity=Object.freeze({workspaceId,technicalWorkspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,localNodeRef,scopeRef,ownerEpoch});
  const role=localNodeRef===sourceNodeRef?'SOURCE':'RECIPIENT',peerNodeRef=role==='SOURCE'?recipientNodeRef:sourceNodeRef;
  const signed=createT4OriginalSignedOperationAccess({access,expectedContext,workspaceId,operations:[OWNER,PEER,...(enableOriginalSourceWindowRead?[T4_SOURCE_EVENT_WINDOW_OWNER_ACTION,T4_SOURCE_EVENT_WINDOW_PEER_ACTION]:[]),
    ...(enableOriginalRecipientResultRead?[T4_RECIPIENT_RESULT_OWNER_ACTION,T4_RECIPIENT_RESULT_PEER_ACTION]:[])],getMode,clock});
  function request(raw){
    const r=normalizeT4OriginalReplacementOwnerRequest(raw);
    if(r.schema===T4_RECIPIENT_RESULT_REQUEST&&!enableOriginalRecipientResultRead)fail('RECIPIENT_RESULT_SIGNED_READ_NOT_ENABLED');
    if(r.schema===T4_SOURCE_EVENT_WINDOW_REQUEST&&!enableOriginalSourceWindowRead)fail('SOURCE_EVENT_WINDOW_SIGNED_READ_NOT_ENABLED');
    if([T4_REPLACEMENT_ELIGIBILITY_REQUEST,T4_REPLACEMENT_SOURCE_ADMISSION_REQUEST,T4_REPLACEMENT_RECIPIENT_DIFF_REQUEST,T4_REPLACEMENT_SOURCE_CONTENT_REQUEST].includes(r.schema)&&!enableOriginalEligibilityRead)fail('REPLACEMENT_HISTORY_SIGNED_ELIGIBILITY_NOT_ENABLED');
    if(!same(raw,r)||!['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch']
      .every(k=>r.session[k]===identity[k]))fail('REPLACEMENT_HISTORY_SIGNED_SCOPE_MISMATCH');
    return r;
  }
  async function authorizeOwner(input){
    signed.assertCurrent();const p=structuredClone(input),r=request(p?.request);
    const operation=r.schema===T4_RECIPIENT_RESULT_REQUEST?T4_RECIPIENT_RESULT_OWNER_ACTION:
      r.schema===T4_SOURCE_EVENT_WINDOW_REQUEST?T4_SOURCE_EVENT_WINDOW_OWNER_ACTION:OWNER;
    if(p.operation!==operation||p.role!==role||r.ownerNodeRef!==localNodeRef||
      p.technicalWorkspaceId!==technicalWorkspaceId||!ID(p.originalHostSessionRef)||
      p.originalOwnerReadOnly!==true||p.originalHistoricalEvidenceOnly!==true||
      p.originalSubjectMutationAllowed!==false||p.originalFrameRetryAllowed!==false)
      fail('REPLACEMENT_HISTORY_SIGNED_OWNER_MISMATCH');
    return signed.authorize({operation,input:{operation,request:r,role,technicalWorkspaceId:p.technicalWorkspaceId,
      originalHostSessionRef:p.originalHostSessionRef,originalOwnerReadOnly:true,originalHistoricalEvidenceOnly:true,
      originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false}});
  }
  async function authorizePeer(input){
    signed.assertCurrent();const p=structuredClone(input),r=request(p?.request);
    const operation=r.schema===T4_RECIPIENT_RESULT_REQUEST?T4_RECIPIENT_RESULT_PEER_ACTION:
      r.schema===T4_SOURCE_EVENT_WINDOW_REQUEST?T4_SOURCE_EVENT_WINDOW_PEER_ACTION:PEER;
    if(p.operation!==operation||r.requesterNodeRef!==localNodeRef||r.ownerNodeRef!==peerNodeRef||!['before','after'].includes(p.stage)||
      p.originalIndependentOwnerReadRequired!==true||p.originalSubjectMutationAllowed!==false||p.originalFrameRetryAllowed!==false)
      fail('REPLACEMENT_HISTORY_SIGNED_PEER_MISMATCH');
    return signed.authorize({operation,input:{operation,request:r,stage:p.stage,originalIndependentOwnerReadRequired:true,
      originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false}});
  }
  const port=Object.freeze({schema:'IWXA_T4_ORIGINAL_SIGNED_REPLACEMENT_HISTORY_ACCESS_V1',identity,originalSignedSubject:signed.subject,
    originalAccessIdentity:signed.originalAccessIdentity,authorizeOwner,authorizePeer,originalSignedAccessOnly:true,
    createsStore:false,createsIAM:false,createsGrant:false,originalEligibilityReadEnabled:enableOriginalEligibilityRead,originalSourceWindowReadEnabled:enableOriginalSourceWindowRead,originalRecipientResultReadEnabled:enableOriginalRecipientResultRead,
    forOriginalHostLifetime:isHostActive=>createT4OriginalSignedReplacementHistoryAccess({access,expectedContext:signed.subject,
      ...identity,getMode:originalHostLifetimeMode(getMode,isHostActive),clock,enableOriginalEligibilityRead,enableOriginalSourceWindowRead,enableOriginalRecipientResultRead})});
  ports.add(port);return port;
}
