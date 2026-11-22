import {useEffect,useMemo,useRef,useState,type DragEvent,type ReactNode} from 'react';
import {ActivityInnerPage} from './ActivityInnerPage';
import type {Preview} from '../../modules/activity-base-anonymizer/engine.mjs';
import type {SyntheticRisk} from '../../modules/activity-base-anonymizer/risk.mjs';
import type {Ocel2EvidenceView} from '../../modules/activity-base-anonymizer/ocel2-evidence.mjs';
import type {T3ReviewState} from '../../modules/activity-base-anonymizer/t3-review-controller.mjs';
import {buildT3EvidencePassport} from '../../modules/activity-base-anonymizer/t3-evidence-passport.mjs';
import {buildT3TransitionMap} from '../../modules/activity-base-anonymizer/t3-transition-map.mjs';
import {D05_RESULT_TYPES,D05_EVENT_TYPES} from '../../modules/activity-base-anonymizer/d05-t3-evidence-binding.mjs';
import {ACTIVITY_WIDGETS,ACTIVITY_BOARD_STORAGE,defaultActivityBoard,
  normalizeActivityBoard,moveActivityWidget,updateActivityWidget,
  type ActivityWidget,type ActivityWidgetKind,type ActivityWidgetSize,type ActivityWidgetSource
} from '../../modules/activity-base-anonymizer/dashboard-layout.mjs';

export type ActivityWorkspaceData={sourceName:string;busy:boolean;problem:string;preview:Preview|null;
  risk:SyntheticRisk|null;objectEvidence:Ocel2EvidenceView|null;t3Review:T3ReviewState|null;
  hasT3Host:boolean;canStage:boolean;canRecover:boolean};
export type ActivityWorkspaceActions={loadExample:()=>void;loadOcelExample:()=>void;readT3:()=>void;
  pickFile:()=>void;stageT3:()=>void;recoverT3:()=>void};
export type ActivityWorkspaceProps={brandSrc:string;data:ActivityWorkspaceData;actions:ActivityWorkspaceActions;legacy:ReactNode};
const GROUPS=[
  {name:'Главная',icon:'home',pages:['Главная']},
  {name:'Источники',icon:'database',pages:['Источники','Схемы A0/A1','Рабочая область']},
  {name:'Реконструкция',icon:'layers',pages:['Реконструкция','Карта процессов','Аудит A2']},
  {name:'OCEL 2.0',icon:'network',pages:['OCEL 2.0','Стандарты']},
  {name:'T3 D1/D2',icon:'shield',pages:['T3 D1/D2','Карта T3','Паспорт фактов','Свидетельства D05']},
  {name:'Проверка',icon:'check',pages:['Проверка','Черновик и восстановление','Выпуск и обмен','Квалификация']},
  {name:'Настройки',icon:'settings',pages:['Настройки','Справка']}
] as const;
const PAGES=GROUPS.flatMap(x=>x.pages);
const groupFor=(p:string)=>GROUPS.find(x=>(x.pages as readonly string[]).includes(p))??GROUPS[0];
const PATH:Record<string,string>={
home:'M3 10 12 3 21 10v11h-6v-7H9v7H3z',
database:'M3 6c0-4 18-4 18 0v12c0 4-18 4-18 0z M3 12c0 4 18 4 18 0',
layers:'m12 3 9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 17l9 5 9-5',
network:'M5 4h3v3H5z M16 4h3v3h-3z M10 17h4v4h-4z M8 6h8 M7 8l4 8 M17 8l-4 8',
shield:'m12 2 8 4v6c0 5-3 8-8 10-5-2-8-5-8-10V6z M9 12l2 2 4-4',
check:'M4 4h16v16H4z M8 12l3 3 5-6',
settings:'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.5 1.5m9.8 9.8 1.5 1.5m0-12.8-1.5 1.5M7.1 16.9l-1.5 1.5 M12 8a4 4 0 100 8 4 4 0 000-8z',
search:'M18 18l4 4 M19 10a9 9 0 11-18 0 9 9 0 0118 0z',
panel:'M3 4h18v16H3z M9 4v16',
back:'M19 12H5m7-7-7 7 7 7',
next:'M5 12h14m-7-7 7 7-7 7',
plus:'M12 4v16M4 12h16',
folder:'M3 5h7l2 3h9v11H3z',
file:'M6 2h8l5 5v14H6z M14 2v6h5M8 13h8m-8 4h8',
drag:'M8 4h1m7 0h1M8 12h1m7 0h1M8 20h1m7 0h1',
refresh:'M20 9a8 8 0 101 5M20 4v5h-5'};
function Icon({name,size=19}:{name:string;size?:number}){return <svg aria-hidden="true" width={size} height={size}
 viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
 strokeLinecap="round" strokeLinejoin="round"><path d={PATH[name]??PATH.file}/></svg>}
