"""Source-scoped system views, task context and explicit refresh review. No network or semantic merge."""
import argparse
import copy
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from read_policy import policy as reading_policy, archived as is_archived

ROOT = Path(__file__).resolve().parents[3]
K = ROOT / 'knowledge/system'
BEGIN = '<!-- IWXA_SYSTEM_VIEW:BEGIN -->'
END = '<!-- IWXA_SYSTEM_VIEW:END -->'
STATUSES = {'UNKNOWN', 'SOURCE_GROUNDED_INTERPRETATION', 'SOURCE_DESCRIBED',
 'BOUNDED_OBSERVATION', 'PUBLICATION_OBSERVED_NOT_RUNTIME_VERIFIED',
 'PRIOR_SCOPED_CODE_OBSERVATION', 'DESIGN_BOUNDARY',
 'CODE_OBSERVED_ADOPTION_NOT_INFERRED', 'CODE_OBSERVED_LOCAL_TRANSFER',
 'SOURCE_REPORTED_AND_CODE_BOUND', 'EXACT_GIT_CODE_OBSERVED',
 'SOURCE_REPORTED_ACCEPTANCE_WITH_OPEN_GATES', 'SOURCE_DESCRIBED_NOT_EXECUTED',
 'CODE_OBSERVED', 'CODE_AND_SOURCE_DESCRIBED', 'BOUNDARY_DESCRIBED_FULFILLMENT_OPEN',
 'EXACT_CODE_STORAGE_OBSERVED', 'BROWSER_SOURCE_OBSERVED_DEPLOYMENT_UNVERIFIED',
 'SCOPED_SOURCE_OBSERVATION', 'SOURCE_DESCRIBED_PRODUCTION_CONTRACT',
 'SOURCE_DESCRIBED_MODEL_NOT_RUNTIME', 'ANALYTICAL_MAPPING_CANDIDATE',
 'CURRENT_PRODUCT_STATE_REPORTED', 'SOURCE_REPORTED_DELIVERY',
 'CURRENT_HOLD_REPORTED', 'DESIGN_NOT_CURRENT_RUNTIME_BINDING', 'CURRENT_DESIGN',
 'NORMATIVE_PLANES_SEPARATE', 'SCOPED_CONFORMANCE_NOT_PRODUCT_READINESS'}

def load(path):
    return json.loads(path.read_text(encoding="utf-8"))

