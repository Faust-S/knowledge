# IWXA T3 G4: инженерная ревизия ядра, программ и доменов

Дата фиксации: 19.11.2026. Статус: `T3_READY=false`, `G4=NOT_ACCEPTED`.

## 1. Проверяемые исходники и доказательства

- Исполняемый One Core: `Faust-S/knowledge@6ad3a3e5d5bca0d091503a275a4d786e48524a97/packages/t3-core`. Нормативный `Faust-S/T2@main 9c64951cd78411283e8a416641c36d71e169fc1d`, оригинальный Kernel 0.3.6, Runtime Contract 1.3.0. Зафиксированный T2 runtime квалифицируется по SHA-256; поздние обновления нормативного main являются документацией.
- Оригинальный подписанный Windows Owner: `Faust-S/T3@b897404432cec18144942758d296c19d76232f55`. Это исходный владелец signer/Access/Reconciliation, **не** второй исполняемый T3 Kernel/Host.
- Установленный Admin Center: `Faust-S/Center@2628c4bc1b20b4393c485d12513f029fdea8b082`.
- Agent 0.6 development: `Faust-S/iwxa-personal-agent@1bf0847ed069c86fe6a11380537535f0ce6c0b8e`; отдельно подписанный D3 source `5638684ab952dffa545d8a374507f494a1a5ef2a`, D6 source `34d8f1a10b552f1d0c4108e012414648e71ce0a0`.
- Atlas 0.9: `Faust-S/Atlas@19ea3d228c585a1c50e749632c2f2df1a71c7c33`; Publisher PERSON: `Faust-S/Center@3397d4d7e599760a07662e766ed3e4cf6ecc2a23`; Activity source: `Faust-S/knowledge@2383c58f88901f16aa2a5fa780de447dba3d4750`.
- Единственная явно названная пилотная ветка T3 среди 11 парных веб-доменов: `Faust-S/club.iwxa.ru@868bf42f0462268ae82da6db62443b90606e77fe`.
- Исходная квалификация Core [#44537675955](https://github.com/Faust-S/knowledge/actions/runs/44537675955): PASS, 801/801 Node; real-host и Windows credentials PASS; Metal, native age и native model SKIPPED именно в этом прогоне.
- Установленный Admin D3 [#44537675979](https://github.com/Faust-S/knowledge/actions/runs/44537675979): **SUCCESS**, 19.11.2026. Публичный One Dist и приватная нативная сборка PASS; реальный Setup Core и WebView2 PASS; Workspace без Atlas PASS; физический NO и затем YES регистрации PASS; исходный подписанный Owner готов; отдельное дисковое чтение черновика, пять необходимых файлов, независимый второй процесс оригинального Owner с DPAPI и GUI cold restart PASS.

## 2. Уровень готовности B0 и D1-D7

| Уровень | Доказано | Что НЕ принято |
| --- | --- | --- |
| B0, единый T2/T3 | Qualified T2 0.3.6 в One Dist, Core/Host/Kernel/Workspace/Exchange/Lifecycle исходно работают; установленный Admin Setup PASS | Универсальное промышленное обновление всех продуктов |
| D1, подписанные полномочия | Исходные Access/Ed25519, DPAPI; установленный Admin Owner и холодное восстановление PASS | Два независимых Windows-субъекта, оригинальный installed employee Agent, единая сверка их прав |
| D2, Event/Activity | Контрактные original T2 Object/Event и выбранная D2-проекция | Установленный Activity с подписанным reviewer passport и строго разрешённым derived Result |
| D3, Task -> Result -> Human | Оригинальный Windows Node/Python source-сценарий 20/20, реальный Kernel APPLY и два source-cold чтения; установленный Admin Owner enrollment PASS | Installed Agent с настоящей модельной Task и Result, физические отдельные ACCEPT и APPLY, Kernel Object/Event и два cold readback между установленными продуктами |
| D4, Exchange | Два технических адресата, существующий .iwxa и подписанные технические контракты | Универсальная самостоятельная установленная передача между независимыми владельцами |
| D5, browser local model | Apple Metal WebGPU/WebLLM, первая генерация и вторая холодная офлайн-генерация на source-кандидате, [#44340207574 attempt 2](https://github.com/Faust-S/knowledge/actions/runs/44340207574) | Принятый именно конечный self-contained T3 domain dist, пользовательская установка модели, настоящий web-product cold restart для финального G4 |
| D6_GENERIC | Public original signed-context, обычный другой домен без Atlas, source tests PASS | Реальный отдельный установленный получатель, его собственное сохранение и lost-ACK read-only recovery |
| D7_PERSON | Контракты original Publisher PERSON и age, исходные проверки подписей и STATUS | Установленный Publisher/recipient: issue, renew, STATUS, revoke, independent cold readback |
| G4 | Отдельные технические части квалифицированы | **NOT_ACCEPTED**, `T3_READY=false` |

Отдельные успешные испытания не суммируются автоматически в G4. Прогон одного Windows OS-пользователя с разными тестовыми ключами не равен двум отдельно установленным владельцам.

## 3. Готовность программы

| Программа | Что уже есть | Т3 до промышленного завершения |
| --- | --- | --- |
| Admin Center | Установленный native Center, T2 One Dist, обычная Workspace без Atlas, real Win32 Human enrollment, original DPAPI Owner и полный холодный restart PASS (#44537675979) | Реальный второй сотрудник/Agent, отдельные native Human ACCEPT/APPLY, original Kernel Event/Object и двухкратное cold-чтение результата |
| Personal Agent 0.6 | Нативный Agent/One Dist и Setup 0.6 с обычным cold-open и same-version Repair PASS; D3 подписанные Task/Result source, локальные модельные компоненты | Реальная установленная корпоративная Task + локальный inference + Human Review + подписанный Result под другой Windows-учётной записью; cross-version rollback и independent D6 |
| Atlas 0.9 | Самостоятельный Tauri и original U05 Store, installed Project/Work save, два отдельных cold-read PASS; optional T3 WorkRef/Decision source | Только факультативный оригинальный signed recipient; private Ed25519 installed Agent -> Atlas не принят и НЕ блокирует G4_GENERIC |
| Publisher 0.5 | PERSON request/renew/STATUS/revoke и строгий original signer readback представлены исходниками; TEST лицензии отделены от PERSON | Native PERSON signer и адресат должны пройти issue, renew, STATUS/revoke и cold readback |
| Activity Analyzer | Source original T2 D2 reader, selected Workspace, separate reviewer passport, явная граница read / derive / publish | Установленная программа и реальный owner-approved derived Result с проверенной анонимизацией/правами |
| Веб-домены D01-D11 | T2 product-first позволяет продолжать предметные функции и собственные Workspace; пилот D02 имеет отдельную экспериментальную T3-ветку | Пока нет доказательств общего G4 self-contained T3 release в 11 production domain dist. D02 candidate builder сейчас требует `IWXA_T3_CORE_SOURCE_DIR` и `IWXA_T3_BLI_SOURCE_DIR`, поэтому не является автономной хостинговой сборкой |

## 4. Сверка архитектуры и обнаруженные ошибки

**Правильно:** исполняемый T3 только `knowledge/packages/t3-core`; оригинальный T2 Kernel/Host/Store/Exchange не копировать; оригинальный приватный подписант остается у своего владельца. Admin владеет организационным решением, Agent исполнением, Publisher лицензией, Activity правомерной производной проекцией, Atlas проектом и WorkRef. Для обычной Task Atlas не требуется. Получатель D6 может быть любым авторизованным доменом.

**Исправлено и проверено:** исходный Rust Center неверно отклонял собственное действие `d3-enroll`; private Bun EXE терял JSON-каталог `domain-registry.json` при чтении через `import.meta.url`, а импортированные Server/License CLI могли выполнять собственные точки входа; нестабильный Windows UIA ввод прежде принимался без точного ValuePattern readback. Исправления исходных владельцев подтверждены установленным PASS #44537675979.

**Исправлена ошибка релизного учёта:** прежний `G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json` всё ещё отмечал cold Owner как HOLD после успешного CI. Обновлён отдельный точный gate `D3_INSTALLED_ADMIN_OWNER_ENROLL_AND_DPAPI_COLD=PASS`; общий D3 остаётся PARTIAL и G4 NOT_ACCEPTED. Эти статусы нельзя взаимозаменять.

**Открытые инженерные риски:**
1. Нельзя считать source 20/20 полноценным installed Human ACCEPT/APPLY. Нет сквозного продукта под двумя OS-пользователями.
2. Нельзя считать Metal source PASS квалификацией ровно выпускаемого доменного T3, пока не собран самостоятельный сайт, выбранная модель не установлена по явному согласию и холодный офлайн-маршрут не пройден на том же выпуске.
3. Нельзя подменять generic D6 цепочкой Agent -> signed file -> Atlas: Atlas факультативен; сама подписанная .iwxa с полезным текстом не означает его шифрования (для конфиденциальности нужен оригинальный age).
4. Нельзя считать T3 self-contained domain готовым, пока обычный site `build` требует checkout разработческих T2/T3/BLI. Сборка должна использовать проверенный release artifact из своего веб-репозитория с SHA/provenance, а не дублированный развиваемый Core.
5. Нельзя продолжать выдавать устаревшие report/AGENTS/handoff HEAD за текущие: read live SHA, compare CI pin and scope; точная релизная запись машинного реестра приоритетнее исторического рассказа.

## 5. Решение о трансформации доменов

**Сейчас:**
- Продолжать T2 product-first сервисы, Result/receipt/readback/cold restart/.iwxa по доменам без ожидания G4.
- Вести отдельную не-production T3 пилотную ветку для одного сайта за раз (D02): явный переключатель T3; модель только после отдельного выбора и согласия пользователя; все ресурсы локальны и после установки доступны офлайн; сайт не обращается к репозиториям T2/T3 при build/runtime.
- Подготовить у предметных владельцев собственные Result/Task и разрешённые projection contracts. Данные чужого домена доступны только через D1/D6, не общие коллекции, Atlas или новый Store.
- **Не переводить T3 в production по умолчанию** и не снимать стабильный T2, пока не прошли необходимые installed и доменные сценарии на одном закреплённом выпуске.

**Далее, в этом порядке:** (1) установленный Agent под вторым Windows-пользователем и настоящий model/Task/Result, (2) реальные native ACCEPT и отдельно APPLY с Kernel Object/Event и двумя cold-восстановлениями, (3) generic D6 к независимому не-Atlas получателю, (4) PERSON D7 Native Publisher, (5) точная hardware/Host D5 квалификация конечного доменного выпуска, (6) сборка/проверка D02 из одного site checkout, (7) G4 и последовательное по одному домену внедрение.

**Вердикт:** архитектура годится для продолжения. Исходная технологическая зрелость высокая относительно начала разработки; межпродуктовая промышленная готовность пока **частичная**. Проценты без фиксированного набора проверок скрыли бы эту разницу. До независимых installed D3/D5/D6/D7 `T3_READY=false`.

## 6. Системный аудит 20.11.2026: что менять в подходе

**Этот раздел актуализирует даты и выводы первых пяти разделов.** Единственный текущий машинный статус:
`packages/t3-core/handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json.current_release`.
Все прежние SHA/CI и таблицы в ранних handoff - история, не доказательство текущего релиза.
`T3_READY=false`, `G4=NOT_ACCEPTED`.

### 6.1. Проверенная архитектура

- Нормативный оригинальный `T2@9c64951c` остаётся единственным основанием Kernel/Host/Store/Workspace/Exchange/Lifecycle. Исполняемый One Core `knowledge/packages/t3-core@f42e53cd`. Оригинальный подписант `T3@1a826763` не заменяет и не дублирует Kernel.
- Владелец персональной Task, локальной модели, своего Review и Result: Agent; организационной роли, подписанного принятия и Kernel Apply: Admin Center плюс оригинальный подписанный Owner; лицензии PERSON: Publisher; разрешённой производной проекции: Activity; Project/Work: Atlas как **подключаемая**, не обязательная программа.
- Универсальная D6 передача не требует `workRef` и Atlas. Если WorkRef указан, строгая сверка проекта, работы и ревизии сохраняется. Получатель только по явному подписанному D1; нет скрытого адресата по умолчанию.
- Проверка источника, физическая установленная операция и независимая межпродуктовая приёмка - **разные уровни**. Никакие 26/26 source, отдельные Windows GUI smoke или прежний macOS Metal не складываются автоматически в один G4.

### 6.2. Системные ошибки, подтверждения и решения

| Ошибка подхода | Проверенный симптом | Исправление / обязательное действие |
| --- | --- | --- |
| Смешение исходной D3 и установленной D3 | Исторический PASS [#44622214812](https://github.com/Faust-S/knowledge/actions/runs/44622214812) относится к Agent `ffa56fee`, а установленная ревизия уже `21505e81` | Зафиксирован один точный Agent pin в source и installed workflow, добавлена проверка parity; новая пара [source #44723931657](https://github.com/Faust-S/knowledge/actions/runs/44723931657) и [installed #44723931788](https://github.com/Faust-S/knowledge/actions/runs/44723931788), на момент фиксации IN_PROGRESS |
| Один огромный Windows сценарий как единственное свидетельство выпуска | Сборка One Dist, Tauri, модель, GUI, K03, Repair/Rollback смешаны; поздняя ошибка обнуляет установленную квалификацию | Разделять доказательства по фазам и хранить их под одним SHA кандидата. Полный G4 остаётся сквозным итогом, но отладка не повторяет всю архитектуру |
| Разные Windows PowerShell среды и повреждение тестового исходника | [#44628590076](https://github.com/Faust-S/knowledge/actions/runs/44628590076) FAIL до создания witness из-за ошибочного текстового патча | Восстановлен исходный PowerShell Agent `b5b9fda7`; новый parser preflight именно PS 5.1 PASS [#44710719858](https://github.com/Faust-S/knowledge/actions/runs/44710719858) |
| Один общий код для разных падений `llama-cli` | [#44710719858](https://github.com/Faust-S/knowledge/actions/runs/44710719858): `QWEN_EXECUTE / MODEL_TRY / MODEL_PROCESS_FAILED`; native returncode терялся | В оригинальном Agent добавлена строго ограниченная классификация NTSTATUS: память, зависимости, неподдерживаемая инструкция, крах процесса. Непознанный код по-прежнему generic; ни stderr, ни промпты не публикуются |
| Ручные тексты отстают от исходников | Разные старые HEAD и метки `IN_PROGRESS` оставались в реестре после FAIL; устаревшая передача описывала прошлый Agent | Каноническая typed-матрица `current_release`, проверяемая без приватных токенов и без новой runtime-системы; историю хранить отдельно в том же документе |
| Избыточная продуктовая привязка к Atlas | У generic accepted Result ошибочно требовался Atlas WorkRef | Исправлено исходно и квалифицировано [#44620132894](https://github.com/Faust-S/knowledge/actions/runs/44620132894); не возвращать Atlas в обязательные G4-гейты |
| Поздний выход из реальной пользовательской операции | CI способен строить Setup Core, но до стабильного установленного Qwen/Review/Cold остаются отказы | Сначала довести минимальный установленный путь до повторяемого PASS, затем добавлять дополнительные опциональные программы, а не новые абстрактные обёртки |

**Запрет на ложное исправление:** нельзя снижать критерии успешной установленной модели, выдумывать квитанцию ACCEPT, применять Kernel повторно после потерянного ответа, подменять оригинальный `.iwxa`, использовать одну Windows учётную запись как двух владельцев или объявлять `SOURCE_PASS` готовым G4.

### 6.3. Строгий план работ и критерии завершения

| Приоритет | Владелец/направление | Что сделать | Условие приёмки |
| --- | --- | --- | --- |
| **P0** | Agent + One Core + Setup Core | Разобрать реальный `MODEL_PROCESS_FAILED` по классу native exit; исправить установленный Qwen/GUI Review/Cold. Отделить ранние parser/pin checks от тяжёлой сборки | Точное оригинальное приложение установлено, исполняет настоящую локальную Task, Human Review, экспорт/импорт `.iwxa`, два холодных readback; Setup Repair/Rollback без потери данных. PASS на одном наборе SHA |
| **P1** | Original T3 Owner + установленный Agent и Admin | Отдельный сотрудник на втором Windows SID, D1 подписанные Task и права, genuine Agent Result, отдельный настоящий Win32 Human ACCEPT и отдельный Human APPLY | Оригинальный подписанный Receipt, Kernel Object/Event, две независимые холодные проверки, потерянный ACK читается без второй отправки |
| **P2** | D6_GENERIC, исходный получатель без Atlas | На уже существующем получателе выполнить оригинальную авторизованную операцию над выбранным accepted Result; обеспечить durable owner readback и lost-ACK recovery | Подписанное D1 разрешение, независимое сохранение Result у получателя, повторное cold чтение; `workRef` отсутствует |
| **P3a** | Publisher PERSON D7 | Подключить существующий нативный original signer и независимого установленного consumer, не затрагивая TEST-профили | Issue, renew, STATUS, revoke, replay refusal и холодный readback на точных исходниках |
| **P3b** | Activity D2 + Exchange D4 | Установленная read-only Event/Activity проекция и явный owner-approved derived Result; действующая исходная Exchange передача между субъектами | Ни исходная Workspace, ни чужие данные не мутируют без D1; получатель читает собственную квитанцию и точно выбранные байты |
| **P3c** | BLI/D5, один веб-домен | Самодостаточный T3 dist из одного site checkout с явным T3 переключателем, установкой модели после согласия и реальной аппаратной WebGPU-генерацией | Тот же выпуск воспроизводит offline cold restart, повторную генерацию и все оригинальные T2 Workspace/Result операции без dev-repositories |
| **P4** | Universal G4 | Заморозить один набор SHA, связать точные доказательства B0 и D1-D7, провести независимую установленную приёмку | Все `current_release.required_gates.*.installed = PASS`; только тогда `T3_READY=true` и `G4=ACCEPTED` |
| **P5** | Доменные владельцы по одному сайту | Переносить T3 из пилота в доменный release лишь после выполнения его собственных продуктовых acceptance criteria | Русская эталонная версия и действующий T2 не ломаются; есть rollback, холодный импорт, самодостаточный dist и пользовательское согласие |

**Параллельность:** P0 и P1 последовательны до настоящего installed Agent результата. Но P3a (Publisher), P3b (Activity), P3c (одно автономное доменное исследование) могут двигаться параллельно со сквозным D3. Нельзя подменять их частные PASS общей приёмкой.

### 6.4. Решение о готовности и миграции доменов

- **Единая архитектура T3:** годится для продолжения; курс исправлен, новый Core/Kernel не требуется.
- **Source One Core и D6_GENERIC:** доказательства есть. **Установленный G4:** ещё не принят, потому что исходные/установленные тесты и реальные пользователи не закрывают один и тот же путь.
- **Admin Center:** установленный owner enrollment/DPAPI cold PASS, но полный отдельный native ACCEPT/APPLY HOLD.
- **Agent:** производственный выпуск пока не принимается из-за установленного Model/GUI/Cold; source подписанного D3 ранее PASS на старом SHA, точный current SHA повторно квалифицируется.
- **Publisher PERSON и Activity:** инженерные исходники есть, полноценные установленные контракты не квалифицированы.
- **Atlas:** отдельная работоспособная предметная программа, G4_GENERIC не зависит от её файлового обмена.
- **Веб-домены:** продолжать выпуск стабильного T2. T3 пилот возможен в отдельной ветке, но **не включать по умолчанию** и не выдавать экспериментальную модель за готовую офлайн-систему.

### 6.5. Одна точка управления фактами, без новых handoff-файлов

1. Текущая истина: `handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json.current_release` с `pins`, `required_gates`, `qualifications`, `verdict`. Старые наблюдения в том же JSON явно исторические.
2. Единственный постоянно актуализируемый **план**: этот раздел инженерного аудита; повторные независимые `*_NEXT_CHAT*.md` не выпускать без необходимости смены чата.
3. `AGENTS.md`: короткий маршрутизатор к машинному реестру, плану и действующему контракту, не отдельная копия статусов.
4. Каждый новый PASS должен иметь repo+branch+HEAD/TREE, точный CI run/attempt, scope `SOURCE` / `INSTALLED` / `CROSS_PRODUCT` и доказанный финальный checkpoint.
5. Каждый FAIL сохраняет старый достоверный PASS на его исходном SHA, но не переносит его на новую ревизию. Код меняется только после фиксации воспроизводимой причины.

## 7. Установленные рубежи и следующая операция (20.11.2026)

Вводить в эксплуатацию G4 **нельзя**. Однако два независимых оригинальных десктопных продукта теперь прошли нативные испытания на одном фиксированном исходном One Core:

| Проверка | Ровно подтверждённый уровень |
| --- | --- |
| [#44723931788](https://github.com/Faust-S/knowledge/actions/runs/44723931788) | Настоящий установленный Agent 0.6, оригинальный T2/T3 One Dist `f42e53cd`, Qwen3, локальная Task, нативный Human Review, холодное восстановление, Setup Core Repair/Rollback: `INSTALLED_PRODUCT_PASS`; **не** корпоративная операция |
| [#44726573571](https://github.com/Faust-S/knowledge/actions/runs/44726573571) | Настоящий установленный Admin Center `2628c4bc` с оригинальным подписантом T3 `1a826763` и тем же One Core `f42e53cd`; реальная Workspace без Atlas, Win32 enrollment NO/YES, независимое DPAPI и холодный перезапуск: `INSTALLED_PRODUCT_PASS`; **не** корпоративный ACCEPT/APPLY |
| [#44723931657](https://github.com/Faust-S/knowledge/actions/runs/44723931657) | Исходный подписанный корпоративный D3 на точно том же Agent `21505e81`: 26/26 Windows PASS, включая два SID, original T2 Kernel APPLY и два source-cold; `SOURCE_NATIVE_PROCESS_PASS`, **не** installed GUI |
| [#44726886171](https://github.com/Faust-S/knowledge/actions/runs/44726886171) | Отдельная настоящая Windows SID, второе нативное окно в той же интерактивной сессии, его UIA из процесса менеджера; `OS_PRECONDITION_ONLY_NOT_INSTALLED_D3` |
| [#44727367869](https://github.com/Faust-S/knowledge/actions/runs/44727367869) | Повторная установка оригинального Agent Setup Core под вторым настоящим Windows SID + его нативный GUI, холодное открытие и удаление с сохранением данных: **IN_PROGRESS при фиксации**, не считать PASS раньше завершения |
| [#44727824593](https://github.com/Faust-S/knowledge/actions/runs/44727824593) | Публичный контроль machine ledger, всех точных SHA и несовпадающих уровней acceptance: SUCCESS |

**Следующая строгая проверка не должна быть механической суммой этих результатов.** Требуется единый установленный сценарий под двумя SID: оригинальный Center выпускает подписанные Task и права D1, второй установленный Agent получает Task через существующий `corporate-work-control`, выполняет её своей локальной моделью и сохраняет Human-accepted Result, оригинальный `OriginalEmployeePort.prepare`/Export производит подписанный `.iwxa`. Затем **тот же самый** установленный Center получает результат через native file picker, проверяет original Reconciliation, показывает `d3Decide` с отдельным физическим Win32 YES/NO, сохраняет оригинальную ACCEPT квитанцию, после чего показывает **отдельный** `d3ApplyAccepted` и применяет строго в original T2 Kernel. Завершение подтверждают ровно два новых независимых холодных readback исходного Object/Event. Lost-ACK = read-only recovery, без повторной отправки.

Оригинальный WebView2 интерфейс Agent уже содержит `desktop/src/corporate-work-control.tsx`, а Center - `src/CorporateEmployeeEnrollment.tsx` и `src/CorporateD3Panel.tsx`; сами signed ports и две отдельные native consent ветки находятся у собственных владельцев. Не создавать второй клиентский transport, второй signer, Store или Kernel. Atlas не обязателен. Не использовать существующие source фикстуры для имитации установленного Human Review.

**Текущий алгоритм:** дождаться конкретного результата [#44727367869](https://github.com/Faust-S/knowledge/actions/runs/44727367869), при отказе исправить адресно его установленную причину. После реального guest native PASS расширить публичный квалификационный маршрут до одной подписанной операции двух установленных программ на фиксированном One Core. Параллельно не блокировать разработку и T2-релизы доменов; универсальный D6_GENERIC, установленный D7_PERSON и завершающий D5 browser-dist должны закрываться самостоятельно. Один общий G4 только после всех восьми машинных installed-гейтов и отдельной независимой финальной приёмки.
