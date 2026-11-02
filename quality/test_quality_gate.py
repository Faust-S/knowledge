import copy
import json
from pathlib import Path
import unittest
from quality_gate import evaluate
BASE=Path(__file__).resolve().parent.parent
R=json.loads((BASE/'restored/build/report.json').read_text('utf-8'))
V=json.loads((BASE/'restored/review/completed.json').read_text('utf-8'))
S=json.loads((BASE/'scope/l1-pilot.json').read_text('utf-8'))
SNAP=json.loads((BASE/'restored/build/snapshot.json').read_text('utf-8'))

class TestNoShellOrPrematureRelease(unittest.TestCase):
    def test_complete_scoped_candidate(self):
        certificate=evaluate(R,V,S,SNAP)
        self.assertEqual(certificate['status'],'L1_SCOPED_CANDIDATE_COMPLETE')
        self.assertEqual(certificate['production_release'],'NOT_AUTHORIZED')
    def test_snapshot_tampering_rejected(self):
        snap=copy.deepcopy(SNAP)
        snap['body']['records'][0]['labels']['ru']='Подмена'
        with self.assertRaises(ValueError):evaluate(R,V,S,snap)
    def test_unchecked_edges_rejected(self):
        reviews=copy.deepcopy(V)
        reviews[0]['edge_checks'].pop()
        with self.assertRaises(ValueError):evaluate(R,reviews,S,SNAP)
    def test_all_invalid_mutations_rejected(self):
        modifications=[
          lambda r,v,s: r['tests'].__setitem__('skipped',1),
          lambda r,v,s: r['tests'].__setitem__('errors',1),
          lambda r,v,s: s.__setitem__('snapshot_sha256','stale'),
          lambda r,v,s: r['packages'][0].__setitem__('bytes',100),
          lambda r,v,s: r['packages'][0].__setitem__('records',0),
          lambda r,v,s: s.__setitem__('use_cases',[]),
          lambda r,v,s: s.__setitem__('production_ready',True),
          lambda r,v,s: v[0].__setitem__('snapshot_sha256','stale'),
          lambda r,v,s: v[1].__setitem__('evidence_class','synthetic_test'),
          lambda r,v,s: v[2]['records'].pop(),
          lambda r,v,s: v[0]['records'][0].__setitem__('basis','ok'),
          lambda r,v,s: r['reviews'].__setitem__('findings',[{'id':'unresolved'}]),
          lambda r,v,s: s['review_claims'].__setitem__('utility','UNKNOWN'),
          lambda r,v,s: r['reviews'].__setitem__('independence_attested',True),
          lambda r,v,s: s.__setitem__('claim','agent_executable'),
          lambda r,v,s: r.__setitem__('network_calls',1),
          lambda r,v,s: s['use_cases'][0].__setitem__('evidence_file','../../secret'),
          lambda r,v,s: (s.__setitem__('claim','agent_recipe_candidate'),s.__setitem__('agent_execution_claim',True)),
          lambda r,v,s: r.__setitem__('deterministic_rebuild','UNKNOWN'),
          lambda r,v,s: v[0]['edge_checks'].pop(),
          lambda r,v,s: s.__setitem__('out_of_scope',[]),
          lambda r,v,s: r.__setitem__('release_authorized',True)
        ]
        for i,mutate in enumerate(modifications):
            with self.subTest(i=i):
                r,v,s=copy.deepcopy(R),copy.deepcopy(V),copy.deepcopy(S)
                mutate(r,v,s)
                with self.assertRaises(ValueError):evaluate(r,v,s,SNAP)
if __name__=='__main__': unittest.main()
