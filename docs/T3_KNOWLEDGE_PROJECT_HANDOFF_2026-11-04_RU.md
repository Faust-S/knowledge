# T3 → «Система знаний»: открытая карта продолжения, 04.11.2026

Публичная часть передачи существующего IWXA-направления. Приватные исходники, пакеты и данные не копировать.

**Единая логика:** Problem/Goal → Task Discovery/Activity Research/U1 при необходимости → Task → Agent Solution либо Model+Skills → Context → Graph при необходимости → существующий Runtime → Result/Human Review → сохранение и дальнейшая работа. Для личной Task не требуются T3, Admin или Publisher.

**Межсубъектный сценарий:** Personal Agent позволяет вручную выбрать часть принятого Result. В T3 сотрудник может вставить этот текст в редактируемый черновик только при наличии подписанного организационного задания. Затем обычные T3 prepare/previewExport/exportResult создают .iwxa. Admin отдельно получает пакет, проверяет, принимает и при необходимости применяет в свой Store с readback. Вставленный текст и его персональные origin SHA не являются доказательством подлинности Personal Agent: буфер обмена изменяем. Простая форма одного и того же расширения .iwxa не гарантирует совместимость профилей.

**Владение кодом:**
- `Faust-S/knowledge`: разрешённые открытые эксперименты Task Discovery / Activity / Cross-Lab и agent solutions.
- `Faust-S/IWXA-knowledge`: закрытая интеграционная матрица, приёмочные критерии, handoff.
- `Faust-S/T3`: Reconciliation, offline exchange, Access, Journal/Store; исходники остаются у владельца.
- `Faust-S/iwxa-personal-agent`: personal Task/Result/Runtime, выбор из принятого Result.
- Admin/Publisher: самостоятельное корпоративное применение / лицензии.

**Следующая проверяемая работа:** в полном приватном T3 checkout выполнить `node --test tests/pa-result-import.test.mjs tests/pa-result-roundtrip.test.mjs tests/task-result-knowledge-boundary.test.mjs`; затем реальный PA accepted Result → отдельный организационный .iwxa → Admin Human Review → отдельное application.apply → двойной restart/readback. Статические и изолированные проверки не заменяют product PASS. `T3_READY=false`.

Нормативный подробный handoff с актуальными HEAD/TREE находится в закрытом `Faust-S/IWXA-knowledge/docs/13_T3_KNOWLEDGE_PROJECT_HANDOFF_2026-11-04_RU.md`. Не давать публичному Actions доступ к приватным репозиториям, PAT, ключам и пользовательским данным.

Переход в проект ChatGPT «Система знаний» делается в интерфейсе пользователя; он не переносит исполняемые модули или владение исходниками.
