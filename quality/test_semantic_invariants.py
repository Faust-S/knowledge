"""Adversarial modifications for each of the ten content families."""
import copy
import json
from pathlib import Path
import unittest
from semantic_invariants import scan
BASE=Path(__file__).resolve().parent.parent
S=json.loads((BASE/'restored/build/snapshot.json').read_text('utf-8'))
RECORDS=S['body']['records'];SOURCES=S['body']['sources']

class SemanticMutations(unittest.TestCase):
    def test_current_pilot_has_known_content_shortcomings(self):
        self.assertTrue(any(x['code']=='PROCESS_NONOBSERVABLE_ACCEPTANCE' for x in scan(RECORDS,SOURCES)))
    def test_every_content_family_rejects_deceptive_mutation(self):
        cases=[
          ('activity','ACTIVITY_EMPTY_SUBSTANCE',lambda x:x['payload'].__setitem__('scope','ok')),
          ('need_pattern','NEED_CONTRADICTORY_SIGNALS',lambda x:x['payload'].__setitem__('counter_signals',list(x['payload']['signals']))),
          ('task_template','TASK_NO_TRANSFORMATION',lambda x:x['payload'].__setitem__('outputs',list(x['payload']['inputs']))),
          ('process_template','PROCESS_NONOBSERVABLE_ACCEPTANCE',lambda x:x['payload']['steps'][0].__setitem__('acceptance','Готово')),
          ('method','METHOD_INCOMPLETE_PROCEDURE',lambda x:x['payload'].__setitem__('procedure',['Готово'])),
          ('skill','SKILL_EMPTY_INSTRUCTIONS',lambda x:x['payload'].__setitem__('instructions','Готово')),
          ('agent_recipe','AGENT_NO_MEASURABLE_GOAL',lambda x:x['payload'].__setitem__('goal','Готово')),
          ('binding','BINDING_UNSPECIFIED_PROTOCOL',lambda x:x['payload'].__setitem__('protocol','ok')),
          ('localization','RU_UNSUPPORTED_AUTHORITY',lambda x:(x['sources'].append({'source_id':'src.onet.procurement','locator':'tasks.specifications'}),x['payload'].__setitem__('applicability','source_supported'))),
          ('evaluation_case','EVALUATION_CONTRADICTS_ITSELF',lambda x:x['payload'].__setitem__('forbidden',list(x['payload']['expected'])))
        ]
        for kind,code,mutate in cases:
            with self.subTest(kind=kind):
                rows=copy.deepcopy(RECORDS)
                target=next(x for x in rows if x['kind']==kind)
                mutate(target)
                self.assertTrue(any(x['record_id']==target['id'] and x['code']==code for x in scan(rows,SOURCES)))
if __name__=='__main__': unittest.main()
