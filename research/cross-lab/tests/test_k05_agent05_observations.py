from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import json
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import k05_agent05_observations as mod


def h(data: bytes) -> str:
    return sha256(data).hexdigest()


TASK = "Сверь две редакции КП и укажи источник каждого утверждения.".encode("utf-8")
SOURCE = "Цена: 990640 руб.\nАванс: 35%.\n".encode("utf-8")
RESULT_A = "Источник подтверждён, качество не оценивалось.".encode("utf-8")
RESULT_B = "Источник подтверждён; требуется проверить срок.".encode("utf-8")
REF = "host://private-commercial-file"
RECEIPTS = {"k02": "TXR-fixture-k02", "k04": "TXR-fixture-k04"}
MODEL = "a" * 64


def observation(inp=120, out=50, latency=110, *, provenance="LINKED"):
    owners = RECEIPTS if provenance in {"LINKED", "INCOMPLETE"} else {}
    return {
        "contract": mod.AGENT_MODEL_OBSERVATION,
        "status": "PROVENANCE_INCOMPLETE" if provenance == "INCOMPLETE" else
                  "METRICS_UNAVAILABLE" if all(x is None for x in (inp, out, latency))
                  else "OBSERVED",
        "observed_input_tokens": inp,
        "observed_output_tokens": out,
        "observed_latency_ms": latency,
        "quality_status": "QUALITY_UNKNOWN",
        "cost_status": "COST_UNKNOWN",
        "actual_cost_usd": None,
        "estimated_savings_usd": None,
        "provenance_status": provenance,
        "owner_receipt_refs": owners,
        "source_revision": "e" * 64,  # Graph artifact, NOT an input source pin
        "provider_id": "test-local",
        "model": "synthetic-model-name",
        "read_only": True,
        "result_accepted": False,
        "execution_authority_granted": False,
    }


def record(run_id: str, result: bytes, *, task=TASK, source=SOURCE):
    return {
        "run_id": run_id,
        "task_sha256": h(task),
        "source_manifest": [{"ref": REF, "revision": "sha256:" + h(source)}],
        "model_digest": MODEL,
        "runtime_revision": "test-pinned-runtime-1",
        "result_sha256": h(result),
        "model_observation": observation(),
    }


def compare(first=None, second=None, *, left_task=TASK, right_task=TASK,
            left_source=SOURCE, right_source=SOURCE, left_result=RESULT_A,
            right_result=RESULT_B):
    return mod.compare_saved_model_runs(
        first if first is not None else record("baseline", left_result, task=left_task,
                                               source=left_source),
        second if second is not None else record("tested", right_result, task=right_task,
                                                 source=right_source),
        baseline_task_bytes=left_task, tested_task_bytes=right_task,
        baseline_result_bytes=left_result, tested_result_bytes=right_result,
        baseline_source_bytes={REF: left_source},
        tested_source_bytes={REF: right_source},
    )