const SOURCE:Record<ActivityWidgetSource,string>={current:'Текущий источник',a1:'A1',ocel:'OCEL 2.0',t3:'T3 D1/D2'};
const DEFAULT_NOTE='Выберите базу в разделе «Источники». Значения не подменяются демонстрационными цифрами.';
function loadBoard():ActivityWidget[]{try{const v=normalizeActivityBoard(JSON.parse(localStorage.getItem(ACTIVITY_BOARD_STORAGE)||'null'));if(v)return v;}catch{}return defaultActivityBoard();}
type Inspector={id:string;name:string;content:string[]};
function Card({title,children}:{title:string;children:ReactNode}){return <section className="activity-v7-card"><h2>{title}</h2>{children}</section>}
function Note({children,hold=false}:{children:ReactNode;hold?:boolean}){return <div className={'activity-v7-note '+(hold?'hold':'')}>{children}</div>}
function Stats({rows}:{rows:Array<[number|string,string]>}){return <div className="activity-v7-stats">
 {rows.map(([value,label],i)=><div key={i}><strong>{value}</strong><span>{label}</span></div>)}</div>}
export function ActivityWorkspace({brandSrc,data,actions,legacy}:ActivityWorkspaceProps){
 const [page,setPage]=useState('Главная'),[history,setHistory]=useState(['Главная']),[position,setPosition]=useState(0);
 const [navOpen,setNavOpen]=useState(true),[search,setSearch]=useState(''),[menu,setMenu]=useState('');
 const [board,setBoard]=useState<ActivityWidget[]>(loadBoard),[editing,setEditing]=useState(false);
 const [library,setLibrary]=useState(false),[librarySearch,setLibrarySearch]=useState(''),[widgetConfig,setWidgetConfig]=useState('');
 const [inspector,setInspector]=useState<Inspector[]>([]),[inspectId,setInspectId]=useState('');
 const [dockWidth,setDockWidth]=useState(415),[processIndex,setProcessIndex]=useState(0);
 const [objectIndex,setObjectIndex]=useState(0),[candidateIndex,setCandidateIndex]=useState(0);
 const [eventPage,setEventPage]=useState(0),[eventId,setEventId]=useState('');
 const searchInput=useRef<HTMLInputElement>(null),dragId=useRef(''),idCounter=useRef(1);
 useEffect(()=>{try{localStorage.setItem(ACTIVITY_BOARD_STORAGE,JSON.stringify(board));}catch{}},[board]);
 useEffect(()=>{const listener=(e:KeyboardEvent)=>{
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setNavOpen(true);searchInput.current?.focus();}
   if(e.key==='Escape'){setMenu('');setLibrary(false);setWidgetConfig('');}
 };document.addEventListener('keydown',listener);return ()=>document.removeEventListener('keydown',listener);},[]);
 useEffect(()=>{setCandidateIndex(0);setEventPage(0);setEventId('');},[data.t3Review?.review]);
 useEffect(()=>{setProcessIndex(0);},[data.preview]);
 useEffect(()=>{setObjectIndex(0);},[data.objectEvidence]);
 const go=(next:string)=>{if(!(PAGES as readonly string[]).includes(next))return;
   setMenu('');setLibrary(false);setWidgetConfig('');setSearch('');
   if(next===page)return;
   setPage(next);setHistory(items=>[...items.slice(0,position+1),next]);setPosition(position+1);
 };
 const stepHistory=(delta:number)=>{const next=position+delta;if(next<0||next>=history.length)return;
   setPosition(next);setPage(history[next]);setMenu('');setSearch('');};
 const openInspector=(id:string,name:string,content:string[])=>{
  setInspector(x=>[...x.filter(t=>t.id!==id).slice(-7),{id,name,content}]);setInspectId(id);
 };
 const activeInspector=inspector.find(x=>x.id===inspectId)||inspector[0];
 const modifyWidget=(id:string,patch:Partial<ActivityWidget>)=>setBoard(rows=>updateActivityWidget(rows,id,patch)??rows);
 const moveWidget=(id:string,offset:number)=>{const i=board.findIndex(x=>x.id===id);const target=board[i+offset];
   if(target)setBoard(rows=>moveActivityWidget(rows,id,target.id,offset>0)??rows);};
 const addWidget=(kind:ActivityWidgetKind)=>{if(board.length>=24)return;let id='db-custom-'+(idCounter.current++).toString(36);
   while(board.some(x=>x.id===id))id='db-custom-'+(idCounter.current++).toString(36);
   setBoard(rows=>[...rows,{id,kind,source:ACTIVITY_WIDGETS[kind].sources[0],size:'half'}]);
   setEditing(true);setLibrary(false);setPage('Главная');setWidgetConfig(id);};
 const choose=(source:'a1'|'ocel'|'file'|'t3')=>{
   if(source==='a1')actions.loadExample();else if(source==='ocel')actions.loadOcelExample();
   else if(source==='file')actions.pickFile();else actions.readT3();go('Источники');
 };
 const t3=data.t3Review?.status==='REVIEW'?data.t3Review.review:null;
 const candidates=t3?.structural_candidate??[];
 const selectedCandidate=candidates[Math.min(candidateIndex,Math.max(0,candidates.length-1))]??null;
 const map=useMemo(()=>{try{return selectedCandidate?buildT3TransitionMap(selectedCandidate):null;}catch{return null;}},[selectedCandidate]);
 const passport=useMemo(()=>{try{return t3?buildT3EvidencePassport(t3):null;}catch{return null;}},[t3]);
 const current=data.preview?'a1':data.objectEvidence?'ocel':t3?'t3':'none';
 const process=data.preview?.processes[Math.min(processIndex,Math.max(0,(data.preview?.processes.length??1)-1))];
 const object=data.objectEvidence?.object_views[Math.min(objectIndex,Math.max(0,(data.objectEvidence?.object_views.length??1)-1))];

 function contentOfWidget(w:ActivityWidget):ReactNode{
  const source=w.source==='current'?current:w.source===current?w.source:'none';
  const empty=<Note>{DEFAULT_NOTE}</Note>;
  if(w.kind==='sources')return <div className="activity-v7-actions"><button onClick={()=>choose('a1')}>Пример A1</button><button onClick={()=>choose('ocel')}>Пример OCEL</button><button onClick={()=>choose('file')}>JSON</button><button onClick={()=>choose('t3')}>T3</button></div>;
  if(w.kind==='sourceStatus')return <><b>{data.hasT3Host?'Host предоставлен':'T3 Host не подключён'}</b><p>Подписанное чтение зависит от оригинального D1/D2 и разрешённой Workspace.</p></>;
  if(w.kind==='standards')return <p>OCEL 2.0: ограниченный JSON. BPMN: без XML. DMN/CMMN: правила не установлены. W3C PROV: подтверждения нет.</p>;
  if(w.kind==='d05')return <><Stats rows={[[D05_RESULT_TYPES.length,'Result'],[D05_EVENT_TYPES.length,'Event']]}/><p>Предметный контракт CehoVod. Физическое производство не подтверждено.</p></>;
  if(w.kind==='recovery')return <p>{data.canRecover?'Доступна подписанная проверка черновика.':'Для восстановления нужен оригинальный доверенный Host.'} Повторная запись не выполняется.</p>;
  if(w.kind==='release')return <><b>HOLD · выпуск закрыт</b><p>Не установлены анонимность и право на внешний обмен.</p></>;
  if(w.kind==='qualification')return <><b>Корпоративный P1: NOT_ACCEPTED</b><p>Сборка и тестовый T3 не равны установленному корпоративному доступу.</p></>;
  if(w.kind==='localFile')return <button onClick={()=>choose('file')}>Открыть локальный JSON</button>;
  if(w.kind==='overview'){
   if(source==='a1'&&data.preview)return <Stats rows={[[data.preview.processes.length,'Процессов'],[data.preview.selected_case_count,'Траекторий'],[data.preview.role_count,'Ролей']]}/>;
   if(source==='ocel'&&data.objectEvidence)return <Stats rows={[[data.objectEvidence.object_type_count,'Объектов'],[data.objectEvidence.event_type_count,'Событий'],[data.objectEvidence.shared_event_count,'Общих событий']]}/>;
   if(source==='t3'&&t3)return <Stats rows={[[candidates.length,'Типов объектов'],[candidates.reduce((s,x)=>s+x.observed_event_kinds.length,0),'Классов'],[candidates.reduce((s,x)=>s+x.object_local_successions.length,0),'Переходов']]}/>;
   return empty;
  }
  if(w.kind==='processes')return source==='a1'&&data.preview?<div className="activity-v7-list">{data.preview.processes.map((p,i)=><button key={p.id} onClick={()=>{setProcessIndex(i);go('Реконструкция');}}>Процесс {i+1} · {p.trace_count} траектории</button>)}</div>:empty;
  if(w.kind==='processMap')return source==='a1'&&data.preview?<div className="activity-v7-sequence">{data.preview.processes[0]?.states.map((x,i)=><span key={x.id}><button onClick={()=>openInspector('a1:'+x.id,x.id,['Роли: '+x.roles.join(', ')])}>{x.id}</button> {i<data.preview!.processes[0].states.length-1?'→ ':''}</span>)}</div>:empty;
  if(w.kind==='ocel')return source==='ocel'&&data.objectEvidence?<Stats rows={[[data.objectEvidence.object_type_count,'Типов объектов'],[data.objectEvidence.shared_event_count,'Общих событий'],[data.objectEvidence.declared_object_link_count,'O2O-связей']]}/>:empty;
  if(w.kind==='risks'){const r=source==='a1'?data.risk:source==='ocel'?data.objectEvidence:source==='t3'?t3:null;
   return r?<><b>{r.status}</b><p>Анонимность не установлена. Экспорт закрыт.</p><div className="activity-v7-list">{r.reason_codes.slice(0,3).map(code=><span key={code}>{code}</span>)}</div></>:empty;}
  if(w.kind==='evidence'||w.kind==='questions')return source==='t3'&&passport?<><b>{passport.result}</b><p>{passport.actionCount} вопросов к источнику.</p><div className="activity-v7-list">{passport.groups.flatMap(x=>x.items).slice(0,3).map(q=><span key={q.code}>{w.kind==='questions'?q.next:q.issue}</span>)}</div></>:empty;
  if(w.kind==='t3Map')return source==='t3'&&map?<Stats rows={[[map.nodes.length,'Классов'],[map.transitions.length,'Переходов'],[map.branch_points,'Разветвлений']]}/>:empty;
  return empty;
 }
 function dashboard():ReactNode{return <div className="activity-v7-main">
  <div className="activity-v7-heading"><div><small>IWXA ACTIVITY · МОЯ ПАНЕЛЬ</small><h1>Моя панель деятельности</h1>
   <p>Добавляйте необходимые карты и показатели, подключайте источники и располагайте блоки в удобном порядке.</p></div>
   <div className="activity-v7-actions"><button className="activity-v7-primary" onClick={()=>setLibrary(true)}><Icon name="plus" size={16}/> Добавить блок</button>
    <button onClick={()=>setEditing(x=>!x)}>{editing?'Готово':'Настроить'}</button></div></div>
  <div className="activity-v7-source-banner"><Icon name="database"/><div><strong>{current==='none'?'Источник не выбран':data.sourceName}</strong>
    <span>{data.problem||'Данные обновляются только после подтверждённого чтения выбранного источника'}</span></div>
    <button onClick={()=>go('Источники')}>Источники</button></div>
  {editing?<p className="activity-v7-muted">Перемещайте блоки за маркер. Alt+стрелки меняют порядок с клавиатуры. Состав панели сохраняется на этом компьютере.</p>:null}
  <section className="activity-v7-board" aria-label="Настраиваемая панель Activity">{board.map((w,i)=><article className="activity-v7-widget" data-size={w.size} key={w.id}
   onDragOver={e=>{if(dragId.current)e.preventDefault();}}
   onDrop={e=>{if(!dragId.current)return;e.preventDefault();const id=dragId.current;dragId.current='';setBoard(rows=>moveActivityWidget(rows,id,w.id)??rows);}}>
   <header><span className="activity-v7-widget-glyph"><Icon name={w.kind==='ocel'?'network':w.kind==='risks'?'shield':'layers'} size={16}/></span>
    <div><strong>{w.label||ACTIVITY_WIDGETS[w.kind].title}</strong><small>{SOURCE[w.source]}</small></div>
    <button draggable title="Перетащить блок" aria-label="Перетащить блок"
      onDragStart={(e:DragEvent<HTMLButtonElement>)=>{dragId.current=w.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',w.id);}}
      onKeyDown={e=>{if(!(e.altKey||e.ctrlKey))return;if(['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(e.key)){e.preventDefault();moveWidget(w.id,['ArrowLeft','ArrowUp'].includes(e.key)?-1:1);}}}><Icon name="drag" size={16}/></button>
    <button aria-label="Настроить блок" onClick={()=>setWidgetConfig(w.id)}><Icon name="settings" size={16}/></button>
    {editing?<button aria-label="Удалить блок" onClick={()=>setBoard(rows=>rows.filter(x=>x.id!==w.id))}>×</button>:null}
   </header><div className="activity-v7-widget-body">{contentOfWidget(w)}</div>
   <footer><span>{i+1} из {board.length}</span><button onClick={()=>go(ACTIVITY_WIDGETS[w.kind].page)}>Подробнее</button></footer>
   {editing?<div className="activity-v7-actions activity-v7-widget-order"><button disabled={i===0} onClick={()=>moveWidget(w.id,-1)}>← Раньше</button><button disabled={i===board.length-1} onClick={()=>moveWidget(w.id,1)}>Позже →</button></div>:null}
  </article>)}
   {editing?<button className="activity-v7-add-tile" onClick={()=>setLibrary(true)}>＋ Добавить блок</button>:null}
  </section>{editing?<button className="activity-v7-reset" onClick={()=>setBoard(defaultActivityBoard())}>Восстановить исходную панель</button>:null}
 </div>}
 const navOwner=groupFor(page);
 const chosenInspector=inspector.find(x=>x.id===inspectId)||inspector[0];
 return <div className="activity-v7" onClick={e=>{if(menu&&!(e.target as HTMLElement).closest('.activity-v7-menu-zone'))setMenu('');}}>
  <header className="activity-v7-titlebar">
   <img src={brandSrc} alt="IWXA" className="activity-v7-brand"/>
   <button aria-label="Назад" disabled={position===0} onClick={()=>stepHistory(-1)}><Icon name="back"/></button>
   <button aria-label="Вперёд" disabled={position===history.length-1} onClick={()=>stepHistory(1)}><Icon name="next"/></button>
   <button aria-label="Свернуть боковую панель" onClick={()=>setNavOpen(x=>!x)}><Icon name="panel"/></button>
   <span className="activity-v7-divider"/><strong className="activity-v7-product">IWXA Activity</strong>
   <div className="activity-v7-menu-zone">{['Файл','Правка','Вид','Справка'].map(name=><button key={name} onClick={()=>setMenu(menu===name?'':name)} aria-expanded={menu===name}>{name}</button>)}
    {menu&&menu!=='Профиль'?<div className="activity-v7-popup" role="menu"><strong>{menu}</strong>
     {(menu==='Файл'?[
      ['Открыть встроенный пример',()=>choose('a1')],['Открыть пример OCEL 2.0',()=>choose('ocel')],
      ['Выбрать локальный JSON',()=>choose('file')],['Подключить выбранную базу T3',()=>choose('t3')]]:
      menu==='Правка'?[['Настроить дашборд',()=>{go('Главная');setEditing(true);}],['Восстановить панель',()=>setBoard(defaultActivityBoard())]]:
      menu==='Вид'?[['Главная',()=>go('Главная')],['Показать или скрыть меню',()=>setNavOpen(x=>!x)],
       ['Открыть просмотр',()=>openInspector('help','Просмотр',['Выберите этап или событие.'])]]:
      [['Справка',()=>go('Справка')],['Стандарты',()=>go('Стандарты')]]
     ).map(([label,fn])=><button role="menuitem" key={label as string} onClick={()=>{setMenu('');(fn as ()=>void)();}}>{label as string}</button>)}
    </div>:null}
   </div><div className="activity-v7-window-buttons" aria-hidden="true"><span>−</span><span>□</span><span>×</span></div>
  </header>
  <div className="activity-v7-layout">
   <nav className="activity-v7-rail" aria-label="Основная навигация">{GROUPS.slice(0,6).map(x=><button
    key={x.name} aria-label={x.name} title={x.name} className={navOwner.name===x.name?'selected':''} onClick={()=>go(x.pages[0])}><Icon name={x.icon}/></button>)}
    <div className="activity-v7-grow"/>
    <button title="Рабочая область" aria-label="Рабочая область" onClick={()=>go('Рабочая область')}><Icon name="folder"/></button>
    <div className="activity-v7-rail-divider"/>
    <div className="activity-v7-menu-zone"><button aria-label="Профиль и настройки" onClick={()=>setMenu(menu==='Профиль'?'':'Профиль')}><img src={brandSrc} alt=""/></button>
     {menu==='Профиль'?<div className="activity-v7-popup profile"><strong>Профиль</strong>
      {['Настройки','Рабочая область','Квалификация','Справка'].map(p=><button key={p} onClick={()=>go(p)}>{p}</button>)}</div>:null}
    </div>
   </nav>
   {navOpen?<aside className="activity-v7-navpanel">
    <label className="activity-v7-search"><Icon name="search" size={17}/><input type="search" ref={searchInput} value={search}
      onChange={e=>setSearch(e.target.value)} placeholder="Найти раздел или команду" aria-label="Поиск по Activity"/></label>
    <div className="activity-v7-navscroll"><div className="activity-v7-navcaption">{search?'Результаты поиска':navOwner.name}</div>
     {(search?PAGES.filter(p=>p.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))):navOwner.pages).map(p=>
      <button key={p} className={page===p?'selected':''} onClick={()=>go(p)}><Icon name={groupFor(p).icon} size={16}/>{p}</button>)}
     {page==='Главная'&&!search?<><div className="activity-v7-navcaption">Продолжить</div>
      <button onClick={()=>go('Источники')}><Icon name="database" size={16}/>Источники</button>
      <button onClick={()=>go('Проверка')}><Icon name="check" size={16}/>Проверка результата</button></>:null}
    </div><div className="activity-v7-navfoot"><small>ТЕКУЩАЯ РАБОЧАЯ ОБЛАСТЬ</small>
     <button onClick={()=>go('Рабочая область')}><Icon name="folder" size={17}/> {data.hasT3Host?'Выбор оригинального Host':'Не подключена'} <span>⌄</span></button></div>
   </aside>:null}
   <main className="activity-v7-workarea"><div className="activity-v7-scroll">
    {page==='Главная'?dashboard():page==='Источники'?<div className="activity-v7-main">
      <h1>Источники деятельности</h1><p className="activity-v7-muted">Действующие функции Activity: локальный A1/A2, OCEL 2.0, синтетический JSON и оригинальный подписанный T3.</p>
      <Note>Источник и права всегда проверяются действующим модулем. Подключение T3 без Host остаётся HOLD.</Note></div>:
     <div className="activity-v7-main"><header className="activity-v7-heading"><div><small>IWXA ACTIVITY · {navOwner.name}</small>
       <h1>{page}</h1><p>{data.sourceName}</p></div><button onClick={()=>go('Источники')}>Выбрать источник</button></header>
       <ActivityInnerPage page={page} data={data} actions={actions} process={process}
         object={object} candidate={selectedCandidate} map={map} passport={passport} candidates={candidates}
         processIndex={processIndex} setProcessIndex={setProcessIndex} objectIndex={objectIndex} setObjectIndex={setObjectIndex}
         candidateIndex={candidateIndex} setCandidateIndex={setCandidateIndex} eventPage={eventPage} setEventPage={setEventPage}
         eventId={eventId} setEventId={setEventId} go={go} choose={choose} inspect={openInspector}/></div>}
    <div className="activity-v7-legacy" style={{display:page==='Источники'?'block':'none'}}
      aria-hidden={page!=='Источники'}>{legacy}</div>
   </div></main>
   {chosenInspector?<aside className="activity-v7-dock" style={{width:dockWidth,flexBasis:dockWidth}} aria-label="Панель просмотра">
    <div className="activity-v7-grip" tabIndex={0} role="separator" aria-orientation="vertical" aria-label="Изменить ширину просмотра"
      onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setDockWidth(v=>Math.max(300,Math.min(680,v+(e.key==='ArrowLeft'?20:-20))));}}}
      onPointerDown={e=>{
       const x=e.clientX,initial=dockWidth,el=e.currentTarget;el.setPointerCapture(e.pointerId);
       const move=(event:PointerEvent)=>setDockWidth(Math.max(300,Math.min(680,initial+x-event.clientX)));
       const stop=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',stop);};
       el.addEventListener('pointermove',move);el.addEventListener('pointerup',stop,{once:true});
      }}/>
    <header><strong>Просмотр</strong><button aria-label="Закрыть просмотр" onClick={()=>{setInspector([]);setInspectId('');}}>×</button></header>
    <div className="activity-v7-tabs">{inspector.map(t=><button key={t.id} className={t.id===chosenInspector.id?'selected':''}
      onClick={()=>setInspectId(t.id)}>{t.name}</button>)}</div>
    <div className="activity-v7-dockbody"><h2>{chosenInspector.name}</h2>{chosenInspector.content.map((x,i)=><p key={i}>{x}</p>)}</div>
    <footer>Перетащите границу, чтобы изменить ширину.</footer>
   </aside>:null}
  </div>
  {library?<div className="activity-v7-modal-mask" onMouseDown={e=>{if(e.target===e.currentTarget)setLibrary(false);}}>
   <div className="activity-v7-modal" role="dialog" aria-modal="true" aria-label="Библиотека блоков">
    <div className="activity-v7-modal-head"><h2>Библиотека блоков</h2><button onClick={()=>setLibrary(false)}>×</button></div>
    <p>Добавляйте карты, показатели, источники и проверки. Максимум 24 блока.</p>
    <input type="search" autoFocus value={librarySearch} onChange={e=>setLibrarySearch(e.target.value)} placeholder="Найти блок"/>
    <div className="activity-v7-library">{Object.entries(ACTIVITY_WIDGETS).filter(([,meta])=>meta.title.toLocaleLowerCase('ru').includes(librarySearch.toLocaleLowerCase('ru'))).map(([kind,meta])=>
     <div key={kind}><strong>{meta.title}</strong><span>{meta.page}</span><button disabled={board.length>=24} onClick={()=>addWidget(kind as ActivityWidgetKind)}>Добавить</button></div>)}</div>
   </div></div>:null}
  {widgetConfig&&board.some(w=>w.id===widgetConfig)?<div className="activity-v7-modal-mask" onMouseDown={e=>{if(e.target===e.currentTarget)setWidgetConfig('');}}>
   <div className="activity-v7-modal compact" role="dialog" aria-modal="true" aria-label="Настройка блока">
    <div className="activity-v7-modal-head"><h2>Настроить блок</h2><button onClick={()=>setWidgetConfig('')}>×</button></div>
    {(()=>{const w=board.find(x=>x.id===widgetConfig)!;return <div className="activity-v7-config">
     <label>Название<input maxLength={58} value={w.label??''} placeholder={ACTIVITY_WIDGETS[w.kind].title}
      onChange={e=>modifyWidget(w.id,{label:e.target.value})}/></label>
     <label>Источник<select value={w.source} onChange={e=>modifyWidget(w.id,{source:e.target.value as ActivityWidgetSource})}>
       {ACTIVITY_WIDGETS[w.kind].sources.map(source=><option key={source} value={source}>{SOURCE[source]}</option>)}</select></label>
     <label>Ширина<div className="activity-v7-actions">{(['compact','half','wide'] as ActivityWidgetSize[]).map(s=>
       <button key={s} className={w.size===s?'selected':''} onClick={()=>modifyWidget(w.id,{size:s})}>{s==='compact'?'Узкий':s==='half'?'Средний':'Широкий'}</button>)}</div></label>
     <Note>Сохраняются настройки блока, не исходные данные или корпоративные права.</Note>
     <button className="activity-v7-primary" onClick={()=>setWidgetConfig('')}>Готово</button>
    </div>;})()}
   </div></div>:null}
 </div>;
}