def dump(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + '\n'

def context_dump(value):
    # The transmitted packet uses this same encoding for its budget check.
    # Whitespace is reduced; source locators, constraints and unknowns remain intact.
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n'

def independent_sync(st,binding_ids=None,knowledge_head=None):
    """Separate live observation surface. It cannot update the canonical model or its views."""
    path=st['k']/'SYNC_STATE.json'
    if not path.exists():return dict(status='NOT_OBSERVED',checked_at=None,
      candidate_event_ids=[],errors=[],state_locator='knowledge/system/SYNC_STATE.json',
      semantic_reconciliation_performed=False,currentness='REVIEW_REQUIRED')
    s=load(path)
    if s.get('schema')!='IWXA_INDEPENDENT_SYNC_STATE/1' or s.get('semantic_reconciliation_performed') or s.get('normative_adoption') or s.get('runtime_qualification'):
        raise ValueError('invalid independent sync authority boundary')
    # A dated head observation is not present-day source drift evidence.
    # Preserve its exact historical bytes, but do not inject its old candidates
    # into a context packet for a different live knowledge HEAD.
    if knowledge_head is not None:
        check_sha(knowledge_head)
        if s.get('knowledge_base_head')!=knowledge_head:
            return dict(status='HISTORICAL_OBSERVATION_EXCLUDED',
              checked_at=None,candidate_event_ids=[],errors=[],
              state_locator='knowledge/system/SYNC_STATE.json',
              semantic_reconciliation_performed=False,currentness='REVIEW_REQUIRED',
              note='Independent live source check required; old sync state not reused')
    known={b['id'] for b in st['model']['bindings']}
    for e in s.get('candidates',[]):
        check_sha(e['source_after'])
        if not set(e['affected_binding_ids'])<=known:raise ValueError('orphan sync binding')
    # Unmapped changes are visible until their scope is reviewed; empty IDs cannot hide drift.
    relevant=lambda ids: binding_ids is None or not ids or bool(set(ids)&set(binding_ids))
    candidates=[e['event_id'] for e in s.get('candidates',[]) if relevant(e['affected_binding_ids'])]
    streams={(r['repository'],r['branch']):r for r in s.get('streams',[])}
    errors=[dict(repository=e['repository'],branch=e['branch'],status=e['status']) for e in s.get('errors',[]) if relevant(streams.get((e['repository'],e['branch']),{}).get('binding_ids',[]))]
    return dict(status=s['status'],checked_at=s['checked_at'],knowledge_base_head=s['knowledge_base_head'],
      candidate_event_ids=candidates,errors=errors,observation_fingerprint=s['observation_fingerprint'],
      state_locator='knowledge/system/SYNC_STATE.json',semantic_reconciliation_performed=False,
      currentness='REVIEW_REQUIRED' if candidates or errors else 'NO_RELEVANT_DRIFT_OBSERVED_NOT_SEMANTIC_ACCEPTANCE')

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

TEXT_HASH_SUFFIXES={'.md','.json','.jsonl','.py','.mjs','.js','.ts','.tsx','.jsx','.txt','.yaml','.yml','.toml','.csv','.tsv','.xml','.html','.css','.scss','.sh','.ps1','.bat','.cmd'}

def canonical_file_bytes(path):
    path=Path(path);raw=path.read_bytes()
    return raw.replace(b'\r\n',b'\n') if path.suffix.lower() in TEXT_HASH_SUFFIXES else raw

def check_sha(value):
    if not re.fullmatch('[0-9a-f]{40}', value or ''):
        raise ValueError('exact 40-char lowercase independently fetched commit required')

def state(root=None):
    root = Path(root or ROOT); k = root / 'knowledge/system'
    model = load(k/'SYSTEM_MODEL.json')
    sources = {s['id']:s for s in (json.loads(x) for x in (k/'SOURCE_REGISTRY.jsonl').read_text(encoding="utf-8").splitlines() if x)}
    records = {n:load(k/p) for n,p in model['records'].items()}
    graph=load(k/model['capability_view']['path'])
    return dict(root=root, k=k, model=model, sources=sources, records=records, capability_graph=graph,
                gaps=load(k/'GAP_REGISTRY.json'), repositories=load(k/'REPOSITORY_REGISTRY.json'))

def binding_sources(binding):
    return {s for cell in binding['layers'].values() for s in cell['source_ids']}

def fingerprint(st):
    # Derived views, SOURCE_REGISTRY's own bytes and Git commit IDs are excluded: no self-hash cycle.
    k=st['k']; model=st['model']
    paths=['SYSTEM_MODEL.json','GAP_REGISTRY.json','REPOSITORY_REGISTRY.json','REPOSITORY_AUDIT.json','../../coordination/DOMAIN_IMPLEMENTATION_BINDINGS.json','tools/system.py',
           'AI_CONTEXT_POLICY_RU.md','UPDATE_PROTOCOL_RU.md','PRACTICAL_DEVELOPMENT_PLAN_RU.md','SOURCE_READ_POLICY.json','tools/read_policy.py',*model['records'].values()]
    sidset={s for b in model['bindings'] for s in binding_sources(b)}
    sidset.update(s for c in model['constraints'] for s in c['source_ids'])
    sidset.update(s for p in model['context_profiles'] for s in p['required_source_ids'])
    paths.append(model['capability_view']['path'])
    paths += ['tools/coherence.py', '../../' + model['current_level_completion']['profile_path']]
    # Pending state affects both human and AI views; unrelated historical event prose does not.
    pending=[(e['event_id'],e['source_after'],e['knowledge_update_status'],e['affected_binding_ids']) for e in pending_events(st)]
    data=dict(files=[(p,digest(canonical_file_bytes(k/p))) for p in sorted(set(paths))],pending=pending,
              sources=[(sid,st['sources'][sid]['sha256'],st['sources'][sid]['locator']) for sid in sorted(sidset)])
    return digest(json.dumps(data,ensure_ascii=False,sort_keys=True).encode())

def source_text(st,sid,cache=None):
    s=st['sources'][sid]
    p=st['root']/s['path'] if s.get('path') else Path((cache or {}).get(sid,'__NOT_CACHED__'))
    if not s.get('path') and sid not in (cache or {}): return None
    raw=canonical_file_bytes(p)
    if digest(raw)!=s['sha256']:raise ValueError('stale source bytes: '+sid)
    return raw.decode('utf-8-sig')

def verify(st,cache=None,require_views=True):
    m=st['model']; sources=st['sources']; rec=st['records']
    rules=reading_policy(st['root'])
    if not set(rules['current_source_ids'])<=set(sources):raise ValueError('current policy source missing')
    if any(is_archived(sources[sid],rules) for sid in rules['current_source_ids']):raise ValueError('current rule cannot be archived')
    if m['normative_effect']!='NONE' or m['runtime_effect']!='NONE':raise ValueError('model cannot grant adoption or runtime readiness')
    def unique(rows,label):
        ids=[x['id'] for x in rows]
        if len(ids)!=len(set(ids)):raise ValueError('duplicate '+label)
        return set(ids)
    lids=unique(m['layers'],'layer'); bids=unique(m['bindings'],'binding')
    if len(lids)!=9:raise ValueError('nine implementation views required')
    if set(m['subject_lines'])!={'Personal','Corporate','Operator','Institutional/Public'}:raise ValueError('four lines must remain explicit')
    itemids=unique(rec['items']['items'],'item'); domainids=unique(rec['domains']['cards'],'domain')
    for item in rec['items']['items']:
        snapshot=item.get('development_snapshot')
        if snapshot is None:continue
        if not set(snapshot['depends_on_item_ids'])<=itemids:raise ValueError('orphan development dependency '+item['id'])
        if not snapshot['evidence_source_ids'] or not set(snapshot['evidence_source_ids'])<=set(sources):raise ValueError('orphan development evidence '+item['id'])
        if not all(snapshot.get(key) for key in ('stage','completed_scope','ongoing_scope','next_result','qualification','human_acceptance','production')):raise ValueError('incomplete development snapshot '+item['id'])
    if domainids!={'D%02d'%i for i in range(1,13)}:raise ValueError('all twelve domains required')
    linkids=unique(rec['connections']['connections'],'connection'); gapids=unique(st['gaps'],'gap')
    if set(v['line'] for v in m['subject_views'])!=set(m['subject_lines']) or len(m['subject_views'])!=4:raise ValueError('human subject views must preserve all four lines')
    for v in m['subject_views']:
        if not set(v['item_ids'])<=itemids:raise ValueError('orphan subject item')
    unique(m['context_profiles'],'profile'); processids=unique(m['processes'],'process')
    pending=0;anchors=0
    for b in m['bindings']:
        if set(b['layers'])!=lids or not set(b['item_ids'])<=itemids:raise ValueError('invalid binding '+b['id'])
        if not set(b['subject_lines'])<=set(m['subject_lines']):raise ValueError('invalid subject binding')
        for c in b['layers'].values():
            if c['status'] not in STATUSES:raise ValueError('unsupported/elevated status '+c['status'])
            if not set(c['source_ids'])<=set(sources) or not set(c['gap_ids'])<=gapids:raise ValueError('orphan source/gap')
            if c['status']=='UNKNOWN' and not c['gap_ids']:raise ValueError('unknown needs a visible question')
            for a in c['anchors']:
                if a['source_id'] not in c['source_ids'] or sources[a['source_id']]['sha256']!=a['sha256']:raise ValueError('anchor source/hash mismatch')
                text=source_text(st,a['source_id'],cache)
                if text is None:pending+=1;continue
                if text[a['start']:a['end']]!=a['quote']:raise ValueError('anchor mismatch '+a['source_id'])
                anchors+=1
    for p in m['processes']:
        steps=unique(p['steps'],'process step')
        if not set(p['binding_ids'])<=bids or not set(p['gap_ids'])<=gapids:raise ValueError('invalid process refs')
        for step in p['steps']:
            if not set(step['item_ids'])<=itemids:raise ValueError('invalid process item')
        for e in p['edges']:
            if e['from'] not in steps or e['to'] not in steps:raise ValueError('orphan process edge')
            if e.get('relation_id') not in linkids and not e.get('status'):raise ValueError('edge requires source relation/status')
    for p in m['context_profiles']:
        if not set(p['binding_ids'])<=bids or not set(p['process_ids'])<=processids or not set(p['required_source_ids'])<=set(sources):raise ValueError('invalid context profile')
        if not set(p.get('dependency_binding_ids',[]))<=bids:raise ValueError('invalid context dependency')
    for c in m['constraints']:
        if not set(c['source_ids'])<=set(sources):raise ValueError('orphan constraint')
    routes=load(st['root']/'coordination/DOMAIN_IMPLEMENTATION_BINDINGS.json')
    observed={(r['repository'],r['branch']):r for r in st['repositories'] if r.get('branch')}
    for route in routes['bindings']:
        binding=next(b for b in m['bindings'] if b.get('domain_id')==route['domain_id'])
        dev=route.get('domain_development_source',route)
        if binding['owning_repository']!=dev['repository']:raise ValueError('domain development route stale '+route['domain_id'])
        split=binding['repository_split']
        if split['website_source_repository']!=route['repository'] or split['website_source_commit']!=route['observed_head']:raise ValueError('website source route stale '+route['domain_id'])
        for source in [route,dev]:
            row=observed.get((source['repository'],source['branch']))
            if row is None or row['observed_head']!=source['observed_head']:raise ValueError('repository observation stale '+source['repository'])
    if not set(m['capability_view']['node_ids'])<=set(n['id'] for n in st['capability_graph']['nodes']):raise ValueError('orphan capability view')
    from coherence import verify_completion
    verify_completion(m, st['gaps'], sources, st['root'])
    if require_views:
        target=st['k']/'SYSTEM_OVERVIEW_RU.md'
        if generated_part(target.read_text(encoding="utf-8"))!=render(st):raise ValueError('human view stale; run system.py render')
        if any(i.get('development_snapshot') for i in rec['items']['items']):
            target=st['k']/'DEVELOPMENT_MAP_RU.md'
            if not target.exists() or target.read_text(encoding='utf-8')!=development_map(st):raise ValueError('development map stale; run system.py render')
        graph=load(st['k']/'KNOWLEDGE_GRAPH.json');nodes,edges=graph_projection(st)
        if [n for n in graph['nodes'] if n.get('projection')=='SYSTEM_MODEL']!=nodes or [e for e in graph['edges'] if e.get('projection')=='SYSTEM_MODEL']!=edges:raise ValueError('knowledge graph projection stale; run system.py render')
    return dict(status='PASS_SYSTEM_MODEL_AND_VIEWS',bindings=len(bids),layers=len(lids),domains=len(domainids),inventory_items=len(itemids),connections=len(linkids),exact_anchors_checked=anchors,anchors_requiring_external_bytes=pending,normative_adoption=False,runtime_qualification=False,fingerprint=fingerprint(st))

def md(value):
    return str(value).replace('|','\\|').replace('\n',' ')

def source_link(st,sid):
    r=st['sources'][sid]; loc=r['locator']
    url=loc.get('url') if loc['kind']=='GITHUB_FILE' else ('../../'+r['path'] if r.get('path') else None)
    return f'[{sid}]({url})' if url else f'`{sid}`'

def cell_md(st,c):
    refs=' '.join(source_link(st,s) for s in c['source_ids'])
    gaps=' / '.join(c['gap_ids'])
    return md(c['status'])+'; '+md(c['note'])+(' '+refs if refs else '')+(f' Вопрос: {gaps}.' if gaps else '')

def development_packet(st,item_id):
    item=next((i for i in st['records']['items']['items'] if i['id']==item_id),None)
    if item is None:raise ValueError('unknown development item '+item_id)
    snapshot=item.get('development_snapshot')
    return dict(id=item_id,name=item['name'],user_job=item['user_job'],independent_result=item['independent_result'],
      owning_repository=item['owning_repository'],domain_ids=item['domain_ids'],snapshot=snapshot,
      sources=[dict(id=sid,sha256=st['sources'][sid]['sha256'],locator=st['sources'][sid]['locator']) for sid in (snapshot or {}).get('evidence_source_ids',[])],
      currentness='PINNED_OBSERVATION_REFETCH_BEFORE_WORK',runtime_qualification=False,normative_adoption=False)

def development_map(st):
    items=st['records']['items']['items'];audit=load(st['k']/'REPOSITORY_AUDIT.json').get('development_map_review',{})
    lines=['# Карта разработок IWXA','',
      'Карта показывает предмет работы и оставшийся путь до результата. Её строки сформированы из существующего практического реестра; источники остаются в своих репозиториях. Статус относится к указанной области, а дата наблюдения не заменяет проверку текущей ветки.','',
      '**Текущая инженерная сверка, 10.11.2026:** [состояние 42 репозиториев и продуктов](LIVE_ECOSYSTEM_STATUS_2026_11_10_RU.md) и [машинные точные ревизии](LIVE_ECOSYSTEM_STATUS_2026_11_10.json). Ниже сохранены 82 предметных направления с историческими датами и свидетельствами; для актуальных релизов и квалификаций читать current overlay и первичные owning sources.','',
      'Срез базового реестра: 11 октября 2026 года. Отпечаток записей: `'+fingerprint(st)+'`. Обновление: `python knowledge/system/tools/system.py render`. Проверка: `python knowledge/system/tools/system.py verify`.','',
      '## Как читать состояние','',
      '- «Принято» относится к названному результату и области решения владельца.',
      '- «Реализовано, проверка ограничена» означает наличие кода и отдельных evidence. Реальные пользователи, полный продукт и deployment проверяются отдельно.',
      '- «План» сохраняет намерение. Файлы контрактов и roadmap сами по себе не доказывают исполнение.',
      '- «Смысл и источники учтены» означает, что разработка обнаружена и связана; текущая реализация ещё требует предметной сверки.','',
      '## Связи, определяющие текущую работу','',
      'T0/T1 задают общий смысл фактов, действий, свидетельств и полномочий. Factory 2.1 преобразует доменную разработку. Каждый пользовательский сайт должен отдельно подтвердить исполнение через штатный Host/Kernel. Персональная программа находится в PA / Programs Center; Admin, Access и Reconciliation развиваются в общем T3. Fabric исследует вычисление и подключается по отдельному контракту. Согласно действующей политике SOURCE_READ_POLICY: T4 — сетевое хранение, синхронизация, доступ и другие сетевые возможности; T5 — делегированная интеллектуальная деятельность; T6 — постоянно подключённая автономная деятельность; T7 — многосубъектное сотрудничество; T8 — федеративная среда людей, организаций и институтов. Датированные прежние распределения функций сохраняются только как lineage. Наличие этих частей ещё не доказывает единую установленную сборку.','',
      'Task Engine исследует, что является самостоятельной задачей. Context Compiler собирает допустимый контекст для её выполнения. Fabric проверяет способы вычисления. Эти три результата имеют разные критерии: 20 bounded Fabric TaskTypes не являются приёмкой каталога Engine. Языковые пакеты создают человеческие представления, сохраняя идентичность модели и доказательств.','',
      'Научная основа, Standard, четыре субъектные линии, три operator profiles, 26 CAP и дальний горизонт описаны в [целостной модели](SYSTEM_OVERVIEW_RU.md). Текущие инженерные наблюдения не отменяют эти отдельные плоскости.','']
    groups=[('Общие механизмы, программы и дальнейший горизонт',[i for i in items if not i['domain_ids']])]
    groups += [(c['id']+' / '+c['name'],[i for i in items if c['id'] in i['domain_ids']]) for c in st['records']['domains']['cards']]
    for title,rows in groups:
        lines += ['## '+title,'','| Разработка | Состояние | Что сделано в указанной области | Что развивается | Следующий проверяемый результат |','|---|---|---|---|---|']
        for item in rows:
            s=item.get('development_snapshot',{});refs=' '.join(source_link(st,sid) for sid in s.get('evidence_source_ids',[])[:3])
            lines.append('| '+md(item['name'])+' / `'+item['id']+'` | '+md(s.get('stage','UNKNOWN'))+' | '+md(s.get('completed_scope','UNKNOWN'))+' '+refs+' | '+md(s.get('ongoing_scope','UNKNOWN'))+' | '+md(s.get('next_result','UNKNOWN'))+' |')
        lines += ['']
        for item in rows:
            s=item.get('development_snapshot',{});components=s.get('components',[]);deps=s.get('depends_on_item_ids',[])
            if components or deps:
                lines += ['**'+item['name']+'**. '+('Компоненты: '+', '.join(components)+'. ' if components else '')+('Зависимости: '+', '.join(deps)+'. ' if deps else '')+'Полные locators: `system.py development --item '+item['id']+'`.','']
            for observation in s.get('code_observations',[]):
                lines += ['Чтение конкретной функции: '+md(observation['note'])+' '+source_link(st,observation['source_id'])+'.','']
    lines += ['## Охват исходников и непрочитанные области','',
      f'Учтены {len(items)} практических направлений; проверены refs и TREE {audit.get("selected_stream_count",0)} выбранных веток. Предыдущий сбор сохранил {audit.get("documents_acquired",0)} документных записей и {audit.get("code_files_acquired",0)} файлов кода. Это количество полученных версий файлов, с повторениями между ветками. Полный смысловой аудит каждой строки кода и повторная квалификация продуктов не заявляются.','',
      'Модульный inventory в [REPOSITORY_AUDIT.json](REPOSITORY_AUDIT.json) содержит пути и экспортируемые имена. Непросмотренный модуль имеет discovery-статус. Исторические ветки не становятся актуальными только из-за нового времени наблюдения. TREE восстановлены из commit-объектов; прежнее поле, совпадавшее с HEAD, не используется как доказательство дерева.','',
      '| Репозиторий | Выбранные ветки и exact HEAD | Документы / код | Граница |','|---|---|---|---|']
    for row in audit.get('inventories',[]):
        refs='; '.join('['+md(x['branch'])+'](https://github.com/'+row['repository']+'/tree/'+x['head']+') `'+x['head'][:12]+'`' for x in row['selected_streams'])
        lines.append('| '+row['repository']+' | '+(refs or row.get('status','UNKNOWN'))+' | '+str(row['documents_acquired'])+' / '+str(row['code_files_acquired'])+' | Selected sources; full semantic review=false; runtime retest=false |')
    lines += ['','## Порядок обновления','',
      'Изменять соответствующую строку PRACTICAL_DEVELOPMENT_REGISTER: completed scope, ongoing scope, next result, зависимости и exact evidence. Сохранять прежние evidence как историю. После нового source HEAD выполнять предметную сверку; непрочитанные зависимости оставлять PENDING. Затем render/verify и commit/readback. Расписание выключено; обновление выполняется при работе.','',
      'Карта не назначает новую очередь вместо [единого плана](PRACTICAL_DEVELOPMENT_PLAN_RU.md). Предметная приёмка, вычислительная квалификация, пользовательская приёмка и production - самостоятельные решения.','']
    return '\n'.join(lines)

def render(st):
    m=st['model'];rec=st['records'];links={x['id']:x for x in rec['connections']['connections']}
    lines=[BEGIN,'', '## Актуальная архитектурная карта', '',
      'Этот блок строится из `SYSTEM_MODEL.json` и существующих реестров. Привязки — аналитическая модель для оценки владельцем; нормативное принятие и runtime readiness не выдаются. Версия — commit, из которого открыт файл.', '',
      f'Отпечаток входных записей: `{fingerprint(st)}`. Генератор: `python knowledge/system/tools/system.py render`; проверка согласованности: `... verify`.', '',
      f'Охват: {len(rec["items"]["items"])} выбранных разработок, 12 доменов, {len(rec["connections"]["connections"])} отношений, {len(m["bindings"])} привязок по 9 уровням. Полнота всего проекта не заявляется.', '',
      '### Независимые оси и ограничения','', ', '.join(m['axes'])+'.','']
    lines += ['- '+c['text']+' '+ ' '.join(source_link(st,s) for s in c['source_ids']) for c in m['constraints']]
    lines += ['', '### Четыре субъектные линии', '', '| Линия | Контекст и ответственность | Представительные разработки | Статус |','|---|---|---|---|']
    lines += [f'| {v["line"]} | {md(v["boundary"])} | {", ".join(v["item_ids"])} | {v["status"]} |' for v in m['subject_views']]
    lines += ['', '### Уровни рассмотрения', '', '| ID | Уровень | Что выясняем |','|---|---|---|']
    lines += [f'| {l["id"]} | {l["name"]} | {l["question"]} |' for l in m['layers']]
    lines += ['', '### Где искать authority', '', '| Область | Вход | Правило |', '|---|---|---|']
    lines += [f'| {r["scope"]} | [{r["path"]}]({r["path"]}) | {r["role"]} |' for r in m['authority_routes']]
    lines += ['', 'Central cycle4 state хранит нормативные ограничения и старые product observations. Перед работой product CURRENT/release state проверяется в owning source на exact live HEAD. Более новый обзор не принимает новую норму.', '',
      '### Предметная разработка и источники сайтов', '',
      'Роли относятся к source development. Website commit не доказывает live deployment; embedded runtime copies сохраняются до квалифицированного delivery contract (G20). Для ArtBazi G19 source/targeted website qualification закрыта; real Sales→DPS fulfillment и product acceptance проверяются отдельно.', '',
      '| Домен | Предметная разработка / ветка | Website source / ветка | Проверенный website commit |', '|---|---|---|---|']
    for b in m['bindings']:
        if not b.get('domain_id'):continue
        r=b['repository_split']
        lines.append(f'| {b["domain_id"]} / {b["name"]} | {r["domain_development_repository"]} / `{r["domain_development_branch"]}` | {r["website_source_repository"]} / `{r["website_source_branch"]}` | `{r["website_source_commit"]}` |')
    lines += ['',
      '### Вклад 12 доменов', '', '| ID / домен | Вклад | Граница знания |','|---|---|---|']
    lines += [f'| {c["id"]} / {c["name"]} | {md(c["global_contribution"])} | {md(c["current_state_limits"])} |' for c in rec['domains']['cards']]
    lines += ['', '### Охват привязок по всем уровням', '', 'Знак ? — привязка не установлена, а не отсутствие функции. «Код» — чтение конкретного кода, «источник» — описание/наблюдение, «дизайн» — проектная модель, «state» — scoped product state; ни одна отметка не означает готовность всей разработки. Точные статусы и основания находятся в SYSTEM_MODEL.', '',
      '| Привязка | Цель | Субъект | Семантика | Процесс | Интерфейс | Данные | Компонент | Размещение | Evidence |', '|---|---|---|---|---|---|---|---|---|---|']
    def short_status(c):
        s=c['status']
        if s=='UNKNOWN':return '?'
        if 'CODE' in s:return 'код'
        if 'DESIGN' in s or s=='ANALYTICAL_MAPPING_CANDIDATE':return 'дизайн'
        if 'CURRENT_PRODUCT_STATE' in s or 'CURRENT_HOLD' in s or 'ACCEPTANCE_WITH' in s:return 'state'
        return 'источник'
    for b in m['bindings']:
        cells=[short_status(b['layers'][l['id']]) for l in m['layers']]
        lines.append('| '+b['id']+' / '+b['name']+' | '+' | '.join(cells)+' |')
    lines += ['', '### Общие средства и дальнейшие разработки', '', '| ID | Разработка | Самостоятельный результат | Состояние по источнику/анализу |','|---|---|---|']
    for x in rec['items']['items']:
        if not x['domain_ids'] or x['id'] in {'PR-OPERATOR-MODULAR','PR-D03-DPS','PR-D10-INTERNAL-SALES'}:
            lines.append(f'| {x["id"]} | {md(x["name"])} | {md(x["independent_result"])} | {md(x["current_runtime"])} |')
    lines += ['', '### Данные, компоненты, размещение и доказательства', '', '| Привязка | Данные | Компонент | Размещение | Evidence |','|---|---|---|']
    for b in m['bindings']:
        if b['id'] not in {'B-D01','B-D02','B-SALES','B-DPS','B-OPERATOR','B-FACTORY','B-PA','B-FOUNDATION'}:continue
        cells=[cell_md(st,b['layers'][l]) for l in ['L-DATA','L-COMPONENT','L-PLACEMENT','L-EVIDENCE']]
        lines.append('| '+b['id']+' / '+b['name']+' | '+' | '.join(cells)+' |')
    lines += ['', 'Для остальных доменов привязки находятся в SYSTEM_MODEL; незаполненные data/contract/deployment области имеют UNKNOWN и G16. Наличие наблюдения кода не доказывает полный продуктовый цикл. Подробные процессы и item sources сохраняются в прежних карточках/реестрах.', '']
    lines += ['### Предусловия общих возможностей', '', 'Фрагмент существующего capability graph. Стрелка идёт от предусловия к использующей его возможности; в исходном JSON направление requires обратное. Это design dependency, не доказательство product adoption.', '', '```mermaid', 'flowchart TD']
    selected=set(m['capability_view']['node_ids'])
    for n in st['capability_graph']['nodes']:
        if n['id'] not in selected:continue
        nid=n['id'].replace('-','_');lines.append(f'    {nid}["{n["id"]}"]')
        for req in n.get('requires',[]):
            if req in selected:lines.append(f'    {req.replace("-","_")} --> {nid}')
    lines += ['```', '', 'Узкая AI-помощь не требует зрелого Core и агента. Делегированный агент не требует генеративного AI; внешнее действие — отдельная условная возможность. Все исходные prerequisites сохраняются в [полном графе]('+m['capability_view']['path']+').', '']
    for p in m['processes']:
        lines += ['### '+p['name'], '', p['scope']+'. '+p['boundary'], '', '```mermaid', 'flowchart TD']
        for step in p['steps']:lines.append(f'    {step["id"]}["{step["label"]}"]')
        for e in p['edges']:
            label=e.get('relation_id','описанный переход')
            lines.append(f'    {e["from"]} -. "{label}" .-> {e["to"]}')
        lines += ['```', '', 'Пунктир показывает описанное/проектное продолжение, не выполненную передачу.', '', '| Отношение | Значение | Статус |', '|---|---|---|']
        for rid in dict.fromkeys(e['relation_id'] for e in p['edges'] if 'relation_id' in e):
            r=links[rid]; lines.append(f'| {rid} | {md(r["meaning"])} | {r["status"]} |')
        lines += ['', 'Открыто: '+', '.join(p['gap_ids'])+'.','']
    lines += ['### Как дорабатывать модель','',
      'Source delta → live version/diff → затронутые записи и views → смысловой review → render/verify → commit/readback. Product adoption выполняется отдельно. Человек может начать с правки схемы/формулировки; она возвращается к исходным записям и источникам. ИИ получает выбранную часть этих же записей.', '',
      'Сначала уточнить source и реальные implementation/deployment bindings выбранных результатов; затем необходимые interfaces/общие средства; после реального повтора — переиспользование и расширение. Текущий единый план: [PRACTICAL_DEVELOPMENT_PLAN_RU.md](PRACTICAL_DEVELOPMENT_PLAN_RU.md).', '',
      'Инструменты: `context` — пакет задачи; `prepare-update` — область влияния и PENDING; `complete-update` — явный review; `render` — человеческий вид; `verify` — согласованность. [Контекст ИИ](AI_CONTEXT_POLICY_RU.md), [порядок изменения](UPDATE_PROTOCOL_RU.md).', '', END]
    from coherence import render_completion
    last_section = max(i for i, line in enumerate(lines) if line.startswith('### '))
    lines[last_section:last_section] = render_completion(st)
    pending=pending_events(st)
    if pending:
        at=lines.index('### Как дорабатывать модель')
        block=['### Несогласованные изменения источников','','| Событие | Источник / новый HEAD | Затронуто | Статус |','|---|---|---|']
        block += [f'| {e["event_id"]} | {e["repository"]} / `{e["source_after"]}` | {", ".join(e["affected_binding_ids"])} | {e["knowledge_update_status"]} |' for e in pending]
        lines[at:at]=block+['']
    return '\n'.join(lines)+'\n'

def generated_part(text):
    if text.count(BEGIN)!=1 or text.count(END)!=1:raise ValueError('exactly one generated view block required')
    return text[text.index(BEGIN):text.index(END)+len(END)]+'\n'

def graph_projection(st):
    m=st['model']
    nodes=[dict(id='SYSTEM-MODEL',kind='ANALYTICAL_SYSTEM_MODEL',name='Сквозная карта реализации',path='knowledge/system/SYSTEM_MODEL.json',projection='SYSTEM_MODEL',not_runtime_ontology=True)]
    nodes += [dict(id=l['id'],kind='IMPLEMENTATION_VIEW',name=l['name'],projection='SYSTEM_MODEL') for l in m['layers']]
    nodes += [dict(id=b['id'],kind='CROSS_LEVEL_BINDING',name=b['name'],path='knowledge/system/SYSTEM_MODEL.json',projection='SYSTEM_MODEL') for b in m['bindings']]
    edges=[]
    def edge(a,b,t,**kw):edges.append(dict(source=a,target=b,type=t,projection='SYSTEM_MODEL',**kw))
    for b in m['bindings']:
        edge('SYSTEM-MODEL',b['id'],'HAS_ANALYTICAL_BINDING')
        for item in b['item_ids']:edge(b['id'],item,'DESCRIBES_SELECTED_DEVELOPMENT')
        for lid,c in b['layers'].items():edge(b['id'],lid,'HAS_VIEW_RECORD',status=c['status'])
        for sid in sorted(binding_sources(b)):edge(b['id'],sid,'SUPPORTED_BY_SOURCE_REFERENCE_NOT_RUNTIME_PROOF')
    edge('SYSTEM-MODEL', m['current_level_completion']['profile_source_id'], 'CURRENT_LEVEL_DESIGN_PROFILE_NOT_RUNTIME_AUTHORITY')
    return nodes,edges

def write_graph(st):
    path=st['k']/'KNOWLEDGE_GRAPH.json';g=load(path);nodes,edges=graph_projection(st)
    preserved_nodes=[n for n in g['nodes'] if n.get('projection')!='SYSTEM_MODEL']
    preserved_edges=[e for e in g['edges'] if e.get('projection')!='SYSTEM_MODEL']
    known={n['id'] for n in preserved_nodes}
    for r in st['sources'].values():
        for n in preserved_nodes:
            if n['id']==r['id'] and n.get('kind')=='SOURCE':
                n.update(name=r['title'],path=r.get('path'),role=r['authority_role'],locator=r['locator'],storage=r['storage'])
                break
        if r['id'] not in known:
            preserved_nodes.append(dict(id=r['id'],kind='SOURCE',name=r['title'],path=r.get('path'),role=r['authority_role'],locator=r['locator'],storage=r['storage']))
            known.add(r['id'])
    items={x['id']:x for x in st['records']['items']['items']}
    for item in items.values():
        if item['id'] not in known:
            preserved_nodes.append(dict(id=item['id'],kind='PRACTICAL_DEVELOPMENT',name=item['name'],path=st['model']['records']['items'],role=item['interpretation_status']))
            known.add(item['id'])
    if known&{n['id'] for n in nodes}:raise ValueError('graph projection ID collision')
    g['nodes']=preserved_nodes+nodes;g['edges']=preserved_edges+edges
    final_ids={n['id'] for n in g['nodes']}
    if any(e['source'] not in final_ids or e['target'] not in final_ids for e in g['edges']):raise ValueError('removing projection would orphan external edges; review graph relations explicitly')
    path.write_text(dump(g),encoding="utf-8",newline="\n")
    coverage_path=st['k']/'COVERAGE.json';coverage=load(coverage_path)
    coverage['stats'].update(source_records=len(st['sources']),graph_nodes=len(g['nodes']),graph_edges=len(g['edges']))
    coverage_path.write_text(dump(coverage),encoding="utf-8",newline="\n")

def write_view(st):
    target=st['k']/'SYSTEM_OVERVIEW_RU.md';text=target.read_text(encoding="utf-8")
    if BEGIN in text:
        generated_part(text)
        text=text[:text.index(BEGIN)]+render(st)+text[text.index(END)+len(END):].lstrip('\n')
    else:
        # One-time replacement of prior manually-maintained implementation views.
        text=text.split('## Архитектура на всех уровнях реализации')[0].rstrip()+'\n\n'+render(st)
    target.write_text(text,encoding="utf-8",newline="\n")
    if any(i.get('development_snapshot') for i in st['records']['items']['items']):
        (st['k']/'DEVELOPMENT_MAP_RU.md').write_text(development_map(st),encoding='utf-8',newline='\n')
    # Only model/view metadata, never external source versions or normative source bytes.
    source_path=st['k']/'SOURCE_REGISTRY.jsonl'
    rows=[json.loads(x) for x in source_path.read_text(encoding="utf-8").splitlines() if x]
    targets={'knowledge/system/SYSTEM_MODEL.json','knowledge/system/SYSTEM_OVERVIEW_RU.md'}
    changed=False
    for row in rows:
        if row.get('path') in targets:
            raw=canonical_file_bytes(st['root']/row['path']);sha=digest(raw)
            if sha!=row['sha256']:row['sha256']=sha;row['bytes']=len(raw);changed=True
    if changed:source_path.write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows),encoding="utf-8",newline="\n")
    write_graph(state(st['root']))

