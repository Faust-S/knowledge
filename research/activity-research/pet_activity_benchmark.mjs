/**
 * IWXA PET read-only exploratory Activity benchmark; no tasks or grants created.
 * Source: patriziobellan86/PETv1.1 Git commit 4bcacf71b5b191840789bb307c1a7f288a274ded
 * Blob: 7b8db47fe78dc0614614708732118d38e77e030b (187158 bytes)
 * PET card marks MIT license; see https://huggingface.co/datasets/patriziobellan/PET
 * No corpus redistribution. This is NOT an independently held-out Task Discovery
 * evaluation, and it must never qualify T0/T1, Task Engine or product authority.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const PET_BLOB = "7b8db47fe78dc0614614708732118d38e77e030b";
const PET_SIZE = 187158;
function evaluatePet(inputRecords, {split="family",emitPredictions=false}={}) {
  if (!["document","family"].includes(split))
    throw Error("PET_SPLIT_MODE_INVALID");
  if (emitPredictions && split!=="family")
    throw Error("PET_PREDICTIONS_REQUIRE_GROUP_HELDOUT");
  // IWXA PET exploratory benchmark 0.1. Do not use PET Activity as TaskType.
  // Features/epochs are fixed before evaluation; each full document is held out.
  const EPOCHS = 5;
  const BIO = new Set(["B-Activity", "I-Activity"]);
  if (!Array.isArray(inputRecords) || inputRecords.length < 2)
    throw Error("PET_RECORDS_MISSING");
  const seen = new Set();
  const examples = inputRecords.map((row) => {
    const doc = row["document name"], sent = row["sentence-ID"];
    const tokens = row.tokens, labels = row["ner-tags"];
    if (typeof doc !== "string" || !doc || !Number.isInteger(sent) ||
        !Array.isArray(tokens) || !Array.isArray(labels) ||
        !tokens.length || tokens.length !== labels.length)
      throw Error("PET_ROW_CONTRACT_INVALID");
    const id = doc + ":" + sent;
    if (seen.has(id)) throw Error("PET_DUPLICATE_DOCUMENT_SENTENCE");
    seen.add(id);
    for (let i=0; i<tokens.length; i++) {
      if (typeof tokens[i] !== "string" || typeof labels[i] !== "string")
        throw Error("PET_NONSTRING_TOKEN_OR_TAG");
      if (labels[i] === "I-Activity" && !BIO.has(labels[i-1]))
        throw Error("PET_BIO_ACTIVITY_SEQUENCE_INVALID");
    }
    const gold = labels.map(label => BIO.has(label));
    const words = tokens.map(w => w.toLowerCase());
    return {doc, sent, tokens, words, labels, gold};
  }).sort((a,b) => a.doc.localeCompare(b.doc, "en") || a.sent-b.sent);
  const docs = [...new Set(examples.map(e=>e.doc))].sort();
  // This is a CONSERVATIVE grouping by PET identifier prefix, not an
  // assertion that each identifier prefix is exactly one real-world process.
  function family(doc) {
    const match=/^doc-([0-9]+)\.[0-9]+$/.exec(doc);
    if(!match)throw Error("PET_DOCUMENT_FAMILY_INVALID");
    return "family-"+match[1];
  }
  const families=[...new Set(docs.map(family))].sort();
  const foldKey=(e)=>split==="document"?e.doc:family(e.doc);
  const folds=split==="document"?docs:families;
  if (docs.length < 2) throw Error("PET_DOCUMENT_DISJOINT_FOLDS_UNAVAILABLE");
  const totalGoldTokens = examples.reduce((sum,e)=>sum+e.gold.filter(Boolean).length,0);
  const totalGoldSpans = examples.reduce((sum,e)=>sum+e.labels.filter(x=>x==="B-Activity").length,0);

  const morphologyStop = new Set([
    "this","thus","process","business","always","afterwards","minutes",
    "employees","persons","numbers","systems","such","perhaps","these",
    "works","records","orders","during","following","ongoing","among"
  ]);
  function explicitRequest(words) {
    const out = words.map(()=>false);
    for (let i=0; i<words.length; i++) {
      const w=words[i];
      let candidate=-1;
      if (["must","should"].includes(w)) candidate=i+1;
      if (["need","needs","have","has","want","wants","plan","plans"].includes(w)
          && words[i+1]==="to") candidate=i+2;
      if (candidate>=0 && candidate<words.length &&
          /^[a-z][a-z'-]*$/.test(words[candidate])) out[candidate]=true;
    }
    return out;
  }
  function morphology(words) {
    return words.map(w => /^[a-z][a-z'-]{3,}$/.test(w) &&
      /(ed|ing|ize|ise|ifies|izes|ises|es|s)$/.test(w) &&
      !morphologyStop.has(w));
  }
  function features(e,i) {
    const w=e.words[i], prev=e.words[i-1]??"<bos>", next=e.words[i+1]??"<eos>";
    const digits=/[0-9]/.test(w)?"yes":"no";
    return [
      "bias", "word="+w, "prev="+prev, "next="+next,
      "prevnext="+prev+"|"+next,
      "pre2="+w.slice(0,2), "pre3="+w.slice(0,3),
      "suf2="+w.slice(-2), "suf3="+w.slice(-3), "suf4="+w.slice(-4),
      "prevsuf="+prev.slice(-3), "nextsuf="+next.slice(-3),
      "prevword|cur="+prev+"|"+w,
      "cur|nextword="+w+"|"+next,
      "initialcapital="+(/^[A-Z]/.test(e.tokens[i])?"yes":"no"),
      "hasdigit="+digits, "len="+Math.min(10,w.length)
    ];
  }
  for (const e of examples) e.features=e.tokens.map((_,i)=>features(e,i));
  const labelsByMethod = {
    all_tokens: examples.map(e=>e.tokens.map(()=>true)),
    explicit_request_cue: examples.map(e=>explicitRequest(e.words)),
    morphology_cue: examples.map(e=>morphology(e.words)),
    document_heldout_perceptron: new Array(examples.length)
  };
  const buckets=new Map(folds.map(key=>[key,[]]));
  examples.forEach((e,i)=>buckets.get(foldKey(e)).push(i));
  // Hold out the full fold. Every document/token in that group is invisible
  // to the model during fitting, including sentence identities and labels.
  for (const heldDoc of folds) {
    const weights=new Map();
    const trainIndexes=examples.map((_,i)=>i).filter(i=>foldKey(examples[i])!==heldDoc);
    const score = (fts) => {
      let v=0; for (const f of fts) v+=(weights.get(f)??0); return v;
    };
    for (let epoch=0; epoch<EPOCHS; epoch++) {
      for (const idx of trainIndexes) {
        const e=examples[idx];
        for (let i=0;i<e.tokens.length;i++) {
          const fts=e.features[i], prediction=score(fts)>0;
          if (prediction===e.gold[i]) continue;
          const direction=e.gold[i]?1:-1;
          for (const f of fts) weights.set(f,(weights.get(f)??0)+direction);
        }
      }
    }
    for (const idx of buckets.get(heldDoc)) {
      const e=examples[idx];
      labelsByMethod.document_heldout_perceptron[idx]=e.features.map(fs=>score(fs)>0);
    }
  }
  function goldSpans(e) {
    const spans=[]; let start=-1;
    for(let i=0;i<=e.labels.length;i++){
      const label=i<e.labels.length?e.labels[i]:"O";
      if(label==="B-Activity"){
        if(start>=0)spans.push(start+":"+i);
        start=i;
      }else if(label!=="I-Activity" && start>=0){
        spans.push(start+":"+i);start=-1;
      }
    }
    return spans;
  }
  function predictedSpans(preds) {
    const spans=[];let start=-1;
    for(let i=0;i<=preds.length;i++){
      if(i<preds.length&&preds[i]){if(start<0)start=i}
      else if(start>=0){spans.push(start+":"+i);start=-1}
    }
    return spans;
  }
  const fmt=(num)=>Math.round(num*10000)/10000;
  function prf(tp,fp,fn){
    const precision=tp+fp?tp/(tp+fp):0,recall=tp+fn?tp/(tp+fn):0;
    const f1=precision+recall?2*precision*recall/(precision+recall):0;
    return {tp,fp,fn,precision:fmt(precision),recall:fmt(recall),f1:fmt(f1)};
  }
  const methods={};
  for (const [name,predictions] of Object.entries(labelsByMethod)){
    let ttp=0,tfp=0,tfn=0,stp=0,sfp=0,sfn=0,flagged=0;
    const perDoc=new Map(docs.map(d=>[d,{tp:0,fp:0,fn:0}]));
    for(let i=0;i<examples.length;i++){
      const e=examples[i], p=predictions[i];
      if (!Array.isArray(p)||p.length!==e.gold.length) throw Error("PET_PREDICTION_SHAPE_INVALID");
      if(p.some(Boolean))flagged++;
      for(let k=0;k<p.length;k++){
        if(p[k]&&e.gold[k]){ttp++;perDoc.get(e.doc).tp++}
        else if(p[k]){tfp++;perDoc.get(e.doc).fp++}
        else if(e.gold[k]){tfn++;perDoc.get(e.doc).fn++}
      }
      const goldSet=new Set(goldSpans(e)), predicted=predictedSpans(p);
      for (const span of predicted){if(goldSet.has(span))stp++;else sfp++}
      sfn+=goldSet.size-predicted.filter(span=>goldSet.has(span)).length;
    }
    const docF1=[...perDoc.values()].map(d=>prf(d.tp,d.fp,d.fn).f1).sort((a,b)=>a-b);
    const familyStats=new Map(families.map(family=>[family,{tp:0,fp:0,fn:0}]));
    for(const doc of docs) {
      const row=perDoc.get(doc), target=familyStats.get(family(doc));
      target.tp+=row.tp;target.fp+=row.fp;target.fn+=row.fn;
    }
    const familyScores=[...familyStats.entries()].map(([id,score])=>({
      family:id,...prf(score.tp,score.fp,score.fn)
    }));
    methods[name]={
      token:prf(ttp,tfp,tfn),
      exact_span:prf(stp,sfp,sfn),
      sentences_with_any_predicted_token:flagged,
      doc_macro_token_f1:fmt(docF1.reduce((a,b)=>a+b,0)/docF1.length),
      doc_token_f1_min:docF1[0],doc_token_f1_median:docF1[Math.floor(docF1.length/2)],
      doc_token_f1_max:docF1.at(-1),
      family_macro_token_f1:fmt(familyScores.reduce((total,entry)=>total+entry.f1,0)/families.length),
      token_f1_by_family:familyScores
    };
  }
  const predictions=labelsByMethod.document_heldout_perceptron;
  const errors=examples.flatMap((e,i)=>{
    const predicted=predictions[i],falsePositive=[],falseNegative=[];
    for(let k=0;k<e.tokens.length;k++){
      if(predicted[k]&&!e.gold[k])falsePositive.push(k);
      else if(!predicted[k]&&e.gold[k])falseNegative.push(k);
    }
    return falsePositive.length||falseNegative.length?[{
      source_document:e.doc,
      source_sentence_id:e.sent,
      source_family:family(e.doc),
      false_positive_token_positions:falsePositive,
      missed_activity_token_positions:falseNegative,
      total_mismatched_tokens:falsePositive.length+falseNegative.length,
      source_scope:"PET_PUBLIC_CORPUS_TOKEN_OFFSETS_NOT_U1_EVIDENCE",
      task_candidate:false,
      accepted_task:false
    }]:[];
  }).sort((a,b)=>b.total_mismatched_tokens-a.total_mismatched_tokens
      ||a.source_document.localeCompare(b.source_document)
      ||a.source_sentence_id-b.source_sentence_id);
  const MAX_REVIEW=16;
  return {
    benchmark_schema:"IWXA_PET_ACTIVITY_PROBE/0.2",
    status:"EXPLORATORY_GROUPED_EVALUATION_NOT_TASK_DISCOVERY_QUALIFICATION",
    review_queue:{
      status:"RESEARCH_SCORING_DIAGNOSTICS_NO_TASK_CANDIDATES",
      error_sentences_total:errors.length,
      shown:Math.min(errors.length,MAX_REVIEW),
      omitted:Math.max(0,errors.length-MAX_REVIEW),
      rows:errors.slice(0,MAX_REVIEW),
      u1_verified_source_links:false
    },
    task_vs_activity:"PET_ACTIVITIES_NOT_PERSONAL_TASK_GOALS",
    upstream:"patriziobellan86/PETv1.1 at pinned Git commit; MIT declared in PET HuggingFace card",
    counts:{
      documents:docs.length,sentences:examples.length,
      tokens:examples.reduce((n,e)=>n+e.tokens.length,0),
      gold_activity_tokens:totalGoldTokens,gold_activity_spans:totalGoldSpans,
      non_activity_tokens:examples.reduce((n,e)=>n+e.tokens.length,0)-totalGoldTokens
    },
    evaluation:{
      splitting:split==="document"?"LEAVE_ONE_ENTIRE_DOCUMENT_OUT":
        "LEAVE_ONE_DOCUMENT_PREFIX_FAMILY_OUT",
      folds:folds.length,
      document_prefix_families:families.length,
      grouping_meaning:"NAME_PREFIX_HEURISTIC_NOT_PROOF_OF_INDEPENDENT_PROCESS",
      train_and_test_family_disjoint:split==="family",
      evaluation_only_no_posthoc_training_update:true,
      scorer:"B_OR_I_ACTIVITY_TOKEN_AND_EXACT_CONTIGUOUS_SPAN",
      train_epochs:EPOCHS,
      no_label_exposure_from_heldout_document_in_training:true,
      lexical_baseline_is_not_literal_U1_review_hints:true,
      experiment_is_exploratory_not_independent_locked_holdout:true
    },methods,
    ...(emitPredictions?{
      prediction_export:{
        schema:"IWXA_PET_HELDOUT_ACTIVITY_TOKEN_POSITIONS/0.1",
        status:"MODEL_PREDICTIONS_NEED_U1_SOURCE_BINDING_AND_HUMAN_REVIEW",
        corpus_git_blob:PET_BLOB,
        split:"LEAVE_ONE_DOCUMENT_PREFIX_FAMILY_OUT",
        provider_ref:"pet-v1.1-local-perceptron-lofo",
        rows:examples.map((e,i)=>({
          document:e.doc,sentence_id:e.sent,token_count:e.tokens.length,
          activity_token_positions:predictions[i].flatMap((yes,position)=>yes?[position]:[])
        })),
        original_text_exported:false, task_candidates_created:0,
        task_type_ids_assigned:0, engine_accepted:false
      }
    }:{})
  };
}

export {evaluatePet};
if (process.argv[1]?.endsWith("/pet_activity_benchmark.mjs") ||
    process.argv[1]==="pet_activity_benchmark.mjs") {
  const file=process.argv[2];
  const split=process.argv[3]??"family";
  const mode=process.argv[4]??"metrics";
  if (!file || !["family","document"].includes(split) ||
      !["metrics","predictions"].includes(mode)) {
    process.stderr.write("Usage: node pet_activity_benchmark.mjs path/to/PETv1.1-entities.jsonl [family|document] [metrics|predictions]\n");
    process.exit(2);
  }
  try {
    const bytes=readFileSync(file);
    const blobSha=createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
    if (bytes.length!==PET_SIZE || blobSha!==PET_BLOB)
      throw Error("PET_EXACT_UPSTREAM_GIT_BLOB_MISMATCH");
    const raw=bytes.toString("utf8").trim().split(/\r?\n/).map(JSON.parse);
    const result=evaluatePet(raw,{split,emitPredictions:mode==="predictions"});
    result.source={repository:"patriziobellan86/PETv1.1",head:"4bcacf71b5b191840789bb307c1a7f288a274ded",
      git_blob:blobSha,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length};
    process.stdout.write(JSON.stringify(
      mode==="predictions"?result.prediction_export:result,null,2)+"\n");
  } catch (error) {
    process.stderr.write("PET_BENCHMARK_REJECTED: "+(error?.message ?? "UNKNOWN")+"\n");
    process.exit(2);
  }
}
