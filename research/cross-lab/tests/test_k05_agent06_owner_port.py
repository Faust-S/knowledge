"""Contract qualification with mock owner ports; NO private Agent code/data."""
import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from k05_agent06_effectiveness import K05EffectivenessHold
from k05_agent06_owner_port import (
    read_agent_accepted_task, read_agent_execution_receipts,
    read_agent_task_execution_history, observe_accepted_agent_run,
)
from test_k05_agent06_effectiveness import fixture, TASK, RESULT, digest

REVIEW = hashlib.sha256(b"owner canonical JSON review").hexdigest()
ACC = hashlib.sha256(b"owner canonical JSON accepted").hexdigest()
PLAN = hashlib.sha256(b"owner canonical JSON plan").hexdigest()
PROFILE = "IWXA_CANONICAL_JSON_SHA256_V1"


def typed(kind, id_value, digest):
    return {
        "schema_version": "0.5", "ref_kind": kind, "ref_id": id_value,
        "digest_sha256": digest, "digest_profile": PROFILE,
    }


class FakeTaskCell:
    """The real TaskCell performs _verify_state_artifacts, this fake does NOT."""
    def __init__(self):
        self.calls = []
        self.task = {"task_id": "TASK-K05"}
        self.state = {
            "task_id": "TASK-K05", "task_digest": TASK, "status": "closed",
            "state_digest": hashlib.sha256(b"immutable closed State").hexdigest(),
            "result_ref": typed("result", "RES-K05", RESULT),
            "review_ref": typed("review", "REV-K05", REVIEW),
            "accepted_artifact_ref": typed("accepted_artifact", "ACC-K05", ACC),
        }
        self.accepted = {
            "acceptance_kind": "HUMAN_ACCEPTED_DRAFT",
            "accepted_artifact_id": "ACC-K05", "artifact_digest": ACC,
            "task_ref": typed("task", "TASK-K05", TASK),
            "result_ref": self.state["result_ref"],
            "review_ref": self.state["review_ref"],
        }

    def read_task(self, task_id):
        self.calls.append("read_task")
        return {"task": self.task, "state": self.state,
                "task_path": "opaque-agent-owner-task-path"}

    def task_digest(self, path):
        self.calls.append("task_digest")
        return TASK

    def accepted_artifact(self, task_id):
        self.calls.append("accepted_artifact")
        return self.accepted


class FakeToolRuntime:
    def __init__(self):
        self.calls = []
        self.plan = {
            "plan_id": "TPLAN-k05", "plan_digest": PLAN,
            "schema_version": "1.0.0",
            "plan_contract": "PA.CONTRACT.TOOL_PLANNING@1.0.0",
            "task_ref": typed("task", "TASK-K05", TASK),
            "accepted_artifact_ref": typed("accepted_artifact", "ACC-K05", ACC),
            "tool_id": "builtin.file_write", "tool_descriptor_digest": "a"*64,
            "provider_slot": "test", "provider_id": "owner", "provider_binding_digest": "b"*64,
            "idempotency_key": "IWXA-TIDK-" + "c"*40,
        }
        self.receipt = {
            "schema_version": "1.0.0",
            "execution_contract": "PA.CONTRACT.TOOL_EXECUTION@1.0.0",
            "receipt_id": "TXR-k05",
            "plan_ref": {"kind": "tool_execution_plan",
                         "ref_id": "TPLAN-k05", "digest_sha256": PLAN},
            "approval_ref": typed("approval", "TEAPR-k05", digest(b"approval")),
            "receipt_digest": digest(b"receipt"),
            "status": "SUCCEEDED", "contract_state": "SUCCEEDED",
            "external_effect_state": "ACKNOWLEDGED",
            "started_at": "2026-11-15T10:30:00.123456+00:00",
            "finished_at": "2026-11-15T10:30:01.624789+00:00",
            **{key: self.plan[key] for key in (
                "tool_id", "tool_descriptor_digest", "provider_slot",
                "provider_id", "provider_binding_digest", "idempotency_key")},
        }

    def read_execution_receipt(self, rid):
        self.calls.append("receipt")
        return self.receipt

    def read_execution_plan(self, planid):
        self.calls.append("plan")
        return self.plan

    def task_execution_history(self, task_id, task_digest):
        self.calls.append("history")
        return ([self.plan], [self.receipt])

    def execution_states_for_plans(self, plans):
        self.calls.append("states")
        return {"TPLAN-k05": {"state": "SUCCEEDED", "receipt_id": "TXR-k05"}}

    def execute(self, *_args, **_kwargs):
        raise AssertionError("No execute in K05")

    def read(self, *_args, **_kwargs):
        raise AssertionError("No tool reinvocation in K05")


