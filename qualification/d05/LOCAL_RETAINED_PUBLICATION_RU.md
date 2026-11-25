# Цеховод T3. Закрепление уже квалифицированной поставки из авторизованной локальной среды

Это резервный маршрут завершения публикации, а не новый сборщик и не новая приёмка продукта. Использовать только при наличии штатного доступа к репозиториям и оригинальному архиву платформы. Не изменять DOMEN, не создавать секреты, не публиковать закрытые исходники или двоичные входы в knowledge. Не запускать Actions для этого маршрута.

## Зафиксированные входы

| Вход | Ревизия |
| --- | --- |
| Faust-S/cehovod.ru | a0961a1d88dcedd68809c66f327d7e417c77a744 |
| Faust-S/cehovod | 7d44995b536bc57eb0acff63d876d255c034fb77 |
| Faust-S/T3 | 5e3083788aa541921559de29d3457d4a52bbba00 |
| Faust-S/knowledge, One Core | 326f725c44d69ac99f6b912241e9e8a6c3d716a5 |
| Архив платформы | Actions artifact 14920233669 |
| Ожидаемое исходное состояние ветки сохранения | ba595ae901ea5af9b066a5e5f7cab88c15fdee8e |
| Квалифицированное дерево с сохранёнными входами | ae3f6e4992209e8f4b778cbc29b1a979972398a3 |

Основание: https://github.com/Faust-S/knowledge/actions/runs/45612942218 и qualification/d05/receipts/45612942218.json. Прежний Linux-кандидат не изменять ради исправления формата или получения совпадения. Изменения испытаний модели в рабочей ветке не входят в этот квалифицированный продукт.

## 1. Восстановление исходного комплекта

На авторизованном Linux-стенде, совместимом с квалификацией (Node 22.16.0, Git, gh, unzip, tar и Google Chrome для штатного сборщика), создать четыре отдельных временных checkout с именами site, domain, assistant и one-core в новом каталоге. Проверить HEAD каждого по таблице. Не брать последнюю ревизию ветки и не изменять исходные файлы. Для Git сохранить существующий авторизованный транспорт; секреты не выводить. Нужны штатные права на чтение всех четырёх репозиториев и архива, а для публикации - запись только в целевую ветку сайта.

В site выполнить существующие команды (WORK - абсолютный путь к новому рабочему каталогу):

```bash
set -euo pipefail
cd "$WORK/site"
test "$(node -p process.versions.node)" = "22.16.0"
test "$(git rev-parse HEAD)" = a0961a1d88dcedd68809c66f327d7e417c77a744
test "$(git -C "$WORK/domain" rev-parse HEAD)" = 7d44995b536bc57eb0acff63d876d255c034fb77
test "$(git -C "$WORK/assistant" rev-parse HEAD)" = 5e3083788aa541921559de29d3457d4a52bbba00
test "$(git -C "$WORK/one-core" rev-parse HEAD)" = 326f725c44d69ac99f6b912241e9e8a6c3d716a5
cmp -s "$WORK/domain/models/assistant-skills.json" public/assets/cehovod-assistant-skills.json
cmp -s "$WORK/domain/src/lib/iwps/registry-snapshot.generated.json" src/lib/iwps/registry-snapshot.generated.json
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH="$(command -v google-chrome)"
test -x "$PUPPETEER_EXECUTABLE_PATH"
npm ci --no-audit --no-fund
gh api repos/Faust-S/knowledge/actions/artifacts/14920233669/zip > "$WORK/t3-artifact.zip"
unzip -p "$WORK/t3-artifact.zip" platform-inputs.zip > "$WORK/platform-inputs.zip"
node scripts/t3-platform-inputs.mjs verify "$WORK/platform-inputs.zip"
npm run prepare:t3-host -- "$WORK/one-core/packages/t3-core" "$WORK/cehovod-host" "$WORK/platform-inputs.zip" "$WORK/assistant" https://cehovod.ru
npm run retain:t3-inputs -- "$WORK/cehovod-host" "$WORK/platform-inputs.zip"
```

После подготовки удалить исключительно три временных checkout, созданных для этого поручения (domain, assistant, one-core), либо вынести их из рабочего каталога. Не удалять пользовательские исходники. Обычная сборка использует уже сохранённые входы. Выполнить:

```bash
node scripts/build-cehovod-t3-local-site.mjs
npm run verify:product:t3 -- --production
npm run check:t3-retained-checkout -- --prepare-commit > "$WORK/retained-receipt.log" 2>&1
```

При отказе любой команды остановиться. Не менять проверку архива, формат Host, версии зависимостей или исходники, чтобы обойти несовпадение.

## 2. Рубеж точного дерева

Полученный локальный commit может иметь другую дату создания. Существенны его единственный родитель и точное дерево, а не совпадение хеша самого commit с удалённым протоколом.

