"""Open fixture verifies source attribution, not native PA/agent execution."""
import json
import unittest
from copy import deepcopy
from pathlib import Path
from tools.verify_meeting_followup import verify
P=Path(__file__).resolve().parents[1]/"research/fixtures/meeting-task-result.json"
class TestOpenTaskResultBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.f=json.loads(P.read_text(encoding="utf-8"))
    def test_sources_and_unknown(self):
        r=verify(self.f["task"]["text"],self.f["draft"])
        self.assertTrue(r["passed"],r["errors"])
        self.assertEqual(len(r["accepted"]),2)
        self.assertEqual(r["accepted"][1]["due_date"],"UNKNOWN")
    def test_no_auto_task_from_discussion(self):
        self.assertFalse(self.f["task"]["organization_assignment"])
        self.assertFalse(any("маркетинг" in x["action"].lower() for x in self.f["draft"]["action_items"]))
    def test_no_fictional_execution_or_acceptance(self):
        self.assertEqual(self.f["qualification"],"OPEN_CONTRACT_ONLY")
        self.assertEqual(self.f["agent_solution"]["catalog_status"],"ADAPTED_NOT_EXECUTED")
        self.assertFalse(self.f["agent_solution"]["runtime_executed"])
        self.assertEqual(self.f["result_provenance"]["human_review"],"NOT_PERFORMED")
        self.assertFalse(self.f["result_provenance"]["external_actions_performed"])
        self.assertFalse(self.f["result_provenance"]["durable_product_result"])
    def test_fake_owner_or_deadline(self):
        for key,bad,code in (("assignee","Иван","ITEM_0_OWNER_UNSUPPORTED"),("due_date","завтра","ITEM_0_DEADLINE_UNSUPPORTED")):
            d=deepcopy(self.f["draft"]);d["action_items"][0][key]=bad
            self.assertIn(code,verify(self.f["task"]["text"],d)["errors"])
    def test_fake_quote(self):
        d=deepcopy(self.f["draft"]);d["action_items"][0]["quote"]="Мария уже подготовила бюджет."
        self.assertIn("ITEM_0_SOURCE_SPAN_MISMATCH",verify(self.f["task"]["text"],d)["errors"])
if __name__=="__main__":unittest.main()
