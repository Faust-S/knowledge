# TASK-EXP-01 — M3: раздельная человеческая разметка в Label Studio

**Текущий статус:** два изолированных экземпляра Label Studio 1.23.2, раздельная передача источников и экспорт проверены на синтетическом HTTP-сценарии. **Независимых человеческих оценок нет; M3 и adjudication PENDING; precision/recall/F1 NOT_MEASURED.**

## Граница изоляции

Label Studio Community Edition в одной организации позволяет видеть чужие проекты; два проекта на одном сервере не обеспечивают слепоту. Поэтому владелец использует **два независимо доступных экземпляра с отдельными базами данных и отдельными реальными рецензентами**. Режимы CLI `--reviewer-slots 2` и `--export-reviewed-projects` заблокированы для человеческого M3 (соответственно `M3_TWO_PROJECTS_IN_ONE_CE_NOT_BLIND` и `M3_SAME_SERVER_PAIRED_EXPORT_NOT_BLIND`). Соответствующие Python-функции сохранены **только для синтетических транспортных тестов**, а не как путь реальной разметки. Функция `--export-single-reviewed-project` остаётся производственным маршрутом.

## Запуск двух постоянных локальных экземпляров M3 (07.11.2026)

Это **практический запуск уже проверенного** Label Studio 1.23.2 для owner-local Human Review, а не новая подсистема и не научная приёмка. Сначала требуется действующий Docker, **свободные локальные порты 8080/8081**, два раздельных реальных специалиста и разрешённая для них среда. Из терминала на машине владельца (команды Docker CLI одинаковы для Bash и PowerShell):

```sh
docker volume create iwxa-m3-review-a
docker volume create iwxa-m3-review-b
docker run --detach --name iwxa-m3-review-a --publish 127.0.0.1:8080:8080 --volume iwxa-m3-review-a:/label-studio/data heartexlabs/label-studio:1.23.2
docker run --detach --name iwxa-m3-review-b --publish 127.0.0.1:8081:8080 --volume iwxa-m3-review-b:/label-studio/data heartexlabs/label-studio:1.23.2
docker ps --filter name=iwxa-m3-review
```

**Проверяемый результат запуска:** два самостоятельных контейнера и **два разных именованных Docker volume**. Каждый контейнер имеет свою БД/аннотации, порт B снаружи `8081`, внутри `8080`. Дождитесь реальной доступности интерфейсов `http://127.0.0.1:8080` (A) и `http://127.0.0.1:8081` (B); успешный `docker ps` сам по себе не подтверждает готовность HTTP/API. Для уже созданных контейнеров используйте `docker start iwxa-m3-review-a iwxa-m3-review-b`, **не запускайте повторную установку и не удаляйте volume**, содержащие проекты/человеческие разметки. Конкретный Docker-образ уже запускался в synthetic CI; эти команды проверены на синтаксис Bash, но **owner-local Docker, учётные записи и Human Review в этой передаче не выполнялись**.

