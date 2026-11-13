# IWXA T3: один исполняемый кодовый владелец, миграция 13.11.2026

## Решение владельца
- Исполняемый единый IWXA T3: `Faust-S/knowledge`, ветка `work/2026-11-10-t3-t2-activity-projection`, директория `packages/t3-core`.
- `Faust-S/T3`: исторические теория, логика, архитектура и экспериментальные наработки. Не является отдельным актуальным executable T3 и не должен быть местом новых исправлений runtime.
- Нормативный T2 остаётся существующим Kernel/Host/Store/Exchange; их не дублировать. Никакого другого формата вместо `.iwxa`.

## Что мигрировано из исторической ветки T3
1. Доработка `interop/t3-isolated-ui-server.mjs` (коммит `1319c617`): единая скомпилированная подписанная Workspace теперь обслуживается и по каноническому `/workspace/`, и по подписанному одноразовому входу. Общее исполняемое разрешение, проверка origin, CSP и pinned WebLLM Worker реализованы в **публичном текущем исходнике** `packages/t3-core/src/t3/isolated-ui-server.mjs`. Это Node HTTP static UI на другом локальном origin, **не** второй Kernel, Store, Access или Control.
2. Доработка `qualification/t3-d1-loopback-owner-local.test.mjs` (коммит `35293651`): покрытие канонического URL, равенства скомпилированного AppShell, запрета сырых Kernel путей, CSP и восстановления после холодного рестарта мигрировано в `packages/t3-core/tests/t3-d1-isolated-ui-server.test.mjs`. Проверки работают без приватного Control и не выдают себя за настоящую Ed25519-приёмку.
3. Документ `handoff/T3_ONE_CORE_D1_D5_G4_2026_11_13_NEXT_CHAT_RU.md` оставлен в архивном исследовательском репозитории T3 как исходный материал. Этот handoff теперь текущий источник назначения исполняемого кода.

**Не скопировано:** приватный signer, AccessRegistry, организационные ключи, реализация закрытого Control, личные данные, приватные доказательства и испытания Windows. Старые приватные файлы не удаляются и не откатываются, пока старые Consumer и квалификаторы на них ссылаются. Это архивная совместимость, а не разрешение вести параллельную разработку. До перехода закрытого Consumer на публичный сервер его старый вариант нельзя считать удалённым из исполняемого маршрута.

