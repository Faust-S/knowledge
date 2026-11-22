// User-owned Activity dashboard layout only. Never persist a source payload,
// signed authority, Workspace identity, T3 result or file contents here.
export const ACTIVITY_WIDGETS=Object.freeze({
  overview:{title:'Сводка источника',page:'Источники',sources:['current','a1','ocel','t3']},
  processes:{title:'Реконструированные процессы',page:'Реконструкция',sources:['current','a1']},
  processMap:{title:'Карта процессов',page:'Карта процессов',sources:['current','a1']},
  ocel:{title:'Объекты и события',page:'OCEL 2.0',sources:['current','ocel']},
  evidence:{title:'Паспорт достаточности',page:'Паспорт фактов',sources:['current','t3']},
  questions:{title:'Вопросы к источнику',page:'Паспорт фактов',sources:['current','t3']},
  t3Map:{title:'Карта локальных переходов',page:'Карта T3',sources:['current','t3']},
  sources:{title:'Выбор источника',page:'Источники',sources:['current']},
  sourceStatus:{title:'Подключение T3',page:'T3 D1/D2',sources:['current']},
  risks:{title:'Проверка A2',page:'Аудит A2',sources:['current','a1','ocel','t3']},
  standards:{title:'Стандарты и ограничения',page:'Стандарты',sources:['current']},
  d05:{title:'CehoVod D05',page:'Свидетельства D05',sources:['current']},
  recovery:{title:'Восстановление черновика',page:'Черновик и восстановление',sources:['current']},
  release:{title:'Выпуск и обмен',page:'Выпуск и обмен',sources:['current']},
  qualification:{title:'Готовность приложения',page:'Квалификация',sources:['current']},
  localFile:{title:'Локальный JSON',page:'Источники',sources:['current']},
});
export const ACTIVITY_DEFAULT_BOARD=Object.freeze([
  {id:'db-overview',kind:'overview',source:'current',size:'wide'},
  {id:'db-processes',kind:'processes',source:'current',size:'half'},
  {id:'db-source',kind:'sourceStatus',source:'current',size:'half'},
  {id:'db-map',kind:'processMap',source:'current',size:'wide'},
  {id:'db-risks',kind:'risks',source:'current',size:'half'},
  {id:'db-evidence',kind:'evidence',source:'current',size:'half'},
]);
export const ACTIVITY_BOARD_STORAGE='iwxa.activity.dashboard.v7.layout';
const ID=/^db-[a-z0-9-]{1,48}$/;
export function normalizeActivityBoard(value){
  if(!Array.isArray(value)||value.length>24)return null;
  const seen=new Set(),out=[];
  for(const row of value){
    if(!row||typeof row!=='object'||Array.isArray(row)||
      !ID.test(row.id)||seen.has(row.id)||
      !Object.hasOwn(ACTIVITY_WIDGETS,row.kind)||!['wide','half','compact'].includes(row.size)||
      !ACTIVITY_WIDGETS[row.kind].sources.includes(row.source)||
      (row.label!==undefined&&(typeof row.label!=='string'||row.label.length>58)))return null;
    // Strip unknown properties; never keep arbitrary data embedded in a layout.
    seen.add(row.id);
    out.push({id:row.id,kind:row.kind,source:row.source,size:row.size,
      ...(row.label?.trim()?{label:row.label.trim()}: {})});
  }
  return out;
}
export function defaultActivityBoard(){return ACTIVITY_DEFAULT_BOARD.map(x=>({...x}));}
export function moveActivityWidget(board,from,to,after=false){
  const safe=normalizeActivityBoard(board);
  if(!safe||from===to)return safe;
  const i=safe.findIndex(x=>x.id===from),j=safe.findIndex(x=>x.id===to);
  if(i<0||j<0)return safe;
  const [item]=safe.splice(i,1);
  let target=safe.findIndex(x=>x.id===to);
  if(after)target+=1;
  safe.splice(target,0,item);
  return safe;
}
export function updateActivityWidget(board,id,update){
  const safe=normalizeActivityBoard(board);
  if(!safe||!safe.some(x=>x.id===id)||!update||typeof update!=='object')return null;
  const next=safe.map(row=>row.id===id?{...row,...Object.fromEntries(
    Object.entries(update).filter(([k])=>['label','size','source'].includes(k)))}:row);
  return normalizeActivityBoard(next);
}
