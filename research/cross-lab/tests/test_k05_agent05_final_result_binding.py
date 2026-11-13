"""Source-bound full Graph Result tests; controlled fixtures, no private Agent."""
from __future__ import annotations

import hashlib
import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import k05_agent05_final_result_binding as binding
from k05_agent05_graph_readback import AgentComparisonHold, GRAPH_RUNTIME_CONTRACT
from test_k05_agent05_graph_readback import build, with_digest, to_bytes, TASK_BYTES, SOURCE_BYTES, SOURCE_REF


def final_case(run_id: str, *, text: str | None = None) -> dict:
    item = build(run_id)
    artifact = item["artifact"]
    config = item["config"]
    node_id = artifact["node_id"]
    graph = with_digest({
        "contract": GRAPH_RUNTIME_CONTRACT, "object_type": "GraphDefinition",
        "graph_id": "controlled-graph-" + run_id, "revision": 1,
        "entry_node_id": node_id, "stop_node_ids": [node_id],
        "nodes": [{"node_id": node_id, "node_type": "MODEL_INVOCATION",
                   "config_ref": artifact["config_ref"],
                   "authority_ref": "model-binding:" + "b" * 64,
                   "idempotency_required": True,
                   "external_effect_authority_granted_by_graph": False}],
        "edges": [],
        "loop_budget": {"max_iterations": 1, "max_elapsed_ms": 0,
                        "max_cost_microunits": 0, "max_tool_calls": 0},
        "control_flow_shape": "DAG", "cycle_bound": 0,
        "predecessor_goal_ref": "", "predecessor_workboard_ref": "",
        "graph_is_execution_authority": False,
        "dynamic_mutation_requires_governed_proposal": True,
        "unsafe_effect_replay_forbidden": True,
    }, "graph_digest")
    artifact["graph_digest"] = graph["graph_digest"]
    artifact["attempt"] = 1
    if text is not None:
        artifact["data"] = text
    item["artifact"] = with_digest(artifact, "artifact_digest")
    artifact = item["artifact"]
    item["run"]["model_observation"]["source_revision"] = artifact["artifact_digest"]
    event = with_digest({
        "contract": GRAPH_RUNTIME_CONTRACT, "object_type": "GraphEvent",
        "event_type": "NODE_COMPLETED", "execution_id": artifact["execution_id"],
        "node_id": node_id, "node_run_digest": artifact["node_run_digest"],
        "output_digest": artifact["artifact_digest"],
        "evidence_refs": ["graph-node-artifact:" + artifact["artifact_digest"],
                          *artifact["source_refs"]],
        "external_effect_receipt_ref": "",
        "replay_executes_external_effect": False,
    }, "event_digest")
    after = item["after"]
    after.update({
        "graph_id": graph["graph_id"], "graph_revision": graph["revision"],
        "graph_digest": graph["graph_digest"],
        "last_graph_event_digest": event["event_digest"],
    })
    item["after"] = with_digest(after, "execution_digest")
    receipt = item["receipt"]
    receipt["graph_digest"] = graph["graph_digest"]
    receipt["artifact_digest"] = artifact["artifact_digest"]
    receipt["result_execution_digest"] = item["after"]["execution_digest"]
    receipt["completion_event_digest"] = event["event_digest"]
    item["receipt"] = with_digest(receipt, "receipt_digest")
    projection = {
        "execution_id": artifact["execution_id"], "graph_id": graph["graph_id"],
        "graph_digest": graph["graph_digest"],
        "execution_digest": item["after"]["execution_digest"],
        "goal_id": "", "board_id": "",
        "node_id": node_id, "node_run_digest": artifact["node_run_digest"],
        "artifact_digest": artifact["artifact_digest"],
        "attempt": 1, "text": artifact["data"], "content_type": "text/plain",
        "execution_state": "COMPLETED",
        "source_refs": list(artifact["source_refs"]),
        "operation_ref": "", "result_is_execution_authority": False,
        "human_review_required": True,
        "model_evaluation": {"quality_status": "QUALITY_UNKNOWN"},
    }
    item["final"] = projection
    item["graph"] = graph
    item["event"] = event
    item["result"] = artifact["data"].encode("utf-8")
    item["run"]["result_sha256"] = hashlib.sha256(item["result"]).hexdigest()
    return item


