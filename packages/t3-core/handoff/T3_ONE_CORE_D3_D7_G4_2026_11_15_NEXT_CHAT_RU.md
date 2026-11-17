# IWXA T3 One Core: передача D3/D7 -> G4 в новый чат

## Последний кодовый рубеж D6, 17.11.2026

Единый One Core `19d0fa975ef1ed69473ae95ddeaa6b21354dda98`, CI [№44091249718](https://github.com/Faust-S/knowledge/actions/runs/44091249718) **SUCCESS**: test, real-host, windows-credential. Второй двухродительский merge дополнил ранее объединенный D6 встроенным `prepareOriginalAgentAtlasGraph` с original T2 Runtime 1.3.0 `commitObjectGraph`, exact Result/Task/WorkRef, `iwxa.agent.result.published`. Сохранились original pre-dispatch inspection, atomic fresh reservation, separate native READ/WRITE grants, signed original read_receipt; D1/D3 untouched. Private original T3 Exchange `f13ff6f5` реализует signed `inspectSelectedDisclosure`, но native private tests и установленная установка не приняты. Следующий эффект должен быть на установленном одном Host, не в новом Core/сервисе. См. `G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json` и `T3_IWXA_CARRIER_PROFILE_ROUTING_2026_11_17_RU.md`.

---

## Актуализация 17.11.2026 — сквозной релизный реестр и интегрированная D6

Главный источник точного наблюдённого состояния: `G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`. Исполняемый T3 `b9c087c1` объединил D6 с D1/D3, CI №44089282076 SUCCESS (Node/real-host/Windows credential; аппаратный D5 и age в этом прогоне не повторялись). В приватном оригинальном D6 `f13ff6f5` реализована native `inspectSelectedDisclosure` до какого-либо резервирования/подписания, с проверкой отдельного подписанного recipient `iwxa.atlas` и изолированного профиля; private native tests NOT_RUN, установленный продукт HOLD. Приоритет G4: живой подписанный Employee Task→Agent accepted Result→original T3→Atlas 0.9 native Store→две холодные проверки. Не делать второй Kernel, signer, Store, Exchange или отдельный T3 EXE. Раздельные границы CORE_SOURCE_PASS, NATIVE_OWNER_PASS, INSTALLED_PRODUCT_PASS, CROSS_PRODUCT_G4_PASS не подменяют друг друга.

---

## Актуализация 17.11.2026: единый D6 Agent → T3 → Atlas и исходные квитанции

**Последний квалифицированный исполняемый коммит T3:** `3618a9b3ceeed9b67d4b04072c77b7cd69bf1e46` в `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection`.
**Публичный CI №43968382746: SUCCESS**, задания `test`, `real-host`, `windows-credential`: https://github.com/Faust-S/knowledge/actions/runs/43968382746. Нативные age / аппаратный WebGPU / внешний inference в данном запуске не повторялись; соответствующий исполняемый код не изменялся.

В единую ветку без потери D1/D3/D7 включён *один* существующий D6 sender-side контракт `src/t3/native-agent-atlas-source-publisher.mjs` из `work/2026-11-17-t3-agent06-native-source-publication`: merge `a5e2b292` (две родительские ветки), CI №43967756064 SUCCESS. Дублирующий временный `original-agent-result-publication.mjs` удалён из актуального дерева и не является исполняемым владельцем. Отдельный `read_receipt` теперь возвращает исходную `originalExchange.verifySelectedResult` квитанцию с независимой проверкой подписи и байтов, коммит `b15b5c5b`, CI №43967949173 SUCCESS.

Слой `3618a9b3` добавил обязательный original Exchange port `inspectSelectedDisclosure` и проверку `ORIGINAL_RESULT_ONLY` **до native Reconciliation reserve / оригинального Kernel commit**. Аттестация привязана к operationId, источнику, `recipientId="iwxa.atlas"`, подписанному DATA grant и факту изоляции раскрываемой Workspace. После исходной отправки должны совпадать объект и `disclosureScope`; при холодном чтении `verifySelectedResult` проверяются оригинальная подпись, архивные байты, исходный manifest и `ORIGINAL_RESULT_ONLY`. При отсутствии доказательства публикация отклоняется до записи: обычный T2 `exportPackage` не поддерживает выбор произвольного одиночного Object из смешанной Workspace.

**Функциональный маршрут исходной композиции:** `Agent Human-accepted Result` → исходный отдельный Employee `package.export` в `iwxa.atlas` → независимое Human consent → original Reconciliation `read/reserve/finalize` → оригинальный T2 `commitObjectGraph`/Object/Event → original signed `.iwxa` Exchange → native readback квитанций → Atlas U05 Decision/D6 и два холодных чтения. Нельзя считать успешным по синтетическим исходным портам.

**Оставшаяся установленная зависимость:** PRIVATE original T3/Agent Host должен подключить реальные `originalLedger.read/reserve/finalize/findByObject/findByWork/findLatestWork`; действительный `originalEmployee.verifySignedTask/authorizeAtlasExport`; установленный Agent `acceptedSource.readAccepted`; оригинальные `originalExchange.inspectSelectedDisclosure/publishSelectedResult/verifySelectedResult` с signed recipient и точным ZIP manifest; исходный T2 `KernelFacade` и отдельное согласие пользователя. Все эти порты подключаются в уже существующий native Host через `InstalledOriginalAgentResultOwner(original_t3_source_owner=...)`, **без** нового Control EXE, Task Engine, IAM, Store, подписанта, HTTP-сервиса или формата `.iwxa`. Node-only D6 sender не импортировать в браузерный Vite/WebView `dist` (использует `node:crypto`); он принадлежит доверенному установленному Host.

Приватный `Faust-S/T3@work/2026-11-16-t3-agent06-original-export-ledger-readback` подтверждает код чтения корпоративного Reconciliation `EXPORTED` и `interop.result.v2` **адресату организации**, но это не подписанная отдельная публикация в `iwxa.atlas`. Private Actions запрещены; private CI/installed E2E не засчитаны. Текущие квалификации source (knowledge, Atlas) не заменяют установленный `Agent → T3 → signed iwxa.atlas → Atlas → два холодных readback`.

**Итог:** `B0/D1–D7=SOURCE_INTEGRATION_CANDIDATE`, `D6_ORIGINAL_SOURCE_PUBLICATION=SOURCE_PASS`, `INSTALLED_AGENT_ATLAS=HOLD`, `INSTALLED_D1_D3=HOLD`, `INSTALLED_D7_PUBLISHER=HOLD`, `G4=NOT_ACCEPTED`, `T3_READY=false`.

---
## Актуальный единый исполняемый T3: независимый D1/D3 + D6, 16.11.2026

**Единый исполняемый candidate:** `Faust-S/knowledge@96ec34c298624bc88f443ab8bb5fd8f99c75a63b`,
TREE `5aaccf83a4010afd74805c611b8caa5a3a8209d5`,
ветка `work/2026-11-10-t3-t2-activity-projection`.
Исходный нормативный `Faust-S/T2@main` остаётся
`9c64951cd78411283e8a416641c36d71e169fc1d`,
оригинальный Kernel 0.3.6 / Runtime Contract 1.3.0.

Объединение выполнено двумя настоящими родителями Git, без отката или
перезаписи параллельной работы:

- D6 parent [dfc76090](https://github.com/Faust-S/knowledge/commit/dfc7609026f33ce8b6206c56f22e14b7e48ae5ac)
  [source CI #43939559900](https://github.com/Faust-S/knowledge/actions/runs/43939559900)
  **SUCCESS**: исходный trusted native `receive/receipt/readback` и
  подписанный Control HTTP сохраняют достоверный `outcome=DENIED`;
  неопределённая запись остаётся `OUTCOME_UNKNOWN`, без автоматического
  повтора. Исходный `preview` предлагает `RECOVER_ONLY` после попытки,
  даже когда заново созданный owner сообщает `AVAILABLE`.
- D1/D3 employee parent [e990a9e9](https://github.com/Faust-S/knowledge/commit/e990a9e961f49928e363458d29a18ae2100b918b)
  [source CI #43920521677](https://github.com/Faust-S/knowledge/actions/runs/43920521677)
  **SUCCESS**: независимая оригинальная Ed25519 proof-identity сотрудника,
  original signed Kernel AccessRegistry proof-key admission, отдельные
  ACTION `work.prepare` и DATA `package.export` гранты,
  issuer-signed STATUS, cold reconstruct/readback.
- **Совместная точная интеграция**: [GitHub Actions #43940113584](https://github.com/Faust-S/knowledge/actions/runs/43940113584).
  Итог именно этого запуска обязателен; PASS родителей **не заменяет**
  финальный PASS merged HEAD. Изменённые файлы D3 и D6 не пересекались,
  исходный T2/Kernel/Store не менялись.

**Продуктовые границы** (не путать source PASS с установленной приёмкой):

1. Admin Center 0.3 должен смонтировать этот trusted original employee
   enrollment с настоящим issuer/manager и *другим* сотрудником Windows:
   `createOriginalKernelRegistryStatePort` /
   `admitProofCredential` /
   `createOriginalEmployeeEnrollmentOwner.begin/complete/readEnrollment`.
   Сам исходный Node Source не доставляет приглашение и не заменяет
   реальный подписанный Task/Result; отдельный Human ACCEPT и APPLY
   остаются у оригинального D3 владельца.
2. Agent 0.6 в собственной ветке
   `work/2026-11-16-agent06-original-t3-result-owner-d6`
   уже предоставляет исходные
   `currentContext/findTask/issueTask/readTask/selectAcceptedForWork/readAccepted`
   и `publishAcceptedForWork/recoverPublicationForWork`, но
   установленный оригинальный T3 `original_t3_source_owner` пока
   не доказан: требуются `read_publication`, `publish_accepted`,
   `read_published_for`, `read_published`,
   `read_receipt`, `read_latest_for_work` с настоящим
   signed Kernel Object/Event и оригинальным Exchange.
   **DATA grant сотрудника для организации НЕ разрешает автоматически**
   `package.export` в `iwxa.atlas`. Для Atlas требуется отдельное
   оригинальное подписанное разрешение и согласие.
3. Atlas 0.9 имеет существующий `iwxa.atlas` нативный D6 recipient
   и оригинальный U05 `atlas_open/atlas_commit`, но installed
   Agent → signed T3 → `.iwxa` → Atlas и два cold readback
   остаются независимым продуктовым HOLD.
4. Publisher 0.5: original issuer, installed recipient, signed
   LICENSE/STATUS, renewal/revocation и cold-status readback
   всё ещё нуждаются в отдельной installed product acceptance.
5. После действительных installed owners один frozen исходный T3,
   реальное локальное ПО, `LOCAL_ONLY`, original `.iwxa`,
   два холодных запуска и общая G4-приёмка. Запрещены второй
   Kernel/Host/Store/IAM/Exchange, отдельный T3 Control EXE,
   подмена подписанта тестовым issuer и private Actions.

`D1_D3_INDEPENDENT_EMPLOYEE_SOURCE=INTEGRATED`,
`D6_CONTROL_NATIVE_DENIAL=SOURCE_PASS`,
`D3_INSTALLED=HOLD`, `D6_INSTALLED_AGENT_ATLAS=HOLD`,
`G4=NOT_ACCEPTED`, `T3_READY=false`.
Исторические HEAD и статусы ниже сохраняются только для контекста.

---

## G4 readiness after common D7 original native refusal fix, 16.11.2026

**Answer for owner: common T3 is ready for source/Host integration, NOT yet G4-released.** Current exact T3 executable HEAD `5141942de0254ab97b97fcbfdef3317d67740d61` (parent `36387bb0`), T2 normative `9c64951cd78411283e8a416641c36d71e169fc1d`, inherited Kernel 0.3.6 / Runtime 1.3.0.

**Verified full source/Host CI:** https://github.com/Faust-S/knowledge/actions/runs/43851597400, exact `5141942d`, TERMINAL **SUCCESS**: `test`, `real-host`, `windows-credential`. The existing D7 Publisher qualification confirmed that original signed owner read-only `PERMISSION_DENIED` / `PERSON_STATUS_ROLLBACK_DENIED` now propagate as true refusal rather than falsely becoming `OUTCOME_UNKNOWN`. Unavailable receipt remains `OUTCOME_UNKNOWN`, and no retry of original Apply is added. Only `src/t3/publisher-license-handoff.mjs` and its precise existing test were changed in this commit. `metal-webgpu`, `native-model`, `native-age` SKIPPED in this run: their separate hardware/native source proofs remain at the exact earlier SHAs recorded below. Source comparison `99f3c533..5141942d` confirms unchanged D5/BLI, Kernel, Host and Exchange executable sources; the only runtime delta is this D7 holder refusal correction.

**What is still NOT technically/independently accepted:**
- **D1/D3 installed**: actual original private corporate signer and separate Admin signed Human REVIEW -> ACCEPT -> separate APPLY -> original Object/Event -> two native cold readbacks; public Center CI alone does not provide this evidence.
- **D4/D6 installed**: at least two independent installed products and actual original Agent signed accepted Task/Result `.iwxa` into the current native Atlas recipient. The public Atlas native `atlas_open/atlas_commit` binding is source-qualified; external accepted Agent owner remains pending.
- **D7 installed**: actual original private Publisher licence + signed status (including known revoke/renewal), native holder/recipient trust roots and independent cold persistence. Real upstream `age` and two public technical recipients PASS, but they are not installed issuance/holder acceptance.
- **G4 release package**: final one agreed source/owner version set, clean product installation, LOCAL_ONLY evidence, original Kernel/Exchange in a single owner `dist`, two cold starts and cross-product readbacks. The existing compiled owner-input ZIP is NOT an installed production product.

**Architectural stop:** Do not create another Kernel/Host/Store/Exchange, new T3 Windows EXE, new signer, another model engine, redundant synthetic test matrix, or a new packaging framework. The installed Owner chats finish their product bindings independently; the main T3 chat only fixes demonstrated common-contract defects, then integrates exact acceptance evidence on the same pinned G4 candidate. `G4=NOT_ACCEPTED`, `T3_READY=false` until that final native acceptance.


## D7: real native age X25519 two-recipient original Exchange, 16.11.2026

**D7_PUBLIC_REAL_AGE_TWO_RECIPIENTS=PASS** at exact public source `Faust-S/knowledge@1ba2554e13103522645a384a2f26206b4666e068`.
Evidence: https://github.com/Faust-S/knowledge/actions/runs/43779675582, job `native-age` **SUCCESS** (see log `T3_D7_REAL_AGE_TWO_RECIPIENTS_ORIGINAL_EXCHANGE_PASS`). The source test and workflow were extended; no runtime Kernel, Store, Exchange, cryptography or product code changed. `metal-webgpu` and `native-model` are SKIPPED on this SHA, as separately qualified at their own exact source revisions.

- Original T2 Kernel 0.3.6 / Contract 1.3.0 produced one real `.iwxa` through its own `t2.exportPackage`, containing two objects, one relation, historical Event IDs and preserved unknown extensions.
- Genuine upstream `FiloSottile/age v1.3.1` (release binary archive SHA-256 `bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377`, verified by runner) generated two independent native X25519 recipients. Both recipients recovered the *byte-identical* original T2 `.iwxa`. Original archive SHA-256 in this run: `98898c1105721d657ce50c90f23a377b49a2761fae8244af330c0ca6bbf821df`.
- Each independently opened plaintext passed the ORIGINAL `t2.importPreview` / `t2.importCommit`, first through signed T3 selected Workspace import, second through the plain original T2 Exchange. Both own their separate Kernel Stores; second consumer confirmed history after cold browser restart.
- An unrelated third X25519 key failed to decrypt; tampered age ciphertext failed authenticated decrypt for both valid recipients; original `t2.importPreview` refused direct encrypted envelope. No private keys, plaintext, archive or new runtime included in published Actions artifacts. The test-only keys are ephemeral under runner temp.

**Truthful installed boundary:** `D7_INSTALLED_NATIVE_AGE_OWNER=HOLD`, `D7_INSTALLED_PUBLISHER_ISSUER_LICENSE_STATUS=HOLD`, `D7_NATIVE_TWO_INSTALLED_RECIPIENTS=HOLD`, `G4=NOT_ACCEPTED`, `T3_READY=false`. This was genuine *CLI* age and original T2 Exchange, NOT a production connected `createTrustedAgeExchange` native age-owner implementation, real OS recipient custody, signed Publisher licence/status renewal/revocation, or two installed products. Do not infer original Publisher rights from the ability to decrypt `.iwxa`. The private installed owner must attach the existing age/Publisher ports with its actual signer and independent cold readbacks; do not copy keys, proprietary code or add a new cryptosystem into T3.

**Execution priority:** keep previously-qualified public B0/D1–D7 runtime unchanged; independently qualify the real installed signed owners and two consumers using pinned `G4` owner inputs. Ask owners for their exact installed evidence and only repair the common Core if an evidenced cross-product contract fails. No additional synthetic age tests without an actual defect.

## D5: browser and native source paths on the ONE original Kernel, 16.11.2026

**Public acceptance:**
- D5_BROWSER_REAL_WEBGPU_COLD=PASS: Apple Metal/WebGPU, WebLLM 0.2.87, real generation before and after cold offline restart, original T2 0.3.6 Kernel Object/Event. Source SHA 99f3c5337016ada41cb4be860d4561451e46dd8e; https://github.com/Faust-S/knowledge/actions/runs/43772762981 all four jobs SUCCESS including metal-webgpu.
- D5_NATIVE_EXTERNAL_MODEL_ORIGINAL_KERNEL_SOURCE=PASS: exact source SHA 8fb3bbfefa512688521c09eee07e13857b94c902; https://github.com/Faust-S/knowledge/actions/runs/43778137539 TERMINAL SUCCESS, jobs native-model/test/real-host/windows-credential SUCCESS, metal-webgpu SKIPPED because separately qualified above.

**Real native evidence:** public temporary Ubuntu owner executed external llama.cpp b12244 Qwen3-0.6B-Q4_0 twice (the first and second generations were real, not replay or a demo provider). Binary release SHA-256 c1d7e7f31b5c43f3e5d44f667b4d57104217be3e5f2060320cd3735651238849; model GGUF SHA-256 da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4. Both hashes PASS in the native-model job. The binary and weights were staged in GitHub runner TEMP and are NOT in the T3 dist or published owner artifact. Native execution used an existing external model runtime, not a new T3 engine.
**Original Kernel readbacks:** temporary Host ran the exact qualified T2 0.3.6/Runtime 1.3.0. Two different generated outputs were saved with status DRAFT_UNTRUSTED and explicit save provenance in the test-only iwxa.demo.note class. Browser closed, reopened with network offline, first Object recovered; second native Qwen3 generation saved a second Object; both original Event IDs appeared in original listEventsSince. Witness marker: T3_D5_NATIVE_QWEN3_ORIGINAL_KERNEL_COLD_PASS. Browser was offline on cold recovery; native binary uses a predownloaded local GGUF with proxies disabled, but network firewall isolation of the native process was not asserted.

**Boundary (DO NOT UPGRADE STATUS):** D5_NATIVE_INSTALLED_AGENT=HOLD. Public technical test does not qualify actual installed Windows Agent, production model provider, user-facing model consent, private signer, or an accepted Task/Result; test-only iwxa.demo.note is NOT a new production draft schema. Native installed product owner must use its existing model provider (Ollama/Basic GGUF etc.), existing Task/Human Review/Result, and original T3/Kernel integration. No copying Agent code into knowledge. G4=NOT_ACCEPTED and T3_READY=false until independent installed owner acceptance.
**Stop rule:** do not rerun the two D5 technical full tests absent a demonstrated new defect. Keep executable T3 source candidate 99f3c533 fixed: later revisions to this handoff/CI/test do not change the runtime. Continue installed native G4 owner integration in its own product chat.

## D4: source Exchange positive and negative qualification (16.11.2026)

Status: D4_PUBLIC_TWO_ORIGINAL_CONSUMERS=PASS; D4_PUBLIC_NEGATIVE_MATRIX=PASS.
Exact source SHA: Faust-S/knowledge@ffe06d834c2e8186b04f26316b0046fbd2307fa7.
Source CI: https://github.com/Faust-S/knowledge/actions/runs/43775225935 TERMINAL SUCCESS; test, real-host, windows-credential SUCCESS, metal-webgpu SKIPPED. The real WebGPU D5 passed separately on unchanged executable source in CI #43772762981.

Original T2 Kernel 0.3.6 / Contract 1.3.0 exported one unchanged .iwxa archive with TWO related objects, ONE relation, future extensions and original Event IDs. TWO independent original Kernel recipient Stores imported the same bytes: signed T3 selected Workspace and direct T2 Exchange. Second Store confirmed persistence after cold browser restart.

Real original parser negative evidence:
- Different package format field -> INVALID_MANIFEST.
- Unsupported format_version -> UNSUPPORTED_FORMAT.
- ZIP path traversal content/../../escape.json -> VERIFY_FAILED.
- Unsupported future schema iwxa.unsupported.future@9.0.0 with valid file/package/semantic SHA-256 -> original importPreview explicitly reported schemas.status=missing and unsupported.kind=unknown_schema; one excluded object, importCancel instead of commit, recipient Store unchanged.
- Truncated ZIP -> original parser refusal.

Boundary: D4_TWO_INSTALLED_PRODUCT_CONSUMERS=HOLD. Original recipients were independent technical Host/Store, NOT two installed commercial products. D4_PRODUCT_ACCEPTED and G4 stay NOT_ACCEPTED; T3_READY=false.
Executable G4 source remains 99f3c533: subsequent commits changed only CI, evidence handoff and addressable browser test, not Kernel/Host/Exchange runtime. Do not reopen D4 microtests without a new confirmed defect.

## G4: проверенный набор байтов для независимых получателей, 16.11.2026

**Артефакт интеграции (НЕ установленная G4-сборка):** [скачать точный ZIP #14185062962](https://github.com/Faust-S/knowledge/actions/runs/43773900893/artifacts/14185062962), файл `iwxa-t3-owner-input-2b818eb1863724c73d7dd19bce0f96f73de9c7c2.zip`. SHA-256 ZIP `ce44a53616cfec8122c50d3860b592d79c2eb5e2aada730e8af70278926c6fa8`; размер 4 907 746 байт. **[Source CI #43773900893](https://github.com/Faust-S/knowledge/actions/runs/43773900893): test/real-host/windows-credential SUCCESS**, metal-webgpu SKIPPED именно в этом запуске, так как исполняемый код не менялся. Аппаратный D5 отдельно полностью прошёл на идентичном исполняемом исходнике `99f3c533`, [CI #43772762981](https://github.com/Faust-S/knowledge/actions/runs/43772762981).

ZIP содержит 76 файлов скомпилированного `dist/`, оригинальный квалифицированный архив Kernel 0.3.6 (`7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68`), source-pin BLI, lock WebLLM 0.2.87, `g4-integration.txt` и SHA-256 каждого `dist` файла. **Независимая Linux-проверка**: ZIP-проверка PASS, его собственный SHA-256 совпал с GitHub, все внутренние SHA-256 PASS, один собранный `model-worker`, HTTP 200 на восьми страницах/ресурсах Workspace/Exchange/Lifecycle и оригинальном `/_iwxa/runtime/0.3.6/runtime.js` (плюс Worker). Локальное HTTP-smoke не является установленной предметной приёмкой.

**Использование:** в каждом существующем продукте собрать его собственный `ONE dist` через штатный Host/assembler и текущие полномочия, без копии Kernel или новой Store. В ZIP нет закрытого подписанта, лицензий, пользовательских данных и весов модели; скачивание весов возможно только по отдельному согласию пользователя. Данный набор достаточен как воспроизводимый вход для owner E2E, но не как отдельный запускаемый T3 продукт. GitHub artifact имеет срок хранения до 29.11.2026; при необходимости повторять сборку из точного SHA, не плавающей ветки.

**Граница приёмки:** `T3_READY=false`, `G4=NOT_ACCEPTED` до native D1/D3, двух установленных D4/D6 потребителей, реальных D7 recipient/holder и двух независимых холодных readback на согласованном наборе версий. В первую очередь владельцы должны испытать готовые функции, а не переписывать общий Core.

## Актуальная квалификация G4 source candidate, 16.11.2026

**ИСПОЛНЯЕМЫЙ ИСХОДНИК ЗАФИКСИРОВАН:** `Faust-S/knowledge@99f3c5337016ada41cb4be860d4561451e46dd8e`, TREE `e029f3d767993b680e148324b823a6ab8476e1a2`. Проверять именно этот SHA как аппаратно квалифицированный baseline до новых подтверждённых функциональных дефектов. Нормативный `T2@9c64951c`, Kernel 0.3.6/Contract 1.3.0; source-pinned WebLLM 0.2.87, SmolLM2-360M. Этот документ является evidence index, не новым runtime, вторым Host, release или требованием изменить исполняемый код.

**[GitHub Actions #43772762981](https://github.com/Faust-S/knowledge/actions/runs/43772762981) TERMINAL SUCCESS на точном SHA:** `test` / `real-host` / `windows-credential` / **`metal-webgpu`** все SUCCESS. На macOS с действующим Apple WebGPU/ANGLE Metal Paravirtual выполнены **оба** настоящих аппаратных сценария `T3_D1_D5_REQUIRE_HARDWARE_GPU=1` и `T3_D5_REQUIRE_HARDWARE_GPU=1`. Без SwiftShader/mock: WebLLM выдал текст, original T2 Kernel сохранил DRAFT_UNTRUSTED и вернул подтверждённый Object. После полного закрытия и открытия браузера: внешних запросов 0 в подписанном сценарии, модель загрузилась из Cache Storage, прошла **новая** офлайн-генерация и второе отдельное сохранение/readback. В доменном D5 тесте также подтверждены два независимых объекта, сохранившийся первый Result и отключённая сеть при повторной генерации.

**D5_PUBLIC_HARDWARE_WEBGPU=PASS**; прекращать повторять этот тест без нового дефекта. **G4=NOT_ACCEPTED; T3_READY=false**, потому что source/hardware CI не доказывает установленные независимые private owner-маршруты:
- `D1_D3_INSTALLED_OWNER=HOLD`: настоящий подписант/Agent Result, Reconciliation ACCEPT, отдельный APPLY и два холодных original Object/Event readback в установленном ПО.
- `D4_TWO_INSTALLED_CONSUMERS=HOLD`, `D6_NATIVE_CONTINUATION=HOLD`: два независимых установленых получателя оригинального `.iwxa`/Result.
- `D7_NATIVE_AGE_PUBLISHER=HOLD`: оригинальные X25519 recipient roots, штатные holder licence/status, холодный приём у реальных владельцев.
- `D5_NATIVE_SUPPORTED_PATH=HOLD`, если требуется по плану G3, отдельно от доказанного browser/WebGPU.

**Стоп-правило для основного T3-чата:** не возвращаться к циклу микрофиксов D3/D6/D7 ради числа PASS; Core source/hardware candidate уже квалифицирован. Сверять новые продуктовые owner reports в их собственных чатах, собирать только необходимые исправления общих контрактов и после реальной installed приёмки принимать G4 на одном locked наборе версий. D12 не изменять. Приватные Actions запрещены.

**Дата:** 15.11.2026. **Назначение:** исполняемая инженерная передача, не акт выпуска.
**Базовый исходный T3:** `Faust-S/knowledge@2e18da0ab46be9e3d7c443aac531eaf02d63b41d`, TREE `7b434b4a83e8049cc47ad63e643b4b0d3d29ce0a`.
**Рабочая ветка:** `work/2026-11-10-t3-t2-activity-projection`, основной каталог `packages/t3-core/`.
**Квалификация источника:** [CI #43753112597](https://github.com/Faust-S/knowledge/actions/runs/43753112597), завершена **SUCCESS** на точном `2e18da0a`: `test`, original T2 `real-host`, `windows-credential` PASS. Включает адресный D3, полный product Node/Workspace, TypeScript/build/preflight, signed Control, реальные browser Kernel readbacks. Metal-WebGPU SKIPPED. Это публичный SOURCE/REAL-HOST PASS, не установленная private D3 или hardware D5 приёмка.
**Готовность:** `T3_READY=false`, `D3_INSTALLED=HOLD`, `D5_HARDWARE=HOLD`, `G4=NOT_ACCEPTED`.


## Дополнение 16.11.2026: единый G4 source candidate и запрос настоящего D5 GPU

- **Кандидат исходного кода:** `Faust-S/knowledge@295f3ca0e74bfaf08f9830c9b8fbb56b84ea7873`, TREE `c17ab3d44bfcbbccc03a28afbb40e7bd1178eaa3`, [Source CI #43771872332](https://github.com/Faust-S/knowledge/actions/runs/43771872332) **SUCCESS** (`test`, `real-host`, `windows-credential`; `metal-webgpu` SKIPPED). Нормативный `Faust-S/T2@9c64951c`, Kernel 0.3.6/Runtime 1.3.0, WebLLM 0.2.87. Данный текст не меняет исполняемые файлы, а фиксирует один исходный кандидат вместо бесконечных промежуточных исправлений.
- **Текущая операция:** запустить уже существующий публичный `metal-webgpu` job посредством разрешённой GitHub Actions метки `[t3-metal]` в коммите этой редакции. Он должен выполнить два настоящих сценария: `T3_D1_D5_REQUIRE_HARDWARE_GPU=1` и `T3_D5_REQUIRE_HARDWARE_GPU=1`. Успех требует **реальный аппаратный GPU**, генерацию WebLLM, ручное сохранение черновика через original Kernel, холодное открытие и новую генерацию офлайн без сети. SwiftShader/mock/собранный Worker не равны hardware PASS. Если Mac runner не выделен или не предоставляет реальный GPU, зафиксировать именно `D5_HARDWARE=HOLD`, не делать дополнительных фиктивных обходов.
- **Релизный стоп-критерий:** `G4=NOT_ACCEPTED`, `T3_READY=false`, даже при успешном hardware D5, пока нет полной независимой installed/owner приёмки D1/D3, D4/D6 получателей и D7 age/Publisher с двумя холодными открытиями на единой ревизии. Не задерживать общую кодовую базу мелкими изменениями ради дополнительного количества PASS.

## 1. Первые действия в новом чате

1. **Полностью прочитать этот документ**, затем `Faust-S/knowledge/AGENTS.md`, действующие T3 product audit/handoff, normative `Faust-S/T2@main` и исходную карту 42 репозиториев в `Faust-S/T3@work/2026-11-10-t3-t2-upgrade-core`.
2. Сверить **свежие HEAD/TREE** `knowledge`, T2, владельца нативного D3, Center, Agent, Activity, Atlas, Publisher. Не считать приведённые SHA неизменными после передачи.
3. Проверить итог [CI #43753112597](https://github.com/Faust-S/knowledge/actions/runs/43753112597) именно по `2e18da0a`. При FAIL исправить доказанную причину минимально, а не ослаблять проверку.
4. Дальше разрабатывать конкретный недостающий пользовательский маршрут D1–D7, а не новый механизм тестов, сборщик или универсальную программу.

## 2. Нормативная архитектура (решения владельца)

- **T3 есть полный преемник T2**, включает весь Kernel/Host/Workspace/Object/Event/Result/Store/Exchange/Lifecycle/Factory и новые D1–D7; после внедрения в продукт не запускается второй T2 runtime.
- Нормативный T2: `Faust-S/T2@main` `9c64951cd78411283e8a416641c36d71e169fc1d`, Kernel `0.3.6`, Runtime Contract `1.3.0`, единый архив `.iwxa`.
- **Запрещены** отдельное самостоятельное приложение T3 Control, второй универсальный Kernel, Host, Store, IAM, Task Engine, Router, Exchange, журнал или формат. Не повторять старую архитектуру отдельного T3 Desktop/Control EXE.
- **Модульная поставка допустима**: Publisher уже использует внутренний исполняемый owner-модуль и настоящие механизмы T3 для лицензий/подписей/статусов. Владелец решил **сохранить работающую архитектуру**, не отвязывать Publisher от T3 ради сокращения числа EXE. Внутренний модуль не равен новой самостоятельной T3-программе.
- T3 нужен как целевой общий технологический уровень D01–D11, но внедряется **последовательно, по одному домену**, после G4; D12 IWXA Main сейчас информационный и не требует T3.
- Agent, Admin Center, Atlas, Publisher и Activity используют нужные им T3-функции. Они сохраняют собственных владельцев Task/Graph/ToolRuntime, организации, Project/WorkRef, лицензии, анализ/обезличивание; ядра не дублировать.
- Activity готовит производные модели деятельности, обмен `.iwxa` и будущую передачу в IWXA Exchange/биржу. Анализ != доказанное обезличивание != разрешение на публикацию. Сохранять разные `activity.read`, `activity.derive`, `share/export` разрешения.
- Не передавать приватные signer/keys, DPAPI-профили или Reconciliation-исходники в публичный `knowledge`; не запускать GitHub Actions в приватных репозиториях. Codex только для недоступных операций и независимой финальной приёмки; приёмка через его штатный браузер, без Chromium/Playwright/Puppeteer.
- Приоритет **функции и завершённые продуктовые сценарии**, минимальные адресные проверки; параллельные ветки продуктов не перезаписывать; один конечный `dist/` на домен.

## 3. Изменения, опубликованные непосредственно перед передачей

**D7 Publisher recipient, [`c4aadde9`](https://github.com/Faust-S/knowledge/commit/c4aadde915b92df347c6f7d73649374fde62ddac):** в общем `publisher-license-handoff.mjs` восстановление исходной квитанции перед повторным Human consent; `RECOVER_ONLY` после lost ACK/существующего receipt и `OPERATION_IN_PROGRESS` во время текущей операции; исходный подписант, лицензии, original Store не тронуты. [CI #43751956962](https://github.com/Faust-S/knowledge/actions/runs/43751956962) SUCCESS: `test`, `real-host`, `windows-credential`; metal WebGPU SKIPPED.

**D3 real Host relay, [`6aadb39e`](https://github.com/Faust-S/knowledge/commit/6aadb39e65aa45b131cc32a06e0eb5265abf6ad3):** проверка native-initiated `getWorkspace -> commitObjectGraph -> getObject -> listEventsSince` через настоящий original Control HTTP и original browser T2 Kernel, затем холодное Object/Event чтение. [CI #43752214342](https://github.com/Faust-S/knowledge/actions/runs/43752214342) SUCCESS. Это **публичный TEST caller**, не закрытый Windows Admin signer/установленный D3.

**D3 direct trusted reconciliation owner, [`2e18da0a`](https://github.com/Faust-S/knowledge/commit/2e18da0ab46be9e3d7c443aac531eaf02d63b41d):**
- В существующем `src/t3/reconciliation-owner-admission.mjs` перед новым Human ACCEPT/REJECT и прямо перед original owner dispatch проверяется original persisted decision receipt по `operationId`.
- Одновременные прямые решения по одному `operationId` отклоняются `T3_D3_DECISION_IN_PROGRESS`. После входа в оригинальный owner volatile guard запрещает повторный dispatch и предлагает read-only receipt.
- Изменён только адаптер и `tests/t3-reconciliation-owner-admission.test.mjs`. Добавлены реальные для контракта случаи конкурентного Review, уже сохранённого ACCEPT после cold Host, lost ACK и original `PERMISSION_DENIED`; в CI адресный D3 Node шаг SUCCESS.
- **Важно:** это защита *публичного доверенного D3-порта*. Приватный `interop/native-admin-d3.mjs` сохраняет собственное оригинальное исполнение `runtime.decide`; нативный E2E не стал принятым автоматически. Публичный Source PASS != private native acceptance.
- Никакого нового Reconciler/Store/Kernel/EXE.

**Параллельная ветка:** перед нашим изменением другой исполнитель опубликовал `knowledge@6aadb39e`. Изменения `2e18da0a` применены поверх свежего HEAD, тест реального оригинального Kernel не потерян. Сохранять этот порядок; не форсировать push.

## 4. Фактические владельцы и снимок версий (обязательно перепроверять)

| Роль | Репозиторий / ветка | Последний проверенный HEAD |
|---|---|---|
| Исполняемый T3 | `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection` | `2e18da0a` (до документа передачи) |
| Нормативный T2 | `Faust-S/T2@main` | `9c64951c` |
| Private original D3 signer/reconciler | `Faust-S/T3@work/2026-11-11-t3-d1-signed-activity-owner` | `c3e2f0be` |
| Admin Center D3 | `Faust-S/Center@work/2026-11-15-t3-d3-native-preapply-refusal` | `1eec2b1d`, [PR #1](https://github.com/Faust-S/Center/pull/1) |
| Agent 0.6, в разработке | `Faust-S/iwxa-personal-agent@work/2026-11-15-agent-0-6-development` | `0ac97d3f` |
| Atlas 0.8, релиз | `Faust-S/Atlas@release/0.8` | `6ef7b8fa` |
| Publisher 0.5 | `Faust-S/Center@work/2026-11-10-publisher-0.5` | `fb7fc149` |
| Activity | `Faust-S/knowledge@work/2026-11-10-activity-base-anonymizer` | `2383c58f` |

Стабильный Agent **0.5** не путать с исторической 0.4; Agent 0.6 развивается параллельно. Atlas **0.8.0** опубликован; не использовать старую ветку 0.6 для текущей D6.

Экспериментальный private `Faust-S/T3@work/2026-11-15-t3-d3-setup-source-build` с `c6c33772` менял лишь упаковку Admin: **не переносить его как архитектурную цель**. Но и не удалять/переписывать работающий внутренний Publisher owner EXE: у него отдельная подтверждённая предметная роль.

## 5. B0 / D1–D7 / G4: что доказано и что осталось

| Участок | Доказано | Не принято |
|---|---|---|
| B0 | Исходный T2 0.3.6 Kernel/Host/Store/Exchange и original `.iwxa`, Host readback, inherited operation parity в исходном контуре | Полный G4 внутри конечных продуктов |
| D1 | Signed PERSONAL + 2 CORP Test owner, Host-scoped signed D1, original Kernel host tests | Native production owner/two actual products, two cold signed context openings |
| D2 | Детерминированные T0/T1 Activity-проекции с signed read/derive в настоящем original Host TEST | Установленный Activity и подписанные production owners |
| D3 | Original Reconciler public port; separate ACCEPT/REJECT/Apply; recovery; native-initiated Control relay на реальном T2 Host | Настоящий installed Admin/Agent с private signer, Human ACCEPT -> separate APPLY -> two cold independent Object/Event readbacks |
| D4 | Оригинальный Exchange, preview/import/export, PWA-обработка `.iwxa`, независимый технический consumer | Два реально установленных и независимых product consumers |
| D5 | WebLLM 0.2.87, opt-in model download, Worker/cache, signed Workspace Draft `DRAFT_UNTRUSTED` | Реальный WebGPU inference на GPU + cold offline repeat generation в одном Host |
| D6 | Контракты native Agent/Atlas Project/WorkRef/Result continuation | Подлинное signed Agent -> Atlas/Domain continuation в установленном ПО |
| D7 | Публичные age/Publisher порты, оригинальный `.iwxa`, receipts, два recipient-profile, Publisher STATUS/2 | Реальный установленный age X25519 + два собственных recipient roots, full Publisher/Atlas PERSON acceptance |
| G4 | Отдельные source/core/real-host PASS | Locked release B0+D1–D7, native/hardware acceptance, два холодных открытия |

**Никакие утверждения о D3/D5/D7 product acceptance не выводить из одного публичного Node/Rust/Browser CI.**

## 6. Следующая инженерная работа, в правильном порядке

1. **CI и HEAD:** прочитать результат `#43753112597`, сверить все новые коммиты после `2e18da0a`, затем выбрать ровно один функциональный дефект/разрыв. При source PASS не делать лишние промежуточные тесты.
2. **D3 real owner handoff:** использовать уже существующие private `interop/native-admin-d3.mjs`, original `OfflinePackageReconciler`, подписанный Owner, T2 Kernel relay и Center PR #1. Сквозной пользовательский маршрут: подписанная Task -> Agent HUMAN_ACCEPTED Result -> original `.iwxa` -> real Admin Review/ACCEPT -> отдельный Human APPLY -> единственная `commitObjectGraph` -> оригинальные Object/Event -> два холодных открытия и readback. Код Center/Agent менять **только в их чатах/ветках**, с точным узким контрактом/заданием. Не дублировать Reconciler в knowledge и не подменять приватное публичным fixture.
3. **D4/D6/D7:** доказывать передачу между независимыми владельцами через оригинальные API и `.iwxa`; пользовательский consent и исходные права. Publisher 0.5 **доделывать по его плану, не отвязывать от T3**. Activity подготовка моделей/обезличивание/разрешённый экспорт, future Exchange/биржа отдельно от выданных прав.
4. **D5:** аппаратная WebGPU генерация + независимая холодная офлайн-повторная генерация в том же T3 Host. Если нет доступного GPU, оставить HARDWARE=HOLD и передать Codex только финальную недоступную hardware/browser приёмку, не заменяя её SwiftShader/mock.
5. **G4:** зафиксировать ONE versioned T3 candidate, B0–D7, доступные original owners и настоящий runtime; G4 = NOT_ACCEPTED до всех конечных критериев. Только затем D01–D11 по одному домену, сохраняя предметные алгоритмы и единый `dist/`. D12 сейчас не трогать.

**При любой ошибке:** исходный объект/квитанция/Kernel являются единственным владельцем истины; при lost ACK/UNKNOWN не вызывать повторный Apply/Commit. Не создавать технические объекты ради отчёта. Приватные Actions запрещены.

## 7. Точный запрос для следующего чата

> Продолжай самостоятельную инженерную разработку единого автономного IWXA T3 непосредственно в GitHub. **Первым действием полностью прочитай** `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection/packages/t3-core/handoff/T3_ONE_CORE_D3_D7_G4_2026_11_15_NEXT_CHAT_RU.md`. Затем прочитай AGENTS.md, нормативный T2, текущий source audit и архитектурную карту 42 репозиториев. Проверь live HEAD/TREE и CI #43753112597 на `2e18da0a`, сохрани параллельные коммиты. Следуй последовательности B0/D1–D7/G4, сначала исправляй конкретные функциональные разрывы общего T3, не новые подсистемы и сборщики. Источник T3 один: knowledge/packages/t3-core. Publisher с существующим внутренним T3 owner не переписывай. Для Admin, Agent, Atlas и Activity используй их действующих предметных владельцев, не редактируй их параллельные ветки. Не создавай самостоятельный T3 Control EXE, Kernel/Host/Store/IAM/Task Engine/Router/Exchange или новый архив. Работай и проверяй самостоятельно, Codex только для недоступных операций и независимой финальной приёмки. Приватные Actions запрещены. Заверши доступную функциональность и дай точные commit/CI, реальные пользовательские результаты и остающиеся HOLD. `T3_READY=false` до полной G4.
