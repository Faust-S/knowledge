# T3 G4 / D3: нативные Human Review, Kernel Apply и приёмка установленного продукта

Дата: 19.11.2026. Владелец исполняемого One Core: `Faust-S/knowledge/packages/t3-core`.
Исходный подписанный владелец Windows D3: `Faust-S/T3`.
Настольный продукт: `Faust-S/Center` (Admin Center), независимый сотрудник: `Faust-S/iwxa-personal-agent`.
Нормативный и неизменяемый T2: Kernel 0.3.6 / Runtime Contract 1.3.0.

**Статус G4:** `T3_READY=false`, `G4_ACCEPTED=false`. Не присваивать
`INSTALLED_PRODUCT_PASS` по результатам GitHub Actions для исходников.

## 1. Единственная рабочая архитектура

1. Действующий Admin Center на Windows показывает штатный `rfd::MessageDialog`
   при `d3Decide` (ACCEPT / REJECT) и **другой** диалог при
   `d3ApplyAccepted`. Отмена диалога означает отказ до вызова T3.
2. Native Rust `center_corporate_action` сравнивает исходный подписанный
   `binding` с текущей организацией и Workspace, затем пересылает конкретную
   операцию в уже запущенный оригинальный T3 D3 Host через существующий
   приватный дочерний stdin protocol. Новый RPC, IAM или Host не создаётся.
3. Исходный приватный `runInstalledOriginalAdminD3Host` допускает
   **однократное** подтверждение только в процессе исполнения ровно этой
   native-команды, сопоставляя `operationId`, `previewDigest`,
   `packageSha256`, `decision` или точные
   `acceptanceId/revisionIds/target`. Для ACCEPT совпадают подписанный
   D3 `actorId/contextId/contextEpoch`; для APPLY проверяются та же
   организация, руководитель и Workspace, но **другой** подписанный
   `grant:application`, `purpose: application` и собственный
   `scope_revision`. Эти два contextId не обязаны совпадать.
   Состояние очищается и после успешной команды, и после любого отказа;
   никакой повторной авторизации.
4. Уже существующий `port.accept/port.reject` проверяет Human Review,
   подлинный Result, исходный Task, подписанный грант и Reconciliation,
   затем возвращает настоящую квитанцию ACCEPT/REJECT. Исторический
   `d3-action` CLI не может принять решение без диалога.
5. Для отдельного Human APPLY оригинальный T3 строит sealed accepted
   application, проверяет актуальный D1 grant, наличие Workspace и
   оригинальный журнал Event, запрашивает **другое** подтверждение и только
   после него вызывает оригинальный `t1.commitObjectGraph`.
   Восстановление после неопределённого ответа является read-only:
   `getObject` и `listEventsSince`, никогда повторный Apply.
6. Agent владеет собственной Task, локальной моделью, Human Review и
   Result. Atlas не является обязательной частью D3 или универсального
   T3. Для независимых адресатов сохраняется один существующий `.iwxa`
   и принадлежащие исходным продуктам импортеры, без нового Store/Exchange.

## 2. Полученные результаты, не подменяющие установленную приёмку

