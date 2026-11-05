from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import re
import statistics
import sys
import time
from typing import Mapping
from urllib.request import Request, urlopen

SCHEMA = "IWXA_K05_COMPARISON_RESULT/0.2"
PIN_RE = re.compile(r"^[0-9a-f]{40}$")
MAX_SOURCE_BYTES = 1_000_000
LITERAL_RE = re.compile(r"^([a-z][a-z0-9_.-]{0,63})\s*[:=]\s*(true|false)$", re.IGNORECASE)


class PinMismatch(ValueError):
    pass


@dataclass(frozen=True)
class SourcePin:
    repository: str
    path: str
    version: str
    blob_sha: str
    locator_line: int
    anchor: str
    claim: str


@dataclass(frozen=True)
class EvidenceObservation:
    source: str
    version: str
    locator: str | None
    claim: str | None
    state: str
    git_blob_sha: str | None
    sha256: str
    line_sha256: str | None = None
    literal_key: str | None = None
    literal_value: bool | None = None


@dataclass(frozen=True)
class EvaluationCase:
    case_id: str
    sources: tuple[SourcePin, SourcePin]
    expected_check: str = "EVIDENCE_CHANGED"


@dataclass(frozen=True)
class ComparisonResult:
    schema: str
    case_id: str
    status: str
    baseline: dict
    tested: dict
    scope: dict
    checks: dict
    measured: dict
    unknown: dict


PUBLIC_CASE = EvaluationCase(
    case_id="K05_PUBLIC_KNOWLEDGE_SCOPE_REVISION",
    sources=(
        SourcePin(
            repository="Faust-S/knowledge",
            path="AGENTS.md",
            version="cde56571ce4344d3b2b60f94daadb2d1d4d3608b",
            blob_sha="1387d8facd3a8798f2f00c3478e0656deb151231",
            locator_line=3,
            anchor="**\u041f\u0440\u0435\u0434\u043c\u0435\u0442:** \u043a\u0430\u0442\u0430\u043b\u043e\u0433",
            claim="SPECIALIZED_AGENT_CATALOG",
        ),
        SourcePin(
            repository="Faust-S/knowledge",
            path="AGENTS.md",
            version="d298d6f50eaaab5b9b11c96bb2e10d629860fa2c",
            blob_sha="59632875266b207c35dca4afe74534c3ea39bb5f",
            locator_line=5,
            anchor="\u042d\u0442\u043e \u043d\u0435 \u0442\u043e\u043b\u044c\u043a\u043e \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0430 \u0430\u0433\u0435\u043d\u0442\u043e\u0432.",
            claim="TASK_KNOWLEDGE_AND_AGENTS",
        ),
    ),
)


CPYTHON_CASE = EvaluationCase(
    case_id="K05_CPYTHON_RELEASE_REVISION",
    sources=(
        SourcePin(
            repository="python/cpython",
            path="README.rst",
            version="0fb18b02c8ad56299d6a2910be0bab8ad601ef24",
            blob_sha="979ca01896a6db92678cb6b0eff902e329c313a6",
            locator_line=1,
            anchor="This is Python version 3.12.0",
            claim="PYTHON_RELEASE_3_12",
        ),
        SourcePin(
            repository="python/cpython",
            path="README.rst",
            version="60403a5409ff2c3f3b07dd2ca91a7a3e096839c7",
            blob_sha="7c1e463273b4185fdbe037466c04ec802c3b9696",
            locator_line=1,
            anchor="This is Python version 3.13.0",
            claim="PYTHON_RELEASE_3_13",
        ),
    ),
    expected_check="EVIDENCE_CHANGED",
)

