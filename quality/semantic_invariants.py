"""Class-specific semantic anomaly detector. Heuristics, not a proof of truth."""
from __future__ import annotations
import re

def norm(v):
    return re.sub(r'\s+',' ',str(v).strip().casefold())

def scan(records, sources):
    issues=[]
    def flag(r,code,why):issues.append({'record_id':r['id'],'code':code,'reason':why})
    for r in records:
        k=r['kind'];p=r['payload']
        if k=='activity' and len(norm(p['scope']))<20:
            flag(r,'ACTIVITY_EMPTY_SUBSTANCE','Scope too short')
        if k=='need_pattern' and {norm(x) for x in p['signals']} & {norm(x) for x in p['counter_signals']}:
            flag(r,'NEED_CONTRADICTORY_SIGNALS','Positive and negative signals overlap')
        if k=='task_template' and {norm(x) for x in p['inputs']}=={norm(x) for x in p['outputs']}:
            flag(r,'TASK_NO_TRANSFORMATION','Input equals output')
        if k=='process_template':
            for step in p['steps']:
                a=norm(step['acceptance'])
                if len(a)<25 or 'соответствующего шаблона' in a or a in ('done','completed'):
                    flag(r,'PROCESS_NONOBSERVABLE_ACCEPTANCE',step['id']+': no observable criterion')
        if k=='method' and (len(p['procedure'])<2 or any(len(norm(x))<15 for x in p['procedure'])):
            flag(r,'METHOD_INCOMPLETE_PROCEDURE','No usable procedure')
        if k=='skill' and len(norm(p['instructions']))<65:
            flag(r,'SKILL_EMPTY_INSTRUCTIONS','No method and constraints')
        if k=='agent_recipe' and len(norm(p['goal']))<50:
            flag(r,'AGENT_NO_MEASURABLE_GOAL','No substantive goal')
        if k=='binding' and len(norm(p['protocol']))<18:
            flag(r,'BINDING_UNSPECIFIED_PROTOCOL','Binding has no interface description')
        if k=='localization' and p['applicability']=='source_supported':
            if not any(sources[x['source_id']].get('jurisdiction')=='RU' and
                       sources[x['source_id']].get('authority_status')=='verified'
                       for x in r['sources']):
                flag(r,'RU_UNSUPPORTED_AUTHORITY','Foreign source is not RU jurisdiction evidence')
        if k=='evaluation_case' and {norm(x) for x in p['expected']} & {norm(x) for x in p['forbidden']}:
            flag(r,'EVALUATION_CONTRADICTS_ITSELF','Expected is forbidden')
    return issues
