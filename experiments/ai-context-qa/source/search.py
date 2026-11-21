"""Rebuildable local source retrieval. No network, credentials or model required."""
import argparse, hashlib, json, re, sqlite3, tempfile
from contextlib import closing
from pathlib import Path
from read_policy import policy as reading_policy, archived, select
from system import canonical_file_bytes

ROOT=Path(__file__).resolve().parents[3]
K=ROOT/'knowledge/system'

def sources():
    return [json.loads(l) for l in (K/'SOURCE_REGISTRY.jsonl').read_text(encoding='utf-8').splitlines() if l]

def fingerprint(rows,cache=None):
    works=hashlib.sha256(canonical_file_bytes(K/'WORK_REGISTRY.json')).hexdigest()
    return hashlib.sha256(json.dumps([[(r['id'],r['sha256'],r['scope'],r['authority_role'],r.get('path')) for r in rows],cache or {},works,reading_policy(ROOT)],ensure_ascii=False,sort_keys=True).encode()).hexdigest()

def source_bytes(r,cache=None):
    name=r.get('path')
    p=ROOT/name if name else Path((cache or {}).get(r['id'],'__SOURCE_NOT_CACHED__'))
    if not name and r['id'] not in (cache or {}):return None
    b=canonical_file_bytes(p) if name else p.read_bytes()
    if hashlib.sha256(b).hexdigest()!=r['sha256']:raise ValueError('Stale source hash: '+str(name or r['id']))
    return b

def eligible_sources(rows,include_archived=False):
    """A historical record stays addressable but never enters the normal index."""
    selected=select(rows,reading_policy(ROOT),include_archived)
    return [r for r in selected if include_archived or r.get('default_read_status')!='HISTORICAL_ONLY']


def checked_sources(rows,cache=None):
    """Only exact local bytes may enter the text index; report stale records."""
    valid=[];stale=[]
    for r in rows:
        try:source_bytes(r,cache)
        except (ValueError,OSError) as e:
            stale.append(dict(id=r['id'],path=r.get('path'),problem='SOURCE_BYTES_MISSING_OR_SHA256_DRIFT'))
            continue
        valid.append(r)
    return valid,stale


def build(db,rows,cache=None,include_archived=False):
    valid,_=checked_sources(eligible_sources(rows,include_archived),cache)
    with closing(sqlite3.connect(db)) as con:
        _build(con,valid,cache)


def _build(con,rows,cache):
    con.execute('DROP TABLE IF EXISTS chunks');con.execute('DROP TABLE IF EXISTS meta')
    con.execute('CREATE VIRTUAL TABLE chunks USING fts5(source_id UNINDEXED, scope UNINDEXED, role UNINDEXED, title, body, start_char UNINDEXED, end_char UNINDEXED, tokenize="unicode61")')
    con.execute('CREATE TABLE meta(k TEXT PRIMARY KEY,v TEXT)')
    candidates={}
    for w in json.loads((K/'WORK_REGISTRY.json').read_text(encoding='utf-8'))['items']:
        for sid in w['source_ids']:candidates.setdefault(sid,[]).append(w['name'])
    for r in rows:
        b=source_bytes(r,cache)
        try:text=b.decode('utf-8-sig') if b is not None else None
        except UnicodeDecodeError:text=None
        content_kind='FULL_TEXT' if text is not None else 'METADATA_AND_CANDIDATES_ONLY'
        if text is None:text='\n'.join([r['title'],json.dumps(r['locator'],ensure_ascii=False)]+candidates.get(r['id'],[]))
        role=r['authority_role']
        start=0
        while start<len(text):
            end=min(start+6000,len(text))
            if end<len(text):
                boundary=text.rfind('\n',start+3000,end)
                if boundary>start:end=boundary+1
            con.execute('INSERT INTO chunks VALUES (?,?,?,?,?,?,?)',(r['id'],r['scope'],role,r['title'],content_kind+'\n'+text[start:end],start,end))
            if end==len(text):break
            start=max(start+1,end-300)
    con.execute('INSERT INTO meta VALUES (?,?)',('fingerprint',fingerprint(rows,cache)))
    con.commit()