NODE_RELEASE_CASE = EvaluationCase(
    case_id="K05_NODE_RELEASE_BRANCH_REVISION",
    sources=(
        SourcePin(
            repository="nodejs/node",
            path="README.md",
            version="12fb157f79da8c094a54bc99370994941c28c235",
            blob_sha="a3ee8b7444bfb46217a7a4413b3d2617d4b442ea",
            locator_line=46,
            anchor="[v19.x](https://github.com/nodejs/node/tree/v19.x)). Node.js releases a new",
            claim="NODE_CURRENT_BRANCH_REFERENCE_V19",
        ),
        SourcePin(
            repository="nodejs/node",
            path="README.md",
            version="c5349f43cd66d2aa02d86414c9ed426f71d3ae48",
            blob_sha="38a0afaaa363617e338ce50466adc51f13896196",
            locator_line=46,
            anchor="[v22.x](https://github.com/nodejs/node/tree/v22.x)). Node.js releases a new",
            claim="NODE_CURRENT_BRANCH_REFERENCE_V22",
        ),
    ),
    expected_check="EVIDENCE_CHANGED",
)

NODE_STABLE_CASE = EvaluationCase(
    case_id="K05_NODE_STABLE_TEXT_NEGATIVE_CONTROL",
    sources=(
        SourcePin(
            repository="nodejs/node",
            path="README.md",
            version="12fb157f79da8c094a54bc99370994941c28c235",
            blob_sha="a3ee8b7444bfb46217a7a4413b3d2617d4b442ea",
            locator_line=3,
            anchor="Node.js is an open-source, cross-platform JavaScript runtime environment.",
            claim="NODE_DESCRIPTION_STABLE",
        ),
        SourcePin(
            repository="nodejs/node",
            path="README.md",
            version="c5349f43cd66d2aa02d86414c9ed426f71d3ae48",
            blob_sha="38a0afaaa363617e338ce50466adc51f13896196",
            locator_line=3,
            anchor="Node.js is an open-source, cross-platform JavaScript runtime environment.",
            claim="NODE_DESCRIPTION_STABLE",
        ),
    ),
    expected_check="EVIDENCE_UNCHANGED",
)

PUBLIC_SUITE = (
    PUBLIC_CASE,
    CPYTHON_CASE,
    NODE_RELEASE_CASE,
    NODE_STABLE_CASE,
)
SUITE_SCHEMA = "IWXA_K05_EVALUATION_SUITE/0.1"
ALLOWED_REMOTE_PINS = frozenset(
    (pin.repository, pin.path, pin.version, pin.blob_sha)
    for case in PUBLIC_SUITE
    for pin in case.sources
)

def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\x00" + data).hexdigest()


def _validate_pin(pin: SourcePin) -> None:
    if (
        not PIN_RE.fullmatch(pin.version)
        or not PIN_RE.fullmatch(pin.blob_sha)
        or pin.locator_line <= 0
        or not pin.anchor.strip()
        or not pin.claim.strip()
        or not pin.path.strip()
    ):
        raise PinMismatch("INVALID_PIN")


def _source_ref(pin: SourcePin) -> str:
    return "https://github.com/" + pin.repository + "/blob/" + pin.version + "/" + pin.path


def verify_source(pin: SourcePin, data: bytes) -> None:
    _validate_pin(pin)
    if not isinstance(data, bytes) or len(data) > MAX_SOURCE_BYTES:
        raise PinMismatch("SOURCE_UNAVAILABLE_OR_OVERSIZED")
    if git_blob_sha(data) != pin.blob_sha:
        raise PinMismatch("SOURCE_VERSION_MISMATCH")
    try:
        data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise PinMismatch("SOURCE_ENCODING_INVALID") from error


def fetch_public_pinned_source(pin: SourcePin) -> bytes:
    _validate_pin(pin)
    if (pin.repository, pin.path, pin.version, pin.blob_sha) not in ALLOWED_REMOTE_PINS:
        raise PinMismatch("REMOTE_SOURCE_NOT_ALLOWLISTED")
    url = (
        "https://raw.githubusercontent.com/"
        + pin.repository + "/" + pin.version + "/" + pin.path
    )
    request = Request(url, headers={"User-Agent": "IWXA-K05-public-source-replay/0.1"})
    with urlopen(request, timeout=20) as reply:
        data = reply.read(MAX_SOURCE_BYTES + 1)
    verify_source(pin, data)
    return data


