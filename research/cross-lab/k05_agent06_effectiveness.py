"""K05 source-bound effectiveness calculations for already-completed IWXA work.

No Core/Task/Activity/BI runtime or persistence is created here. The trusted
owner supplies exact bytes and an owner-side verification port; K05 rehashes
every claimed fact and never promotes hash equality into business truth.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
from typing import Callable, Mapping
import re

from k05_agent05_final_result_binding import verify_saved_graph_final_projection

SCHEMA = "IWXA_K05_EFFECTIVENESS_OBSERVATION/0.1"
PAIR_SCHEMA = "IWXA_K05_EFFECTIVENESS_TASK_PAIR/0.1"
PROCESS_SCHEMA = "IWXA_K05_EFFECTIVENESS_PROCESS_COMPARISON/0.1"
HEX = re.compile(r"^[0-9a-f]{64}$")
ID = re.compile(r"^[a-zA-Z][a-zA-Z0-9._-]{0,79}$")
SOURCE_KINDS = frozenset({
    "EXECUTION_USAGE", "TIME_TRACKING", "HUMAN_REVIEW", "DOMAIN_ACCEPTANCE",
    "TOOL_RECEIPT", "ACTIVITY", "DOMAIN_FACT", "ATLAS_PLAN_FACT", "COST_INVOICE",
})
ACCEPTANCE_KINDS = frozenset({"HUMAN_REVIEW", "DOMAIN_ACCEPTANCE"})
METRICS = frozenset({
    "elapsed_ms", "human_active_ms", "retry_count", "return_count",
    "error_count", "intervention_count", "actual_cost_minor",
    "input_tokens", "output_tokens",
})
MAX_VALUE = 10**15
MAX_EVIDENCE = 128
MAX_SOURCE_BYTES = 2_000_000
OwnerVerify = Callable[[str, str, bytes], dict]


class K05EffectivenessHold(ValueError):
    pass


def _need(condition: bool, code: str) -> None:
    if not condition:
        raise K05EffectivenessHold("K05_EFFECTIVENESS_" + code)


def _digest(value: bytes) -> str:
    return sha256(value).hexdigest()


def _sha(value) -> bool:
    return type(value) is str and HEX.fullmatch(value) is not None


def _integer(value) -> bool:
    return type(value) is int and 0 <= value <= MAX_VALUE


def _id(value) -> bool:
    return type(value) is str and ID.fullmatch(value) is not None


def _proofs(evidence: list, source_bytes: Mapping[str, bytes],
            owner_verify: OwnerVerify) -> dict:
    """Proofs returned by the *trusted* source owner, not untrusted event JSON.

    The callback must validate original owner contracts, authority, provenance,
    sourceTruth/epistemic state, and cold readback where required. K05 cannot
    independently establish those facts merely by checking a digest.
    """
    _need(callable(owner_verify), "OWNER_VERIFIER_REQUIRED")
    _need(type(evidence) is list and len(evidence) <= MAX_EVIDENCE,
          "EVIDENCE_LIST_INVALID")
    result = {}
    for pin in evidence:
        _need(type(pin) is dict and set(pin) == {"ref", "kind", "sha256"},
              "EVIDENCE_PIN_FIELDS")
        ref, kind, expected = pin["ref"], pin["kind"], pin["sha256"]
        _need(_id(ref) and ref not in result and kind in SOURCE_KINDS
              and _sha(expected), "EVIDENCE_PIN_INVALID")
        raw = source_bytes.get(ref)
        _need(type(raw) is bytes and 0 < len(raw) <= MAX_SOURCE_BYTES
              and _digest(raw) == expected, "SOURCE_BYTES_MISMATCH")
        proof = owner_verify(ref, kind, raw)
        _need(type(proof) is dict and proof.get("verified") is True
              and proof.get("kind") == kind and proof.get("source_sha256") == expected
              and proof.get("epistemic_status") == "OBSERVED"
              and type(proof.get("values")) is dict,
              "OWNER_PROOF_INVALID")
        _need(proof.get("status") in {
            "OBSERVED", "ACCEPTED", "REJECTED", "SUCCEEDED", "FAILED", "UNKNOWN"
        }, "OWNER_STATUS_INVALID")
        for key in ("task_sha256", "result_sha256"):
            _need(proof.get(key) is None or _sha(proof[key]),
                  "OWNER_BINDING_INVALID")
        result[ref] = (kind, proof)
    return result


def _verified_measurement(name: str, claim: dict, proofs: dict,
                          task_sha256: str, result_sha256: str | None,
                          currency: str) -> int:
    _need(name in METRICS and type(claim) is dict and
          set(claim) == {"value", "source_ref"}, "METRIC_SHAPE_INVALID")
    value, ref = claim["value"], claim["source_ref"]
    _need(_integer(value) and ref in proofs, "METRIC_VALUE_OR_SOURCE_INVALID")
    kind, owner = proofs[ref]
    _need(kind not in ACCEPTANCE_KINDS and kind != "TOOL_RECEIPT",
          "METRIC_SOURCE_KIND_INVALID")
    _need(owner["status"] == "OBSERVED"
          and owner["values"].get(name) == value
          and owner.get("task_sha256") == task_sha256
          and owner.get("result_sha256") == result_sha256,
          "METRIC_NOT_OWNER_BOUND")
    if name == "actual_cost_minor":
        _need(kind == "COST_INVOICE" and owner.get("currency") == currency,
              "COST_CURRENCY_OR_SOURCE_INVALID")
    return value


def observe_run(run: dict, *, source_bytes: Mapping[str, bytes],
                owner_verify: OwnerVerify, graph_final_bytes: dict | None = None) -> dict:
    """Observe a single Result; no model selection, scoring, or Task mutation.

    No acceptance is inferred from a completed Graph. Exact Human Review or
    domain acceptance must be verified by the original owner readback port.
    """
    expected = {
        "run_id", "task_sha256", "input_sha256", "cohort_sha256", "result_sha256",
        "executor", "executor_kind", "phase", "currency", "evidence",
        "measurements", "accepted", "tool_receipt_refs",
    }
    _need(type(run) is dict and set(run) == expected, "RUN_FIELDS_CHANGED")
    _need(_id(run["run_id"]) and all(_sha(run[k]) for k in (
        "task_sha256", "input_sha256", "cohort_sha256", "result_sha256"))
        and type(run["executor"]) is str and 0 < len(run["executor"]) <= 128
        and run["executor_kind"] in {"MODEL", "AGENT", "PROGRAM", "HUMAN", "PROCESS"}
        and run["phase"] in {"RUN", "BEFORE", "AFTER"}
        and run["currency"] in {"USD", "RUB", "EUR", "GBP"},
        "RUN_IDENTITY_INVALID")
    proofs = _proofs(run["evidence"], source_bytes, owner_verify)
    raw_facts = run["measurements"]
    _need(type(raw_facts) is dict and set(raw_facts) <= METRICS,
          "METRIC_FIELDS_INVALID")
    measured = {key: _verified_measurement(
        key, claim, proofs, run["task_sha256"], run["result_sha256"],
        run["currency"]) for key, claim in raw_facts.items()}
    accepted = run["accepted"]
    _need(type(accepted) is dict and set(accepted) == {"value", "source_ref"},
          "ACCEPTANCE_FIELDS_INVALID")
    value, ref = accepted["value"], accepted["source_ref"]
    _need(value is None or type(value) is bool, "ACCEPTANCE_INVALID")
    if value is None:
        _need(ref is None, "UNKNOWN_ACCEPTANCE_HAS_SOURCE")
        acceptance = "UNKNOWN"
    else:
        _need(ref in proofs and proofs[ref][0] in ACCEPTANCE_KINDS,
              "ACCEPTANCE_SOURCE_MISSING")
        proof = proofs[ref][1]
        _need(proof.get("task_sha256") == run["task_sha256"]
              and proof.get("result_sha256") == run["result_sha256"]
              and proof["status"] == ("ACCEPTED" if value else "REJECTED"),
              "ACCEPTANCE_NOT_OWNER_BOUND")
        acceptance = "ACCEPTED" if value else "REJECTED"

    receipts = run["tool_receipt_refs"]
    _need(type(receipts) is list and len(receipts) <= MAX_EVIDENCE
          and len(receipts) == len(set(receipts)), "TOOL_REFS_INVALID")
    statuses = []
    for ref in receipts:
        _need(ref in proofs and proofs[ref][0] == "TOOL_RECEIPT",
              "TOOL_RECEIPT_UNVERIFIED")
        proof = proofs[ref][1]
        _need(proof.get("task_sha256") == run["task_sha256"]
              and proof.get("result_sha256") in (None, run["result_sha256"])
              and proof["status"] in {"SUCCEEDED", "FAILED", "UNKNOWN"},
              "TOOL_RECEIPT_UNBOUND")
        statuses.append(proof["status"])

    graph_status = "NOT_SUPPLIED"
    if graph_final_bytes is not None:
        _need(type(graph_final_bytes) is dict, "GRAPH_BUNDLE_INVALID")
        graph = verify_saved_graph_final_projection(**graph_final_bytes)
        _need(graph["full_text_sha256"] == run["result_sha256"],
              "GRAPH_RESULT_MISMATCH")
        graph_status = graph["status"]
    # Evidence refs, executor labels, source bytes and proof payloads never
    # leave this projection. This is a public-safe shape, not permission to
    # transmit sensitive counts or money to an external collector.
    return {
        "schema": SCHEMA,
        "run_id_sha256": _digest(run["run_id"].encode()),
        "task_sha256": run["task_sha256"],
        "input_sha256": run["input_sha256"],
        "cohort_sha256": run["cohort_sha256"],
        "result_sha256": run["result_sha256"],
        "executor_sha256": _digest(run["executor"].encode()),
        "executor_kind": run["executor_kind"],
        "phase": run["phase"],
        "currency": run["currency"],
        "acceptance": acceptance,
        "metrics": {key: measured.get(key) for key in sorted(METRICS)},
        "metric_status": {key: "OBSERVED" if key in measured else "UNKNOWN"
                          for key in sorted(METRICS)},
        "tool_receipts": {
            "total": len(statuses), "succeeded": statuses.count("SUCCEEDED"),
            "failed": statuses.count("FAILED"), "unknown": statuses.count("UNKNOWN"),
        },
        "graph_binding": graph_status,
        "evidence_pin_count": len(proofs),
        "qualification": "OWNER_VERIFIER_PORT_REPORTED_NOT_INDEPENDENTLY_ATTESTED",
        "attributable_benefit": "NOT_MEASURABLE",
    }


def compare_task_executors(baseline: dict, alternative: dict) -> dict:
    """Allow different executors; hold on changed task, inputs or cohort.

    This is NOT the strict same-model K05 ablation gate, nor a model ranking.
    """
    for obj in (baseline, alternative):
        _need(type(obj) is dict and obj.get("schema") == SCHEMA,
              "TASK_OBSERVATION_REQUIRED")
    comparable = (
        baseline["task_sha256"] == alternative["task_sha256"]
        and baseline["input_sha256"] == alternative["input_sha256"]
        and baseline["cohort_sha256"] == alternative["cohort_sha256"]
        and baseline["currency"] == alternative["currency"]
        and baseline["run_id_sha256"] != alternative["run_id_sha256"]
    )
    metric_deltas = {}
    for metric in sorted(METRICS):
        a, b = baseline["metrics"][metric], alternative["metrics"][metric]
        metric_deltas[metric] = b - a if comparable and a is not None and b is not None else None
    return {
        "schema": PAIR_SCHEMA,
        "status": "SOURCE_BOUND_COMPARABLE" if comparable else "NOT_COMPARABLE",
        "acceptance": [baseline["acceptance"], alternative["acceptance"]],
        "executor_sha256": [baseline["executor_sha256"], alternative["executor_sha256"]],
        "tool_receipts": [baseline["tool_receipts"], alternative["tool_receipts"]],
        "metric_deltas_alternative_minus_baseline": metric_deltas,
        "result_quality_ranking": "NOT_MEASURABLE",
        "causal_benefit": "NOT_MEASURABLE",
    }


def _phase(observations: list, phase: str) -> dict:
    accepted = sum(row["acceptance"] == "ACCEPTED" for row in observations)
    unknown = sum(row["acceptance"] == "UNKNOWN" for row in observations)
    totals = {}
    for name in sorted(METRICS):
        values = [row["metrics"][name] for row in observations]
        totals[name] = sum(values) if values and all(v is not None for v in values) else None
    spend = totals["actual_cost_minor"]
    unit_cost = (str((Decimal(spend) / Decimal(accepted)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP))
        if spend is not None and accepted > 0 and unknown == 0 else None)
    return {
        "phase": phase, "run_count": len(observations),
        "accepted_count": accepted, "acceptance_unknown_count": unknown,
        "rejected_count": len(observations) - accepted - unknown,
        "totals": totals, "cost_per_accepted_result_minor": unit_cost,
        "cost_per_accepted_result_status": (
            "OBSERVED" if unit_cost is not None else "NOT_MEASURABLE"),
    }


def _investment(evidence: dict | None, *, source_bytes: Mapping[str, bytes],
                owner_verify: OwnerVerify, currency: str,
                cohort_sha256: str) -> int | None:
    if evidence is None:
        return None
    _need(type(evidence) is dict and set(evidence) == {
        "ref", "kind", "sha256", "value_minor", "currency",
    }, "INVESTMENT_FIELDS_INVALID")
    _need(evidence["kind"] == "COST_INVOICE"
          and evidence["currency"] == currency
          and _integer(evidence["value_minor"]), "INVESTMENT_INVALID")
    verified = _proofs([{
        "ref": evidence["ref"], "kind": evidence["kind"],
        "sha256": evidence["sha256"],
    }], source_bytes, owner_verify)
    p = verified[evidence["ref"]][1]
    _need(p["status"] == "OBSERVED" and p["values"].get("investment_minor")
          == evidence["value_minor"] and p.get("currency") == currency
          and p["values"].get("cohort_sha256") == cohort_sha256
          and p["values"].get("purpose") == "IWXA_IMPLEMENTATION"
          and p["values"].get("payment_status") == "PAID",
          "INVESTMENT_NOT_OWNER_BOUND")
    return evidence["value_minor"]


def compare_process_phases(
    before: list[dict], after: list[dict], *,
    investment: dict | None, source_bytes: Mapping[str, bytes],
    owner_verify: OwnerVerify,
) -> dict:
    """Read-only before/after accounting. Never assert causal IWXA savings.

    Operating actual_cost_minor excludes the one-time investment. Investment
    must be separately observed and owner-verified; no budget or forecast.
    """
    _need(type(before) is list and type(after) is list and before and after,
          "PROCESS_PHASES_EMPTY")
    rows = before + after
    _need(all(type(x) is dict and x.get("schema") == SCHEMA for x in rows),
          "PROCESS_OBSERVATIONS_REQUIRED")
    _need(all(x["phase"] == "BEFORE" for x in before)
          and all(x["phase"] == "AFTER" for x in after)
          and len({x["run_id_sha256"] for x in rows}) == len(rows),
          "PROCESS_PHASES_OR_RUN_IDS_INVALID")
    same_cohort = len({x["cohort_sha256"] for x in rows}) == 1
    same_currency = len({x["currency"] for x in rows}) == 1
    _need(same_cohort and same_currency, "INCOMPARABLE_PROCESS_OR_CURRENCY")
    currency = rows[0]["currency"]
    old, new = _phase(before, "BEFORE"), _phase(after, "AFTER")
    paid_investment = _investment(investment, source_bytes=source_bytes,
                                  owner_verify=owner_verify, currency=currency,
                                  cohort_sha256=rows[0]["cohort_sha256"])
    deltas = {
        k: (new["totals"][k] - old["totals"][k]
            if new["totals"][k] is not None and old["totals"][k] is not None
            else None) for k in sorted(METRICS)
    }
    # No volume-normalized hypothetical savings: require equal denominators.
    comparable = (
        old["run_count"] == new["run_count"]
        and old["accepted_count"] == new["accepted_count"]
        and old["acceptance_unknown_count"] == 0
        and new["acceptance_unknown_count"] == 0
        and old["accepted_count"] > 0
    )
    known_spend = old["totals"]["actual_cost_minor"] is not None and (
        new["totals"]["actual_cost_minor"] is not None)
    # A list of caller-supplied projections can be forged; NEVER calculate
    # a source-bound ROI from it. compare_verified_process_runs replays original
    # bytes through the owner and checks population comparability before ROI.
    roi = None
    net = None
    return {
        "schema": PROCESS_SCHEMA,
        "status": "PROJECTION_ONLY_NOT_INDEPENDENTLY_SOURCE_REPLAYED",
        "currency": currency,
        "before": old, "after": new,
        "deltas_after_minus_before": deltas,
        "investment_minor": paid_investment,
        "observed_accounting_net_minor": net,
        "observed_accounting_roi_percent": roi,
        "roi_status": "NOT_MEASURABLE",
        "roi_missing_requirements": [
            "REPLAY_ORIGINAL_SOURCE_RUNS",
            "OWNER_VERIFIED_POPULATION_COMPARABILITY",
        ],
        "roi_attributable_to_iwxa": "NOT_MEASURABLE",
        "comparability": {
            "same_process_case_definition": same_cohort,
            "same_currency": same_currency,
            "equal_run_and_accepted_counts": comparable,
            "known_complete_operating_spend": known_spend,
        },
        "forecasts_used": False,
    }