def pending_events(st):
    events=[json.loads(x) for x in (st['k']/'CHANGE_EVENTS.jsonl').read_text(encoding="utf-8").splitlines() if x]
    return [e for e in events if e.get('knowledge_update_status') in ('PENDING_SOURCE_REVIEW','PARTIAL_SOURCE_REVIEW')]

def binding_uses_stream(binding, repository, branch):
    """Conservative impact routing, including unindexed paths in an owning surface."""
    if binding['owning_repository'] == repository:
        return True
    if any(v in (repository, repository + ':' + branch)
           for v in binding.get('scope_owners', {}).values()):
        return True
    split = binding.get('repository_split', {})
    return any(split.get(prefix + '_repository') == repository
               and split.get(prefix + '_branch') in (None, branch)
               for prefix in ('domain_development', 'website_source'))

def context(st,profile_id,task,knowledge_head,cache=None,max_chars=32000,heads=None,include_archived=False,binding_ids=None):
    check_sha(knowledge_head); verify(st,cache)
    p=next((x for x in st['model']['context_profiles'] if x['id']==profile_id),None)
    if not p:raise ValueError('unknown profile')
    p=copy.deepcopy(p)
    if binding_ids:
        requested=set(binding_ids)
        if not requested <= set(p['binding_ids']):raise ValueError('binding selection must be within the chosen profile')
        p['binding_ids']=[bid for bid in p['binding_ids'] if bid in requested]
        # Explicit domain selection expands its evidence, without including unrelated domains.
        if profile_id=='domain-development':p['mode']='DETAIL'
    selected=[b for b in st['model']['bindings'] if b['id'] in p['binding_ids']]
    sidset=set(p['required_source_ids'])
    sidset.update(s for c in st['model']['constraints'] for s in c['source_ids'])
    if p['mode']=='DETAIL':sidset.update(s for b in selected for s in binding_sources(b))
    sources=[];anchor_by={}
    for b in selected:
        for c in b['layers'].values():
            for a in c['anchors']:anchor_by.setdefault(a['source_id'],[]).append(a)
    rules=reading_policy(st['root'])
    omitted={sid for sid in sidset if is_archived(st['sources'][sid],rules)} if not include_archived else set()
    for sid in sorted(sidset-omitted):
        s=st['sources'][sid];text=source_text(st,sid,cache);quotes=[]
        if text is not None:
            quotes=list(dict.fromkeys(a['quote'] for a in anchor_by.get(sid,[])))[:2]
        locator={key:value for key,value in s['locator'].items() if key in {'kind','repository','branch','commit','path','url','filename','member','container_chain','package_sha256','placement_status'}}
        # Exact GitHub identity already retains repository + commit + path.
        # Omit its mechanically reconstructible URL from the bounded AI packet.
        if locator.get('kind')=='GITHUB_FILE' and all(locator.get(k) for k in ('repository','commit','path')):
            locator.pop('url',None)
        sources.append(dict(id=sid,sha256=s['sha256'],authority_role=s['authority_role'],locator=locator,parent_source_id=s.get('parent_source_id'),
                            reading_status='ARCHIVED_COMPATIBILITY_ONLY' if is_archived(s,rules) else 'CURRENT_SOURCE',read_status='VERIFIED_SELECTED_ANCHORS' if quotes else 'LOCATOR_READ_REQUIRED',quotes=quotes))
    records=[]
    for b in selected:
        record=dict(id=b['id'],name=b['name'],item_ids=b['item_ids'],subject_lines=b['subject_lines'])
        for key in ('owning_repository','owning_branch','scope','repository_split','scope_owners'):
            if key in b:record[key]=b[key]
        if p['mode']=='DETAIL':record['layers']={lid:dict(status=c['status'],note=c['note'],source_ids=c['source_ids'],gap_ids=c['gap_ids']) for lid,c in b['layers'].items()}
        else:record['evidence_status']=b['layers']['L-EVIDENCE']['status']
        records.append(record)
    processes=[x for x in st['model']['processes'] if x['id'] in p['process_ids']]
    process_links={e['relation_id'] for process in st['model']['processes'] if process['id'] in p['process_ids'] for e in process['edges'] if 'relation_id' in e}
    dependencies=[b for b in st['model']['bindings'] if b['id'] in p.get('dependency_binding_ids',[])]
    relevant_bids=set(p['binding_ids'])|set(p.get('dependency_binding_ids',[]))
    pending=[dict(event_id=e['event_id'],repository=e['repository'],source_after=e['source_after'],status=e['knowledge_update_status'],affected_binding_ids=e['affected_binding_ids'],affected_connection_ids=e.get('affected_connection_ids',[]),scope_fields_complete=all(k in e for k in ('affected_source_ids','affected_connection_ids'))) for e in pending_events(st) if p['id']=='whole' or set(e['affected_binding_ids'])&relevant_bids or set(e.get('affected_source_ids',[]))&sidset or set(e.get('affected_connection_ids',[]))&process_links]
    drift=[]
    for h in heads or []:
        check_sha(h['live_head'])
        row=next((r for r in st['repositories'] if r['repository']==h['repository'] and r['branch']==h['branch']),None)
        if row is None:raise ValueError('unregistered source stream in heads')
        relevant=any(binding_uses_stream(b,h['repository'],h['branch']) for b in selected+dependencies) or any(s['locator'].get('repository')==h['repository'] and s['locator'].get('branch')==h['branch'] for s in sources)
        if relevant and row['observed_head']!=h['live_head']:drift.append(h)
    packet=dict(schema='IWXA_TASK_CONTEXT/1.0',task=task,profile=profile_id,knowledge_head=knowledge_head,
      head_provenance='CALLER_SUPPLIED_INDEPENDENT_FETCH_REQUIRED',state_fingerprint=fingerprint(st),
      core=dict(subject_lines=st['model']['subject_lines'],subject_views=st['model']['subject_views'],axes=st['model']['axes'],layers=st['model']['layers'],constraints=st['model']['constraints'],
                rules=['Read exact source and relevant live CURRENT before action.','AI output remains draft until the applicable acceptance.','Do not infer NOT_EXISTS from UNKNOWN or promote code to runtime readiness.']),
      bindings=records,processes=processes,sources=sources,pending_updates=pending,live_head_drift=drift,
      reading_policy=dict(mode='EXPLICIT_ARCHIVE_INCLUDED' if include_archived else 'CURRENT_ONLY',current_semantics=rules['current_semantics'],archived_source_ids_omitted=sorted(omitted),archival_refs_in_records='PROVENANCE_ONLY_NOT_CURRENT_AUTHORITY'),
      currentness='REVIEW_REQUIRED' if pending or drift else 'SOURCE_PINNED_LIVE_CHECK_REQUIRED',
      inventory_scope={'items':len(st['records']['items']['items']),'domains':12,'complete_inventory':False},
      return_contract=['Result and criteria','Exact source versions','Changed record IDs and impact','Remaining unknowns','No implicit normative adoption'])
    packet['development_navigation']=dict(map='knowledge/system/DEVELOPMENT_MAP_RU.md',
      command='python knowledge/system/tools/system.py development --item PR-ID',
      record_path=st['model']['records']['items'],status='SAME_RECORDS_AS_HUMAN_VIEW_NO_READINESS_PROMOTION')
    gap_ids={gid for b in selected for c in b['layers'].values() for gid in c['gap_ids']}
    packet['gaps']=[dict(id=g['id'],kind=g['kind'],status=g['status'],
      locator='knowledge/system/GAP_REGISTRY.json#'+g['id']) for g in st['gaps'] if g['id'] in gap_ids]
    if p.get('include_all_domains'):
        domain_ids={b.get('domain_id') for b in selected}
        packet['domains']=[dict(id=c['id'],name=c['name'],contribution=c['global_contribution'],limits=c['current_state_limits']) for c in st['records']['domains']['cards'] if not binding_ids or c['id'] in domain_ids]
    sync=independent_sync(st,None if p['id']=='whole' else relevant_bids,knowledge_head)
    if sync:
        packet['independent_sync']=sync
        if sync['currentness']=='REVIEW_REQUIRED':packet['currentness']='REVIEW_REQUIRED'
    serialized=context_dump(packet)
    if len(serialized)>max_chars:raise ValueError(f'context needs {len(serialized)} chars, budget {max_chars}; use a narrower profile or increase explicit budget; critical constraints were not trimmed')
    packet['size']=dict(characters_without_size_metadata=len(serialized),limit_characters=max_chars,unit='CHARACTERS_NOT_TOKENS',source_bodies_copied=False)
    if len(context_dump(packet))>max_chars:raise ValueError('budget also needs size metadata; increase explicit limit')
    return packet

