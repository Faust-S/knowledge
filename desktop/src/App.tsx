import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {createT3ReviewController} from '../../modules/activity-base-anonymizer/t3-review-controller.mjs';
import {buildT3TransitionMap} from '../../modules/activity-base-anonymizer/t3-transition-map.mjs';
import {buildT3EvidencePassport} from '../../modules/activity-base-anonymizer/t3-evidence-passport.mjs';
import type {T3ReviewHost, T3ReviewState} from '../../modules/activity-base-anonymizer/t3-review-controller.mjs';
import type {T3ActivityReview, T3StructuralCandidate} from '../../modules/activity-base-anonymizer/t3-selected-host.mjs';
import {ActivityHold, buildSyntheticExample} from '../../modules/activity-base-anonymizer/engine.mjs';
import {screenSyntheticDisclosure} from '../../modules/activity-base-anonymizer/risk.mjs';
import {layoutObservedGraph} from '../../modules/activity-base-anonymizer/graph-order.mjs';
import {OCEL2_SYNTHETIC_SCHEMA, buildSyntheticOcel2Example, inspectSyntheticOcel2} from '../../modules/activity-base-anonymizer/ocel2-evidence.mjs';
import type {Ocel2EvidenceView, Ocel2ObjectView} from '../../modules/activity-base-anonymizer/ocel2-evidence.mjs';
import type {Preview, ProcessGraph} from '../../modules/activity-base-anonymizer/engine.mjs';
import type {SyntheticRisk} from '../../modules/activity-base-anonymizer/risk.mjs';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const DEMO_NOTICE = 'Самостоятельное приложение работает локально. Базу T3 можно прочитать только при подключении доверенного T3 Host с отдельным разрешением Activity Read.';

function ProcessCard({process, number}: {process: ProcessGraph; number: number}) {
  const graph = layoutObservedGraph(process);
  return <section className="process-card" aria-label={`Процесс ${number}`}>
    <header className="process-head">
      <div><span className="eyebrow">ВОССТАНОВЛЕННАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ</span>
        <h3>Процесс {String(number).padStart(2, '0')}</h3></div>
      <span className="case-count">{process.trace_count} траектории</span>
    </header>
    <div className="stages" role="list" aria-label="Зафиксированные этапы">
      {graph.ordered.map((stage, index) =>
        <div className="stage" role="listitem" key={stage.id}>
          <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
          <div className="stage-detail">
            <strong>{graph.linear ? 'Этап' : 'Узел'} {String(index + 1).padStart(2, '0')}</strong>
            <span>{stage.roles.length ? stage.roles.map((role) => `Роль ${role.split('_')[1]}`).join(' · ') : 'Роль не подтверждена'}</span>
          </div>
          <span className="stage-state">Наблюдался</span>
        </div>)}
    </div>
    <div className="observed-order" aria-label="Наблюдаемые переходы">
      <span>{graph.cyclic ? 'Цикл: линейный порядок не установлен' : graph.linear ? 'Наблюдаемая последовательность' : 'Наблюдаемый граф без единого линейного порядка'}</span>
      <strong>{graph.edgeLabels.length ? graph.edgeLabels.join(' · ') : 'Связи не подтверждены'}</strong>
    </div>
    <footer className="process-footer">
      <span>{process.observed_successions.length} зафиксированных переходов</span>
      <span>Порядок действий ≠ причинная зависимость</span>
    </footer>
  </section>;
}


function ObjectViewCard({view, number}: {view: Ocel2ObjectView; number: number}) {
  return <section className="process-card" aria-label={`Объектная траектория ${number}`}>
    <header className="process-head">
      <div><span className="eyebrow">OCEL 2.0 · ТРАЕКТОРИЯ ОБЪЕКТА</span>
        <h3>Тип объекта {String(number).padStart(2, '0')}</h3></div>
      <span className="case-count">{view.observed_object_count} объектов</span>
    </header>
    <div className="observed-order">
      <span>Наблюдаемые классы действий (алиасы, без исходных названий)</span>
      <strong>{view.activity_aliases.length ? view.activity_aliases.join(' · ') : 'Нет подтверждённых событий'}</strong>
    </div>
    <div className="observed-order">
      <span>Переходы внутри одного объекта · только порядок, не причинность</span>
      <strong>{view.observed_successions.length
        ? view.observed_successions.map((edge) => `${edge.from} → ${edge.to}`).join(' · ')
        : 'Связанный порядок событий не установлен'}</strong>
    </div>
    <footer className="process-footer">
      <span>{view.observed_successions.length} наблюдаемых типов переходов</span>
      <span>{view.branching === 'OBSERVED_VARIANTS_NOT_DECISION_RULES'
        ? 'Варианты ≠ правила DMN' : 'Правила решений не выводились'}</span>
    </footer>
  </section>;
}