def verify(item: dict, *, result_bytes: bytes | None = None):
    return binding.verify_saved_graph_final_projection(
        final_result_bytes=to_bytes(item["final"]),
        graph_bytes=to_bytes(item["graph"]),
        execution_instance_bytes=to_bytes(item["after"]),
        artifact_bytes=to_bytes(item["artifact"]),
        config_bytes=to_bytes(item["config"]),
        expected_result_text_bytes=(item["result"] if result_bytes is None
                                    else result_bytes),
    )


def compare(a: dict, b: dict, *, include_receipts: bool = True,
            baseline_result_bytes: bytes | None = None):
    return binding.compare_saved_graph_final_results(
        a["run"], b["run"],
        baseline_final_result_bytes=to_bytes(a["final"]),
        tested_final_result_bytes=to_bytes(b["final"]),
        baseline_graph_bytes=to_bytes(a["graph"]),
        tested_graph_bytes=to_bytes(b["graph"]),
        baseline_execution_instance_bytes=to_bytes(a["after"]),
        tested_execution_instance_bytes=to_bytes(b["after"]),
        baseline_artifact_bytes=to_bytes(a["artifact"]),
        tested_artifact_bytes=to_bytes(b["artifact"]),
        baseline_config_bytes=to_bytes(a["config"]),
        tested_config_bytes=to_bytes(b["config"]),
        baseline_task_bytes=TASK_BYTES, tested_task_bytes=TASK_BYTES,
        baseline_result_bytes=(a["result"] if baseline_result_bytes is None
                               else baseline_result_bytes),
        tested_result_bytes=b["result"],
        baseline_source_bytes={SOURCE_REF: SOURCE_BYTES},
        tested_source_bytes={SOURCE_REF: SOURCE_BYTES},
        **({
            "baseline_execution_receipt_bytes": to_bytes(a["receipt"]),
            "tested_execution_receipt_bytes": to_bytes(b["receipt"]),
        } if include_receipts else {}),
    )


