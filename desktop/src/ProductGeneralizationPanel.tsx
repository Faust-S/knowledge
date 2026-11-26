import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import {productTextInventory} from '../../modules/activity-base-anonymizer/presidio-text-review.mjs';
import {prepareProductGeneralization,applyProductGeneralization,type GeneralizationPlan,type SourceReference}
 from '../../modules/activity-base-anonymizer/technology-disclosure-generalization.mjs';
import type {ProductPreview} from '../../modules/activity-base-anonymizer/technology-product.mjs';

type Choice={selected:boolean;replacement:string};
const EMPTY_REFERENCES:SourceReference[]=[];
const sourceNames:Record<SourceReference['kind'],string>={CUSTOMER:'Заказчик в источнике',PERFORMER:'Исполнитель в источнике',CONTRACTOR:'Подрядчик в источнике',LOCAL_REFERENCE:'Частная ссылка владельца'};
const kindNames:Record<string,string>={PERSON:'Имя',ORGANIZATION:'Организация',LOCATION:'Место',EMAIL_ADDRESS:'Электронная почта',
 PHONE_NUMBER:'Телефон',URL:'Ссылка',IP_ADDRESS:'Сетевой адрес',IBAN_CODE:'Банковский счёт',DATE_TIME:'Дата или время'};
const labels:Record<string,string>={title:'Название',purpose:'Назначение',inputs:'Входы',outputs:'Результат',applicability:'Применимость',
 instructions:'Инструкция',result_requirements:'Критерии результата',context_requirements:'Контекст получателя',guidance:'Правило адаптации',
 label:'Операция',role:'Роль',equipment_requirement:'Оборудование',material_requirement:'Материал',responsible_role:'Ответственность за контроль'};