const T3_MAP_PAGE_SIZE=8;
const T3_CANDIDATE_PAGE_SIZE=6;

function T3ViewCard({view, number}: {view:T3StructuralCandidate;number:number}) {
  const map=useMemo(()=>buildT3TransitionMap(view),[view]);
  const [page,setPage]=useState(0);
  const [selected,setSelected]=useState<{source:T3StructuralCandidate;id:string}|null>(null);
  useLayoutEffect(()=>{setPage(0);setSelected(null);},[view]);
  const pages=Math.max(1,Math.ceil(map.nodes.length/T3_MAP_PAGE_SIZE));
  const current=Math.min(page,pages-1);
  const visible=map.nodes.slice(current*T3_MAP_PAGE_SIZE,(current+1)*T3_MAP_PAGE_SIZE);
  // A renewed signed read with the same aliases never inherits a previous
  // source's selected step. The reference to the old view is discarded.
  const choice=selected?.source===view
    ? map.nodes.find(node=>node.id===selected.id)??null:null;
  const route=map.too_complex
    ? 'Сложная схема: общий порядок не вычислен. Доступны отдельные исходные переходы.'
    : map.cyclic
    ? 'Наблюдается циклический порядок. Переделка не доказана.'
    : map.branched
      ? 'Есть варианты локального порядка. Правила решений не установлены.'
      : map.linear
        ? 'Одна цепочка локальных переходов. Нормативный маршрут не подтверждён.'
        : 'Единой последовательности нет. Недостающие связи не достраиваются.';
  return <section className="process-card" aria-label={'Траектория T3 '+number}>
    <header className="process-head">
      <div><span className="eyebrow">T3 D1/D2 · СОБЫТИЯ ПО ДАННЫМ ИСТОЧНИКА</span>
        <h3>Тип объекта {String(number).padStart(2,'0')}</h3></div>
      <span className="case-count">Повторяемость {view.cohort_band}</span>
    </header>
    <section className="t3-map" aria-label="Карта локальных переходов T3">
      <div className="t3-map-head">
        <strong>Карта локальных переходов</strong>
        <span>{map.nodes.length} классов · {map.transitions.length} типов переходов</span>
      </div>
      <p className="t3-map-route">{route}</p>
      {map.branch_points||map.convergence_points||map.isolated_event_kinds
        ? <p className="t3-map-counts">Расхождений: {map.branch_points}.
          Схождений: {map.convergence_points}.
          Без связей: {map.isolated_event_kinds}.</p> : null}
      <div className="t3-map-choices" role="group" aria-label="Выбор события для просмотра связей">
        {visible.map(node=><button type="button" key={node.id}
          className={'t3-map-node'+(choice?.id===node.id?' is-selected':'')}
          aria-pressed={choice?.id===node.id}
          onClick={()=>setSelected({source:view,id:node.id})}>
          <strong>{node.label}</strong>
          <span>Входящих: {node.incoming.length} · исходящих: {node.outgoing.length}</span>
        </button>)}
      </div>
      <div className="t3-map-controls">
        <span>Показано {map.nodes.length?current*T3_MAP_PAGE_SIZE+1:0}
          -{Math.min((current+1)*T3_MAP_PAGE_SIZE,map.nodes.length)}
          из {map.nodes.length}</span>
        {pages>1 ? <div className="t3-map-pages">
          <button type="button" disabled={current===0}
            onClick={()=>{setPage(current-1);setSelected(null);}}>Назад</button>
          <span>Страница {current+1} из {pages}</span>
          <button type="button" disabled={current===pages-1}
            onClick={()=>{setPage(current+1);setSelected(null);}}>Далее</button>
        </div> : null}
      </div>
      <div className="t3-map-inspector" role="status">
        {choice ? <>
          <strong>{choice.label}: локальные переходы из T3</strong>
          <div className="t3-map-relations">
            <div><span>Предшествующие классы</span>
              {choice.incoming.length
                ? <ul>{choice.incoming.slice(0,8).map(e=>
                  <li key={e.from}>Событие {e.from.slice('event_type_'.length)}
                    {' → '+choice.label} · группа {e.cohort_band}</li>)}</ul>
                : <p>Предшествующий класс не установлен.</p>}
              {choice.incoming.length>8
                ? <p>Первые 8 из {choice.incoming.length} связей.</p>:null}
            </div>
            <div><span>Следующие классы</span>
              {choice.outgoing.length
                ? <ul>{choice.outgoing.slice(0,8).map(e=>
                  <li key={e.to}>{choice.label+' → Событие '}
                    {e.to.slice('event_type_'.length)} · группа {e.cohort_band}</li>)}</ul>
                : <p>Следующий класс не установлен.</p>}
              {choice.outgoing.length>8
                ? <p>Первые 8 из {choice.outgoing.length} связей.</p>:null}
            </div>
          </div>
        </> : <span>Выберите событие, чтобы увидеть только зафиксированные
          входящие и исходящие связи.</span>}
      </div>
    </section>
    <footer className="process-footer">
      <span>Порядок событий не доказывает причинность, качество или экономические потери.</span>
      <span>Полное OCEL 2.0 и право на раскрытие вне Workspace не подтверждены.</span>
    </footer>
  </section>;
}