def _observe(pin: SourcePin, data: bytes, method: str) -> EvidenceObservation:
    lines = data.decode("utf-8").splitlines(keepends=True)
    if method == "DIRECT_READ_EXACT_SEARCH":
        matches = [i + 1 for i, line in enumerate(lines) if pin.anchor in line]
    elif method == "PINNED_LINE_EXACT":
        index = pin.locator_line - 1
        matches = [pin.locator_line] if (
            index < len(lines) and pin.anchor in lines[index]
        ) else []
    else:
        raise ValueError("UNKNOWN_METHOD")
    line = matches[0] if len(matches) == 1 else None
    observed = lines[line - 1].rstrip("\r\n") if line is not None else None
    literal = LITERAL_RE.fullmatch(observed.strip()) if observed is not None else None
    return EvidenceObservation(
        source=_source_ref(pin),
        version=pin.version,
        locator="L" + str(line) if line is not None else None,
        claim=pin.claim if line is not None else None,
        state="OBSERVED" if line is not None else "UNKNOWN",
        git_blob_sha=pin.blob_sha,
        sha256=hashlib.sha256(data).hexdigest(),
        line_sha256=hashlib.sha256(observed.encode("utf-8")).hexdigest()
        if observed is not None else None,
        literal_key=literal.group(1).lower() if literal is not None else None,
        literal_value=(literal.group(2).lower() == "true")
        if literal is not None else None,
    )


def _method(
    case: EvaluationCase, sources: Mapping[str, bytes], method: str
) -> tuple[dict, tuple[EvidenceObservation, EvidenceObservation]]:
    observations = tuple(_observe(pin, sources[pin.version], method) for pin in case.sources)
    if any(o.state == "UNKNOWN" for o in observations):
        status = "UNKNOWN"
    elif (
        observations[0].literal_key is not None
        and observations[0].literal_key == observations[1].literal_key
        and observations[0].literal_value != observations[1].literal_value
        and observations[0].literal_value is not None
        and observations[1].literal_value is not None
    ):
        status = "LITERAL_CONFLICT"
    elif observations[0].line_sha256 == observations[1].line_sha256:
        status = "EVIDENCE_UNCHANGED"
    else:
        status = "EVIDENCE_CHANGED"
    total = sum(len(sources[p.version]) for p in case.sources)
    if method == "DIRECT_READ_EXACT_SEARCH":
        review_bytes = total
    else:
        review_bytes = sum(
            len(sources[p.version].splitlines(keepends=True)[p.locator_line - 1])
            for p, o in zip(case.sources, observations)
            if o.locator is not None
        )
    return (
        {
            "method": method,
            "status": status,
            "observations": [asdict(o) for o in observations],
            "review_bytes": review_bytes,
            "source_bytes": total,
        },
        observations,
    )


