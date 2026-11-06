"""K05 source-bound model-routing cases, not a new LLM benchmark engine.

This module reuses K05's pinned public evidence suite for source provenance.
It never executes a model, scores a generated response, or supplies quality
observations to K02. All questions are frozen before routing is compared.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import hashlib
import json
from pathlib import Path
from typing import Mapping

import k05_evaluation as k05

CORPUS_SCHEMA = "IWXA_K05_K02_SOURCE_CASES/0.1"
K02_OWNER_COMMIT = "0542febfc07db9b2b2b610c7af124b9c61f682ab"
K02_OWNER_PATH = "modules/k02-interoperability/model-step-selection.mjs"
K02_OWNER_BLOB = "96aeccc0b12e81c8cab629bd06d69effac4a06e4"
CODE_ANCHOR = "hostAuthorityGranted:false,proofOfInvoke:null,"
NO_MODEL_EVIDENCE = "NOT_MEASURED"


@dataclass(frozen=True)
class SourceBoundTask:
    case_id: str
    task_class: str
    difficulty: str
    question: str
    source_case_ids: tuple[str, ...]
    expected_source_check: str
    judge: str
    source_code_required: bool = False


# No model labels, model names, training outcomes or router-specific answers.
# Claims requiring semantic interpretation must stay UNKNOWN until independent
# assessment. Historical README editions do not establish current versions.
TASKS = (
    SourceBoundTask(
        "K05-MR-01", "exact_extraction", "simple",
        "Extract the pinned Python release version and cite its exact README line.",
        ("K05_CPYTHON_RELEASE_REVISION",),
        "PINNED_SOURCE_HAS_EXACT_RELEASE_LINE", "SOURCE_LITERAL_ONLY"),
    SourceBoundTask(
        "K05-MR-02", "cited_summary", "moderate",
        "Describe the documented expansion of the knowledge repository's scope with versioned citations.",
        ("K05_PUBLIC_KNOWLEDGE_SCOPE_REVISION",),
        "REVISIONED_TEXT_CHANGED", "SEMANTIC_SUMMARY_NOT_MEASURED"),
    SourceBoundTask(
        "K05-MR-03", "conflicting_revisions", "complex",
        "Explain whether the two Python README editions assert different release versions; do not claim both are current.",
        ("K05_CPYTHON_RELEASE_REVISION",),
        "REVISIONED_TEXT_CHANGED", "SOURCE_RELATION_ONLY"),
    SourceBoundTask(
        "K05-MR-04", "multi_step", "complex",
        "Compare historical changes in the knowledge scope and Node README branch reference using both pinned sources.",
        ("K05_PUBLIC_KNOWLEDGE_SCOPE_REVISION",
         "K05_NODE_RELEASE_BRANCH_REVISION"),
        "TWO_PINNED_REVISION_CHANGES", "COMPOSITE_SEMANTICS_NOT_MEASURED"),
    SourceBoundTask(
        "K05-MR-05", "source_code_check", "complex",
        "From the exact K02 source, check whether a recommendation grants execution authority.",
        (), "K02_CODE_EXPLICIT_NOT_AUTHORIZED", "SOURCE_LITERAL_ONLY", True),
    SourceBoundTask(
        "K05-MR-06", "missing_evidence", "complex",
        "Is Python 3.13 installed on this user's computer? The provided public README is not a local observation.",
        ("K05_CPYTHON_RELEASE_REVISION",),
        "LOCAL_INSTALL_STATE_UNKNOWN", "UNKNOWN_REQUIRES_HOST_SOURCE"),
    SourceBoundTask(
        "K05-MR-07", "hard_source_limit", "moderate",
        "Can a Node README branch-reference change prove Python/Node runtime binary compatibility?",
        ("K05_NODE_RELEASE_BRANCH_REVISION",
         "K05_CPYTHON_RELEASE_REVISION"),
        "CROSS_RUNTIME_COMPATIBILITY_UNKNOWN", "UNKNOWN_REQUIRES_INDEPENDENT_SOURCE"),
    SourceBoundTask(
        "K05-MR-08", "stable_fact", "simple",
        "Check whether the pinned Node README introductory description changed between editions.",
        ("K05_NODE_STABLE_TEXT_NEGATIVE_CONTROL",),
        "PINNED_SOURCE_TEXT_UNCHANGED", "SOURCE_LITERAL_ONLY"),
)


def _owner_code_evidence(source: bytes) -> dict:
    if type(source) is not bytes or not source:
        raise k05.PinMismatch("K02_SOURCE_UNAVAILABLE")
    if k05.git_blob_sha(source) != K02_OWNER_BLOB:
        raise k05.PinMismatch("K02_SOURCE_REVISION_MISMATCH")
    lines = source.decode("utf-8", errors="strict").splitlines()
    matches = [(i + 1, line) for i, line in enumerate(lines)
               if CODE_ANCHOR in line]
    if len(matches) != 1:
        raise k05.PinMismatch("K02_SOURCE_CODE_ANCHOR_UNSUPPORTED")
    number, line = matches[0]
    return {
        "source_ref": "https://github.com/Faust-S/knowledge/blob/"
                      + K02_OWNER_COMMIT + "/" + K02_OWNER_PATH,
        "version": K02_OWNER_COMMIT,
        "git_blob_sha": K02_OWNER_BLOB,
        "locator": "L" + str(number),
        "line_sha256": hashlib.sha256(line.encode("utf-8")).hexdigest(),
        "source_assertion": "MODEL_RECOMMENDATION_NOT_EXECUTION_AUTHORITY",
    }


def build_source_corpus(
    verified_public_sources: Mapping[tuple[str, str, str], bytes],
    owner_source_bytes: bytes,
) -> dict:
    """Fail-closed evidence verification, using existing K05 APIs only."""
    suite = k05.evaluate_suite(k05.PUBLIC_SUITE, verified_public_sources, rounds=1)
    if not k05.verify_suite_receipt(
        suite, k05.PUBLIC_SUITE, verified_public_sources
    ) or suite["status"] != "PASS":
        raise k05.PinMismatch("K05_SOURCE_SUITE_UNVERIFIED")
    owner = _owner_code_evidence(owner_source_bytes)
    case_map = {case["case_id"]: case for case in suite["cases"]}
    if set(case_map) != {case.case_id for case in k05.PUBLIC_SUITE}:
        raise k05.PinMismatch("K05_CASE_SOURCE_MISMATCH")
    evidence_items = []
    for task in TASKS:
        if task.task_class not in (
            "exact_extraction", "cited_summary", "conflicting_revisions",
            "multi_step", "source_code_check", "missing_evidence",
            "hard_source_limit", "stable_fact",
        ) or task.difficulty not in ("simple", "moderate", "complex"):
            raise ValueError("INVALID_SOURCE_BOUND_CASE")
        links = []
        for source_case_id in task.source_case_ids:
            result = case_map[source_case_id]
            if result["status"] != "CONFIRMED":
                raise k05.PinMismatch("TASK_SOURCE_NOT_CONFIRMED")
            links.extend(result["tested"]["observations"])
        if task.source_code_required:
            links.append(owner)
        if not links or len({(e["source_ref"], e["version"])
                             if "source_ref" in e
                             else (e["source"], e["version"]) for e in links}) < 1:
            raise k05.PinMismatch("TASK_SOURCE_MISSING")
        evidence_items.append({
            **asdict(task),
            "source_observations": links,
            "quality_gold": None,
            "model_responses": None,
            "inference_latency_ms": None,
            "inference_cost_usd": None,
            "route_selector": "NOT_SELECTED_BY_K05",
        })
    return {
        "schema": CORPUS_SCHEMA,
        "status": "VERIFIED_SOURCE_CASES_NO_MODEL_EXECUTION",
        "k02_commit": K02_OWNER_COMMIT,
        "k02_owner_source": owner,
        "case_count": len(evidence_items),
        "case_ids": [c.case_id for c in TASKS],
        "cases": evidence_items,
        "source_suite_schema": suite["schema"],
        "source_suite_verified": True,
        "unique_verified_source_versions": (
            suite["summary"]["unique_source_versions"] + 1
        ),
        "model_quality": NO_MODEL_EVIDENCE,
        "human_gold": NO_MODEL_EVIDENCE,
        "inference_cost_usd": None,
        "inference_latency_ms": None,
        "router_cost_usd": None,
        "task_f1": None,
    }


def load_owner_source(path: Path) -> bytes:
    if not path.is_file():
        raise k05.PinMismatch("K02_OWNER_CHECKOUT_UNAVAILABLE")
    return path.read_bytes()


def load_public_pins() -> dict[tuple[str, str, str], bytes]:
    """Only for reproducible public Actions; Agent uses its own source port."""
    result = {}
    for case in k05.PUBLIC_SUITE:
        for pin in case.sources:
            key = pin.repository, pin.path, pin.version
            if key not in result:
                result[key] = k05.fetch_public_pinned_source(pin)
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--k02-owner-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        parser.error("OUTPUT_EXISTS")
    corpus = build_source_corpus(
        load_public_pins(),
        load_owner_source(args.k02_owner_root / K02_OWNER_PATH),
    )
    with args.out.open("x", encoding="utf-8") as stream:
        json.dump(corpus, stream, sort_keys=True, ensure_ascii=True, indent=2)
        stream.write("\n")
    print(json.dumps({
        "status": corpus["status"],
        "source_cases": corpus["case_count"],
        "source_revisions": corpus["unique_verified_source_versions"],
        "model_quality": corpus["model_quality"],
        "human_gold": corpus["human_gold"],
        "inference_latency_ms": corpus["inference_latency_ms"],
        "inference_cost_usd": corpus["inference_cost_usd"],
    }, sort_keys=True))
