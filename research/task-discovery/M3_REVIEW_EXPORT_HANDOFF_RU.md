# TASK-EXP-01 — M3: раздельные экспорты Label Studio

Существующий `labelstudio_project_setup.py` дополнен режимом `--export-reviewed-projects`: принимает два ID уже размеченных проектов, локальные пути двух новых JSON-файлов, прежние `--tasks`, `--owner-label-config` и адрес локального сервера. Токен Label Studio хранится только в локальном окружении.

Проверяет все восемь исходных SHA, отсутствие model predictions, по одной завершённой аннотации на источник, постоянство заявленного reviewer ID в каждом проекте и различие учётных записей между проектами. Экспорт не означает независимую квалификацию специалистов, согласование или gold.

Файлы из локальной среды передаются без публикации в существующий `Faust-S/iwxa/knowledge/task-catalog/engine/research/task_exp_01_review_bridge.py`. Его параметры: `--source-first-packet`, `--review-a`, `--review-b`, `--restricted-disagreement-output`, `--confirm-independent-local-review`. Этот owner bridge отвечает за Unicode spans, смысловые labels, поля цели/результата/критерия и разногласия. После сверки требуется отдельное экспертное согласование.

Локальная инженерная проверка адаптера: 9/9 адресных тестов на synthetic HTTP API PASS. Настоящие независимые человеческие оценки, task P/R/F1 и human time — NOT_MEASURED. Ни raw exports, ни оригинальные документы не отправляются в GitHub.