def evaluate_case(
    case: EvaluationCase,
    sources: Mapping[str, bytes],
    *,
    rounds: int = 100,
) -> ComparisonResult:
    if type(rounds) is not int or rounds < 1 or rounds > 10000:
        raise ValueError("INVALID_BENCHMARK_ROUNDS")
    if case.expected_check not in {
        "LITERAL_CONFLICT", "EVIDENCE_CHANGED", "EVIDENCE_UNCHANGED"
    }:
        raise ValueError("UNSUPPORTED_EXPECTED_RELATION")
    if len(case.sources) != 2 or case.sources[0].version == case.sources[1].version:
        raise ValueError("CASE_REQUIRES_TWO_DISTINCT_VERSIONS")
    if case.sources[0].repository != case.sources[1].repository or case.sources[0].path != case.sources[1].path:
        raise ValueError("CASE_REQUIRES_SAME_SOURCE")
    for pin in case.sources:
        if pin.version not in sources:
            raise PinMismatch("SOURCE_VERSION_UNAVAILABLE")
        verify_source(pin, sources[pin.version])
    timings: dict[str, list[int]] = {
        "DIRECT_READ_EXACT_SEARCH": [],
        "PINNED_LINE_EXACT": [],
    }
    outputs: dict[str, dict] = {}
    for method in timings:
        for _ in range(rounds):
            start = time.perf_counter_ns()
            value, _ = _method(case, sources, method)
            timings[method].append(time.perf_counter_ns() - start)
        outputs[method] = value
        outputs[method]["latency_ms_median"] = round(
            statistics.median(timings[method]) / 1_000_000, 6
        )
    baseline = outputs["DIRECT_READ_EXACT_SEARCH"]
    tested = outputs["PINNED_LINE_EXACT"]
    same_observations = baseline["observations"] == tested["observations"]
    expected = (
        baseline["status"] == tested["status"] == case.expected_check
        and same_observations
    )
    status = (
        "CONFIRMED"
        if expected else "UNKNOWN"
        if baseline["status"] == "UNKNOWN" or tested["status"] == "UNKNOWN"
        else "METHOD_DISAGREEMENT"
        if not same_observations or baseline["status"] != tested["status"]
        else "EXPECTED_RELATION_NOT_OBSERVED"
    )
    return ComparisonResult(
        schema=SCHEMA,
        case_id=case.case_id,
        status=status,
        baseline=baseline,
        tested=tested,
        scope={
            "source_versions": len(case.sources),
            "source_repository": case.sources[0].repository,
            "source_path": case.sources[0].path,
            "bench_rounds": rounds,
            "source_access": "PIN_VERIFIED_BYTES",
            "relation_basis": "EXACT_LINE_DIGEST_OR_EXPLICIT_BOOLEAN_LITERAL",
            "claim_labels_semantically_validated": False,
            "pinned_locator_requires_upstream_provenance": True,
            "human_gold": False,
        },
        checks={
            "same_source_distinct_versions": True,
            "baseline_tested_agreement": same_observations and baseline["status"] == tested["status"],
            "expected_source_check": case.expected_check,
            "expected_check_met": expected,
        },
        measured={
            "review_bytes_baseline": baseline["review_bytes"],
            "review_bytes_tested": tested["review_bytes"],
            "processing_latency_ms_median_baseline": baseline["latency_ms_median"],
            "processing_latency_ms_median_tested": tested["latency_ms_median"],
            "versions_verified": 2,
        },
        unknown={
            "human_task_accuracy": None,
            "semantic_claim_accuracy": None,
            "source_revision_chronology_independently_verified": None,
            "human_completion_time_ms": None,
            "human_review_cost_usd": None,
            "compute_cost_usd": None,
            "precision": None,
            "recall": None,
            "f1": None,
            "agent_result_readback": "NOT_TESTED",
        },
    )


def verify_evidence_receipt(
    receipt: Mapping[str, object],
    case: EvaluationCase,
    sources: Mapping[str, bytes],
) -> bool:
    # Recompute evidence against pinned bytes. Timing and Agent readback are not certified.
    if not isinstance(receipt, Mapping):
        return False
    try:
        independently_computed = asdict(evaluate_case(case, sources, rounds=1))
        if any(receipt.get(key) != independently_computed[key] for key in (
            "schema", "case_id", "status", "checks", "unknown"
        )):
            return False
        for name in ("baseline", "tested"):
            received = receipt.get(name)
            if not isinstance(received, Mapping):
                return False
            without_timing = {
                key: value for key, value in received.items()
                if key != "latency_ms_median"
            }
            known = {
                key: value for key, value in independently_computed[name].items()
                if key != "latency_ms_median"
            }
            if without_timing != known:
                return False
            measured_ms = received.get("latency_ms_median")
            if (
                type(measured_ms) not in (int, float)
                or not 0 <= measured_ms < float("inf")
            ):
                return False
        scope = receipt.get("scope")
        if not isinstance(scope, Mapping):
            return False
        reported_rounds = scope.get("bench_rounds")
        if type(reported_rounds) is not int or not 1 <= reported_rounds <= 10000:
            return False
        if {
            key: value for key, value in scope.items() if key != "bench_rounds"
        } != {
            key: value for key, value in independently_computed["scope"].items()
            if key != "bench_rounds"
        }:
            return False
        measured = receipt.get("measured")
        if not isinstance(measured, Mapping):
            return False
        latency_keys = (
            "processing_latency_ms_median_baseline",
            "processing_latency_ms_median_tested",
        )
        if {
            key: value for key, value in measured.items()
            if key not in latency_keys
        } != {
            key: value for key, value in independently_computed["measured"].items()
            if key not in latency_keys
        }:
            return False
        for key in latency_keys:
            value = measured.get(key)
            if type(value) not in (int, float) or not 0 <= value < float("inf"):
                return False
        return True
    except (ValueError, KeyError, TypeError):
        return False