const describe=(path:string)=>path.split('.').slice(2).map(k=>labels[k]??(/^\d+$/.test(k)?String(Number(k)+1):k==='quality_checks'?'Контроль качества':k==='operations'?'Операции':k==='terms'?'Условия':k==='declared_fields'?'Требования':k)).join(' / ')||'Название';
export function ProductGeneralizationPanel({product,reports,onRevision,disabled=false,sourceReferences=EMPTY_REFERENCES}:{
 product:ProductPreview;reports:Partial<Record<'en'|'ru',unknown>>;sourceReferences?:SourceReference[];onRevision:(value:ProductPreview)=>void;disabled?:boolean;
}){
 const epoch=useRef(0),running=useRef(false);
 const [language,setLanguage]=useState<'ru'|'en'>('ru'),[plan,setPlan]=useState<GeneralizationPlan|null>(null);
 const [choices,setChoices]=useState<Record<string,Choice>>({}),[page,setPage]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [additional,setAdditional]=useState<SourceReference[]>([]),[privateValue,setPrivateValue]=useState(''),[functional,setFunctional]=useState('');
 const references=useMemo(()=>[...sourceReferences,...additional],[sourceReferences,additional]);
 const list=Object.values(reports);
 const canAdd=privateValue.trim().length>=3&&functional.trim().length>0&&!functional.trim().includes(privateValue.trim())&&references.length<512;
 function addReference(){
  if(!canAdd)return;
  const row:SourceReference={value:privateValue.trim(),replacement:functional.trim(),kind:'LOCAL_REFERENCE'};
  setAdditional(old=>old.some(r=>r.value===row.value&&r.replacement===row.replacement)?old:[...old,row]);
  setPrivateValue('');setFunctional('');
 }
 const sourceFields=useMemo(()=>new Map(productTextInventory(product.object_data).map(f=>[f.path,Array.from(f.text)])),[product]);
 useLayoutEffect(()=>{
  const token=++epoch.current;setChoices({});setPlan(null);setPage(0);setError('');
  if(!Object.keys(reports).length&&!references.length){setBusy(false);return;}
  setBusy(true);
  void prepareProductGeneralization(product,Object.values(reports),language,references).then(p=>{
   if(token!==epoch.current)return;
   setPlan(p);setChoices(Object.fromEntries(p.groups.map(g=>[g.group_id,{selected:g.suggested_replacement!==null,
    replacement:g.suggested_replacement??''}])));
  }).catch(()=>{if(token===epoch.current)setError('Не удалось подготовить пакетное обобщение для текущей редакции. Проверьте результаты анализатора; большую выборку обработайте по отдельным технологиям.');})
   .finally(()=>{if(token===epoch.current)setBusy(false);});
  return()=>{epoch.current++;};
 },[product,reports,language,references]);
 const selected=plan?.groups.filter(g=>choices[g.group_id]?.selected)??[];
 const invalid=selected.some(g=>!choices[g.group_id]?.replacement.trim());
 async function apply(){
  if(!plan||disabled||busy||running.current||!selected.length||invalid)return;
  const token=++epoch.current;running.current=true;setBusy(true);setError('');
  try{
   const value=await applyProductGeneralization(product,Object.values(reports),{base_product_sha256:plan.base_product_sha256,
    proposal_sha256:plan.proposal_sha256,language:plan.language,replacements:selected.map(g=>({group_id:g.group_id,replacement:choices[g.group_id].replacement.trim()}))},references);
   if(token!==epoch.current)return;
   onRevision(value.preview);
  }catch(e){
   if(token===epoch.current){
    const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';
    setError(code==='TECHNOLOGY_GENERALIZATION_OVERLAP'?'Выбранные фрагменты пересекаются. Оставьте полное выражение, а не его отдельную часть.':
     'Выбранные замены нельзя применить к этой редакции. Проверьте фиксированные требования и формулировки.');
   }
  }finally{running.current=false;if(token===epoch.current)setBusy(false);}
 }
 // Known source references work even before the original Presidio report.
 const blocked=disabled||busy;
 return <div className="activity-domain-group">
  <h4>Обобщение идентифицирующих сведений</h4>
  <p>Известные частные обозначения исходных исполнителей, заказчиков и подрядчиков ищутся по всему продукту вместе с обнаружениями Presidio. Функциональные роли сохраняются. Неоднозначные совпадения требуют уточнения.</p>
  <details><summary>Дополнить известные частные обозначения</summary>
   <p>Укажите полное имя, внутренний код или другое точное обозначение и его функциональный смысл. Дополнительные ссылки остаются в текущей локальной проверке.</p>
   <label className="activity-domain-label">Частное обозначение<input maxLength={240} value={privateValue} disabled={blocked} onChange={e=>setPrivateValue(e.target.value)}/></label>
   <label className="activity-domain-label">Функциональная замена<input maxLength={512} value={functional} disabled={blocked} onChange={e=>setFunctional(e.target.value)}/></label>
   <button disabled={blocked||!canAdd} onClick={addReference}>Добавить в проверку</button>
   {additional.map((ref,i)=><div key={i} className="activity-domain-op"><span>{ref.value} → {ref.replacement}</span>
    <button disabled={blocked} onClick={()=>setAdditional(old=>old.filter((_,j)=>j!==i))}>Удалить обозначение</button></div>)}
  </details>
  {!list.length?<p>Проверка Presidio ещё не загружена. Известные ссылки можно обобщить отдельно; затем требуется проверка всего продукта.</p>:null}
  <label className="activity-domain-label">Язык обобщённых формулировок
   <select value={language} disabled={blocked} onChange={e=>setLanguage(e.target.value as 'ru'|'en')}><option value="ru">Русский</option><option value="en">English</option></select>
  </label>
  {busy?<p role="status">Подготавливается точная редакция…</p>:null}
  {plan?<><div className="activity-v7-stats">
   <div><strong>{plan.group_count}</strong><span>Различных ссылок</span></div>
   <div><strong>{plan.automatic_group_count}</strong><span>Готовых предложений</span></div>
   <div><strong>{selected.length}</strong><span>Выбрано</span></div></div>
   {plan.source_reference_count>0?<p>Известных исходных обозначений: {plan.source_reference_count}. Найдено в текущей редакции: {plan.matched_reference_count}.</p>:null}
   {!plan.groups.length?<p>В доступных проверках и известных обозначениях нет совпадений. Это не подтверждает анонимность.</p>:null}
   {plan.groups.slice(page*8,(page+1)*8).map(g=>{
    const choice=choices[g.group_id];
    return <div className="activity-domain-op" key={g.group_id}>
     <strong style={{overflowWrap:'anywhere'}}>{g.value}</strong>
     <span>{[...g.types.map(t=>kindNames[t]??t),...g.source_kinds.map(k=>sourceNames[k])].join(', ')} · {g.spans.length} совпадений</span>
     {g.blocked_count?<p className="activity-v7-note hold">Нельзя изменить без предметного пересмотра: {g.blocked_count} совпадений.</p>:null}
     {g.editable_count>0&&choice?<><label><input type="checkbox" disabled={blocked} checked={choice.selected}
      onChange={e=>setChoices(x=>({...x,[g.group_id]:{...x[g.group_id],selected:e.target.checked}}))}/> Применить замену в доступных полях</label>
      <label className="activity-domain-label">Функциональное обозначение
       <input value={choice.replacement} disabled={blocked} maxLength={512} placeholder="Например, ответственный за контроль"
        onChange={e=>setChoices(x=>({...x,[g.group_id]:{...x[g.group_id],replacement:e.target.value}}))}/>
      </label></>:null}
     <details><summary>Где встречается</summary>
      {g.spans.slice(0,20).map(s=>{
       const points=sourceFields.get(s.path)??[];
       const left=Math.max(0,s.start-80),right=Math.min(points.length,s.end+80);
       return <div key={s.path+':'+s.start+':'+s.end}><p><strong>{describe(s.path)}</strong>{s.detected?'':' · совпадающий текст'}{s.edit_kind==='FIXED'?' · фиксированное поле':''}</p>
        <p style={{overflowWrap:'anywhere'}}>{left?'…':''}{points.slice(left,s.start).join('')}<strong>{points.slice(s.start,s.end).join('')}</strong>{points.slice(s.end,right).join('')}{right<points.length?'…':''}</p></div>;
      })}
      {g.spans.length>20?<p>Показаны первые 20 из {g.spans.length} совпадений. Замена охватывает все доступные совпадения выбранной ссылки.</p>:null}
     </details>
    </div>;
   })}
   {plan.groups.length>8?<div className="activity-v7-actions"><button disabled={blocked||page===0} onClick={()=>setPage(x=>x-1)}>Назад</button>
    <span>{page+1} / {Math.ceil(plan.groups.length/8)}</span><button disabled={blocked||(page+1)*8>=plan.groups.length} onClick={()=>setPage(x=>x+1)}>Далее</button></div>:null}
   <p>Сопоставьте предлагаемые роли и контакты с назначением технологии. Новая редакция требует повторной проверки всего продукта.</p>
   <div className="activity-v7-actions"><button className="activity-v7-primary" disabled={blocked||!selected.length||invalid} onClick={()=>void apply()}>Применить выбранные обобщения</button></div>
  </>:null}
  {error?<p role="alert" className="activity-v7-note hold">{error}</p>:null}
 </div>;
}
