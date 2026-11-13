# IWXA T3 One Core: D1 corporate encrypted-vault integration → native Control/G4

Документ передачи в новый чат. Дата: 13 ноября 2026 года. Исполняемый код, CI и инженерная приёмка принадлежат исключительно открытому репозиторию [Faust-S/knowledge](https://github.com/Faust-S/knowledge). Это передача продолжающейся разработки, не сертификат релизной готовности.

## 1. С чего начать в следующем чате

1. **Прочитать полностью этот документ**, затем корневой [AGENTS.md](https://github.com/Faust-S/knowledge/blob/work/2026-11-10-t3-t2-activity-projection/AGENTS.md) и предыдущую [объединённую историю передачи](https://github.com/Faust-S/knowledge/blob/work/2026-11-10-t3-t2-activity-projection/packages/t3-core/handoff/T3_ONE_CORE_CODE_OWNER_MIGRATION_2026_11_13_RU.md).
2. Прочитать архитектурную [карту 42 репозиториев](https://github.com/Faust-S/T3/blob/work/2026-11-10-t3-t2-upgrade-core/architecture/T3_ONE_CORE_ALL_DOMAINS_SOFTWARE_AI_SOURCE_MAP_2026_11_11_RU.md) и [матрицу D1–D7/G4](https://github.com/Faust-S/T3/blob/work/2026-11-10-t3-t2-upgrade-core/planning/T3_DELTA_ACCEPTANCE_RU.md). Репозиторий T3 — исключительно теория, история и спецификации, НЕ рабочий код и НЕ CI.
3. Получить **новые** HEAD/TREE основной ветки, сверить последние Actions и изменения соседних рабочих веток; не считать зафиксированный ниже HEAD вечно актуальным. Не откатывать чужие коммиты.
4. Продолжать самостоятельно непосредственно в knowledge/packages/t3-core. Создавать адресную рабочую ветку от свежего основного T3, тестировать только публичным Actions knowledge и возвращать проверенный результат обычным fast-forward/merge без force push.

**Основная исполняемая ветка:** work/2026-11-10-t3-t2-activity-projection. **Квалифицированный код HEAD:** c1cbe83617bed8d1f29a4c6f7b36d692c6b272e9; **TREE:** 14820c5115cfc5e5376ad11f1c641c61f3384509. HEAD изменится коммитом публикации самого этого документа; проверяй live Git ref.

## 2. Завершённые результаты и реальные доказательства

- B0: сохранены оригинальный T2 Kernel/Host/Store/Workspace/Exchange, Runtime 0.3.6 / Contract 1.3.0. Квалифицированный архив оригинального Kernel: iwxa-kernel-k036-same-store-history-20261019-qualified.1.zip; SHA-256 архива: 7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68. Не переписывать нормативный Faust-S/T2@main и не запускать параллельное T2-ядро после обновления домена.
- D1 PERSONAL: подлинная Ed25519 проверка, оригинальный Kernel/Store, отдельная подписанная Workspace, AppShell/BLI write→receipt→readback, отзыв прав и восстановление после перезапуска квалификационного Host. Ранее подтверждён [Actions #43468925912](https://github.com/Faust-S/knowledge/actions/runs/43468925912).
- D1 CORP: две организации North/South с независимыми issuer, credential, signed enrollment/grant и STATUS, JIT-проверка через единственный AccessRegistry в оригинальном Kernel. Подлинный собранный AppShell (два origin), самостоятельные Workspace и BLI-драфты, запрет перечисления чужих Workspace, переключение через оригинальный Control HTTP/SSE, отзыв North без отзыва South, сохранение после холодного запуска. Подтверждён [Actions #43475202419](https://github.com/Faust-S/knowledge/actions/runs/43475202419).
- **Новый законченный продуктовый участок:** [код c1cbe836](https://github.com/Faust-S/knowledge/commit/c1cbe83617bed8d1f29a4c6f7b36d692c6b272e9) расширил ИМЕННО СУЩЕСТВУЮЩИЙ encrypted Ed25519 vault signer для двух CORP credentials, без второго хранилища/issuer/IAM. Корпоративный подписант в доверенном Host привязан к фиксированным organizationId и credentialKeyId, а также к actor/principal/role/grant/realm/audience/purpose/Workspace. Оригинальный организационный gate проверяет подлинный signed enrollment, grant и STATUS независимо от этого signer. Личный режим не регрессировал.
- Публичный [Actions #43478330754](https://github.com/Faust-S/knowledge/actions/runs/43478330754) на точном c1cbe836: **COMPLETED SUCCESS**, test SUCCESS, real-host SUCCESS, windows-credential SUCCESS, metal-webgpu SKIPPED. Windows-проверка подтвердила собственный дисковый зашифрованный vault, восстановление двух независимых Ed25519 credentials, запрет неправильной организации, чужого credential, подменённого grant/Workspace, неправильного ключа и пароля. Нативная установленная программа НЕ проверялась.
- Из real-host: T3_D1_TWO_CORP_COMPILED_APPSHELL_REAL_ED25519_KERNEL_PASS: originalKernel=0.3.6, independentEd25519Issuers=2, independentSignedEnrollments=2, realCorporateProofs={north:14,south:20}, originalKernelBliWrites=2, crossWorkspaceEnumerationDenied=true, northRevokedAfterSignedStatus=true, southActiveAfterColdRestart=true, originalStoreColdReadback=true, existingEncryptedCorporateVault=true, bothCredentialKeysRestoredAfterCold=true, syntheticCorporateOwner=false. Исходный compiled dist не содержит тестовые issuer/private keys; тестовые credentials создаются исключительно в CI.
- D2 семантическая проекция исходных Object/Event, PWA Domain Mode, исходный Exchange .iwxa и D5 WebLLM/локальная модель уже имеют отдельные публичные проверки. Ранее подтверждена настоящая Apple WebGPU-генерация и cold offline, но в Actions #43478330754 аппаратная Metal проверка **SKIPPED**. Это не общая G4-приёмка.

## 3. Изменённые файлы последнего инженерного участка

- packages/t3-core/src/t3/access/original-vault-proof.mjs: добавлена поддержка корпоративного credentials в **том же** подписывающем адаптере и строгая проверка organizationId/credentialKeyId + subject/context. Ключ извлекается заново из текущего шифротекста перед каждой подписью.
- packages/t3-core/tests/support/t3-two-corp-original-authority.mjs: временные TEST-only Ed25519-ключи для исходного корпоративного CI-fixture, в том числе исходные PKCS8 для однократного импорта в оригинальный encrypted vault теста. Не поставлять их в пользовательский dist.
- packages/t3-core/tests/t3-d1-original-vault.test.mjs: реальное повторное открытие vault с диска, две корпоративные подписи, отрицательные кейсы.
- packages/t3-core/tests/t3-d1-two-corporate-original-access.test.mjs: JIT корпоративных проверок теперь использует существующий encrypted vault вместо обращения к тестовому keyObjectSigner.
- packages/t3-core/tests/t3-d1-signed-control-one-dist.browser.mjs: тот же подлинный собранный AppShell и Kernel, оба CORP credentials подписывают из encrypted vault; после cold startup заново создаются signing closures.
- .github/workflows/t3-activity-projection.yml: добавлена Windows Node crypto/Access проверка. Не обозначать её как native installed Control.

Все эти изменения уже **fast-forward интегрированы** в основную рабочую ветку knowledge. Никакие другие репозитории в рамках участка не менялись.

## 4. Статус приёмки: не завышать

- D1 PERSONAL в собранном AppShell на квалификационном Host: PASS.
- D1 две CORP в собранном AppShell с оригинальным Kernel: PASS.
- D1 две CORP через оригинальный encrypted vault, Windows Node/JIT, восстановление из файла: PASS в тестовом окружении.
- **Настоящий установленный Windows Control с производственным signer/custody, приёмкой двух реальных организаций и PERSONAL: NOT_ACCEPTED.** Windows CI пока не проверял Tauri/WebView2 installer, Windows OS DPAPI/Credential Locker, физическую выдачу/отзыв реальных credentials или полный GUI.
- PWA нативная системная установка Windows/Android/iOS: NOT_ACCEPTED. Browser offline/PWA-механики не превращают этот статус в PASS.
- Общая релизная матрица B0+D1–D7, подписанный Result/.iwxa, две холодные загрузки, нативный продукт, G4: NOT_ACCEPTED; **T3_READY=false, G4=NOT_ACCEPTED**.

## 5. Следующий инженерный приоритет

**Довести корпоративный Credential/Control в установленном Windows Host до настоящего продукта, используя только существующий оригинальный Access/vault и единый T3 Kernel.** Начать с точной инспекции сборки/установки в knowledge и уже разработанного Setup Core как архитектурного примера, но **не вносить изменения в Center, Admin Center, Publisher, Club и домены** в этой задаче. Если native boundary отсутствует в knowledge, реализовать необходимую недостающую возможность как часть существующего Host, а не выпускать ещё одну тестовую оболочку.

Нужный сквозной сценарий: явный выбор PERSONAL → CORP North → CORP South; настоящий выданный организации credential, защищённый средствами Windows в границе локального Host, не браузерной средой; подлинный подписант → выбранная Workspace → исходный Kernel write/receipt/readback → Result/.iwxa Exchange → отключение одного корпоративного grant → два холодных перезапуска; сохранение работоспособности другой организации и личной Workspace. Проверять имена и source ownership до переноса готовых механизмов; не собирать отдельные IAM/Store/Task Engine. Публичный Actions knowledge можно применять для Windows CI и воспроизводимых тестов, финальную недоступную GUI-проверку поручать Codex с его встроенным браузером (не Playwright/Puppeteer/Chromium).

Затем исполнить **G4 на одном immutable candidate**, все D1–D7 и B0 без подмены исходных T2 операций allowlist. Подтверждать только реально запущенные кейсы, точные HEAD/TREE и CI.

## 6. Запреты и способ работы

- Единственный владелец исполняемого кода: публичный Faust-S/knowledge/packages/t3-core. T3 — теория/наработки, без CI. Центр и другие репозитории не использовать как промежуточную площадку.
- GitHub Actions в открытом knowledge разрешены; private Actions запрещены. Не требовать приватные access token/secret или dual-checkout.
- Не менять исходный Faust-S/T2@main, Admin Center, Publisher, Club, существующие домены в этой ветке.
- Не создавать второй Core, Kernel, Host, Store, IAM, Task Engine, Router, Service Worker, PWA runtime или новый пакетный формат вместо .iwxa. Один итоговый dist сайта + Workspace + Host + Kernel + Exchange + Lifecycle + PWA.
- Автономность и PWA устанавливаются добровольно, локальная модель только по явному согласию, cloud account необязателен; другой subject никогда не доступен через наличие продукта/лицензии.
- Действия: одна проверяемая продуктовая проблема → исправить текущий код → публичная CI → точные результаты и commmit → FF в main только после PASS. Codex только для недоступного Windows GUI и независимой финальной приёмки.

## 7. Готовый старт нового чата

Продолжай самостоятельную инженерную разработку единого автономного IWXA T3 непосредственно в открытом Faust-S/knowledge. Первым действием полностью прочитай настоящий документ передачи, корневой AGENTS.md, предыдущий handoff, карту 42 репозиториев и план D1–D7/G4. Сверь свежие HEAD/TREE и Actions перед любыми изменениями. Последний квалифицированный код HEAD c1cbe83617bed8d1f29a4c6f7b36d692c6b272e9, CI #43478330754 SUCCESS (test, real-host, Windows Node credentials). Две CORP + PERSONAL в собранном браузерном AppShell и исходном Kernel работают; корпоративный Ed25519 credential теперь подписывает из существующего encrypted vault и работает на Windows Node. Следующий приоритет: **настоящий установленный Windows Control/Host с ОС-защищённой custody**, затем единая G4 приёмка. Не называй TEST-issuers и Windows Node-тесты нативной продуктовой приёмкой. Используй один Core/Kernel/Store/Access, исходный .iwxa, не трогай приватный T3, Center, нормативный T2, Admin Center, Publisher, Club и домены. Все доступные изменения и проверки выполняй самостоятельно в knowledge; Codex используй только для недоступных Windows GUI-операций и независимой финальной приёмки. После каждого законченного участка публикуй проверяемые исходники и результаты в GitHub, затем FF без потери чужого кода.
