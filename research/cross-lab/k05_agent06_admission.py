"""K05 high-confidence comparisons: replay source bytes and owner provenance.

This is an admission wrapper around the existing K05 evaluator, not a second
quality evaluator, Store or operational event system. Trusted Agent/domain
owners must independently validate source records, Task/Result bindings,
activity facts, comparability evidence and actual invoices. K05 never
turns before/after association into causal attribution.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
import json
from typing import Mapping

from k05_agent06_effectiveness import (
    K05EffectivenessHold, OwnerVerify, _need, _proofs, _sha,
    compare_process_phases, compare_task_executors, observe_run,
)

CONTRACT = "IWXA_K05_SOURCE_REPLAY_COMPARISON/0.1"
POPULATION_KIND = "DOMAIN_FACT"


def _population_digest(observations: list[dict]) -> str:
    """Fingerprint exact owner-bound cohort composition, without raw IDs."""
    rows = [{
        "run": row["run_id_sha256"],
        "task": row["task_sha256"],
        "result": row["result_sha256"],
        "acceptance": row["acceptance"],
    } for row in observations]
    encoded = json.dumps(sorted(rows, key=lambda row: row["run"]),
                         sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256(encoded).hexdigest()


def _instant(value: object) -> datetime:
    _need(type(value) is str and bool(value), "POPULATION_TIME_INVALID")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise K05EffectivenessHold("K05_EFFECTIVENESS_POPULATION_TIME_INVALID") from exc
    _need(parsed.tzinfo is not None and parsed.utcoffset() is not None,
          "POPULATION_TIME_INVALID")
    return parsed.astimezone(timezone.utc)


def _admit_population(
    evidence: dict, before: list[dict], after: list[dict],
    *, source_bytes: Mapping[str, bytes], owner_verify: OwnerVerify,
) -> dict:
    """Accept only an original owner-verified *observational* coverage audit.

    Audit owner must link exact input runs to original process/case source,
    verify case classification, timestamps, all cost components and exposure.
    Merely claiming "comparable" without an original proof is insufficient.
    """
    _need(type(evidence) is dict and
          set(evidence) == {"ref", "sha256", "kind"},
          "POPULATION_PIN_REQUIRED")
    _need(evidence["kind"] == POPULATION_KIND,
          "POPULATION_SOURCE_KIND_INVALID")
    proofs = _proofs([evidence], source_bytes, owner_verify)
    proof = proofs[evidence["ref"]][1]
    values = proof["values"]
    _need(proof["status"] == "OBSERVED"
          and proof.get("task_sha256") is None
          and proof.get("result_sha256") is None,
          "POPULATION_OWNER_SCOPE_INVALID")
    currency = before[0]["currency"]
    cohort = before[0]["cohort_sha256"]
    _need(values.get("purpose") == "IWXA_PROCESS_COMPARISON"
          and values.get("currency") == currency
          and values.get("cohort_sha256") == cohort
          and values.get("before_population_sha256") == _population_digest(before)
          and values.get("after_population_sha256") == _population_digest(after)
          and values.get("full_cost_coverage") is True
          and values.get("same_case_definition") is True
          and values.get("case_mix_before_sha256") == values.get("case_mix_after_sha256")
          and _sha(values.get("case_mix_before_sha256"))
          and values.get("original_source_readback") is True
          and values.get("plan_or_forecast_included") is False,
          "POPULATION_INCOMPARABLE_OR_INCOMPLETE")
    before_start = _instant(values.get("before_start"))
    before_end = _instant(values.get("before_end"))
    after_start = _instant(values.get("after_start"))
    after_end = _instant(values.get("after_end"))
    _need(before_start < before_end <= after_start < after_end,
          "POPULATION_PERIOD_ORDER_INVALID")
    return {
        "status": "OWNER_REPORTED_COMPARABLE_OBSERVATIONS",
        "exact_run_membership_verified": True,
        "same_case_definition": True,
        "matched_case_mix_owner_reported": True,
        "full_cost_coverage_owner_reported": True,
        "source_kind": POPULATION_KIND,
    }


def compare_verified_task_runs(
    baseline_run: dict, alternative_run: dict, *,
    source_bytes: Mapping[str, bytes], owner_verify: OwnerVerify,
) -> dict:
    """Re-evaluate source bytes for two executors; never trust projections."""
    a = observe_run(baseline_run, source_bytes=source_bytes,
                    owner_verify=owner_verify)
    b = observe_run(alternative_run, source_bytes=source_bytes,
                    owner_verify=owner_verify)
    result = compare_task_executors(a, b)
    return {
        "schema": CONTRACT, "kind": "EXECUTOR_PAIR",
        "source_replayed": True,
        "comparison": result,
        "accepted_result_comparison_status": (
            "TWO_HUMAN_OR_DOMAIN_ACCEPTED_RESULTS"
            if result["status"] == "SOURCE_BOUND_COMPARABLE"
            and result["acceptance"] == ["ACCEPTED", "ACCEPTED"]
            else "NOT_MEASURABLE"
        ),
        "causal_effect": "NOT_MEASURABLE",
    }


def compare_verified_process_runs(
    before_runs: list[dict], after_runs: list[dict], *,
    source_bytes: Mapping[str, bytes], owner_verify: OwnerVerify,
    investment: dict | None, comparison_evidence: dict | None,
) -> dict:
    """Calculate accounting ROI only after full original source replay.

    No inferred cost, no forecast, no pseudo-ROI from caller-provided
    projections, no extrapolation for volume/case-mix differences. ROI is
    observational, not attributable to IWXA without a causal design.
    """
    _need(type(before_runs) is list and type(after_runs) is list
          and 0 < len(before_runs) <= 1000 and 0 < len(after_runs) <= 1000,
          "PROCESS_RUNS_INVALID")
    before = [observe_run(run, source_bytes=source_bytes,
                          owner_verify=owner_verify) for run in before_runs]
    after = [observe_run(run, source_bytes=source_bytes,
                         owner_verify=owner_verify) for run in after_runs]
    report = compare_process_phases(
        before, after, investment=investment,
        source_bytes=source_bytes, owner_verify=owner_verify)
    population = None if comparison_evidence is None else _admit_population(
        comparison_evidence, before, after,
        source_bytes=source_bytes, owner_verify=owner_verify)
    comparable = report["comparability"]["equal_run_and_accepted_counts"]
    known_spend = report["comparability"]["known_complete_operating_spend"]
    invested = report["investment_minor"]
    # If the owner did not supply independent coverage proof, or any observed
    # cost is unknown, we preserve the UNKNOWN result, never assume a zero.
    if (population is not None and comparable and known_spend and
            invested is not None and invested > 0):
        before_cost = report["before"]["totals"]["actual_cost_minor"]
        after_cost = report["after"]["totals"]["actual_cost_minor"]
        net = before_cost - after_cost - invested
        roi = str((Decimal(100) * Decimal(net) / Decimal(invested)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP))
        report["observed_accounting_net_minor"] = net
        report["observed_accounting_roi_percent"] = roi
        report["roi_status"] = "OBSERVATIONAL_ONLY"
        report["roi_missing_requirements"] = []
    missing = []
    if population is None:
        missing.append("OWNER_VERIFIED_POPULATION_COMPARABILITY")
    if not comparable:
        missing.append("MATCHED_ACCEPTED_RESULT_DENOMINATORS")
    if not known_spend:
        missing.append("COMPLETE_OBSERVED_OPERATING_SPEND")
    if invested is None or invested <= 0:
        missing.append("POSITIVE_PAID_IMPLEMENTATION_INVOICE")
    report["roi_missing_requirements"] = missing
    report["status"] = "ORIGINAL_SOURCE_REPLAYED_ACCOUNTING_COMPARISON"
    report["population_audit"] = population or {
        "status": "UNKNOWN", "exact_run_membership_verified": False,
    }
    report["source_replayed"] = True
    report["roi_attributable_to_iwxa"] = "NOT_MEASURABLE"
    return {
        "schema": CONTRACT,
        "kind": "PROCESS_OBSERVATIONAL_ACCOUNTING",
        "source_replayed": True,
        "comparison": report,
    }
