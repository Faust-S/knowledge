# IWXA T3 G4: отдельное первое включение корпоративного сотрудника

Дата: 18.11.2026. Статус: **SOURCE_IMPLEMENTED / WINDOWS_REQUALIFICATION_NOT_CONFIRMED / G4=NOT_ACCEPTED**.

## Проверенная исходная граница

- Последний ранее подтверждённый Windows результат: knowledge Actions #44383462807, пять проверок исходных межпроцессных маршрутов и самостоятельный original PRODUCTION Admin Owner.
- Пять проверок не образуют одну корпоративную операцию. Личный TEST-профиль сотрудника создавался через исходный fixture `provision()`.
- В оригинальном `Faust-S/T3` уже есть PRODUCTION-операции native Admin D3: read/init подписанного T2 Kernel реестра, independent credential proof admission, employee begin/complete/read, отдельно signed Task DATA grant и адресованная Task, native ACCEPT и отдельный Human APPLY. Не создавать новый Kernel, signer, IAM, Store, Task Engine или Exchange.
- Agent Node/Python работает с *ранее существующим* DPAPI employee vault и original invitation/Task, но исходная Windows первая регистрация независимого сотрудника ранее не была квалифицирована.

## Новый узкий срез

Исходный владелец: `Faust-S/T3@work/2026-11-16-admin03-independent-employee-owner`, commit `c7dda44a09cd0bff338f8d0c72b5e1d78d54d1b0`, `interop/native-employee-d3.mjs`.

Реализовано:
1. На Windows отдельно от Admin создаются собственные идентификаторы сотрудника и два оригинальных Ed25519-ключа в существующем шифрованном vault под DPAPI CurrentUser. Оригинальный issued grant **не создаётся**.
2. Требуется явно предъявленный issuer public key с совпадающим SHA-256; public review key и exact organisation/Workspace фиксируются в локальном контексте. Отсутствующий, повреждённый, частично созданный либо повторный root не подменяется новой регистрацией.
3. Холодное чтение подтверждает исходный key и организационную привязку. `makeProof()` подписывает точно проверенный оригинальный challenge. Оно не означает допуск сотрудника или выдачу полномочий.
4. Запрещены собственный второй issuer и автоматическая доставка.

Публичный квалификационный код: `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection`, commit `91b4c67b379a56e458409dfca678574623c84cde` (исправление точного проверяемого null-delimiter: `f902a9dd18d57652c31b27c6b4944d480e825514`).

Windows qualification должна:
- сохранить прежние пять PASS;
- получить настоящий PRODUCTION manager identity/key/trust из исходного owner root;
- создать отличный от менеджера новый employee vault; повторное создание и wrong scope блокировать;
- холодным отдельным Node/DPAPI-процессом подписать employee proof и независимо проверить Ed25519 signature и digest всех полей;
- выдавать шестой маркер `G4_ORIGINAL_PRODUCTION_INDEPENDENT_EMPLOYEE_CREDENTIAL_COLD_PASS` только после исполнения.

**Новый шестой PASS пока не наблюдался.** Отсутствие результатов нового CI не трактовать как успех.

## Незакрытый системный G4

1. Подключить отдельного employee `d3EmployeeCredentialAdmit → d3EmployeeComplete → d3EmployeeTaskGrantIssue → d3EmployeeCreateTask/ExportTask` к настоящему подписанному оригинальному T2 Kernel с Object/Event + readback.
2. Выполнить уже работающий Agent Node/Python signed Task → accepted Result именно для этого employee; зарегистрированная организация не должна быть TEST fixture.
3. Оригинальный Admin receive → отдельный Human ACCEPT → отдельный Human APPLY → `t1.commitObjectGraph` → два холодных чтения Object/Event без повтора Apply. Не путать ACCEPTED и APPLIED.
4. Проверить установленные GUI Admin Center + Agent. D6 и PERSON D7 выпускать самостоятельными маршрутами, Atlas не является обязательным посредником.

Приватность: исходник T3 остаётся в закрытом T3; публичные изменения knowledge содержат только квалификационный код, hashes и имена маркеров. В открытом knowledge CI допускается лишь временное ограниченное чтение приватных исходников с гарантированным удалением без публикации артефактов; private Actions не запускать.

`T3_READY=false`; `G4=NOT_ACCEPTED`.