def brief(st,knowledge_head,max_chars=14000):
    """Small navigation view; source interpretation still requires scoped retrieval."""
    check_sha(knowledge_head);verify(st)
    packet=dict(schema='IWXA_SYSTEM_BRIEF/1',knowledge_head=knowledge_head,
      state_fingerprint=fingerprint(st),reading_status='NAVIGATION_NOT_SOURCE_REVIEW',
      currentness='SOURCE_PINNED_LIVE_CHECK_REQUIRED',
      current_semantics=reading_policy(st['root'])['current_semantics'],
      subject_lines=st['model']['subject_lines'],constraints=st['model']['constraints'],
      inventory=dict(registered_repositories=len({r['repository'] for r in st['repositories']}),
        selected_items=len(st['records']['items']['items']),bindings=len(st['model']['bindings']),complete=False),
      bindings=[dict(id=b['id'],name=b['name'],owning_repository=b['owning_repository'],
        evidence_status=b['layers']['L-EVIDENCE']['status'],
        unknown_layers=[lid for lid,c in b['layers'].items() if c['status']=='UNKNOWN'],
        gap_ids=sorted({g for c in b['layers'].values() for g in c['gap_ids']})) for b in st['model']['bindings']],
      profiles=[dict(id=p['id'],name=p['name'],binding_ids=p['binding_ids']) for p in st['model']['context_profiles']],
      pending_updates=[dict(event_id=e['event_id'],repository=e['repository'],affected_binding_ids=e['affected_binding_ids']) for e in pending_events(st)],
      next='context --profile PROFILE --task TASK --knowledge-head LIVE_HEAD; --binding B-D04 narrows domain-development; read exact sources before conclusions/actions',
      audit='knowledge/system/REPOSITORY_AUDIT_RU.md',
      budget=dict(unit='CHARACTERS_NOT_TOKENS',limit=max_chars))
    sync=independent_sync(st,knowledge_head=knowledge_head)
    if sync:
        packet['independent_sync']=sync
        if sync['currentness']=='REVIEW_REQUIRED':packet['currentness']='REVIEW_REQUIRED'
    if packet['pending_updates']:packet['currentness']='REVIEW_REQUIRED'
    if len(context_dump(packet))>max_chars:raise ValueError('brief exceeds explicit budget; constraints were not trimmed')
    return packet

