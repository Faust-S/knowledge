import {useLayoutEffect,useRef,useState,type ChangeEvent} from 'react';
import {reviewPresidioTextScreening,type PresidioReview} from '../../modules/activity-base-anonymizer/presidio-text-review.mjs';
import type {D05DisclosureCandidate} from '../../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const ENTITIES:Record<string,string>={PERSON:'Человек',ORGANIZATION:'Организация',LOCATION:'Место',
 EMAIL_ADDRESS:'Электронная почта',PHONE_NUMBER:'Телефон',IP_ADDRESS:'IP-адрес',URL:'Ссылка',
 IBAN_CODE:'Банковский счёт',DATE_TIME:'Дата или время',NRP:'Группа населения'};
const TERMS:Record<string,string>={purpose:'Назначение технологии',inputs:'Входы',outputs:'Выходы',
 applicability:'Границы применения',adaptation_guidance:'Правила адаптации',local_context_guidance:'Контекст',
 label:'Название операции',role:'Роль',equipment_requirement:'Требование к оборудованию',
 material_requirement:'Требование к материалам',title:'Название проверки',responsible_role:'Роль при контроле',
 requirement:'Требование',related_product_characteristic:'Характеристика изделия',
 lower_limit:'Нижняя граница',upper_limit:'Верхняя граница',target_value:'Целевое значение',
 required_evidence:'Свидетельство',sampling_rule:'Выборка',quantity:'Объём',duration:'Длительность',
 unit:'Единица',setup:'Подготовка',buffer:'Буфер',slack:'Резерв'};
