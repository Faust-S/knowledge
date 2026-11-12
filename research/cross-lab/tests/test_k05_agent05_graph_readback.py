"""K05 Graph readback: controlled contract-level examples, NOT Agent model gold."""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import json
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import k05_agent05_graph_readback as graph
from k05_agent05_observations import AgentComparisonHold

MODEL_DIGEST = "a" * 64
SOURCE_REF = "host://private-document-not-for-export"
SOURCE_BYTES = b"Original approved rate: 9800 USD\n"
TASK_BYTES = b"Find approved rates and cite sources"
RECEIPTS = {"k02": "TXR-k02-controlled-abc",
            "k04": "TXR-k04-controlled-def"}


def digest(material):
    return sha256(json.dumps(material, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def with_digest(obj, name):
    out = deepcopy(obj)
    out.pop(name, None)
    out[name] = digest(out)
    return out


def to_bytes(obj):
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def build(run_id, *, input_tokens=120, output_tokens=60,
          elapsed_ms=145, linked=True, owner_receipts=True,
          model_pin=True):
    spec = {"prompt_template": "{{source}}", "system": "",
            "input_node_ids": [], "timeout_seconds": 30,
            "max_output_tokens": 200}
    if model_pin:
        spec["local_model"] = {"name": "controlled-local-model", "digest": MODEL_DIGEST}
    if owner_receipts:
        spec["model_choice"] = {"contract": "PA.P01.MODEL_CHOICE/0.1.0",
                                "mode": "MANUAL_PIN", "provider_id": "OLLAMA_LOCAL_V1",
                                "binding_digest": "b" * 64,
                                "owner_receipts": RECEIPTS}
    cfg = with_digest({
        "contract": graph.GRAPH_CONFIG_CONTRACT, "object_type": "GraphNodeConfig",
        "config_id": "config-" + run_id, "node_type": "MODEL_INVOCATION",
        "spec": spec, "contains_credentials": False,
        "grants_execution_authority": False,
    }, "config_digest")
    meta = {"provider_id": "OLLAMA_LOCAL_V1",
            "model": "controlled-local-model",
            "binding_digest": "b" * 64,
            "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
            "elapsed_ms": elapsed_ms}
    if model_pin:
        meta["model_digest"] = MODEL_DIGEST
    refs = ["model-binding:" + "b" * 64]
    if owner_receipts and linked:
        refs.extend("tool-receipt:" + receipt for receipt in RECEIPTS.values())
    output = "Answer without independent quality review: " + run_id
    artifact = with_digest({
        "contract": graph.GRAPH_ARTIFACT_CONTRACT,
        "object_type": "GraphNodeOutputArtifact",
        "execution_id": "execution-" + run_id,
        "node_type": "MODEL_INVOCATION",
        "node_id": "model-" + run_id,
        "node_run_digest": "c" * 64,
        "graph_digest": "d" * 64,
        "config_ref": "graph-node-config:" + cfg["config_id"] + ":" + cfg["config_digest"],
        "config_digest": cfg["config_digest"],
        "data": output, "content_type": "text/plain",
        "source_refs": refs, "provider_meta": meta,
        "external_effect_performed": False, "contains_credentials": False,
    }, "artifact_digest")
    provenance = ("LINKED" if linked else "INCOMPLETE") if owner_receipts else "NOT_RECORDED"
    observation = {
        "contract": "PA.K05.MODEL_EXECUTION_OBSERVATION/0.1.0",
        "status": "PROVENANCE_INCOMPLETE" if provenance == "INCOMPLETE" else "OBSERVED",
        "observed_input_tokens": input_tokens,
        "observed_output_tokens": output_tokens,
        "observed_latency_ms": elapsed_ms,
        "quality_status": "QUALITY_UNKNOWN",
        "cost_status": "COST_UNKNOWN",
        "actual_cost_usd": None,
        "estimated_savings_usd": None,
        "provenance_status": provenance,
        "owner_receipt_refs": RECEIPTS if owner_receipts else {},
        "source_revision": artifact["artifact_digest"],
        "provider_id": meta["provider_id"], "model": meta["model"],
        "read_only": True,
        "result_accepted": False,
        "execution_authority_granted": False,
    }
    result = b"host-result:" + run_id.encode()
    run = {
        "run_id": run_id,
        "task_sha256": sha256(TASK_BYTES).hexdigest(),
        "result_sha256": sha256(result).hexdigest(),
        "source_manifest": [{"ref": SOURCE_REF,
                             "revision": "sha256:" + sha256(SOURCE_BYTES).hexdigest()}],
        "model_digest": MODEL_DIGEST,
        "runtime_revision": "pinned-runtime-1",
        "model_observation": observation,
    }
    return {"artifact": artifact, "config": cfg, "run": run, "result": result}


def verify(bundle):
    return graph.verify_saved_graph_model_observation(
        bundle["run"]["model_observation"],
        artifact_bytes=to_bytes(bundle["artifact"]),
        config_bytes=to_bytes(bundle["config"]),
    )


def compare(a, b):
    return graph.compare_saved_graph_model_runs(
        a["run"], b["run"],
        baseline_task_bytes=TASK_BYTES, tested_task_bytes=TASK_BYTES,
        baseline_result_bytes=a["result"], tested_result_bytes=b["result"],
        baseline_source_bytes={SOURCE_REF: SOURCE_BYTES},
        tested_source_bytes={SOURCE_REF: SOURCE_BYTES},
        baseline_artifact_bytes=to_bytes(a["artifact"]),
        tested_artifact_bytes=to_bytes(b["artifact"]),
        baseline_config_bytes=to_bytes(a["config"]),
        tested_config_bytes=to_bytes(b["config"]),
    )


class Agent05GraphReceipt(unittest.TestCase):
    def test_valid_saved_artifact_confirms_exact_observation_but_no_quality_gold(self):
        value = build("baseline")
        result = verify(value)
        self.assertEqual(result["status"], "GRAPH_SNAPSHOT_LINKED")
        self.assertEqual(result["artifact_sha256"], value["artifact"]["artifact_digest"])
        self.assertEqual(result["config_sha256"], value["config"]["config_digest"])
        self.assertEqual(result["pinned_model_digest"], MODEL_DIGEST)
        self.assertEqual(result["metric_values"]["latency_ms"], 145)
        self.assertGreater(result["artifact_bytes_rehashed"], 500)
        self.assertFalse(result["core_readback_verified"])
        self.assertFalse(result["live_model_inference_verified"])
        self.assertFalse(result["human_quality_gold"])

    def test_valid_graph_pins_allow_only_processing_differences(self):
        a, b = build("baseline"), build("tested", input_tokens=140,
                                       output_tokens=52, elapsed_ms=178)
        result = compare(a, b)
        self.assertEqual(result["status"], "SOURCE_BOUND_PROCESSING_COMPARABLE")
        self.assertEqual(result["processing"]["deltas"],
                         {"input_tokens_delta": 20,
                          "output_tokens_delta": -8,
                          "latency_ms_delta": 33})
        self.assertEqual(result["processing"]["quality"]["status"], "NOT_MEASURED")
        self.assertEqual(result["actual_model_calls_by_k05"], 0)
        self.assertEqual(result["graph_core_readback"], "NOT_TESTED")
        self.assertEqual(result["human_quality_improvement"], "NOT_MEASURED")

    def test_tampered_unchanged_digest_cannot_hide_token_or_output_change(self):
        item = build("baseline")
        altered = deepcopy(item)
        altered["artifact"]["provider_meta"]["usage"]["output_tokens"] = 61
        with self.assertRaisesRegex(AgentComparisonHold, "DIGEST_MISMATCH"):
            verify(altered)
        altered = deepcopy(item)
        altered["artifact"]["data"] = "Forged model answer"
        with self.assertRaisesRegex(AgentComparisonHold, "DIGEST_MISMATCH"):
            verify(altered)

    def test_self_consistent_rehashed_artifact_with_forged_observation_metrics_rejected(self):
        item = build("baseline")
        item["artifact"]["provider_meta"]["elapsed_ms"] = 999
        item["artifact"] = with_digest(item["artifact"], "artifact_digest")
        item["run"]["model_observation"]["source_revision"] = item["artifact"]["artifact_digest"]
        with self.assertRaisesRegex(AgentComparisonHold, "GRAPH_METRICS_DISAGREE"):
            verify(item)

    def test_cross_run_artifact_substitution_rejected(self):
        a = build("baseline")
        b = build("tested")
        with self.assertRaisesRegex(AgentComparisonHold, "OBSERVATION_DIGEST_MISMATCH"):
            graph.verify_saved_graph_model_observation(
                a["run"]["model_observation"],
                artifact_bytes=to_bytes(b["artifact"]),
                config_bytes=to_bytes(b["config"]),
            )

    def test_config_or_local_model_digest_mismatch_is_rejected(self):
        item = build("baseline")
        bad = deepcopy(item)
        bad["config"]["spec"]["local_model"]["digest"] = "f" * 64
        with self.assertRaisesRegex(AgentComparisonHold, "DIGEST_MISMATCH"):
            verify(bad)
        bad = deepcopy(item)
        bad["artifact"]["provider_meta"]["model_digest"] = "f" * 64
        bad["artifact"] = with_digest(bad["artifact"], "artifact_digest")
        bad["run"]["model_observation"]["source_revision"] = bad["artifact"]["artifact_digest"]
        with self.assertRaisesRegex(AgentComparisonHold, "PINNED_MODEL_IDENTITY_MISMATCH"):
            verify(bad)

    def test_config_receipt_disagreement_and_hidden_source_refs(self):
        item = build("baseline")
        bad = deepcopy(item)
        bad["run"]["model_observation"]["owner_receipt_refs"]["k02"] = "TXR-invented"
        with self.assertRaisesRegex(AgentComparisonHold, "RECEIPT_OBSERVATION_MISMATCH"):
            verify(bad)
        no_link = build("baseline", linked=False)
        status = verify(no_link)
        self.assertEqual(status["status"], "GRAPH_SNAPSHOT_OWNER_LINKS_NOT_VERIFIED")
        pair = compare(no_link, build("tested"))
        self.assertEqual(pair["status"], "NOT_COMPARABLE")
        self.assertIn("OWNER_RECEIPTS_NOT_LINKED", pair["reasons"])
        self.assertTrue(all(x is None for x in pair["processing"]["deltas"].values()))

    def test_without_receipts_is_not_rebranded_as_owner_verified(self):
        missing = build("baseline", owner_receipts=False)
        result = verify(missing)
        self.assertEqual(result["owner_receipt_refs_status"], "NOT_RECORDED")
        self.assertEqual(result["status"], "GRAPH_SNAPSHOT_OWNER_LINKS_NOT_VERIFIED")
        pair = compare(missing, build("tested"))
        self.assertEqual(pair["status"], "NOT_COMPARABLE")
        self.assertIn("OWNER_RECEIPTS_NOT_LINKED", pair["reasons"])

    def test_model_without_exact_pinned_digest_not_used_for_pairing(self):
        missing = build("baseline", model_pin=False, owner_receipts=False)
        result = verify(missing)
        self.assertIsNone(result["pinned_model_digest"])
        pair = compare(missing, build("tested"))
        self.assertEqual(pair["status"], "NOT_COMPARABLE")
        self.assertIn("MODEL_PIN_NOT_VERIFIED", pair["reasons"])

    def test_invalid_json_utf8_duplicate_key_and_nonfinite_value_fail_closed(self):
        item = build("baseline")
        for bad in [b"\xff", b'{"a":1,"a":2}', b'{"bad":NaN}', b"[]", b""]:
            with self.subTest(bad=repr(bad)):
                with self.assertRaises(AgentComparisonHold):
                    graph.verify_saved_graph_model_observation(
                        item["run"]["model_observation"],
                        artifact_bytes=bad, config_bytes=to_bytes(item["config"]))

    def test_invalid_metric_rejected_without_claiming_savings(self):
        item = build("baseline")
        item["artifact"]["provider_meta"]["usage"]["input_tokens"] = -1
        item["artifact"] = with_digest(item["artifact"], "artifact_digest")
        item["run"]["model_observation"]["source_revision"] = item["artifact"]["artifact_digest"]
        item["run"]["model_observation"]["observed_input_tokens"] = None
        with self.assertRaisesRegex(AgentComparisonHold, "RAW_METRIC_INVALID"):
            verify(item)

    def test_result_proof_never_exposes_model_names_receipts_or_user_payloads(self):
        a,b = build("baseline"),build("tested")
        encoded = json.dumps(compare(a,b),ensure_ascii=False)
        for fragment in (SOURCE_REF, SOURCE_BYTES.decode(), TASK_BYTES.decode(),
                         a["artifact"]["data"], RECEIPTS["k02"], RECEIPTS["k04"],
                         "OLLAMA_LOCAL_V1", "controlled-local-model"):
            self.assertNotIn(fragment,encoded)
        self.assertIn(sha256(b"controlled-local-model").hexdigest(),encoded)

    def test_wrong_artifact_graph_authority_flags_are_rejected(self):
        item = build("baseline")
        item["artifact"]["external_effect_performed"] = True
        item["artifact"] = with_digest(item["artifact"], "artifact_digest")
        item["run"]["model_observation"]["source_revision"] = item["artifact"]["artifact_digest"]
        with self.assertRaisesRegex(AgentComparisonHold, "GRAPH_NODE_OR_CONFIG_LINK_MISMATCH"):
            verify(item)

    def test_task_and_source_mismatch_still_block_verified_graph_comparison(self):
        a,b=build("baseline"),build("tested")
        b["run"]["task_sha256"] = "f"*64
        with self.assertRaisesRegex(AgentComparisonHold, "TASK_BYTES_MISMATCH"):
            compare(a,b)
        b=build("tested")
        b["run"]["source_manifest"][0]["revision"] = "sha256:"+"f"*64
        with self.assertRaisesRegex(AgentComparisonHold, "SOURCE_REVISION_MISMATCH"):
            compare(a,b)


if __name__ == "__main__":
    unittest.main()
