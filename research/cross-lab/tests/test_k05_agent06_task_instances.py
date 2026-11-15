"""K05 distinct Agent Task instances: original identities, verified equivalence.

Public synthetic evidence/ports only. This is not a real installed Agent run.
"""
import hashlib
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from k05_agent06_admission import compare_verified_task_runs
from k05_agent06_effectiveness import K05EffectivenessHold
from k05_agent06_owner_port import compare_two_agent_accepted_task_instances
from test_k05_agent06_effectiveness import fixture, TASK, RESULT, COHORT, INPUT, digest
from test_k05_agent06_admission import joined
from test_k05_agent06_owner_port import typed, FakeTaskCell, REVIEW


def distinct_run(label, *, elapsed, human, cost, accepted=True):
    run, source, verify, proofs = fixture(
        label, elapsed=elapsed, human=human, cost=cost, accepted=accepted)
    run["task_sha256"] = digest(("canonical task record:" + label).encode())
    run["result_sha256"] = digest(("canonical Result record:" + label).encode())
    for proof in proofs.values():
        if proof.get("task_sha256") == TASK:
            proof["task_sha256"] = run["task_sha256"]
        if proof.get("result_sha256") == RESULT:
            proof["result_sha256"] = run["result_sha256"]
    return run, source, verify, proofs


def verified_pair(accepted_a=True, accepted_b=True):
    a = distinct_run("AgentExecutorOne", elapsed=7000, human=1000,
                     cost=700, accepted=accepted_a)
    b = distinct_run("AgentExecutorTwo", elapsed=4000, human=700,
                     cost=500, accepted=accepted_b)
    source, verifier, proofs = joined(a,b)
    evidence = {
        "ref":"TaskDefinitionComparison",
        "kind":"TASK_EQUIVALENCE",
        "sha256":digest(b"owner-only verified independent Task definition comparison"),
    }
    source[evidence["ref"]] = b"owner-only verified independent Task definition comparison"
    proofs[evidence["ref"]] = {
        "verified":True, "kind":"TASK_EQUIVALENCE",
        "source_sha256":evidence["sha256"],
        "epistemic_status":"OBSERVED", "status":"OBSERVED",
        "task_sha256":None, "result_sha256":None,
        "values":{
            "purpose":"EXECUTOR_TASK_INSTANCE_COMPARISON",
            "owner_contract":"PA.CONTRACT.TASK/1.0.0",
            "baseline_task_sha256":a[0]["task_sha256"],
            "alternative_task_sha256":b[0]["task_sha256"],
            "input_sha256":INPUT,
            "cohort_sha256":COHORT,
            "original_task_readback":True,
            "equal_goal":True,
            "equal_expected_result":True,
            "equal_acceptance_criteria":True,
            "equal_constraints":True,
            "equal_execution_permissions":True,
            "equal_source_revision":True,
        },
    }
    return a, b, source, verifier, proofs, evidence


class IndependentOwnerTaskCell:
    """Mock original TaskCell contract only; not a Core replacement."""
    def __init__(self, runs):
        self.by_id = {}
        self.by_path = {}
        self.calls = []
        for task_id, run in runs:
            fake = FakeTaskCell()
            task_hash = run["task_sha256"]
            result_hash = run["result_sha256"]
            artifact_id = "ACC-" + task_id
            artifact_digest = digest(("canonical accepted:" + task_id).encode())
            fake.task = {"task_id": task_id}
            fake.state = {
                "task_id": task_id,
                "status":"closed",
                "task_digest":task_hash,
                "state_digest": digest(("state:" + task_id).encode()),
                "result_ref": typed("result", "RES-" + task_id, result_hash),
                "review_ref": typed("review", "REV-" + task_id, REVIEW),
                "accepted_artifact_ref":typed("accepted_artifact",artifact_id,artifact_digest),
            }
            fake.accepted = {
                "acceptance_kind":"HUMAN_ACCEPTED_DRAFT",
                "accepted_artifact_id":artifact_id,
                "artifact_digest":artifact_digest,
                "task_ref":typed("task",task_id,task_hash),
                "result_ref":fake.state["result_ref"],
                "review_ref":fake.state["review_ref"],
            }
            path = "opaque-owner/" + task_id + ".json"
            self.by_id[task_id] = (fake,path)
            self.by_path[path] = task_hash

    def read_task(self, task_id):
        self.calls.append(("read_task",task_id))
        fake, path = self.by_id[task_id]
        return {"task":fake.task,"state":fake.state,"task_path":path}

    def task_digest(self, task_path):
        self.calls.append(("task_digest",task_path))
        return self.by_path[task_path]

    def accepted_artifact(self, task_id):
        self.calls.append(("accepted_artifact",task_id))
        return self.by_id[task_id][0].accepted


