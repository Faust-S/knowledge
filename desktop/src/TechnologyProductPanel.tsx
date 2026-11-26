import {useLayoutEffect,useRef,useState} from 'react';
import {prepareD05TechnologyProduct,type ProductPreview} from '../../modules/activity-base-anonymizer/technology-product.mjs';
import type {SourceReference} from '../../modules/activity-base-anonymizer/technology-disclosure-generalization.mjs';
import {ProductPresidioReviewPanel} from './ProductPresidioReviewPanel';
import {TechnologyReleasePanel} from './TechnologyReleasePanel';
import type {D05DisclosureCandidate} from '../../modules/activity-base-anonymizer/d05-route-comparison.mjs';
export function TechnologyProductPanel({candidate,suggestedTitle='',sourceReferences}:{candidate:D05DisclosureCandidate;suggestedTitle?:string;sourceReferences?:SourceReference[]}){
 const [title,setTitle]=useState(suggestedTitle),[preview,setPreview]=useState<ProductPreview|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),generation=useRef(0);
 useLayoutEffect(()=>{generation.current++;setPreview(null);setError('');setBusy(false);return()=>{generation.current++;};},[candidate]);
 async function prepare(){
  const token=++generation.current;setBusy(true);setError('');setPreview(null);
  try{const value=await prepareD05TechnologyProduct(candidate,title);if(token===generation.current)setPreview(value);}
  catch(e){if(token===generation.current){const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';
   setError(code==='TECHNOLOGY_D05_SOURCE_INCOMPLETE'?'Уточните обязательные параметры, предметные требования и связанную карту качества.':
    'Состав технологии неполон или содержит недопустимые условия. Проверьте параметры и критерии приёмки.');}}
  finally{if(token===generation.current)setBusy(false);}
 }
 const t=preview?.object_data.target==='D05_OPERATION_ROUTE_QUALITY'?preview.object_data.technology:null;
 return <div className="activity-domain-proposal">
  <h3>Технологический продукт</h3>
  <p>Получатель должен получить рабочий маршрут и карту качества, а не данные исходного заказа. Activity готовит предметное содержимое для оригинального IWXA Exchange.</p>
  <label className="activity-domain-label">Название технологии
   <input value={title} maxLength={240} onChange={e=>{generation.current++;setTitle(e.target.value);setPreview(null);setError('');setBusy(false);}}/>
  </label>
  <div className="activity-v7-actions"><button className="activity-v7-primary" disabled={busy||!title.trim()} onClick={()=>void prepare()}>
   Подготовить состав технологического продукта</button></div>
  {error?<p role="alert" className="activity-v7-note hold">{error}</p>:null}
  {busy?<p role="status">Проверяются предметные условия…</p>:null}
  {t?<div className="activity-domain-group" aria-label="Состав технологического продукта">
   <h4>{preview?.object_data.title}</h4><p>{t.terms.purpose}</p>
   <div className="activity-v7-stats"><div><strong>{t.operations.length}</strong><span>Операций</span></div>
    <div><strong>{t.quality_checks.length}</strong><span>Контрольных точек</span></div>
    <div><strong>{[...t.route_parameters,...t.operations.flatMap(o=>o.parameters)].filter(p=>p.mode==='PARAMETERIZE').length}</strong><span>Настраиваемых параметров</span></div></div>
   <p>В новой рабочей среде потребуется выбрать собственные ресурсы, исполнителей, материалы и значения адаптируемых параметров.</p>
   {preview?<ProductPresidioReviewPanel product={preview} onRevision={setPreview} sourceReferences={sourceReferences}/>:null}
   {preview?<TechnologyReleasePanel key={preview.product_sha256} product={preview}/>:null}
  </div>:null}
 </div>;
}
