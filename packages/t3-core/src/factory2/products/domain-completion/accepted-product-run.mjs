import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const PATHS = Object.freeze({
  terminal: 't2/FACTORY2_STUDIO_TERMINAL_RESULT_CURRENT.json',
  decision: 't2/FACTORY2_STUDIO_HUMAN_DECISION_CURRENT.json',
  engineering: 't2/FACTORY2_ENGINEERING_INPUT_CURRENT.json',
});
const fail = code => {throw new Error('FACTORY2_ACCEPTED_PRODUCT_' + code);};
const isSha = s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
const isDigest = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
function git(root,args,encoding='utf8') {
  const r=spawnSync('git',args,{cwd:root,encoding,timeout:12000,maxBuffer:8*1024*1024});
  if(r.error||r.status!==0) fail('GIT_UNAVAILABLE');
  return encoding==='utf8'?r.stdout.trim():r.stdout;
}
function source(root,commit,path) {
  if(!isSha(commit)||!Object.values(PATHS).includes(path)) fail('SOURCE_INVALID');
  return git(root,['show',commit+':'+path],null);
}
function workingBytes(root,path) {
  const file=resolve(root,path);
  if(!lstatSync(file).isFile()) fail('ACCEPTED_SOURCE_NOT_REGULAR_FILE');
  return readFileSync(file);
}
function addedAt(root,path) {
  const commits=git(root,['log','--diff-filter=A','--format=%H','--',path]).split('\n').filter(Boolean);
  if(commits.length!==1||!isSha(commits[0])) fail('ACCEPTANCE_HISTORY_UNAVAILABLE');
  return commits[0];
}
function ancestor(root,a,b){git(root,['merge-base','--is-ancestor',a,b]);}
function json(b,label){try{return JSON.parse(b.toString('utf8'));}catch{fail('INVALID_'+label);}}
function put(path,value){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,value);}

/** Product-only start from an accepted, committed Git subject.
 * No source ZIP, new Human approval or Factory rerun.
 */
export function initAcceptedProductRun(canonicalRoot,outputRoot) {
  const canonical=resolve(canonicalRoot),out=resolve(outputRoot);
  if(existsSync(out)) fail('OUTPUT_EXISTS');
  const head=git(canonical,['rev-parse','HEAD']);
  if(!isSha(head)||git(canonical,['status','--porcelain','--untracked-files=all'])) fail('CANONICAL_CHECKOUT_DIRTY');
  const terminalCommit=addedAt(canonical,PATHS.terminal);
  const decisionCommit=addedAt(canonical,PATHS.decision);
  ancestor(canonical,decisionCommit,terminalCommit);
  ancestor(canonical,terminalCommit,head);
  const terminalBytes=source(canonical,terminalCommit,PATHS.terminal);
  const decisionBytes=source(canonical,decisionCommit,PATHS.decision);
  const engineeringBytes=source(canonical,terminalCommit,PATHS.engineering);
  for(const [path,bytes] of [[PATHS.terminal,terminalBytes],[PATHS.decision,decisionBytes],[PATHS.engineering,engineeringBytes]]) {
    if(!workingBytes(canonical,path).equals(bytes)) fail('ACCEPTED_BYTES_CHANGED');
  }
  const terminal=json(terminalBytes,'TERMINAL'),decision=json(decisionBytes,'DECISION');
  const engineering=json(engineeringBytes,'ENGINEERING');
  if(terminal.schema!=='IWXA_T2_FACTORY2_STUDIO_TERMINAL_RESULT_V1'||
    terminal.status!=='T2_READY'||terminal.explicitHumanDecision!==true||
    terminal.productionActivation!==false||
    decision.schema!=='IWXA_T2_FACTORY2_STUDIO_HUMAN_DECISION_V1'||
    decision.decisionSource!=='HUMAN_EXPLICIT'||decision.decision!=='APPROVE'||
    decision.domainId!==terminal.domainId||decision.sourceSha256!==terminal.sourceSha256||
    decision.decisionId!==terminal.decisionId||decision.decidedBy!==terminal.decidedBy||
    decision.decidedAt!==terminal.decidedAt||!isDigest(terminal.sourceSha256)||
    !/^D(?:0[1-9]|[1-9]\d+)$/.test(terminal.domainId)||
    !engineering.input||engineering.sourceSha256!==terminal.sourceSha256||
    engineering.input.transformation?.intake?.domainId!==terminal.domainId||
    engineering.input.transformation?.intake?.currentSourceRef!=='sha256:'+terminal.sourceSha256||
    engineering.input.genericWriteAuthority!==false||
    engineering.input.productionActivation!==false||
    !isSha(engineering.sourceSubjectCommit)||!isSha(engineering.sourceSubjectTree)) fail('ACCEPTANCE_INCONSISTENT');
  ancestor(canonical,engineering.sourceSubjectCommit,decisionCommit);
  if(git(canonical,['rev-parse',engineering.sourceSubjectCommit+'^{tree}'])!==engineering.sourceSubjectTree) fail('SOURCE_GIT_SUBJECT_MISMATCH');
  const inputBytes=Buffer.from(JSON.stringify(engineering.input,null,2)+'\n');
  const state={
    schema:'IWXA_T2_ACCEPTED_PRODUCT_RUN_V1',status:'T2_READY',
    domainId:terminal.domainId,sourceOrigin:'ACCEPTED_CANONICAL_GIT',
    sourceSha256:terminal.sourceSha256,engineeringInput:'engineering-input.json',
    engineeringInputSha256:sha(inputBytes),terminalResult:'STUDIO_TERMINAL_RESULT.json',
    acceptedGit:{...PATHS,terminalCommit,decisionCommit,terminalSha256:sha(terminalBytes),
      decisionSha256:sha(decisionBytes),engineeringSha256:sha(engineeringBytes),
      sourceHead:engineering.sourceSubjectCommit,sourceTree:engineering.sourceSubjectTree},
    productionActivation:false,
  };
  mkdirSync(out,{recursive:true});
  put(resolve(out,'DOMAIN_RUN.json'),JSON.stringify(state,null,2)+'\n');
  put(resolve(out,'STUDIO_TERMINAL_RESULT.json'),terminalBytes);
  put(resolve(out,'engineering-input.json'),inputBytes);
  return state;
}

