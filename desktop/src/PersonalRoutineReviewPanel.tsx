import {useRef,useState,type ChangeEvent} from 'react';
import {groupPersonalRoutineEvidence,preparePersonalTechnologyProduct,type PersonalEvidenceReview,type ProductPreview}
 from '../../modules/activity-base-anonymizer/technology-product.mjs';
import {SOURCE,BUNDLE,FIELDS,reviewPersonalExtractionBundle,reviewPersonalPracticalExperience,type ExtractionReview,type PersonalPracticalExperience} from '../../modules/activity-base-anonymizer/personal-technology-extraction.mjs';
import {PersonalPracticalExperiencePanel} from './PersonalPracticalExperiencePanel';
import {ProductPresidioReviewPanel} from './ProductPresidioReviewPanel';
import {TechnologyReleasePanel} from './TechnologyReleasePanel';
const EMPTY={title:'',purpose:'',inputs:'',outputs:'',applicability:'',instructions:'',requirements:'',contexts:'',cadenceGuidance:''};
const fields=[['title','Название технологии'],['purpose','Назначение'],['inputs','Входы'],['outputs','Ожидаемый результат'],
 ['applicability','Когда применять'],['instructions','Обобщённая инструкция'],['requirements','Критерии результата, по одному в строке'],
 ['contexts','Необходимый локальный контекст, по одному в строке']] as const;