```bash
export RECEIPT_FILE="$WORK/retained-receipt.log"
candidate="$(node --input-type=module <<'JS'
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const base="a0961a1d88dcedd68809c66f327d7e417c77a744";
const qualified="ae3f6e4992209e8f4b778cbc29b1a979972398a3";
const rows=readFileSync(process.env.RECEIPT_FILE,"utf8").split(/\r?\n/);
const get=status=>{
  const matches=rows.filter(row=>row.startsWith('{"status":"'+status+'",'));
  assert.equal(matches.length,1);
  return JSON.parse(matches[0]);
};
const r=get("CEHOVOD_T3_RETAINED_CHECKOUT_PASS");
const c=get("CEHOVOD_T3_RETAINED_COMMIT_PREPARED");
assert.equal(r.inputFiles,92);
assert.equal(r.distFiles,223);
assert.equal(r.exactBytes,true);
assert.equal(r.remotePublication,false);
assert.equal(r.productAccepted,false);
assert.equal(c.inputFiles,92);
assert.equal(c.base,base);
assert.equal(c.tree,qualified);
assert.equal(r.sourceTree,qualified);
assert.equal(c.remotePublication,false);
assert.match(c.commit,/^[0-9a-f]{40}$/);
const git=args=>execFileSync("git",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
assert.equal(git(["rev-parse","HEAD"]),base);
assert.equal(git(["rev-list","--parents","-n","1",c.commit]),c.commit+" "+base);
assert.equal(git(["rev-parse",c.commit+"^{tree}"]),qualified);
const paths=git(["diff-tree","--no-commit-id","--name-only","-r","-z",base,c.commit]).split("\0").filter(Boolean);
const added=git(["diff-tree","--no-commit-id","--diff-filter=A","--name-only","-r","-z",base,c.commit]).split("\0").filter(Boolean);
assert.equal(paths.length,92);
assert.deepEqual([...added].sort(),[...paths].sort());
const prefix="runtime/t3-platform/0.3.1-rc.1/";
assert.ok(paths.every(p=>p===prefix+"platform-inputs.zip"||p.startsWith(prefix+"cehovod-host/")));
console.log(c.commit);
JS
)"
test "$candidate" != ""
```

Если дерево не совпало с ae3f6e4..., не отправлять его и не присваивать прежнюю квалификацию. Причину отличия разбирать отдельно.

## 3. Сохранение только в существующую приватную ветку

Проверить, что origin указывает именно на Faust-S/cehovod.ru (штатный HTTPS или SSH без пароля в URL). Проверить, что репозиторий действительно приватный. Использовать действующую Git-авторизацию; не извлекать и не передавать токены. При отказе доступа остановиться с точным кодом операции.

```bash
target=work/2026-11-25-d05-t3-retained-inputs
expected=ba595ae901ea5af9b066a5e5f7cab88c15fdee8e
git fetch origin "refs/heads/$target"
test "$(git rev-parse FETCH_HEAD)" = "$expected"
git merge-base --is-ancestor "$expected" "$candidate"
# Обычный non-forced fast-forward. Не добавлять --force или --force-with-lease.
git push origin "$candidate:refs/heads/$target"
git fetch origin "refs/heads/$target"
test "$(git rev-parse FETCH_HEAD)" = "$candidate"
test "$(git rev-parse 'FETCH_HEAD^{tree}')" = ae3f6e4992209e8f4b778cbc29b1a979972398a3
```

Если HEAD целевой ветки изменился до публикации, остановиться и проверить новое состояние. Не переписывать историю. Если обычный push отклонён, не обходить ограничения репозитория.

## 4. Независимое получение и воспроизведение

Создать отдельный чистый каталог fresh, получить только целевую ветку приватного сайта и убедиться в совпадении commit и tree. Не копировать dist. Допускается повторно использовать уже установленные зависимости с тем же lockfile, как в успешном Linux-протоколе. Из fresh выполнить штатные команды:

```bash
npm run build:product:t3
npm run verify:product:t3 -- --production
```

Из первоначального site сравнить результаты существующей функцией exactDistInventory:

```bash
node --input-type=module <<'JS'
import assert from "node:assert/strict";
import {join} from "node:path";
import {exactDistInventory} from "./scripts/check-t3-dist-reproducibility.mjs";
const local=exactDistInventory("dist");
const remote=exactDistInventory(join(process.env.WORK,"fresh","dist"));
assert.equal(local.length,223);
assert.deepEqual(remote,local);
console.log("D05_T3_RETAINED_PRIVATE_CHECKOUT_PASS "+JSON.stringify({files:remote.length,exactBytes:true,productAccepted:false}));
JS
```

WORK должен быть экспортирован до запуска Node. Зафиксировать SHA сохранённого commit, tree и результат независимого чтения. Только после фактического совпадения считать приватную поставку подтверждённой. Сборочная проверка не заменяет независимую смысловую приёмку локальной модели. Основные ветки, стабильный T2, обычный build и хостинг не менять.

## Короткое поручение для Codex при недоступности этой операции в ChatGPT

Выполни только локальное восстановление и публикацию уже квалифицированной поставки Цеховода по этому документу. Используй точные закреплённые входы, существующие команды сборки и действующую Git-авторизацию. Не повторяй Linux-предметную или браузерную квалификацию, не запускай Actions, не меняй исходники и общие токены. Сохрани только дерево ae3f6e4992209e8f4b778cbc29b1a979972398a3 в work/2026-11-25-d05-t3-retained-inputs обычным fast-forward, независимо получи его и сравни готовый dist. При несовпадении или отказе доступа остановись и сообщи точную операцию и код. Не присваивай PRODUCT_ACCEPTED.
