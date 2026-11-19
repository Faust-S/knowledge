# IWXA T3 G4: подлинный Agent Core в D3, 19.11.2026

## Проверенный результат

Публичный Windows CI [№44571096678](https://github.com/Faust-S/knowledge/actions/runs/44571096678) завершился **SUCCESS: 23/23 обязательных маркера**. Уровень: **NATIVE_PROCESS_SOURCE_PASS_NOT_INSTALLED_GUI**.

Исходные закрепления:
- Один T3: `Faust-S/knowledge@807a3ef064ae819702d0eebf369c1f5529ded110` (проверенная CI ревизия).
- Центральный Agent 0.6: `Faust-S/iwxa-personal-agent@dff16da239882582d305a7fb4fc429ef7d58be3a`.
- Оригинальный корпоративный T3 Owner: `Faust-S/T3@1a8267634955947bc0c6adc5614d7de176a33da2`.
- Нормативный T2: `Faust-S/T2@9c64951cd78411283e8a416641c36d71e169fc1d`.
- Установленный Admin Center: прежний самостоятельный PASS [№44559119290](https://github.com/Faust-S/knowledge/actions/runs/44559119290).

Действительный исходный D3 теперь проходит: оригинальная подписанная корпоративная Task → существующий `DailyDriverEngine` → **настоящая локальная Qwen3 0.6B / Ollama** → неизменяемый Result → явно инициированное в исходном тесте `review(..., "approve")` → проверка принятого артефакта → `OriginalEmployeePort.prepare(engine, task_id, selection)` → оригинальный подписанный T3 `.iwxa` → независимое получение и оригинальный Kernel Object/Event APPLY → два холодных readback. Повторный экспорт предотвращён.

В отдельном входном маршруте восстановлены исходные методы Agent `employee_first_use`, `employee_candidate`, `employee_proof`. Они делегируют **только** оригинальному `interop/native-employee-d3.mjs`; ключи хранятся через оригинальный Windows DPAPI, организационные права выдаёт оригинальный корпоративный владелец через нормативный T2. Ни нового IAM, ни подписанта, ни Kernel, ни Store, ни формата архива не создано.

Исходники закрытого Agent подгружаются во **временный ограниченный sparse/blob-filtered checkout** точно закреплённого commit и удаляются без публикации. Оригинальные T3 модули подключаются ограниченной транзитивной выборкой. Приватные Actions не запускались.

## Важное ограничение доказательств

В CI подтверждена настоящая модель и оригинальные механизмы, **но источник Human Review и ACCEPT/APPLY в тесте управляется программной явной командой**, а не физической операцией человека в установленной нативной программе. Наличие независимых криптографических кандидатов не подтверждает два разных Windows user SID. Поэтому G4 **не принимается**.

Статус: `T3_READY=false`, `G4=NOT_ACCEPTED`.

## Следующий порядок, без переключения архитектуры на Atlas

1. Установить **оригинальный Agent 0.6 в отдельный Windows user SID**, отдельно от установленного Admin Center и его корпоративного Owner. Проверить, что менеджерские DPAPI-ключи не попали к сотруднику; ни один участник не экспортирует закрытый ключ.
2. От реального пользователя сотрудника: открыть подписанную Task, выполнить уже имеющийся локальный inference, физически выполнить Human Review в GUI, получить подписанный Result через оригинальный T3. После закрытия Agent заново открыть и сверить неизменяемые исходные квитанции.
3. В **установленном Admin Center** выполнить отдельное нативное Human ACCEPT, затем **другое явное действие Human APPLY**. Через оригинальный Kernel зафиксировать Object/Event, независимо прочитать оригинальные квитанции после двух холодных запусков. Несогласие, потеря ACK и повторная отправка должны отказать безопасно.
4. Универсальный D6_GENERIC: не Atlas-специфичный объект, а любой авторизованный самостоятельный продукт-получатель с собственным штатным Host/Store и восстановлением. Atlas остаётся факультативным интегрируемым приложением.
5. Независимый D7_PERSON: подписанный PERSON Publisher, выпуск/продление/STATUS/отзыв и установленный получатель с холодным восстановлением.
6. Конечный D5: одна установленная исходная T3 Host/One Dist, реальная WebGPU-модель, генерация и полностью офлайн холодный перезапуск с повторной генерацией. Аппаратный исходный Metal PASS сам по себе не закрывает installed gate.
7. Сверить HEAD/TREE, нормативный T2 и итоговый One Dist, выполнить независимую финальную приёмку, обновить машинный реестр **только по точным результатам**.

Ссылки на реализацию: `packages/t3-core/tests/g4-original-agent-native-driver.py`, `packages/t3-core/scripts/qualify-native-corporate-agent-process.mjs`, `.github/workflows/t3-native-original-employee.yml`; Agent `runtime/t3_original_employee_port.py` и `runtime/t3_original_employee_worker.mjs`.

Нормативным машиночитаемым статусом остаётся `packages/t3-core/handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`. Исторические CI FAIL #44569790539 и #44570223585 не скрываются: первый обнаружил несоответствие формы ответа scheduler, второй выявил отсутствовавшие первичные операции сотрудника в новом Agent; оба дефекта исправлены перед SUCCESS #44571096678.

## 19.11: два Windows SID с оригинальным Agent IPC

**Факт:** [публичный Windows CI №44589568659](https://github.com/Faust-S/knowledge/actions/runs/44589568659) = **SUCCESS**, ревизия `knowledge@9439db65f156b7ed17f5c180c7217b8828a49939`, оригинальный T3 `1a8267634955947bc0c6adc5614d7de176a33da2`, центральный Agent 0.6 `dff16da239882582d305a7fb4fc429ef7d58be3a`.

Подтверждены четыре исходных нативных признака: `G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_FIRST_USE_PASS`, `G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_DPAPI_COLD_PASS`, `G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_SIGNED_PROOF_PASS`, `G4_ORIGINAL_AGENT_SECOND_SID_CRYPTO_PROOF_VERIFIED_PASS`. Реальный второй Windows user SID выполнил первичную регистрацию сотрудника через штатные `OriginalEmployeePort` и Node-worker; его оригинальный DPAPI-кандидат восстановлен другим процессом, а оригинальная Ed25519-подпись вызова проверена публичным ключом сотрудника. Это **source/native-process** квалификация, не установленный Agent Tauri и не реальные клики Human ACCEPT/APPLY.

Причина длительного отказа: исходные приватные модули находились в пользовательском TEMP руководителя, через который второй Windows SID не мог безопасно пройти. Исправление не выдаёт прав на TEMP руководителя: оно размещает **строго закреплённые необходимые исходные модули** во временном каталоге второго пользователя внутри ProgramData, проверяет ACL, не переносит менеджерские vault, правомочия или Kernel. Весь временный исходный код удалён после проверки; приватные Actions и артефакты не использованы. Прежний отдельный Windows OS SID/DPAPI PASS №44577052493 сохранён.

Объединённый исходный D3 **прошёл** в [Windows CI №44590346618](https://github.com/Faust-S/knowledge/actions/runs/44590346618), точная ревизия `knowledge@530f72f75f3c168265894dec1ec154f7e0d65fa4`: **26/26 предметных маркеров PASS**, итоговый `G4_NATIVE_PROCESS_SOURCE_PASS_NOT_INSTALLED_GUI`, закрытые временные исходники удалены. В одном CI проверены Qwen3, оригинальный T3 Result, Kernel Object/Event и два cold readback, плюс независимый Windows SID и original Employee DPAPI/Ed25519. **Это две исходные церемонии в одном Windows-прогоне, не один непрерывный установленный Agent SID → Admin GUI маршрут.** Не засчитывать как физические native Human ACCEPT/APPLY или G4.

**Статус:** `T3_READY=false`, `G4=NOT_ACCEPTED`.

## Следующий установленный рубеж и обнаруженный pin-разрыв

В центральном Agent 0.6 [`config/public-module-sources.json`](https://github.com/Faust-S/iwxa-personal-agent/blob/work/2026-11-15-agent-0-6-development/config/public-module-sources.json) установлен T3 pin `3f91b60c56e34a21ea919a4a2004e31bb5071c60`. Квалифицированный общий G4 One Core = `530f72f75f3c168265894dec1ec154f7e0d65fa4`. Исходный `tools/build_setup_core_windows_candidate.ps1 -RequireOriginalT3` намеренно запрещает сборку с несовпадающим pin. Поэтому **не** устанавливать текущий Agent как G4 без согласованной смены pin в самом владельце Agent. После фиксации единого кандидата обновить только зависимость T3 в Agent, собрать настоящий Tauri + Setup Core + оригинальный T2 0.3.6 One Dist, проверить установленный Agent под вторым Windows SID и отдельные native Human Review, Admin ACCEPT и APPLY. Приобретённые исходные Qwen3/D3 доказательства не подменять. Следом D6_GENERIC без Atlas, D7_PERSON и офлайн D5. До установленной независимой приёмки `T3_READY=false` и `G4=NOT_ACCEPTED`.
