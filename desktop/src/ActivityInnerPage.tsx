import type {Dispatch,SetStateAction,ReactNode} from 'react';
import {PersonalRoutineReviewPanel} from './PersonalRoutineReviewPanel';
import {DomainRouteComparison} from './DomainRouteComparison';
import {ProcessToolReview} from './ProcessToolReview';
import type {Preview} from '../../modules/activity-base-anonymizer/engine.mjs';
import type {Ocel2EvidenceView} from '../../modules/activity-base-anonymizer/ocel2-evidence.mjs';
import type {T3StructuralCandidate} from '../../modules/activity-base-anonymizer/t3-selected-host.mjs';
import type {T3TransitionMap} from '../../modules/activity-base-anonymizer/t3-transition-map.mjs';
import type {T3EvidencePassport} from '../../modules/activity-base-anonymizer/t3-evidence-passport.mjs';
import {D05_RESULT_TYPES,D05_EVENT_TYPES} from '../../modules/activity-base-anonymizer/d05-t3-evidence-binding.mjs';
import type {ActivityWorkspaceData,ActivityWorkspaceActions} from './ActivityWorkspace';

type Props={page:string;data:ActivityWorkspaceData;actions:ActivityWorkspaceActions;
 process:Preview['processes'][number]|undefined;object:Ocel2EvidenceView['object_views'][number]|undefined;
 candidate:T3StructuralCandidate|null;map:T3TransitionMap|null;passport:T3EvidencePassport|null;
 candidates:T3StructuralCandidate[];processIndex:number;setProcessIndex:Dispatch<SetStateAction<number>>;
 objectIndex:number;setObjectIndex:Dispatch<SetStateAction<number>>;
 candidateIndex:number;setCandidateIndex:Dispatch<SetStateAction<number>>;
 eventPage:number;setEventPage:Dispatch<SetStateAction<number>>;
 eventId:string;setEventId:Dispatch<SetStateAction<string>>;
 go:(page:string)=>void;choose:(source:'a1'|'ocel'|'file'|'t3')=>void;
 inspect:(id:string,name:string,lines:string[])=>void;};

function Card({title,children}:{title:string;children:ReactNode}){return <section className="activity-v7-card"><h2>{title}</h2>{children}</section>}
function Note({children,hold=false}:{children:ReactNode;hold?:boolean}){return <div className={'activity-v7-note '+(hold?'hold':'')}>{children}</div>}
function Stats({rows}:{rows:Array<[number|string,string]>}){return <div className="activity-v7-stats">{rows.map(([n,t],i)=><div key={i}><strong>{n}</strong><span>{t}</span></div>)}</div>}
function TextRows({lines}:{lines:readonly string[]}){return <div className="activity-v7-list">{lines.map((s,i)=><p key={i}>{s}</p>)}</div>}

