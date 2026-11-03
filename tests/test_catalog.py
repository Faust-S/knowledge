import copy
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"tools"))
import check_catalog as c

class SpecializedSolutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.rows=c.scan()
    def test_only_specific_agent_solutions_not_runtime_programs(self):
        self.assertEqual(len(self.rows),3)
        self.assertEqual({x["agent_kind"] for x in self.rows},{"specialized_workflow"})
        self.assertFalse({"goose","aider","cline","openhands"} & {x["id"] for x in self.rows})
    def test_no_false_verified(self):
        self.assertTrue(all(not x["qualification"]["iwxa_verified"] and not x["installable"] for x in self.rows))
    def test_full_original_meeting_definition(self):
        r=next(x for x in self.rows if x["id"]=="meeting-followup-crewai")
        self.assertEqual(r["status"],"ADAPTED_NOT_EXECUTED")
        self.assertTrue(c.check_definition(c.load(ROOT/r["structure"]["definition_file"])))
    def test_marketplace_badge_not_verification(self):
        self.assertEqual(sum(r["status"]=="LISTING_SCREENED" for r in self.rows),2)
        self.assertFalse(any(x["source"].get("source_rights")=="REDISTRIBUTION_VERIFIED" for x in self.rows))
    def test_agent_cannot_claim_execution_via_metadata(self):
        for stage in ("TASK_TESTED","IWXA_VERIFIED"):
            with self.subTest(stage=stage):
                x=copy.deepcopy(self.rows[0]);x["status"]=stage
                with self.assertRaises(ValueError):c.check_solution(x)
    def test_incomplete_workflow_rejected(self):
        x=copy.deepcopy(self.rows[0])
        x["structure"]["process_steps"]=["one"]
        with self.assertRaisesRegex(ValueError,"NO_WORKFLOW"):c.check_solution(x)
    def test_external_approval_not_skip(self):
        d=c.load(ROOT/"solutions/meeting-followup/agent.json")
        d["state_machine"][-1]["produces"]="TASK_CREATED"
        with self.assertRaisesRegex(ValueError,"MISSING_HUMAN_REVIEW"):c.check_definition(d)
    def test_unpinned_source_rejected(self):
        x=copy.deepcopy(self.rows[0])
        x["source"]["commit"]="main"
        with self.assertRaisesRegex(ValueError,"SOURCE_NOT_PINNED"):c.check_solution(x)
    def test_runtime_app_claim_rejected(self):
        x=copy.deepcopy(self.rows[0])
        x["agent_kind"]="runtime_software"
        with self.assertRaisesRegex(ValueError,"NOT_SPECIALIZED_AGENT"):c.check_solution(x)
    def test_no_agent_becomes_installable_early(self):
        x=copy.deepcopy(self.rows[1])
        x["installable"]=True
        with self.assertRaisesRegex(ValueError,"PREMATURE_VERIFIED"):c.check_solution(x)

if __name__=="__main__":unittest.main()
