"""K05 optional independent binding of Agent's existing graph_final_result().

This checks that a host-supplied final-result projection contains the exact
full text of the supplied committed stop-node artifact, in the same completed
Graph/ExecutionInstance snapshot. It does NOT fetch Core, grant authority,
accept a Task, evaluate answer quality, or prove the snapshot came from Core.
"""
from __future__ import annotations

import hashlib

from k05_agent05_graph_readback import (
    AgentComparisonHold, GRAPH_ARTIFACT_CONTRACT, GRAPH_CONFIG_CONTRACT,
    GRAPH_RUNTIME_CONTRACT, MAX_ARTIFACT_BYTES, MAX_CONFIG_BYTES,
    _digest, _fail, _parse, _verify_record, compare_saved_graph_model_runs,
)

CONTRACT = "IWXA_K05_AGENT05_GRAPH_FINAL_PROJECTION_BINDING/0.1"
PAIR_CONTRACT = "IWXA_K05_AGENT05_GRAPH_FINAL_PAIRED_BINDING/0.1"
MAX_GRAPH_BYTES = 1_000_000
MAX_EXECUTION_BYTES = 512_000
MAX_FINAL_BYTES = 4_000_000
MAX_FULL_TEXT_CHARS = 2_000_000
FINAL_FIELDS = frozenset({
    "execution_id", "graph_id", "graph_digest", "execution_digest",
    "goal_id", "board_id", "node_id", "node_run_digest", "artifact_digest",
    "attempt", "text", "content_type", "execution_state", "source_refs",
    "operation_ref", "result_is_execution_authority", "human_review_required",
})
OPTIONAL_UNEVALUATED = frozenset({"quality_evaluation", "model_evaluation"})
EXECUTABLE_STOP_NODES = frozenset({
    "MODEL_INVOCATION", "AGENT_RUNTIME", "TOOL", "DETERMINISTIC_TRANSFORM",
})


