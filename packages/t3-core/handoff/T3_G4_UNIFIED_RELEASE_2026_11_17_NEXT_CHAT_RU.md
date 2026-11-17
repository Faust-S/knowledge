# IWXA T3 G4: единая миграция разработки в новый чат

## Актуальный исполняемый этап: оригинальный продуктовый Agent One Dist

**Это текущая точка работы, все ранние SHA ниже исторические.** Единственный общий T3: `Faust-S/knowledge/packages/t3-core`; наследуемый T2 `Faust-S/T2@main` Kernel 0.3.6 / Runtime Contract 1.3.0; закрытый `Faust-S/T3` лишь original signed employee/Exchange, не второй Core. `T3_READY=false`, `G4=NOT_ACCEPTED`.

- **One Core `d600b698a54888d02889ac0382ca6fe9d89ec55f`:** [CI №44166726477](https://github.com/Faust-S/knowledge/actions/runs/44166726477) SUCCESS, в том числе **реальный продуктовый** `iwxa.personal-agent` One Dist из квалифицированного T2, реальный браузерный Kernel и впервые публичная компиляция WebLLM/BLI на Windows. Прежние native Windows #44163282899 и #44165213093 упали после успешной сборки Agent EXE, на `T3_D5_BLI_SOURCE_CHANGED:LocalInferenceLauncher.tsx`, поскольку Git Windows checkout подменял LF на CRLF. Исправлено только восстановлением **точного уже закреплённого Git blob** при подтверждённом line-ending эквиваленте. Семантические изменения источника не допускаются.
- **Agent 0.6 `12eec9793daf927da0811fd3f05bb7f66b65bdc1`:** реальный профиль `config/original-t2-agent-product.json`, T2 original product materialization, строгое ограничение полномочий паспортом, установленная хеш-проверка One Dist и original bootstrap, существующий Windows Setup Core. Для G4 `-RequireOriginalT3` обязателен, иначе штатный Agent может быть собран без T3. Публичный CI источник [№44167212073](https://github.com/Faust-S/Center/actions/runs/44167212073) и native installed [№44167212079](https://github.com/Faust-S/Center/actions/runs/44167212079) на этом срезе запущены; перед присвоением PASS проверить conclusion и хеши. UI теперь может раскрыть существующую подписанную T2 Workspace **в том же окне Agent** для отдельного действия создания первого Workspace по реальному D1; прежняя скрытая сцена не обеспечивала человеку этот маршрут. Само создание на оригинальном установленном Kernel ещё не квалифицировано.
- **Важная граница:** оригинальный D6 publisher намеренно отказывает при отсутствии Workspace до резервации записи. Ни Worker, ни адаптер не могут автоматически создать её через READ; требуется отдельное штатное D1 ACTION `t1.createWorkspace`, действительные корпоративные права и Human Review через уже имеющуюся подписанную Workspace.
- **Дальнейший критический результат:** подлинный установленный Agent + исходный приватный корпоративный подписант + исходный T2 Kernel Workspace -> реальный Task/accepted Result -> original Kernel Object/Event -> оригинально подписанный `.iwxa` -> отдельно установленный Atlas 0.9, только его нативный U05 Store, два cold-read процесса. Текущий файл D6 несёт адресную подписанную *ссылку/provenance* Result, не автономное содержимое; потребитель не вправе назвать его полноценным переносом без отдельного scoped recipient Exchange. При lost ACK никаких несанкционированных повторов.
- После D6: Admin 0.3 D1/D3 отдельные ACCEPT/APPLY, Publisher 0.5 D7 PERSON STATUS/revoke, аппаратная offline WebGPU D5 cold restart, общий единый G4. Приватные Actions запрещены, продукты stable/main не изменять. Codex только недоступный установленный GUI и независимая финальная приёмка.


## Дальнейшее внедрение D6: граница оригинального Kernel и итоговая UX-семантика

- Agent 0.6 `Faust-S/iwxa-personal-agent@f44ebe3cc12457740b03a68abe0f08be4fb8b3ce`: экран Atlas D6 доступен только при действительном `originalD6HostState=ORIGINAL_KERNEL_ATTACHED`, а не по одному корпоративному приглашению. Предыдущий коммит `ae7e03a9` исправил RU/EN язык: подписанный `.iwxa` в этом профиле несёт только ссылку на принятый Result и его происхождение, не содержимое Result. Это правило не заменяет native Atlas U05 и не даёт прав адресату автоматически.
- [Публичный адресный исходный CI №44156510664](https://github.com/Faust-S/Center/actions/runs/44156510664) **SUCCESS**, точный pinned Agent `f44ebe3c`, только source. [Windows native CI №44156510700](https://github.com/Faust-S/Center/actions/runs/44156510700) при последней проверке выполнялся; он не включает private original issuer и не завершает независимый Atlas G4.
- [Нормативный T2/One Core CI №44155065963](https://github.com/Faust-S/knowledge/actions/runs/44155065963) **SUCCESS** на квалифицированном исходном builder `f952f367`. Genuine product-owned `iwxa.personal-agent` T2 вход из Factory пока **не материализован**, а установленный native signed D6 ещё не проверен.
- Следующая работа только в существующих владельцах: реальный Agent T2 Product Completion -> original signed compiled One Dist -> `Agent -RequireOriginalT3` -> genuine original private D1/D6 owner -> native `Atlas 0.9` recipient/own U05 -> cold native readbacks. Реальный перенос выбранных данных нельзя выдавать за ссылку: передаём либо явно ссылку, либо под контролем original Exchange отдельную утверждённую выборку с правом получателя. Не создавать второй Kernel, signer, Store, Task Engine или формат.

## Системный аудит и продуктивная доработка 17.11.2026 (приоритетная сводка)

**Релизная реальность:** One Core `Faust-S/knowledge/packages/t3-core` остаётся единственным исполняемым общим T3. Нормативный `Faust-S/T2@main` неизменен. Privileged original employee/Ed25519/Exchange остаются у закрытого владельца, без приватных Actions. Agent 0.6, Admin 0.3, Atlas 0.9, Publisher 0.5 сохраняют собственные модели и нативный Store; Activity и сайты развиваются отдельными предметными потоками. `G4=NOT_ACCEPTED`, `T3_READY=false`.

**Верифицированные исправления продукта:**

1. `Faust-S/iwxa-personal-agent@d403bdf009b21e3b62c13910be2f1d5c71dd8c7b`: исходный квалифицированный T2 One Dist не может быть подменён реальным, но **испытательным** `integration.workspace.iwxa.test`; требуются `domain_id=iwxa.personal-agent`, согласованные service/passport, Runtime 0.3.6/Contract 1.3.0. Релизный флаг `-RequireOriginalT3` в штатном Windows Setup Core отклоняет G4-сборку без трёх исходных проверяемых inputs. Источник: [Center source CI №44154074283](https://github.com/Faust-S/Center/actions/runs/44154074283) **SUCCESS** на точном Agent HEAD. [Native Windows №44154074362](https://github.com/Faust-S/Center/actions/runs/44154074362) **SUCCESS** на той же ревизии, но это обычная нативная сборка, НЕ запуск установленного Original T3 D6.
2. `Faust-S/knowledge`: новый `packages/t3-core/scripts/build-original-agent-one-dist.mjs` вызывает **существующий** `assembleSignedControlDist` с original T2 qualified artifact и `installedOriginalAgentD6`, фиксирует исходную квитанцию и не допускает тестовый Host. Входы: `--t2-dist <original-qualified-agent-product-dist> --t3-build <compiled-t3-ui> --output <new-one-dist-outside-repos> --receipt <new-receipt-outside-repos>`. Этот маршрут пока **SOURCE CANDIDATE**; source CI на новый код необходимо проверить по live SHA. Он НЕ изготовляет квалифицированный T2 product input из фиктивных данных.
3. `knowledge/AGENTS.md` больше не закрепляет устаревший SHA как действующую вершину: читает live release ledger и текущие CI. На `Faust-S/iwxa@main` реестр `coordination/repositories.json` содержит 9 записей; полная карта 42 — в отдельной `knowledge/2026-10-02-system-atlas`. Не брать неполный `main` за актуальную полную архитектуру и не менять его без отдельной синхронизации владельца.

**Нерешённая архитектурная проблема, не заменять тестами:** публичный D6 sender и оригинальный signed carrier переносят в основном *ссылку, происхождение и квитанцию* выбранного Result. Это ещё НЕ доказывает автономную передачу **содержимого выбранной части Result** в независимо установленный Atlas после отключения исходного Agent. Для сценария «перенести данные» нужен оригинальный scoped recipient import/verify выбранной проекции, без новой подписи и без нового формата `.iwxa`; для сценария «передать только ссылку» интерфейс и статус обязаны называть его ссылкой. Atlas standalone пока не доказал независимый signed native receive; его отдельный native U05 CAS нельзя осуществлять из Agent Tauri.

**Релизный путь:**
- Получить реальный product-owned `iwxa.personal-agent` T2 Dist из существующей нормативной Factory, затем собрать его штатным `build-original-agent-one-dist.mjs`, передать dist/receipt в существующий Agent Setup Core с `-RequireOriginalT3`. Никакого тестового integration Host.
- Установить Agent и оригинального private employee/issuer, подтвердить T2 Kernel WebView2 relay, оригинальные signed D1 DATA + ACTION и реальный Human-accepted Result.
- Передать оригинальный подписанный `.iwxa` на **отдельно установленный Atlas 0.9**: определить и квалифицировать фактическую содержательную семантику передаваемого Result, отдельный original recipient verification и `atlas_open/atlas_commit` только из Atlas Tauri; два независимых холодных readback.
- Только после нативного D6 закрыть Admin D3, Publisher D7, аппаратный D5 offline/cold и общий G4. Домены последовательно, один сайт/домен за раз. Исходные CI =/= product/G4.


Дата: **17.11.2026**. Статус **SOURCE_G4_CANDIDATE, INSTALLED_G4_NOT_ACCEPTED, T3_READY=false**.

## Актуальный инкремент установленного D6: original Kernel origin + One Dist Setup (17.11.2026)

**Этот раздел приоритетнее исторических SHA и незакрытых действий ниже.** Сверить живые HEAD до каждой новой записи. Статус: `T3_READY=false`, `G4=NOT_ACCEPTED`.

**Действительно сделано в исходниках:**
- Единый публичный T3 `Faust-S/knowledge@2d6079132e768437854c4663b9e452119af98dcd`: [CI №44146898558](https://github.com/Faust-S/knowledge/actions/runs/44146898558) SUCCESS, в том числе исправленный exact `frame-ancestors` для вложенной цепочки установленный Agent -> отдельный T3 UI -> оригинальный доверенный Kernel. `T2@main` не менялся.
- Оригинальный приватный T3 `Faust-S/T3@b8cd77d802e5a4f03292aa58b36bd524e9671ca2`: существующий Control Host передаёт точный установленный parent origin в оригинальный Kernel, используя действующие original D1 Access/relay и private D6 publisher. Приватные Actions запрещены и **не запускались**.
- Agent 0.6 `Faust-S/iwxa-personal-agent@c2fe4f07e1de5238823dc6dca7d52d418205ab4b`: устранена реальная ошибка Python `urllib.parse.ParseResult`: поля `origin` там нет, использовать `parsed.scheme` + `parsed.netloc` (коммит [6164e43c](https://github.com/Faust-S/iwxa-personal-agent/commit/6164e43c96d8985e56b7c010506dc1f11222e974)). [Публичная исходная проверка №44151060269](https://github.com/Faust-S/Center/actions/runs/44151060269) **SUCCESS** на `Agent@6164e43c`, включая оригинальные Task/Result/ACK и адресные тесты локального T2 origin и упаковки One Dist. Эту проверку нельзя приписывать более поздним изменениям.
- В исходной ветке Agent реализовано *опциональное* включение в **существующий Setup Core** публичного pinned One Core + оригинального Agent-enabled T2 One Dist с тем же `runtime.js` 0.3.6. Дополнительные параметры `-PublicT3CoreRoot`, `-PublicT3OneDistRoot`, `-PublicT3OneDistReceipt` проходят через `tools/build_setup_core_windows_candidate.ps1` -> `qualification/phase1/build_native_windows_setup_candidate.ps1` -> `tools/qualify_explorer_windows_phase1_package.ps1` -> исходный `tools/build_explorer_package.py`. Пакет использует прежний манифест/SHA-256, а Setup сверяет материализованные исходные файлы. Private T3 issuer/signers и employee credentials в него **не включаются**. `tools/t3_one_core_payload.py` проверяет HEAD, clean `src/t3` checkout, original builder witness, исходный квалифицированный `artifactId`, original loader/Kernel SHA и Atlas Agent-only signed schema.
- **Реальный One Dist source input:** использовать только исходный `packages/t3-core/scripts/assemble-signed-control-dist.mjs` на *подлинном квалифицированном* собранном T2, original compiled T3 UI и флаге `--installed-agent-d6`. Его полный JSON output сохранить отдельным `one-dist-receipt.json`. Нельзя изготовлять receipt или runtime из тестового fixture. Приватный подписант подключается только текущим оригинальным installed Host.
- Последняя baseline установленной Windows-проверки [№44145398792](https://github.com/Faust-S/Center/actions/runs/44145398792) SUCCESS на **более раннем** Agent. Актуальная полная установленная связка original signed T3/Atlas **NOT_RUN**. Исторический #44148670532 failed на prepare U04 public source; это не исходное отказное решение D6.
- Изменения после `Agent@6164e43c` (строгая квалификация артефакта, чистота public One Core, проверка stage) пока не имеют подтверждения полного CI; **не присваивать им PASS до нового запуска**.

**Следующий исполняемый блокер:** собрать **настоящий** квалифицированный T2 Agent One Dist, передать три оригинальных build input в existing Agent 0.6 Setup Core, установить и открыть Agent с действительным original private corporate employee D1 READ/WRITE и `recipient:iwxa.atlas`; создать и Human-accept реальный Result, подтвердить исходный Kernel Object/Event + original Ed25519 carrier; сохранённый `.iwxa` принять именно независимо установленным Atlas 0.9 через его native Tauri AppHandle/U05 CAS, затем два **отдельных** cold-read Atlas Store. Пока этого нет, D6/G4 HOLD. После этого D3 Admin, PERSON D7, аппаратный D5 offline и общая G4.

## Первое действие в новом чате

1. Полностью прочесть этот файл и `AGENTS.md`, затем живой `packages/t3-core/handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`. Не доверять старым SHA в исторических документах.
2. Сверить live HEAD/TREE, коммиты с момента наблюдения и завершённые CI **до** записи. Ветки параллельно меняются. Не делать force-push и слепые слияния.
3. Начать именно **функциональную работу** над установленным original T3 D6 в Agent, а не создавать новые отчёты или отдельные тестовые подсистемы. Сохранять общую цепочку B0/D1–D7/G4.

## Канонические владельцы и проверенные исходники

| Владелец | Рабочая ветка | Зафиксированный SHA / доказательство |
|---|---|---|
| **Единый T3** | `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection`, `packages/t3-core` | `cf03944c9fb87b392bcf52d5c2a3cfb22c7e0d16`, [source CI #44124552421](https://github.com/Faust-S/knowledge/actions/runs/44124552421) SUCCESS (test/real-host/windows-credential) |
| **Нормативный T2** | `Faust-S/T2@main` | `9c64951cd78411283e8a416641c36d71e169fc1d`, оригинальные Kernel 0.3.6 и Runtime Contract 1.3.0 |
| **Оригинальный приватный T3 D6** | `Faust-S/T3@work/2026-11-17-t3-original-agent-atlas-d6-publication-ledger` | `2e36d696d689513ade5c5e1f0438eda5451072a7`; signed original Reconciliation/ledger/Exchange; private Ed25519 end-to-end NOT_RUN |
| **Agent 0.6** | `Faust-S/iwxa-personal-agent@work/2026-11-15-agent-0-6-development` | `34d8f1a10b552f1d0c4108e012414648e71ce0a0`; все 108 D6 commits перенесены fast-forward; [Windows installed #44125527869](https://github.com/Faust-S/Center/actions/runs/44125527869) SUCCESS |
| **Admin Center 0.3 D3** | `Faust-S/Center@work/2026-11-15-t3-d3-native-preapply-refusal` | `2b9fc0fed7ccc3f06ab212bee654e90db2e865dc`; independent employee и одно React root; [Center CI #44124983894](https://github.com/Faust-S/Center/actions/runs/44124983894) SUCCESS |
| **Atlas 0.9** | `Faust-S/Atlas@work/2026-11-16-atlas-0-9-t3` | `dbb6606667cf0b2f6189ebb6f2fd1f70da197db6`; [native Windows #43979032675](https://github.com/Faust-S/Atlas/actions/runs/43979032675) SUCCESS |
| **Publisher 0.5** | `Faust-S/Center@work/2026-11-10-publisher-0.5` | `3397d4d7e599760a07662e766ed3e4cf6ecc2a23`; [public CI #44087416943](https://github.com/Faust-S/Center/actions/runs/44087416943) SUCCESS |
| **Activity** | `Faust-S/knowledge@work/2026-11-10-activity-base-anonymizer` | `2383c58f88901f16aa2a5fa780de447dba3d4750`; native signed derived production NOT_ACCEPTED |
| **D02 browser pilot** | `Faust-S/club.iwxa.ru@work/2026-11-11-d02-t3-domain-autonomy` | `868bf42f0462268ae82da6db62443b90606e77fe`; installed offline browser T3 NOT_ACCEPTED |

**Релизные ветки Agent 0.5 и Atlas 0.8, нормативный T2, T2 Store/Exchange и собственные Store программ не изменять.**

## Подтверждённая межпрограммная проверка

[Center public Windows #44125528014](https://github.com/Faust-S/Center/actions/runs/44125528014) SUCCESS: точные исходные pins Agent `8f4a130e`, T3 `8a161538`, Atlas `dbb66066`. После неё Agent добавил только 3 документационных/тестовых коммита, T3 — дополнительные source-тесты; исполняемые D6 owner ports между этими срезами не изменились. Проверены original public T3 D6 sender, Atlas publisher contract, native recipient *с test doubles*, Agent Task→Result/Human Review, IPC и lost ACK recovery. **Это SOURCE, не реальный подписанный установленный G4.** Центр не публиковал приватные Agent-исходники/EXE/данные; artifacts этого source-run: 0.

В новом прогоне CI не заменять исходные отдельные signed owner/native/grant proofs объектами JSON или фиктивными `hasOperation`/`sessionInfo`. Установленный Atlas Store должен получать native `atlas_open/atlas_commit` **из своего Tauri AppHandle**, а не из процесса Agent.

## Что закончено по T3

- B0: преемник полного оригинального T2, один `dist/` для domain Host/Workspace/Kernel/Exchange/Lifecycle.
- D1: original signed Access/context/epoch, раздельные JIT READ/WRITE grants.
- D3: исходный Reconciliation, раздельные Human ACCEPT и Kernel APPLY, исходный readback и запрет повторной неопределённой записи.
- D4: существующий `.iwxa` и независимые каналы/получатели, без новых форматов.
- D5: браузерная локальная модель/WebLLM/WebGPU разработаны; исторические hardware probes не равны финальной гарантии установленного offline/cold restart.
- D6: оригинальный Agent accepted-result T2 профиль, реальный inherited Kernel Object/Event, source-cold readbacks, native sender и Atlas recipient source-контракты.
- D7: оригинальные age/Publisher порты и STATUS-контракты; PERSON installed signed issuer/consumer всё ещё HOLD.

## Инкремент D6 после передачи (17.11.2026)

В оригинальном приватном T3 `Faust-S/T3@work/2026-11-17-t3-original-agent-atlas-d6-publication-ledger` опубликованы адресные изменения:

- [`c961bf2f`](https://github.com/Faust-S/T3/commit/c961bf2f58b37bfb1066fe1ca355dde5f980a881): существующий `openMultiOrganizationControl` теперь делегирует исходные `originalAgentAtlasPublicationLedger`, `originalAgentAtlasEmployeeAuthority` и `originalAgentAtlasExchange` только действительной выбранной корпоративной membership, с фиксацией выбора/эпохи. Никаких новых issuer, signer, ledger, Exchange, Kernel или Host.
- [`19746616`](https://github.com/Faust-S/T3/commit/19746616c0ba78bd6d483142a5ed4aa1986601c1): адресная регрессия на отказ старых D6 ledger/authority/Exchange портов после переключения организации и в PERSONAL.
- **Доказательство:** исходники и два коммита зафиксированы; регрессия пока `NOT_RUN` (локальный checkout приватного GitHub из доступного контейнера недоступен). Private Actions не запускались. Это не нативная или установленная D6 приёмка.

Обнаружена следующая исполняемая граница: `Agent runtime/t3_original_employee_worker.mjs` использует `openInterop` как отдельный оригинальный employee owner и уже содержит обратный read-only callback `readAcceptedForPublication`. Он не получает оригинальный Kernel из доверенного browser realm, не вызывает `createInstalledOriginalAgentAtlasPublisher` и не предоставляет исходный `sourceOwner` Agent Core. У оригинального `interop/server.mjs` есть служба исходного подписанного Control и isolated T3 UI, но она пока не подключает `originalKernelNativeRelay` и D6 фабрику в установленном Agent. Нельзя объявлять работающую интеграцию, лишь смонтировав новые делегаты.

**Следующая правка кода**: внутри единственного штатного installed original T3 Host связать существующий trusted Kernel realm с `createOriginalKernelNativeRelay`, а затем с подписанной D1 original фабрикой и `createInstalledOriginalAgentAtlasPublisher`; передать полученный native-only `sourceOwner` в действующий Agent Core. Не создавать второй Control/HTTP server или отдельный Kernel. После этого провести настоящий Atlas U05 native CAS и два отдельных cold-read. До этого `T3_READY=false`, `G4=NOT_ACCEPTED`.

## D6: функциональный инкремент original native Host и подписанного selected Result (17.11.2026)

**Исполняемый код разрабатывался, релиз G4 не принят.** После предыдущего среза первоначальные модули ORIGINAL T3 и Agent получили новую нативную связку. Все HEAD перечислены ниже по состоянию текущей сверки; перед следующими коммитами заново прочитать live SHA/CI.

- **Оригинальный приватный T3**: `Faust-S/T3@work/2026-11-17-t3-original-agent-atlas-d6-publication-ledger`, `e30c86f1`. Существующий оригинальный `interop/server.mjs` принимает ONE Core Control Handler + `original-kernel-native-relay.mjs`, монтирует настоящий T2 Kernel только из браузерного trusted realm и связывает существующую фабрику `createInstalledOriginalAgentAtlasPublisher` с ранее открытым employee Control. Подписанный доступ READ/WRITE делегируется исходному Access owner; переключение контекста обрывает старый relay и publisher. Обычный личный Control не заменён вторым Host. Дополнительный independent `recipient:iwxa.atlas` DATA grant теперь выдаётся только по отдельной опции оригинального Admin invitation, с исходными READ/WRITE требованиями. Исходный private Exchange может перечитать из оригинального Reconciliation ровно один уже подписанный архив `.iwxa` после оригинальных JIT и Kernel/Event readbacks, без нового подписания/Kernel записи. Добавлена точная source-регрессия на подписанные байты после cold reopen. **Private native suite NOT_RUN**.
- **Agent 0.6**, `Faust-S/iwxa-personal-agent@work/2026-11-15-agent-0-6-development`, `186a2bd0`: существующий employee Node worker монтирует вышеперечисленный original Host только при наличии установленного original One Core/One Dist из доверенных native-путей; отсутствие установленного T2 Kernel не является успехом. Agent Core получает native sourceOwner лениво через существующий worker; `readAcceptedForPublication` читает только подлинный Human-accepted Agent Result; отдельное human disclosure consent потребляется один раз. Подтверждённый оригинальный архив можно сохранить исключительно в новый `O_EXCL` файл с SHA-256 readback, **без повторной подписи и записи Kernel**. Добавлен штатный пользовательский маршрут Agent corporate screen в том же Tauri окне с scoped browser realm. Версии npm/package-lock/Tauri/Cargo/Cargo.lock согласованы как `0.6.0` только в ветке разработки, стабильная 0.5 не изменялась.
- **Квалификация:** публичный Center source #44144055828 **SUCCESS** только на промежуточном Agent `f1b6407`; более поздние подписанные file-save изменения туда не входили. Новый pinned Agent `186a2bd0` запущен через разрешённый ephemeral read-only public Center CI, source #44145398778 и installed native #44145398792; при последнем наблюдении оба находились в работе. Private T3 в публичный checkout **не передавался**; никаких приватных Actions или опубликованных приватных артефактов. Старый native #44142543824: настоящий Tauri EXE/install/task UI PASS, но полная проверка FAIL (draft restore NOT_TESTED). Не повышать до installed D6 по успешному build/UI.
- **Чего не хватает:** установленный One Core/One Dist должен быть действительно доступен из того же штатного Host; требуется настоящий private Ed25519 installed publisher с оригинальной signed DATA и ACTION JIT, signed Result .iwxa и физически независимый Atlas 0.9 U05 (его **собственный** Tauri AppHandle/Store). Ни пользовательский файл, ни исходная проверка подписанных байтов ещё не заменяют независимое Atlas native получение и два cold-read. Admin D3, Publisher PERSON D7, D5 WebGPU offline остаются отдельными незакрытыми выпускными этапами.

**Порядок дальше:** квалифицировать установочный Host/Kernel с реальным original T3 publisher; обеспечить физическую передачу оригинального подписанного файла во второй Atlas process и доказать CAS/native cold reads; затем отдельно Admin D3, Publisher D7, D5 и общий G4. Приватные Actions запрещены. Не использовать имитацию `hasOperation`/`sessionInfo`, фиктивные квитанции, новые Core/Host/Kernel/Exchange/Store.

**Граница:** `T3_READY=false`, `G4=NOT_ACCEPTED`.

## Главный функциональный блокер

Текущий `runtime/daily_driver_engine.py` в Agent 0.6 создаёт `InstalledOriginalAgentResultOwner` с `original_t3_source_owner=None` по умолчанию. Это правильно для личного Task. Однако штатный `runtime/t3_original_employee_worker.mjs` уже читает original signed Task и Control owner, **но не содержит настоящую установленную T2 KernelFacade Runtime 1.3.0**, не соединён с доверенным WebView2 original Kernel realm и не монтирует приватный `interop/atlas-result-host-composition.mjs#createInstalledOriginalAgentAtlasPublisher`. Это **не исправляется** моковым Kernel.

### Точный следующий инкремент

1. Найти в установленном Agent штатный оригинальный Host/браузерный Kernel realm и обеспечить **один** оригинальный подписанный T2 Kernel with `t1.getWorkspace/t1.getObject/t1.listEventsSince/t1.commitObjectGraph`; использовать уже разработанный `packages/t3-core/src/t3/original-kernel-native-relay.mjs`, а не писать новый HTTP/IPC/Kernel.
2. В существующем original native Host приватный T3 `createInstalledOriginalAgentAtlasPublisher` связать с оригинальными originalEmployeeControl, signedKernelAccessPortFactory, originalSubjectKernelBinding, trusted publisher, `InstalledOriginalAgentResultOwner.readAcceptedForPublication`, настоящим ledger+Exchange и отдельным Human disclosure consent.
3. Передать полученный **только доверенный native sourceOwner** в существующий Agent Core `original_t3_source_owner` (или его уже действующий lazy binding), без UI-возможности выбирать signer/grant/Kernel Object или подставлять фальшивую квитанцию.
4. Получить реальный Result, прошедший original Agent Human Review → original T2 Object/Event → original подписанный selected-result `.iwxa` с оригинальными recipient grants → independent Atlas 0.9 U05 CAS Decision → два **физически независимых** холодных чтения Atlas Store. Потеря ACK = только read-only Reconciliation, нет повторной записи.
5. После живого D6: отдельно квалифицировать Admin D3 (signed Task→Agent Result→ACCEPT→отдельный APPLY→двойной Kernel cold read), Publisher D7 PERSON licence/STATUS/revoke, D5 GPU/offline cold restart, затем G4.
6. До выпуска Agent 0.6 согласовать npm/Tauri/Cargo/Setup Core versions. В разработке 0.6 до сих пор есть manifest `0.5.0`; **нельзя выдавать такой пакет за стабильную 0.5**.

## Не повторять ошибочные направления

- Не создавать дополнительный T3 EXE, Kernel, Store, IAM, Graph, Task Engine, Exchange, signer или новый формат `.iwxa`.
- Publisher не обязан подключаться к Agent ради работы Atlas: D7 лицензии и D6 предметный Result — независимые механизмы.
- Atlas не является источником Agent Task/Result, T3 подписи или корпоративного разрешения; Atlas подтверждает и сохраняет только собственные изменения.
- Приватные Actions запрещены. Доступ в согласованный public Center CI разрешён только для ранее согласованного ephemeral read-only Agent; не расширять его автоматически на private T3. Приватные source/output/logs/binaries не публиковать.
- Успешный public Center Windows, Agent GUI или исходный `real-host` нельзя считать сквозным приватным Ed25519 installed E2E.
- В одном инкременте один владелец кода; отдельные рабочие ветки других программ не перезаписывать, CodeX — только для недоступной GUI/независимой приёмки.
- Не тратить время на повторные тесты уже квалифицированного кода, если не было изменений; после каждого адресного исправления достаточно точной регрессии, комплексная матрица — для настоящего G4-кандидата.

## Критерий выпускной приёмки

`T3_READY=true` только если **в одном зафиксированном наборе установленных программ** подтверждены подлинная original D1 подпись и права, original D3 corporate ACCEPT/APPLY, D6 Agent selected Result + signed original Exchange + Atlas U05 native write + два cold reads, отдельный Publisher D7 PERSON STATUS/revocation, D5 локальный hardware offline restart, неизменность нормативного T2, единый `dist/` и отсутствие повторных writes после потерянного ACK. Пока **T3_READY=false / G4=NOT_ACCEPTED**.

## Командный промпт для нового чата

«Продолжай самостоятельную инженерную разработку единого IWXA T3 непосредственно в GitHub. Первым действием полностью прочитай этот файл, `AGENTS.md` и `G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`; обнови live SHA/CI, не опирайся на исторические значения. Начни с реального установленного Agent original T2 Kernel Host и приватного signed D6 sourceOwner, а не с новых документов или проверок. Не создавай новых Core/Host/Kernel/Store/IAM/Exchange/signers/форматов и не запускай private GitHub Actions. Используй уже существующие original T3 и Agent accepted Result owner ports, заверши настоящую цепочку подписанного Result в установленный Atlas 0.9 и два native cold readbacks. Затем отдельно закрой Admin D3, Publisher D7, D5 offline hardware и единый G4. После каждого исправления публикуй точный коммит и достаточную проверку; в конце обновляй этот handoff и реестр. Никогда не объявляй T3_READY по source-only CI. Codex только для недоступного реального GUI и независимой финальной приёмки».