Откройте A и B в разных учётных контекстах. Зарегистрируйте **двух настоящих специалистов** так, чтобы каждый размечал только свой отдельный экземпляр; для B при коллизии исходных числовых ID используйте штатное приглашение человека B администратором его **отдельного** экземпляра через `Organization → Add Members`, как описано ниже. Не публикуйте invitation URL, API-ключи, исходные тексты или сырые аннотации. Точные шаги регистрации и приглашения подтверждены [официальной инструкцией Label Studio Community](https://labelstud.io/guide/signup); два аккаунта внутри **одного** экземпляра Community Edition не обеспечивают слепую разметку.

Далее используйте существующий `--create-isolated-pair --confirm-local-import`, затем `--preflight-isolated-reviewers`, два индивидуальных `--export-single-reviewed-project` и исходный `owner_review_cycle.py` из следующих разделов **строго на неизменённом owner-local наборе 8/8**. Отдельные volume решают проблему хранения и изоляции проектов на уровне установок; они **не доказывают** независимость двух людей или отсутствие обмена ответами. При недоступности Docker, неподтверждённых учётных данных, несовпадении ID/блобов или отсутствии настоящих специалистов возвращайтесь к `HOLD`, не создавайте синтетические Human Gold.

## Windows PowerShell: существующий маршрут M3 без Unix-путей

Для Windows установлены **два различных** понятия: Docker хранит проекты в именованных томах (команды выше), а `/PRIVATE/...` в остальных примерах означает **приватную директорию вне Git checkout**, а не обязательный путь в Windows. PowerShell не использует обратный слеш `\` как перенос аргументов Bash. Ниже — однострочные вызовы **тех же существующих Python CLI**, без новых адаптеров. Примерные `C:\IWXA\...` пути заменить своими фактическими каталогами. Команды предполагают, что контейнеры A/B уже запущены и оба локальных API доступны.

```powershell
$owner = 'C:\IWXA\iwxa'
$public = 'C:\IWXA\knowledge'
$private = 'C:\IWXA-Private\M3'
New-Item -ItemType Directory -Force -Path $private | Out-Null
$packet = Join-Path $private 'e5-envelope.json'
$import = Join-Path $private 'labelstudio-import.json'
$method = Join-Path $private 'u1-method-spans.json'
$xml = Join-Path $private 'TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml'

Push-Location (Join-Path $owner 'knowledge\task-catalog')
try {
    python -m engine.research.task_exp_01_real_slice --restricted-output $packet --restricted-import-output $import --restricted-method-output $method --confirm-local-source-review
    if ($LASTEXITCODE -ne 0) { throw 'M3 owner source replay HOLD' }
} finally { Pop-Location }

Copy-Item -LiteralPath (Join-Path $owner 'knowledge\task-catalog\engine\research\TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml') -Destination $xml -ErrorAction Stop

if (-not $env:LABEL_STUDIO_API_KEY -or -not $env:LABEL_STUDIO_SECOND_API_KEY) {
    throw 'M3 reviewer credentials are not configured in this private session'
}
Push-Location $public
try {
    $pairJson = python research/task-discovery/labelstudio_project_setup.py --tasks $import --owner-label-config $xml --url http://127.0.0.1:8080 --other-url http://127.0.0.1:8081 --create-isolated-pair --confirm-local-import
    if ($LASTEXITCODE -ne 0) { throw 'M3 isolated pair HOLD; inspect partial project IDs before retry' }
    $pair = $pairJson | ConvertFrom-Json
    if ($pair.status -ne 'TWO_LOCAL_ISOLATED_SOURCE_FIRST_PROJECTS_READY_NOT_GOLD') { throw 'M3 pair not qualified' }
    $preflightJson = python research/task-discovery/labelstudio_project_setup.py --tasks $import --owner-label-config $xml --url http://127.0.0.1:8080 --project-id $pair.project_a_id --other-url http://127.0.0.1:8081 --other-project-id $pair.project_b_id --preflight-isolated-reviewers
    if ($LASTEXITCODE -ne 0) { throw 'M3 reviewer preflight HOLD' }
    $preflightJson | ConvertFrom-Json | Select-Object status, sources_each, human_gold
} finally { Pop-Location }
```

Перед этим кодом оператор должен разрешить **локальную** работу с закреплёнными публичными исходниками, обеспечить два реально раздельных экземпляра и получить API-токен каждого **настоящего** специалиста в его разрешённой среде; секреты не записывать в Git, журналы команд, сообщения и отчёты. `$pair.project_a_id` и `$pair.project_b_id` — реальные ID, полученные в текущем запуске; их надо сохранить локально, но **не** создавать новый проект при повторном запуске только ради их восстановления. Исходная XML проверяется собственным SHA и persisted-form readback. При повторном запуске генератор не должен перезаписывать уже созданные защищённые пакеты; использовать существующие проверенные файлы.

После фактической независимой разметки 8+8 **каждый** специалист выполняет `--export-single-reviewed-project` из своего отдельного сеанса PowerShell, где `LABEL_STUDIO_API_KEY` соответствует **его** собственному Label Studio (A: порт 8080, B: порт 8081), задаёт сохранённый `--project-id`, `--review-out` и оригинальные `--tasks`/`--owner-label-config`. Только после появления двух настоящих, неизменённых `review-a.json` и `review-b.json` оператор запускает из `$public`:

```powershell
python research/task-discovery/owner_review_cycle.py --owner-root $owner --source-first-packet $packet --review-a (Join-Path $private 'review-a.json') --review-b (Join-Path $private 'review-b.json') --restricted-disagreements-out (Join-Path $private 'disagreements.json') --effort-out (Join-Path $private 'review-effort.json') --confirm-independent-local-review
if ($LASTEXITCODE -ne 0) { throw 'M3 original Review Bridge / effort HOLD' }
```

Токены необходимо держать в отдельных локальных средах A/B; запускать два экспорта одним общим административным токеном **нельзя**. `owner_review_cycle.py` сверяет исходные два экспорта и передаёт их **исходному owner Review Bridge**, но не делает независимого adjudication. При одинаковых reviewer ID, изменённом источнике, неверной XML, отсутствии Docker или двух людей остановиться на `HOLD`; не подменять разметки синтетикой. Данный PowerShell-маршрут сверён **по аргументам существующих CLI**, но исполнение на Windows с реальными людьми **NOT_TESTED**.

## Контроль исходной выборки перед приглашением рецензентов

**04.11.2026 — проверено 8/8.** Сравнены живые GitHub API источники с неизменённым публичным манифестом `task_exp_01_source_metadata.json` (Git blob `4ecaa74522ba1c3fa4e8851e877200c7767ad0de`). Все **8/8** совпали по SHA-256 полной текстовой проекции `title + "\\n" + body + "\\n"`, SHA-256 тела и количеству UTF-8 байтов. У **4/8** изменилось служебное `updated_at`; это не привело к изменению закреплённых текстов. Не обновлять `source_edition` из текущей метаактивности GitHub, не переотбирать выборку и не перекалибровывать уже frozen U1/regex.

Перед реальным owner-local импортом можно повторить проверку **существующей** командой из публичного checkout:

```sh
python research/task-discovery/source_first_baseline.py
```

Она проверяет восемь байтово закреплённых исходников через публичный GitHub API и даёт только cue/source receipt, **не** человеческий gold. При отказе или расхождении SHA — `HOLD`: использовать официально сохранённые owner-local неизменённые проекции либо восстановить их с проверкой тех же SHA, но **не** заменять текст актуальным отредактированным Issue. Исходный `task_exp_01_real_slice.py` также проверяет body/projection SHA и остаётся владельцем подготовки приватного E5 packet.

## Последовательность в разрешённом owner-local окружении

1. Из исходного `Faust-S/iwxa@knowledge/2026-10-02-system-atlas` получить **ровно восемь оригинальных источников** существующей командой `python -m engine.research.task_exp_01_real_slice --restricted-output /PRIVATE/e5-envelope.json --restricted-import-output /PRIVATE/labelstudio-import.json --restricted-method-output /PRIVATE/u1-method-spans.json --confirm-local-source-review`. Повторно проверить SHA каждого источника; приватные выходные файлы хранить вне Git checkout.
2. Использовать исходный `knowledge/task-catalog/engine/research/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml`, а **не** общий E5 XML. Проверить его существующим `review_form_contract.py`.
3. Создать **по одному** проекту на экземплярах A и B, каждый раз задавая свой `LABEL_STUDIO_API_KEY` локально и запуская из публичного checkout:

   ```sh
   python research/task-discovery/labelstudio_project_setup.py \
     --tasks /PRIVATE/labelstudio-import.json \
     --owner-label-config /PRIVATE/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml \
     --url http://127.0.0.1:8080 --create-local-projects --confirm-local-import
   ```

   Для экземпляра B использовать его локальный URL/порт и другой токен, а при **отдельном** вызове `--create-local-projects` явно добавить `--reviewer-label B`: иначе оба проекта будут называться reviewer A. Режим `--create-isolated-pair` назначает роли A/B автоматически. Фактический ID проекта сохранить из квитанции.

   **Упрощённый маршрут (05.11.2026):** вместо двух отдельных команд создания и третьей проверки можно выполнить существующий адаптер один раз, если оба Label Studio уже запущены и имеют **разные исходные числовые reviewer ID** (это требование оригинального Review Bridge). Не записывайте реальные токены в команду или Git; передайте локальные `LABEL_STUDIO_API_KEY` и `LABEL_STUDIO_SECOND_API_KEY` через окружение:

   ```sh
   python research/task-discovery/labelstudio_project_setup.py \
     --tasks /PRIVATE/labelstudio-import.json \
     --owner-label-config /PRIVATE/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml \
     --url http://127.0.0.1:8080 --other-url http://127.0.0.1:8081 \
     --create-isolated-pair --confirm-local-import
   ```

   **Практический запуск двух настоящих независимых учётных записей (07.11.2026).** При двух чистых отдельных установках Label Studio первоначальные владельцы могут получить одинаковые локальные числовые user ID (например, `1` и `1`), хотя БД разные. Это **не доказательство того, что человек один**, но исходный owner Review Bridge сопоставляет неизменённые `completed_by` и требует различающиеся ID. Поэтому `verify_isolated_reviewers` до создания проектов обоснованно возвращает `HOLD: ISOLATED_NATIVE_REVIEWER_IDS_COLLIDE`. Не менять ID в исходном Label Studio, API-экспорте или Review Bridge.

   Для устранения именно этого практического препятствия используйте штатное управление пользователями **в уже существующем втором экземпляре B**: откройте его интерфейс → меню → **Organization** → **Add Members**, создайте пригласительную ссылку и пригласите настоящего специалиста B; он должен **самостоятельно** зарегистрироваться и войти в B, используя **свою** учётную запись, отличную от первоначального администратора B. Для A используется личная учётная запись другого настоящего специалиста. Выдавайте `LABEL_STUDIO_SECOND_API_KEY` именно от вошедшего специалиста B, а `LABEL_STUDIO_API_KEY` — от A; не подставляйте административный токен B, не копируйте один токен между инстансами. Повторите уже существующий `--create-isolated-pair` **до начала разметки**. Проверка сама сверит реальные `whoami.id`, запрет перекрёстного доступа, 8 исходников и оригинальную форму. Различие числовых ID не предполагается по номеру регистрации — оно подтверждается только фактическим preflight.

   [Официальная инструкция Label Studio Community по приглашению пользователей](https://labelstud.io/guide/signup) и [сравнение Community/Enterprise](https://labelstud.io/guide/label_studio_compare) подтверждают штатную регистрацию по ссылке и отсутствие изоляции проектов **внутри одной CE-инсталляции**. Поэтому приглашайте B только в отдельный экземпляр B с отдельной БД; два проекта/два аккаунта одного CE не заменяют два экземпляра. Этот шаг устраняет техническую коллизию ID, **но не удостоверяет фактическую независимость людей**. До двух реальных 8/8 разметок и третьего эксперта `HUMAN_GOLD=NOT_MEASURED`.

   Сначала выполняются проверка обеих учётных записей и взаимный отказ доступа. Затем создаётся **по одному** проекту и перепроверяются сохранённая XML и исходники 8/8. Квитанция `TWO_LOCAL_ISOLATED_SOURCE_FIRST_PROJECTS_READY_NOT_GOLD` содержит `project_a_id` и `project_b_id`. При частичной ошибке `HOLD` возвращает `created_project_ids` в порядке A, B для ручной очистки: **не считайте незавершённую пару готовой**, и не импортируйте повторно без проверки этих ID. Оригинальные исходные данные, XML и обе учётные записи остаются только owner-local; реальные человеческие разметки, независимость людей и gold этим режимом не подтверждаются.

4. **До разметки** выполнить `--preflight-isolated-reviewers` с `--project-id`, `--other-url`, `--other-project-id` и токенами `LABEL_STUDIO_API_KEY`, `LABEL_STUDIO_SECOND_API_KEY`. Проверяются 8/8 неизменённых первичных источников в каждом проекте, неизменные XML, отсутствие аннотаций/предсказаний и отказ перекрёстного API-доступа. Это **техническая** проверка, а не независимое удостоверение реальных людей/оборудования.
5. Два независимых специалиста лично размечают **каждый 8/8** исходных документов по исходной форме без U1/regex подсказок. `INDEPENDENT_TASK` требует цель, проверяемый результат и критерий принятия; для каждого источника нужен окончательный `review_coverage`. `REVIEW_INCOMPLETE` нельзя экспортировать.
6. Каждый рецензент в **своём** экземпляре запускает однопроектный экспорт:

   ```sh
   python research/task-discovery/labelstudio_project_setup.py \
     --tasks /PRIVATE/labelstudio-import.json \
     --owner-label-config /PRIVATE/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml \
     --url http://127.0.0.1:8080 --export-single-reviewed-project \
     --project-id ACTUAL_ID --review-out /PRIVATE/review-a.json
   ```

   Для B используйте другой `review-b.json`. Экспорт проверяет соответствие текущего authenticated user автору аннотаций, но сам по себе не удостоверяет независимость людей. Подтверждённый JSON сначала полностью записывается в закрытый временный каталог, затем публикуется под конечным именем без перезаписи; ошибка записи оставляет конечный путь отсутствующим, так что повторный экспорт возможен. Если файловая система не поддерживает публикацию через hard link в пределах одного тома, команда возвращает `HOLD`, а не отдаёт неполный JSON. Это не общая двухфайловая транзакция и не научная приёмка.
7. Передать **два неизменённых** JSON в существующий `task_exp_01_review_bridge.py` через `owner_review_cycle.py`, затем сохранить отдельные ответы и разногласия. Команда приведена в [OWNER_REVIEW_CYCLE_RU.md](OWNER_REVIEW_CYCLE_RU.md); `--source-first-packet` должен указывать именно на `/PRIVATE/e5-envelope.json`, созданный `--restricted-output` в шаге 1, а не на файл `/PRIVATE/labelstudio-import.json`.
   При отказе оригинального Bridge прежняя обёртка скрывала **все** причины за `OWNER_LOCAL_STEP_REJECTED`. Теперь `owner_review_cycle.py` передаёт только закреплённые в owner bridge исправимые коды `HOLD`, например `INDEPENDENT_TASK_GOAL_RESULT_CRITERION_REQUIRED` (дозаполнить цель/результат/критерий), `COVERAGE_CONTRADICTS_REGION_COUNT` (сверить выбранное покрытие и фрагменты), `SAME_REVIEWER_NOT_INDEPENDENT` (исправить настройки отдельных аккаунтов). Любой неизвестный код, пути, тексты источников и stderr остаются закрытыми, финальные файлы при отказе не публикуются. Исправление выполнить в исходном Label Studio; **не** редактировать подлинный JSON экспорт вручную. Это диагностика после экспорта, не автоматическое экспертное решение.
 Независимый adjudication выполняет эксперт, а не алгоритм. После этого — отдельные предметные метрики U1/regex/прямого чтения и фактические затраты.

## Проверка прогресса без экспорта человеческих данных

Добавлен необязательный **read-only** режим `--review-progress` существующего `labelstudio_project_setup.py`. Он проверяет актуальную XML-форму, неизменность восьми исходных документов, авторство текущей учётной записи и отсутствие предсказаний/дублирующих аннотаций, после чего возвращает **только три счётчика**: без аннотации, с незавершённой разметкой, с финальным `review_coverage`. Никакие тексты источников, точечные ответы, список SHA или авторские ID не выводятся.

Для каждого отдельного экземпляра после начала человеческой разметки:

```sh
python research/task-discovery/labelstudio_project_setup.py \
  --tasks /PRIVATE/labelstudio-import.json \
  --owner-label-config /PRIVATE/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml \
  --url http://127.0.0.1:8080 --project-id ACTUAL_ID --review-progress
```

**Совместная проверка готовности A+B (05.11.2026):** после разметки можно не запускать два `--review-progress` по очереди, а один раз вызвать существующий адаптер с обоими адресами, учётными данными и ранее полученными ID проектов:

```sh
python research/task-discovery/labelstudio_project_setup.py \
  --tasks /PRIVATE/labelstudio-import.json \
  --owner-label-config /PRIVATE/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml \
  --url http://127.0.0.1:8080 --project-id ACTUAL_A_ID \
  --other-url http://127.0.0.1:8081 --other-project-id ACTUAL_B_ID \
  --paired-review-progress
```

Локальные переменные окружения `LABEL_STUDIO_API_KEY` и `LABEL_STUDIO_SECOND_API_KEY` должны указывать на своих рецензентов. Режим **ничего не создаёт и не экспортирует**, повторно проверяет раздельные учётные записи, форму и восемь исходников каждого участника и выдаёт только агрегаты `unannotated/nonfinal/final_coverage` по A и B. Статус `TWO_LOCAL_REVIEW_COVERAGE_COMPLETE_NOT_BRIDGE_QUALIFIED` означает только 8/8 **завершённых coverage** у каждого, не доказательство полноценной Task-разметки, успешного Review Bridge или человеческой независимости. При ошибке исходника, автора, формы либо API — `HOLD`.

Для второго экземпляра используйте его URL и локальный `LABEL_STUDIO_API_KEY`. Квитанция `REVIEW_COVERAGE_PARTIAL_NOT_GOLD` или `REVIEW_FINAL_COVERAGE_RECORDED_NOT_GOLD` **не удостоверяет правильность Task-разметки**, отсутствие человеческой зависимости, пригодность смысловых полей или экспертное согласие. Даже при `sources_with_final_coverage=8` необходимо отдельно выполнить `--export-single-reviewed-project` и исходный Review Bridge, затем независимый adjudication. При изменении источника, формы, автора или неоднозначных аннотациях возвращается `HOLD`.

Актуальная приёмка рабочего маршрута на коммите `43bd7061fdf772f104477b56c15cdc8cf8233a8a`: [source-first regression 41875521472](https://github.com/Faust-S/knowledge/actions/runs/41875521472) — **106/106 PASS**; [native Label Studio 1.23.2 HTTP 41875521460](https://github.com/Faust-S/knowledge/actions/runs/41875521460) — **PASS**. Синтетическая проверка не содержит независимых человеческих оценок.

## Протокол последующего сравнения: lexical cue не является Task

После двух настоящих слепых разметок и третьего независимого adjudication допустим **описательный exploratory анализ source-level cue retrieval** на заранее выбранных восьми оригинальных источниках. Он не равен Task-level precision/recall/F1 и не заменяет E5.

- **Единица оценки:** один из восьми исходников, включая три без каких-либо подсказок. Источник имеет `gold_task_present=true` только если adjudication подтвердил хотя бы одну `INDEPENDENT_TASK` с привязанными к источнику целью, проверяемым результатом и критерием принятия. `false` — если эксперт подтвердил отсутствие самостоятельной задачи после полного просмотра источника. Неразрешённый случай остаётся `UNRESOLVED`, не становится отрицательным.
- **Сигнал:** `cue_present=true`, если неизменённые U1 или title-regex дали хотя бы один lexical cue в этом источнике. Не менять метод, исходники, порог и словарь после появления gold. Сигнал не является созданной моделью Task.
- **Показатели:** для каждого метода отдельно сохранить `TP, FP, FN, TN` по разрешённым источникам, `UNRESOLVED`, cue-silent и отказы. Показать явные знаменатели: `precision=TP/(TP+FP)`, `recall=TP/(TP+FN)`, `F1=2TP/(2TP+FP+FN)`. При нулевом знаменателе писать `UNDEFINED / NOT_MEASURABLE`, а не 0 или 1. Эти числа характеризуют только поиск источников с задачами, не качество Taskness, spans, TaskType или пригодность решения.
- **Польза человеку:** для вывода о преимуществе IWXA перед прямым чтением или regex требуется отдельный независимый сравнительный эксперимент, одинаковые инструкции и источники, распределение условий между людьми без утечки ответов, измерение реального активного времени (паузы отдельно) и вычислительных затрат. Существующий Label Studio `lead_time` может включать паузы и не доказывает сокращения внимания.
- **Граница обобщения:** n=8 — исходная exploratory выборка разработчиков, не held-out E5. Пререгистрация E5 в `Faust-S/iwxa/knowledge/task-catalog/engine/E5_PREREGISTRATION_RU.md` требует иной независимой выборки, четырёх линий, 4-way Taskness и собственного adjudication. Её пороги не менять задним числом.

## После adjudication: ограниченный расчёт source-level cue retrieval

Публичный `source_cue_post_review.py` **не разметчик, не Task scorer и не новый baseline**. Он предназначен только для *описательного* сравнения наличия ранее замороженных lexical cues (title regex, U1, их объединение) с **отдельно внесённым человеком итоговым решением по каждому из 8 исходников**, после проверки исходным owner Review Bridge и независимого экспертного разрешения разногласий.

Owner-local ручной вход `/PRIVATE/manual-source-resolution.json` — разрешённый приватный файл, не публиковать и не использовать его как E5 held-out gold. Схема:

```json
{
  "schema": "IWXA_TASK_EXP_01_MANUAL_SOURCE_ADJUDICATION/0.1",
  "human_adjudication_claimed": true,
  "methods_hidden_during_review": true,
  "sources": [
    {"source_sha256": "SHA256_ИЗ_ЗАКРЕПЛЁННОГО_МАНИФЕСТА", "resolution": "TASK_PRESENT"}
  ]
}
```

В действительной версии необходимо **ровно восемь уникальных** записей с 64-значным SHA без префикса `sha256:`; допустимые `resolution`: `TASK_PRESENT`, `NO_TASK`, `UNRESOLVED`. Образец выше содержит **только одну демонстрационную запись и не готов к запуску**. `TASK_PRESENT` разрешён лишь если человеческий adjudication подтвердил хотя бы одну самостоятельную задачу с целью, ожидаемым результатом и критерием принятия. Подлинность независимости людей и скрытие методов инструмент не проверяет, он лишь требует явного подтверждения. Сопоставление SHA не пересматривает human decisions.

Чтобы **не переписывать восемь закреплённых SHA вручную**, можно создать исходный пустой файл непосредственно в разрешённом owner-local контуре, обязательно **вне Git checkout**:

```sh
python research/task-discovery/source_cue_post_review.py \
  --prepare-manual-resolution /PRIVATE/manual-source-resolution.json
```

Команда не обращается к Label Studio, не скачивает тексты и не создаёт экспертных меток: 8 строк содержат `PENDING_HUMAN_ADJUDICATION`, оба подтверждения `false`. Файл нельзя использовать для анализа без решений человека. После двух независимых экспортов, owner Review Bridge и работы третьего эксперта оператор заполняет каждую строку одним из `TASK_PRESENT / NO_TASK / UNRESOLVED`; только после действительной проверки независимости и скрытия методов вправе установить подтверждения `human_adjudication_claimed` и `methods_hidden_during_review` в `true`. Исходную XML-форму, исходники и результаты человеческой экспертизы не переносить в публичную ветку.

После оформления ручного решения, **в разрешённом owner-local контуре**, из публичного checkout:

```sh
python research/task-discovery/source_cue_post_review.py \
  --manual-adjudication /PRIVATE/manual-source-resolution.json
```

Существующий `paired_pinned_u1.py` повторно строит frozen method; `method_snapshot.freeze` проверяет его неизменённый SHA `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0`. Дополнительно `source_cue_post_review.analyze` сверяет **пересчитанный SHA по реальным frozen координатам cue**, не принимает вызываемый `method_sha` и отказывает при изменённых координатах даже с прежним сохранённым хешем. [Actions 41915518215](https://github.com/Faust-S/knowledge/actions/runs/41915518215) — SUCCESS. Текст источников и исходные разметки не выдаются. Агрегаты `TP/FP/FN/TN`, denominators, precision/recall/F1 **только source-level cue retrieval**, не Task-level. Неразрешённые случаи исключаются, но их количество видно. **Каждая метрика имеет собственный знаменатель**: precision — `TP+FP`, recall — `TP+FN`, F1 — `2TP+FP+FN`; только нулевой знаменатель конкретной метрики даёт `null`. Например, `TP=0, FP=0, FN=1` означает неопределённую precision, но `recall=0` и **`F1=0`**; `TP=0, FP=1, FN=0` означает `precision=0`, неопределённую recall и `F1=0`. Это source-level cue retrieval, не Task F1. Исправлено в [коммите ca95138e](https://github.com/Faust-S/knowledge/commit/ca95138eabbc638f47db2f879025c74cf697422a), [регрессия 41901168968](https://github.com/Faust-S/knowledge/actions/runs/41901168968) — **SUCCESS**. Прямое чтение остаётся базовым полным просмотром 8/8. Параллельное дополнение до human gold: существующий `exact_search_baseline.py` закрепил 12 регистронезависимых буквальных подстрок по полному тексту исходника, без морфологии или semantic Task inference. На 8/8 закреплённых оригиналах получилось **7/8 источников с literal hit**, **1/8 без hit** ([Actions 41919823675](https://github.com/Faust-S/knowledge/actions/runs/41919823675), 130/130 engineering tests PASS). Его отдельные pre-gold SHA: specification `062a2c09af237b9d32bce9fc8a01fd73d53a762039b529e17213c4869f143e66`, source outcomes `7512d8e85790cc4444214fc8757e3cb24c8214bfd54fe8a36e057f78aa16fec1`. Это **наличие буквального выражения в источнике**, не предсказание Task и не показатель качества. `source_cue_post_review.py` теперь сравнивает этот baseline как четвёртую, отдельно закреплённую source-level линию только после приватного adjudication: повторно проверяет исходные SHA и оба frozen method commitments, читает каждый оригинал один раз и не выводит персональные решения. При отсутствии новой линии прежний U1/title результат остаётся совместимым и явно помечается `PINNED_LITERAL_AVAILABLE_NOT_REPLAYED`. Нельзя утверждать снижение затрат и человеческого времени на основании этих агрегатов.

Испытание на синтетических adjudication-входах: [GitHub Actions 41898001349](https://github.com/Faust-S/knowledge/actions/runs/41898001349) — SUCCESS. Результаты реальных экспертов до сих пор `NOT_MEASURED`. Это не разрешает автоматический Task acceptance, E4 approval или продвижение M4.

## Зафиксированные границы

- Публичный CI может проверять только синтетический транспорт, никогда не квалифицирует человеческий gold. Не публиковать исходные тексты, аннотации, токены или adjudication.
- Совпадение цифровых `completed_by` на разных экземплярах приводит к отказу исходного Bridge; не редактировать эти ID вручную. Оформить реальные учётные записи до разметки.
- `annotations.lead_time` — время, сообщаемое Label Studio, которое может включать паузы, а не чистое активное время специалиста.
- Frozen pre-gold SHA-256 `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0` не изменять; восемь exploratory issues не заменяют формальный held-out E5.