def verify_saved_graph_final_projection(
    *, final_result_bytes: bytes, graph_bytes: bytes,
    execution_instance_bytes: bytes, artifact_bytes: bytes,
    config_bytes: bytes, expected_result_text_bytes: bytes,
) -> dict:
    """Validate a full result projection, never a bounded UI preview.

    Exact bytes are supplied by the authorized host. Neither the Result's
    trust origin nor independent Human Gold is established by these hashes.
    """
    final = _parse(final_result_bytes, MAX_FINAL_BYTES)
    graph = _parse(graph_bytes, MAX_GRAPH_BYTES)
    instance = _parse(execution_instance_bytes, MAX_EXECUTION_BYTES)
    artifact = _parse(artifact_bytes, MAX_ARTIFACT_BYTES)
    config = _parse(config_bytes, MAX_CONFIG_BYTES)

    if (not FINAL_FIELDS.issubset(final)
            or set(final) - (FINAL_FIELDS | OPTIONAL_UNEVALUATED)):
        _fail("FINAL_PROJECTION_FIELDS_CHANGED")
    graph_digest = _verify_record(
        graph, digest_key="graph_digest",
        contract=GRAPH_RUNTIME_CONTRACT, obj_type="GraphDefinition")
    execution_digest = _verify_record(
        instance, digest_key="execution_digest",
        contract=GRAPH_RUNTIME_CONTRACT, obj_type="ExecutionInstance")
    artifact_digest = _verify_record(
        artifact, digest_key="artifact_digest",
        contract=GRAPH_ARTIFACT_CONTRACT, obj_type="GraphNodeOutputArtifact")
    config_digest = _verify_record(
        config, digest_key="config_digest",
        contract=GRAPH_CONFIG_CONTRACT, obj_type="GraphNodeConfig")

    if (graph.get("graph_is_execution_authority") is not False
            or graph.get("unsafe_effect_replay_forbidden") is not True
            or graph.get("dynamic_mutation_requires_governed_proposal") is not True
            or instance.get("external_effect_authority_granted_by_graph") is not False
            or artifact.get("external_effect_performed") is not False
            or artifact.get("contains_credentials") is not False
            or config.get("contains_credentials") is not False
            or config.get("grants_execution_authority") is not False):
        _fail("GRAPH_AUTHORITY_FLAGS_INVALID")

    nodes = graph.get("nodes")
    stops = graph.get("stop_node_ids")
    if (type(nodes) is not list or not 0 < len(nodes) <= 512
            or type(stops) is not list or not 0 < len(stops) <= 512
            or any(type(n) is not dict or type(n.get("node_id")) is not str
                   for n in nodes)
            or len({n["node_id"] for n in nodes}) != len(nodes)):
        _fail("GRAPH_NODE_MANIFEST_INVALID")
    node_id = final.get("node_id")
    node = next((n for n in nodes if n["node_id"] == node_id), None)
    if (type(node_id) is not str or node is None or node_id not in stops
            or node.get("node_type") not in EXECUTABLE_STOP_NODES):
        _fail("FINAL_STOP_NODE_UNVERIFIED")
    if (final.get("result_is_execution_authority") is not False
            or final.get("human_review_required") is not True):
        _fail("FINAL_AUTHORITY_OR_REVIEW_FORGED")

    if (instance.get("state") != "COMPLETED"
            or final.get("execution_state") != "COMPLETED"
            or instance.get("graph_digest") != graph_digest
            or instance.get("graph_revision") != graph.get("revision")
            or instance.get("graph_id") != graph.get("graph_id")
            or instance.get("execution_id") != artifact.get("execution_id")
            or final.get("execution_id") != instance.get("execution_id")
            or final.get("graph_id") != graph.get("graph_id")
            or final.get("graph_digest") != graph_digest
            or final.get("execution_digest") != execution_digest
            or final.get("goal_id") != (graph.get("predecessor_goal_ref") or "")
            or final.get("board_id") != (graph.get("predecessor_workboard_ref") or "")):
        _fail("FINAL_GRAPH_EXECUTION_MISMATCH")

    counts = instance.get("node_completion_counts")
    completed = instance.get("completed_node_ids")
    attempt = final.get("attempt")
    if (type(counts) is not dict or type(completed) is not list
            or type(attempt) is not int or not 1 <= attempt <= 1_000_000
            or counts.get(node_id) != attempt or node_id not in completed
            or type(artifact.get("attempt")) is not int
            or artifact["attempt"] != attempt):
        _fail("FINAL_COMMITTED_ATTEMPT_MISMATCH")
    if (artifact.get("graph_digest") != graph_digest
            or artifact.get("node_id") != node_id
            or artifact.get("node_type") != node.get("node_type")
            or artifact.get("node_run_digest") != final.get("node_run_digest")
            or artifact.get("artifact_digest") != final.get("artifact_digest")
            or artifact.get("config_ref") != node.get("config_ref")
            or artifact.get("config_digest") != config_digest
            or config.get("node_type") != node.get("node_type")
            or artifact.get("config_ref") !=
               "graph-node-config:" + str(config.get("config_id", "")) +
               ":" + config_digest):
        _fail("FINAL_ARTIFACT_CONFIG_MISMATCH")

    text = artifact.get("data")
    if (artifact.get("content_type") != "text/plain"
            or final.get("content_type") != "text/plain"
            or type(text) is not str
            or not text.strip() or len(text) > MAX_FULL_TEXT_CHARS
            or type(final.get("text")) is not str or final["text"] != text):
        _fail("FINAL_TEXT_NOT_EXACT")
    if (type(expected_result_text_bytes) is not bytes
            or expected_result_text_bytes != text.encode("utf-8")):
        _fail("RESULT_BYTES_NOT_ARTIFACT_TEXT")

    refs = artifact.get("source_refs")
    if (type(refs) is not list or not len(refs) <= 128
            or any(type(ref) is not str or not ref or len(ref) > 512
                   for ref in refs)
            or len(refs) != len(set(refs))
            or final.get("source_refs") != refs):
        _fail("FINAL_SOURCE_REFS_MISMATCH")
    meta = artifact.get("provider_meta") or {}
    if (type(meta) is not dict
            or final.get("operation_ref") != (meta.get("operation_ref") or "")):
        _fail("FINAL_OPERATION_REF_MISMATCH")

    return {
        "schema": CONTRACT,
        "status": "HOST_SUPPLIED_FINAL_TEXT_AND_GRAPH_MATCH",
        "graph_sha256": graph_digest,
        "execution_sha256": execution_digest,
        "artifact_sha256": artifact_digest,
        "config_sha256": config_digest,
        "full_text_sha256": hashlib.sha256(expected_result_text_bytes).hexdigest(),
        "source_ref_count": len(refs),
        "bytes_rehashed_by_binding": (
            len(final_result_bytes) + len(graph_bytes) +
            len(execution_instance_bytes) + len(artifact_bytes) +
            len(config_bytes) + len(expected_result_text_bytes)),
        "graph_core_origin": "NOT_VERIFIED",
        "source_currentness": "NOT_VERIFIED",
        "human_gold": "NOT_MEASURED",
        "task_acceptance": "NOT_VERIFIED",
        "model_evaluation": "NOT_VERIFIED",
        "quality_evaluation": "NOT_VERIFIED",
        "host_reads_by_k05": 0,
        "model_invocations_by_k05": 0,
    }


