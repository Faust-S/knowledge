# IWXA T3 G4: передача после принятой регистрации Admin и выравнивания оригинального подписанта

Дата: **19 ноября 2026 года**. Главная цель: законченный единый автономный G4, не новый архитектурный цикл.
**Текущее решение до всех обязательных installed gates: `T3_READY=false`, `G4=NOT_ACCEPTED`.**

## 0. Первые обязательные действия следующего чата

1. **Полностью прочитать этот документ**, `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection/AGENTS.md`, `packages/t3-core/handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`, `packages/t3-core/docs/T3_G4_D3_NATIVE_HUMAN_DECISIONS_AND_PRODUCT_GATE_2026_11_19_RU.md`, `packages/t3-core/docs/T3_G4_ECOSYSTEM_RELEASE_READINESS_AUDIT_2026_11_19_RU.md`.
2. **Самое первое инженерное действие**: проверить сохранённые факты и актуальный Agent Core. Установленный Admin [#44559119290](https://github.com/Faust-S/knowledge/actions/runs/44559119290) SUCCESS, оригинальный D3 Owner source [#44559119612](https://github.com/Faust-S/knowledge/actions/runs/44559119612) 15/15 PASS, исторический private Agent native [#44559119398](https://github.com/Faust-S/knowledge/actions/runs/44559119398) 20 маркеров PASS. **Текущий центральный Agent** `c347ab77`: Linux и Windows Python [#44561398289](https://github.com/Faust-S/knowledge/actions/runs/44561398289) 11/11 PASS, но native Node/Python [#44561386251](https://github.com/Faust-S/knowledge/actions/runs/44561386251) FAIL на `T3_AGENT_ACCEPTED_SOURCE_PROOF_REQUIRED` после успешного канонического чтения Task. **Приоритет именно этот**, а не ещё один цикл установки Admin. Не обходить fail-closed запрет поддельного Result.
3. Сверить live HEAD/TREE `Faust-S/knowledge`, `Faust-S/T3`, `Faust-S/Center`, `Faust-S/iwxa-personal-agent`, нормативного `Faust-S/T2@main`; открыть актуальный код и точные `AGENTS.md` частных владельцев прежде чем писать.
4. При PASS сохранить каждое доказательство отдельно в машинном реестре с точной ревизией. При FAIL исправить реальную причину в исходном владельце и повторить только нужную проверку. G4 не повышать преждевременно.

## 1. Неприкосновенная архитектура

- **Единственный исполняемый T3:** `Faust-S/knowledge/packages/t3-core`, наследует оригинальный нормативный **T2 Kernel 0.3.6 / Runtime Contract 1.3.0**. `Faust-S/T3` хранит **существующего оригинального подписанного владельца** Access, DPAPI, Reconciliation и корпоративный native D3; это не второй T3 Kernel/Store/Host.
- Никаких вторых Kernel/Host/Store/Workspace/Exchange/IAM, Router, Task Engine, формата `.iwxa` и самостоятельного Control EXE.
- **Atlas факультативен**: его функции подключаются к Agent или Admin как отдельная программа; простая Task/Result и универсальный D6_GENERIC работают без Atlas/WorkRef.
- Admin Center владеет организационными решениями, Agent собственным исполнением/локальной моделью/Human Review/Result, Publisher лицензиями, Activity разрешёнными производными данными, домены своими предметными действиями и хранилищем исходного T2.
- Публичные GitHub Actions только `Faust-S/knowledge`. Private Actions запрещены. Приватные исходники/токены/EXE/дистрибутивы/подписанные файлы/DPAPI-ключи/полные stderr в публичные artifacts/logs не отдавать; временный точный read-only и обязательная очистка.
- Codex только для недоступных операций и независимой окончательной приёмки, без Chromium/Playwright/Puppeteer в Codex; всё доступное самостоятельно.

## 2. Принятый установленный Admin D3: не повторять архитектурный цикл

**Windows [#44537675979](https://github.com/Faust-S/knowledge/actions/runs/44537675979) = SUCCESS**, код `knowledge@6ad3a3e5d5bca0d091503a275a4d786e48524a97`, оригинальный `T3@b897404432cec18144942758d296c19d76232f55`, `Center@2628c4bc1b20b4393c485d12513f029fdea8b082`.

Фактически пройдены:
- оригинальный T2 One Dist, подписанный Owner, Setup Core, настоящий WebView2 GUI и обычная Workspace **без Atlas**;
- Native UIA строго подтверждает значение полей, сохранение черновика и его физическое чтение;
- физический Windows NO отмены, затем отдельный YES и исходный `D3_OWNER_READY`;
- `G4_INSTALLED_COLD_MANAGER_DRAFT_INDEPENDENT_DISK_READBACK_PASS`;
- `G4_INSTALLED_COLD_OWNER_REQUIRED_FILE_COUNT 5`;
- `G4_INSTALLED_COLD_ORIGINAL_DPAPI_INDEPENDENT_PROCESS_PASS`;
- `G4_INSTALLED_FIRST_USE_ORIGINAL_DPAPI_COLD_RESTART_PASS`.

ЭТОТ gate принят как `D3_INSTALLED_ADMIN_OWNER_ENROLL_AND_DPAPI_COLD=PASS`, **не** как полный межпродуктовый D3, не как настоящий APPLY или G4.

## 3. Прогресс текущего чата: реальные исправления и проверка ревизий

**Найден релизный дефект проверки**: native Agent Node/Python квалифицировался на `T3@d0d8ba2f`, private source suite на `T3@19be10c5`, а установленный Admin использовал `T3@b8974044`. Успех исходного Agent не доказывал совместимость с тем же текущим подписантом.

Исправлены в публичном `knowledge`:
- `packages/t3-core/scripts/qualify-native-corporate-agent-process.mjs`: оригинальный Agent подписант теперь имеет общий явный source pin;
- `packages/t3-core/scripts/qualify-original-private-d3-owner.mjs`: исходный Owner также закреплён на том же signer SHA; исправлен устаревший комментарий о чтении доменного JSON как файла, который теперь статически импортируется в Bun EXE;
- `packages/t3-core/tests/g4-native-original-owner-pin-parity.test.mjs`: новый проверяемый fail-closed тест совпадения исходного Agent source, private source suite и установленного Admin Owner;
- `.github/workflows/t3-native-original-employee.yml` и `.github/workflows/t3-original-private-owner.yml`: проверка совпадения SHA **до приватной загрузки**; все workflows opt-in и в публичном знании.

Первый реальный прогон на оригинальном production Owner `b8974044`:
[Windows #44557711931](https://github.com/Faust-S/knowledge/actions/runs/44557711931) **SUCCESS**.
- Pin-parity 2/2 PASS.
- Original private T3 51 bounded files, Agent 2 bounded files.
- **20 оригинальных G4-маркеров PASS**: separate signed employee, Task/Result через подлинный Node/Python IPC, Admin ACCEPT, original Kernel APPLY, два холодных исходных Kernel Object/Event readback, recovery и no-replay.
- Уровень **SOURCE_NAT​IVE_PROCESS_PASS**, это **не** установленный independent Agent Tauri, не настоящий отдельный OS Human ACCEPT/APPLY.

При следующей сверке приватного исходного Owner на том же `b8974044` [#44558118653](https://github.com/Faust-S/knowledge/actions/runs/44558118653) показал **14/15 PASS**: тест #2 был историческим. Оригинальная защита `createOriginalAdminD3HostPort().nativeAction(d3Decide)` уже правильно вызывает `port.accept/reject` и `confirmHumanReview`, но старый приватный тест всё ещё требовал `decisions===0`, тем самым противоречил безопасной реализации. **Исправлен тест у владельца**, не ослаблялись подписи и Human consent:
`Faust-S/T3@1a8267634955947bc0c6adc5614d7de176a33da2` (`tests/admin-original-host-port.test.mjs`), теперь явный one-shot тестовый Human challenge точно связывает `decision`, `packageSha256`, `previewDigest`, `operationId`, `actor` и подтверждается ровно один раз. Это source test harness, **не** замена native Win32 consent.

Все три независимых публичных qualification workflow заново закреплены на `T3@1a826763...` и совместно запущены коммитом `knowledge@b9fa8acf6a5c3667f7fc368f931a526e474161e8`. **Фактические результаты:** original signed Owner source #44559119612 = 15/15 PASS, native employee/Kernel #44559119398 = все 20 этапов PASS. Оригинальный T3 `b8974044 → 1a826763` изменил **только** `tests/admin-original-host-port.test.mjs` (1 commit, 14 additions/1 deletion), производственные файлы подписанта/Kernel не изменялись. Installed Admin #44559119290 подлежит отдельной финальной сверке. Установленный Admin-исходник Center остался неизменным, выпускная граница unchanged.

## 4. Открытые реальные product gates (строгий порядок)

1. **Установленный Agent под другим Windows OS-пользователем**: настоящий Tauri Agent 0.6 с оригинальным подписанным employee credential и собственным DPAPI data root; реальная модель генерирует Task Result, пользователь делает Human Review; оригинальный подписанный `.iwxa` направлен Admin. Показать его восстановление после полного закрытия Agent. Проверка на одном CI Windows-пользователе с несколькими раздельными TEST-ключами не заменяет этот этап.
2. **Установленный Center**: независимо получить Result, сверить источник Task и ревизии, подлинный grant, полноценный Result и применимость; отдельный реальный Win32 Human ACCEPT; исходный signed receipt и холодное чтение; **другой** Win32 Human APPLY с актуальным оригинальным правом. Вызвать **только оригинальный `t1.commitObjectGraph`** и прочитать полный Kernel Object/Event двумя новыми холодными процессами. Потерянное ACK = `OUTCOME_UNKNOWN`, только read-only recovery, никакой новой попытки Apply.
3. **D6_GENERIC без Atlas**: один настоящий независимый предметный получатель исходного разрешённого Result, собственное предметное действие, исходный Kernel/receipt, две холодные проверки. Отдельно можно проверить Atlas 0.9 как опционального получателя через его собственный U05 CAS, но это не обязательный универсальный gate.
4. **D7_PERSON**: установленный Publisher с существующим original T3 signer/age и независимым адресатом, реальные issue/renew/STATUS/revoke и cold readback; тестовые TEST-лицензии не подменяют PERSON.
5. **D5**: аппаратный Apple Metal source WebLLM/offline два поколения [#44340207574 attempt 2](https://github.com/Faust-S/knowledge/actions/runs/44340207574) уже есть. Требуется финальная автономная установка модели и холодный offline Host/browser в закреплённом site-release. Не запускать hardware CI без предметного изменения.
6. Только после этого **G4 release candidate**, machine evidence, независимая приёмка и поэтапное повышение T3 в доменах.

## 5. Смежные рабочие исходники (HEAD на момент передачи, перепроверить)

- `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection`: исходный installed/source pin commit `b9fa8acf6a5c3667f7fc368f931a526e474161e8`, затем документация/машинный реестр могут изменить HEAD; брать live HEAD/TREE.
- `Faust-S/T3@work/2026-11-16-admin03-independent-employee-owner`: `1a8267634955947bc0c6adc5614d7de176a33da2`.
- `Faust-S/Center@work/2026-11-18-admin03-generic-d3-lazy-atlas`: `2628c4bc1b20b4393c485d12513f029fdea8b082`.
- `Faust-S/iwxa-personal-agent@work/2026-11-15-agent-0-6-development`: `c347ab776bc25634e81855db864edb098c083aa5` (центральный original employee Task binding fixed, native accepted-source proof ещё HOLD). Отдельный original D3-employee source `work/2026-11-16-agent06-corporate-t3-d3-current@5638684ab952dffa545d8a374507f494a1a5ef2a`; D6 candidate `work/2026-11-16-agent06-original-t3-result-owner-d6@34d8f1a10b552f1d0c4108e012414648e71ce0a0`. Не делать слепой merge в общую Agent-ветку.
- `Faust-S/T2@main 9c64951cd78411283e8a416641c36d71e169fc1d` (normative Kernel 0.3.6/Runtime Contract 1.3.0).
- `Faust-S/Atlas@work/2026-11-16-atlas-0-9-t3 19ea3d228c585a1c50e749632c2f2df1a71c7c33` (опциональный).
- Publisher в `Faust-S/Center@work/2026-11-10-publisher-0.5 3397d4d7e599760a07662e766ed3e4cf6ecc2a23`.
- Activity `Faust-S/knowledge@work/2026-11-10-activity-base-anonymizer 2383c58f88901f16aa2a5fa780de447dba3d4750`.

## 6. Домены и релизная дисциплина

T2 product-first сервисы завершать параллельно, **не ждать** G4. T3 в D01–D11 пока только по одному сайту и отдельной пилотной ветке. D02 `Faust-S/club.iwxa.ru@work/2026-11-11-d02-t3-domain-autonomy` ещё требует внешние `IWXA_T3_CORE_SOURCE_DIR` и `IWXA_T3_BLI_SOURCE_DIR` при candidate build; это **не** автономный production `dist/`. Финальная обычная сборка должна выполняться **из одного site checkout**, с хешированными принятыми T3 артефактами в web repo, без обязательного обращения к репозиториям разработчиков. Русские версии и `main` изменять только по отдельному поручению.

**Граница прав:** пользовательская производственная подпись и реальный native Human consent обязательны. Нельзя подменять криптографические квитанции, тестовые одинокие процессы, отозванные права, lost-ACK recovery или installed GUI имитациями.

## 7. Последнее адресное исправление и незакрытая граница принятого Result

После первоначальных 20/20 исходных маркеров стало ясно, что они были выполнены со старым `Agent@5638684a`, а не с центральным Agent 0.6. Переход на центральный `Agent@1bf0847e` потребовал загрузить всего **5** частных файлов: `runtime/t3_original_employee_port.py`, `t3_original_employee_worker.mjs` и три его существующие статические зависимости для cold guard, original transfer readback, selected summary. Публичный `knowledge` не получил приватных исходников и не создал нового Agent/Core/Store.

**#44560730437 SUCCESS:** 11/11 Python тестов центрального Agent на Linux и Windows. **#44560718625 FAIL:** `T3_ORIGINAL_TASK_BINDING_CHANGED` при чтении правильно подписанной Task. В `runtime/t3_original_employee_worker.mjs` Agent сравнивал ожидаемые публичные `taskId/executorId` с внутренними `id/assignedTo`, хотя эти поля семантически эквивалентны.

**Исправлено у оригинального владельца:** [Agent `c347ab776bc25634e81855db864edb098c083aa5`](https://github.com/Faust-S/iwxa-personal-agent/commit/c347ab776bc25634e81855db864edb098c083aa5).
`verifiedTask` строит единственный канонический объект `organizationId,workspaceId,executorId,taskId,taskRevisionId,packageSha256,task`, сравнивает разрешённые поля **как одинаковые имена**, запрещает неизвестные ключи и сохраняет исходные signed JIT-сверки. Контроль перед сохранением Atlas .iwxa также изменён на канонические поля, не ослаблен.

**#44561398289 SUCCESS:** 11/11 обновлённого центрального Agent на Linux и Windows. **#44561386251 FAIL в более поздней точке**: `AGENT_ACCEPTED_RESULT_PROJECTION` / `T3_AGENT_ACCEPTED_SOURCE_PROOF_REQUIRED`. Это уже не дефект идентичности подписанной Task: её чтение прошло. Обнаружен **устаревший публичный G4 driver**, который отдавал Worker синтетический текст + SHA-256, хотя центральный Agent требует реальный Human-accepted Core Result с исходными `agentTaskId`, `agentResultId`, `agentResultSha256`, `acceptedDigest` и совпадающим `origin` выбранной проекции, `recipient_review_required=true`, `external_actions_performed=false`.

**КРИТИЧЕСКИ ВАЖНО:** не чинить проверку подстановкой выдуманного `source` и поддельной «принятой» проекции. Следующий инженерный шаг: вызвать **существующий Agent Core** через штатную `OriginalEmployeePort.prepare(engine, task_id, selection)`, выполнить настоящую локальную Task -> модель -> Human Review -> accepted Result, получить `task_t3_result_projection` и его реальные исходные квитанции. Только после этого подавать подтверждённый `source` в существующий original T3 employee Worker и принимать его подписанный `.iwxa`. Сохранить прежний отказ, если модельная задача/Review/доказательство отсутствуют.

Текущий полный native D3 для центрального Agent **NOT_ACCEPTED**, даже несмотря на 11/11 Python unit PASS и исторические 20/20 на старом Agent. После действительного Result снова проверить ядро/подпись/Kernel APPLY/cold readback, затем установить Agent у второго Windows OS-пользователя. Установленный Admin остается принят: [#44559119290](https://github.com/Faust-S/knowledge/actions/runs/44559119290) SUCCESS.

## 8. Короткий промпт для нового чата

Продолжай самостоятельную инженерную разработку единого автономного IWXA T3 G4 непосредственно в GitHub. **Сначала полностью прочитай этот handoff**, актуальные `AGENTS.md`, `G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`, native Human ACCEPT/APPLY contract; сверь живые HEAD/TREE T2, knowledge, T3, Center и центрального Agent. Установленный Admin Owner/DPAPI cold PASS #44559119290 на оригинальном T3 `1a826763`; owner source 15/15 PASS #44559119612. Центральный Agent `c347ab77`: Linux+Windows Python 11/11 PASS #44561398289, оригинальная подписанная Task после исправления читается, но полный native #44561386251 отказывает `T3_AGENT_ACCEPTED_SOURCE_PROOF_REQUIRED`, поскольку старый Windows witness использует синтетический Result вместо реального Agent Core Human-accepted Result. **Первая задача: исправить именно действительный маршрут Task → локальная модель → Human Review → исходный accepted Core Result → штатный OriginalEmployeePort.prepare и подписанный T3**, без подделки provenance и без второго Kernel/Store/Signer. Затем выполнить установленный Agent под второй Windows-учётной записью, отдельные настоящие native Human ACCEPT/APPLY с оригинальным Kernel Object/Event и двумя cold readback. После этого универсальные D6_GENERIC без Atlas, PERSON D7 и конечный автономный аппаратный D5. Не включать private Actions, не публиковать приватный код/установщики, Atlas остаётся факультативным. Обновляй машинный реестр только по точным PASS. `T3_READY=false`, `G4=NOT_ACCEPTED` до полного релиза.

## 9. Дополнение 20.11.2026: исходный D3 принят, установленный Agent удержан

**Этот раздел заменяет вывод об искусственном Result в разделах 7–8 как текущую точку продолжения.** Исходный дефект `T3_AGENT_ACCEPTED_SOURCE_PROOF_REQUIRED` уже исправлен и квалифицирован настоящим центральным Agent Core (реальный локальный Qwen3, Human-accepted Result, OriginalEmployeePort, оригинальные подписи/Kernel и два source-cold чтения). [Публичный Windows #44594391346](https://github.com/Faust-S/knowledge/actions/runs/44594391346) завершился **SUCCESS, 26/26 плюс итоговый маркер**. Независимые Windows SID, оригинальная DPAPI регистрация и source-криптография также подтверждены отдельными Windows-проверками, включая [#44591511936](https://github.com/Faust-S/knowledge/actions/runs/44591511936). Эти исходные испытания **не являются одной установленной операцией с физическими GUI-действиями**.

**Точные product source pins на установленном текущем D3:** `Agent@0d4196fa732b52d192ac75590715199381dfb2df`, `One Core@9fbbbd54fd0587db5c7e0e5c807b96e024ae750b`, нормативный `T2@9c64951cd78411283e8a416641c36d71e169fc1d`, исходный original `T3@1a8267634955947bc0c6adc5614d7de176a33da2`. При этом более новый `knowledge@f42e53cd28c881b2b8e04199595f9d7991f34414` квалифицирует **отдельное** исправление D6: `workRef` необязателен для обычного accepted Result, но при наличии по-прежнему требует `projectId/workId/revision` и запрещает посторонние поля. Реальный оригинальный T2 Host, Core/Node и Windows credentials: [#44620132894](https://github.com/Faust-S/knowledge/actions/runs/44620132894), **SUCCESS 3/3**. Пока установленный Agent закреплён на старой ревизии One Core, не считать D6 source-fix уже установленным.

В `Agent/config/original-t2-agent-product.json` и исходном T3 One Dist установлен **нулевой получатель по умолчанию**, не Atlas. Любой recipient требует самостоятельного подписанного D1 и явного выбора. Не создавать второй Store/Kernel/Exchange/систему ролей.

**Найден и устранён конкретный сборочный дефект:** в публичном временном sparse checkout приватного Agent отсутствовал исходный `.gitignore`. Оригинальная загрузка U04 создавала штатные временные файлы в `build/`, но Git объявлял их 12 untracked-файлами, и правильный release guard останавливал пакет `RELEASE_WORKTREE_NOT_CLEAN`. Исправлен **состав sparse checkout**, а не отключён контроль clean/tracked. [Изолированная Windows квалификация #44611563980](https://github.com/Faust-S/knowledge/actions/runs/44611563980) **SUCCESS**: CHECKOUT, U04_FETCH, U04_STAGE, K03_FETCH, U01_FETCH все CLEAN. Приватные исходники/EXE/логи не опубликованы.

**Следующий установленный барьер:** [Windows #44611765160](https://github.com/Faust-S/knowledge/actions/runs/44611765160) подтвердил оригинальную T2/T3 One Dist сборку, нативные Tauri/Rust и Agent package manifest, реальную сборку Setup Core EXE, затем остановился с `PRIVATE_SETUP_CORE_LOCAL_ACCEPTANCE_FAILED`. Это **не** PASS установленного продукта. Добавлена диагностика только канонической стадии `SETUP_LOCAL_*` и конечных полей оригинального `installed-witness.json` (`status`, `phase`, `failure_code`, `last_operation`, `last_checkpoint`), без вывода приватного лога, model output или путей.

[Повторная Windows #44619450951](https://github.com/Faust-S/knowledge/actions/runs/44619450951) на диагностическом workflow `knowledge@4f28d1675af8a49fcacb9b4ee28fe70646e3a5ce` **на момент записи ещё выполняется**. Следующее обязательное действие: получить фактический conclusion и точные маркеры `G4_AGENT06_INSTALLED_WITNESS_*`, `G4_AGENT06_LOCAL_ACCEPT_SAFE_CODE` и `G4_AGENT06_LOCAL_ACCEPT_STAGE_PASS`. При неисправности исправить только доказанный дефект у штатного владельца Agent / Setup Core; не ослаблять подписанные полномочия и не удалять реальный Human Review из проверки. Повторно квалифицировать конкретный run.

**После настоящего native Agent PASS:** обновить Source pin Agent и установленного G4 workflow на новый source-qualified Core с необязательным `workRef`, повторить квалификацию одной закреплённой сборки. Затем установленный Agent под независимым вторым Windows SID, отдельные реальные Human ACCEPT и Human APPLY в Admin, оригинальный Kernel Object/Event и два cold-readback; далее D6_GENERIC к самостоятельному не-Atlas получателю, native D7_PERSON, окончательный installed/hardware D5 и независимая G4-приёмка.

Машинный источник статуса: `packages/t3-core/handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`. **`T3_READY=false`, `G4=NOT_ACCEPTED`**. Исторические SHA и FAIL разделов выше нельзя считать текущими release pins.

## 10. 20.11: новая установленная сборка после исправления authority path

**Самая свежая точка передачи на момент записи, поверх исторического раздела 9.** Новый исходный подписанный D3 на `Agent@ffa56fee6f971afa74b6b49ccfb891fca0e97225` и `One Core@f42e53cd28c881b2b8e04199595f9d7991f34414` успешно завершился: [публичный Windows CI №44622214812](https://github.com/Faust-S/knowledge/actions/runs/44622214812), **SUCCESS, 26/26 подтверждённых маркеров + `G4_NATIVE_PROCESS_SOURCE_PASS_NOT_INSTALLED_GUI`**. Подтверждены настоящая локальная Qwen3, Human-accepted Result из оригинального Agent Core, подписанный T3 архив, независимый второй SID/DPAPI исходного сотрудника, корпоративные ACCEPT/APPLY в исходном scripted scenario, оригинальный Kernel Object/Event и два холодных readback. Это не физический installed GUI под двумя SID.

Исходная причина предыдущего отказа установленного Agent наконец установлена точным OS/witness наблюдением: [#44619450951](https://github.com/Faust-S/knowledge/actions/runs/44619450951) создал Setup Core, прошёл Qwen/Task/Human Review и `AGENT_REAL_QWEN_IWXA_EXPORT_INSPECT_PASS`, но возвращал `SETUP_LOCAL_WITNESS_EXIT_FAILED` в фазе `QWEN_EXECUTE` **после уже успешного signed Exchange inspect**. У штатного `tools/qualify_setup_core_runtime.ps1` были устаревшие относительные пути `LOCALAPPDATA\IWXA\current-install.json` и `...\storage-authority.json`; их фактический оригинальный владелец `runtime/windows_install_paths.py` использует `LOCALAPPDATA\IWXA\PersonalAgent\current-install.json` и `...\storage-authority.json`. Поэтому хороший Result отвергался проверочным readback-маршрутом после успешного архивного inspect.

Исправлено **в исходном Agent, не в CI на основании фиктивных данных:** [`34c30f77`](https://github.com/Faust-S/iwxa-personal-agent/commit/34c30f7767235373b446ce0937d0bb49baa60ade) обновил пять путей проверочного witness до продуктово-изолированного канонического владельца, сохранил read-only сравнение хешей настоящих пользовательских authority и **дополнительно** защитил оба старых `IWXA\*.json` legacy-пути. Отдельная исходная регрессия [`a703fdf6`](https://github.com/Faust-S/iwxa-personal-agent/commit/a703fdf6207b2f8e5d10c14d953a220c59935758) сравнивает witness с оригинальными `current_install_path/storage_authority_path`. Agent `ffa56fee` дополнительно пинит исходно-квалифицированный универсальный D6 One Core `f42e53cd` вместо предыдущего среза. Исходная схема D6 (без обязательного Atlas WorkRef) проходит [#44620132894](https://github.com/Faust-S/knowledge/actions/runs/44620132894), **Node/Core, original Host и Windows credentials SUCCESS**.

**Именно сейчас необходимо получить итог [публичного установленного Windows CI №44622054312](https://github.com/Faust-S/knowledge/actions/runs/44622054312)** (на момент записи идёт настоящая Tauri/Setup Core Agent 0.6 локальная Qwen Native GUI и cold acceptance). На точном `knowledge@4b85a9fb` и source `Agent@ffa56fee`, `Core@f42e53cd`. Проверить только ограниченные маркировки `G4_AGENT06_INSTALLED_*`, `G4_AGENT06_LOCAL_ACCEPT_*`, без публичного раскрытия приватных логов/исходников/EXE. В следующей публичной корректировке preflight улучшено буквальное сравнение путей через `[regex]::Matches` ([`7a1b9b3f`](https://github.com/Faust-S/knowledge/commit/7a1b9b3f70306641786ee7c903485985004d194a)); это изменение после начала текущего run и не относится к его exact SHA.

Если установленный run PASS, отдельно записать точные маркеры Installed Setup + native WebView2 GUI + Human Review + Qwen3 Result + повторный запуск/Repair/Rollback. Не повышать full D3: следующий этап объединить **одну** физическую операцию установленного Agent **под вторым OS SID** с установленным Admin Center, раздельными настоящими Human ACCEPT и APPLY, оригинальным Kernel Object/Event и двумя холодными чтениями. Не объединять исходные успешные CI механическим подсчётом.

**Статус до завершения установленного прогона:** `T3_READY=false`, `G4=NOT_ACCEPTED`, `D3_SOURCE=PASS`, `D3_INSTALLED_PRODUCT=HOLD`, `D6_GENERIC_SOURCE=PASS`, `D6_GENERIC_INSTALLED=HOLD`, `D7_PERSON=HOLD`, `D5_FINAL_INSTALLED_HARDWARE=HOLD`. Машинный источник статуса: `packages/t3-core/handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`. Приватные Actions запрещены.

## 11. 20.11: installed Agent дошёл до GUI Human Review, запущена точная диагностика

Завершённая публичная Windows проверка [#44625025638](https://github.com/Faust-S/knowledge/actions/runs/44625025638) = **FAIL**, закреплённые Agent `ffa56fee6f971afa74b6b49ccfb891fca0e97225`, оригинальный One Core `f42e53cd28c881b2b8e04199595f9d7991f34414`. Проверены реальные исходные T2 One Dist, Tauri/Rust, package manifest и Setup Core EXE; все эти фазы REACHED. Точный machine witness: `G4_AGENT06_INSTALLED_WITNESS_STATUS FAIL`, `G4_AGENT06_INSTALLED_WITNESS_PHASE GUI_TASK_REVIEW`. Это **после** модельного и GUI Task маршрутов, но **до** подтверждённого GUI Human Review и последующего холодного результата. Не выдавать фазу за успешный Review. Два прежних флага `CURRENT_INSTALL_CREATED FALSE` и `STORAGE_AUTHORITY_CREATED FALSE` в публичном диагностическом workflow проверяли старый вложенный путь и сами по себе не доказывают отсутствие канонического авторитетного хранилища. Не переинтерпретировать их как дефект исходного Kernel.

В оригинальном приватном Agent появились только ограниченные диагностические уточнения:
- `d7c6b971de73ccd318f5543aa35c2e2bf92ffdbb`: K03 witness сохраняет разрешённый код ошибки и последний milestone; 31 код сверены с оригинальным Python-свидетелем.
- `a0c0d825a3be62485c9a985915e5e0128d4386e0`: нативная Windows UIA для Review различает `WORK_NAVIGATION`, `TASK_SELECTION`, `REVIEW_DIALOG_OPEN`, `DECISION_SELECTION`, `DECISION_SUBMIT`, `ACCEPTED_RESULT_READBACK` без печати UI/Task/модели.
- `9e863889491f3d460d938fd835f3513d6cb1564e`: оригинальный installed witness записывает эти ограниченные коды в свой `installed-witness.json`. Подписи, Core, Kernel, Human consent не изменены.

Публичный рабочий workflow `knowledge@97b9e395f9da0f46b71ac47e03440247fa60adea` пинит ровно этот Agent и тот же оригинальный One Core/Setup Core. **Автоматически запущен Windows [#44628590076](https://github.com/Faust-S/knowledge/actions/runs/44628590076)**, на момент первой фиксации QUEUED. Следующий шаг: прочитать фактический conclusion и безопасные маркеры `G4_AGENT06_INSTALLED_WITNESS_PHASE`, `_LAST_CHECKPOINT`, `_FAILURE_CODE`. При FAIL исправить только подтверждённую причину в оригинальном GUI/Owner, затем повторить одну такую установленную приёмку. При PASS отличать её от межпродуктового второго Windows SID, native Admin ACCEPT/APPLY и G4. Никакой автоматической отправки повторного Human Review или Kernel Apply при потерянном ответе.

Нормативный T2 остаётся `9c64951cd78411283e8a416641c36d71e169fc1d`, оригинальный T3 подписант `1a8267634955947bc0c6adc5614d7de176a33da2`, Admin Center `2628c4bc1b20b4393c485d12513f029fdea8b082`. Универсальный D6_GENERIC source 3/3 PASS [#44620132894](https://github.com/Faust-S/knowledge/actions/runs/44620132894); исходный signed D3 26/26 PASS [#44622214812](https://github.com/Faust-S/knowledge/actions/runs/44622214812). **`T3_READY=false`, `G4=NOT_ACCEPTED`.**

## 12. 20.11: исправлено повреждение исходного Windows witness, PS5 preflight PASS

**Исправление реального дефекта, созданного предыдущей диагностической правкой.** После точного `GUI_TASK_REVIEW` FAIL в [#44625025638](https://github.com/Faust-S/knowledge/actions/runs/44625025638) была добавлена ограниченная GUI/K03 диагностика. Однако следующий установленный [#44628590076](https://github.com/Faust-S/knowledge/actions/runs/44628590076) завершился **FAIL до создания `installed-witness.json`**: найденное после прогона сравнение исходного PowerShell свидетельствует о повреждении текста регулярного выражения и дублировании остатка файла из-за некорректной строковой подстановки при GitHub-правке. Это **внесённый дефект проверки**, а не свидетельство неисправности оригинального T2 Kernel, Qwen или подписей.

**Исправлено в оригинальном Agent** [`b5b9fda7ae5fac73de778f92dcfc6b0f607a8393`](https://github.com/Faust-S/iwxa-personal-agent/commit/b5b9fda7ae5fac73de778f92dcfc6b0f607a8393): весь `tools/qualify_setup_core_runtime.ps1` восстановлен от неповреждённого исходного `ffa56fee`, после чего целевые GUI Human Review/K03 диагностические изменения перенесены заново без интерпретации `$'` как управляющей подстановки JavaScript. Сверены 31 первоначальный код K03 и наличие единственной завершающей catch/finally ветки. Diff Agent от `ffa56fee` затрагивает **только два проверочных файла PowerShell**, не производственный Core/Kernel/подписант.

В публичном `knowledge` [`e2f44deb66404cf261009313bac7f0c709976e6c`](https://github.com/Faust-S/knowledge/commit/e2f44deb66404cf261009313bac7f0c709976e6c) перед затратной установкой добавлен fail-closed разбор обоих оригинальных скриптов **именно Windows PowerShell 5.1 Parser.ParseFile**, без вывода приватного текста. Исправлен и публичный диагностический путь профиля до `LOCALAPPDATA/IWXA/PersonalAgent`, ранее ошибочно направленный в старый generic каталог.

[Публичный установленный Windows CI #44710719858](https://github.com/Faust-S/knowledge/actions/runs/44710719858) прошёл preflight точных source pins, чистоты Windows checkout и **оба новых этапа PS5 parser**, после чего перешёл к настоящей сборке/установке. На момент фиксации **RUNNING**, итог установленного Human Review/Cold и Setup Repair/Rollback ещё неизвестен. Не повышать G4. При FAIL смотреть только `G4_AGENT06_INSTALLED_WITNESS_PHASE`, `_LAST_CHECKPOINT`, `_FAILURE_CODE`; по подтверждённому коду исправить конкретный UI/Core дефект, а не повторять D3 source или создавать новые системы.

Нормативный `T2@main 9c64951cd`, оригинальный `T3@1a826763`, Admin Center `2628c4bc`, G4 One Core `f42e53cd` не изменены. `D3_SOURCE=PASS` ([#44622214812](https://github.com/Faust-S/knowledge/actions/runs/44622214812)), `D6_GENERIC_SOURCE=PASS` ([#44620132894](https://github.com/Faust-S/knowledge/actions/runs/44620132894)), `G4=NOT_ACCEPTED`, `T3_READY=false`.
