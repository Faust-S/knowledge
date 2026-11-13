import {checkCandidateBytes,destinationUrl,exactOrigin,isMessage,HANDOFF_PROTOCOL,nonceFrom} from './protocol.mjs';

/** Human-initiated Site -> Host read request. The Site cannot read Kernel:
 * only a Host user click may return explicitly selected verified records. */
export function launchT2SiteRestore({siteWindow,hostUrl,onCandidate,onStatus=()=>{}}){
  if(!siteWindow||typeof siteWindow.open!=='function'||
     typeof siteWindow.addEventListener!=='function'||
     typeof siteWindow.removeEventListener!=='function'||
     typeof onCandidate!=='function')throw new Error('T2_RESTORE_SITE_INPUT_INVALID');
  const siteOrigin=exactOrigin(siteWindow.location.origin);
  const destination=destinationUrl(hostUrl,siteOrigin);
  const peer=siteWindow.open(destination.href,'_blank');
  if(!peer)throw new Error('T2_RESTORE_WINDOW_BLOCKED');
  let nonce=null,disposed=false,requested=false;
  const dispose=()=>{
    if(disposed)return;
    disposed=true;siteWindow.removeEventListener('message',onMessage);
  };
  const onMessage=event=>{
    if(disposed||event.source!==peer||event.origin!==destination.origin)return;
    if(!requested&&isMessage(event.data,'restore-ready')){
      nonce=event.data.nonce;requested=true;
      peer.postMessage({protocol:HANDOFF_PROTOCOL,kind:'restore-request',nonce},destination.origin);
      onStatus('T2_RESTORE_WAITING_FOR_HOST_SELECTION');
      return;
    }
    if(requested&&isMessage(event.data,'restore-candidate')&&event.data.nonce===nonce){
      dispose();
      const finish=(result,error=null)=>{
        let status='REJECTED',reason=null;
        if(error){
          reason=error instanceof Error&&/^CLUB_T2_[A-Z0-9_]+$/.test(error.message)
            ?error.message:'T2_RESTORE_CANDIDATE_REJECTED';
        }else if(result&&typeof result==='object'&&result.status==='CANCELLED')
          status='CANCELLED';
        else if(result&&typeof result==='object'&&result.status==='NO_NEW_RESULTS')
          status='UNCHANGED';
        else if(!result||result.status==='APPLIED')status='APPLIED';
        else reason='T2_RESTORE_CANDIDATE_REJECTED';
        try{
          peer.postMessage({protocol:HANDOFF_PROTOCOL,kind:'restore-status',
            nonce,status},destination.origin);
        }catch{
          // A lost reply cannot roll back a completed local write.
        }
        if(reason)onStatus(reason);
        else onStatus('T2_RESTORE_SITE_'+status);
      };
      try{
        const result=onCandidate(checkCandidateBytes(event.data.raw));
        // A Promise is not an applied Result. Wait for the original local
        // writer/readback before reporting APPLIED (or another final state).
        if(result&&typeof result.then==='function')
          Promise.resolve(result).then(value=>finish(value),error=>finish(null,error));
        else finish(result);
      }catch(error){finish(null,error);}
    }
  };
  siteWindow.addEventListener('message',onMessage);
  return {dispose,get pending(){return !disposed},get requested(){return requested}};
}

/** Host must independently authenticate the Site origin, verify read grants,
 * read selected Kernel objects and obtain explicit user consent before send().
 * postMessage is only a transport and grants NO read or write authority. */
export function mountT2SiteRestoreSender({hostWindow,expectedSiteOrigin,onRequest=()=>{},onStatus=()=>{},cryptoSource=hostWindow?.crypto}){
  if(!hostWindow||typeof hostWindow.addEventListener!=='function'||
     typeof hostWindow.removeEventListener!=='function'||
     !hostWindow.opener||typeof hostWindow.opener.postMessage!=='function')
    throw new Error('T2_RESTORE_HOST_INPUT_INVALID');
  const hostOrigin=exactOrigin(hostWindow.location.origin);
  const siteOrigin=exactOrigin(expectedSiteOrigin);
  if(hostOrigin===siteOrigin)throw new Error('T2_RESTORE_ORIGIN_ISOLATION_REQUIRED');
  const peer=hostWindow.opener;
  const nonce=nonceFrom(cryptoSource);
  let requested=false,disposed=false,sent=false,acknowledgement=null;
  const dispose=()=>{
    if(disposed)return;
    disposed=true;hostWindow.removeEventListener('message',onMessage);
  };
  const onMessage=event=>{
    if(disposed||event.source!==peer||event.origin!==siteOrigin)return;
    if(!requested&&isMessage(event.data,'restore-request')&&event.data.nonce===nonce){
      requested=true;onRequest();return;
    }
    if(sent&&isMessage(event.data,'restore-status')&&event.data.nonce===nonce&&
       ['APPLIED','CANCELLED','UNCHANGED','REJECTED'].includes(event.data.status)){
      acknowledgement=event.data.status;
      dispose();
      onStatus('T2_RESTORE_SITE_'+acknowledgement);
    }
  };
  hostWindow.addEventListener('message',onMessage);
  // React StrictMode: do not send invitation from a disposed first mount.
  queueMicrotask(()=>{
    if(disposed)return;
    try{peer.postMessage({protocol:HANDOFF_PROTOCOL,kind:'restore-ready',nonce},siteOrigin)}
    catch{dispose();onStatus('T2_RESTORE_HOST_DELIVERY_FAILED')}
  });
  return {
    get requested(){return requested},
    get sent(){return sent},
    get acknowledgement(){return acknowledgement},
    dispose,
    send(raw){
      if(disposed||!requested||sent)throw new Error('T2_RESTORE_REQUEST_REQUIRED');
      const safe=checkCandidateBytes(raw);
      // Keep a single origin-and-nonce authenticated reply listener until
      // the originating Site reports application, cancellation or rejection.
      sent=true;
      onStatus('T2_RESTORE_SENT_NOT_YET_ACKNOWLEDGED');
      try{
        peer.postMessage({protocol:HANDOFF_PROTOCOL,kind:'restore-candidate',nonce,raw:safe},siteOrigin);
      }catch(error){
        sent=false;
        onStatus('T2_RESTORE_HOST_DELIVERY_FAILED');
        throw error;
      }
    },
  };
}
