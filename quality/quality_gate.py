"""Fail-closed first-level quality gate for *scoped* IWXA data candidates.

Does not issue a production release or attest semantic truth.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'restored/src'))
import iwxa_knowledge as knowledge

STAGES = ('scope', 'source_semantics', 'russian_applicability', 'adversarial', 'utility')
REVIEW_ROLES = ('source_semantics', 'ru_applicability', 'adversarial_integration')

def evaluate(report, reviews, scope, snapshot):
    def require(ok, reason):
        if not ok: raise ValueError(reason)
    require(isinstance(report,dict) and isinstance(reviews,list) and isinstance(scope,dict),'invalid evidence')
    knowledge.check_snapshot(snapshot)
    records=snapshot['body']['records']
    exact_ids={x['id'] for x in records}
    exact_edges={x['id'] for x in knowledge.semantic_edges(records)}
    require(len(exact_ids)==len(records)==report.get('records'),'source records do not match report')
    require(snapshot['snapshot_sha256']==report.get('snapshot_sha256'),'source snapshot mismatch')
    require(scope.get('schema')=='iwxa.knowledge.l1-scope/0.1','scope schema')
    require(report.get('release_authorized') is False,'no production release')
    require(report.get('snapshot_sha256')==scope.get('snapshot_sha256'),'stale scope')
    claim=scope.get('claim')
    require(claim in ('data_candidate','agent_recipe_candidate','agent_executable','program_integration'),'claim')
    require(not any(scope.get(n) for n in ('production_ready','fully_autonomous','verified_russian_law','ready_agent')),'premature claim')
    require(isinstance(scope.get('out_of_scope'),list) and scope['out_of_scope']
            and all(isinstance(x,str) and x.strip() for x in scope['out_of_scope']),'explicit limitations')
    cases=scope.get('use_cases')
    require(isinstance(cases,list) and bool(cases),'no real usable scenarios')
    for case in cases:
        require(isinstance(case,dict) and set(case)=={'id','input','expected','observed','evidence_file'},'case shape')
        require(all(isinstance(x,str) and x.strip() for x in case.values()),'empty case')
        require(case['observed']=='PASS','scenario not passed')
        p=Path(case['evidence_file'])
        require(not p.is_absolute() and '..' not in p.parts and '\\' not in case['evidence_file'],'unsafe evidence path')
    tests=report.get('tests',{})
    require(type(tests.get('run')) is int and tests['run']>0
            and all(tests.get(k)==0 for k in ('failures','errors','skipped')),'tests incomplete')
    require(report.get('deterministic_rebuild')=='PASS' and report.get('reopen_readback')=='PASS','rebuild/reopen')
    require(report.get('network_calls')==0,'network in offline pilot')
    packages=report.get('packages',[])
    require(isinstance(packages,list) and packages,'no modules')
    require(sum(p.get('records',0) for p in packages)==report.get('records'),'records omitted/duplicated')
    # A derived database cannot be a plain upstream file or title-only shell.
    require(all(len(knowledge.canonical(r.get('payload',{})))>=80 for r in records),'record payload is only a shell')
    require(all((r['kind']!='localization' or r['payload']['applicability']!='source_supported') for r in records),'RU evidence profile cannot yet establish trusted jurisdiction')
    excerpt_values={v.strip() for src in snapshot['body']['sources'].values() for v in src['excerpts'].values()}
    require(not any(knowledge.canonical(r['payload']).decode('utf-8').strip() in excerpt_values for r in records),'unadapted copied payload')
    require(all(type(p.get('bytes')) is int and p['bytes']>500 and p.get('records',0)>0 for p in packages),'placeholder module')
    if claim in ('agent_executable','program_integration'):
        require(scope.get('runtime_evidence') and scope.get('permission_evidence'),'real runtime/rights evidence missing')
    else:
        require(not scope.get('runtime_evidence'),'data claim cannot assert runtime')
    require(not (claim=='agent_recipe_candidate' and scope.get('agent_execution_claim')),'recipe claimed executable')
    stages=scope.get('review_claims',{})
    require(isinstance(stages,dict) and set(stages)==set(STAGES) and all(v=='PASS' for v in stages.values()),'self-review stages')
    summary=report.get('reviews',{})
    require(summary.get('findings')==[] and summary.get('semantic_status')=='PASS_WITHIN_REVIEW_SCOPE','unresolved findings')
    require(summary.get('independence_attested') is False,'false independent review claim')
    require(len(reviews)==len(REVIEW_ROLES) and {r.get('role') for r in reviews}==set(REVIEW_ROLES),'review roles')
    for r in reviews:
        require(r.get('snapshot_sha256')==scope['snapshot_sha256'],'stale review')
        require(r.get('evidence_class')=='actual_assistant_review','synthetic reviewer claim')
        require(r.get('reviewer') and r.get('scope'),'anonymous/out-of-scope review')
        rows=r.get('records',[])
        require(len(rows)==report.get('records') and {x.get('id') for x in rows}==exact_ids,'incomplete or fabricated record review')
        require(all(x.get('verdict')=='pass' and len(str(x.get('basis','')).strip())>=35 for x in rows),'unsupported pass')
        edges=r.get('edge_checks',[])
        require(edges and {x.get('id') for x in edges}==exact_edges and len(edges)==len(exact_edges) and all(x.get('verdict')=='pass' for x in edges),'edge review incomplete')
    return {'schema':'iwxa.knowledge.l1-certificate/0.1',
        'status':'L1_SCOPED_CANDIDATE_COMPLETE','snapshot_sha256':scope['snapshot_sha256'],
        'claim':claim,'record_count':report['records'],'review_stages':list(STAGES),
        'independent_ai_review':'NOT_PERFORMED','production_release':'NOT_AUTHORIZED',
        'scope_limitations':scope['out_of_scope']}

def main():
    p=argparse.ArgumentParser()
    for key in ('report','reviews','scope','snapshot','out'):p.add_argument('--'+key,required=True,type=Path)
    a=p.parse_args()
    cert=evaluate(json.loads(a.report.read_text('utf-8')),
                  json.loads(a.reviews.read_text('utf-8')),
                  json.loads(a.scope.read_text('utf-8')),
                  json.loads(a.snapshot.read_text('utf-8')))
    a.out.parent.mkdir(parents=True,exist_ok=True)
    a.out.write_text(json.dumps(cert,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(cert,ensure_ascii=False))
if __name__=='__main__':main()