def _pin_key(pin: SourcePin) -> tuple[str, str, str]:
    return pin.repository, pin.path, pin.version


def _case_sources(
    case: EvaluationCase,
    sources: Mapping[tuple[str, str, str], bytes],
) -> dict[str, bytes]:
    subset: dict[str, bytes] = {}
    for pin in case.sources:
        key = _pin_key(pin)
        if key not in sources:
            raise PinMismatch("SOURCE_VERSION_UNAVAILABLE")
        subset[pin.version] = sources[key]
    return subset


def evaluate_suite(
    cases: tuple[EvaluationCase, ...],
    sources: Mapping[tuple[str, str, str], bytes],
    *,
    rounds: int = 100,
) -> dict:
    if not cases or len(cases) > 100 or len({case.case_id for case in cases}) != len(cases):
        raise ValueError("INVALID_EVALUATION_SUITE")
    results = []
    unique_pins = {}
    for case in cases:
        source_subset = _case_sources(case, sources)
        for pin in case.sources:
            key = _pin_key(pin)
            if key in unique_pins and unique_pins[key] != pin.blob_sha:
                raise PinMismatch("SOURCE_PIN_INCONSISTENT")
            unique_pins[key] = pin.blob_sha
        result = asdict(evaluate_case(case, source_subset, rounds=rounds))
        if not verify_evidence_receipt(result, case, source_subset):
            raise PinMismatch("RECEIPT_EVIDENCE_MISMATCH")
        results.append(result)

    confirmed = sum(r["status"] == "CONFIRMED" for r in results)
    status = "PASS" if confirmed == len(cases) else "HOLD"
    summary = {
        "case_count": len(cases),
        "confirmed_cases": confirmed,
        "baseline_agreement_count": sum(
            r["checks"]["baseline_tested_agreement"] for r in results
        ),
        "evidence_changed_cases": sum(
            r["tested"]["status"] == "EVIDENCE_CHANGED" for r in results
        ),
        "evidence_unchanged_cases": sum(
            r["tested"]["status"] == "EVIDENCE_UNCHANGED" for r in results
        ),
        "literal_conflict_cases": sum(
            r["tested"]["status"] == "LITERAL_CONFLICT" for r in results
        ),
        "review_payload_bytes_baseline": sum(
            r["baseline"]["review_bytes"] for r in results
        ),
        "review_payload_bytes_tested": sum(
            r["tested"]["review_bytes"] for r in results
        ),
        "unique_source_versions": len(unique_pins),
        "unique_repositories": len({k[0] for k in unique_pins}),
    }
    return {
        "schema": SUITE_SCHEMA,
        "status": status,
        "bench_rounds": rounds,
        "scope": {
            "corpus_selection": "CURATED_SOURCE_PINS_NO_INDEPENDENT_GOLD",
            "baseline": "DIRECT_READ_EXACT_SEARCH",
            "tested": "PINNED_LINE_EXACT",
            "baseline_has_no_line_locator": True,
            "tested_has_curated_line_locator": True,
            "human_gold": False,
            "source_access": "PIN_VERIFIED_BYTES",
        },
        "summary": summary,
        "source_pins": [
            {
                "repository": key[0],
                "path": key[1],
                "version": key[2],
                "git_blob_sha": blob,
            }
            for key, blob in sorted(unique_pins.items())
        ],
        "cases": results,
        "unknown": {
            "human_task_accuracy": None,
            "human_completion_time_ms": None,
            "human_review_cost_usd": None,
            "independent_semantic_gold": None,
            "real_agent_result_readback": "NOT_TESTED",
        },
    }


