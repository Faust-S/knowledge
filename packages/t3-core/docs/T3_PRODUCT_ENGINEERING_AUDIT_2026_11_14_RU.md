# IWXA T3. Аудит реализованного продукта, рисков и конечного плана
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