function fieldLabel(candidate:D05DisclosureCandidate,path:string){
 const parts=path.split('.'),[,area,index,field,subIndex,subField]=parts;
 if(area==='terms')return TERMS[index]??index;
 if(area==='route_parameters'){
  const item=candidate.technology.route_parameters[Number(index)];
  return 'Маршрут: '+(TERMS[item?.field]??item?.field??'Параметр')+(field==='guidance'?' (правило)':'');
 }
 if(area==='operations'){
  const op=candidate.technology.operations[Number(index)];
  const prefix=op?.label??'Операция '+(Number(index)+1);
  if(field==='parameters'){
   const item=op?.parameters[Number(subIndex)];
   return prefix+': '+(TERMS[item?.field]??item?.field??'Параметр')+(subField==='guidance'?' (правило)':'');
  }
  return prefix+': '+(TERMS[field]??field);
 }
 if(area==='quality_checks'){
  const check=candidate.technology.quality_checks[Number(index)],prefix=check?.title??'Контрольная точка';
  const name=field==='declared_fields'?check?.declared_fields[Number(subIndex)]?.field:field;
  return prefix+': '+(name?(TERMS[name]??name):'Требование');
 }
 return 'Текстовое поле';
}
export function PresidioReviewPanel({candidate}:{candidate:D05DisclosureCandidate}){
 const input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [reviews,setReviews]=useState<Partial<Record<'en'|'ru',PresidioReview>>>({});
 const [lang,setLang]=useState<'en'|'ru'>('ru'),[problem,setProblem]=useState(''),[busy,setBusy]=useState(false);
 const [selected,setSelected]=useState(''),[page,setPage]=useState(0);
 const clear=()=>{generation.current++;setReviews({});setProblem('');setBusy(false);setSelected('');setPage(0);
  if(input.current)input.current.value='';};
 useLayoutEffect(()=>{clear();return()=>{generation.current++;};},[candidate]);
 async function load(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  const token=++generation.current;setBusy(true);setProblem('');
  try{
   if(!file.size||file.size>8*1024*1024)throw {code:'PRESIDIO_RESULT_FILE_LIMIT'};
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));
   const result=await reviewPresidioTextScreening(candidate,raw);
   if(token!==generation.current)return;
   setReviews(old=>({...old,[result.language]:result}));setLang(result.language);
   setSelected(result.fields[0]?.path??'');setPage(0);
  }catch(err){
   if(token!==generation.current)return;
   const code=err&&typeof err==='object'&&'code' in err?String(err.code):'';
   setProblem(code==='PRESIDIO_RESULT_SOURCE_CHANGED'?'Кандидат изменился. Нужна проверка текущей редакции.':
    code==='PRESIDIO_RESULT_FILE_LIMIT'?'Допустим один JSON до 8 МБ.':'Результат не соответствует поддерживаемому профилю или полной выборке текущего кандидата.');
  }finally{if(token===generation.current)setBusy(false);}
 }
 const review=reviews[lang],row=review?.fields.find(x=>x.path===selected);
 const text=row?candidate.text_review_fields.find(x=>x.path===row.path)?.text??'':'';
 const points=Array.from(text);
 return <div className="activity-domain-proposal">
  <h3>Текстовая проверка Presidio</h3>
  <p>Откройте результат оригинального локального Presidio 2.2.366, полученный через программный инструмент Agent. Activity сопоставляет его с текущей технологией и полным перечнем текстовых полей. Эта панель не запускает внешний анализатор самостоятельно.</p>
  <div className="activity-v7-actions">
   <input ref={input} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Выбрать результат Presidio" onChange={load}/>
   <button disabled={busy} onClick={()=>input.current?.click()}>Открыть результат Presidio</button>
   <button disabled={!busy&&!reviews.en&&!reviews.ru&&!problem} onClick={clear}>Очистить текстовую проверку</button>
  </div>
  {busy?<p role="status">Проверяется редакция результата…</p>:null}
  {problem?<p role="alert" className="activity-v7-note hold">{problem}</p>:null}
  {reviews.en||reviews.ru?<div className="activity-domain-group">
   <div className="activity-v7-actions">
    {(['ru','en'] as const).map(language=><button key={language} disabled={!reviews[language]}
      aria-pressed={lang===language} onClick={()=>{setLang(language);setPage(0);setSelected(reviews[language]?.fields[0]?.path??'');}}>
       {language==='ru'?'Русский профиль':'Английский профиль'}{reviews[language]?' · прочитан':' · не прочитан'}</button>)}
   </div>
   {review?<><p>{review.model} {review.model_version} · Presidio {review.version}. Локальная копия, происхождение из Task не подтверждено.</p>
    <div className="activity-v7-stats">
     <div><strong>{review.scanned_field_count}</strong><span>Проверено полей</span></div>
     <div><strong>{review.flagged_field_count}</strong><span>Полей с находками</span></div>
     <div><strong>{review.finding_count}</strong><span>Обнаружений</span></div>
    </div>
    <p>{review.finding_count?'Проверьте найденные признаки и при необходимости уточните предложение.':'В данном профиле не сообщено об обнаружениях. Это не подтверждает анонимность.'}</p>
    <div className="activity-domain-ops">{review.fields.slice(page*8,(page+1)*8).map(f=><button key={f.path}
      className="activity-domain-op" aria-pressed={selected===f.path} onClick={()=>setSelected(f.path)}>
      {fieldLabel(candidate,f.path)}<span>Обнаружений: {f.findings.length}</span></button>)}</div>
    {review.fields.length>8?<div className="activity-v7-actions">
     <button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page+1} / {Math.ceil(review.fields.length/8)}</span>
     <button disabled={(page+1)*8>=review.fields.length} onClick={()=>setPage(p=>p+1)}>Далее</button>
    </div>:null}
    {row?<div className="activity-domain-group">
     <h3>{fieldLabel(candidate,row.path)}</h3>
     <p>Значения показываются только в локальном черновике. Редактируйте исходное предложение и повторяйте проверку после изменения.</p>
     <div className="activity-domain-ops">{row.findings.map((f,i)=><div key={i} className="activity-domain-op">
       <strong>{ENTITIES[f.entity_type]??f.entity_type}</strong>
       <span className="activity-domain-draft-value">{points.slice(f.start,f.end).join('')}</span>
       <span>Оценка распознавателя: {Math.round(f.score*100)}%</span>
      </div>)}</div>
    </div>:null}
    <p className="activity-v7-note">Обнаружения двух языковых профилей могут пересекаться. Их нельзя складывать как количество различных людей или организаций.</p>
   </>:null}
  </div>:null}
 </div>;
}