def verify_suite_receipt(
    receipt: Mapping[str, object],
    cases: tuple[EvaluationCase, ...],
    sources: Mapping[tuple[str, str, str], bytes],
) -> bool:
    if not isinstance(receipt, Mapping):
        return False
    try:
        # Recompute each evidence case independently. Timing measurements are
        # not independently authenticated by a portable source proof.
        recomputed = evaluate_suite(cases, sources, rounds=1)
        if set(receipt) != set(recomputed):
            return False
        for key in ("schema", "status", "scope", "summary", "source_pins", "unknown"):
            if receipt.get(key) != recomputed[key]:
                return False
        rounds = receipt.get("bench_rounds")
        if type(rounds) is not int or not 1 <= rounds <= 10000:
            return False
        case_receipts = receipt.get("cases")
        if not isinstance(case_receipts, list) or len(case_receipts) != len(cases):
            return False
        for case, result in zip(cases, case_receipts):
            if not isinstance(result, Mapping):
                return False
            if result.get("scope", {}).get("bench_rounds") != rounds:
                return False
            if not verify_evidence_receipt(result, case, _case_sources(case, sources)):
                return False
        return True
    except (ValueError, KeyError, TypeError, AttributeError):
        return False


def public_suite_replay(*, rounds: int = 100) -> dict:
    source_map: dict[tuple[str, str, str], bytes] = {}
    for case in PUBLIC_SUITE:
        for pin in case.sources:
            key = _pin_key(pin)
            if key not in source_map:
                source_map[key] = fetch_public_pinned_source(pin)
    receipt = evaluate_suite(PUBLIC_SUITE, source_map, rounds=rounds)
    if not verify_suite_receipt(receipt, PUBLIC_SUITE, source_map):
        raise PinMismatch("SUITE_RECEIPT_MISMATCH")
    return receipt



OFFSET_PROJECTION_SCHEMA = "IWXA_K05_SOURCE_OFFSET_PROJECTION/0.1"


