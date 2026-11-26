# Квалификация Home Lab 0.1

Дата: 26.11.2026. Проверка исходников и реального Apache в изолированной Debian среде, не физический Intel N150.

| Проверка | Результат |
|---|---|
| Python compile | PASS |
| init-db.sh syntax | PASS |
| Compose YAML parsing / структурные ограничения | PASS |
| Генерация нового state, уникальные credentials, права файлов, повторная инициализация запрещена | PASS |
| Apache P0 config test | PASS |
| TLS, SAN, доверенный CA, отказ недоверенного сертификата и неизвестного имени | PASS |
| Реальный PUT и GET независимыми HTTP principals, Asset 1 050 000 байт, SHA256 совпадает | PASS |
| Conditional PUT, прежнее содержимое сохранено, отказ без If-None-Match | PASS |
| Изоляция workspace-a/b и отказ неразрешённых методов/пути | PASS |
| Apache idp config test / реальный HTTPS proxy с HTTP fixture, перезапись forwarded headers, admin только loopback | PASS |
| Структура OIDC realm / два confidential client / S256 | PASS (структура) |
| Квалификация Python unittest | 8/8 PASS |
| Compose CLI и pull/lock реальных image digest | NOT_RUN |
| PostgreSQL role/database initialization | NOT_RUN |
| Запуск Keycloak, discovery, user/admin login | NOT_RUN |
| mod_auth_openidc syntax с настоящим модулем, SSO | NOT_RUN |
| Реальный Intel N150 / Ubuntu Server 26.04.1 | NOT_DEPLOYED |
| Два оригинальных Host / Kernel / Vault / peer | NOT_RUN |
| Binding IWXA ID → original actor, domain API audience/DB и native app integration | NOT_STARTED |

Локальная среда: Apache/2.4.68 Debian, Python, OpenSSL, curl. В журнале Apache был warning о разнице patch версии OpenSSL, без ошибки TLS. Docker и mod_auth_openidc отсутствуют, сетевой доступ к package registry недоступен; тесты identity runtime не подменены mock и не объявлены PASS. HTTP fixture используется только для проверки направления HTTPS proxy и нормализации заголовков. Прежняя P0 готовность проверялась сначала GET каталога; он вернул 404 при закрытом directory listing. Исправлено условие readiness на фактический PROPFIND (207), затем тесты прошли.

Нет изменений исполняемого T3/T4; не требуется новая Actions квалификация ядра только из-за этих файлов. Для реального пилота нужны исходная принятая композиция T4, согласованный Host deployment и самостоятельные устройства. Статус: `INFRASTRUCTURE_SOURCE_PREPARED`, `PHYSICAL_PILOT_NOT_RUN`, `T4_READY` не меняется.
