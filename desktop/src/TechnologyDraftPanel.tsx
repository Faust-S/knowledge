import {useState} from 'react';
import {TechnologyProposalEditor} from './TechnologyProposalEditor';
import type {D05DraftValue,D05DraftUse,D05RouteGroup,D05TechnologyDraftGroup,D05TechnologyProposalForm,D05ParameterDecision}
 from '../../modules/activity-base-anonymizer/d05-route-comparison.mjs';

const LABELS:Record<string,string>={
 quantity:'Объём',calendarMode:'Календарь',workingDays:'Рабочие дни',hoursPerDay:'Часов в день',
 overallReserve:'Общий резерв',duration:'Длительность',unit:'Единица времени',
 setup:'Подготовительное время',buffer:'Буфер',slack:'Резерв операции',
 performer:'Исполнитель в источнике',equipment:'Оборудование в источнике',material:'Материал в источнике',
 related_product_characteristic:'Характеристика изделия',requirement:'Требование',
 lower_limit:'Нижняя граница',target_value:'Целевое значение',upper_limit:'Верхняя граница',
 allowed_values:'Допустимые значения',result_type:'Тип результата',inspection_method:'Метод контроля',
 inspection_method_custom:'Описание метода',sampling_rule:'Правило выборки',responsible_role:'Ответственная роль в источнике',
 required_evidence:'Обязательное свидетельство',blocking:'Блокировка выпуска',
 action_on_failure:'Действие при отклонении',action_custom:'Описание действия',
 related_material_id:'Связь с материалом',comment:'Примечание',
};
const CHECK_TYPES:Record<string,string>={'incoming-material':'Входной контроль','before-op':'Перед операцией',
 'in-op':'В операции','after-op':'После операции',final:'Итоговый контроль','subcontract-acceptance':'Приёмка подрядчика',
 packaging:'Упаковка',completeness:'Комплектность','pre-shipment':'Перед отгрузкой'};
const USE:Record<D05DraftUse,string>={DECLARED_SOURCE_CONDITION:'Заявленное условие',
 ADAPTATION_REVIEW:'Проверить адаптацию',FUNCTIONAL_MAPPING_REQUIRED:'Уточнить функциональное требование'};
const GAPS:Record<string,string>={PURPOSE:'Назначение технологии',INPUTS:'Входы и их требования',
 OUTPUTS:'Выходы и ожидаемый результат',APPLICABILITY:'Условия применимости',
 RESOURCE_CAPABILITIES:'Квалификация исполнителей и характеристики оборудования',
 DOMAIN_VALIDATION:'Предметная проверка технологии',DISCLOSURE_REVIEW:'Проверка допустимости передачи',
 OPERATION_OCCURRENCE_MAPPING:'Сопоставление повторяющихся операций',QUALITY_PLAN_REVIEW:'Связанная карта качества',
 UNSPECIFIED_EXECUTION_CONDITIONS:'Недостающие параметры исполнения',LOCAL_CONTEXT_REVIEW:'Смысл исключённых частных сведений'};
const LOCAL:Record<string,string>={ORDER_CONTEXT:'Контекст заказа',LOCAL_DATES:'Индивидуальные даты',
 MATERIAL_AVAILABILITY:'Текущая доступность материалов',OPERATION_NOTES:'Примечания к операциям',
 QUALITY_SOURCE_CONTEXT:'Исходные документы и контекст требований'};
const WORDS:Record<string,string>={hours:'часы','work-days':'рабочие дни','calendar-days':'календарные дни',
 calendar:'календарный',numeric:'числовой','pass-fail':'годен / не годен',enumerated:'перечень',text:'текст',
 measurement:'измерение',visual:'визуальный контроль',count:'подсчёт',test:'испытание',document:'документ',
 'stop-release':'остановить выпуск',rework:'переделка',recheck:'повторная проверка',adjust:'корректировка',
 sort:'сортировка',scrap:'списание',concession:'согласование отклонения'};
