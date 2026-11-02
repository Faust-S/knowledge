import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"tools"))
import registry

class RegistryGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog=registry.load_catalog()
    def test_four_real_upstreams(self):
        self.assertEqual({x["id"] for x in self.catalog},{"goose","aider","openhands","cline"})
        self.assertTrue(all(x["verification"]["status"]=="SOURCE_SCREENED" for x in self.catalog))
    def test_no_fabricated_verified_agents(self):
        self.assertEqual(registry.index(self.catalog)["verified_count"],0)
    def test_goose_is_proposal_only_and_nonprivate(self):
        goose=next(x for x in self.catalog if x["id"]=="goose")
        self.assertEqual(goose["iwxa"]["integration"],"SOURCE_OBSERVED_PROPOSAL_ONLY")
        self.assertNotIn("PRIVATE",goose["iwxa"]["currently_allowed_privacy"])
        self.assertFalse(goose["iwxa"]["tool_execution_verified"])
    def test_unqualified_promotions_rejected(self):
        stages=["TASK_TESTED","IWXA_VERIFIED"]
        row=self.catalog[0]
        for stage in stages:
            with self.subTest(stage=stage):
                x=copy.deepcopy(row);x["verification"]["status"]=stage
                with self.assertRaises(ValueError):registry.validate(x)
    def test_mutated_origin_license_and_kind_rejected(self):
        cases=[
            ("kind","prompt_collection"),
            ("source.commit","HEAD"),
            ("source.license","UNKNOWN"),
            ("source.license_file","../../secret"),
            ("source.readme_blob","f"*10),
            ("iwxa.integration","REAL_INTEGRATION_TESTED"),
            ("iwxa.tool_execution_verified",True),
            ("verification.verified_functions",["works fine"]),
            ("verification.trial_receipts",[{"status":"PASS"}]),
        ]
        for key,value in cases:
            with self.subTest(key=key):
                row=copy.deepcopy(self.catalog[0])
                t=row
                parts=key.split(".")
                for part in parts[:-1]:t=t[part]
                t[parts[-1]]=value
                with self.assertRaises(ValueError):registry.validate(row)
    def test_goose_cannot_escalate_private(self):
        row=copy.deepcopy(next(x for x in self.catalog if x["id"]=="goose"))
        row["iwxa"]["currently_allowed_privacy"].append("PRIVATE")
        with self.assertRaisesRegex(ValueError,"FALSE_PROPOSAL_AUTHORITY"):registry.validate(row)
    def test_agent_trial_plan_not_executed(self):
        p=registry.read_json(ROOT/"plans/goose-v1.json")
        self.assertEqual(p["status"],"PLANNED_NOT_EXECUTED")
        self.assertFalse(p["test_receipts"])
        self.assertTrue(all(x["result"]=="NOT_RUN" for x in p["positive"]+p["negative"]))
    def test_registry_index_not_runtime_registry(self):
        x=registry.index(self.catalog)
        self.assertNotIn("installed",x)
        self.assertNotIn("executable",x)
        self.assertEqual(x["count"],4)

if __name__=="__main__":unittest.main()