def focused_excerpt(text, query_text, max_chars=1100):
    """Return a bounded, query-oriented source window and its local character offsets.

    The returned window is navigational evidence, never the complete source text.
    The exact source locator and original chunk offsets remain available to callers.
    """
    if max_chars < 120:
        raise ValueError('excerpt_chars must be at least 120')
    if len(text) <= max_chars:
        return text, 0, len(text), False
    width = max_chars - 2  # reserve space for possible leading/trailing ellipses
    terms = list(dict.fromkeys(re.findall(r'[\w]+', query_text, flags=re.UNICODE)))
    hits = []
    for index, term in enumerate(terms):
        for match in re.finditer(re.escape(term), text, flags=re.IGNORECASE):
            hits.append((match.start(), index))
            if sum(1 for _, t in hits if t == index) >= 20:
                break
    if hits:
        # Prefer a window containing more DISTINCT query terms; keep early text
        # in ties. This avoids returning only the first, potentially weak hit.
        starts = {0}
        last = len(text) - width
        for position, _ in hits:
            starts.add(min(last, max(0, position - width // 3)))
        def rank(begin):
            covered = [term for position, term in hits if begin <= position < begin + width]
            return len(set(covered)), len(covered), -begin
        begin = max(starts, key=rank)
    else:
        begin = 0  # title-only FTS match: show the document opening
    end = begin + width
    snippet = ('…' if begin else '') + text[begin:end] + ('…' if end < len(text) else '')
    return snippet, begin, end, True


def query(query_text,db,rows,scope=None,role=None,limit=8,rebuild=False,cache=None,include_archived=False,status_out=None,excerpt_chars=1100):
    rules=reading_policy(ROOT)
    total_records=len(rows)
    eligible=eligible_sources(rows,include_archived)
    rows,stale=checked_sources(eligible,cache)
    if status_out is not None:
        status_out.update(retrieval_status='REVIEW_REQUIRED_SOURCE_DRIFT' if stale else 'SOURCE_HASHES_VERIFIED_OR_EXTERNAL_METADATA_ONLY',
                          indexed_sources=len(rows),stale_sources_skipped=len(stale),
                          stale_source_ids=[x['id'] for x in stale[:30]],
                          historical_sources_omitted=0 if include_archived else total_records-len(eligible))
    db=Path(db);db.parent.mkdir(parents=True,exist_ok=True)
    fresh=False
    if db.exists():
        try:
            con=sqlite3.connect(db);f=con.execute('SELECT v FROM meta WHERE k="fingerprint"').fetchone();con.close()
            fresh=bool(f and f[0]==fingerprint(rows,cache))
        except sqlite3.Error:pass
    if rebuild or not fresh:
        with closing(sqlite3.connect(db)) as con:_build(con,rows,cache)
    # Each request independently checks source bytes before trusting a cached index.
    terms=re.findall(r'[\w]+',query_text,flags=re.UNICODE)
    if not terms:return []
    expr=' OR '.join('"'+t+'"*' for t in terms)
    where=['chunks MATCH ?'];args=[expr]
    if scope:where.append('scope=?');args.append(scope)
    if role:where.append('role=?');args.append(role)
    con=sqlite3.connect(db)
    data=con.execute('SELECT source_id,scope,role,title,body,start_char,end_char,bm25(chunks,0,0,0,4,1,0,0) AS score FROM chunks WHERE '+' AND '.join(where)+' ORDER BY score LIMIT ?',args+[max(limit*20,100)]).fetchall();con.close()
    lookup={r['id']:r for r in rows};out=[];seen=set()
    for i,s,role_,title,body,start,end,score in data:
        if i in seen:continue
        seen.add(i);r=lookup[i]
        content_kind,body=body.split('\n',1)
        snippet,local_start,local_end,truncated=focused_excerpt(body,query_text,excerpt_chars)
        out.append(dict(source_id=i,path=r['path'],locator=r['locator'],content_kind=content_kind,scope=s,authority_role=role_,reading_status='ARCHIVED_COMPATIBILITY_ONLY' if (archived(r,rules) or r.get('default_read_status')=='HISTORICAL_ONLY') else 'CURRENT_SOURCE',title=title,start_char=start,end_char=end,score=score,
                        original_path=r.get('original_path'),origin=r['origin'],sha256=r['sha256'],excerpt=snippet,
                        excerpt_truncated=truncated,excerpt_start_char=start+local_start if content_kind=='FULL_TEXT' else None,
                        excerpt_end_char=start+local_end if content_kind=='FULL_TEXT' else None))
        if len(out)>=limit:break
    return out

def graph_node(nid,include_archived=False):
    g=json.loads((K/'KNOWLEDGE_GRAPH.json').read_text(encoding='utf-8'));nodes={n['id']:n for n in g['nodes']}
    if nid not in nodes:raise ValueError('Unknown node '+nid)
    hidden=set()
    if not include_archived:
        old={r['id'] for r in sources() if archived(r,reading_policy(ROOT)) or r.get('default_read_status')=='HISTORICAL_ONLY'}
        hidden={n['id'] for n in nodes.values() if n['id'] in old or (n.get('source_ids') and set(n['source_ids'])<=old)}
    if nid in hidden:raise ValueError('Archived node requires explicit --include-archived compatibility task')
    edges=[e for e in g['edges'] if (e['source']==nid or e['target']==nid) and e['source'] not in hidden and e['target'] not in hidden]
    related={e['target'] if e['source']==nid else e['source'] for e in edges}
    return dict(node=nodes[nid],edges=edges,related=[nodes[n] for n in sorted(related)],reading_mode='EXPLICIT_ARCHIVE_INCLUDED' if include_archived else 'CURRENT_ONLY')

def main():
    p=argparse.ArgumentParser();p.add_argument('--query');p.add_argument('--scope');p.add_argument('--role');p.add_argument('--limit',type=int,default=8);p.add_argument('--node');p.add_argument('--overview',action='store_true');p.add_argument('--rebuild',action='store_true');p.add_argument('--db',default=str(Path(tempfile.gettempdir())/'iwxa-source-index'/('index-'+hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]+'.sqlite')))
    p.add_argument('--cache-manifest',help='JSON source_id to local absolute path; fulltext cache lives outside Git')
    p.add_argument('--include-archived',action='store_true',help='Explicit history/compatibility task only; retired terms do not become current')
    p.add_argument('--excerpt-chars',type=int,default=1100,help='Maximum source excerpt length, minimum 120; use the original source for complete interpretation')
    a=p.parse_args();cache=json.loads(Path(a.cache_manifest).read_text(encoding='utf-8')) if a.cache_manifest else None
    if a.overview:print((K/'SYSTEM_OVERVIEW_RU.md').read_text(encoding='utf-8'));return
    if a.node:print(json.dumps(graph_node(a.node,a.include_archived),ensure_ascii=False,indent=2));return
    if not a.query:p.error('--query, --node or --overview is required')
    status={}
    results=query(a.query,a.db,sources(),a.scope,a.role,a.limit,a.rebuild,cache,a.include_archived,status,a.excerpt_chars)
    print(json.dumps(dict(query=a.query,results=results,source_integrity=status,reading_mode='EXPLICIT_ARCHIVE_INCLUDED' if a.include_archived else 'CURRENT_ONLY',rule='T0 minimal particles / T1 minimal processes are the only current meanings. Metadata is navigation, not source content.'),ensure_ascii=False,indent=2))

if __name__=='__main__':main()