const extractionNames:Record<string,string>={...Object.fromEntries(fields),result_requirements:'Критерии результата',context_requirements:'Контекст получателя',cadence_guidance:'Периодичность'};
const lines=(v:string)=>v.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
export function PersonalRoutineReviewPanel(){
 const input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [records,setRecords]=useState<unknown>(null),[review,setReview]=useState<PersonalEvidenceReview|null>(null);
 const [selected,setSelected]=useState(''),[form,setForm]=useState(EMPTY),[retain,setRetain]=useState(false);
 const [extraction,setExtraction]=useState<ExtractionReview|null>(null),[experience,setExperience]=useState<PersonalPracticalExperience|null>(null);
 const [showEvidence,setShowEvidence]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<ProductPreview|null>(null);
 const variant=review?.variants.find(v=>v.variant_id===selected);
 const invalidate=()=>{generation.current++;setPreview(null);setError('');setBusy(false);};
 const clear=()=>{invalidate();setRecords(null);setReview(null);setSelected('');setForm(EMPTY);setRetain(false);setExtraction(null);setExperience(null);setShowEvidence(false);};
 async function load(e:ChangeEvent<HTMLInputElement>){
  const f=e.target.files?.[0];e.target.value='';if(!f)return;
  clear();const token=++generation.current;setBusy(true);
  try{
   if(!f.size||f.size>2*1024*1024)throw Error('limit');
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer()));
   const extracted=raw?.status===BUNDLE?await reviewPersonalExtractionBundle(raw):null;
   const acceptedSource=extracted?raw.source:raw?.status===SOURCE?raw:null;
   const practical=extracted?.practical_experience??(acceptedSource?await reviewPersonalPracticalExperience(acceptedSource):null);
   const data=acceptedSource?acceptedSource.rows:raw?.status==='LOCAL_ACTIVITY_ROUTINE_SOURCE'&&raw.export_allowed===false?raw.rows:raw;
   const grouped=await groupPersonalRoutineEvidence(data);
   if(token!==generation.current)return;
   setRecords(data);setReview(grouped);setSelected(grouped.variants[0]?.variant_id??'');setExtraction(extracted);setExperience(practical);
  }catch{if(token===generation.current)setError('Нужна локальная выборка принятых периодических задач Agent. Пустой, повреждённый или неподдерживаемый источник не принят.');}
  finally{if(token===generation.current)setBusy(false);}
 }
 function applyExtraction(){
  if(!extraction||extraction.variant_id!==selected)return;
  const values=extraction.fields;
  const value=(k:keyof typeof values)=>{const v=values[k].value;return Array.isArray(v)?v.join('\n'):v??'';};
  invalidate();setRetain(false);
  setForm(old=>({...old,
   title:old.title||value('title'),purpose:old.purpose||value('purpose'),inputs:old.inputs||value('inputs'),
   outputs:old.outputs||value('outputs'),applicability:old.applicability||value('applicability'),
   instructions:old.instructions||value('instructions'),requirements:old.requirements||value('result_requirements'),
   contexts:old.contexts||value('context_requirements'),cadenceGuidance:old.cadenceGuidance||value('cadence_guidance')}));
 }
 async function prepare(){
  if(!variant)return;
  const token=++generation.current;setBusy(true);setError('');setPreview(null);
  try{
   const p=await preparePersonalTechnologyProduct(records,variant.variant_id,{
    title:form.title.trim(),purpose:form.purpose.trim(),inputs:form.inputs.trim(),outputs:form.outputs.trim(),
    applicability:form.applicability.trim(),instructions:form.instructions.trim(),
    result_requirements:lines(form.requirements),context_requirements:lines(form.contexts),
    cadence:retain?{mode:'RETAIN_INTERVAL',interval_seconds:variant.interval_seconds,guidance:null}:
     {mode:'RECIPIENT_INTERVAL',interval_seconds:null,guidance:form.cadenceGuidance.trim()}});
   if(token===generation.current)setPreview(p);
  }catch{if(token===generation.current)setError('Нужны повторные принятые задачи и заполненные условия применения, инструкция и критерии результата.');}
  finally{if(token===generation.current)setBusy(false);}
 }
 return <section className="activity-v7-card">
  <h2>Личные технологии</h2>
  <p>Выделите повторяющийся принятый опыт из исходных задач Agent. Получатель получит технологию, а не историю вашей жизни, исходные результаты или ваши полномочия.</p>
  <div className="activity-v7-actions">
   <input ref={input} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Открыть локальную выборку Agent" onChange={load}/>
   <button onClick={()=>input.current?.click()}>Открыть принятые результаты или извлечение</button>
   <button onClick={clear}>Очистить</button>
  </div>
  {busy?<p role="status">Обрабатывается локальная выборка…</p>:null}
  {error?<p role="alert" className="activity-v7-note hold">{error}</p>:null}
  {review?<div className="activity-domain-group">
   <h3>Повторяющиеся варианты</h3>
   <p>Локальная копия источника. Доступ и приёмка исходной задачи проверяются её владельцем в Agent.</p>
   <div className="activity-domain-ops">{review.variants.map((v,i)=><button className="activity-domain-op" key={v.variant_id}
    aria-pressed={selected===v.variant_id} onClick={()=>{invalidate();setSelected(v.variant_id);setForm(EMPTY);setRetain(false);}}>
    Вариант {i+1}<span>{v.accepted_occurrence_count} принятых повторений</span><span>Интервал {v.interval_seconds} с</span></button>)}</div>
   {variant?<><h3>Исходный способ работы (локально)</h3><p>{variant.objective}</p>
    {variant.accepted_occurrence_count<2?<p className="activity-v7-note hold">Повторяемость ещё не подтверждается выборкой.</p>:<>
     {extraction&&extraction.variant_id===selected?<div className="activity-domain-proposal">
      <h3>Извлечённая технология</h3>
      <p>Agent подготовил предложение по принятым результатам. Цитаты подтверждают связь с исходным текстом, но не заменяют оценку смысла и полезности.</p>
      <div className="activity-v7-stats"><div><strong>{FIELDS.length-extraction.missing_fields.length}</strong><span>Подготовлено полей</span></div>
       <div><strong>{extraction.proposed_fields.length}</strong><span>Новых предложений</span></div>
       <div><strong>{extraction.missing_fields.length}</strong><span>Не установлено</span></div></div>
      <div className="activity-v7-actions"><button className="activity-v7-primary" onClick={applyExtraction}>Заполнить незаполненные поля</button>
       <button onClick={()=>setShowEvidence(x=>!x)}>{showEvidence?'Скрыть основания':'Проверить основания'}</button></div>
      {showEvidence?<div className="activity-domain-ops">{FIELDS.map(k=>{const row=extraction.fields[k];return <div className="activity-domain-op" key={k}>
       <strong>{extractionNames[k]??k}</strong><span>{row.basis==='SOURCE_SUPPORTED'?'Есть цитата из опыта':row.basis==='PROPOSED'?'Предложение для проверки':'Нужны сведения'}</span>
       {row.note?<span>{row.note}</span>:null}{row.refs.map((r,i)=><span key={i}>{r.quote}</span>)}</div>;})}</div>:null}
     </div>:null}
     {experience?.variant_id===selected?<PersonalPracticalExperiencePanel key={experience.source_sha256+':'+selected}
      experience={experience} coverage={extraction?.variant_id===selected?extraction.practical_coverage:undefined} requirements={form.requirements} contexts={form.contexts}
      onApply={(requirements,contexts)=>{invalidate();setForm(old=>({...old,requirements,contexts}));}}/>:null}
     <h3>Технология для другого пользователя</h3>
     <p>Обобщите назначение, способ работы и критерии. Не переносите личные имена, адреса, аккаунты, права и результаты исходных задач.</p>
     {fields.map(([k,label])=><label key={k} className="activity-domain-label">{label}
       {k==='title'?<input maxLength={240} value={form[k]} onChange={e=>{invalidate();setForm(x=>({...x,[k]:e.target.value}));}}/>:
        <textarea rows={k==='instructions'?4:2} maxLength={k==='instructions'?16000:4096} value={form[k]}
         onChange={e=>{invalidate();setForm(x=>({...x,[k]:e.target.value}));}}/>}</label>)}
     <label className="activity-domain-label">Периодичность<select value={retain?'retain':'adapt'} onChange={e=>{invalidate();setRetain(e.target.value==='retain');}}>
      <option value="adapt">Определяет получатель</option><option value="retain">Сохранить интервал опыта</option></select></label>
     {!retain?<label className="activity-domain-label">Правило выбора периодичности
       <input value={form.cadenceGuidance} maxLength={4096} onChange={e=>{invalidate();setForm(x=>({...x,cadenceGuidance:e.target.value}));}}/></label>:null}
     <div className="activity-v7-actions"><button className="activity-v7-primary" disabled={busy} onClick={()=>void prepare()}>Сформировать технологический продукт</button></div>
    </>}
   </>:null}
  </div>:null}
  {preview&&preview.object_data.target==='PERSONAL_AGENT_TASK_PROMPT'?<div className="activity-domain-group">
   <h3>{preview.object_data.title}</h3><p>{preview.object_data.technology.purpose}</p>
   <p>Целевой исполнитель: оригинальный Personal Agent. Перед активацией получатель выбирает свой контекст, рабочую область и допустимые источники.</p>
   <ProductPresidioReviewPanel product={preview} onRevision={setPreview}/>
   <TechnologyReleasePanel key={preview.product_sha256} product={preview}/>
  </div>:null}
 </section>;
}