export function ActivityInnerPage({page,data,actions,process,object,candidate,map,passport,candidates,
 processIndex,setProcessIndex,objectIndex,setObjectIndex,candidateIndex,setCandidateIndex,
 eventPage,setEventPage,eventId,setEventId,go,choose,inspect}:Props){
 const t3=data.t3Review?.status==='REVIEW'?data.t3Review.review:null;
 switch(page){
 case 'Личные технологии':return <PersonalRoutineReviewPanel/>;
 case 'Группировка маршрутов':return <DomainRouteComparison host={data.d05RouteHost}/>;
 case 'Результаты Process Mining':return <ProcessToolReview/>;
 case 'Схемы A0/A1':return <div className="activity-v7-grid">
  <Card title="A0 · синтетическая последовательность"><p>Выбранный субъект, упорядоченные события, структурные этапы и роли. События должны иметь статус observed.</p></Card>
  <Card title="A1 · источник и версия"><p>Проверка source pin, SHA-256, статуса выполнения и отсутствия разрывов хронологии.</p>
   <div className="activity-v7-actions"><button onClick={()=>choose('a1')}>Открыть пример A1</button><button onClick={()=>choose('file')}>Выбрать JSON</button></div></Card>
  <Card title="OCEL 2.0 · объектно-центрический JSON"><p>Типы событий и объектов, E2O, O2O и ограниченный профиль. Неподтверждённый порядок не восстанавливается.</p>
   <button onClick={()=>choose('ocel')}>Открыть пример OCEL</button></Card>
  <Card title="Текущие проверки">{data.preview?<Stats rows={[[data.preview.source_pin_count,'Версий источника'],[data.preview.unverified_event_count,'Неподтверждённых событий'],[data.preview.selected_case_count,'Траекторий']]}/>:<Note>Фактический анализ синтетической базы пока не запускался.</Note>}</Card></div>;
 case 'Реконструкция':return data.preview?<><Stats rows={[[data.preview.processes.length,'Процессов'],[data.preview.selected_case_count,'Траекторий'],[data.preview.role_count,'Структурных ролей'],[data.preview.unverified_event_count,'Неподтверждённых событий']]}/>
  <div className="activity-v7-grid"><Card title="Процессы">{data.preview.processes.map((p,i)=><button key={p.id} className={'activity-v7-choice '+(processIndex===i?'selected':'')} onClick={()=>setProcessIndex(i)}>Процесс {String(i+1).padStart(2,'0')}<span>{p.trace_count} траектории</span></button>)}</Card>
  <Card title="Этапы и роли">{process?.states.map((state,i)=><button className="activity-v7-choice" key={state.id} onClick={()=>inspect('stage:'+state.id,'Этап '+(i+1),[state.id,'Роли: '+state.roles.join(', ')])}>Этап {String(i+1).padStart(2,'0')} · {state.id}<span>{state.roles.join(', ')||'Нет ролей'}</span></button>)}</Card></div>
  <Note>Названия хозяйственных действий не выводятся из алиасов. Это реконструкция наблюдаемого порядка, а не оценка исполнения.</Note></>:<Note>Загрузите синтетический A1-источник для настоящего вычисления структуры.</Note>;
 case 'Карта процессов':return data.preview?<><div className="activity-v7-actions">{data.preview.processes.map((p,i)=><button className={processIndex===i?'selected':''} key={p.id} onClick={()=>setProcessIndex(i)}>Процесс {i+1}</button>)}</div>
  <Card title="Наблюдаемый порядок">{process?.observed_successions.length?
   <div className="activity-v7-maplines">{process.observed_successions.map((edge,i)=><button key={i} onClick={()=>inspect('a1edge:'+i,'Переход',[
    edge.from+' → '+edge.to,'Число траекторий: '+edge.trace_occurrences,edge.relation])}>
    <span>{edge.from}</span><span>→</span><span>{edge.to}</span><small>{edge.trace_occurrences} траектории</small></button>)}</div>:
   <Note>Подтверждённых переходов пока нет.</Note>}</Card>
  <Note>Отображены только фактические наблюдаемые связи из реконструкции A1. Цикл не равен переделке, а порядок не доказывает причинность.</Note></>:<Note>Сначала выполните анализ A1 в разделе «Источники».</Note>;
 case 'Аудит A2':return data.risk?<><Stats rows={[[data.risk.reason_codes.length,'Оснований'],[data.preview?.source_pin_count??0,'Source pin'],[data.preview?.unverified_event_count??0,'Неподтверждено']]}/>
  <Card title="Проверка остаточного риска"><strong>{data.risk.status}</strong>
   <p>Анонимность: {data.risk.anonymity}. Остаточный риск: {data.risk.residual_risk}. Внешняя публикация закрыта.</p>
   {data.risk.reason_codes.map(code=><button key={code} className="activity-v7-choice" onClick={()=>inspect('risk:'+code,code,[
    'Остаточный риск не принят независимо.','Внешнее раскрытие и выпуск .iwxa недоступны.'])}>{code}</button>)}
  </Card></>:<Note>Проверка A2 использует результат оригинального синтетического анализатора. Загрузите подходящий источник.</Note>;
 case 'OCEL 2.0':return data.objectEvidence?<><Stats rows={[[data.objectEvidence.object_type_count,'Типов объектов'],[data.objectEvidence.event_type_count,'Типов событий'],[data.objectEvidence.shared_event_count,'Общих событий'],[data.objectEvidence.declared_object_link_count,'O2O-связей']]}/>
  <div className="activity-v7-grid"><Card title="Объекты">{data.objectEvidence.object_views.map((v,i)=><button key={v.id} className={'activity-v7-choice '+(i===objectIndex?'selected':'')} onClick={()=>setObjectIndex(i)}>
   {v.object_type_alias}<span>{v.observed_object_count} объектов</span></button>)}</Card>
  <Card title="События и отношения"><p>{object?.activity_aliases.join(' · ')||'Нет подтверждённых событий'}</p>
   {object?.observed_successions.map((edge,i)=><button className="activity-v7-choice" key={i} onClick={()=>inspect('ocel:'+i,'Связь событий',[
    edge.from+' → '+edge.to,'Число траекторий: '+edge.object_trace_occurrences,edge.relation])}>{edge.from} → {edge.to}</button>)}
   <strong>{data.objectEvidence.status}</strong></Card></div>
  <Note>Один Event может относиться к нескольким объектам. Полное соответствие OCEL 2.0 не подтверждено.</Note></>:<Card title="Объектно-центрический анализ"><p>Поддерживается ограниченный JSON-профиль OCEL 2.0 с проверкой E2O/O2O, времени и редких маршрутов.</p>
  <button onClick={()=>choose('ocel')}>Открыть пример OCEL 2.0</button></Card>;
 case 'T3 D1/D2':return <div className="activity-v7-grid">
  <Card title="Подписанное чтение"><strong>{data.hasT3Host?'Доверенный Host предоставлен':'Корпоративный Host не подключён'}</strong>
   <p>Оригинальный T3 подтверждает actor, organization, выбранную Workspace, срок действия и инвалидацию доступа. Renderer получает только разрешённые структурные алиасы.</p>
   <div className="activity-v7-actions"><button onClick={actions.readT3} disabled={data.busy}>Подключить выбранную базу T3</button>
   {data.canRecover?<button onClick={actions.recoverT3}>Проверить сохранённый черновик T3</button>:null}</div></Card>
  <Card title="Последний D2 Result"><strong>{data.t3Review?.status??'Не читался'}</strong>
   <p>{data.t3Review?.status==='STAGED'
     ?data.t3Review.recovered?'Черновик подтверждён независимым чтением Kernel.':'Черновик записан для внутренней проверки.'
     :data.t3Review?.code||'Подписанное чтение ещё не запускалось в текущей сессии.'}</p>
   {t3?<TextRows lines={t3.reason_codes}/>:null}
   {data.t3Review?.stageBlocked?<Note hold>Исход предыдущей записи необходимо сверить. Повтор запрещён.</Note>:null}</Card></div>;
 case 'Карта T3':return map?<><Stats rows={[[map.nodes.length,'Классов событий'],[map.transitions.length,'Переходов'],[map.branch_points,'Ветвлений'],[map.isolated_event_kinds,'Без связей']]}/>
  <Card title="Объектно-локальные переходы"><div className="activity-v7-actions">{candidates.slice(0,60).map((c,i)=><button key={c.object_type} className={candidateIndex===i?'selected':''} onClick={()=>{setCandidateIndex(i);setEventPage(0);setEventId('');}}>Объект {i+1}</button>)}</div>
  <Note>{map.too_complex?'Большой граф: общий порядок не вычислен.':map.cyclic?'Есть цикл. Переделка не доказана.':'Карта состоит только из проверенных исходных связей.'}</Note>
  <div className="activity-v7-event-grid">{map.nodes.slice(eventPage*8,eventPage*8+8).map(node=><button key={node.id}
   className={eventId===node.id?'selected':''} onClick={()=>{setEventId(node.id);inspect('t3:'+node.id,node.label,[
   'Предшествующие: '+node.incoming.map(x=>x.from).join(', '),
   'Следующие: '+node.outgoing.map(x=>x.to).join(', '),
   'Сами связи не доказывают производственное исполнение.']);}}>
   <strong>{node.label}</strong><small>Вход: {node.incoming.length} · выход: {node.outgoing.length}</small></button>)}</div>
  <div className="activity-v7-actions"><button disabled={eventPage===0} onClick={()=>setEventPage(n=>n-1)}>Назад</button>
   <span>Страница {eventPage+1} из {Math.max(1,Math.ceil(map.nodes.length/8))}</span>
   <button disabled={(eventPage+1)*8>=map.nodes.length} onClick={()=>setEventPage(n=>n+1)}>Далее</button></div>
  </Card><Card title="Что проверить в процессе">{map.review_questions.map(q=><div key={q.code} className="activity-v7-question"><strong>{q.title}</strong><p>{q.prompt}</p></div>)}</Card></>:
  <Note>Без подтверждённого оригинального подписанного D2 Result структурная карта не строится. Встроенные сценарии тестируются отдельно от корпоративного источника.</Note>;
 case 'Паспорт фактов':return passport?<><Stats rows={[[passport.actionCount,'Вопросов'],[passport.groups.length,'Направлений проверки']]}/>
  <Card title="Достаточность фактов"><strong>{passport.result}</strong>
   <p>Физическое исполнение и независимая квалификация не доказаны. Экспорт закрыт.</p>
   {passport.groups.map(group=><div key={group.area}><h3>{group.label}</h3>
    {group.items.map(t=><div className="activity-v7-question" key={t.code}><strong>{t.issue}</strong><p>{t.next}</p></div>)}</div>)}
   {passport.info.map(t=><p key={t.code}>{t.issue}: {t.next}</p>)}</Card></>:
  <Note>Паспорт появляется после оригинального D2 Result. Он использует только коды диагностики из проверенного Host.</Note>;
 case 'Свидетельства D05':return <><Stats rows={[[D05_RESULT_TYPES.length,'Типов Result'],[D05_EVENT_TYPES.length,'Типов Event']]}/>
  <div className="activity-v7-grid"><Card title="Result CehoVod"><div className="activity-v7-list">{D05_RESULT_TYPES.map(x=><p key={x}>{x}</p>)}</div></Card>
   <Card title="Event CehoVod">{D05_EVENT_TYPES.map(x=><p key={x}>{x}</p>)}
   <Note hold>Системные изменения имеют reported-статус, а не независимую оценку физического выполнения. CASE-001 не принят.</Note></Card></div></>;
 case 'Проверка':return <div className="activity-v7-grid">
  <Card title="Проверка результата"><p>{data.problem||'Для просмотра заключения сначала выберите и проверьте исходные данные.'}</p>
   <div className="activity-v7-actions">{['Аудит A2','Паспорт фактов','Черновик и восстановление'].map(p=><button key={p} onClick={()=>go(p)}>{p}</button>)}</div></Card>
  <Card title="Что разрешено">{data.preview?<p>Синтетическая структура рассчитана и остаётся только внутри владельца.</p>:<p>Действующий анализ ещё не выбран.</p>}
   <Note hold>Анонимность и выпуск .iwxa не установлены.</Note></Card></div>;
 case 'Черновик и восстановление':return <div className="activity-v7-grid">
  {data.t3Review?.status==='STAGED'?<Card title="Результат внутренней проверки">
    <strong>{data.t3Review.recovered?'Восстановление подтверждено':'Черновик сохранён'}</strong>
    <p>{data.t3Review.recovered
      ?'Независимое подписанное чтение оригинального Kernel подтвердило сохранённый черновик. Его связь с текущей базой требует квитанции владельца.'
      :'Оригинальный Kernel подтвердил сохранение в отдельной Workspace того же владельца.'}</p>
    <Note hold>Выпуск .iwxa и передача результата остаются закрыты.</Note>
   </Card>:null}
  {data.t3Review?.status==='HOLD'?<Card title="Сохранение не подтверждено">
    <Note hold>{data.t3Review.code||'T3_DRAFT_NOT_CONFIRMED'}</Note>
    <p>Повторять запись нельзя до независимой проверки исхода.</p>
   </Card>:null}
  <Card title="Внутренний структурный черновик"><p>Только отдельное подписанное право activity.derive и отдельная пустая Workspace того же владельца.</p>
   <button disabled={!data.canStage||!t3||!!data.t3Review?.stageBlocked||data.t3Review?.status==='STAGED'}
      onClick={actions.stageT3}>Сохранить черновик для проверки</button>
   {data.t3Review?.stageBlocked?<Note hold>Повторная запись запрещена до независимой сверки.</Note>:null}</Card>
  <Card title="Холодное восстановление"><p>Повторная подписанная проверка оригинального Kernel. Новая команда записи не отправляется.</p>
   <button disabled={!data.canRecover||data.t3Review?.status==='RECOVERING'||data.t3Review?.status==='STAGING'}
      onClick={actions.recoverT3}>Проверить сохранённый черновик T3</button>
   <Note>Подтверждение черновика не аттестует его связь с выбранным сейчас источником.</Note></Card></div>;
 case 'Стандарты':return <div className="activity-v7-grid">{[
 ['OCEL 2.0','Ограниченный JSON-профиль, не полное соответствие стандарту.'],
 ['BPMN','Наблюдаемый порядок доступен для проверки; BPMN XML не создаётся.'],
 ['DMN','Наблюдаемые ветвления не подтверждают правила решений.'],
 ['CMMN','План кейса автоматически не восстанавливается.'],
 ['W3C PROV','Не получена внешняя независимая аттестация происхождения.'],
 ['IWXA Exchange','Отсутствует право на внешний экспорт .iwxa.']
 ].map(([name,description])=><Card key={name} title={name}><p>{description}</p></Card>)}</div>;
 case 'Выпуск и обмен':return <div className="activity-v7-grid">
  <Card title="Выпуск .iwxa"><Note hold>HOLD · выпуск закрыт</Note><p>Структура не равна подтверждённой анонимности, разрешению на раскрытие или независимому исполнению.</p><button disabled>Экспорт .iwxa</button></Card>
  <Card title="Внутренняя проверка"><p>Если у Host есть отдельное подписанное право, можно записать структурный черновик в другую Workspace того же principal.</p><button onClick={()=>go('Черновик и восстановление')}>Открыть проверку черновика</button></Card></div>;
 case 'Квалификация':return <div className="activity-v7-grid"><Card title="Проверенные механики"><p>Детерминированная реконструкция A1/A2, ограниченный OCEL, тестовый оригинальный подписанный D1/D2, нативная Windows-сборка и проверка T2 Host/Kernel.</p></Card>
  <Card title="Корпоративный продукт"><Note hold>PRODUCT_ACCEPTED ещё не присвоен</Note><p>Техническая квалификация на тестовом источнике не заменяет установленный корпоративный D2-Owner и производственную приёмку CehoVod.</p></Card></div>;
 case 'Рабочая область':return <Card title="Workspace и доступ"><strong>{data.hasT3Host?'Выбор управляется доверенным Host':'Корпоративная Workspace не подключена'}</strong>
  <p>Источник, подписант, Store, Kernel и права остаются в оригинальном T2/T3. Activity не создаёт второй Store или IAM.</p><button onClick={()=>go('T3 D1/D2')}>Проверить подключение</button></Card>;
 case 'Настройки':return <div className="activity-v7-grid">
  <Card title="Моя панель"><p>Перемещение, удаление, изменение ширины, названия и выбора источника выполняются на главной. Сохраняется только конфигурация.</p><button onClick={()=>go('Главная')}>Открыть главную</button></Card>
  <Card title="Режимы просмотра"><p>Открытые карточки событий показываются в изменяемой правой панели. Для поиска используйте Ctrl+K.</p><p>Версия программы: Activity 0.4.0-dev.1. Редакция дизайна V7.</p></Card></div>;
 case 'Справка':return <div className="activity-v7-grid">
  <Card title="Начало работы"><p>Выберите встроенный пример A1/OCEL или локальный JSON, затем откройте реконструкцию, карту и проверку. Подключённая организация требует оригинального T3 Host.</p><button onClick={()=>go('Источники')}>К источникам</button></Card>
  <Card title="Как понимать результат"><p>Ни один структурный алиас не доказывает причинность, нарушения, переделки или экономические потери. Неопределённость отображается явно.</p></Card></div>;
 default:return <Note>Раздел доступен в меню Activity.</Note>;
 }
}