def impact(st,repo,branch,new_head,changed_paths=None):
    check_sha(new_head)
    row=next((x for x in st['repositories'] if x['repository']==repo and x['branch']==branch),None)
    if row is None:raise ValueError('unregistered stream; register owning source first')
    paths=set(changed_paths or [])
    stream_sources=[s for s in st['sources'].values() if s['locator'].get('repository')==repo and s['locator'].get('branch')==branch]
    affected_sources={s['id'] for s in stream_sources if not paths or s['locator']['path'] in paths}
    # Owning-repo fallbacks make missing source/path bindings visible instead of proving no impact.
    bids=[b['id'] for b in st['model']['bindings'] if binding_uses_stream(b,repo,branch) or binding_sources(b)&affected_sources]
    links=[r['id'] for r in st['records']['connections']['connections'] if any(a['source_id'] in affected_sources for a in r['evidence'])]
    identity=json.dumps([repo,branch,row['observed_head'],new_head,sorted(paths)],sort_keys=True)
    return dict(schema='IWXA_SOURCE_REFRESH/1.0',event_id='REFRESH-'+digest(identity.encode())[:20],
      repository=repo,branch=branch,source_before=row['observed_head'],source_after=new_head,
      decision_type='CALLER_SUPPLIED_LIVE_HEAD_OBSERVATION',knowledge_update_status='NO_HEAD_DRIFT' if row['observed_head']==new_head else 'PENDING_SOURCE_REVIEW',
      based_on_fingerprint=fingerprint(st),changed_paths=sorted(paths),affected_source_ids=sorted(affected_sources),
      affected_binding_ids=bids,affected_connection_ids=links,affected_views=st['model']['generated_views'],
      semantic_effect='NOT_REVIEWED',product_adoption='NOT_CHANGED',
      required_review=['Read exact diff and owning scoped CURRENT','Reconcile changed sources/anchors/records','Classify meaning and update dependent views','Render/verify and commit/readback'],
      reviews=[],unknown_path_binding=bool(paths-set(s['locator']['path'] for s in stream_sources)))