Windows CI [№44404574878](https://github.com/Faust-S/knowledge/actions/runs/44404574878)
на точном исходнике `88e84a470302927a3362e93287fc4a77421e3a68`
завершился SUCCESS: **20/20**. Оригинальные подписанты T3
`b7edfeaed992563d1e2904fbd39b9e92212009ee`, Agent
`5638684ab952dffa545d8a374507f494a1a5ef2a`.

Подтверждено: производственный Admin DPAPI и отдельный ключ сотрудника;
настоящая T2 Workspace, оригинальный AccessRegistry/Object/Event;
две подписанные роли и отдельное право Task assignment; точная Task,
оригинальный Agent IPC, подписанный Result; Reconciliation и Human ACCEPT;
**отдельный** Human APPLY в исходном Windows-сценарии;
оригинальные Apply Object/Event и read-only recovery; два холодных
перезапуска браузерного процесса и те же сохранённые данные.
Доказан отказ старому CLI в Human ACCEPT без подтверждения.
Приватные 51 файл исходного T3 и 2 файла Agent использовались только
временным публичным Windows CI и удалены. Закрытые Actions не включались.

Это один Windows CI пользователь со **специально разделёнными ключами**,
а не два независимо вошедших в Windows человека. Human решения
подтверждались отдельными заранее выбранными действиями теста,
не реальным нажатием `rfd::MessageDialog` в установленном Center.
Result содержал проверяемые тестовые сведения, не подтверждённую
модельную работу установленного Agent. Холодный перезапуск браузера
не означает перезапуск установленных Tauri/Host.

## 3. Обязательная установленная приёмка (следующая работа)

1. Собрать один установленный Admin Center из актуального Center owner,
   оригинального приватного T3 и **того же** квалифицированного T2 One Dist.
   Проверить штатный System-DPI Windows UI, Tauri окна и Rust диалоги.
2. Реально нажать `Отмена` для ACCEPT и APPLY: оба должны отказать
   **до** Reconciliation/Kernel без нового принятия и без побочных записей.
   Затем подтвердить **именно выбранные** Result, digest и редакции.
   Повторная/чужая команда не вправе использовать старый диалог.
3. Создать настоящего сотрудника под другой учётной записью Windows.
   Его Agent обязан держать собственный DPAPI vault и собственный
   Task/Result; приватный issuer/manager ключ не может оказаться в Agent.
4. Выполнить один реальный модельный Task в установленном Agent:
   локальная модель, настоящий пользовательский Human Review, один
   адресованный подписанный `.iwxa`; установка, холодное восстановление
   и отсутствие повторной выдачи Result.
5. В Admin Center реально получить Result: проверить подпись и
   правомочия, открыть весь Result, выполнить отдельный ACCEPT,
   прочитать исходную квитанцию после перезапуска и **другим кликом**
   APPLY. Проверить физический original Kernel Object/Event и
   два независимых холодных процесса оригинального Host.
6. При потере ответа Apply не делать новую запись: открыть исходный
   Kernel read-only и восстановить точные Object/Event/receipt.
   Все отказы, просроченные/отозванные grants, неверные Task revision,
   другой адресат, чужая организация, подменённый Result должны
   завершиться отказом без незапрошенного Kernel commit.
7. После D3 отдельно квалифицировать универсальные D1–D7:
   автономный D5 с реальной WebGPU/холодным офлайном, generic D6
   с любым авторизованным предметным получателем без Atlas,
   PERSON D7 с оригинальным Publisher и native recipient.
   Не назначать Atlas обязательным контроллером технологии T3.

## 4. Граница публикации

Сборка домена для хостинга должна воспроизводиться из **одного
site-репозитория домена**, с закреплённым выпуском T3, без обязательного
считывания разработческого репозитория T2/T3 при каждом обычном build.
Не копировать закрытый `dist/`, исходники, приватные ключи или токены
в публичный `knowledge` и GitHub artifacts. Публичные GitHub Actions
для полноценных проверок, приватные Actions запрещены. Оригинальный
T2 нормативный HEAD/сборку не изменять.

## 5. Проверенный установленный Windows-пакет (19.11.2026)

Причина предыдущей остановки была сборочной: архив квалифицированного
T2 Kernel не содержал исходный предметный domain.json, Workspace и паспорт.
Admin Center теперь определяет собственный T2-профиль; действующий One Core
включает квалифицированные Kernel 0.3.6 / Contract 1.3.0 без изменения байтов.
Отдельный desktop control-only профиль не включает неполный BLI Worker;
обычная строгая браузерная D5-сборка не ослаблена.

- [Windows #44411947163](https://github.com/Faust-S/knowledge/actions/runs/44411947163):
  оригинальный приватный подписант T3, нативный Center и Setup Core
  собраны; установка, SHA-256 подписанта и наличие оригинального
  Kernel в установленном каталоге подтверждены. Раннее чтение WebView2
  UIA дало FAIL и потребовало исправления ожидания.
- [Windows #44413171459](https://github.com/Faust-S/knowledge/actions/runs/44413171459):
  повторная реальная установка, React-кнопки из установленного WebView2,
  штатное закрытие HWND через WM_CLOSE, создание обычной Workspace
  без Atlas: PASS. Продолжение onboarding не принято.
- [Windows #44414668010](https://github.com/Faust-S/knowledge/actions/runs/44414668010):
  обычная Workspace PASS, явный вызов сохранения и переход к результатам
  выполнены, кнопка подключения найдена. Нативный диалог при первом
  подключении не обнаружен (FIRST_USE_NATIVE_MESSAGE_DIALOG_MISSING).
  Это не доказательство ошибки криптографического подписанта: в
  Center перед подключением установлен запрет, если сохранение черновика
  ещё выполняется.
- [Windows #44416173411](https://github.com/Faust-S/knowledge/actions/runs/44416173411):
  выполняется повтор с обязательным наблюдаемым подтверждением
  сохранения, независимой проверкой появившегося модального окна
  и точными кодами отказа, без маскировки причин очисткой процесса.

Поставка age v1.3.2 продолжает проверять исходный архив SHA-256.
Отдельно проверена каноническая LICENSE из исходного тега v1.3.2,
а не случайная копия из ZIP, формат которой мог отличаться.

**Статусы на последней завершённой установленной проверке:**
- NATIVE_OWNER_REAL_T2_KERNEL_SOURCE_PASS.
- INSTALLED_SETUP_CORE_AND_NATIVE_WEBVIEW_GUI_PASS.
- INSTALLED_ORDINARY_WORKSPACE_NO_ATLAS_PASS.
- INSTALLED_D3_ENROLL_AND_COLD_RESTART_HOLD.
- INSTALLED_HUMAN_ACCEPT_APPLY_NOT_RUN.
- CROSS_PRODUCT_G4_NOT_ACCEPTED; T3_READY=false.

Нативное подключение организации, независимые Windows-пользователи,
Human ACCEPT и отдельно подтверждённый Apply через оригинальный T2
Kernel/Object/Event, read-only recovery, D5, generic D6 и D7 не
заменяются успешной установкой или Source PASS.


## 6. Установленный Native D3: найден реальный дефект аргументов (19.11)

Windows [#44505177227](https://github.com/Faust-S/knowledge/actions/runs/44505177227)
прошёл сборку original T2 One Dist, настоящий Setup Core, WebView2,
отдельную Workspace без Atlas и локальный readback черновика.
**Два Windows диалога** `IWXA T3: подключить организацию`
были обнаружены из реального установленного Center (PID bound).
Первый настоящий клик NO закрыл модальное окно и сохранил
`NOT_CONNECTED`; второй настоящий клик YES также закрыл диалог.
После этого интерфейс не получил подписанного Owner и выдал
канонический код **`T3_PRODUCT_COMPONENT_ARGUMENTS_INVALID`**.

Проверка исходного `Faust-S/Center/native/t3_product_component.rs`
выявила **причину до запуска original T3 EXE**:
общий список допустимых CLI action допускал ASCII `[a-z-]`,
но собственная корпоративная операция называется `d3-enroll`.
Цифра `3` всегда приводила к отказу. Это не дефект подписей,
не отсутствие DPAPI, не ошибка оригинального Kernel и не основание
перестраивать T3.

Исправление в [Center `cbad39d9`](https://github.com/Faust-S/Center/commit/cbad39d9d06e6f7c3c18abdc285bc1569c557976):
допускаются ASCII цифры **после первого символа** action.
Сохранены лимит длины, разрешённый алфавит, типизированные
argv без запуска Shell, запрет пробелов, Unicode, путей и
управляющих символов. Добавлены адресные Rust регрессии.

Повторный публичный установленный Windows CI
[#44507093613](https://github.com/Faust-S/knowledge/actions/runs/44507093613)
запущен на `knowledge@381e7fd2` с оригинальным Center `cbad39d9`,
T3 `ea1700ec`, T2 Kernel 0.3.6 / Contract 1.3.0.
**Фактический итог и подписанное cold readback обязательно
проверять по завершённому CI**. До результатов:
`INSTALLED_NATIVE_ENROLL_READY=HOLD`,
`INSTALLED_HUMAN_ACCEPT_APPLY=NOT_RUN`,
`T3_READY=false`.

## 7. Установленный Owner: итоговая независимая холодная квалификация (19.11.2026)

Завершённый [Windows CI №44537675979](https://github.com/Faust-S/knowledge/actions/runs/44537675979) = **SUCCESS** на точных `knowledge@6ad3a3e5`, оригинальном `T3@b8974044`, `Center@2628c4bc`.

Получены реальные `G4_INSTALLED_FIRST_USE_NATIVE_WINDOWS_ENROLL_PASS`, `G4_INSTALLED_COLD_MANAGER_DRAFT_INDEPENDENT_DISK_READBACK_PASS`, `G4_INSTALLED_COLD_OWNER_REQUIRED_FILE_COUNT 5`, `G4_INSTALLED_COLD_ORIGINAL_DPAPI_INDEPENDENT_PROCESS_PASS`, `G4_INSTALLED_FIRST_USE_ORIGINAL_DPAPI_COLD_RESTART_PASS`. Установка One Dist / Setup Core, native WebView2, реальный Windows-dialog CANCEL/YES и Workspace без Atlas тоже PASS.

Таким образом **первичная производственная регистрация Admin Owner и его независимое DPAPI cold readback завершены**. Ранние HOLD на регистрацию и холодное восстановление в разделах выше являются историческими.

**Ограничение:** это ещё не установленный маршрут двух независимых Windows-пользователей Agent -> оригинальный подписанный Result -> отдельный native ACCEPT -> отдельный native APPLY -> исходный Kernel Object/Event -> два холодных readback. Такой маршрут по-прежнему `NOT_ACCEPTED`. Сохраняются `G4=NOT_ACCEPTED`, `T3_READY=false`.

Единая актуальная оценка: [T3 G4 ecosystem readiness audit](T3_G4_ECOSYSTEM_RELEASE_READINESS_AUDIT_2026_11_19_RU.md). Машинный реестр содержит отдельный принятый `D3_INSTALLED_ADMIN_OWNER_ENROLL_AND_DPAPI_COLD`, но не повышает весь D3 или G4.

## 8. Подлинный центральный Agent Core / исходный D3 PASS, 19.11.2026

Публичный [Windows CI №44571096678](https://github.com/Faust-S/knowledge/actions/runs/44571096678) завершён **SUCCESS (23/23 маркера)**. Это текущая доказанная квалификация центрального `Agent 0.6@dff16da239882582d305a7fb4fc429ef7d58be3a` против исходного подписанного `T3@1a8267634955947bc0c6adc5614d7de176a33da2`. Нормативный T2 не изменялся.

Отказ `T3_AGENT_ACCEPTED_SOURCE_PROOF_REQUIRED` исправлен правильно: вместо искусственного текста исходный драйвер проводит подписанную Task через штатный `DailyDriverEngine` и реальную локальную `Qwen3 0.6B` (наблюдаемый Ollama и проверенные веса); затем получает сохранённый Result, явный исходный Human Review, проверенный accepted digest и передаёт результат штатному `OriginalEmployeePort.prepare`. Исходный T3 подписывает `.iwxa`; проверены оригинальная регистрация сотрудника, DPAPI, подписанный результат, отдельные исходные ACCEPT/APPLY, Kernel Object/Event, два холодных процесса и запрет второго экспорта.

В самом Agent восстановлено делегирование `employee_first_use`, `employee_candidate`, `employee_proof` на оригинальный модуль `native-employee-d3.mjs`. Никаких вторых Vault/Signer/Registry/Kernel/Exchange не введено.

**Строгий уровень:** `NATIVE_PROCESS_SOURCE_PASS_NOT_INSTALLED_GUI`. Проверка исходного Human Review/ACCEPT/APPLY выполняет явно запрограммированные операции, а не клики реальных людей; независимый второй Windows user SID и установленный Agent GUI не проверены. Поэтому `INSTALLED_PRODUCT_PASS` и G4 всё ещё **HOLD**. Следующий приоритет: под двумя Windows-пользователями воспроизвести установленный нативный Agent → Admin Center с физическими отдельными Human ACCEPT и APPLY, затем два независимых холодных readback оригинального T2. Не обходить этот этап маркировкой source CI как продуктовой приёмки.