class K05FinalResultBinding(unittest.TestCase):
    def test_full_final_result_is_bound_to_completed_graph_and_exact_text(self):
        item = final_case("baseline")
        proof = verify(item)
        self.assertEqual(proof["schema"], binding.CONTRACT)
        self.assertEqual(proof["status"], "HOST_SUPPLIED_FINAL_TEXT_AND_GRAPH_MATCH")
        self.assertEqual(proof["artifact_sha256"], item["artifact"]["artifact_digest"])
        self.assertEqual(proof["execution_sha256"], item["after"]["execution_digest"])
        self.assertEqual(proof["full_text_sha256"], hashlib.sha256(item["result"]).hexdigest())
        self.assertEqual(proof["host_reads_by_k05"], 0)
        self.assertEqual(proof["task_acceptance"], "NOT_VERIFIED")
        self.assertEqual(proof["human_gold"], "NOT_MEASURED")

    def test_exact_full_text_not_bounded_20k_ui_preview(self):
        large = final_case("large", text=("Документ\n" * 4000) + "Завершение.")
        self.assertGreater(len(large["artifact"]["data"]), 20_000)
        self.assertEqual(verify(large)["status"],
                         "HOST_SUPPLIED_FINAL_TEXT_AND_GRAPH_MATCH")
        preview = deepcopy(large)
        preview["final"]["text"] = preview["final"]["text"][:20000]
        with self.assertRaisesRegex(AgentComparisonHold, "FINAL_TEXT_NOT_EXACT"):
            verify(preview)

    def test_changed_result_or_forged_result_bytes_are_rejected(self):
        item = final_case("baseline")
        changed = deepcopy(item)
        changed["final"]["text"] += " invented price"
        with self.assertRaisesRegex(AgentComparisonHold, "FINAL_TEXT_NOT_EXACT"):
            verify(changed)
        with self.assertRaisesRegex(AgentComparisonHold, "RESULT_BYTES_NOT_ARTIFACT_TEXT"):
            verify(item, result_bytes=b"plausible but not persisted")

    def test_graph_stop_and_completion_are_both_required(self):
        item = final_case("baseline")
        for name, mutation, error in [
            ("no_stop", lambda v: v["graph"].update(stop_node_ids=[]),
             "FINAL_STOP_NODE_UNVERIFIED"),
            ("not_completed", lambda v: v["after"].update(state="READY"),
             "FINAL_GRAPH_EXECUTION_MISMATCH"),
            ("bad_attempt", lambda v: v["after"].update(
                node_completion_counts={v["artifact"]["node_id"]: 2}),
             "FINAL_COMMITTED_ATTEMPT_MISMATCH"),
        ]:
            with self.subTest(name=name):
                forged = deepcopy(item)
                mutation(forged)
                if name == "no_stop":
                    forged["graph"] = with_digest(forged["graph"], "graph_digest")
                    forged["artifact"]["graph_digest"] = forged["graph"]["graph_digest"]
                    forged["artifact"] = with_digest(forged["artifact"], "artifact_digest")
                    forged["after"]["graph_digest"] = forged["graph"]["graph_digest"]
                    forged["after"] = with_digest(forged["after"], "execution_digest")
                    forged["final"]["graph_digest"] = forged["graph"]["graph_digest"]
                    forged["final"]["execution_digest"] = forged["after"]["execution_digest"]
                    forged["final"]["artifact_digest"] = forged["artifact"]["artifact_digest"]
                else:
                    forged["after"] = with_digest(forged["after"], "execution_digest")
                    forged["final"]["execution_digest"] = forged["after"]["execution_digest"]
                with self.assertRaisesRegex(AgentComparisonHold, error):
                    verify(forged)

    def test_different_graph_or_node_reference_rejected(self):
        base = final_case("baseline")
        changed = deepcopy(base)
        changed["final"]["node_id"] = "other-stop"
        with self.assertRaisesRegex(AgentComparisonHold, "FINAL_STOP_NODE_UNVERIFIED"):
            verify(changed)
        changed = deepcopy(base)
        changed["final"]["execution_digest"] = "0" * 64
        with self.assertRaisesRegex(AgentComparisonHold, "FINAL_GRAPH_EXECUTION_MISMATCH"):
            verify(changed)
        changed = deepcopy(base)
        changed["final"]["node_run_digest"] = "f" * 64
        with self.assertRaisesRegex(AgentComparisonHold, "FINAL_ARTIFACT_CONFIG_MISMATCH"):
            verify(changed)

    def test_source_receipts_and_operation_reference_are_not_substitutable(self):
        item = final_case("baseline")
        changed = deepcopy(item)
        changed["final"]["source_refs"].append("different:source")
        with self.assertRaisesRegex(AgentComparisonHold, "FINAL_SOURCE_REFS_MISMATCH"):
            verify(changed)
        changed = deepcopy(item)
        changed["final"]["operation_ref"] = "TXR-fabricated"
        with self.assertRaisesRegex(AgentComparisonHold, "FINAL_OPERATION_REF_MISMATCH"):
            verify(changed)

    def test_fake_review_acceptance_cannot_pass(self):
        item = final_case("baseline")
        for field, value in [("human_review_required", False),
                             ("result_is_execution_authority", True)]:
            changed = deepcopy(item)
            changed["final"][field] = value
            with self.assertRaisesRegex(AgentComparisonHold, "FINAL_AUTHORITY_OR_REVIEW_FORGED"):
                verify(changed)
        changed = deepcopy(item)
        changed["final"]["result_accepted"] = True
        with self.assertRaisesRegex(AgentComparisonHold, "FINAL_PROJECTION_FIELDS_CHANGED"):
            verify(changed)

    def test_changed_artifact_config_or_graph_digest_rejected(self):
        original = final_case("baseline")
        for which, field in (("artifact", "data"), ("config", "config_id"),
                             ("graph", "graph_id"), ("after", "state")):
            with self.subTest(which=which):
                item = deepcopy(original)
                item[which][field] = "bogus"
                with self.assertRaisesRegex(AgentComparisonHold, "DIGEST_MISMATCH"):
                    verify(item)

    def test_final_receipt_does_not_promote_host_reported_model_quality(self):
        item = final_case("baseline")
        item["final"]["model_evaluation"] = {"quality_status": "PASS", "f1": 1.0}
        item["final"]["quality_evaluation"] = {"hallucination_rate": 0}
        proof = verify(item)
        self.assertEqual(proof["model_evaluation"], "NOT_VERIFIED")
        self.assertEqual(proof["quality_evaluation"], "NOT_VERIFIED")
        self.assertEqual(proof["human_gold"], "NOT_MEASURED")

    def test_two_verified_final_results_pair_only_under_old_source_model_gates(self):
        a, b = final_case("baseline"), final_case("tested")
        paired = compare(a, b)
        self.assertEqual(paired["status"], "SOURCE_BOUND_PROCESSING_COMPARABLE")
        self.assertEqual(paired["saved_graph_processing_comparison"]["fresh_model_execution_comparison"],
                         "OWNER_RECEIPTS_REPORT_TWO_FRESH_EXECUTIONS")
        self.assertEqual(len(paired["final_bindings"]), 2)
        self.assertEqual(paired["human_quality_gain"], "NOT_MEASURED")
        self.assertEqual(paired["result_readback_from_core"], "NOT_TESTED")
        self.assertGreater(paired["extra_final_binding_bytes_rehashed"], 0)

    def test_paired_graph_result_tampering_is_not_valid_comparison(self):
        a, b = final_case("baseline"), final_case("tested")
        b["final"]["text"] = "different display message"
        with self.assertRaisesRegex(AgentComparisonHold, "FINAL_TEXT_NOT_EXACT"):
            compare(a, b)
        b = final_case("tested")
        with self.assertRaisesRegex(AgentComparisonHold, "RESULT_BYTES_NOT_ARTIFACT_TEXT"):
            compare(a, b, baseline_result_bytes=b"unrelated Result")

    def test_paired_source_mismatch_still_uses_existing_k05_gate(self):
        a, b = final_case("baseline"), final_case("tested")
        b["run"]["source_manifest"][0]["revision"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(AgentComparisonHold, "SOURCE_REVISION_MISMATCH"):
            compare(a, b)

    def test_no_raw_text_or_execution_ids_in_public_proof(self):
        item = final_case("secret", text="private: secret proposal at 429500 USD")
        proof = json.dumps(verify(item), ensure_ascii=False)
        for private in ("private: secret proposal", "429500",
                        SOURCE_REF, item["artifact"]["execution_id"],
                        item["artifact"]["data"], "controlled-local-model"):
            self.assertNotIn(private, proof)

    def test_missing_json_or_duplicate_fields_fail_closed(self):
        item = final_case("baseline")
        final = to_bytes(item["final"])
        broken = final.replace(b'"text":', b'"text": "false", "text":', 1)
        with self.assertRaisesRegex(AgentComparisonHold, "DUPLICATE_JSON_KEY"):
            binding.verify_saved_graph_final_projection(
                final_result_bytes=broken, graph_bytes=to_bytes(item["graph"]),
                execution_instance_bytes=to_bytes(item["after"]),
                artifact_bytes=to_bytes(item["artifact"]),
                config_bytes=to_bytes(item["config"]),
                expected_result_text_bytes=item["result"])


if __name__ == "__main__":
    unittest.main()
