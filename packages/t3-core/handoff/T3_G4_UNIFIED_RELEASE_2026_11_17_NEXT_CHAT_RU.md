# IWXA T3 G4: единая миграция разработки в новый чат

Дата: **17.11.2026**. Статус **SOURCE_G4_CANDIDATE, INSTALLED_G4_NOT_ACCEPTED, T3_READY=false**.

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