def compare_saved_graph_final_results(
    baseline: dict, tested: dict, *,
    baseline_final_result_bytes: bytes, tested_final_result_bytes: bytes,
    baseline_graph_bytes: bytes, tested_graph_bytes: bytes,
    baseline_execution_instance_bytes: bytes,
    tested_execution_instance_bytes: bytes,
    baseline_artifact_bytes: bytes, tested_artifact_bytes: bytes,
    baseline_config_bytes: bytes, tested_config_bytes: bytes,
    baseline_task_bytes: bytes, tested_task_bytes: bytes,
    baseline_result_bytes: bytes, tested_result_bytes: bytes,
    baseline_source_bytes: dict, tested_source_bytes: dict,
    baseline_execution_receipt_bytes: bytes | None = None,
    tested_execution_receipt_bytes: bytes | None = None,
) -> dict:
    """Optional final Result gate around the existing paired Graph evaluator."""
    before = verify_saved_graph_final_projection(
        final_result_bytes=baseline_final_result_bytes,
        graph_bytes=baseline_graph_bytes,
        execution_instance_bytes=baseline_execution_instance_bytes,
        artifact_bytes=baseline_artifact_bytes, config_bytes=baseline_config_bytes,
        expected_result_text_bytes=baseline_result_bytes)
    after = verify_saved_graph_final_projection(
        final_result_bytes=tested_final_result_bytes,
        graph_bytes=tested_graph_bytes,
        execution_instance_bytes=tested_execution_instance_bytes,
        artifact_bytes=tested_artifact_bytes, config_bytes=tested_config_bytes,
        expected_result_text_bytes=tested_result_bytes)
    paired = compare_saved_graph_model_runs(
        baseline, tested, baseline_task_bytes=baseline_task_bytes,
        tested_task_bytes=tested_task_bytes,
        baseline_result_bytes=baseline_result_bytes,
        tested_result_bytes=tested_result_bytes,
        baseline_source_bytes=baseline_source_bytes,
        tested_source_bytes=tested_source_bytes,
        baseline_artifact_bytes=baseline_artifact_bytes,
        tested_artifact_bytes=tested_artifact_bytes,
        baseline_config_bytes=baseline_config_bytes,
        tested_config_bytes=tested_config_bytes,
        baseline_execution_receipt_bytes=baseline_execution_receipt_bytes,
        tested_execution_receipt_bytes=tested_execution_receipt_bytes,
    )
    return {
        "schema": PAIR_CONTRACT,
        "status": paired["status"],
        "reasons": paired["reasons"],
        "saved_graph_processing_comparison": paired,
        "final_bindings": [before, after],
        "extra_final_binding_bytes_rehashed": (
            before["bytes_rehashed_by_binding"] +
            after["bytes_rehashed_by_binding"]),
        "result_readback_from_core": "NOT_TESTED",
        "human_quality_gain": "NOT_MEASURED",
    }
