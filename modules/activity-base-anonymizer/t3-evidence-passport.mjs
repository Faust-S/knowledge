// Activity product UI: explain already screened original T3 D2 reason codes.
// This is NOT a new evidence analyzer or a substitute for original D1/D2.
// Never accept private source text, raw objects, timestamps or identities.
// The original narrow Host contract is unchanged.
const DEFINITIONS=Object.freeze([
  {code:'T3_D2_EVENT_STATUS_NOT_DECLARED',area:'facts',priority:1,
    issue:'Не указан статус доказанности события',
    next:'Уточнить у владельца предметной системы, какие события сообщены исполнителем, какие измерены, а какие только запланированы.'},
  {code:'T3_D2_UNVERIFIED_EVENT_STEP',area:'facts',priority:1,
    issue:'Выполнение операции не подтверждено',
    next:'Получить независимые свидетельства выполнения: проверку качества, акт приёмки или зарегистрированное измерение. Простая запись перехода недостаточна.'},
  {code:'T3_D2_NO_OBSERVED_ACTIVITY',area:'facts',priority:1,
    issue:'Нет подтверждённой последовательности действий',
    next:'Проверить у владельца источника наличие фактических событий работы. Служебные записи и планы не доказывают исполнение.'},
  {code:'T3_D2_UNMAPPED_SOURCE_RECORD',area:'facts',priority:1,
    issue:'Есть записи без предметного соответствия',
    next:'Сверить версии схем объектов и событий с исходной предметной программой. Недостающие действия не восстанавливать по догадке.'},
  {code:'T3_D2_EVENT_OBJECT_UNVERIFIED',area:'links',priority:1,
    issue:'Не подтверждена принадлежность события объекту',
    next:'Уточнить исходную ссылку на работу, заказ или результат в оригинальном Kernel.'},
  {code:'T3_D2_UNRESOLVED_SOURCE_LINK',area:'links',priority:1,
    issue:'Не установлены связи между объектами и событиями',
    next:'Восстановить проверяемые связи через штатные отношения оригинального Kernel; не выводить их из совпадения названий.'},
  {code:'T3_D2_OBJECT_WITHOUT_EVENTS',area:'facts',priority:2,
    issue:'У объектов отсутствует история действий',
    next:'Запросить у владельца системы сохранённую историю переходов; текущее состояние не заменяет историю.'},
  {code:'T3_D2_OBJECT_EVENT_ORDER_UNKNOWN',area:'time',priority:2,
    issue:'Неизвестен достоверный порядок действий',
    next:'Проверить временные метки и последовательность независимых событий. Не создавать порядок по идентификаторам.'},
  {code:'T3_D2_RARE_OBJECT_ROUTE',area:'privacy',priority:3,
    issue:'Редкий маршрут может раскрывать заказ',
    next:'Оценить идентифицируемость и возможность раскрытия маршрута. Пока использовать только внутри разрешённой Workspace.'},
  {code:'T3_D2_RARE_OBJECT_RELATION',area:'privacy',priority:3,
    issue:'Редкая связь может раскрывать участника',
    next:'Проверить риск раскрытия по связям и доступность альтернативного агрегированного представления.'},
  {code:'T3_D2_RELATION_PRIVACY_REVIEW_REQUIRED',area:'privacy',priority:3,
    issue:'Предметные связи требуют оценки раскрытия',
    next:'Провести независимую проверку состава связей и прав на передачу до любой публикации.'},
  {code:'EXTERNAL_LINKAGE_RISK_UNMEASURED',area:'privacy',priority:3,
    issue:'Не оценён риск сопоставления с внешними сведениями',
    next:'Отдельно проверить потенциальную деанонимизацию редких траекторий. Удаление имён не доказывает анонимность.'},
  {code:'T3_SIGNED_OWNER_RESULT_NOT_INDEPENDENTLY_ATTESTED',area:'qualification',priority:4,
    issue:'Результат владельца ещё не принят независимо',
    next:'Проверить исходную квитанцию, полномочие и повторное чтение с другим доверенным сеансом. Не объявлять продукт принятым раньше проверки.'},
  {code:'OCEL2_FULL_CONFORMANCE_NOT_ESTABLISHED',area:'qualification',priority:4,
    issue:'Полное соответствие OCEL 2.0 не проверено',
    next:'До заявления о соответствии проверить необходимые объектно-событийные связи и правила исходного стандарта.'},
  // This is a truthful positive outcome, NOT missing business evidence.
  {code:'T3_D2_SYSTEM_CONTEXT_EXCLUDED',area:'context',priority:5,
    issue:'Служебное событие Workspace исключено из процесса',
    next:'Оригинальный T3 отделил строго проверенное служебное событие от хозяйственных действий. Исправление не требуется.'},
]);
const AREAS=Object.freeze([
  ['facts','Хозяйственные факты'],
  ['links','Связи объектов'],
  ['time','Хронология'],
  ['privacy','Риск раскрытия'],
  ['qualification','Независимая квалификация'],
]);
const definition=new Map(DEFINITIONS.map(row=>[row.code,Object.freeze(row)]));
const invalid=()=>{throw Error('T3_EVIDENCE_PASSPORT_INVALID');};

/**
 * Pure summary for the existing Host-screened Activity view.
 * No confidence percentage or calculated economic losses: D2 does not
 * supply enough evidence to compute either.
 */
export function buildT3EvidencePassport(review){
  if(!review||!['HOLD','STRUCTURE_PRESERVED_REVIEW_REQUIRED'].includes(review.status)||
    !Array.isArray(review.reason_codes)||review.reason_codes.length>16||
    !review.reason_codes.every(code=>typeof code==='string'&&definition.has(code))||
    review.anonymity!=='NOT_ESTABLISHED'||review.export_allowed!==false||
    review.iwxa_package!==null||
    (review.status==='HOLD'
      ? review.structural_candidate!==null
      : !Array.isArray(review.structural_candidate)||!review.structural_candidate.length))
    invalid();
  const codes=new Set(review.reason_codes);
  const entries=DEFINITIONS.filter(row=>codes.has(row.code));
  const actionCount=entries.filter(row=>row.area!=='context').length;
  const groups=AREAS.map(([area,label])=>Object.freeze({
    area,label,
    items:Object.freeze(entries.filter(row=>row.area===area)),
  })).filter(group=>group.items.length>0);
  const info=entries.filter(row=>row.area==='context');
  return Object.freeze({
    result:review.status==='HOLD'?'INSUFFICIENT_FOR_RECONSTRUCTION':'INTERNAL_STRUCTURE_ONLY',
    businessExecution:'NOT_INDEPENDENTLY_PROVEN',
    disclosure:'FORBIDDEN',
    actionCount,
    groups:Object.freeze(groups),
    info:Object.freeze(info),
  });
}