function show(value:D05DraftValue,field:string){
 if(value===null)return 'Не задано';
 if(typeof value==='boolean')return value?'Да':'Нет';
 if(Array.isArray(value))return value.map(n=>['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][n]??String(n)).join(', ');
 return ['unit','calendarMode','result_type','inspection_method','action_on_failure'].includes(field)?WORDS[value]??value:value;
}
const SIZE=8;
const EMPTY_FORM:D05TechnologyProposalForm={};
const EMPTY_DECISIONS:Record<string,D05ParameterDecision>={};
export function TechnologyDraftPanel({draft,operations,review}:{draft:D05TechnologyDraftGroup;operations:D05RouteGroup['operations'];review:unknown}){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState(draft.profiles[0].model_number);
 const [scope,setScope]=useState('route'),[checkPage,setCheckPage]=useState(0),[checkIndex,setCheckIndex]=useState(0);
 const [forms,setForms]=useState<Record<number,D05TechnologyProposalForm>>({});
 const [decisions,setDecisions]=useState<Record<number,Record<string,D05ParameterDecision>>>({});
 const profile=draft.profiles.find(p=>p.model_number===selected)??draft.profiles[0];
 const check=profile.checks[checkIndex];
 const name=(id:string|null)=>id===null?'Весь маршрут':operations.find(op=>op.id===id)?.name??'Операция';
 const conditionKind=(key:string)=>draft.unresolved_condition_keys.includes(key)?'Недостаточно сведений':
  draft.shared_condition_keys.includes(key)?'Совпадает во всех моделях':
  draft.differing_condition_keys.includes(key)?'Различается между моделями':'Исходное значение';
 return <div className="activity-domain-draft">
  <div className="activity-v7-actions">
   <button className="activity-v7-primary" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
    {open?'Закрыть технологический кандидат':'Открыть технологический кандидат'}
   </button>
  </div>
  {open?<div className="activity-domain-group">
   <h3>Технологический кандидат</h3>
   <p>Частный рабочий черновик. Варианты сохраняются целиком, условия между ними не перемешиваются. Общие значения ещё не являются утверждённым нормативом.</p>
   <div className="activity-v7-stats">
    <div><strong>{draft.profiles.length}</strong><span>Исходных вариантов</span></div>
    <div><strong>{draft.shared_condition_keys.length}</strong><span>Совпавших условий</span></div>
    <div><strong>{draft.differing_condition_keys.length}</strong><span>Различий</span></div>
    <div><strong>{draft.unresolved_condition_keys.length}</strong><span>Неполных условий</span></div>
   </div>
   <div className="activity-v7-actions">
    {draft.profiles.map(p=><button key={p.model_number} aria-pressed={p.model_number===selected}
      className={p.model_number===selected?'activity-v7-primary':''} onClick={()=>{setSelected(p.model_number);setCheckIndex(0);setCheckPage(0);}}>
      {'Исходный вариант '+p.model_number}</button>)}
   </div>
   <p>{profile.source_revision===null?'Редакция исходной модели не установлена.':'Редакция исходной модели: '+profile.source_revision+'.'}</p>
   <label className="activity-domain-label">Условия исполнения
    <select value={scope} aria-label="Область условий исполнения" onChange={e=>setScope(e.target.value)}>
      <option value="route">Параметры маршрута</option>
      {operations.map(op=><option key={op.id} value={op.id}>{op.name}</option>)}
    </select>
   </label>
   <div className="activity-domain-ops">
    {profile.conditions.filter(c=>c.scope===scope).map(c=><div className="activity-domain-op" key={c.key}>
      <strong>{LABELS[c.field]??c.field}</strong><span className="activity-domain-draft-value">{show(c.value,c.field)}</span>
      <span>{conditionKind(c.key)} · {USE[c.use]}</span>
    </div>)}
   </div>
   <h3>Условия контроля и приёмки выбранного варианта</h3>
   <p>Полностью совпавших заявленных проверок во всех вариантах: {draft.shared_check_count}.</p>
   {profile.checks.length?<>
    <div className="activity-domain-ops">{profile.checks.slice(checkPage*SIZE,(checkPage+1)*SIZE).map((c,i)=>
      <button key={c.id} className="activity-domain-op" aria-label={'Контрольная точка '+(checkPage*SIZE+i+1)+': '+c.title} aria-pressed={checkIndex===checkPage*SIZE+i}
       onClick={()=>setCheckIndex(checkPage*SIZE+i)}>{c.title}<span>{CHECK_TYPES[c.control_type]??c.control_type} · {name(c.operation_id)}</span>
       <span>{c.comparison==='COMMON_DECLARATION'?'Совпадает во всех моделях':c.comparison==='SOURCE_SPECIFIC'?'Условие выбранного варианта':'Нет сравнения'}</span></button>)}</div>
    {profile.checks.length>SIZE?<div className="activity-v7-actions">
      <button disabled={checkPage===0} onClick={()=>{setCheckPage(x=>x-1);setCheckIndex((checkPage-1)*SIZE);}}>Назад</button>
      <span>Страница {checkPage+1} из {Math.ceil(profile.checks.length/SIZE)}</span>
      <button disabled={(checkPage+1)*SIZE>=profile.checks.length} onClick={()=>{setCheckPage(x=>x+1);setCheckIndex((checkPage+1)*SIZE);}}>Далее</button>
    </div>:null}
    {check?<div className="activity-domain-ops">{check.fields.map(f=><div className="activity-domain-op" key={f.field} role="group"
      aria-label={(LABELS[f.field]??f.field)+': '+(f.status==='LOCAL_REFERENCE_REVIEW_REQUIRED'?'Требуется уточнение исходной ссылки':show(f.value,f.field))}>
      <strong>{LABELS[f.field]??f.field}</strong>
      <span className="activity-domain-draft-value">{f.status==='LOCAL_REFERENCE_REVIEW_REQUIRED'?'Требуется уточнение исходной ссылки':show(f.value,f.field)}</span>
      <span>{USE[f.use]}</span>
    </div>)}</div>:null}
   </>:<p>Сопоставимая карта качества не получена. Критерии не формируются автоматически.</p>}
   <h3>Что необходимо уточнить</h3>
   <ul>{profile.unresolved.map(x=><li key={x}>{GAPS[x]??x}</li>)}</ul>
   {profile.local_context_review.length?<p className="activity-v7-note">Частные сведения не перенесены в черновик: {profile.local_context_review.map(x=>LOCAL[x]??x).join(', ')}. Уточните их предметное значение перед обобщением.</p>:null}
   <TechnologyProposalEditor key={profile.model_number} review={review} groupId={draft.group_id}
    profile={profile} operations={operations} form={forms[profile.model_number]??EMPTY_FORM}
    decisions={decisions[profile.model_number]??EMPTY_DECISIONS}
    onDecisions={value=>setDecisions(old=>({...old,[profile.model_number]:value}))}
    onChange={form=>setForms(old=>({...old,[profile.model_number]:form}))}/>
   <p className="activity-v7-note hold">Это не обезличенная технология. Значения условий и названия могут содержать частные сведения. Применимость, право передачи и нормативная приёмка не установлены.</p>
  </div>:null}
 </div>;
}
