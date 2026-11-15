# IWXA T3. Аудит реализованного продукта, рисков и конечного плана

## Проверка фактов и исправление ошибочного аудита, 15.11.2026

Этот раздел имеет приоритет над историческими сведениями ниже. Нормативные архитектурные требования B0/D1–D7/G4 остаются прежними. Текущую версию продукта определяют **release/tag и точная версия установленного артефакта**, затем проверенная рабочая ветка и CI, а НЕ `active_branch` из датированного реестра репозиториев.

### Исправления фактических ошибок

| Ранее заявлено | Что реально установлено при повторной сверке | Исправленная оценка |
|---|---|---|
| «Текущий Personal Agent 0.4» | [Agent 0.5 owner branch](https://github.com/Faust-S/iwxa-personal-agent/tree/work/2026-11-14-agent05-real-install-fix): HEAD `b76cba52c6e47c714ee8c491692a867bd5839108`, TREE `4063575864c4b57bd4dab6a802d3769457a15af1`; [Agent 0.6 development](https://github.com/Faust-S/iwxa-personal-agent/tree/work/2026-11-15-agent-0-6-development): HEAD `650d21ff2f041f11fabefd5f19c6d3ed51b45608` | **Версия 0.5 является актуальной зафиксированной исходной базой, по заявлению владельца — стабильной. 0.6 уже начата.** 0.4 — исторический выпуск, не текущий продукт |
| «Agent 0.5 ещё нет и native Task не проверен» (подразумеваемое исключение из анализа) | Реальные Windows Agent 0.5 [#43636726299](https://github.com/Faust-S/Center/actions/runs/43636726299) и [#43642367619](https://github.com/Faust-S/Center/actions/runs/43642367619) SUCCESS: Setup/Core, Task→Result→Human Review, cold readback; [#43649103289](https://github.com/Faust-S/Center/actions/runs/43649103289) FAIL в полном повторе на `TASK_STOPPED / TASK_POLL` при PASS установки и сохранения старых папок. [Смежный old-data workflow #43649103231](https://github.com/Faust-S/Center/actions/runs/43649103231) SUCCESS | **Функциональность Agent 0.5 реальна.** Нельзя объявлять всю повторную Windows-квалификацию PASS и нельзя переносить остаточный дефект Task в утверждение «Agent 0.4» |
| «Agent 0.6 — установленный выпуск» | Сравнение `b76cba5..650d21f` показало **ровно 5 коммитов и только 2 новых Markdown-плана**, без изменений кода Agent | `0.6=ACTIVE_PLANNING`; фактический baseline исполняемой части — 0.5, не подтверждённый 0.6 release |
| «Опубликованный Agent 0.5 GitHub Release подтверждён» | `releases/tags/v0.5.0` и `git/ref/tags/v0.5.0` возвращают 404; найден официальный GitHub Release `v0.4.0`. В источнике 0.6 прямо указано, что финальная пользовательская приёмка 0.5 не документирована | Разделять **стабильную 0.5 по решению владельца**, **Windows PASS отдельных сценариев**, **GitHub Release 0.5 не найден** и **T3 installed E2E ещё не принят**. Отсутствующий тег не отменяет существование 0.5 |
| «Актуален Atlas 0.6» | [Atlas v0.8.0](https://github.com/Faust-S/Atlas/releases/tag/v0.8.0) опубликован 15.11; [Windows #43708483434](https://github.com/Faust-S/Atlas/actions/runs/43708483434) SUCCESS, [публикация #43709263509](https://github.com/Faust-S/Atlas/actions/runs/43709263509) SUCCESS | Для D6 брать **Atlas 0.8.0**; старую ошибку GUI версии 0.6 не переносить на новый релиз |
| «Последний Publisher source прошёл CI» | `Faust-S/Center@work/2026-11-10-publisher-0.5`: HEAD `2bd8ee3e7f01dafe13c2458205b3ae48a07bb29a`, [CI #43711356339](https://github.com/Faust-S/Center/actions/runs/43711356339) на момент сверки выполняется. Прежний [#43709673003](https://github.com/Faust-S/Center/actions/runs/43709673003) SUCCESS относится к предыдущему HEAD | Не приписывать свежему коммиту прежний PASS; установленный issuer/consumer D7 отдельно HOLD |
| «Карта 42 репозиториев показывает последние версии» | `Faust-S/iwxa/coordination/repositories.json`, snapshot 10.11, содержит Agent 0.4, Atlas 0.6, старые Center/T3/knowledge ветки. **Все 42 записи и их исторические refs сверены; карта — реестр расположения кода**, не release authority | При каждом аудите сначала точный GitHub Release/tag/HEAD и product qualification, затем owners по реестру; исторические репозитории не переписывать ради косметического соответствия |
| «У T3 есть единый G4 PASS по зелёной Actions» | Самый свежий на дату этой сверки исполняемый HEAD `169664633949489ed4f989b079b52ceba4afb2f7`: [Actions #43711561979](https://github.com/Faust-S/knowledge/actions/runs/43711561979) SUCCESS: **712/712 Node**, **1141/1141 Workspace/DOM**, original real-host и Windows Credential PASS, `metal-webgpu=SKIPPED` | `B0/SOURCE` работает; **G4=NOT_ACCEPTED, T3_READY=false**. Нет аппаратной генерации и завершённого установленного D1/D3/D7 владельца |

### Исправленная инвентаризация окружения

| Продукт / собственник | Источник, подтверждённый при сверке | Фактическая граница |
|---|---|---|
| **Personal Agent 0.5 / разработка 0.6** | Приватный Agent 0.5 `b76cba5`; 0.6 `650d21f`, пока Markdown-планы. Штатный Tauri/React + Python Core, P01–P04, ModelProvider, Task/Graph/Result | Реальный native Task/Result есть; последний полный Windows повтор Agent 0.5 имеет FAIL. D3 T3 между установленными Agent/Admin не доказан. T3 не копирует Agent Graph/Task Engine |
| **Atlas 0.8.0** | `Faust-S/Atlas@release/0.8` HEAD `6ef7b8fa1ad58f159508aaa6413d5e0d9cf35dbb`, GitHub Release и успешный installed Windows candidate | Статус стабильного Atlas не равен подтверждённой D6-связи T3 Result/WorkRef |
| **Admin Center 0.3** | `Faust-S/Center@work/2026-11-11-admin-center-age-exchange` HEAD `ae432e8bdb5b27af5d611e534e4fac9b123fac21`, [#43709728566](https://github.com/Faust-S/Center/actions/runs/43709728566) SUCCESS; приватная owner-ветка `Faust-S/T3@work/2026-11-11-t3-d1-signed-activity-owner` HEAD `2d1424129e6183015d01c69f0485ddb583097993` | Код и signed owner подготовлены; полный установленный ADMIN↔PERSONAL D3+Kernel Apply пока HOLD |
| **Publisher 0.5** | Публичная Center-ветка `2bd8ee3`; private PERSON signer `Faust-S/T3@work/2026-11-10-product-license-person-0.5` HEAD `eb6be380a1b7bb3bd488d49a4e72d6fa5f3d8f47` | Не подменять реализацию issuer/consumer публичной адаптерной моделью; native revocation/renewal G4 ещё не доказаны |
| **IWXA Activity** | `Faust-S/knowledge@work/2026-11-10-activity-base-anonymizer` HEAD `2383c58f88901f16aa2a5fa780de447dba3d4750`; [#43580713592](https://github.com/Faust-S/knowledge/actions/runs/43580713592) SUCCESS | Activity отдельное приложение с собственной обработкой, T3 — только authorized read-only source; полный реальный источник/анонимизация/получатель ещё требует приёмки |
| **T3 local model / Browser** | Private BLI source `Faust-S/T3@work/2026-11-03-browser-local-inference-bli1` HEAD `680375c9b47fb04b6273a410f7bc8dbb85556778`; public Host с WebLLM Worker | Source build и браузерная панель есть; SwiftShader в CI не доказывает аппаратный inference. Obscura/U01–U04 принадлежат Br-test/Agent, не T3 |
| **42 репозитория / 12 доменов** | Исторические реестры `repositories.json`, `DOMAIN_IMPLEMENTATION_BINDINGS.json`, индивидуальные owner/site ветки | 11 предметных доменов + D12 информационный портал; ни один старый Product/T2 PASS автоматически не означает T3_ADOPTED. Один домен за раз, без копирования сайтов в knowledge |

### Исправленная очередность работ

1. **Сохранить Agent 0.5** как доступную пользовательскую базу и закончить в его собственном 0.6-A только конкретный `TASK_STOPPED/TASK_POLL` на установленном исходнике, не перестраивать Agent. При этом отдельная интеграция D3 T3 должна использовать существующую Task/Result и signed owner, а не ждать полного выпуска 0.6.
2. **Закрыть D1/D3 с оригинальными подписантами** в Admin 0.3 и Agent 0.5: подписанная Task → исполнение → selected Result → отдельный Human Review/ACCEPT → отдельный Kernel Apply → два cold reads. Право применения и лицензия — разные свойства.
3. **D4/D7**: оригинальный native age/DPAPI получатель, долговременная квитанция из original Kernel+Store, два независимых установленных recipients и оригинальный Publisher. Публичный `age.readbackImport` является портом, **не** реализованным durable Store и не может объявлять recovery COMPLETE без оригинального owner.
4. **D6**: привязать Agent Task/Result к стабильному Atlas **0.8.0** Project/WorkRef через существующие U01–U05; signed continuation, сохранение и повторный readback.
5. **D5**: на настоящем GPU выполнить модель, пользовательский consent, офлайн cold reopen и повторную генерацию; native model использовать исходный Agent provider. Hardware gate нельзя заменить синтетической генерацией.
6. **G4**: заморозить один T3 исходник/одну поставку, B0+D1–D7 на ней, оригинальные owners, installer/repair/update, two cold opens, no-egress. Только затем `T3_READY=true`, далее внедрять последовательно в D01–D12.

**Предотвращение повторной ошибки:** перед любым статусом продукта проверять `release`/точный tag, активный source branch, verified HEAD/TREE, терминальный CI **на этом SHA**, installed/user acceptance. Отдельно фиксировать: `SOURCE_PASS`, `OWNER_INTEGRATION_PASS`, `NATIVE_ACCEPTED`, `T3_READY`. Если release отсутствует, не писать «не существует версии»; если owner сообщил стабильную версию, не подменять её старой веткой из снимка 10.11. Новые Registry/Core/Store/EXE/Actions в закрытых репозиториях не создавать.

---


## Актуализация 15.11.2026: инженерная оценка T3 и программа до выпуска

> Этот раздел обновляет статус и план, приведённые ниже как историческое наблюдение 14.11. Никакая публикация в GitHub не меняет автоматически OWNER/NATIVE/G4 acceptance.

**Исполняемый source baseline перед текущим исправлением:** `Faust-S/knowledge@f255e43ba2a7f8564cfb1c9cb0d46b7c9ba5f35c`, TREE `fb0ec639a8270e9e78000b8019d8ff37c68ec1af`. Точный [GitHub Actions #43709601795](https://github.com/Faust-S/knowledge/actions/runs/43709601795): `test`, `real-host`, `windows-credential` = **SUCCESS**; **712/712 Node**, **1141/1141 Workspace/DOM**, real original T2 Host и Windows Credential PASS; `metal-webgpu` **SKIPPED**. Логи прямо помечают SwiftShader `inferenceSkipped=true`. Этот snapshot не заявляет аппаратную WebGPU-генерацию. Актуальный HEAD после изменения получать live; `Faust-S/T2@main=9c64951cd78411283e8a416641c36d71e169fc1d`, Kernel 0.3.6, Contract 1.3.0, не менялся.

### A. Доказанный продуктовый срез

| Этап | Реально реализовано на исходнике | Не покрыто итоговой приёмкой |
|---|---|---|
| B0 | Исходный T2 Kernel/Host/Workspace/Store/Exchange/Factory/Lifecycle; .iwxa roundtrip, данные/события/relations и два холодных чтения на эталонном real Host | Паритет **во всех** обновлённых продуктов и активных субъектах D1 |
| D1 | Подписанные Ed25519 PERSONAL/две CORP и отзыв, Control, раздельный UI/Kernel origin, оригинальный Kernel readback и cold Host в CI | Завершённый установленный продукт с production authority, native key custody и полным T2 API под активным D1 |
| D2 | Read-only Object/Event/Result→T0/T1 Activity, source refs/revisions/provenance и UNKNOWN; real T2 Host evidence | Реальные версионированные mappings всех доменов, Activity source acceptance |
| D3 | Исходные Reconciliation/Review/Accept/Apply и native Control порты, lost ACK не приравнивается к подтверждению | Один установленный Admin→Agent Result→отдельный Apply→original Kernel→два cold reads |
| D4 | Один исходный .iwxa, стандартный T2 parser/Exchange, две изолированные Store в source tests, PWA file handoff по действию пользователя | Два **разных установленных** потребителя; конкретные semantic/profile validations с data-preserving import |
| D5 | WebLLM 0.2.87 Worker/Host, выбор модели и разрешение на загрузку, cache-only offline, DRAFT_UNTRUSTED и Kernel readback | Реальная WebGPU-генерация на аппаратном GPU, холодная офлайн-повторная генерация; квалифицированный native inference consumer |
| D6 | Trusted continuation для WorkRef/Result и source ports U01–U05/Agent/Atlas | Конкретный web→native owner с сохранением Project/Task/Document/Result после перезапуска |
| D7 | Оригинальный age/Publisher интерфейс, preview→human commit, защита повторов/чужих токенов, `age.readbackImport` по точному preview_token+digest без повторного ZIP/Commit; Exchange UI для восстановления lost ACK | Реальный установленный native age/DPAPI и Publisher, прочитанная ORIGINAL квитанция/Store после двух cold restarts у двух получателей |
| G4 | Исходный single-dist с работающим оригинальным T2 и несколькими доказанными новыми маршрутами | Нет единого frozen candidate с оригинальными владельцами, аппаратной приёмкой и G4 владельца |

**Контроль D7:** публичный `age.readbackImport` **не** является реализацией durable receipt source. У оригинального Kernel 1.3.0 нет публичного lookup по `import_id`. Доверенный *установленный* владелец должен восстанавливать привязку исходного `preview_token` к подлинной квитанции в уже принадлежащем ему постоянном состоянии и независимо читать настоящий Store. При отсутствии этой способности статус **OUTCOME_UNKNOWN** и никакого replay. Не добавлять новый журнал в публичный T3. Экран Exchange держит recovery-query в текущей сессии; после закрытия окна её должен предоставлять оригинальный native owner, не браузерный session state.

**Выявленный source defect:** исходный `validateRestorationReceipt` сравнивал отсутствующие счётчики `applied` как `undefined`, давая `NaN` и возможность ложного `committed` после native readback. Текущее адресное исправление требует десять целочисленных неотрицательных original ImportReceipt counters перед подтверждением восстановления; тест адресно проверяет сначала неполную квитанцию, затем подлинную, без повторного Commit. До новой итоговой CI не присваивать ему PASS.

### B. Проверка окружения и разделения владельцев

Проверены live HEAD основных рабочих веток 15.11; они **не слиты автоматически** в `knowledge`:

| Владелец / источник | Проверенный live HEAD | Что должно произойти у самого владельца |
|---|---|---|
| T3 private PERSON/Publisher `work/2026-11-10-product-license-person-0.5` | `eb6be380a1b7b` | Применение реальных signed LICENSE/STATUS, отзыв/renewal, installed consumer receipt/cold readback |
| T3 private D1 `work/2026-11-11-t3-d1-signed-activity-owner` | `2d1424129e61` | Оригинальный process owner связывает подписанные права, Review/Apply и Kernel одного продукта |
| T3 private age `work/2026-10-28-iwxa-age-encrypted-exchange` | `91db0c4de769` | Официальный pinned age CLI, DPAPI key custody и два разных получателя |
| T3 BLI `work/2026-11-03-browser-local-inference-bli1` | `680375c9b47f` | Не создавать второй Worker, квалифицировать реальный GPU и native inference |
| Admin public `Faust-S/Center@work/2026-11-11-admin-center-age-exchange` | `ae432e8bdb5b` | Установленный ADMIN owner Reconciliation → Human Apply → original Kernel |
| Publisher public `Faust-S/Center@work/2026-11-10-publisher-0.5` | `2bd8ee3e7f01` | На момент повторной сверки свежий #43711356339 выполняется, предыдущий #43709673003 SUCCESS не квалифицирует новый HEAD |
| Agent 0.5 `Faust-S/iwxa-personal-agent@work/2026-11-14-agent05-real-install-fix` / 0.6 planning | `b76cba52c6e4` / `650d21ff2f04` | Native Agent Task/Result/Qwen/Review cold readback доказан в PASS-прогонах 0.5; последний полный Windows повтор имеет TASK_STOPPED FAIL, а 0.6 пока только планы. T3 native D3 отдельно HOLD |
| Atlas 0.8 `Faust-S/Atlas@release/0.8` | `6ef7b8fa1ad58f159508aaa6413d5e0d9cf35dbb` | `v0.8.0` опубликован 15.11; точная Windows acceptance #43708483434 SUCCESS на candidate `94d009a9`, publish #43709263509 SUCCESS. Этот релиз использовать для D6, но интеграция T3 WorkRef/Result ещё не принята |
| Activity `Faust-S/knowledge@work/2026-11-10-activity-base-anonymizer` | `2383c58f8890` | Разрешённое только для чтения доказуемое исходное T3 snapshot→обезличивание→отдельное решение |
| U01–U04 `Faust-S/Br-test@work/2026-11-02-agent-obscura-headless` | `7a2adee477249` | Подключение внешних программ без новых SDK/routers |
| Фундамент `Faust-S/T0` / `Faust-S/T1` foundation-authority | `3a1d2e36bea15` / `30f0e0621eac7` | Не дублировать частицы, процессы, Task Engine или authority |

**12 доменов:** применять существующий `Faust-S/iwxa/domains/DOMAIN_REGISTRY.json` и `coordination/DOMAIN_IMPLEMENTATION_BINDINGS.json`, а не создавать новый перечень или массово переносить сайты в knowledge. Сохранять пару owner logic repo и site repo (одно конечное `dist/`), русский интерфейс эталон при локализации. D12 — главный портал, не отдельная коммерческая субъектная база. Отдельные доменные PRODUCT_ACCEPTED не означают T3_ADOPTED.

### C. Очередность развития (исполняемые выходы, не новый фреймворк)

| Приоритет | Работа в существующем владельце | Готовность следующего шага |
|---|---|---|
| **P0 / D1+B0** | Установить **один настоящий** T3 Host в доступном продукте с исходным Kernel и полной T2 capability parity; подключить production signed owner. Проверить PERSONAL и CORP без чужого read | Один рабочий installed root, настоящая запись/чтение/отзыв и два cold opens; нет второго T2 writer |
| **P1 / D3** | Admin Center оригинальный Reconciliation/Review/Accept, отдельный Apply через подписанный D1 → Agent Result/Task | Task→Result→отдельное Human Apply→оригинальный Kernel readback в двух продуктах |
| **P2 / D4+D7** | Завершить `readbackInOriginalKernel` у штатного установленного age owner через его существующую durable state+Kernel; подлинные два X25519 recipient и Publisher signed STATUS; без private code в public | Два получателя открывают точные .iwxa и независимо читают результат после двух cold restarts; revoke после restart не превращается в ACTIVE |
| **P3 / D6** | Связать один живой Agent Task/Result с Atlas Project/WorkRef через действующие U01–U05 | Один пользовательский web↔native маршрут с сохранением Project/Task/Document/Result и повторным чтением |
| **P4 / D5** | На реально доступном GPU: выбор модели, явная загрузка, генерация, DRAFT_UNTRUSTED, оригинальный Kernel и offline cold retry. Native inference использовать существующий Agent provider | Доказанная модельная генерация, а не Worker build или SwiftShader |
| **P5 / G4** | Один frozen SHA/TREE и штатный single dist + real installed consumers; clean install/repair/update via существующий Setup Core; LOCAL_ONLY, 2 cold reopens | Единое решение владельца `G4=ACCEPTED`, только затем `T3_READY=true` |
| **P6 / domains** | Тиражировать принятый T3 по **одному** сайту за раз. Первый пилот: D02 Club как ранее принятый предметный продукт, затем домены по подтверждённой готовности и ценности кейсов. Activity подключать только с отдельным согласованным snapshot | Исходные предметные функции работают как прежде, T3 записи/экспорт/restart доказаны, итоговый `dist/` один |

**Правило оптимизации:** не продолжать расширять публичные D7-фасады синтетическими методами, пока не заработал хотя бы один реальный installed native recipient. Один продуктовый маршрут → конкретная ошибка → короткое исправление → одна итоговая сборка. Codex только для недоступной GUI/Windows native и независимой финальной приёмки. **Private Actions запрещены**, публичный knowledge CI не получает приватные ключи, credentials, исходники или пользовательские файлы. Использовать существующий публичный Center только в пределах отдельно разрешённых узких испытаний.

**Итоговая архитектура:** автономный встраиваемый единый T3 (полное наследование T2) в каждом обновлённом продукте. Данные, права, UI и предметный код остаются у своих владельцев. T0/T1 предоставляют семантические основы, D2 сохраняет проверяемую проекцию, Activity отдельно обрабатывает разрешённые snapshots; внешние модели/программы подключаются, но не обязательны. Ни облака, ни отдельной T3 Windows программы, ни второго Store/Kernel/Exchange, ни другого архивного формата.

**Текущее решение:** `T3_READY=false`; исходная сборка работоспособна, но `D1_NATIVE=HOLD`, `D3_PRODUCT=HOLD`, `D5_HARDWARE=HOLD`, `D7_NATIVE=HOLD`, `G4=NOT_ACCEPTED`.

---

Дата: 14.11.2026. Исходник: `Faust-S/knowledge/packages/t3-core`, рабочая ветка `work/2026-11-10-t3-t2-activity-projection`.

## Подтверждённый итог ревизии на исходнике 14.11.2026

**Последний полностью прошедший исполняемый T3:** `Faust-S/knowledge@ed0252749c1693bd5d86aef6bb5ad0abdb118b64`, TREE `6ffb6293a2ea1fe7c856242cff0c4e2ac9eaa56e`. [Public Actions #43580199444](https://github.com/Faust-S/knowledge/actions/runs/43580199444) **SUCCESS**: `test`, `real-host`, `windows-credential`; `metal-webgpu` **SKIPPED**. Проверены `672/672` Node product tests, `1120/1120` Workspace/DOM Vitest и `21/21` в дополнительном этапе Workspace/Activity, без падений. Эти результаты доказывают перечисленные тестовые маршруты, не общий G4 или настоящее WebGPU-generation.

**Исправленная регрессия D2:** на предыдущем коммите `35d0b12f68ba9677380dc3ce73234fae939d56fb` CI [#43580005227](https://github.com/Faust-S/knowledge/actions/runs/43580005227) вернул FAIL из-за одного неверного `assert.throws`: подставленная Workspace-запись имела корректный формат, но неверное `created_at`. Существующая D2 source projection правильно возвращала `T2_CONTEXT_EVENT_NOT_VERIFIED`, тогда как тест ошибочно ожидал `T2_CONTEXT_WORKSPACE_RECORD_REQUIRED`. В [`ed02527`](https://github.com/Faust-S/knowledge/commit/ed0252749c1693bd5d86aef6bb5ad0abdb118b64) тест различает отсутствие записи и несовпадение подлинного события. Код рабочих проекций не ослаблен; PASS exact CI подтверждён.

**Дополнительное последовательное D3-исправление:** [`75b4955`](https://github.com/Faust-S/knowledge/commit/75b4955eeb53b2ba276a6a1059762aec12bc150a) запрещает `status:APPLIED` при одновременном явном отказе owner; [Actions #43579945454](https://github.com/Faust-S/knowledge/actions/runs/43579945454) SUCCESS. Последующий D2-коммит сохранён, параллельные правки не откатывались.

Всё ещё `D1_NATIVE_ORIGIN_BOUNDARY=NOT_ACCEPTED`, `D3_END_TO_END=NOT_ACCEPTED`, `D5_HARDWARE_WEBGPU=NOT_ACCEPTED`, `G4=NOT_ACCEPTED`, `T3_READY=false`. Зелёная CI не меняет этих решений автоматически.

## 1. Нормативная граница

T3 является **следующей версией T2**, содержащей все возможности исходного T2 и D1–D7. В обновлённом продукте работает один T3 Kernel/Host/Workspace/Store/Object/Event/Result/Exchange/Lifecycle/Factory; не должно быть отдельного одновременно работающего ядра T2. При поэтапном переходе T2 продолжает существовать только в ещё не обновлённых продуктах. T3 не является самостоятельным Windows EXE, Control UI, sidecar, облаком или единым хранилищем всех доменов.

Норматив T2: `Faust-S/T2@main` = `9c64951cd78411283e8a416641c36d71e169fc1d`; Kernel `0.3.6`, Runtime Contract `1.3.0`, артефакт `iwxa-kernel-k036-same-store-history-20261019-qualified.1` и исходный формат `.iwxa`. При следующем запуске повторно получить live HEAD и проверить pin.

План: `Faust-S/T3@work/2026-11-10-t3-t2-upgrade-core/planning/T3_DELTA_ACCEPTANCE_RU.md` и `architecture/T3_T2_UPGRADE_TARGET_RU.md`; карта owner-репозиториев: `architecture/T3_ONE_CORE_ALL_DOMAINS_SOFTWARE_AI_SOURCE_MAP_2026_11_11_RU.md`. Эти источники **не** означают релизную приёмку.

## 2. Доказательства на точных исполняемых коммитах

- [CI #43578735999](https://github.com/Faust-S/knowledge/actions/runs/43578735999): source `2cf200ad0f1beb4c783ff89b6ba2a3c2aa5308bb`, TREE `d5d2fa68171e6573efddc11e9e854f27b7c0452b`, `test`, `real-host`, `windows-credential` SUCCESS; `metal-webgpu` SKIPPED; 668/668 Node product tests PASS. В том же успешном CI прямо напечатан `T3_D1_RAW_ORIGINAL_KERNEL_BYPASS_CONFIRMED_NOT_ACCEPTED`: подписанный UI на неразделённом origin открывает оригинальный Kernel напрямую и читает чужую Workspace без подписанного гранта. Этот результат **блокирует D1**, несмотря на зелёный workflow.
- [Коммит 5ba9fc4](https://github.com/Faust-S/knowledge/commit/5ba9fc469b5c78361c264943cb50f4b713f5edb1) исправил явные denied/HOLD состояния в исходных `site-handoff`, `host-receiver`, `site-restore`; [CI #43579800166](https://github.com/Faust-S/knowledge/actions/runs/43579800166) SUCCESS в `test/real-host/windows-credential`, 671/671 Node product tests, включая новые регрессии. Это исправление транспорта, **не** D3 end-to-end.
- Параллельная ветка продолжилась коммитами `75b4955` (явный owner denial даже при `status:APPLIED`) и `35d0b12` (контекстное различение исходного lifecycle Event); их квалификацию сверять по точным CI перед присвоением PASS. Не откатывать чужую работу.
- Проверены исходные Browser/Host метки `T3_D4_TWO_INDEPENDENT_CONSUMERS_ORIGINAL_IWXA_PASS`, `T3_D1_TWO_CORP_COMPILED_APPSHELL_REAL_ED25519_KERNEL_PASS`, `T3_D5_FULL_ORIGINAL_BLI_HOST_BUILD_PASS`; ни одна сама по себе не заменяет G4.

## 3. Матрица фактического состояния

| Блок | Что в действующем T3 действительно работает | Что осталось / статус |
|---|---|---|
| **B0** | Исходные T2 Kernel/Store/Workspace/Factory/Lifecycle/Exchange, объекты, отношения, события, сохранение, `.iwxa` roundtrip и cold readback; оригинальные ModuleContext capabilities восстановлены | **OWNER_INTEGRATION_PASS на проверенных эталонных Host**, не равнозначно G4 |
| **D1** | Настоящие Ed25519 подписанные PERSONAL и две CORP выдачи/статусы/отзывы, локальный encrypted vault, JIT signed Host/Control, два холодных процесса, origin-isolated React Host; оригинальный Kernel readback | **PARTIAL/PRODUCT_HOLD**: неразделённый browser origin даёт raw-Kernel обход; native Store-грань и полная паритетность T2 в активном D1 на одном установленном продукте не приняты |
| **D2** | Точная read-only T2→T0/T1 проекция, доменные bindings, refs/revisions/events/relations, вывод UNKNOWN, системные lifecycle events отдельно от бизнес-фактов, real Host | **OWNER_INTEGRATION_PASS на эталоне**, не подтверждены все 11 доменных mappings и внедрения |
| **D3** | Унаследованный Site↔Host транспорт и подтверждение асинхронной квитанции, исправлены ложные APPLIED; исходный Reconciliation/Accept/Apply алгоритм имеется **в историческом T3**, не встроен в этот рабочий T3 | **NOT_ACCEPTED**: нет двух независимых ADMIN/PERSONAL продуктов с signed Task→Result→Human Review→Accept→отдельный Apply→original Kernel receipt→2 cold reopen |
| **D4** | Исходный `.iwxa`, настоящий T2 Exchange parser, точные архивные байты и два раздельных Kernel Store; оригинальные refs/events/relations, холодное чтение, отказ на повреждённом ZIP/unsupported-version/path traversal | **PARTIAL**: два потребительских порта не являются двумя разными установленными независимыми продуктами; семантический standard/profile отказ не квалифицирован во всей матрице |
| **D5** | Исходный BLI1 + WebLLM 0.2.87 Worker собираются в едином Host; явная модель/согласие на скачивание, offline cache проверка, только локальный draft, точный T2 Kernel receipt/readback/cold reopen | **PARTIAL**: основной CI использует SwiftShader; `inferenceSkipped:true`, нет доказанной генерации реальной моделью/WebGPU, холодной повторной генерации и native-пути |
| **D6** | Есть владельцы/контракты Agent, Atlas, Admin, U01–U05 и T3 Host-порты; единая концепция переноса ref | **NOT_ACCEPTED**: реальный web→native owner Task/Project/Document/Result, signed continuation и readback после перезапуска |
| **D7** | В историческом T3 есть исходные Access/PERSON/Publisher licence и age-наработки | **NOT_ACCEPTED**: в исполняемом T3 нет принятого Publisher→consumer signed status/renew/revoke + age encrypt/decrypt двумя адресатами и независимого native чтения |
| **G4** | Публичные source/Host/DOM/Windows credential CI для отдельных подсистем проходят, единый `dist` сохраняет оригинальный runtime | **NOT_ACCEPTED**, `T3_READY=false`: нет одного locked release с B0+D1–D7, чистой установкой, аппаратной GPU/native квалификацией, no-egress и owner acceptance |

**Важно:** Успешный код `T3_D1_RAW_ORIGINAL_KERNEL_BYPASS_CONFIRMED_NOT_ACCEPTED` означает *найденный дефект*, а не PASS. Нельзя удалить или заглушить соответствующий browser-test, чтобы сделать результат «зелёным».

## 4. Архитектурные ошибки и исправления

**A. Несанкционированная отдельная T3 Windows-программа.** Принято окончательное решение не создавать и не сохранять её, не переиспользовать старые ветки, installer, sidecar или отдельное GUI. T3 поставляется как SDK/runtime/Host-порты существующих продуктов. Ранее потраченные усилия не являются признаком готовности.

**B. Подмена T2 capabilities подписанной обёрткой.** В обычном ModuleContext восстановлен исходный T2 facade, но `SUBJECT_SCOPED_OPERATION_IDS` на D1-порту уже оригинального API; нельзя выдавать его за полный successor. Исправить **в существующей границе собственника** так, чтобы каждый штатный метод либо осуществлялся с правильной авторизацией и scope, либо объяснял честную недоступность данной операции именно в этом product mode, не исчезая из публичного контракта. Не расширять список вручную по одному методу как архитектурную замену.

**C. Raw Kernel при same-origin signed UI.** Это фактический release blocker: настоящий browser witness в `t3-d1-signed-control-one-dist.browser.mjs` получил read из чужого Workspace через `IWXA.connect`. Origin-isolated UI уже доказал невозможность загрузки original Loader в отдельном UI origin, но production route должен **обязательно** направлять подписанный Workspace через это штатное разделение и запрещать любые raw same-origin интерфейсы в protected context. Нужно добиться одинакового отказа на всех доступных маршрутах, а не только в test-only изолированной сцене; затем проверить настоящий original Kernel без сокращения T2 API. Не модифицировать нормативный T2, не вводить второй Store или второй IAM.

**D. ACCEPT путают с APPLY; транспортные статусы выдавали ложное выполнение.** Исправлены `Promise`-границы и явно возвращаемые false/null/HOLD/denied, запрещены преждевременные успешные квитанции. `onReceipt` и `onCandidate` унаследованного транспорта допускают legacy `void`: транспортный ACK сам по себе **не** является доказательством реального Kernel commit и независимого readback. Должны быть проверены штатными владельцами в D3.

**E. Смешение статусов источника и бизнес-фактов D2.** Подтверждённые записи о жизненном цикле T2 не означают бизнес-операцию, завершённую работу или принятую Task. Сохранять происхождение, точное сопоставление доменных bindings, UNKNOWN для неподтверждённого и строго read-only проекцию; параллельные правки D2 не откатывать.

**F. Принятие тестовой инфраструктуры за продукт.** Два consumer ports ≠ два продукта; compiled Worker ≠ WebGPU generation; Node Windows test ≠ native Windows installed; signed TEST issuer ≠ production enrolment. Любой не выполненный acceptance сохранять HOLD/NOT_RUN. Не создавать новых фреймворков тестов или промежуточных продуктов ради повышения цифр.

## 5. Конкретный конечный T3

Встроенный, автономный, версионированный преемник T2: один исходный Kernel/Store и пользовательский Host каждого домена/приложения; локальная субъектная база Object/Event/Result + детерминированная T0/T1 Activity-проекция; подписанные PERSONAL/CORP гранты и отзыв; исходный `.iwxa` перенос, выбор/подтверждение/отдельное применение, история и восстановления; локальные лицензии и age-перенос; подключаемый по желанию WebGPU/native AI (согласие на скачивание, локальный draft/receipt); рабочие порты к Agent/Atlas/Admin/Publisher/Activity и U01–U05 без установки их «внутрь T3».

Для сайта: штатная опция T3 и существующая PWA установка, локальный offline Host; модель по выбору и отдельному разрешению пользователя, не встраивать тяжёлую модель в каждый домен. Для нативного ПО: T3 подключён к существующему приложению и его единственному окну/инсталлятору. Вся предметная логика/UX остаётся у доменов и программ. Лицензия не означает доступ к чужим данным; черновик ИИ не принят автоматически. IWXA Activity реализует **отдельно** обезличивание/обобщение и будущий добровольный обмен опытом, T3 предоставляет только разрешённые исходные доказательства.

Нет обязательного облака, нового `.t3`/архива, универсальной Windows T3 программы, второго Task Engine, общего онлайн аккаунта или системного фонового AI.

## 6. Закрываем оставшиеся дельты по одной, без расширения плана

1. **Сначала D1 raw-Kernel boundary/полное сохранение T2 функций**: включить уже разработанную origin isolation в настоящем supported Host по умолчанию, исключить same-origin raw обход, проверить PERSONAL + 2 CORP, revoked status, two cold processes и исходный full parity. Только этот установленный разрыв имеет право прерывать прежнюю очередность D3.
2. **D3**: интегрировать существующий owner Reconciliation с уже встроенным signed Host и действительными ADMIN/PERSONAL правами. Отделить RECEIVE/REVIEW/ACCEPT/APPLY; реальный Kernel write/receipt/readback/cold, негативные wrong recipient/key/role/revision/replay. Исторические приватные исходники не копировать в открытый CI без права публикации.
3. **D4/D7**: тот же `.iwxa` у двух разных установленных consumers, standard profile/negative parser; issuer и подписанный Publisher статус, renewal/revoke, authentic age для двух адресатов.
4. **D5/D6**: аппаратный Browser WebGPU generation+offline regeneration, native model owner path; один реальный Web Host↔native Agent/Atlas/Admin continuation с задачами, документами и результатами.
5. **G4**: один release pin, B0+D1–D7 positive/negative, два cold restarts, чистая локальная установка/восстановление, no-external-egress, owner acceptance и независимая финальная проверка. **Затем G5** — последовательное внедрение доменов, один домен за раз.

**Стоп-правило:** при PASS на exact owner/product перейти дальше, не «дополировывать» транспорт и не подменять продуктовые пробелы очередными обёртками. Любая неподтверждённая граница остаётся NOT_ACCEPTED до действительного завершения.