class K05OwnerAdapterTests(unittest.TestCase):
    def test_agent_real_port_contract_accepted_draft_not_external_success(self):
        fake = FakeTaskCell()
        witness = read_agent_accepted_task(fake, "TASK-K05")
        self.assertEqual(witness["result_record_sha256"], RESULT)
        self.assertEqual(witness["status"], "HUMAN_ACCEPTED_DRAFT_OWNER_PORT")
        self.assertEqual(witness["external_effect_status"], "NOT_VERIFIED")
        self.assertEqual(fake.calls, ["read_task", "task_digest", "accepted_artifact",
                                      "read_task", "task_digest"])
        encoded = json.dumps(witness)
        self.assertNotIn("TASK-K05", encoded)
        self.assertNotIn("RES-K05", encoded)

    def test_actual_source_observation_joins_agent_canonical_result_record(self):
        t = fixture("AgentRun")
        observed = observe_accepted_agent_run(
            t[0], task_cell=FakeTaskCell(), task_id="TASK-K05",
            source_bytes=t[1], owner_verify=t[2],
        )
        self.assertEqual(observed["status"], "ACCEPTED_DRAFT_SOURCE_BOUND")
        self.assertEqual(observed["effectiveness"]["acceptance"], "ACCEPTED")
        self.assertEqual(observed["external_effect_status"], "NOT_VERIFIED")
        self.assertEqual(observed["effectiveness"]["metrics"]["actual_cost_minor"], 400)

    def test_result_json_digest_not_interchangeable_with_full_text_hash(self):
        t = fixture("AgentRun")
        fake = FakeTaskCell()
        fake.state["result_ref"] = typed(
            "result", "RES-K05", hashlib.sha256(b"full text from graph").hexdigest())
        fake.accepted["result_ref"] = fake.state["result_ref"]
        with self.assertRaisesRegex(K05EffectivenessHold, "RUN_OWNER_TASK_RESULT_MISMATCH"):
            observe_accepted_agent_run(
                t[0], task_cell=fake, task_id="TASK-K05",
                source_bytes=t[1], owner_verify=t[2],
            )

    def test_rejected_open_and_forged_acceptance_hold(self):
        fake = FakeTaskCell()
        fake.state["status"] = "result_imported"
        with self.assertRaisesRegex(K05EffectivenessHold, "TASK_NOT_ACCEPTED"):
            read_agent_accepted_task(fake, "TASK-K05")
        fake = FakeTaskCell()
        fake.accepted["review_ref"] = typed("review", "REV-FORGED", REVIEW)
        with self.assertRaisesRegex(K05EffectivenessHold, "ACCEPTED_ARTIFACT_RELATIONS_CHANGED"):
            read_agent_accepted_task(fake, "TASK-K05")
        fake = FakeTaskCell()
        fake.state["task_digest"] = "0" * 64
        with self.assertRaisesRegex(K05EffectivenessHold, "TASK_DIGEST_MISMATCH"):
            read_agent_accepted_task(fake, "TASK-K05")

    def test_unverified_accepted_artifact_and_mismatched_result_hold(self):
        fake = FakeTaskCell()
        fake.accepted["artifact_digest"] = "f"*64
        with self.assertRaisesRegex(K05EffectivenessHold, "ACCEPTED_ARTIFACT_INVALID"):
            read_agent_accepted_task(fake, "TASK-K05")
        fake = FakeTaskCell()
        fake.accepted["result_ref"] = typed("result", "RES-DIFFERENT", RESULT)
        with self.assertRaisesRegex(K05EffectivenessHold, "ACCEPTED_ARTIFACT_RELATIONS_CHANGED"):
            read_agent_accepted_task(fake, "TASK-K05")

    def test_original_receipt_plan_task_and_accepted_artifact_binding(self):
        witness = read_agent_accepted_task(FakeTaskCell(), "TASK-K05")
        tool = FakeToolRuntime()
        data = read_agent_execution_receipts(task_cell=FakeTaskCell(), task_id="TASK-K05", tool_runtime=tool,
                                             receipt_ids=["TXR-k05"])
        self.assertEqual(data["receipt_count"], 1)
        self.assertEqual(data["succeeded"], 1)
        self.assertEqual(data["effect_acknowledged"], 1)
        self.assertEqual(data["sum_receipt_duration_us"], 1501333)
        self.assertEqual(data["sum_receipt_duration_ms"], "1501.333")
        self.assertEqual(data["accepted_business_result"], "NOT_VERIFIED")
        self.assertIsNone(data["retry_count"])
        self.assertEqual(data["retry_status"],
                         "UNKNOWN_WITHOUT_ORIGINAL_ATTEMPT_EVIDENCE")
        self.assertEqual(tool.calls, ["receipt", "plan"])

    def test_receipt_foreign_task_or_plan_or_provenance_rejected(self):
        witness = read_agent_accepted_task(FakeTaskCell(), "TASK-K05")
        for mutation, code in [
            (lambda t: t.plan["task_ref"].update(digest_sha256="f"*64), "TYPED_REF_DIGEST_MISMATCH"),
            (lambda t: t.plan.update(plan_digest="c"*64), "EXECUTION_PLAN_DIGEST_MISMATCH"),
            (lambda t: t.plan.update(task_ref=typed("task","TASK-OTHER",TASK)),
             "EXECUTION_TASK_ID_MISMATCH"),
            (lambda t: t.plan.update(accepted_artifact_ref=typed("accepted_artifact","ACC-OTHER",ACC)),
             "EXECUTION_ACCEPTED_ID_MISMATCH"),
            (lambda t: t.plan.update(accepted_artifact_ref=typed("accepted_artifact","ACC-OTHER","d"*64)),
             "TYPED_REF_DIGEST_MISMATCH"),
            (lambda t: t.receipt.update(idempotency_key="IWXA-TIDK-"+"0"*40),
             "EXECUTION_PLAN_RECEIPT_MISMATCH"),
            (lambda t: t.receipt.update(started_at="2026-11-16T01:00:00+00:00"),
             "RECEIPT_TIME_ORDER_INVALID"),
        ]:
            with self.subTest(code=code):
                tool = FakeToolRuntime()
                mutation(tool)
                with self.assertRaisesRegex(K05EffectivenessHold, code):
                    read_agent_execution_receipts(task_cell=FakeTaskCell(), task_id="TASK-K05", tool_runtime=tool,
                                                 receipt_ids=["TXR-k05"])

    def test_effect_unknown_not_business_success(self):
        witness = read_agent_accepted_task(FakeTaskCell(), "TASK-K05")
        tool = FakeToolRuntime()
        tool.receipt["status"] = "INPUT_REQUIRED"
        tool.receipt["external_effect_state"] = "UNKNOWN"
        tool.receipt["contract_state"] = "UNKNOWN_RECONCILIATION_REQUIRED"
        data = read_agent_execution_receipts(task_cell=FakeTaskCell(), task_id="TASK-K05", tool_runtime=tool,
                                             receipt_ids=["TXR-k05"])
        self.assertEqual(data["succeeded"], 0)
        self.assertEqual(data["effect_unknown"], 1)
        self.assertEqual(data["input_required"], 1)
        self.assertEqual(data["accepted_business_result"], "NOT_VERIFIED")

    def test_duplicate_and_unlinked_read_receipts_not_promoted(self):
        witness = read_agent_accepted_task(FakeTaskCell(), "TASK-K05")
        tool = FakeToolRuntime()
        with self.assertRaisesRegex(K05EffectivenessHold,"RECEIPT_IDS_INVALID"):
            read_agent_execution_receipts(task_cell=FakeTaskCell(), task_id="TASK-K05", tool_runtime=tool,
                                         receipt_ids=["TXR-k05","TXR-k05"])
        with self.assertRaisesRegex(K05EffectivenessHold,"RECEIPT_IDS_INVALID"):
            read_agent_execution_receipts(task_cell=FakeTaskCell(), task_id="TASK-K05", tool_runtime=tool,
                                         receipt_ids=["TRR-k05"])
        self.assertEqual(tool.calls, [])

    def test_k05_does_not_accept_unsupported_owner_port(self):
        with self.assertRaisesRegex(K05EffectivenessHold,"TASK_OWNER_PORT_REQUIRED"):
            read_agent_accepted_task(object(), "TASK-K05")
        with self.assertRaisesRegex(K05EffectivenessHold,"TASK_ID_INVALID"):
            read_agent_accepted_task(FakeTaskCell(), "../TASK-K05")

    def test_owner_state_advances_during_acceptance_readback_hold(self):
        class RacyTaskCell(FakeTaskCell):
            def accepted_artifact(self, task_id):
                accepted = super().accepted_artifact(task_id)
                self.state = {
                    **self.state,
                    "state_digest": hashlib.sha256(b"changed State").hexdigest(),
                }
                return accepted
        with self.assertRaisesRegex(
            K05EffectivenessHold, "TASK_CHANGED_DURING_OWNER_READBACK"
        ):
            read_agent_accepted_task(RacyTaskCell(), "TASK-K05")

    def test_owner_task_payload_changes_during_readback_hold(self):
        class MutatedTaskCell(FakeTaskCell):
            def task_digest(self, path):
                self.calls.append("task_digest")
                if self.calls.count("task_digest") > 1:
                    return hashlib.sha256(b"mutated Task record").hexdigest()
                return TASK
        with self.assertRaisesRegex(
            K05EffectivenessHold, "TASK_CHANGED_DURING_OWNER_READBACK"
        ):
            read_agent_accepted_task(MutatedTaskCell(), "TASK-K05")

    def test_idempotency_collision_is_not_claimed_as_an_execution_retry(self):
        class ReplayedReceipt(FakeToolRuntime):
            def read_execution_receipt(self, rid):
                self.calls.append("receipt")
                return {**self.receipt, "receipt_id": rid}
        tool = ReplayedReceipt()
        data = read_agent_execution_receipts(
            task_cell=FakeTaskCell(), task_id="TASK-K05", tool_runtime=tool,
            receipt_ids=["TXR-k05", "TXR-k05b"])
        self.assertEqual(data["receipt_count"], 2)
        self.assertEqual(data["same_idempotency_key_additional_receipts"], 1)
        self.assertIsNone(data["retry_count"])
        self.assertEqual(data["retry_status"],
                         "UNKNOWN_WITHOUT_ORIGINAL_ATTEMPT_EVIDENCE")


    def test_original_v1_receipt_plan_ref_and_contract_states(self):
        tool = FakeToolRuntime()
        result = read_agent_execution_receipts(
            task_cell=FakeTaskCell(), task_id="TASK-K05",
            tool_runtime=tool, receipt_ids=["TXR-k05"])
        self.assertEqual(result["contract_succeeded"], 1)
        self.assertEqual(result["contract_outcome_unknown"], 0)
        self.assertEqual(result["receipt_list_completeness"],
                         "NOT_ATTESTED_USE_TASK_EXECUTION_HISTORY")
        self.assertEqual(result["sum_receipt_duration_us"], 1501333)

    def test_legacy_receipt_format_cannot_masquerade_as_original_v1(self):
        tool = FakeToolRuntime()
        tool.receipt.pop("plan_ref")
        tool.receipt["plan_id"] = "TPLAN-k05"
        tool.receipt["plan_digest"] = PLAN
        tool.receipt["schema_version"] = "0.12"
        with self.assertRaisesRegex(K05EffectivenessHold,
                                    "EXECUTION_RECEIPT_INVALID"):
            read_agent_execution_receipts(
                task_cell=FakeTaskCell(), task_id="TASK-K05",
                tool_runtime=tool, receipt_ids=["TXR-k05"])

    def test_receipt_plan_ref_tamper_and_contract_state_hold(self):
        for change, expected in (
            (lambda t: t.receipt["plan_ref"].update(digest_sha256="f"*64),
             "EXECUTION_PLAN_DIGEST_MISMATCH"),
            (lambda t: t.receipt["plan_ref"].update(kind="other"),
             "EXECUTION_PLAN_REF_INVALID"),
            (lambda t: t.receipt.update(contract_state="FAILED_KNOWN"),
             "EXECUTION_STATE_INCONSISTENT"),
            (lambda t: t.receipt.pop("approval_ref"),
             "TYPED_REF_INVALID"),
        ):
            with self.subTest(expected=expected):
                tool=FakeToolRuntime()
                change(tool)
                with self.assertRaisesRegex(K05EffectivenessHold,expected):
                    read_agent_execution_receipts(
                        task_cell=FakeTaskCell(), task_id="TASK-K05",
                        tool_runtime=tool, receipt_ids=["TXR-k05"])

    def test_history_uses_original_owner_without_manual_receipt_ids(self):
        tool=FakeToolRuntime()
        row=read_agent_task_execution_history(
            task_cell=FakeTaskCell(), task_id="TASK-K05",
            tool_runtime=tool)
        self.assertEqual(row["plan_count"],1)
        self.assertEqual(row["execution_receipts"]["receipt_count"],1)
        self.assertEqual(row["plan_states"]["succeeded"],1)
        self.assertEqual(row["uncertain_execution_plan_count"],0)
        self.assertEqual(row["receipt_list_completeness"],
                         "FULL_OWNER_TASK_HISTORY_SNAPSHOT")
        self.assertEqual(row["status"],
                         "OWNER_HISTORY_STABLE_READBACK_NOT_COLD_VERIFIED")
        self.assertIn("history",tool.calls)
        self.assertIn("states",tool.calls)

    def test_no_receipt_with_unresolved_intent_is_not_no_attempt(self):
        class OrphanIntent(FakeToolRuntime):
            def task_execution_history(self, tid, digest_value):
                self.calls.append("history")
                return ([self.plan], [])
            def execution_states_for_plans(self, plans):
                self.calls.append("states")
                return {"TPLAN-k05": {"state":"OUTCOME_UNKNOWN","receipt_id":None}}
        result=read_agent_task_execution_history(
            task_cell=FakeTaskCell(),task_id="TASK-K05",
            tool_runtime=OrphanIntent())
        self.assertEqual(result["execution_receipts"]["receipt_count"],0)
        self.assertEqual(result["uncertain_execution_plan_count"],1)
        self.assertFalse(result["business_effect_verified"])

    def test_foreign_receipt_in_task_history_is_rejected(self):
        class ForeignReceipt(FakeToolRuntime):
            def task_execution_history(self,tid,digest_value):
                self.calls.append("history")
                return ([self.plan],[{
                    **self.receipt,
                    "plan_ref":{"kind":"tool_execution_plan",
                                "ref_id":"TPLAN-foreign",
                                "digest_sha256":PLAN},
                }])
        with self.assertRaisesRegex(
            K05EffectivenessHold,"TASK_HISTORY_RECEIPT_FOREIGN_PLAN"):
            read_agent_task_execution_history(
                task_cell=FakeTaskCell(),task_id="TASK-K05",
                tool_runtime=ForeignReceipt())

    def test_history_changed_mid_scan_holds(self):
        class RacingTool(FakeToolRuntime):
            def task_execution_history(self,tid,digest_value):
                self.calls.append("history")
                if self.calls.count("history")>1:
                    other={**self.receipt,
                           "receipt_id":"TXR-new",
                           "receipt_digest":digest(b"new receipt")}
                    return ([self.plan],[self.receipt,other])
                return ([self.plan],[self.receipt])
        with self.assertRaisesRegex(
            K05EffectivenessHold,"TASK_EXECUTION_HISTORY_CHANGED_DURING_READBACK"):
            read_agent_task_execution_history(
                task_cell=FakeTaskCell(),task_id="TASK-K05",
                tool_runtime=RacingTool())



    def test_history_states_cannot_claim_not_started_with_receipt(self):
        class WrongNoAttempt(FakeToolRuntime):
            def execution_states_for_plans(self, plans):
                self.calls.append("states")
                return {"TPLAN-k05": {"state":"NOT_STARTED", "receipt_id":None}}
        with self.assertRaisesRegex(
            K05EffectivenessHold, "TASK_HISTORY_STATE_CONTRADICTS_RECEIPTS"):
            read_agent_task_execution_history(
                task_cell=FakeTaskCell(), task_id="TASK-K05",
                tool_runtime=WrongNoAttempt())

    def test_history_states_cannot_claim_success_without_txr(self):
        class WrongSuccess(FakeToolRuntime):
            def task_execution_history(self, tid, task_digest):
                self.calls.append("history")
                return ([self.plan], [])
            def execution_states_for_plans(self, plans):
                self.calls.append("states")
                return {"TPLAN-k05": {"state":"SUCCEEDED", "receipt_id":None}}
        with self.assertRaisesRegex(
            K05EffectivenessHold, "TASK_HISTORY_STATE_CONTRADICTS_RECEIPTS"):
            read_agent_task_execution_history(
                task_cell=FakeTaskCell(), task_id="TASK-K05",
                tool_runtime=WrongSuccess())

    def test_execution_intent_state_change_with_stable_history_hold(self):
        class RacingIntents(FakeToolRuntime):
            def execution_states_for_plans(self, plans):
                self.calls.append("states")
                if self.calls.count("states") == 1:
                    return {"TPLAN-k05": {
                        "state":"SUCCEEDED", "receipt_id":"TXR-k05"}}
                return {"TPLAN-k05": {
                    "state":"OUTCOME_UNKNOWN", "receipt_id":"TXR-k05"}}
        with self.assertRaisesRegex(
            K05EffectivenessHold, "TASK_EXECUTION_INTENT_STATE_CHANGED"):
            read_agent_task_execution_history(
                task_cell=FakeTaskCell(), task_id="TASK-K05",
                tool_runtime=RacingIntents())


if __name__ == "__main__":
    unittest.main()
