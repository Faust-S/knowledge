import {reviewTechnologyTextChange} from './technology-product-revision.mjs';
// Conservative candidate comparison, NOT a semantic equivalence engine.
// All original wordings are retained by callers. Only an explicit review
// may adopt a shared wording when source texts differ. Do not stem arbitrary
// nouns, reorder tokens, strip negation, qualifiers, numbers or units.
const actions=[
 ['проверить','проверьте'],
 ['уточнить','уточните'],
 ['сохранить','сохраните'],
 ['настроить','настройте'],
 ['отрегулировать','отрегулируйте'],
 ['повторить','повторите'],
 ['измерить','измерьте'],
 ['разделить','разделите'],
 ['отделить','отделите'],
 ['указать','укажите'],
 ['зафиксировать','зафиксируйте'],
 ['сопоставить','сопоставьте'],
 ['выделить','выделите'],
 ['учесть','учтите'],
 ['check','verify'],
];
const aliases=new Map(actions.flatMap(([base,...forms])=>[base,...forms].map(word=>[word,base])));
export function practicalWordingKey(value){
 if(typeof value!=='string')throw new TypeError('PRACTICAL_WORDING_TEXT');
 // Keep internal whitespace and punctuation, case of unknown terms, and
 // the exact numbers/operators. A final period after a letter is ordinary
 // sentence punctuation; a period after a number is not normalized.
 const source=value.normalize('NFC').trim().replace(/(\p{L})\.$/u,'$1');
 return source.replace(/[\p{L}\p{M}\p{N}_]+/gu,word=>aliases.get(word.toLocaleLowerCase('ru-RU'))??word);
}

// Find possible shared practice among nonidentical wordings. This is a
// bounded review aid, not automatic merging or a model-quality score.
const actionWords=new Set([...aliases.values(),'keep','confirm','separate','identify','ensure','use','include','list','avoid','compare',
 'require','record','preserve','distinguish','remember','считать','учитывать','разделять','отделять','фиксировать','помнить']);
const ignored=new Set('и а но или в на у по к с из за для о об от до при перед после если не без the a an to for of in on at and or but before after if not without'.split(' '));
const tokens=v=>new Set((practicalWordingKey(v).toLocaleLowerCase('ru-RU').match(/[\p{L}\p{M}\p{N}_]+/gu)??[])
 .filter(w=>w.length>=2&&!ignored.has(w)));
const common=(a,b)=>[...a].filter(x=>b.has(x)).sort();
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function compareText(a,b,requireAction){
 const x=tokens(a),y=tokens(b),shared=common(x,y);
 if(requireAction&&!shared.some(w=>actionWords.has(w)))return null;
 if(shared.filter(w=>!actionWords.has(w)).length<2||shared.length*2<new Set([...x,...y]).size)return null;
 if(reviewTechnologyTextChange(a,b).changed_markers.length)return null;
 return shared;
}
/** Each input has stable id, exact comparison partition and source text
 * sections. Caller decides whether two items have distinct observations.
 * Return non-transitive pairs and preserve both complete original texts. */
export function compareRelatedPracticalWordings(rows,{actionSection=0}={}){
 if(!Array.isArray(rows)||!Number.isSafeInteger(actionSection)||actionSection<0)throw new TypeError('PRACTICAL_WORDING_INPUT');
 if(rows.length>160)return {pairs:[],limited:true};
 const sorted=[...rows].sort((a,b)=>cmp(a.id,b.id)),pairs=[];
 for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){
  const a=sorted[i],b=sorted[j];
  if(a.partition!==b.partition||a.sections.length!==b.sections.length||a.sections.length<=actionSection||
    a.sections.every((v,k)=>practicalWordingKey(v)===practicalWordingKey(b.sections[k])))continue;
  const evidence=new Set([...a.observations,...b.observations]);
  if(evidence.size<2||!a.observations.some(v=>!b.observations.includes(v))&&!b.observations.some(v=>!a.observations.includes(v)))continue;
  const shared=[];
  for(let k=0;k<a.sections.length;k++){
   // Exact sections need no lexical heuristic except the action anchor.
   const left=a.sections[k],right=b.sections[k];
   const terms=k!==actionSection&&practicalWordingKey(left)===practicalWordingKey(right)?
    [...tokens(left)].sort():compareText(left,right,k===actionSection);
   if(!terms){shared.length=0;break;}
   shared.push(...terms);
  }
  if(shared.length)pairs.push({left_id:a.id,right_id:b.id,shared_terms:[...new Set(shared)].sort(),distinct_observations:evidence.size});
 }
 pairs.sort((a,b)=>b.distinct_observations-a.distinct_observations||b.shared_terms.length-a.shared_terms.length||cmp(a.left_id,b.left_id)||cmp(a.right_id,b.right_id));
 return {pairs:pairs.slice(0,64),limited:pairs.length>64};
}

// Preserve complete explicit source instructions; never convert a report of
// uncertainty or an unrecognized fragment into a normative requirement.
const directive=/^(?:(?:keep|check|confirm|verify|separate|identify|do not|don't|never|ensure|use|include|list|avoid|compare|require|record|preserve|distinguish|remember)(?:\s|$)|(?:проверить|проверьте|уточнить|уточните|сохранить|сохраните|сохранять|сохраняйте|учитывать|учтите|учитывайте|разделять|разделить|разделите|разделяйте|отделять|отделить|отделите|не\s+(?:менять|изменять|переносить|копировать|считать|смешивать|утверждать|придумывать|удалять|допускать|заменять|публиковать|выполнять|использовать|пропускать|игнорировать|повторять|нарушать)|исключить|исключайте|указать|укажите|сопоставить|сопоставьте|сопоставляйте|фиксировать|зафиксировать|зафиксируйте|фиксируйте|выделить|выделите|выделяйте|помнить|учесть|настроить|настройте|отрегулировать|отрегулируйте|повторить|повторите|измерить|измерьте)(?:\s|$))/iu;
function reviewLines(value){
 return value.split(/\r?\n/).map(line=>line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/,'').trim()).filter(v=>v.length>=6&&v.length<=1000);
}
export function explicitPracticalInstructions(value){
 if(typeof value!=='string')throw new TypeError('PRACTICAL_WORDING_TEXT');
 return reviewLines(value).filter(line=>directive.test(line));
}
