import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {productTextInventory,reviewProductPresidioTextScreening} from '../../modules/activity-base-anonymizer/presidio-text-review.mjs';
import type {ProductPreview} from '../../modules/activity-base-anonymizer/technology-product.mjs';
type Review=Awaited<ReturnType<typeof reviewProductPresidioTextScreening>>;
export function ProductPresidioReviewPanel({product}:{product:ProductPreview}){
 const input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [reviews,setReviews]=useState<Partial<Record<'en'|'ru',Review>>>({}),[problem,setProblem]=useState('');
 const [busy,setBusy]=useState(false),[selected,setSelected]=useState<{language:'en'|'ru';path:string}|null>(null);
 useEffect(()=>{generation.current++;setReviews({});setProblem('');setSelected(null);setBusy(false);return()=>{generation.current++;};},[product]);
 async function load(e:ChangeEvent<HTMLInputElement>){
  const f=e.target.files?.[0];e.target.value='';if(!f)return;
  const token=++generation.current;setBusy(true);setProblem('');
  try{
   if(!f.size||f.size>8*1024*1024)throw Error('limit');
   const r=await reviewProductPresidioTextScreening(product,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer())));
   if(token!==generation.current)return;
   setReviews(x=>({...x,[r.language]:r}));setSelected(null);
  }catch{if(token===generation.current)setProblem('Результат должен относиться ко всему текущему продукту, включая название. Проверка прежней редакции не подходит.');}
  finally{if(token===generation.current)setBusy(false);}
 }
 const row=selected?reviews[selected.language]?.fields.find(f=>f.path===selected.path):null;
 const value=row?productTextInventory(product.object_data).find(f=>f.path===row.path)?.text??'':'';
 return <div className="activity-domain-proposal">
  <h3>Проверка полного продукта</h3><p>Оригинальный Presidio через Agent проверяет все текстовые поля, включая название и критерии результата. Это проверка признаков идентификации, а не доказательство анонимности.</p>
  <div className="activity-v7-actions"><input ref={input} type="file" className="visually-hidden" accept=".json,application/json" aria-label="Открыть результат проверки продукта" onChange={load}/>
  <button disabled={busy} onClick={()=>input.current?.click()}>Открыть проверку продукта</button></div>
  {problem?<p role="alert" className="activity-v7-note hold">{problem}</p>:null}
  {Object.entries(reviews).map(([lang,r])=>r?<div key={lang} className="activity-domain-group"><strong>{lang==='ru'?'Русский':'Английский'} профиль</strong>
   <p>Проверено {r.scanned_field_count} полей. Обнаружений: {r.finding_count}.</p>
   <div className="activity-domain-ops">{r.fields.slice(0,32).map(f=><button key={f.path} className="activity-domain-op" onClick={()=>setSelected({language:r.language,path:f.path})}>{f.path}<span>{f.findings.length} обнаружений</span></button>)}</div>
   {r.fields.length>32?<p>Всего {r.fields.length} полей с находками; изучите полный локальный результат.</p>:null}
  </div>:null)}
  {row?<div className="activity-domain-group"><strong>{row.path}</strong><p>{value}</p>{row.findings.map((f,i)=><p key={i}>{f.entity_type}: {Array.from(value).slice(f.start,f.end).join('')}</p>)}</div>:null}
 </div>;
}
