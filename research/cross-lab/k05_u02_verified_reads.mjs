/** K05: optional in-process evidence comparison of two existing P01/U02 reads.
 * No connector, authorization, storage, context compiler or task evaluator.
 * The host owns the reads; this module checks returned UTF-8 bytes and
 * delegates revision relation to the existing U02 sourceChange owner.
 */
import {createHash} from 'node:crypto';

const SHA=/^[a-f0-9]{64}$/;
const SCHEMA='IWXA_SOURCE_CONNECTOR/1.0.0';
const LIMIT=1_000_000;
const object=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const hash=b=>createHash('sha256').update(b).digest('hex');
function invalid(code){throw Error('K05_U02_'+code);}
function observe(read){
  if(!object(read)||!object(read.source)||!object(read.observation)||
     !object(read.pin))invalid('READ_MISSING');
  const {source:s,observation:o,pin:p}=read;
  const provenance=o.provenance;
  if(!object(provenance)||!object(s.binding_ref)||
     o.schema!==SCHEMA||p.schema!==SCHEMA||
     o.authority!=='OBSERVATION_ONLY'||p.authority!=='OBSERVATION_ONLY'||
     o.status!=='OK'||o.providerId!=='personal.knowledge'||
     p.providerId!==o.providerId||p.sourceRef!==o.sourceRef||
     typeof o.sourceRef!=='string'||!/^hkw:\/\/iwxa-personal-agent\/[a-f0-9]{64}$/.test(o.sourceRef)||
     o.observationType!=='file'||p.observationType!=='file'||
     provenance.authority!=='OBSERVATION_ONLY'||
     provenance.admission!=='SOURCE_ONLY'||
     typeof provenance.provider!=='string'||!provenance.provider||
     typeof provenance.sourcePath!=='string'||!provenance.sourcePath||
     typeof provenance.bindingDigest!=='string'||!SHA.test(provenance.bindingDigest)||
     s.path!==provenance.sourcePath||s.provider_id!==provenance.provider||
     s.binding_ref.provider_id!==provenance.provider||
     s.binding_ref.binding_digest!==provenance.bindingDigest||
     s.admission_status!=='SOURCE_ONLY'||o.content!==null||
     !SHA.test(s.sha256??'')||
     o.revision!=='sha256:'+s.sha256||p.revision!==o.revision||
     o.contentRef!==o.revision)
    invalid('IDENTITY_MISMATCH');
  if(typeof s.content!=='string')invalid('CONTENT_UNAVAILABLE');
  const bytes=Buffer.from(s.content,'utf8');
  if(bytes.length>LIMIT||o.bytes!==bytes.length||hash(bytes)!==s.sha256)
    invalid('CONTENT_REVISION_MISMATCH');
  return {
    sourceRef:o.sourceRef,
    providerId:provenance.provider,
    sourcePath:provenance.sourcePath,
    bindingDigest:provenance.bindingDigest,
    revision:o.revision,
    sha256:s.sha256,
    bytes:bytes.length,
  };
}

export function compareU02VerifiedReads(previous,current,sourceChange){
  if(typeof sourceChange!=='function')invalid('OWNER_SOURCE_CHANGE_REQUIRED');
  const old=observe(previous),next=observe(current);
  const identity=x=>JSON.stringify([x.sourceRef,x.providerId,x.sourcePath,x.bindingDigest]);
  if(identity(old)!==identity(next)){
    return {
      status:'NOT_COMPARABLE',
      scope:'SAME_HOST_SOURCE_AND_BINDING_ONLY',
      sourceRelation:null,observations:[old,next],
      claim:null,semanticAccuracy:null,taskAccepted:false,
      resultReadback:'NOT_TESTED',
      cost:{sourceReadsByK05:0,bytesRehashed:old.bytes+next.bytes,
            humanReviewSeconds:null,sourceReadLatencyMs:null},
    };
  }
  const relation=sourceChange(previous.observation,current.observation);
  const expected=old.revision===next.revision?'UNCHANGED':'CHANGED';
  if(!object(relation)||relation.status!==expected||
     relation.basis!=='SOURCE_REVISION'||
     relation.previousRevision!==old.revision||
     relation.currentRevision!==next.revision)
    invalid('OWNER_RELATION_DISAGREEMENT');
  return {
    status:'CONFIRMED',
    scope:'TWO_PINNED_HOST_SNAPSHOTS_NOT_LIVE_CURRENTNESS',
    sourceRelation:relation.status,observations:[old,next],
    claim:null,semanticAccuracy:null,taskAccepted:false,
    resultReadback:'NOT_TESTED',
    cost:{sourceReadsByK05:0,bytesRehashed:old.bytes+next.bytes,
          humanReviewSeconds:null,sourceReadLatencyMs:null},
  };
}
