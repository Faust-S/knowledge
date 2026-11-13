import {useLayoutEffect, useRef, useState} from 'react';
import {createT3ReviewController} from '../../modules/activity-base-anonymizer/t3-review-controller.mjs';
import type {T3ReviewHost, T3ReviewState} from '../../modules/activity-base-anonymizer/t3-review-controller.mjs';
import type {T3StructuralCandidate} from '../../modules/activity-base-anonymizer/t3-selected-host.mjs';
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


function T3ViewCard({view, number}: {view: T3StructuralCandidate; number: number}) {
  return <section className="process-card" aria-label={`Траектория T3 ${number}`}>
    <header className="process-head">
      <div><span className="eyebrow">T3 D1/D2 · НАБЛЮДЁННАЯ ДЕЯТЕЛЬНОСТЬ</span>
        <h3>Тип объекта {String(number).padStart(2, '0')}</h3></div>
      <span className="case-count">Повторяемость {view.cohort_band}</span>
    </header>
    <div className="observed-order">
      <span>Классы событий · это не порядок выполнения</span>
      <strong>{view.observed_event_kinds.join(' · ') || 'Действия не подтверждены'}</strong>
    </div>
    <div className="observed-order">
      <span>Наблюдаемые локальные переходы · не причинные зависимости</span>
      <strong>{view.object_local_successions.length
        ? view.object_local_successions.map(e => `${e.from} → ${e.to} (${e.cohort_band})`).join(' · ')
        : 'Подтверждённых переходов нет'}</strong>
    </div>
    <footer className="process-footer">
      <span>Идентификаторы субъектов и исходные события не отображаются</span>
      <span>Ни BPMN, ни DMN не подтверждены</span>
    </footer>
  </section>;
}

export function App({t3Host = null, brandSrc = '/brand.svg'}: {t3Host?: T3ReviewHost | null; brandSrc?: string}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [risk, setRisk] = useState<SyntheticRisk | null>(null);
  const [objectEvidence, setObjectEvidence] = useState<Ocel2EvidenceView | null>(null);
  const [t3Review, setT3Review] = useState<T3ReviewState | null>(null);
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

  function beginSource(): number {
    const token = ++sourceEpoch.current;
    t3Controller.current?.reset();
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
            <strong>Чтение T3 остановлено</strong><span>HOLD: {t3Review.code}</span>
            <p>Изменившееся или неподтверждённое разрешение не используется повторно.</p></div> : null}
          {!preview && !objectEvidence && !t3Review?.review && !problem &&
            !['HOLD','STAGING','STAGED'].includes(t3Review?.status ?? '') ? <div className="empty-state"><div className="empty-icon">IX</div>
            <strong>Выберите базу для анализа</strong><p>Автоматически появятся обнаруженные процессы, этапы и роли. Для начала доступен встроенный синтетический пример.</p></div> : null}
          {t3Review?.status === 'READING' ? <div className="empty-state" role="status">
            <div className="empty-icon">T3</div><strong>Чтение выбранного Workspace</strong>
            <p>Доступ подтверждается T3 при каждом обращении. Источник не изменяется.</p>
          </div> : null}
          {t3Review?.status === 'STAGING' ? <div className="empty-state" role="status">
            <div className="empty-icon">T3</div><strong>Запись внутреннего черновика</strong>
            <p>Исходные данные повторно проверяются. Отдельное право Activity Derive
              и запись через оригинальный Kernel обязательны.</p>
          </div> : null}
          {t3Review?.status === 'STAGED' ? <section className="verification-panel" role="status">
            <div className="verification-left">
              <span className="eyebrow">03 · T3 · ВНУТРЕННИЙ РЕЗУЛЬТАТ</span>
              <h3>Черновик сохранён для проверки владельцем</h3>
              <p>Оригинальный T3 Kernel подтвердил запись в отдельную Workspace того же субъекта.
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
                <p>{t3Review.review.reason_codes.join(' · ')}</p>
              </div>
              <div className="verification-right"><span className="hold-chip">HOLD · ВЫПУСК ЗАКРЫТ</span>
                <span>Анонимность и независимый импорт .iwxa пока не подтверждены.</span>
              </div>
            </section>
            {t3Host?.stageSelected ? <div className="verification-panel">
              <div className="verification-left">
                <h3>Сохранение для внутренней проверки</h3>
                <p>Нужна отдельная пустая Workspace того же владельца и подписанное
                  право Activity Derive. Это не публикация и не экспорт.</p>
              </div>
              <div className="verification-right">
                <button type="button" className="button button-secondary" disabled={busy}
                  onClick={stageSelectedT3}>Сохранить черновик</button>
              </div>
            </div> : null}
            {t3Review.review.structural_candidate?.length
              ? <div className="graph-list">{t3Review.review.structural_candidate.map((view, index) =>
                  <T3ViewCard key={view.object_type} view={view} number={index + 1} />)}</div>
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