def project_k03_issue_evidence(
    bundle: Mapping[str, object], source_bytes: bytes, *,
    manifest_bytes: bytes, expected_manifest_git_blob: str,
) -> dict:
    """Project verified source bytes/offsets, not task truth or U1 decisions.

    The caller obtains the K03 bundle and source bytes from the owning replay.
    The expected manifest blob must come from a trusted owner pin, not bundle.
    """
    if not isinstance(bundle, Mapping) or bundle.get("schema") != (
        "IWXA_K03_PUBLIC_ISSUE_DISCOVERY/0.1.0"
    ):
        raise PinMismatch("K03_SOURCE_BUNDLE_UNSUPPORTED")
    if (type(manifest_bytes) is not bytes
        or len(manifest_bytes) > MAX_SOURCE_BYTES
        or type(expected_manifest_git_blob) is not str
        or PIN_RE.fullmatch(expected_manifest_git_blob) is None
        or git_blob_sha(manifest_bytes) != expected_manifest_git_blob
        or bundle.get("source_manifest_git_blob") != expected_manifest_git_blob):
        raise PinMismatch("SOURCE_MANIFEST_VERSION_CHANGED")
    try:
        selection = json.loads(manifest_bytes.decode("utf-8", "strict"))
    except (ValueError, UnicodeError) as exc:
        raise PinMismatch("SOURCE_MANIFEST_INVALID") from None
    if (type(selection) is not dict
        or selection.get("schema") != "IWXA_TASK_EXP_01_PUBLIC_ISSUE_SOURCE_SLICE/0.1"
        or selection.get("no_gold") is not True
        or type(selection.get("items")) is not list):
        raise PinMismatch("SOURCE_MANIFEST_INVALID")

    source_ref, source_sha = bundle.get("source_ref"), bundle.get("source_sha256")
    if (type(source_ref) is not str or not source_ref.startswith("https://github.com/")
        or type(source_sha) is not str
        or re.fullmatch(r"[0-9a-f]{64}", source_sha) is None
        or type(bundle.get("case_id")) is not str):
        raise PinMismatch("SOURCE_IDENTITY_INVALID")
    matching = [row for row in selection["items"]
                if type(row) is dict and row.get("html_url") == source_ref]
    if len(matching) != 1:
        raise PinMismatch("SOURCE_NOT_IN_PINNED_SELECTION")
    row = matching[0]
    if (row.get("projection_sha256") != source_sha
        or row.get("source_projection") != "TITLE_NEWLINE_BODY_NEWLINE_UTF8"
        or type(row.get("projection_bytes")) is not int):
        raise PinMismatch("SOURCE_MANIFEST_BINDING_CHANGED")
    if (type(source_bytes) is not bytes
        or len(source_bytes) > MAX_SOURCE_BYTES
        or len(source_bytes) != row["projection_bytes"]
        or hashlib.sha256(source_bytes).hexdigest() != source_sha):
        raise PinMismatch("SOURCE_VERSION_MISMATCH")
    try:
        source_bytes.decode("utf-8", "strict")
    except UnicodeError as exc:
        raise PinMismatch("SOURCE_ENCODING_INVALID") from None
    # K03 owns evidence->hypothesis interpretation and native U1 replay.
    # Refuse to upgrade a task or claim human gold from an untrusted bundle.
    if (bundle.get("human_task_gold") is not False
        or bundle.get("accepted_task_count") != 0
        or bundle.get("task_type_accepted") is not False
        or bundle.get("source_text_exported") is not False):
        raise PinMismatch("TASK_AUTHORITY_NOT_SOURCE_EVIDENCE")
    rows = bundle.get("activity_observations")
    if type(rows) is not list or not 1 <= len(rows) <= 100:
        raise PinMismatch("INVALID_SOURCE_OBSERVATIONS")
    exported = []
    seen = set()
    cue_excerpt_bytes = 0
    for obs in rows:
        if type(obs) is not dict:
            raise PinMismatch("INVALID_SOURCE_OBSERVATIONS")
        eid = obs.get("id")
        if (type(eid) is not str or not eid or eid in seen
            or obs.get("source_ref") != source_ref
            or obs.get("source_sha256") != source_sha
            or obs.get("source_version") != expected_manifest_git_blob):
            raise PinMismatch("SOURCE_OBSERVATION_REVISION_CHANGED")
        if any(key in obs for key in (
            "claim", "claim_verified", "task_accepted", "semantic_truth"
        )):
            raise PinMismatch("UNSUPPORTED_SEMANTIC_ASSERTION")
        seen.add(eid)
        locator = obs.get("locator")
        if type(locator) is not dict or set(locator) != {"byte_start", "byte_end"}:
            raise PinMismatch("SOURCE_LOCATOR_INVALID")
        start, end = locator["byte_start"], locator["byte_end"]
        if (type(start) is not int or type(end) is not int
            or not 0 <= start < end <= len(source_bytes)):
            raise PinMismatch("SOURCE_LOCATOR_INVALID")
        span_digest = hashlib.sha256(source_bytes[start:end]).hexdigest()
        if "asserted_span_sha256" in obs and obs["asserted_span_sha256"] != span_digest:
            raise PinMismatch("ASSERTED_SPAN_NOT_SOURCE_BOUND")
        cue = obs.get("cue_kind")
        if cue is not None:
            if type(cue) is not str or not cue:
                raise PinMismatch("SOURCE_CUE_METADATA_INVALID")
            cue_excerpt_bytes += end - start
        exported.append({
            "id": eid,
            "source_span_sha256": span_digest,
            "observation": asdict(EvidenceObservation(
                source=source_ref, version=source_sha,
                locator=f"bytes:{start}-{end}", claim=None,
                state="OBSERVED", git_blob_sha=None, sha256=source_sha,
            )),
        })
    return {
        "schema": OFFSET_PROJECTION_SCHEMA,
        "status": "PINNED_SOURCE_SPANS_VERIFIED_SEMANTICS_NOT_MEASURED",
        "case_id": bundle["case_id"],
        "source_ref": source_ref,
        "source_sha256": source_sha,
        "source_manifest_git_blob": expected_manifest_git_blob,
        "evidence_observations": exported,
        "measured": {
            "source_integrity_scan_bytes": len(source_bytes),
            "direct_read_reference_bytes": len(source_bytes),
            "pinned_cue_excerpt_bytes": cue_excerpt_bytes,
            "observation_count": len(exported),
        },
        "scope": {
            "source_sha256_verified": True,
            "manifest_git_blob_verified": True,
            "source_locator_verified": True,
            "k03_native_u1_replayed_by_k05": False,
            "k03_hypotheses_verified_by_k05": False,
            "cue_span_meaning_verified": False,
            "curated_locator_cost_included": False,
            "source_fetch_cost_included": False,
        },
        "unknown": {
            "human_task_gold": False,
            "task_precision": None, "task_recall": None, "task_f1": None,
            "human_task_completion_ms": None, "semantic_claim_accuracy": None,
            "agent_result_readback": "NOT_TESTED",
        },
    }


