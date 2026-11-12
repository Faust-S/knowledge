/** Reproduce the cost of owner K01 refresh + optional K05 proof on the SAME
 * approved commercial-project fixture. This measures in-memory processing,
 * not live customer outcomes, inference, human effort or network latency.
 */
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {reviewK01ProjectRefresh} from './k05_k01_refresh_review.mjs';

export const SCHEMA='IWXA_K05_K01_REFRESH_MEASUREMENTS/0.1';
const OWNER='d0de69ec0ef714422555861bea20dafee89f5cc7';
const BLOBS={
 'modules/k01-context/integrations/project-continuation.mjs':'828330f3a6651f468e946fc4111931c34e7fd997',
 'modules/k01-context/tests/fixtures/commercial-project.mjs':'5a5b58f94bde3913869d268f161a7ea0f17c4338',
};
const sha=b=>createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const hold=why=>{throw Error('K05_K01_REFRESH_STUDY_'+why)};
const median=(a,q)=>{const s=[...a].sort((x,y)=>x-y);
 return Number(s[Math.ceil(s.length*q)-1].toFixed(6));};

export async function studyK01Refresh(root){
 root=resolve(root);
 for(const [path,pin] of Object.entries(BLOBS))
  if(sha(readFileSync(join(root,path)))!==pin)hold('OWNER_REVISION_CHANGED');
 const base=join(root,'modules/k01-context');
 const fixture=await import(pathToFileURL(join(base,'tests/fixtures/commercial-project.mjs')).href);
 const owner=await import(pathToFileURL(join(base,'integrations/project-continuation.mjs')).href);
 if(owner.PROJECT_CONTINUATION_VERSION!=='0.1.1'||
    owner.PROJECT_REFRESH_VERSION!=='0.1.0')hold('OWNER_CONTRACT_DRIFT');
 const cases=[
  {id:'unchanged_approval',options:{},expected:'CURRENT'},
  {id:'revised_approval',options:{updated:true},expected:'UPDATED'},
  {id:'contradicting_decision',options:{addConflict:true},expected:'INCOMPLETE'},
  {id:'missing_accepted_quote',options:{},expected:'REJECTED',remove:true},
  {id:'revoked_permission',options:{},expected:'REJECTED',revoke:true},
 ];
 const trials=[];
 for(const scenario of cases){
  const cpuOwner=[],cpuK05=[];
  let exact=null;
  for(let i=0;i<12;i++){
   const old=fixture.makeCommercialCase();
   const saved=await owner.prepareProjectContinuation(old.request,old.sourcePort);
   const newer=fixture.makeCommercialCase(scenario.options);
   const prior=newer.getMetrics();
   let currentRequest=newer.request,port=newer.sourcePort;
   if(scenario.revoke)
    currentRequest={...newer.request,allowedSources:newer.request.allowedSources.filter(
     x=>x!=='doc:quote-approved')};
   if(scenario.remove){
    port={async listSources(args){const roster=await newer.sourcePort.listSources(args);
      return {...roster,sources:roster.sources.filter(x=>x.sourceRef!=='doc:quote-approved')};},
      async readSource(args){return newer.sourcePort.readSource(args);}};
   }
   const started=performance.now();
   const receipt=await owner.refreshProjectContinuation(saved,currentRequest,port);
   const ownerMs=performance.now()-started;
   const b=performance.now();
   const proof=reviewK01ProjectRefresh({
    saved,ownerRefresh:receipt,
    ...(scenario.revoke||scenario.remove?{}:{
     previousAuthorizedDocuments:old.documents,
     currentAuthorizedDocuments:newer.documents,
    }),
   });
   const k05Ms=performance.now()-b;
   const metrics=newer.getMetrics();
   const current={
    status:receipt.status,
    reason:receipt.reason,
    k05Status:proof.status,
    ownerSourceReads:metrics.reads-prior.reads,
    ownerSourceCatalogReads:metrics.lists-prior.lists,
    k05SourceReads:proof.metrics.k05HostReads,
    k05BytesRehashed:proof.metrics.k05RehashedSourceBytes,
    ownerHasCurrentEvidence:receipt.status==='CURRENT'&&!receipt.requiresReview,
    userTimeMs:null,humanGold:false,precision:null,recall:null,f1:null,
    noIndependentLiveSourceVerification:true,
   };
   if(current.status!==scenario.expected)hold('STATUS_NOT_REPRODUCED');
   if(!exact)exact=current;
   else if(JSON.stringify(current)!==JSON.stringify(exact))hold('METRICS_NOT_DETERMINISTIC');
   cpuOwner.push(ownerMs);cpuK05.push(k05Ms);
  }
  trials.push({
   scenario:scenario.id,...exact,
   ownerWallMsMedian:median(cpuOwner,.5),ownerWallMsP95:median(cpuOwner,.95),
   k05WallMsMedian:median(cpuK05,.5),k05WallMsP95:median(cpuK05,.95),
   repetitions:12,
  });
 }
 return {schema:SCHEMA,qualification:'K01_OWNER_FIXTURE_CONTROLLED_NOT_HUMAN_GOLD',
  ownerCommit:OWNER,ownerSourceBlobs:BLOBS,
  trials,limits:{realUserTime:null,realModelInvocations:0,realHumanCorrections:null,
   independentQualityLabels:null,skillGain:'NOT_MEASURED',memoryGain:'NOT_MEASURED',
   sourceProofIsNotCurrentnessWithoutOwnerRefresh:true,
   noAdditionalK05HostReads:true,
   processingEnvironment:'ONE_RUNNER_IN_MEMORY_NOT_INSTALLED_AGENT'},
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),take=name=>{const pos=args.indexOf(name);
  if(pos<0||!args[pos+1])hold('MISSING_'+name);return args[pos+1];};
 const output=take('--out');
 if(existsSync(output))hold('OUTPUT_EXISTS');
 const report=await studyK01Refresh(take('--k01-owner-root'));
 writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log('K05_K01_REFRESH_STUDY '+JSON.stringify({
  schema:report.schema,results:report.trials.map(x=>({
   scenario:x.scenario,status:x.status,review:x.k05Status,
   ownerReads:x.ownerSourceReads,ownerCatalogReads:x.ownerSourceCatalogReads,
   k05Reads:x.k05SourceReads,bytesRehashed:x.k05BytesRehashed,
   ownerMedianMs:x.ownerWallMsMedian,k05MedianMs:x.k05WallMsMedian,
   ownerP95Ms:x.ownerWallMsP95,k05P95Ms:x.k05WallMsP95,
  })),humanTime:'NOT_MEASURED',inferenceCalls:0}));
}