// The original trusted T3 Host has already removed all source identifiers.
// Present only deterministic descriptions of allowed D2 reason codes, never
// source rows, raw timestamps, guessed operations or a confidence percentage.
function T3EvidenceGaps({review}: {review: T3ActivityReview}) {
  const passport=buildT3EvidencePassport(review);
  const tasks=passport.groups.flatMap(group=>
    group.items.map(item=>({...item,groupLabel:group.label})));
  return <section className="evidence-audit" aria-label="Паспорт достаточности фактов">
    <div className="evidence-audit-heading">
      <strong>Паспорт достаточности фактов</strong>
      <span className="evidence-audit-count">{passport.actionCount} вопросов к источнику</span>
    </div>
    <p className="evidence-audit-result">
      {passport.result==='INSUFFICIENT_FOR_RECONSTRUCTION'
        ? 'Недостаточно доказательств для восстановления процесса'
        : 'Разрешён только внутренний просмотр структурного кандидата'}
    </p>
    <p className="evidence-audit-boundary">
      Подтверждение физического исполнения и причинности не установлено.
      Экспорт закрыт. Это не процент достоверности и не оценка стоимости потерь.
    </p>
    {tasks.length ? <>
      <strong className="evidence-audit-next">Что проверить в первую очередь</strong>
      <div className="evidence-audit-steps">
        {tasks.slice(0,2).map(task=><div className="evidence-step" key={task.code}>
          <span className="evidence-step-source">{task.groupLabel}</span>
          <strong>{task.issue}</strong>
          <p>{task.next}</p>
        </div>)}
      </div>
      {tasks.length>2 ? <details className="evidence-audit-more">
        <summary>Остальные вопросы к исходным данным ({tasks.length-2})</summary>
        <div className="evidence-audit-steps">
          {tasks.slice(2).map(task=><div className="evidence-step" key={task.code}>
            <span className="evidence-step-source">{task.groupLabel}</span>
            <strong>{task.issue}</strong>
            <p>{task.next}</p>
          </div>)}
        </div>
      </details> : null}
    </> : <p className="evidence-audit-boundary">Уточнений по текущим кодам D2 нет,
      но это не удостоверяет производство, анонимность или разрешение на передачу.</p>}
    {passport.info.map(item=><p className="evidence-audit-info" key={item.code}>
      {item.issue}. {item.next}
    </p>)}
  </section>;
}

