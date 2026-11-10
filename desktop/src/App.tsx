import {useRef, useState} from 'react';
import {ActivityHold, analyzeSnapshot, buildSyntheticExample} from '../../modules/activity-base-anonymizer/engine.mjs';
import type {Preview, ProcessGraph} from '../../modules/activity-base-anonymizer/engine.mjs';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const DEMO_NOTICE = 'Демонстрационный режим: только синтетические снимки. Реальные базы T3 пока недоступны.';

function ProcessCard({process, number}: {process: ProcessGraph; number: number}) {
  return <section className="process-card" aria-label={`Процесс ${number}`}>
    <header className="process-head">
      <div><span className="eyebrow">ВОССТАНОВЛЕННАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ</span>
        <h3>Процесс {String(number).padStart(2, '0')}</h3></div>
      <span className="case-count">{process.trace_count} траектории</span>
    </header>
    <div className="stages" role="list" aria-label="Зафиксированные этапы">
      {process.states.map((stage, index) =>
        <div className="stage" role="listitem" key={stage.id}>
          <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
          <div className="stage-detail">
            <strong>Этап {String(index + 1).padStart(2, '0')}</strong>
            <span>{stage.roles.length ? stage.roles.map((role) => `Роль ${role.split('_')[1]}`).join(' · ') : 'Роль не подтверждена'}</span>
          </div>
          <span className="stage-state">Наблюдался</span>
        </div>)}
    </div>
    <footer className="process-footer">
      <span>{process.observed_successions.length} последовательных переходов</span>
      <span>Порядок действий ≠ причинная зависимость</span>
    </footer>
  </section>;
}

export function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sourceName, setSourceName] = useState('Источник не выбран');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function run(input: unknown, label: string) {
    setBusy(true);
    setPreview(null);
    setProblem('');
    try {
      const result = await analyzeSnapshot(input);
      // Do not persist, render, log, transfer or export internalEvidence/source data.
      setPreview(result.preview);
      setSourceName(label);
    } catch (error) {
      const code = error instanceof ActivityHold ? error.code : 'INVALID_SYNTHETIC_SNAPSHOT';
      setProblem(`HOLD: ${code}`);
      setSourceName('Источник отклонён');
    } finally { setBusy(false); }
  }

  async function loadExample() {
    setBusy(true);
    setProblem('');
    try { await run(await buildSyntheticExample(), 'Встроенная синтетическая база'); }
    catch { setProblem('HOLD: LOCAL_SYNTHETIC_EXAMPLE_UNAVAILABLE'); setBusy(false); }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size === 0 || file.size > MAX_INPUT_BYTES) {
      setPreview(null); setProblem('HOLD: INVALID_FILE_SIZE'); return;
    }
    setBusy(true); setProblem('');
    try { await run(JSON.parse(await file.text()), file.name); }
    catch { setPreview(null); setProblem('HOLD: INVALID_JSON_INPUT'); setBusy(false); }
  }

  return <div className="app-shell" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
    <header className="topbar">
      <div className="brand">
        <img className="brand-icon" src="/brand.svg" alt="IWXA" />
        <div className="brand-copy"><strong>IWXA</strong><span>Анализ деятельности</span></div>
      </div>
      <div className="topbar-right"><span className="local-status"><span className="local-dot" /> Только локально</span>
        <span className="app-version">0.1 · A1 prototype</span></div>
    </header>
    <main className="workspace">
      <section className="intro">
        <div><p className="eyebrow">САМОСТОЯТЕЛЬНОЕ ПРИЛОЖЕНИЕ IWXA</p>
          <h1>Структура деятельности <span>из фактов работы</span></h1>
          <p className="intro-text">Программа восстанавливает этапы, роли и порядок действий из накопленной базы. Никаких кейсов и описаний процессов вручную.</p>
        </div>
        <span className="status-mode">Синтетическая квалификация</span>
      </section>
      <section className="two-columns">
        <aside className="source-panel">
          <div className="section-header"><span className="section-num">01</span><h2>Выбор базы</h2></div>
          <p className="panel-copy">Загрузите локальный синтетический снимок или откройте встроенный пример.</p>
          <div className="source-box"><span className="source-kicker">ТЕКУЩИЙ ИСТОЧНИК</span>
            <strong title={sourceName}>{sourceName}</strong>
            <span>Исходные записи не изменяются и никуда не отправляются.</span>
          </div>
          <input className="visually-hidden" type="file" ref={fileInput} accept=".json,application/json"
            aria-label="Выбрать синтетический JSON" onChange={onFile} />
          <button className="button button-primary" type="button" disabled={busy} onClick={loadExample}>
            {busy ? 'Анализ…' : 'Открыть встроенный пример'}
          </button>
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
            Выбрать локальный JSON
          </button>
          <div className="warning-note">{DEMO_NOTICE}</div>
          <div className="checklist"><h3>Границы текущей версии</h3>
            <p><span className="mini-check">✓</span> Нет облака и браузерных переходов</p>
            <p><span className="mini-check">✓</span> Детерминированная реконструкция</p>
            <p><span className="mini-check">✓</span> Проверка синтетических ревизий</p>
            <p><span className="mini-pending">·</span> Реальное подключение T3 — далее</p>
            <p><span className="mini-pending">·</span> Обезличивание и .iwxa — HOLD</p>
          </div>
        </aside>
        <div className="work-panel">
          <div className="section-header"><span className="section-num">02</span><h2>Восстановленная деятельность</h2>
            {preview ? <span className="review-tag">ПРОВЕРЕНА СИНТЕТИКА</span> : null}
          </div>
          {problem ? <div className="error-state" role="alert"><strong>Анализ приостановлен</strong><span>{problem}</span><p>Непроверенные данные не будут превращены в процесс или пакет.</p></div> : null}
          {!preview && !problem ? <div className="empty-state"><div className="empty-icon">IX</div>
            <strong>Выберите базу для анализа</strong><p>Автоматически появятся обнаруженные процессы, этапы и роли. Для начала доступен встроенный синтетический пример.</p></div> : null}
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
            </div><div className="verification-right"><span className="hold-chip">HOLD · ВЫПУСК ЗАКРЫТ</span>
              <span>Оценка остаточного риска и независимый импорт .iwxa ещё не завершены.</span></div></section>
          </> : null}
        </div>
      </section>
    </main>
    <footer className="footer"><span>IWXA · Локальная реконструкция деятельности</span><span>Исходные данные остаются у владельца · Автоматическая публикация отсутствует</span></footer>
  </div>;
}