/** Validate accepted historical decision against the actual canonical checkout.
 * The calling product gate additionally requires exact remote HEAD and live UI.
 */
export function assertAcceptedProductGit({canonicalRoot,runState,terminalBytes,engineeringBytes}) {
  const a=runState?.acceptedGit;
  if(runState?.schema!=='IWXA_T2_ACCEPTED_PRODUCT_RUN_V1'||
    runState.status!=='T2_READY'||runState.sourceOrigin!=='ACCEPTED_CANONICAL_GIT'||
    runState.productionActivation!==false||runState.terminalResult!=='STUDIO_TERMINAL_RESULT.json'||
    runState.engineeringInput!=='engineering-input.json'||!isDigest(runState.engineeringInputSha256)||
    !a||a.terminal!==PATHS.terminal||a.decision!==PATHS.decision||a.engineering!==PATHS.engineering||
    !isSha(a.terminalCommit)||!isSha(a.decisionCommit)||!isSha(a.sourceHead)||!isSha(a.sourceTree)||
    !isDigest(a.terminalSha256)||!isDigest(a.decisionSha256)||!isDigest(a.engineeringSha256)) fail('RUN_INVALID');
  const root=resolve(canonicalRoot),head=git(root,['rev-parse','HEAD']);
  if(addedAt(root,a.terminal)!==a.terminalCommit||addedAt(root,a.decision)!==a.decisionCommit) fail('ACCEPTANCE_HISTORY_CHANGED');
  ancestor(root,a.decisionCommit,a.terminalCommit);ancestor(root,a.terminalCommit,head);
  ancestor(root,a.sourceHead,a.decisionCommit);
  if(git(root,['rev-parse',a.sourceHead+'^{tree}'])!==a.sourceTree) fail('SOURCE_GIT_SUBJECT_MISMATCH');
  const originalTerminal=source(root,a.terminalCommit,a.terminal);
  const originalDecision=source(root,a.decisionCommit,a.decision);
  const originalEngineering=source(root,a.terminalCommit,a.engineering);
  if(sha(originalTerminal)!==a.terminalSha256||
     sha(originalDecision)!==a.decisionSha256||
     sha(originalEngineering)!==a.engineeringSha256) fail('ACCEPTED_BYTES_CHANGED');
  for(const [path,bytes] of [[a.terminal,originalTerminal],[a.decision,originalDecision],[a.engineering,originalEngineering]]) {
    if(!workingBytes(root,path).equals(bytes)) fail('ACCEPTED_BYTES_CHANGED');
  }
  const t=json(originalTerminal,'TERMINAL'),d=json(originalDecision,'DECISION'),e=json(originalEngineering,'ENGINEERING');
  if(!terminalBytes.equals(originalTerminal)||
    e?.sourceSha256!==runState.sourceSha256||t?.sourceSha256!==runState.sourceSha256||
    d?.sourceSha256!==runState.sourceSha256||t?.domainId!==runState.domainId||
    d?.domainId!==runState.domainId||t?.status!=='T2_READY'||t.explicitHumanDecision!==true||
    d?.decision!=='APPROVE'||d.decisionSource!=='HUMAN_EXPLICIT'||
    t.decisionId!==d.decisionId||t.decidedBy!==d.decidedBy||t.decidedAt!==d.decidedAt||
    t.productionActivation!==false||d.productionActivation!==false||
    e.sourceSubjectCommit!==a.sourceHead||e.sourceSubjectTree!==a.sourceTree||
    e.input?.transformation?.intake?.currentSourceRef!=='sha256:'+runState.sourceSha256||
    !engineeringBytes.equals(Buffer.from(JSON.stringify(e.input,null,2)+'\n'))||
    sha(engineeringBytes)!==runState.engineeringInputSha256) fail('ACCEPTANCE_INCONSISTENT');
  return {terminalPath:a.terminal,terminalSha256:a.terminalSha256,
    decisionPath:a.decision,decisionSha256:a.decisionSha256};
}
