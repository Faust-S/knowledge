"""Source-declared monetary flows and resource-use claims for one operator AKIS.

Scientific boundary: this is MODEL_ONLY bookkeeping, not an audit of originals,
accounting profit, causal attribution, economic optimization, or real transfer.
Inputs never assert a legal right and nothing here authorizes a work transition.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
import re
from typing import Any, Mapping, Sequence

from .cooperation import (
    CooperationInputError, CooperationLink, evaluate_cooperation_cost_channels,
    attribute_cooperative_event_costs,
)
from .modern_economic_evidence import ModernEconomicEvidenceError, review_cost_attribution
from .economic_liquidity import LiquidityInputError, evaluate_cash_timing
from .economic_lifecycle import LifecycleInputError, classify_lifecycle_costs
from .common_work_allocations import CommonAllocationError, review_common_work_allocations


class EconomicInputError(ValueError):
    """Malformed or incompatible research claims, never a business fact."""


_AMOUNT = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?\Z")
_CURRENCY = re.compile(r"[A-Z]{3}\Z")
_SCENARIOS = ("COOPERATION", "INDEPENDENT_ALTERNATIVE")
_BUCKETS = frozenset({"COMMON_CAPABILITY", "PARTICIPANT_CONNECT", "DELIVERY", "COORDINATION", "FAILURE", "EXIT", "OTHER"})
_MAX_RECORDS = 2048  # computational guard; not a limit on actual organizations
_MAX_SUBJECTS = 128


def _record(data: Any, expected: set[str], label: str) -> dict:
    if not isinstance(data, dict) or set(data) != expected:
        raise EconomicInputError(f"INVALID_{label}_FIELDS")
    return data


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise EconomicInputError(f"INVALID_{label}")
    return value


def _amount(value: Any) -> Decimal:
    if not isinstance(value, str) or not _AMOUNT.fullmatch(value):
        raise EconomicInputError("INVALID_EXACT_AMOUNT")
    return Decimal(value)


def _sum_str(values: list[Decimal]) -> str:
    return f"{sum(values, Decimal('0')):.2f}"


def _bounded_list(value: Any, name: str) -> list:
    if not isinstance(value, list) or len(value) > _MAX_RECORDS:
        raise EconomicInputError(f"INVALID_{name}_COUNT")
    return value


def _flow_ref(source_id: Any, source_map: dict, owners: set[str]) -> str:
    ref = _identifier(source_id, "SOURCE_ID")
    if ref not in source_map:
        raise EconomicInputError("UNDECLARED_SOURCE")
    if source_map[ref]["owner"] not in owners:
        raise EconomicInputError("SOURCE_OWNER_NOT_PARTY")
    return ref


def _existing_work(work: Any, works: Mapping[str, Any]) -> str | None:
    if work is None:
        return None
    name = _identifier(work, "WORK_REF")
    if name not in works:
        raise EconomicInputError("SOURCE_WORK_NOT_IN_PORTFOLIO")
    return name



def _review_work_payment_conditions(
    declarations: Any, *, works: Mapping[str, Any],
    trace: Sequence[Mapping[str, Any]],
    sources: Mapping[str, Mapping[str, str]],
    transfer_index: Mapping[str, Mapping[str, Any]],
    resource_index: Mapping[str, Mapping[str, Any]],
    cash_timing: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """R2.5: read the ORIGINAL Work trace and the SAME economic rows.

    Terms are claims by the original counterparties, not an invoice, a bank
    settlement, a contract amendment or a new independent money schedule.
    """
    if cash_timing is None:
        raise EconomicInputError("WORK_PAYMENT_CONDITIONS_REQUIRE_CASH_TIMING")
    if not isinstance(declarations, list) or len(declarations) > _MAX_RECORDS:
        raise EconomicInputError("INVALID_WORK_PAYMENT_CONDITION_COUNT")
    horizon = cash_timing["horizon_end"]
    windows = {row["transfer_id"]: row
               for row in cash_timing["transfer_windows"]}
    applied: dict[str, dict[str, int]] = {}
    for event in trace:
        if (event.get("outcome") != "APPLIED"
                or event.get("work") not in works):
            continue
        action = event.get("action")
        if action in {"commit", "accept"}:
            applied.setdefault(event["work"], {})[action] = event["at"]
    bound: set[str] = set()
    items: list[dict[str, Any]] = []
    valid = 0
    unobserved = 0
    conflicts = 0
    for declaration in declarations:
        _record(declaration, {
            "transfer_id", "condition", "due_at",
            "work_source_revision", "org_revision", "owner_sources",
        }, "WORK_PAYMENT_CONDITION")
        transfer_id = _identifier(declaration["transfer_id"], "PAYMENT_TRANSFER_ID")
        if transfer_id in bound:
            raise EconomicInputError("DUPLICATE_WORK_PAYMENT_CONDITION")
        transfer = transfer_index.get(transfer_id)
        if transfer is None or transfer["scenario"] != "COOPERATION" or transfer["work"] is None:
            raise EconomicInputError("PAYMENT_CONDITION_REQUIRES_ORIGINAL_COOPERATIVE_WORK_TRANSFER")
        bound.add(transfer_id)
        condition = declaration["condition"]
        if condition not in {"ON_ORIGINAL_COMMIT", "ON_CUSTOMER_ACCEPTANCE"}:
            raise EconomicInputError("UNSUPPORTED_WORK_PAYMENT_CONDITION")
        due_at = declaration["due_at"]
        if type(due_at) is not int or not 0 <= due_at <= horizon:
            raise EconomicInputError("INVALID_ORIGINAL_PAYMENT_DUE_TIME")
        work_id = transfer["work"]
        work = works[work_id]
        if (declaration["work_source_revision"] != getattr(work, "source_revision", None)
                or not isinstance(declaration["work_source_revision"], str)):
            raise EconomicInputError("PAYMENT_CONDITION_WORK_REVISION_MISMATCH")
        org_revision = _identifier(declaration["org_revision"], "PAYMENT_ORG_REVISION")
        original_org = getattr(work, "commitment_org_revision", None)
        if original_org is not None and org_revision != original_org:
            raise EconomicInputError("PAYMENT_CONDITION_COMMITMENT_REVISION_MISMATCH")
        original_parties = {transfer["payer"], transfer["payee"]} - {"EXTERNAL"}
        owners = declaration["owner_sources"]
        if not isinstance(owners, dict) or set(owners) != original_parties:
            raise EconomicInputError("PAYMENT_TERMS_BOTH_ORIGINAL_PARTIES_REQUIRED")
        for owner, source_id in owners.items():
            if (not isinstance(source_id, str)
                    or sources.get(source_id, {}).get("owner") != owner):
                raise EconomicInputError("PAYMENT_TERMS_ORIGINAL_OWNER_SOURCE_REQUIRED")
        transfer_source = transfer["source"]
        source_owner = sources[transfer_source]["owner"]
        if owners[source_owner] != transfer_source:
            raise EconomicInputError("PAYMENT_TERMS_CANNOT_REPLACE_TRANSFER_SOURCE")
        history = getattr(work, "result_history", ())
        final_acceptance = (
            getattr(work, "result", None) == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            and bool(history) and history[-1].get("transition") == "accept"
            and history[-1].get("model_ref") == getattr(work, "result_ref", None)
        )
        original_events = applied.get(work_id, {})
        trigger_at = (
            original_events.get("commit")
            if condition == "ON_ORIGINAL_COMMIT"
            else original_events.get("accept") if final_acceptance else None
        )
        window = windows.get(transfer_id)
        expected = window["at"] if window is not None else None
        late = window.get("late_at", expected) if window is not None else None
        if trigger_at is None:
            status = "ORIGINAL_CONDITIONAL_TRIGGER_NOT_APPLIED"
            unobserved += 1
        elif window is None:
            status = "ORIGINAL_CASH_POSTING_WINDOW_NOT_DECLARED"
            conflicts += 1
        elif due_at < trigger_at:
            status = "DECLARED_DUE_PRECEDES_APPLIED_CONDITION"
            conflicts += 1
        elif expected < trigger_at:
            status = "CASH_FORECAST_PRECEDES_APPLIED_CONDITION"
            conflicts += 1
        elif expected == trigger_at:
            status = "SAME_TICK_CONDITION_AND_POSTING_ORDER_UNVERIFIED"
            conflicts += 1
        elif expected > due_at:
            status = "CASH_FORECAST_AFTER_DECLARED_DUE_WITHOUT_AMENDMENT"
            conflicts += 1
        else:
            status = "MODEL_ORIGINAL_TRIGGER_DUE_AND_POSTING_ORDER_CONSISTENT"
            valid += 1
        work_use_count = sum(
            row["scenario"] == "COOPERATION" and row["work"] == work_id
            for row in resource_index.values()
        )
        items.append({
            "transfer_id": transfer_id,
            "original_work": work_id,
            "condition": condition,
            "status": status,
            "original_condition_at": trigger_at,
            "original_due_at": due_at,
            "same_original_transfer_expected_posting_at": expected,
            "same_original_transfer_late_hypothesis_at": late,
            "late_hypothesis_after_original_due": (
                late > due_at if late is not None else None
            ),
            "current_original_result": getattr(work, "result", "UNKNOWN"),
            "customer_accepted_current_result_version": final_acceptance,
            "original_model_quality_criteria": len(getattr(work, "assurance_criteria", ())),
            "same_original_work_noncash_resource_use_count": work_use_count,
            "original_transfer_amount_posted_or_collected_in_bank": False,
            "declared_terms_and_parties_are_not_authenticated": True,
        })
    original_work_transfers = {
        key for key, row in transfer_index.items()
        if row["scenario"] == "COOPERATION" and row["work"] is not None
    }
    missing = sorted(original_work_transfers - bound)
    if missing:
        status = "INCOMPLETE_ORIGINAL_WORK_PAYMENT_TERMS"
    elif conflicts or unobserved:
        status = "UNOBSERVED_OR_INCONSISTENT_PAYMENT_CAUSAL_SEQUENCE"
    else:
        status = "DECLARED_CAUSAL_PAYMENT_ORDER_ONLY_NOT_SETTLEMENT"
    return {
        "evidence": "MODEL_ONLY_ORIGINAL_WORK_EVENTS_AND_ORIGINAL_MONEY_ROWS",
        "status": status,
        "bindings": sorted(items, key=lambda row: row["transfer_id"]),
        "bound_original_transfer_count": len(bound),
        "original_work_transfer_without_terms_count": len(missing),
        "missing_original_work_transfer_ids": missing,
        "source_declared_consistent_count": valid,
        "unobserved_trigger_count": unobserved,
        "contradictory_or_missing_timing_count": conflicts,
        "original_transfer_and_resource_cost_totals_unchanged": True,
        "no_secondary_work_event_or_payment_ledger_created": True,
        "original_due_is_not_replaced_by_late_cash_hypothesis": True,
        "quality_or_acceptance_does_not_certify_bank_settlement": True,
        "real_contract_legal_enforceability_and_payment_verified": False,
        "independent_alternative_does_not_inherit_cooperative_acceptance": True,
        "missing_terms_are_unknown_not_zero": True,
    }

def evaluate_economic_claims(raw: Any, subjects: Mapping[str, Any], works: Mapping[str, Any],
                             cooperation_links: Sequence[CooperationLink] = (),
                             trace: Sequence[Mapping[str, Any]] = ()) -> dict[str, Any]:
    """Evaluate explicitly declared claims in matching periods and currencies.

    A reported cash-flow difference is NOT profit, individual advantage, causal
    evidence, audited data or system value. Internal transfers cancel on
    consolidation; real resource-use claims remain a separate dimension.
    """
    required = {"period", "currency", "sources", "transfers", "resource_uses", "coverage", "outside_feasibility"}
    if (not isinstance(raw, dict) or required - set(raw) or
            set(raw) - required - {
                "mechanism_allocations", "coordination_event_bindings",
                "modern_cost_bindings", "cash_timing", "lifecycle_costs",
                "common_allocations", "work_payment_conditions",
            }):
        raise EconomicInputError("INVALID_ECONOMICS_FIELDS")
    doc = raw
    period = _identifier(doc["period"], "ECONOMIC_PERIOD")
    currency = doc["currency"]
    if not isinstance(currency, str) or not _CURRENCY.fullmatch(currency):
        raise EconomicInputError("INVALID_CURRENCY")
    if len(subjects) > _MAX_SUBJECTS:
        raise EconomicInputError("TOO_MANY_SUBJECTS")
    party_ids = set(subjects)
    if "EXTERNAL" in party_ids:
        raise EconomicInputError("RESERVED_SUBJECT_ID")

    sources: dict[str, dict] = {}
    for source in _bounded_list(doc["sources"], "SOURCE"):
        _record(source, {"id", "owner", "reference", "revision"}, "SOURCE")
        key = _identifier(source["id"], "SOURCE_ID")
        owner = _identifier(source["owner"], "SOURCE_OWNER")
        reference = _identifier(source["reference"], "SOURCE_REFERENCE")
        revision = _identifier(source["revision"], "SOURCE_REVISION")
        if owner not in party_ids:
            raise EconomicInputError("UNKNOWN_SOURCE_OWNER")
        if key in sources:
            raise EconomicInputError("DUPLICATE_SOURCE")
        sources[key] = {"owner": owner, "reference": reference, "revision": revision}

    cash = {sc: {pid: [] for pid in sorted(party_ids)} for sc in _SCENARIOS}
    external_cash: dict[str, list[Decimal]] = {sc: [] for sc in _SCENARIOS}
    internal_count = {sc: 0 for sc in _SCENARIOS}
    used_ids: set[str] = set()
    linked_works: dict[str, str] = {}
    transfer_index: dict[str, dict[str, Any]] = {}

    for row in _bounded_list(doc["transfers"], "TRANSFER"):
        _record(row, {"id", "scenario", "payer", "payee", "amount", "source", "work"}, "TRANSFER")
        identifier = _identifier(row["id"], "TRANSFER_ID")
        if identifier in used_ids:
            raise EconomicInputError("DUPLICATE_ECONOMIC_RECORD")
        used_ids.add(identifier)
        sc = row["scenario"]
        if not isinstance(sc, str) or sc not in _SCENARIOS:
            raise EconomicInputError("INVALID_ECONOMIC_SCENARIO")
        payer, payee = _identifier(row["payer"], "PAYER"), _identifier(row["payee"], "PAYEE")
        if payer == payee or payer not in (party_ids | {"EXTERNAL"}) or payee not in (party_ids | {"EXTERNAL"}):
            raise EconomicInputError("INVALID_TRANSFER_BOUNDARY")
        _flow_ref(row["source"], sources, {payer, payee} - {"EXTERNAL"})
        work = _existing_work(row["work"], works)
        if work is not None:
            linked_works[work] = getattr(works[work], "result", "UNKNOWN")
        amount = _amount(row["amount"])
        transfer_index[identifier] = {**row, "decimal_amount": amount}
        if payer != "EXTERNAL":
            cash[sc][payer].append(-amount)
        if payee != "EXTERNAL":
            cash[sc][payee].append(amount)
        if payer == "EXTERNAL":
            external_cash[sc].append(amount)
        elif payee == "EXTERNAL":
            external_cash[sc].append(-amount)
        else:
            internal_count[sc] += 1

    used_cost_ids: set[str] = set()
    resource_index: dict[str, dict[str, Any]] = {}
    resource_costs: dict[str, dict[str, dict[str, list[Decimal]]]] = {
        sc: {pid: defaultdict(list) for pid in sorted(party_ids)} for sc in _SCENARIOS
    }
    for row in _bounded_list(doc["resource_uses"], "RESOURCE_USE"):
        _record(row, {"id", "scenario", "owner", "amount", "bucket", "source", "work"}, "RESOURCE_USE")
        key = _identifier(row["id"], "RESOURCE_USE_ID")
        if key in used_ids or key in used_cost_ids:
            raise EconomicInputError("DUPLICATE_ECONOMIC_RECORD")
        used_cost_ids.add(key)
        sc = row["scenario"]
        if not isinstance(sc, str) or sc not in _SCENARIOS:
            raise EconomicInputError("INVALID_ECONOMIC_SCENARIO")
        owner = _identifier(row["owner"], "RESOURCE_OWNER")
        if owner not in party_ids:
            raise EconomicInputError("UNKNOWN_RESOURCE_USE_OWNER")
        bucket = row["bucket"]
        if not isinstance(bucket, str) or bucket not in _BUCKETS:
            raise EconomicInputError("INVALID_RESOURCE_BUCKET")
        _flow_ref(row["source"], sources, {owner})
        work = _existing_work(row["work"], works)
        if work is not None:
            linked_works[work] = getattr(works[work], "result", "UNKNOWN")
        exact_amount = _amount(row["amount"])
        resource_costs[sc][owner][bucket].append(exact_amount)
        resource_index[key] = {**row, "decimal_amount": exact_amount}

    coverage_raw = doc["coverage"]
    _record(coverage_raw, set(_SCENARIOS), "COVERAGE")
    # Completeness is a document-backed claim. Naming a party without a
    # party-owned source must never turn an empty ledger into a measured zero.
    covered: dict[str, dict[str, str]] = {}
    for sc in _SCENARIOS:
        mapping = coverage_raw[sc]
        if not isinstance(mapping, dict) or len(mapping) > _MAX_SUBJECTS:
            raise EconomicInputError("INVALID_COVERAGE_MAP")
        if any(not isinstance(pid, str) for pid in mapping) or not set(mapping).issubset(party_ids):
            raise EconomicInputError("INVALID_COVERAGE_SUBJECT")
        covered[sc] = {}
        for party, proof in mapping.items():
            covered[sc][party] = _flow_ref(proof, sources, {party})

    outside_raw = doc["outside_feasibility"]
    if not isinstance(outside_raw, dict) or not set(outside_raw).issubset(party_ids):
        raise EconomicInputError("INVALID_OUTSIDE_FEASIBILITY")
    outside: dict[str, str] = {}
    outside_sources: dict[str, str] = {}
    for party, claim in outside_raw.items():
        _record(claim, {"state", "source"}, "OUTSIDE_FEASIBILITY")
        state = claim["state"]
        if not isinstance(state, str) or state not in {"FEASIBLE_DECLARED", "NOT_FEASIBLE_DECLARED", "UNKNOWN"}:
            raise EconomicInputError("INVALID_OUTSIDE_FEASIBILITY")
        outside[party] = state
        outside_sources[party] = _flow_ref(claim["source"], sources, {party})

    per_subject = {}
    for party in sorted(party_ids):
        is_complete = {sc: party in covered[sc] for sc in _SCENARIOS}
        sub = {
            "flow_sums_from_claims": {sc: _sum_str(cash[sc][party]) for sc in _SCENARIOS},
            "complete_cash_balance_from_claims": {sc: (_sum_str(cash[sc][party]) if is_complete[sc] else None) for sc in _SCENARIOS},
            "declared_complete": is_complete,
            "outside_feasibility": outside.get(party, "UNKNOWN"),
            "resource_uses_by_bucket": {sc: {k: _sum_str(v) for k, v in sorted(resource_costs[sc][party].items())} for sc in _SCENARIOS},
            "cash_comparison": "NOT_IDENTIFIABLE",
            "cash_difference_cooperation_minus_outside": None,
        }
        if all(is_complete.values()) and outside.get(party) == "FEASIBLE_DECLARED":
            delta = sum(cash["COOPERATION"][party], Decimal(0)) - sum(cash["INDEPENDENT_ALTERNATIVE"][party], Decimal(0))
            sub["cash_comparison"] = "DECLARED_SCOPE_ARITHMETIC_ONLY"
            sub["cash_difference_cooperation_minus_outside"] = f"{delta:.2f}"
        per_subject[party] = sub

    external = {sc: _sum_str(external_cash[sc]) for sc in _SCENARIOS}
    scope_complete = {sc: set(party_ids) == set(covered[sc]) for sc in _SCENARIOS}
    consolidated_complete = all(scope_complete.values())
    consolidated_comparable = consolidated_complete and all(outside.get(pid) == "FEASIBLE_DECLARED" for pid in party_ids)
    consolidated_delta = None
    if consolidated_comparable:
        consolidated_delta = f"{sum(external_cash['COOPERATION'],Decimal(0))-sum(external_cash['INDEPENDENT_ALTERNATIVE'],Decimal(0)):.2f}"
    # A Work/Result can only be linked to already-declared monetary and
    # non-cash records, never charged a second time merely because its
    # original recipient reported quality. These record counts are not
    # completeness, settlement or causal savings proof.
    from .work_assurance import acceptance_gate
    work_record_evidence: dict[str, dict[str, Any]] = {}
    for work_id, work in sorted(works.items()):
        cash_rows = {sc: 0 for sc in _SCENARIOS}
        cost_rows = {sc: 0 for sc in _SCENARIOS}
        for item in transfer_index.values():
            if item["work"] == work_id:
                cash_rows[item["scenario"]] += 1
        for item in resource_index.values():
            if item["work"] == work_id:
                cost_rows[item["scenario"]] += 1
        scoped_quality = getattr(work, "assurance_criteria", ())
        quality_gate = acceptance_gate(work) if scoped_quality else "NOT_DECLARED"
        work_record_evidence[work_id] = {
            "original_result": getattr(work, "result", "UNKNOWN"),
            "existing_transfer_rows": cash_rows,
            "existing_noncash_resource_use_rows": cost_rows,
            "original_model_quality_criteria_count": len(scoped_quality),
            "original_model_quality_gate": quality_gate,
            "prior_original_work_accepted_but_not_quality_certified": (
                getattr(work, "result", "UNKNOWN") == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            ),
            "source_records_not_verified_actual_settlement": True,
            "work_specific_alternative_scope": "NOT_QUALIFIED",
            "quality_check_and_rework_cost_completeness": "NOT_QUALIFIED",
            "economic_benefit_due_to_accepted_result": "NOT_IDENTIFIABLE",
            "resource_use_and_cash_not_additive": True,
        }

    output = {
        "evidence": "MODEL_ONLY",
        "period": period,
        "currency": currency,
        "source_authority": "DECLARED_UNVERIFIED",
        "source_count": len(sources),
        "declared_source_index": dict(sorted(sources.items())),
        "coverage_proof_sources": {sc: dict(sorted(covered[sc].items())) for sc in _SCENARIOS},
        "outside_feasibility_proof_sources": dict(sorted(outside_sources.items())),
        "transfers_count": len(used_ids),
        "resource_uses_count": len(used_cost_ids),
        "internal_transfers_count": internal_count,
        "per_subject": per_subject,
        "consolidated_external_cash_from_claims": external,
        "complete_consolidated_external_balance_from_claims": {
            sc: (external[sc] if scope_complete[sc] else None) for sc in _SCENARIOS
        },
        "consolidated_scope_complete_declared": consolidated_complete,
        "consolidated_comparable_declared": consolidated_comparable,
        "consolidated_cash_difference_claimed_scope": consolidated_delta,
        "linked_work_result_states": dict(sorted(linked_works.items())),
        "original_work_record_evidence": work_record_evidence,
        "resource_costs_additive_to_cash": False,
        "profit": "UNKNOWN",
        "economic_value_added": "NOT_IDENTIFIABLE",
        "comparative_causal_effect": "NOT_IDENTIFIABLE",
        "economic_interest": "NOT_IDENTIFIABLE",
        "organizational_change": "NOT_AUTOMATIC",
    }
    if "common_allocations" in doc:
        try:
            output["common_work_allocations"] = review_common_work_allocations(
                doc["common_allocations"], sources=sources,
                transfer_index=transfer_index, resource_index=resource_index,
                works=works,
            )
        except CommonAllocationError as exc:
            raise EconomicInputError(str(exc)) from exc
    if "mechanism_allocations" in doc:
        try:
            output["cooperation_cost_channels"] = evaluate_cooperation_cost_channels(
                doc["mechanism_allocations"], cooperation_links, sources,
                transfer_index, resource_index, covered, outside,
            )
        except CooperationInputError as exc:
            raise EconomicInputError(str(exc)) from exc
    if "coordination_event_bindings" in doc:
        # Additional references only: no new amounts, independent schedule,
        # legal event, or second monetary ledger. Source timing and actual
        # authorization remain unverified even for apparently complete claims.
        if "mechanism_allocations" not in doc:
            raise EconomicInputError("COOPERATION_EVENT_COST_REQUIRES_EXISTING_CHANNELS")
        try:
            output["cooperative_event_costs"] = attribute_cooperative_event_costs(
                doc["coordination_event_bindings"], cooperation_links, trace,
                sources, resource_index, output["cooperation_cost_channels"],
            )
        except CooperationInputError as exc:
            raise EconomicInputError(str(exc)) from exc
    if "modern_cost_bindings" in doc:
        # Only binds existing, original, non-cash resource uses to costs.
        # No new ledger, new costs, automatic incentive, or false zero.
        try:
            output["modern_cost_attribution"] = review_cost_attribution(
                doc["modern_cost_bindings"], sources=sources,
                resource_index=resource_index, subjects=subjects,
            )
        except ModernEconomicEvidenceError as exc:
            raise EconomicInputError(str(exc)) from exc
    if "cash_timing" in doc:
        # Dates and balances refer to the SAME source-declared transfers;
        # the model generates no loans, invoices, interest or new money.
        try:
            output["cash_timing"] = evaluate_cash_timing(
                doc["cash_timing"], sources=sources,
                transfer_index=transfer_index, coverage=covered, subjects=subjects,
                outside=outside,
            )
        except LiquidityInputError as exc:
            raise EconomicInputError(str(exc)) from exc
    if "lifecycle_costs" in doc:
        try:
            output["lifecycle_resource_costs"] = classify_lifecycle_costs(
                doc["lifecycle_costs"], sources=sources,
                resource_index=resource_index, subjects=subjects, outside=outside,
            )
        except LifecycleInputError as exc:
            raise EconomicInputError(str(exc)) from exc
    if "work_payment_conditions" in doc:
        output["work_payment_causality"] = _review_work_payment_conditions(
            doc["work_payment_conditions"], works=works, trace=trace,
            sources=sources, transfer_index=transfer_index,
            resource_index=resource_index, cash_timing=doc.get("cash_timing"),
        )
    return output