## Актуальная приёмка и ограничения
- Публичная D1+D5: [knowledge Actions #43439384570](https://github.com/Faust-S/knowledge/actions/runs/43439384570): `test=SUCCESS`, `real-host=SUCCESS` на `b2a230af`; BLI launcher, оригинальный Kernel 0.3.6, SSE отзыв, отдельное согласие на модель; только synthetic Control.
- Публичные изменения после этого включают пользовательское сохранение BLI-черновиков и необязательный Apple WebGPU аппаратный сценарий. PASS новой миграции устанавливается только по соответствующему точному CI SHA.
- Закрытый Control через Center dual-checkout всё ещё не принят: [Center Actions #43443950913](https://github.com/Faust-S/Center/actions/runs/43443950913) получил GitHub 403 на закрытом T3. Нельзя считать эти Ed25519 тесты пройденными.
- Ранее аппаратная генерация Apple с оригинальным Kernel и холодным офлайн-перезапуском подтверждена в отдельном D5 опыте; объединённый D1+D5 с настоящим закрытым подписантом не принят.
- `T3_READY=false`; `G4=NOT_ACCEPTED`.

**Дальнейшее правило:** любые функциональные исправления единого T3 публиковать в `knowledge` и квалифицировать в Actions **открытого** репозитория. Приватные Actions запрещены. Нормативный T2, Admin Center, Publisher и Club не изменять.


## Фактическая квалификация мигрированного кода, 13.11.2026

**Точная проверенная ревизия**: `Faust-S/knowledge@7cfead3e24e32055992562725443b031a3e034b1`, [публичный Actions #43446211040](https://github.com/Faust-S/knowledge/actions/runs/43446211040): итог `SUCCESS`; `test=SUCCESS`, `real-host=SUCCESS`, `metal-webgpu=SKIPPED` (новый запуск Apple не запрошен).

- `t3-d1-isolated-ui-server.test.mjs`: **4/4 PASS**. Два URL обслуживают одни подписанные HTML bytes; UI-origin не выдаёт сырой Kernel, файл `.env`, API Control и неподписанный индекс; отдельная CSP для единственного pinned WebLLM Worker; фиксированный UI origin переживает холодный рестарт.
- Существующие Node-тесты, TypeScript, сборка T3 и регрессии оригинального T2 Host/Workspace: `PASS`.
- `real-host`: `T3_D1_D5_SIGNED_BLI_COPY_SAVE_ORIGINAL_KERNEL_PASS` подтверждает пользовательский маршрут копирования ранее сохранённого черновика, отдельную подписанную запись и независимое чтение исходным Kernel 0.3.6. Исходный черновик не изменился; второй объект имеет отдельный ID. `syntheticOwnerOnly=true`, `privateIssuerExecuted=false`.
- `T3_D1_ACTUAL_ONE_DIST_ORIGINAL_HTTP_PASS` и `T3_D5_REAL_BLI_HOST_BROWSER_PASS`: исходный Kernel, изолированный подписанный AppShell и модельный launcher функционируют. Linux SwiftShader — не аппаратная генерация.
- Исторический приватный `Faust-S/T3@da85c3aa` обновлён **только документационно** (`AGENTS.md` и исторический handoff), чтобы исключить повторную разработку второго исполнительного исходника. Исторические приватные файлы и оригинальный подписант не изменялись.

**Оставшееся разделение:** новый нейтральный HTTP UI server работает и проверяется из `knowledge`, но прежний приватный Control Consumer всё ещё имеет старый импорт для своих архивных квалификаторов. Пока он не переведён на конечную собранную поставку T3, нельзя считать реальный закрытый Control принятым. `T3_READY=false`, `G4=NOT_ACCEPTED`.

## Переключение оригинального Consumer на один кодовый источник

Сборщик `scripts/stage-original-control-consumer.mjs` собирает **локальную, одноразовую установленную копию** подлинного старого Control из внешнего авторизованного checkout. Прежние `interop`, `access-control`, `reconciliation` сохраняются байт-в-байт; `interop/t3-isolated-ui-server.mjs` заменяется на **точный** исходник `knowledge/src/t3/isolated-ui-server.mjs`. Исходный приватный checkout не изменяется. Фиксированный импорт в старом `interop/server.mjs` продолжает работать, новый подписант, IAM, Kernel, Store или формат не создаются.

Пример на машине с разрешённым checkout (`--qualify` только для локальной приёмки, не для пользовательской установки):
```sh
node packages/t3-core/scripts/stage-original-control-consumer.mjs \
  /path/to/original-private-control /path/to/ephemeral-installed-control --qualify
IWXA_T3_PUBLIC_CORE_DIR=/path/to/knowledge/packages/t3-core \
  node --test /path/to/ephemeral-installed-control/qualification/t3-d1-loopback-owner-local.test.mjs
```

Установленный старый Control при старте получает `--t3-public-core` и `--t3-dist` с собранной из `knowledge` T3 Workspace/оригинальным T2 Kernel. **Стадирование кода не равно Ed25519 приёмке**. Не публиковать содержимое staged Control, токены и журналы в публичных CI artifacts. Граница G4 остаётся закрытой до успешной настоящей квалификации.

## Исполняемый Control без checkout knowledge

В установленную приватную копию оригинального Control дополнительно стадируется **точный** `knowledge/packages/t3-core/src/t3/signed-access-host-port.mjs` по месту `src/t3/signed-access-host-port.mjs`. Оригинальный Control CLI уже поддерживает `--t3-public-core`; теперь в него передаётся **корень собранного Control**, а не рабочий checkout разработчика. Один собранный T3 `dist` продолжает поставляться через имеющийся флаг `--t3-dist`. Никаких новых проверяющих полномочия сервисов нет: подписант остаётся original Control.

Пример параметров после локальной сборки (подлинные контексты и данные передаются исходным Control обычным способом):
```sh
node /path/to/ephemeral-installed-control/interop/server.mjs \
  --product=control --t3-public-core=/path/to/ephemeral-installed-control \
  --t3-dist=/path/to/assembled-t3-dist
```

## Точная квалификация установленного Control Consumer, 13.11.2026

**Исполняемый T3 source:** `knowledge@070300a23724dde32b58fac313f2f4570291d928`, рабочая ветка `work/2026-11-10-t3-t2-activity-projection`. [Публичный GitHub Actions #43451591989](https://github.com/Faust-S/knowledge/actions/runs/43451591989): **COMPLETED / SUCCESS**, `test=SUCCESS`, `real-host=SUCCESS`, `metal-webgpu=SKIPPED` (аппаратный профиль для этого коммита не запрашивался).

В `test`: `stage-original-control-consumer.test.mjs` **3/3 PASS**, исходный подписант и checkout не меняются, при несовместимом импорте / пересечении путей / символьной ссылке сборка отказывает. Проверены перенос только **двух точных** исходных D1-квалификаторов и исключение посторонних приватных fixtures; до этого полная папка `qualification` была неоправданно велика. `src/t3/isolated-ui-server.mjs` и `src/t3/signed-access-host-port.mjs` копируются из единственного исходника `knowledge`, их SHA-256 сравнивается, для будущего запуска CLI подготовлены существующие `--t3-public-core=<staged Control root>` и `--t3-dist=<assembled T3 one-dist>`; фактический приватный запуск с этими параметрами остаётся `NOT_RUN` из-за GitHub 403. Все остальные регрессии исходного T2 и T3 прошли. В `real-host` подтверждены квалифицированный оригинальный Kernel 0.3.6, собранный signed one-dist, BLI UI, D2/.iwxa и холодное восстановление на синтетическом Access-owner.

**Подлинный закрытый Control:** [публичный Center workflow #43451809012](https://github.com/Faust-S/Center/actions/runs/43451809012), ветка `work/2026-11-13-t3-d1-private-qualification`, SHA `9fd24a86f5f6f017f4abf22ba36859ad2fdeb176`. Входной токен `IWXA_PRIVATE_SOURCE_READ_TOKEN` присутствует, Checkout `knowledge` PASS, Checkout **закрытого `Faust-S/T3@da85c3aa` FAIL HTTP 403**; завершающая очистка временных файлов PASS. Стадирование настоящего Control, оригинальный Ed25519 AccessRegistry, signed two-organization HTTP и cross-owner D2 E2E на данной ревизии: **NOT_RUN**, а не FAIL/PASS. Предыдущая ошибка синтаксиса публичного workflow `Center@8121f8c0` исправлена в `Center@c0a34b54`; текущий #43451809012 уже выполняет корректный YAML.

**Точный следующий внешний шаг:** владелец GitHub должен переиздать/переопределить `IWXA_PRIVATE_SOURCE_READ_TOKEN` в **Actions secrets открытого `Faust-S/Center`**, выдать этому fine-grained PAT доступ `Contents: Read` только к `Faust-S/T3` (и подтвердить SSO/организационный доступ, если требуется). Не отправлять значение токена в чат, в исходники, workflow или отчёты. После этого повторно запустить существующий публичный Center workflow и устранить реальные обнаруженные дефекты только в `knowledge`, не в приватном T3. Затем выполнить полнофункциональный установленный Windows-маршрут оригинальный Control -> подписанная Workspace -> BLI -> Kernel -> холодный рестарт и общую G4-приёмку.

**Статус:** `D1_D5_PUBLIC_CONSUMER_STAGE=PASS`, `D1_REAL_PRIVATE_SIGNER=NOT_RUN`, `INSTALLED_WINDOWS_G4=NOT_RUN`, `G4=NOT_ACCEPTED`, `T3_READY=false`.
