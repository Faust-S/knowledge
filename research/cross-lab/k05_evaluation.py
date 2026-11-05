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

SCHEMA = "IWXA_K05_COMPARISON_RESULT/0.1"
PIN_RE = re.compile(r"^[0-9a-f]{40}$")
MAX_SOURCE_BYTES = 1_000_000


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
    git_blob_sha: str
    sha256: str


@dataclass(frozen=True)
class EvaluationCase:
    case_id: str
    sources: tuple[SourcePin, SourcePin]
    expected_check: str = "CONFLICT"


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
    if pin.repository != "Faust-S/knowledge" or pin.path != "AGENTS.md":
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
    return EvidenceObservation(
        source=_source_ref(pin),
        version=pin.version,
        locator="L" + str(line) if line is not None else None,
        claim=pin.claim if line is not None else None,
        state="OBSERVED" if line is not None else "UNKNOWN",
        git_blob_sha=pin.blob_sha,
        sha256=hashlib.sha256(data).hexdigest(),
    )


def _method(
    case: EvaluationCase, sources: Mapping[str, bytes], method: str
) -> tuple[dict, tuple[EvidenceObservation, EvidenceObservation]]:
    observations = tuple(_observe(pin, sources[pin.version], method) for pin in case.sources)
    if any(o.state == "UNKNOWN" for o in observations):
        status = "UNKNOWN"
    elif observations[0].claim != observations[1].claim:
        status = "CONFLICT"
        observations = tuple(
            EvidenceObservation(**{**asdict(o), "state": "CONFLICT"})
            for o in observations
        )
    else:
        status = "AGREEMENT"
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
    if rounds < 1 or rounds > 10000:
        raise ValueError("INVALID_BENCHMARK_ROUNDS")
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
            "human_gold": False,
        },
        checks={
            "same_source_distinct_versions": True,
            "baseline_tested_agreement": same_observations,
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
            "human_completion_time_ms": None,
            "human_review_cost_usd": None,
            "compute_cost_usd": None,
            "precision": None,
            "recall": None,
            "f1": None,
            "agent_result_readback": "NOT_TESTED",
        },
    )


def public_replay(*, rounds: int = 100) -> ComparisonResult:
    sources = {pin.version: fetch_public_pinned_source(pin) for pin in PUBLIC_CASE.sources}
    return evaluate_case(PUBLIC_CASE, sources, rounds=rounds)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--rounds", type=int, default=100)
    args = parser.parse_args()
    try:
        result = asdict(public_replay(rounds=args.rounds))
        with args.out.open("x", encoding="utf-8") as stream:
            json.dump(result, stream, ensure_ascii=True, indent=2, sort_keys=True)
            stream.write("\n")
        print(json.dumps({
            "schema": result["schema"],
            "status": result["status"],
            "versions_verified": result["measured"]["versions_verified"],
            "baseline_tested_agreement": result["checks"]["baseline_tested_agreement"],
            "human_gold": False,
        }, sort_keys=True))
        return 0 if result["status"] == "CONFIRMED" else 2
    except (ValueError, OSError) as exc:
        error = str(exc) if isinstance(exc, PinMismatch) else "SOURCE_OR_ENVIRONMENT_UNAVAILABLE"
        print(json.dumps({"status": "HOLD", "code": error}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
