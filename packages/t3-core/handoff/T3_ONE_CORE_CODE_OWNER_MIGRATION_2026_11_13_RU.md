# IWXA T3: единый исполняемый исходник и квалификация

**Решение владельца, 13 ноября 2026 года.** Весь код, сборка, разработка и испытания единого автономного IWXA T3 выполняются только в открытом `Faust-S/knowledge`, в `packages/t3-core/` и GitHub Actions этого же репозитория. Готовый `dist/` должен включать оригинальные механизмы T2, Workspace, Host, Kernel, BLI и согласованные функции T3. Другие репозитории не используются как CI-посредники и не должны быть runtime-зависимостями T3.

## Разделение ответственности

- `Faust-S/knowledge`: **единственный исполняемый T3**, все тесты и GitHub Actions, включая Control и итоговую G4.
- `Faust-S/T3`: теория, логика, архитектурная карта и исторические наработки; можно читать как справочный материал, но нельзя тянуть исходники приватного Control в сборку, делать checkout или запрашивать токен для CI.
- `Faust-S/Center`: независимый продукт; **не участвует** в разработке, сборке, тестировании и квалификации T3.
- Нормативный T2 и сторонние продукты не изменять. Не создавать второй Kernel/Core/Store/IAM/Task Engine/Router или альтернативный формат `.iwxa`.

## Исправление ошибочной ветви разработки

13.11 была ошибочно создана схема `knowledge → Center → исторический закрытый T3 → Control → knowledge`. Это искусственная межрепозиторная зависимость, противоречащая выбранному процессу. **Она отменена как способ разработки и приёмки T3.** Требование `IWXA_PRIVATE_SOURCE_READ_TOKEN` не является и не должно становиться блокером T3.

Из активного `knowledge` удаляются вспомогательные `scripts/stage-original-control-consumer.mjs`, `tests/t3-d1-control-consumer-stage.test.mjs` и соответствующий этап Actions: они проверяли копирование исторического исходника, а не работоспособность единого продукта. Их прошлые PASS означали лишь успешное тестовое стадирование и не означали приёмку подписанного Control. История коммитов GitHub сохранена. Репозитории Center и T3 этой корректировкой **не изменяются**.

## Действующие подтверждённые механизмы

- `src/t3/isolated-ui-server.mjs`: отдельный локальный origin, канонический `/workspace/`, CSP, модельный Worker.
- `src/t3/signed-access-host-port.mjs`, `src/t3/subject-access-binding.mjs` и `src/t3/control-loopback-owner.mjs`: существующие мосты к проверке полномочий; это **не** доказательство настоящего интегрированного подписанта.
- `scripts/assemble-signed-control-dist.mjs`: сборка подписанной Workspace поверх неизменного оригинального Kernel и регистрация BLI.
- [knowledge Actions #43446211040](https://github.com/Faust-S/knowledge/actions/runs/43446211040): `test=SUCCESS`, `real-host=SUCCESS`; подтверждены оригинальный Kernel 0.3.6, подписанный UI, работа панели BLI и копия черновика через Kernel с **синтетическим** владельцем полномочий.
- Предыдущая аппаратная D5 WebGPU Apple/Kernel/cold-offline квалификация имеет отдельное подтверждение; её результат **не** означает прохождение настоящего подписанного D1/G4.

## Что осталось до продукта

1. В `knowledge` определить существующий исходный механизм Ed25519/AccessRegistry и соединить его с установленным единым Host/Control без заимствования кода из другого репозитория при сборке или тестировании. Не изобретать вторую систему полномочий.
2. В **публичных Actions knowledge** пройти действительный маршрут выдачи/отзыва полномочий, изоляции двух организаций и PERSONAL, настоящий Kernel read/write, экспорт/импорт `.iwxa` и холодный повторный запуск.
3. Выполнить окончательный пользовательский маршрут BLI и общую G4, используя единый установленный `dist/`.

Текущий статус: `D1_REAL_SIGNED_CONTROL=NOT_ACCEPTED`; `T3_READY=false`; `G4=NOT_ACCEPTED`. Нельзя считать успешное стадирование закрытого исходника приёмкой продукта. Публиковать новые исполняемые изменения только в `knowledge`.


## D1: original local signed Access and encrypted vault qualification

Executable source: knowledge@d567eaa45b869cd14f90a51c97dd8758683b73de.
Public Actions: https://github.com/Faust-S/knowledge/actions/runs/43456298605
**COMPLETED SUCCESS**: test SUCCESS, real-host SUCCESS, metal-webgpu SKIPPED (not requested).

Everything below resides and executes in knowledge/packages/t3-core. No Center checkout, private T3 checkout, cross-repository token, private Actions or CI intermediary was used.

Implemented:
- src/t3/access/core.mjs: original versioned T3 Access evaluator, real Ed25519 verification of signed grant, actor proof and STATUS. Adopted into the single source tree, not a new IAM, Kernel, Store or transfer format.
- src/t3/access/original-personal-evaluator.mjs: uses the existing signed-access-host-port; signed registry state is read AFTER the asynchronous actor proof. No cached grant rights.
- src/t3/access/local-vault.mjs and strict-json.mjs: original offline encrypted Ed25519 key-vault algorithm and strict JSON decoding. No real private keys committed.
- src/t3/access/original-vault-proof.mjs: authentic local actor signature after authorized vault unlock, without putting private keys into Browser, WebLLM Worker or IWXA packages.
- New executable Node regressions and the real compiled browser/Kernel test use the original T2 Kernel 0.3.6.

Observed Chromium real-host marker T3_D1_REAL_ED25519_PERSONAL_ORIGINAL_KERNEL_COLD_PASS: realEd25519Grant=true, realSignedActorProof=true, realSignedStatus=true, originalKernelColdReadback=true, revokedAfterCold=true, originalKernelWriteCount=1, privateControlUsed=false, completeControlProductAccepted=false.

The existing T3_D1_D5_SIGNED_BLI_COPY_SAVE_ORIGINAL_KERNEL_PASS user-flow still uses a synthetic Control for that UI route. The vault tests cover encrypted disk reload, a fresh verifiable signature with the recovered key, wrong passphrase, tampering and duplicate-key refusal. This is NOT an end-to-end process restart of a persistent live issuer with signed STATUS chronology.

Remaining: bind authentic signed Access to the installed loopback AppShell using the original Host mechanisms, persist authentic monotonic STATUS/registry state without a second Store, qualify two corporate organizations and PERSONAL, real revocation and cold restart, T2 .iwxa roundtrip, hardware BLI and G4 in public knowledge Actions only.

**D1_PERSONAL_SIGNED_KERNEL_E2E=PASS. D1_INSTALLED_CONTROL=NOT_ACCEPTED. G4=NOT_ACCEPTED. T3_READY=false.**