def persist_pending(st,event):
    if event['knowledge_update_status']=='NO_HEAD_DRIFT':return False
    path=st['k']/'CHANGE_EVENTS.jsonl'; rows=[json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x]
    if any(e.get('event_id')==event['event_id'] for e in rows):return False
    if event['based_on_fingerprint']!=fingerprint(st):raise ValueError('stale refresh draft; prepare again')
    verify(st)
    paths=[path,st['k']/'SYSTEM_OVERVIEW_RU.md',st['k']/'SOURCE_REGISTRY.jsonl',st['k']/'KNOWLEDGE_GRAPH.json',st['k']/'COVERAGE.json']
    old={p:p.read_bytes() for p in paths}
    try:
        rows.append(event);path.write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows),encoding="utf-8",newline="\n")
        write_view(state(st['root']))
    except Exception:
        for p,raw in old.items():p.write_bytes(raw)
        raise
    return True

def complete_update(st,review):
    path=st['k']/'CHANGE_EVENTS.jsonl';rows=[json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x]
    event=next((e for e in rows if e.get('event_id')==review.get('event_id')),None)
    if not event or event.get('knowledge_update_status') not in ('PENDING_SOURCE_REVIEW','PARTIAL_SOURCE_REVIEW'):raise ValueError('open refresh event required')
    check_sha(review.get('checked_head'))
    if review['checked_head']!=event['source_after']:raise ValueError('review is for another source head')
    row=next(r for r in st['repositories'] if r['repository']==event['repository'] and r['branch']==event['branch'])
    if row['observed_head']!=event['source_before']:raise ValueError('stream reconciled by another change; reprepare against the current source baseline')
    if review.get('based_on_fingerprint')!=fingerprint(st):raise ValueError('review of current edited records required')
    if review.get('normative_adoption') or review.get('runtime_ready'):raise ValueError('refresh cannot adopt norms or grant runtime readiness')
    if not review.get('reviewer') or not review.get('meaning_note'):raise ValueError('reviewer and meaning required')
    reviewed=set(review.get('reviewed_binding_ids',[]));remaining=set(review.get('remaining_binding_ids',[]));expected=set(event['affected_binding_ids'])
    if reviewed&remaining or reviewed|remaining!=expected:raise ValueError('each impacted binding must be reviewed or remain pending')
    reviewed_links=set(review.get('reviewed_connection_ids',[]));remaining_links=set(review.get('remaining_connection_ids',[]));expected_links=set(event['affected_connection_ids'])
    if reviewed_links&remaining_links or reviewed_links|remaining_links!=expected_links:raise ValueError('each impacted connection must be reviewed or remain pending')
    partial=bool(remaining or remaining_links)
    if review.get('disposition') not in ('NO_MEANING_CHANGE','RECONCILED','PARTIAL'):raise ValueError('explicit review disposition required')
    if partial and review['disposition']!='PARTIAL':raise ValueError('pending records cannot be called reconciled')
    if review['disposition']=='PARTIAL' and not partial:raise ValueError('partial review needs remaining records')
    checks=review.get('source_checks',[])
    if not checks:raise ValueError('exact source checks required; head-only review cannot close update')
    for c in checks:
        if c.get('repository')!=event['repository'] or c.get('commit')!=event['source_after']:raise ValueError('source check version mismatch')
        if not c.get('path') or not c.get('read_scope'):raise ValueError('source check path and read scope required')
        raw=Path(c['local_file']).read_bytes()
        if digest(raw)!=c['sha256']:raise ValueError('review source bytes mismatch')
    if event['changed_paths'] and not set(event['changed_paths'])<=set(c['path'] for c in checks):raise ValueError('each supplied changed path requires review evidence')
    verify(st,require_views=True)
    saved_review=copy.deepcopy(review)
    for c in saved_review['source_checks']:c.pop('local_file',None)
    event['review']=saved_review
    event['knowledge_update_status']='PARTIAL_SOURCE_REVIEW' if partial else 'RECONCILED_SOURCE_REVIEW'
    event['semantic_effect']=review['disposition']
    # Partial completion retains the previous reconciled stream head.
    repositories=copy.deepcopy(st['repositories'])
    if not partial:
        row=next(r for r in repositories if r['repository']==event['repository'] and r['branch']==event['branch'])
        row['observed_head']=event['source_after'];row['semantic_review_event']=event['event_id']
        row['semantic_review_scope']='CALLER_ATTESTED_EXACT_SOURCE_REVIEW_NOT_PRODUCT_ADOPTION'
        row['live_ref_verification_scope']='CALLER_ATTESTED_FETCH_PLUS_EXACT_SOURCE_REVIEW'
    else:
        event['affected_binding_ids']=sorted(remaining)
        event['affected_connection_ids']=sorted(remaining_links)
    event['reviewed_at']=datetime.now(timezone.utc).isoformat()
    # Stage both files, restore on failure; external publication still uses a single verified Git tree.
    replacements={path:''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows),st['k']/'REPOSITORY_REGISTRY.json':dump(repositories)}
    old={p:p.read_bytes() for p in replacements}
    view=st['k']/'SYSTEM_OVERVIEW_RU.md';old[view]=view.read_bytes()
    registry=st['k']/'SOURCE_REGISTRY.jsonl';old[registry]=registry.read_bytes()
    for name in ['KNOWLEDGE_GRAPH.json','COVERAGE.json']:old[st['k']/name]=(st['k']/name).read_bytes()
    try:
        for p,text in replacements.items():p.write_text(text,encoding="utf-8",newline="\n")
        write_view(state(st['root']))
    except Exception:
        for p,raw in old.items():p.write_bytes(raw)
        raise
    return dict(event_id=event['event_id'],status=event['knowledge_update_status'],product_adoption='NOT_CHANGED')

