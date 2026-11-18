# IWXA T3 G4: original PRODUCTION employee, Windows DPAPI и T2 Kernel

18.11.2026. Исполняемый T3: `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection`. Приватный оригинальный подписант: `Faust-S/T3@work/2026-11-16-admin03-independent-employee-owner`. Сотрудник Agent: `Faust-S/iwxa-personal-agent@work/2026-11-16-agent06-corporate-t3-d3-current`.

## Подтверждено на реальных Windows процессах

1. [#44383462807](https://github.com/Faust-S/knowledge/actions/runs/44383462807): исходный подписанный TEST Agent Task/Result, Admin ACCEPT и cold readback, отдельно PRODUCTION Admin Owner с DPAPI, 5/5.
2. [#44395161644](https://github.com/Faust-S/knowledge/actions/runs/44395161644): независимый PRODUCTION сотрудник, собственный оригинальный T3 DPAPI Vault и Ed25519 PROOF, 6/6.
3. [#44396018427](https://github.com/Faust-S/knowledge/actions/runs/44396018427): исходное первое включение через **настоящий** Agent Python→Node IPC→original T3, холодная подпись и проверка запроса, 7/7.
4. [#44396622596](https://github.com/Faust-S/knowledge/actions/runs/44396622596): невозможность автоматически перевыпустить ключ через тот же Agent IPC и холодное чтение, 8/8.
5. [#44397866639](https://github.com/Faust-S/knowledge/actions/runs/44397866639): две независимые подписи сотрудника: admission нового proof-only ключа и второй membership grant challenge, 9/9. Отдельно устранено повреждение приватного файла T3 в `ceac8051116b75c01efefdeba986fc9849f73ccc`; добавлена preflight проверка синтаксиса оригинальных private owner modules до испытаний.
6. [#44399566882](https://github.com/Faust-S/knowledge/actions/runs/44399566882): 10/10 PASS. Оригинальный PRODUCTION Admin Manager и independently created employee на **том же настоящем квалифицированном T2 Kernel 0.3.6 / Contract 1.3.0**. Kernel сохранил registry Object и три подписанные статусные версии/события: bootstrap, admission proof-only key, issuance `work.prepare` ACTION + `package.export` DATA grants. Адресный дефект manager JIT времени обнаружен реальным Kernel и устранён в private T3 `interop/runtime.mjs` коммитом `0aa8b602af7c59a0eca1ee7fb1bd45fd4159ab73`. Один Kernel, Store и оригинальный issuer; test fake Kernel не применялся.
7. Следующее расширение сценария через оригинальный Kernel (manager Task DATA grant, signed invitation, addressed Task и readback) добавлено в исходники knowledge `tests/g4-production-original-kernel.browser.mjs`, Windows CI в работе: **результат ещё не принят**.

## Архитектурные и продуктовые границы

- `Faust-S/T3` владеет оригинальным issuer, encrypted vault, первичным сотрудником, подписью и оригинальными `.iwxa`. Agent не получает issuer key, не создаёт второй IAM или ключи менеджера. Только делегирует `employee_first_use`, `employee_candidate`, `employee_proof` исходному T3.
- Реальный original T2 Kernel/Host остаётся единственным хранилищем подписанного registry Object/Event. Проверки `getObject` и `listEventsSince` выполняются после `commitObjectGraph`.
- Два разных person ID и vault root на одном Windows runner **не равны** двум независимо установленным Windows-программам под разными OS SID. Этот рубеж отдельно остаётся HOLD.
- 10/10 source/native-process PASS **не** доказывает полный PRODUCTION Admin→Agent→Admin RESULT, подписанную корпоративную Task на реальном employee или установленный пользовательский GUI.
- `ACCEPTED` и `APPLIED` не равнозначны. Следующий рубеж: signed addressed Task → employee Agent accepted Result → original Admin Human ACCEPT → отдельный Human APPLY → реальный `t1.commitObjectGraph` Object/Event → два холодных чтения, без повтора APPLY; после него installed GUI Admin Center/Agent.
- D6 и PERSON D7 квалифицировать независимо. Atlas не обязательный посредник.
- Приватные Actions запрещены; разрешён только публичный `knowledge` Windows CI с временным bounded read-only доступом к точным приватным SHA, без публикации исходников, ключей, Results, EXE, кешей и artifacts. Временные файлы удаляются в `finally` и выводятся только фиксированные коды/статусы.

## Обнаруженная системная флуктуация

В общих Windows тестах 18.11 один source job упал по `EADDRINUSE 127.0.0.1:42904`, так как тест изолированного T3 UI выбирал `kernelPort+1` без резерва. Это не отказ original Kernel. Тестовый fixture переведён на выбранный ОС свободный UI порт в `t3-d1-isolated-ui-server.test.mjs`; **производственная схема не изменена**. Повторный Windows `test` job на `8080f963` SUCCESS.

`T3_READY=false`, `G4=NOT_ACCEPTED`, `productionActivation=false`. Не повышать эти статусы без установленного Human APPLY и полного релиза.
