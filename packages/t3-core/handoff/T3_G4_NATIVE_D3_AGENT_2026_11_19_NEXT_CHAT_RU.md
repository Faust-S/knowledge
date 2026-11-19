# IWXA T3 G4: передача после принятой регистрации Admin и выравнивания оригинального подписанта

Дата: **19 ноября 2026 года**. Главная цель: законченный единый автономный G4, не новый архитектурный цикл.
**Текущее решение до всех обязательных installed gates: `T3_READY=false`, `G4=NOT_ACCEPTED`.**

## 0. Первые обязательные действия следующего чата

1. **Полностью прочитать этот документ**, `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection/AGENTS.md`, `packages/t3-core/handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`, `packages/t3-core/docs/T3_G4_D3_NATIVE_HUMAN_DECISIONS_AND_PRODUCT_GATE_2026_11_19_RU.md`, `packages/t3-core/docs/T3_G4_ECOSYSTEM_RELEASE_READINESS_AUDIT_2026_11_19_RU.md`.
2. **Самое первое инженерное действие**: получить фактические финальные результаты трёх Windows/Ubuntu квалификаций на едином `knowledge@b9fa8acf6a5c3667f7fc368f931a526e474161e8`:
   - installed Admin Center [#44559119290](https://github.com/Faust-S/knowledge/actions/runs/44559119290);
   - original private Agent Node/Python + настоящий T2 Kernel [#44559119398](https://github.com/Faust-S/knowledge/actions/runs/44559119398);
   - исходный оригинальный D3 Owner и его одноразовый Human ACCEPT [#44559119612](https://github.com/Faust-S/knowledge/actions/runs/44559119612).
   **Фактический результат:** #44559119398 SUCCESS (original native Agent/Kernel 20 контрольных этапов), #44559119612 SUCCESS (15/15 original Owner), #44559119290 всё ещё требовал итоговой проверки на момент этой редакции. Установленный D3 считать PASS только по финалу третьего CI. При FAIL читать только bounded codes, никогда сырые приватные логи/ключи.
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
- `Faust-S/iwxa-personal-agent@work/2026-11-15-agent-0-6-development`: `1bf0847ed069c86fe6a11380537535f0ce6c0b8e`. Отдельный original D3-employee source `work/2026-11-16-agent06-corporate-t3-d3-current@5638684ab952dffa545d8a374507f494a1a5ef2a`; D6 candidate `work/2026-11-16-agent06-original-t3-result-owner-d6@34d8f1a10b552f1d0c4108e012414648e71ce0a0`. Не делать слепой merge в общую Agent-ветку.
- `Faust-S/T2@main 9c64951cd78411283e8a416641c36d71e169fc1d` (normative Kernel 0.3.6/Runtime Contract 1.3.0).
- `Faust-S/Atlas@work/2026-11-16-atlas-0-9-t3 19ea3d228c585a1c50e749632c2f2df1a71c7c33` (опциональный).
- Publisher в `Faust-S/Center@work/2026-11-10-publisher-0.5 3397d4d7e599760a07662e766ed3e4cf6ecc2a23`.
- Activity `Faust-S/knowledge@work/2026-11-10-activity-base-anonymizer 2383c58f88901f16aa2a5fa780de447dba3d4750`.

## 6. Домены и релизная дисциплина

T2 product-first сервисы завершать параллельно, **не ждать** G4. T3 в D01–D11 пока только по одному сайту и отдельной пилотной ветке. D02 `Faust-S/club.iwxa.ru@work/2026-11-11-d02-t3-domain-autonomy` ещё требует внешние `IWXA_T3_CORE_SOURCE_DIR` и `IWXA_T3_BLI_SOURCE_DIR` при candidate build; это **не** автономный production `dist/`. Финальная обычная сборка должна выполняться **из одного site checkout**, с хешированными принятыми T3 артефактами в web repo, без обязательного обращения к репозиториям разработчиков. Русские версии и `main` изменять только по отдельному поручению.

**Граница прав:** пользовательская производственная подпись и реальный native Human consent обязательны. Нельзя подменять криптографические квитанции, тестовые одинокие процессы, отозванные права, lost-ACK recovery или installed GUI имитациями.

## 7. Короткий промпт для нового чата

Продолжай самостоятельную инженерную разработку единого автономного IWXA T3 G4 в существующих репозиториях GitHub. **Первое действие: полностью прочитай этот handoff**, актуальный `AGENTS.md`, машинный `G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json` и native Human ACCEPT/APPLY contract. Сверь live HEAD/TREE и финальные CI #44559119290, #44559119398, #44559119612. Admin Owner/DPAPI установленная приёмка #44537675979 PASS; native Agent/Kernel source #44557711931 PASS, но Agent установленный E2E ещё HOLD. Все версии приватного подписанта синхронизированы на точном `T3@1a826763`; тест Human ACCEPT исправлен, не ослабляй его. При FAIL устрани первопричину, повтори адресный CI. Затем выполни независимый установленный Agent под другим Windows-пользователем, настоящую локальную модель/Result/подпись, отдельные native Human ACCEPT и APPLY с оригинальным Kernel Object/Event и двумя cold readback, generic D6 без обязательного Atlas, PERSON D7 и конечный автономный D5. Исходный T2 сохранять; никаких новых Core/Host/IAM/Store/Exchange, private Actions, публикации приватного кода. По завершении обнови реестр с точными доказательствами. `T3_READY=false`, `G4=NOT_ACCEPTED` до полной приёмки.
