// Presentation only. Accepts exactly the A2-screened structural candidate
// emitted by the ORIGINAL T3 D1/D2 trusted Activity Host.
// No Kernel, source rows, actor IDs, clock data, inference or graph writes.
import {layoutObservedGraph} from './graph-order.mjs';

const OBJECT=/^object_type_[0-9]{3,5}$/;
const EVENT=/^event_type_[0-9]{3,5}$/;
const BANDS=new Set(['3-9','10-49','50+']);
const ORDER='OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY';
const ONLY=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=ok=>{if(!ok)throw Error('T3_SCREENED_TRANSITION_MAP_REQUIRED');};

/**
 * Not an OCEL2 graph. A compact read-only adjacency view over the ORIGINAL
 * source-qualified order edges. Aliases are NOT business activity names.
 * Branching is coexistence of different observed successions, not a DMN rule.
 * A cycle is repeated order, NOT established rework.
 */
export function buildT3TransitionMap(view){
  need(ONLY(view,['object_type','cohort_band','observed_event_kinds',
    'object_local_successions'])&&OBJECT.test(view.object_type)&&
    BANDS.has(view.cohort_band)&&
    Array.isArray(view.observed_event_kinds)&&
    view.observed_event_kinds.length<=10000&&
    view.observed_event_kinds.every(x=>typeof x==='string'&&EVENT.test(x))&&
    Array.isArray(view.object_local_successions)&&
    view.object_local_successions.length<=10000);
  const ids=[...view.observed_event_kinds];
  const distinct=new Set(ids);
  need(distinct.size===ids.length);
  const edges=[],unique=new Set();
  for(const e of view.object_local_successions){
    need(ONLY(e,['from','to','cohort_band','relation'])&&
      typeof e.from==='string'&&typeof e.to==='string'&&
      EVENT.test(e.from)&&EVENT.test(e.to)&&
      distinct.has(e.from)&&distinct.has(e.to)&&
      BANDS.has(e.cohort_band)&&e.relation===ORDER);
    const key=JSON.stringify([e.from,e.to]);
    need(!unique.has(key));
    unique.add(key);
    edges.push(Object.freeze({
      from:e.from,to:e.to,cohort_band:e.cohort_band,
      relation:ORDER,
    }));
  }
  edges.sort((a,b)=>a.from.localeCompare(b.from,'en')||
    a.to.localeCompare(b.to,'en'));
  // 10k approved aliases are legal, but a complete layout on the React
  // thread is not. For unusually large views keep every ORIGINAL edge and
  // a stable alphabetical browsing order, explicitly DO NOT certify global
  // topology. The existing graph-order layout handles ordinary-sized views.
  const too_complex=distinct.size>256||edges.length>512;
  const {ordered,linear,cyclic}=too_complex
    ? {ordered:[...distinct].sort().map(id=>({id})),
      linear:false,cyclic:false}
    : layoutObservedGraph({
      states:[...distinct].sort().map(id=>({id})),
      observed_successions:edges,
    });
  const outgoing=new Map(ids.map(id=>[id,[]]));
  const incoming=new Map(ids.map(id=>[id,[]]));
  for(const edge of edges){
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }
  const nodes=ordered.map(row=>Object.freeze({
    id:row.id,
    label:'Событие '+row.id.slice('event_type_'.length),
    incoming:Object.freeze(incoming.get(row.id)),
    outgoing:Object.freeze(outgoing.get(row.id)),
  }));
  const branches=nodes.filter(n=>n.outgoing.length>1).length;
  const convergences=nodes.filter(n=>n.incoming.length>1).length;
  const disconnected=nodes.filter(n=>!n.incoming.length&&!n.outgoing.length).length;
  // A business-facing checklist of questions, NOT findings. Source aliases
  // alone cannot establish causes, misconduct, losses, rework or a norm.
  // Use only observed edge counts and conservative topology flags.
  const questions=[];
  const ask=(code,title,prompt)=>questions.push(Object.freeze({code,title,prompt}));
  if(too_complex) ask('SCOPE_EXCEEDS_LAYOUT','Как проверить сложную схему?',
    'Просмотреть локальные связи выбранных классов по отдельности. Полный порядок не рассчитывался, поэтому нельзя утверждать, что маршрут линейный или циклический.');
  if(!edges.length) ask('NO_ORDER_EDGES','Где подтверждение порядка?',
    'Уточнить у владельца источника, существуют ли исходные связи последовательных событий внутри объекта. Совпадения названий или времени недостаточно.');
  if(disconnected>0&&edges.length) ask('ISOLATED_EVENT_KIND','Почему есть классы без переходов?',
    'Проверить в предметной системе, являются ли эти события самостоятельными или для них отсутствуют подтверждённые связи. Пропуски нельзя достраивать.');
  if(!too_complex&&cyclic) ask('REPEATED_ORDER','Что означает возвращение к классу события?',
    'Сверить первичные события и регламент: плановый повтор, исправление или особенность регистрации. Сам цикл не доказывает переделку.');
  if(branches>0) ask('MULTIPLE_SUCCESSORS','Почему за событием разные продолжения?',
    'Сверить исходные Work и Result и проверить условия каждого варианта. Наблюдаемые ветви не являются доказанными правилами решений.');
  if(convergences>0) ask('MULTIPLE_PREDECESSORS','Почему к событию ведут разные пути?',
    'Проверить, соответствуют ли входящие переходы одному предметному процессу. Их наличие само по себе не означает ошибку.');
  if(linear) ask('NORMATIVE_SEQUENCE','Совпадает ли порядок с регламентом?',
    'Сверить последовательность с согласованными этапами Work и критериями приёмки Result. Локальный порядок не подтверждает выполнение и качество.');
  if(!questions.length) ask('SOURCE_VERIFICATION','Какие свидетельства нужны для вывода?',
    'Подтвердить в предметной системе характер событий и связи с Work и Result. Карта не оценивает производственные потери.');
  return Object.freeze({
    nodes:Object.freeze(nodes),
    transitions:Object.freeze(edges),
    too_complex,
    cyclic,branched:branches>0||convergences>0,
    linear:!too_complex&&!cyclic&&linear&&edges.length>0,
    branch_points:branches,convergence_points:convergences,
    isolated_event_kinds:disconnected,
    review_questions:Object.freeze(questions.slice(0,3)),
    source_role:'OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY',
    inferred_edges:0,
    export_allowed:false,
  });
}