def outside_output(st,path):
    p=Path(path).resolve()
    if p.is_relative_to(st['root'].resolve()):raise ValueError('transient context/review output must live outside the repository')
    p.parent.mkdir(parents=True,exist_ok=True);return p

def main():
    p=argparse.ArgumentParser(description=__doc__); sub=p.add_subparsers(dest='command',required=True)
    v=sub.add_parser('verify');v.add_argument('--cache-manifest')
    sub.add_parser('render')
    d=sub.add_parser('development');d.add_argument('--item',required=True);d.add_argument('--output')
    b=sub.add_parser('brief');b.add_argument('--knowledge-head',required=True);b.add_argument('--max-chars',type=int,default=14000);b.add_argument('--output')
    c=sub.add_parser('context');c.add_argument('--profile',required=True);c.add_argument('--task',required=True);c.add_argument('--knowledge-head',required=True);c.add_argument('--cache-manifest');c.add_argument('--heads-file');c.add_argument('--max-chars',type=int,default=32000);c.add_argument('--output')
    c.add_argument('--include-archived',action='store_true',help='Explicit compatibility/history task; never restore retired terminology as current')
    c.add_argument('--binding',action='append',help='Select binding IDs within the profile; repeat for several IDs')
    u=sub.add_parser('prepare-update');u.add_argument('--repo',required=True);u.add_argument('--branch',required=True);u.add_argument('--live-head',required=True);u.add_argument('--changed-path',action='append');u.add_argument('--record-pending',action='store_true');u.add_argument('--output')
    f=sub.add_parser('complete-update');f.add_argument('--review-file',required=True)
    a=p.parse_args();st=state();cache=load(Path(a.cache_manifest)) if getattr(a,'cache_manifest',None) else None
    target=outside_output(st,a.output) if getattr(a,'output',None) else None
    if a.command=='verify':result=verify(st,cache)
    elif a.command=='render':verify(st,require_views=False);write_view(st);result=verify(state())
    elif a.command=='brief':result=brief(st,a.knowledge_head,a.max_chars)
    elif a.command=='development':verify(st,cache);result=development_packet(st,a.item)
    elif a.command=='context':result=context(st,a.profile,a.task,a.knowledge_head,cache,a.max_chars,load(Path(a.heads_file)) if a.heads_file else None,a.include_archived,a.binding)
    elif a.command=='prepare-update':
        result=impact(st,a.repo,a.branch,a.live_head,a.changed_path)
        if a.record_pending:result['new_pending_event_written']=persist_pending(st,result)
    else:result=complete_update(st,load(Path(a.review_file)))
    encode=context_dump if a.command in ('context','brief') else dump
    if target:
        target.write_text(encode(result),encoding="utf-8",newline="\n");print(dump(dict(output=str(target),profile=result.get('profile'),status=result.get('status',result.get('knowledge_update_status',result.get('currentness'))),size=result.get('size'))))
    else:print(encode(result),end='')

if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,OSError) as e:print(str(e),file=sys.stderr);sys.exit(2)