class TwoTaskInstanceTests(unittest.TestCase):
    def test_separately_created_Task_records_are_not_same_sha(self):
        a,b,source,verifier,proofs,evidence = verified_pair()
        self.assertNotEqual(a[0]["task_sha256"],b[0]["task_sha256"])
        self.assertNotEqual(a[0]["result_sha256"],b[0]["result_sha256"])
        no_proof = compare_verified_task_runs(
            a[0],b[0],source_bytes=source,owner_verify=verifier)
        self.assertEqual(no_proof["comparison"]["status"],"NOT_COMPARABLE")
        self.assertEqual(no_proof["accepted_result_comparison_status"],"NOT_MEASURABLE")
        self.assertIsNone(no_proof["comparison"]["metric_deltas_alternative_minus_baseline"]["actual_cost_minor"])

    def test_owner_verified_equivalent_Task_instances_compare_without_relabel(self):
        a,b,source,verifier,proofs,evidence = verified_pair()
        result=compare_verified_task_runs(
            a[0],b[0],source_bytes=source,owner_verify=verifier,
            task_equivalence_evidence=evidence)
        self.assertEqual(result["comparison"]["status"],"SOURCE_BOUND_EQUIVALENT_DISTINCT_TASKS")
        self.assertEqual(result["comparison"]["metric_deltas_alternative_minus_baseline"]["elapsed_ms"],-3000)
        self.assertEqual(result["comparison"]["metric_deltas_alternative_minus_baseline"]["actual_cost_minor"],-200)
        self.assertEqual(result["accepted_result_comparison_status"],"TWO_HUMAN_OR_DOMAIN_ACCEPTED_RESULTS")
        self.assertTrue(result["task_identity_comparison"]["original_record_digests_preserved"])
        self.assertEqual(a[0]["task_sha256"],proofs[evidence["ref"]]["values"]["baseline_task_sha256"])
        self.assertEqual(b[0]["task_sha256"],proofs[evidence["ref"]]["values"]["alternative_task_sha256"])
        self.assertEqual(result["causal_effect"],"NOT_MEASURABLE")
        text=json.dumps(result)
        self.assertNotIn("AgentExecutorOne",text)
        self.assertNotIn("TaskDefinitionComparison",text)

    def test_not_owner_verified_if_one_criterion_changes_or_task_relabelled(self):
        for patch in (
            {"equal_acceptance_criteria":False},
            {"equal_goal":None},
            {"equal_constraints":False},
            {"equal_execution_permissions":False},
            {"equal_source_revision":False},
            {"original_task_readback":False},
            {"baseline_task_sha256":"f"*64},
            {"alternative_task_sha256":"f"*64},
            {"purpose":"RANK_PROSE"},
        ):
            with self.subTest(patch=patch):
                a,b,source,verifier,proofs,evidence=verified_pair()
                proofs[evidence["ref"]]["values"].update(patch)
                with self.assertRaisesRegex(K05EffectivenessHold,
                                            "TASK_EQUIVALENCE_NOT_OWNER_VERIFIED"):
                    compare_verified_task_runs(
                        a[0],b[0],source_bytes=source,owner_verify=verifier,
                        task_equivalence_evidence=evidence)

    def test_different_inputs_cannot_be_overridden_by_owner_assertion(self):
        a,b,source,verifier,proofs,evidence=verified_pair()
        b[0]["input_sha256"] = "a"*64
        with self.assertRaisesRegex(K05EffectivenessHold,"TASK_PAIR_INPUT_MISMATCH"):
            compare_verified_task_runs(a[0],b[0],source_bytes=source,
                                       owner_verify=verifier,
                                       task_equivalence_evidence=evidence)

    def test_changed_equivalence_evidence_bytes_cause_hold(self):
        a,b,source,verifier,proofs,evidence=verified_pair()
        source[evidence["ref"]] = b"tampered"
        with self.assertRaisesRegex(K05EffectivenessHold,"SOURCE_BYTES_MISMATCH"):
            compare_verified_task_runs(a[0],b[0],source_bytes=source,
                                       owner_verify=verifier,
                                       task_equivalence_evidence=evidence)

    def test_rejected_alternative_is_not_two_accepted_results(self):
        a,b,source,verifier,proofs,evidence=verified_pair(accepted_b=False)
        r=compare_verified_task_runs(a[0],b[0],source_bytes=source,
                                     owner_verify=verifier,
                                     task_equivalence_evidence=evidence)
        self.assertEqual(r["comparison"]["acceptance"],["ACCEPTED","REJECTED"])
        self.assertEqual(r["accepted_result_comparison_status"],"NOT_MEASURABLE")

    def test_agent_owner_port_replays_both_accepted_task_chains(self):
        a,b,source,verifier,proofs,evidence=verified_pair()
        task_cell=IndependentOwnerTaskCell([
            ("TASK-EXEC-ONE",a[0]),("TASK-EXEC-TWO",b[0]),
        ])
        r=compare_two_agent_accepted_task_instances(
            a[0],b[0],task_cell=task_cell,
            baseline_task_id="TASK-EXEC-ONE",
            alternative_task_id="TASK-EXEC-TWO",
            source_bytes=source, owner_verify=verifier,
            task_equivalence_evidence=evidence)
        self.assertEqual(r["status"],"TWO_ACCEPTED_TASKS_SOURCE_COMPARABLE")
        self.assertEqual(r["comparison"]["comparison"]["status"],
                         "SOURCE_BOUND_EQUIVALENT_DISTINCT_TASKS")
        self.assertEqual(r["effects_readback"],"NOT_VERIFIED")
        self.assertEqual(r["installed_agent_qualification"],
                         "NOT_TESTED_WITH_ORIGINAL_AGENT")
        self.assertTrue(sum(x[0]=="read_task" for x in task_cell.calls) >= 4)

    def test_agent_owner_port_requires_two_distinct_user_tasks(self):
        a,b,source,verifier,proofs,evidence=verified_pair()
        task_cell=IndependentOwnerTaskCell([("TASK-EXEC-ONE",a[0])])
        with self.assertRaisesRegex(K05EffectivenessHold,
                                    "TWO_DISTINCT_TASK_IDS_REQUIRED"):
            compare_two_agent_accepted_task_instances(
                a[0],b[0],task_cell=task_cell,
                baseline_task_id="TASK-EXEC-ONE",
                alternative_task_id="TASK-EXEC-ONE",
                source_bytes=source,owner_verify=verifier,
                task_equivalence_evidence=evidence)

    def test_unnecessary_equivalence_source_for_same_Task_hold(self):
        a,b,source,verifier,proofs,evidence=verified_pair()
        b[0]["task_sha256"]=a[0]["task_sha256"]
        # An equivalence pin must never be used to launder a record identity.
        for proof in proofs.values():
            if proof.get("task_sha256") == digest(
                    b"canonical task record:AgentExecutorTwo"):
                proof["task_sha256"] = b[0]["task_sha256"]
        with self.assertRaisesRegex(K05EffectivenessHold,
                                    "UNNECESSARY_TASK_EQUIVALENCE"):
            compare_verified_task_runs(
                a[0],b[0],source_bytes=source,owner_verify=verifier,
                task_equivalence_evidence=evidence)


if __name__=="__main__":
    unittest.main()