class Agent05ObservedQuality(unittest.TestCase):
    def test_equal_exact_task_source_and_model_allows_processing_only(self):
        a, b = record("baseline", RESULT_A), record("tested", RESULT_B)
        b["model_observation"] = observation(100, 40, 130)
        result = compare(a, b)
        self.assertEqual(result["status"], "SOURCE_BOUND_PROCESSING_COMPARABLE")
        self.assertEqual(result["deltas"]["input_tokens_delta"], -20)
        self.assertEqual(result["deltas"]["output_tokens_delta"], -10)
        self.assertEqual(result["deltas"]["latency_ms_delta"], 20)
        self.assertEqual(result["quality"]["status"], "NOT_MEASURED")
        self.assertIsNone(result["quality"]["f1"])
        self.assertIsNone(result["resources"]["actual_cost_usd_delta"])
        self.assertEqual(result["resources"]["source_reads_by_k05"], 0)
        self.assertEqual(result["resources"]["result_readback_from_core"], "NOT_TESTED")

    def test_missing_metrics_do_not_turn_into_measured_savings(self):
        a, b = record("baseline", RESULT_A), record("tested", RESULT_B)
        b["model_observation"] = observation(None, None, None, provenance="NOT_RECORDED")
        result = compare(a, b)
        self.assertEqual(result["status"], "SOURCE_BOUND_PROCESSING_COMPARABLE")
        self.assertEqual(result["deltas"], {"input_tokens_delta": None,
                                           "output_tokens_delta": None,
                                           "latency_ms_delta": None})
        self.assertEqual(result["quality"]["skill_effect"], "NOT_MEASURED")

    def test_changed_task_or_sources_are_not_comparable(self):
        alternate_task = TASK + b" changed"
        alternate_source = SOURCE + b"Additional approved statement\n"
        results = [
            compare(right_task=alternate_task),
            compare(right_source=alternate_source),
        ]
        self.assertEqual(results[0]["reasons"], ["TASK_CHANGED"])
        self.assertEqual(results[1]["reasons"], ["SOURCE_SET_CHANGED"])
        for report in results:
            self.assertEqual(report["status"], "NOT_COMPARABLE")
            self.assertTrue(all(v is None for v in report["deltas"].values()))

    def test_model_runtime_and_provider_changes_are_not_claimed_as_memory_effect(self):
        b = record("tested", RESULT_B)
        b["model_digest"] = "b" * 64
        self.assertIn("MODEL_CHANGED", compare(second=b)["reasons"])
        b = record("tested", RESULT_B)
        b["runtime_revision"] = "test-pinned-runtime-2"
        self.assertIn("RUNTIME_CHANGED", compare(second=b)["reasons"])
        b = record("tested", RESULT_B)
        b["model_observation"]["provider_id"] = "different-provider"
        self.assertIn("MODEL_IDENTITY_CHANGED", compare(second=b)["reasons"])

    def test_unlinked_owner_receipts_are_not_independent_source_evidence(self):
        b = record("tested", RESULT_B)
        b["model_observation"] = observation(provenance="INCOMPLETE")
        report = compare(second=b)
        self.assertEqual(report["status"], "NOT_COMPARABLE")
        self.assertIn("OWNER_RECEIPT_LINK_INCOMPLETE", report["reasons"])

    def test_forged_or_stale_raw_bytes_are_rejected(self):
        a = record("baseline", RESULT_A)
        b = record("tested", RESULT_B)
        with self.assertRaisesRegex(mod.AgentComparisonHold, "TASK_BYTES_MISMATCH"):
            compare(first=a, second=b, left_task=TASK + b"x")
        with self.assertRaisesRegex(mod.AgentComparisonHold, "SOURCE_REVISION_MISMATCH"):
            compare(first=a, second=b, left_source=SOURCE + b"tampered")
        with self.assertRaisesRegex(mod.AgentComparisonHold, "RESULT_BYTES_MISMATCH"):
            compare(first=a, second=b, left_result=RESULT_A + b"tampered")
        forged = deepcopy(b)
        forged["source_manifest"][0]["revision"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(mod.AgentComparisonHold, "SOURCE_REVISION_MISMATCH"):
            compare(second=forged)

    def test_fake_task_acceptance_quality_or_actual_cost_are_rejected(self):
        mutations = [
            ("result_accepted", True),
            ("read_only", False),
            ("execution_authority_granted", True),
            ("quality_status", "PASS"),
            ("cost_status", "COST_MEASURED"),
            ("actual_cost_usd", 0.004),
            ("estimated_savings_usd", 1.00),
        ]
        for key, value in mutations:
            with self.subTest(key=key):
                b = record("tested", RESULT_B)
                b["model_observation"][key] = value
                with self.assertRaisesRegex(mod.AgentComparisonHold,
                                            "AUTHORITY_OR_QUALITY_FORGED"):
                    compare(second=b)

    def test_extra_claims_duplicate_ids_and_source_pins_are_rejected(self):
        a, b = record("baseline", RESULT_A), record("tested", RESULT_B)
        b["model_observation"]["human_gold"] = True
        with self.assertRaisesRegex(mod.AgentComparisonHold,
                                    "AGENT_OBSERVATION_FIELDS_CHANGED"):
            compare(second=b)
        with self.assertRaisesRegex(mod.AgentComparisonHold, "DUPLICATE_RUN_ID"):
            compare(second=record("baseline", RESULT_B))
        b = record("tested", RESULT_B)
        b["source_manifest"].append(deepcopy(b["source_manifest"][0]))
        with self.assertRaisesRegex(mod.AgentComparisonHold, "SOURCE_PIN_INVALID"):
            compare(second=b)

    def test_missing_exact_model_pin_fails_closed(self):
        b = record("tested", RESULT_B)
        b["model_digest"] = ""
        with self.assertRaisesRegex(mod.AgentComparisonHold,
                                    "MISSING_EXACT_TASK_RESULT_OR_MODEL_DIGEST"):
            compare(second=b)

    def test_invalid_negative_or_boolean_usage_and_missing_fields(self):
        for bad in [-1, 1.1, True, 1_000_000_001]:
            b = record("tested", RESULT_B)
            b["model_observation"]["observed_output_tokens"] = bad
            with self.assertRaisesRegex(mod.AgentComparisonHold,
                                        "INVALID_REPORTED_METRIC"):
                compare(second=b)
        b = record("tested", RESULT_B)
        b["model_observation"].pop("cost_status")
        with self.assertRaisesRegex(mod.AgentComparisonHold,
                                    "AGENT_OBSERVATION_FIELDS_CHANGED"):
            compare(second=b)

    def test_no_raw_task_result_source_or_owner_receipt_leaks_into_proof(self):
        result = compare()
        encoded = json.dumps(result, ensure_ascii=False)
        for private in (TASK.decode(), SOURCE.decode(), RESULT_A.decode(),
                        RESULT_B.decode(), REF, RECEIPTS["k02"], RECEIPTS["k04"]):
            self.assertNotIn(private, encoded)
        self.assertIn(h(REF.encode()), encoded)
        self.assertEqual(result["runs"][0]["reported_metrics"]
                         ["saved_graph_artifact_digest"], "e" * 64)

    def test_none_outcomes_not_promoted_by_host_reported_latency(self):
        b = record("tested", RESULT_B)
        b["model_observation"] = observation(100, 80, 1000, provenance="NOT_RECORDED")
        result = compare(second=b)
        self.assertEqual(result["quality"]["memory_effect"], "NOT_MEASURED")
        self.assertEqual(result["quality"]["agent_solution_effect"], "NOT_MEASURED")
        self.assertEqual(result["qualification"],
                         "HOST_REPORTED_MODEL_METRICS_NOT_INDEPENDENT_CORE_READBACK")


if __name__ == "__main__":
    unittest.main()