export function App({t3Host = null, brandSrc = '/brand.svg'}: {t3Host?: T3ReviewHost | null; brandSrc?: string}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [risk, setRisk] = useState<SyntheticRisk | null>(null);
  const [objectEvidence, setObjectEvidence] = useState<Ocel2EvidenceView | null>(null);
  const [t3Review, setT3Review] = useState<T3ReviewState | null>(null);
  const [t3CandidatePage,setT3CandidatePage]=useState(0);
  const t3Controller = useRef<ReturnType<typeof createT3ReviewController> | null>(null);
  const sourceEpoch = useRef(0);
  const [sourceName, setSourceName] = useState('Источник не выбран');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  // A T3 owner replacement must clear the previous subject before repaint.
  useLayoutEffect(() => {
    sourceEpoch.current += 1;
    setPreview(null); setRisk(null); setObjectEvidence(null);
    setSourceName('Источник не выбран'); setProblem(''); setBusy(false);
    if (!t3Host) { t3Controller.current = null; setT3Review(null); return; }
    try {
      const controller = createT3ReviewController({host: t3Host, onUpdate: setT3Review});
      t3Controller.current = controller;
      return () => {sourceEpoch.current += 1; t3Controller.current = null; controller.dispose();};
    } catch {
      setT3Review({status: 'HOLD', review: null, code: 'T3_TRUSTED_HOST_INVALIDATION_REQUIRED'});
    }
  }, [t3Host]);

  // Every fresh original signed D2 review starts at the first bounded page;
  // a previous source's page is never carried to the next subject.
  useLayoutEffect(()=>{setT3CandidatePage(0);},[t3Review?.review]);

  function beginSource(): number {
    const token = ++sourceEpoch.current;
    t3Controller.current?.reset();
    setT3CandidatePage(0);
    setPreview(null); setRisk(null); setObjectEvidence(null); setProblem('');
    return token;
  }

  async function run(input: unknown, label: string, token: number) {
    if (token !== sourceEpoch.current) return;
    setBusy(true);
    try {
      const schema = input && typeof input === 'object' && 'schema' in input ? input.schema : null;
      if (schema === OCEL2_SYNTHETIC_SCHEMA) {
        const evidence = await inspectSyntheticOcel2(input);
        if (token !== sourceEpoch.current) return;
        // Only structural aliases are retained. No original object, actor, value or source id.
        setObjectEvidence(evidence);
      } else {
        const result = await screenSyntheticDisclosure(input);
        if (token !== sourceEpoch.current) return;
        // No source content, raw evidence or risk-internal candidate is persisted or exported.
        setPreview(result.preview);
        setRisk(result.risk);
      }
      setSourceName(label);
    } catch (error) {
      if (token !== sourceEpoch.current) return;
      const code = error instanceof ActivityHold ? error.code : 'INVALID_SYNTHETIC_SNAPSHOT';
      setProblem(`HOLD: ${code}`);
      setSourceName('Источник отклонён');
    } finally {
      if (token === sourceEpoch.current) setBusy(false);
    }
  }

  async function loadExample() {
    const token = beginSource();
    setBusy(true);
    setSourceName('Анализ синтетической базы…');
    try { await run(await buildSyntheticExample(), 'Встроенная синтетическая база', token); }
    catch {
      if (token === sourceEpoch.current) {
        setProblem('HOLD: LOCAL_SYNTHETIC_EXAMPLE_UNAVAILABLE');
        setSourceName('Источник отклонён');
      }
    } finally {
      if (token === sourceEpoch.current) setBusy(false);
    }
  }

  async function loadOcelExample() {
    const token = beginSource();
    setBusy(true);
    setSourceName('Анализ синтетической базы OCEL 2.0…');
    try { await run(await buildSyntheticOcel2Example(), 'Встроенная синтетическая база OCEL 2.0', token); }
    catch {
      if (token === sourceEpoch.current) {
        setProblem('HOLD: LOCAL_OCEL2_EXAMPLE_UNAVAILABLE');
        setSourceName('Источник отклонён');
      }
    } finally {
      if (token === sourceEpoch.current) setBusy(false);
    }
  }

  async function loadSelectedT3() {
    beginSource();
    setBusy(false);
    if (!t3Controller.current) {
      setSourceName('T3 Host не подключён');
      setProblem('HOLD: T3_TRUSTED_HOST_NOT_CONNECTED');
      return;
    }
    setSourceName('Выбранная база T3 · идентификатор скрыт');
    await t3Controller.current.readSelected();
  }

  // This is only offered when the trusted owner supplies a distinct
  // signed derivation port and an empty same-principal target Workspace.
  async function stageSelectedT3() {
    if (busy || !t3Controller.current || !t3Host?.stageSelected) return;
    await t3Controller.current.stageSelected();
  }

  async function recoverSelectedT3() {
    if (busy || !t3Controller.current || !t3Host?.recoverSelected) return;
    beginSource();
    setSourceName('Проверка черновика в оригинальном T3');
    // Independent signed Kernel readback only: never redispatch stage.
    await t3Controller.current.recoverSelected();
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const token = beginSource();
    if (file.size === 0 || file.size > MAX_INPUT_BYTES) {
      setSourceName('Источник отклонён');
      setProblem('HOLD: INVALID_FILE_SIZE');
      setBusy(false);
      return;
    }
    setBusy(true);
    setSourceName('Чтение локального файла…');
    try {
      const content = await file.text();
      if (token !== sourceEpoch.current) return;
      await run(JSON.parse(content), file.name, token);
    } catch {
      if (token !== sourceEpoch.current) return;
      setPreview(null); setRisk(null); setObjectEvidence(null);
      setProblem('HOLD: INVALID_JSON_INPUT'); setSourceName('Источник отклонён');
    } finally {
      if (token === sourceEpoch.current) setBusy(false);
    }
  }

  const t3Candidates=t3Review?.status==='REVIEW'
    ? t3Review.review?.structural_candidate??[] : [];
  const candidatePages=Math.max(1,Math.ceil(t3Candidates.length/T3_CANDIDATE_PAGE_SIZE));
  const candidatePage=Math.min(t3CandidatePage,candidatePages-1);

  return <div className="app-shell" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
    <header className="topbar">
      <div className="brand">
        <img className="brand-icon" src={brandSrc} alt="IWXA" />
        <div className="brand-copy"><strong>IWXA</strong><span>Анализ деятельности</span></div>
      </div>
      <div className="topbar-right"><span className="local-status"><span className="local-dot" /> Только локально</span>
        <span className="app-version">0.1 · T3 D1/D2 / OCEL 2.0</span></div>
    </header>
    <main className="workspace">
      <section className="intro">
        <div><p className="eyebrow">САМОСТОЯТЕЛЬНОЕ ПРИЛОЖЕНИЕ IWXA</p>
          <h1>Структура деятельности <span>из фактов работы</span></h1>
          <p className="intro-text">Программа восстанавливает этапы, роли и порядок действий из накопленной базы. Никаких кейсов и описаний процессов вручную.</p>
        </div>
        <span className="status-mode">{t3Host ? 'Подключённая поверхность T3' : 'Автономный desktop'}</span>
      </section>
      <section className="two-columns">
        <aside className="source-panel">
          <div className="section-header"><span className="section-num">01</span><h2>Выбор базы</h2></div>
          <p className="panel-copy">Откройте синтетический пример либо прочитайте выбранную базу через существующий подписанный T3 Host.</p>
          <div className="source-box"><span className="source-kicker">ТЕКУЩИЙ ИСТОЧНИК</span>
            <strong title={sourceName}>{sourceName}</strong>
            <span>Исходные записи не изменяются и никуда не отправляются.</span>
          </div>
          <input className="visually-hidden" type="file" ref={fileInput} accept=".json,application/json"
            aria-label="Выбрать синтетический JSON" onChange={onFile} />
          <button className="button button-secondary" type="button" disabled={busy || t3Review?.status === 'READING'} onClick={loadSelectedT3}>
            Подключить выбранную базу T3
          </button>
          <div className="source-connection" role="status">{t3Host
            ? 'T3 Host предоставлен. Чтение требует отдельного подписанного Activity Read.'
            : 'T3 Host не подключён · чтение пользовательской базы недоступно.'}</div>
          {t3Host?.recoverSelected ? <button className="button button-secondary" type="button"
            disabled={busy || ['READING','STAGING','RECOVERING'].includes(t3Review?.status ?? '')}
            onClick={recoverSelectedT3}>Проверить сохранённый черновик T3</button> : null}
          <button className="button button-primary" type="button" disabled={busy} onClick={loadExample}>
            {busy ? 'Анализ…' : 'Открыть встроенный пример'}
          </button>
          <button className="button button-secondary" type="button" disabled={busy} onClick={loadOcelExample}>
            Открыть пример OCEL 2.0
          </button>
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
            Выбрать локальный JSON
          </button>
          <div className="warning-note">{DEMO_NOTICE}</div>
          <div className="checklist"><h3>Границы текущей версии</h3>
            <p><span className="mini-check">✓</span> Нет облака и браузерных переходов</p>
            <p><span className="mini-check">✓</span> Детерминированная реконструкция</p>
            <p><span className="mini-check">✓</span> Проверка синтетических ревизий</p>
            <p><span className={t3Host ? 'mini-check' : 'mini-pending'}>{t3Host ? '✓' : '·'}</span> T3 D1/D2 — чтение из доверенного Host при подключении</p>
            <p><span className="mini-check">✓</span> Синтетическая оценка редких маршрутов A2</p>
            <p><span className="mini-check">✓</span> OCEL 2.0: ограниченный JSON-профиль, связи объектов</p>
            <p><span className="mini-pending">·</span> Доказанная анонимность и .iwxa — HOLD</p>
          </div>
        </aside>
        <div className="work-panel">
          <div className="section-header"><span className="section-num">02</span><h2>Восстановленная деятельность</h2>
            {preview ? <span className="review-tag">ПРОВЕРЕНА СИНТЕТИКА</span> : null}
          </div>
          {problem ? <div className="error-state" role="alert"><strong>Анализ приостановлен</strong><span>{problem}</span><p>Непроверенные данные не будут превращены в процесс или пакет.</p></div> : null}
          {t3Review?.status === 'HOLD' ? <div className="error-state" role="alert">
            <strong>{t3Review.stageBlocked ? 'Сохранение T3 требует сверки' : 'Чтение T3 остановлено'}</strong>
            <span>HOLD: {t3Review.code}</span>
            <p>{t3Review.stageBlocked
              ? 'Команда записи уже отправлялась. Повтор запрещён до независимой сверки с оригинальным Kernel и новой доверенной сессии.'
              : 'Изменившееся или неподтверждённое разрешение не используется повторно.'}</p></div> : null}
          {!preview && !objectEvidence && !t3Review?.review && !problem &&
            !['HOLD','STAGING','RECOVERING','STAGED'].includes(t3Review?.status ?? '') ? <div className="empty-state"><div className="empty-icon">IX</div>
            <strong>Выберите базу для анализа</strong><p>Подтверждённая структура появится только при достаточности исходных событий и действующих правах T3. Для начала доступен встроенный синтетический пример.</p></div> : null}
          {t3Review?.status === 'READING' ? <div className="empty-state" role="status">
            <div className="empty-icon">T3</div><strong>Чтение выбранного Workspace</strong>
            <p>Доступ подтверждается T3 при каждом обращении. Источник не изменяется.</p>
          </div> : null}
          {t3Review?.status === 'STAGING' ? <div className="empty-state" role="status">
            <div className="empty-icon">T3</div><strong>Запись внутреннего черновика</strong>
            <p>Исходные данные повторно проверяются. Отдельное право Activity Derive
              и запись через оригинальный Kernel обязательны.</p>
          </div> : null}
          {t3Review?.status === 'RECOVERING' ? <div className="empty-state" role="status">
            <div className="empty-icon">T3</div><strong>Проверка сохранённого черновика</strong>
            <p>Оригинальный T3 Kernel выполняет независимое подписанное чтение.
              Новая запись не отправляется.</p>
          </div> : null}
          {t3Review?.status === 'STAGED' ? <section className="verification-panel" role="status">
            <div className="verification-left">
              <span className="eyebrow">03 · T3 · ВНУТРЕННИЙ РЕЗУЛЬТАТ</span>
              <h3>{t3Review.recovered
                ? 'Сохранённый черновик найден и проверен' : 'Черновик сохранён для проверки владельцем'}</h3>
              <p>{t3Review.recovered
                ? 'Независимое подписанное чтение оригинального Kernel подтвердило один черновик в отдельной Workspace того же владельца. Повторной записи нет. Связь этого черновика с выбранным сейчас источником не аттестована; для неё требуется исходная квитанция владельца.'
                : 'Оригинальный T3 Kernel подтвердил запись в отдельную Workspace того же субъекта.'}
                Источник не перенесён. Права на публикацию и обезличивание не установлены.</p>
            </div>
            <div className="verification-right"><span className="hold-chip">HOLD · ЭКСПОРТ ЗАКРЫТ</span></div>
          </section> : null}
          {t3Review?.status === 'REVIEW' && t3Review.review ? <>
            <section className="verification-panel" aria-label="T3 D1/D2 · структура выбранной базы">
              <div className="verification-left">
                <span className="eyebrow">03 · T3 · ДОКАЗАТЕЛЬСТВА И НЕОПРЕДЕЛЁННОСТЬ</span>
                <h3>Структура выбранной базы T3</h3>
                <p>Структурное представление получено через подключённый T3 Host. Исходные данные и полномочия проверяет сам Host; интерфейс не получает ключи, grant или Kernel.</p>
                <p className="risk-result">Статус: {t3Review.review.status}. Остаточный риск не установлен; причинность и правила решений не доказаны.</p>
                <T3EvidenceGaps review={t3Review.review} />
                <details><summary>Коды диагностики T3</summary>
                  <p>{t3Review.review.reason_codes.join(' · ')}</p></details>
              </div>
              <div className="verification-right"><span className="hold-chip">HOLD · ВЫПУСК ЗАКРЫТ</span>
                <span>Анонимность и независимый импорт .iwxa пока не подтверждены.</span>
              </div>
            </section>
            {t3Host?.stageSelected ? <div className="verification-panel">
              <div className="verification-left">
                <h3>Сохранение для внутренней проверки</h3>
                <p>Доверенный T3 Host определяет отдельную пустую Workspace по подписанному
                  праву Activity Derive. Второй выбор базы не требуется.
                  Это не публикация и не экспорт.</p>
                {t3Review.stageBlocked ? <p role="status">Сохранение уже запрашивалось в этой сессии.
                  Для следующей записи необходима независимая сверка результата
                  в оригинальном Kernel и новая подтверждённая сессия владельца.</p> : null}
              </div>
              <div className="verification-right">
                <button type="button" className="button button-secondary"
                  disabled={busy || t3Review.stageBlocked === true}
                  onClick={stageSelectedT3}>{t3Review.stageBlocked
                    ? 'Сохранение требует сверки' : 'Сохранить черновик'}</button>
              </div>
            </div> : null}
            {t3Candidates.length
              ? <section className="t3-candidates" aria-label="Структурные кандидаты T3">
                <div className="t3-candidate-nav">
                  <strong>Типы объектов и локальные переходы</strong>
                  <span>Показано {candidatePage*T3_CANDIDATE_PAGE_SIZE+1}
                    -{Math.min((candidatePage+1)*T3_CANDIDATE_PAGE_SIZE,t3Candidates.length)}
                    из {t3Candidates.length}</span>
                  {candidatePages>1 ? <div className="t3-map-pages">
                    <button type="button" aria-label="Предыдущая группа типов объектов"
                      disabled={candidatePage===0}
                      onClick={()=>setT3CandidatePage(Math.max(0,candidatePage-1))}>Назад</button>
                    <span>Страница {candidatePage+1} из {candidatePages}</span>
                    <button type="button" aria-label="Следующая группа типов объектов"
                      disabled={candidatePage===candidatePages-1}
                      onClick={()=>setT3CandidatePage(Math.min(candidatePages-1,candidatePage+1))}>
                      Далее
                    </button>
                  </div> : null}
                </div>
                <div className="graph-list">
                  {t3Candidates.slice(candidatePage*T3_CANDIDATE_PAGE_SIZE,
                    (candidatePage+1)*T3_CANDIDATE_PAGE_SIZE).map((view,index)=>
                    <T3ViewCard key={view.object_type} view={view}
                      number={candidatePage*T3_CANDIDATE_PAGE_SIZE+index+1} />)}
                </div>
              </section>
              : <p className="panel-copy" role="status">Доказательств недостаточно. Структура не восстанавливается автоматически.</p>}
          </> : null}
          {preview ? <>
            <div className="metrics">
              <div className="metric"><strong>{preview.processes.length}</strong><span>Процессов</span></div>
              <div className="metric"><strong>{preview.selected_case_count}</strong><span>Траекторий</span></div>
              <div className="metric"><strong>{preview.role_count}</strong><span>Структурных ролей</span></div>
              <div className="metric"><strong>{preview.unverified_event_count}</strong><span>Неподтверждено</span></div>
            </div>
            <div className="graph-list">{preview.processes.map((process, i) => <ProcessCard key={process.id} process={process} number={i + 1} />)}</div>
            <section className="verification-panel"><div className="verification-left">
              <span className="eyebrow">03 · КОНТРОЛЬ РЕЗУЛЬТАТА</span><h3>Проверка структуры</h3>
              <p>{preview.source_pin_count ? `${preview.source_pin_count} синтетический источник с совпадающим SHA-256. Подлинность T3 Host не подтверждена.` : 'Проверка происхождения ещё не выполнена.'}</p>
              <p className="risk-result" role="status">{risk?.status === 'HOLD'
                ? `A2: высокий или неопределённый остаточный риск · HOLD (${risk.reason_codes.join(', ')})`
                : risk?.status === 'STRUCTURE_PRESERVED_REVIEW_REQUIRED'
                  ? 'A2: структура сохранена на синтетике; повторная идентификация вне базы не исключена.'
                  : 'A2: оценка остаточного риска ещё не выполнена.'}</p>
            </div><div className="verification-right"><span className="hold-chip">HOLD · ВЫПУСК ЗАКРЫТ</span>
              <span>Анонимность не установлена. Проверка реального T3 и независимый импорт .iwxa не завершены.</span></div></section>
          </> : null}
          {objectEvidence ? <>
            <section className="verification-panel" aria-label="OCEL 2.0 · связи объектов и событий">
              <div className="verification-left">
                <span className="eyebrow">OCEL 2.0 · ВНУТРЕННЕЕ НАБЛЮДЕНИЕ</span>
                <h3>OCEL 2.0 · связи объектов и событий</h3>
                <p>Прочитан ограниченный синтетический JSON-профиль: {objectEvidence.object_type_count} типов объектов, {objectEvidence.event_type_count} классов событий, {objectEvidence.shared_event_count} общих событий.</p>
                <p>Порядок подтверждён только по времени внутри объекта. Одно событие может относиться к нескольким объектам; это не доказывает причинную связь.</p>
                <p className="risk-result">BPMN — только кандидаты; DMN и CMMN — правила и планы не установлены. W3C PROV и IWXA Standard — ещё не квалифицированы.</p>
              </div>
              <div className="verification-right">
                <span className="hold-chip">HOLD · ВЫПУСК ЗАКРЫТ</span>
                <span>Анонимность, права T3 и независимый импорт .iwxa не подтверждены.</span>
              </div>
            </section>
            <div className="graph-list">{objectEvidence.object_views.map((view, index) =>
              <ObjectViewCard key={view.id} view={view} number={index + 1} />)}</div>
            <p className="panel-copy" role="status">{objectEvidence.status === 'HOLD'
              ? 'Содержательная проверка удержана: неоднозначная или редкая структура.'
              : 'Синтетическая структура получена для изучения; остаточный риск неизвестен.'}</p>
          </> : null}
        </div>
      </section>
    </main>
    <footer className="footer"><span>IWXA · Локальная реконструкция деятельности</span><span>Исходные данные остаются у владельца · Автоматическая публикация отсутствует</span></footer>
  </div>;
}