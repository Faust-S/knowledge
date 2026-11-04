// K01: host-neutral, stateless context projection. No network or persistent storage.
import { createHash } from 'node:crypto';
export const CONTRACT_VERSION = '0.1.0';
const id = x => typeof x === 'string' && x.length > 0 && x.length <= 512;
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const stable = o => JSON.stringify(o);
function checkItem(item) {
  if (!item || !id(item.id) || !id(item.sourceRef) || !id(item.revision)
      || !id(item.type) || !['observed','reported','inferred','target'].includes(item.epistemic)
      || !Number.isSafeInteger(item.estimatedTokens) || item.estimatedTokens < 0) throw new TypeError('invalid KnowledgeItem');
  return item;
}
function normalize(request) {
  if (!request || !id(request.taskId) || !Array.isArray(request.terms)
      || !Number.isSafeInteger(request.maxTokens) || request.maxTokens < 0
      || !Array.isArray(request.allowedSources)) throw new TypeError('invalid ContextRequest');
  const terms = [...new Set(request.terms.map(t => {
    if (!id(t)) throw new TypeError('invalid search term');
    return t.toLowerCase().trim();
  }).filter(Boolean))].sort();
  const allowed = [...new Set(request.allowedSources.map(s => {
    if (!id(s)) throw new TypeError('invalid source');
    return s;
  }))].sort();
  return { taskId: request.taskId, terms, maxTokens: request.maxTokens, allowedSources: allowed, allowInferred: request.allowInferred === true };
}
function score(item, terms) {
  const hay = [item.type, ...(Array.isArray(item.keywords) ? item.keywords : [])].join(' ').toLowerCase();
  return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
}
export async function selectContext(request, observationPort) {
  const req = normalize(request);
  if (!observationPort || typeof observationPort.query !== 'function' || typeof observationPort.observe !== 'function') throw new TypeError('observationPort requires query and observe');
  const items = await observationPort.query({ taskId:req.taskId, terms:req.terms, allowedSources:req.allowedSources });
  if (!Array.isArray(items)) throw new TypeError('query must return an array');
  const candidates = items.map(checkItem).filter(item => req.allowedSources.includes(item.sourceRef))
    .map(item => ({ item, relevance: score(item, req.terms) }))
    .filter(x => x.relevance > 0)
    .sort((a,b) => b.relevance-a.relevance || a.item.sourceRef.localeCompare(b.item.sourceRef) || a.item.id.localeCompare(b.item.id) || a.item.revision.localeCompare(b.item.revision));
  const selected = [], omissions = [];
  let tokens = 0;
  for (const {item,relevance} of candidates) {
    if (item.epistemic === 'inferred' && !req.allowInferred) { omissions.push({id:item.id,reason:'inferred_excluded'}); continue; }
    const obs = await observationPort.observe({sourceRef:item.sourceRef,requestedRevision:item.revision,itemId:item.id});
    if (!obs || obs.sourceRef !== item.sourceRef || !id(obs.currentRevision) || obs.complete !== true) {
      omissions.push({id:item.id,reason:'incomplete_source'}); continue;
    }
    if (obs.currentRevision !== item.revision) { omissions.push({id:item.id,reason:'stale',requestedRevision:item.revision,currentRevision:obs.currentRevision}); continue; }
    if (typeof obs.excerpt !== 'string' || !obs.excerpt || !id(obs.evidenceRef) || typeof obs.sha256 !== 'string' || hash(obs.excerpt) !== obs.sha256) {
      omissions.push({id:item.id,reason:'unverified_evidence'}); continue;
    }
    if (tokens + item.estimatedTokens > req.maxTokens) { omissions.push({id:item.id,reason:'budget_exceeded'}); continue; }
    tokens += item.estimatedTokens;
    selected.push({id:item.id,type:item.type,sourceRef:item.sourceRef,revision:item.revision,
      epistemic:item.epistemic, evidenceRef:obs.evidenceRef, sha256:obs.sha256,
      excerpt:obs.excerpt, estimatedTokens:item.estimatedTokens,relevance,
      inclusionReason:'term_match_pinned_verified_source'});
  }
  return {contractVersion:CONTRACT_VERSION,taskId:req.taskId,selected,omissions,estimatedTokens:tokens,
    missing:req.terms.length > 0 && selected.length === 0};
}
export function traceEvidence(projection) {
  if (!projection || !Array.isArray(projection.selected)) throw new TypeError('invalid ContextProjection');
  return projection.selected.map(({id,sourceRef,revision,epistemic,evidenceRef,sha256}) =>
    ({id,sourceRef,revision,epistemic,evidenceRef,sha256}));
}
export function summarizeMemory(readonlyItems, constraints) {
  if (!Array.isArray(readonlyItems) || !constraints || !Number.isSafeInteger(constraints.maxTokens) || constraints.maxTokens < 0) throw new TypeError('invalid summary input');
  const sorted = readonlyItems.map(checkItem).sort((a,b)=>a.sourceRef.localeCompare(b.sourceRef)||a.id.localeCompare(b.id));
  let count=0;
  const selected=[];
  for(const item of sorted) {
    if (item.epistemic === 'inferred' || count + item.estimatedTokens > constraints.maxTokens) continue;
    count+=item.estimatedTokens;
    selected.push({id:item.id,sourceRef:item.sourceRef,revision:item.revision,epistemic:item.epistemic,type:item.type});
  }
  return {contractVersion:CONTRACT_VERSION,selected,estimatedTokens:count};
}
export const sha256 = hash;