def verify_k03_source_projection(
    receipt: Mapping[str, object], bundle: Mapping[str, object],
    source_bytes: bytes, *, manifest_bytes: bytes,
    expected_manifest_git_blob: str,
) -> bool:
    """Portable recheck of K05 source proof; no independent task adjudication."""
    try:
        return receipt == project_k03_issue_evidence(
            bundle, source_bytes, manifest_bytes=manifest_bytes,
            expected_manifest_git_blob=expected_manifest_git_blob)
    except (PinMismatch, TypeError, ValueError, KeyError):
        return False


def public_replay(*, rounds: int = 100) -> ComparisonResult:
    sources = {pin.version: fetch_public_pinned_source(pin) for pin in PUBLIC_CASE.sources}
    result = evaluate_case(PUBLIC_CASE, sources, rounds=rounds)
    if not verify_evidence_receipt(asdict(result), PUBLIC_CASE, sources):
        raise PinMismatch("RECEIPT_EVIDENCE_MISMATCH")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--rounds", type=int, default=100)
    parser.add_argument("--suite", action="store_true")
    args = parser.parse_args()
    try:
        result = (
            public_suite_replay(rounds=args.rounds)
            if args.suite else asdict(public_replay(rounds=args.rounds))
        )
        with args.out.open("x", encoding="utf-8") as stream:
            json.dump(result, stream, ensure_ascii=True, indent=2, sort_keys=True)
            stream.write("\n")
        if args.suite:
            report = {
                "schema": result["schema"],
                "status": result["status"],
                "confirmed_cases": result["summary"]["confirmed_cases"],
                "case_count": result["summary"]["case_count"],
                "source_versions": result["summary"]["unique_source_versions"],
                "repositories": result["summary"]["unique_repositories"],
                "human_gold": False,
            }
            good = result["status"] == "PASS"
        else:
            report = {
                "schema": result["schema"],
                "status": result["status"],
                "versions_verified": result["measured"]["versions_verified"],
                "baseline_tested_agreement": result["checks"]["baseline_tested_agreement"],
                "human_gold": False,
            }
            good = result["status"] == "CONFIRMED"
        print(json.dumps(report, sort_keys=True))
        return 0 if good else 2
    except (ValueError, OSError) as exc:
        error = str(exc) if isinstance(exc, PinMismatch) else "SOURCE_OR_ENVIRONMENT_UNAVAILABLE"
        print(json.dumps({"status": "HOLD", "code": error}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
