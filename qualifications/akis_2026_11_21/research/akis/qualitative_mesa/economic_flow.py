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
from .capacity import original_execution_readiness_view
from .economic_lifecycle import LifecycleInputError, classify_lifecycle_costs, STAGES, NATURES
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



def _payment_owner_evidence(
    row: Mapping[str, Any], original: Mapping[str, Any],
    terms: Mapping[str, Any], sources: Mapping[str, Mapping[str, str]],
    used_refs: set[str],
) -> None:
    """Require new, owner-distinct MODEL_ONLY evidence for an original transfer."""
    original_parties = {original["payer"], original["payee"]} - {"EXTERNAL"}
    if len(original_parties) != 2:
        raise EconomicInputError("PAYMENT_PROGRESS_REQUIRES_TWO_ORIGINAL_PARTIES")
    owner_sources = row.get("owner_sources")
    evidence_refs = row.get("evidence_refs")
    if (not isinstance(owner_sources, dict) or
            set(owner_sources) != original_parties or
            not isinstance(evidence_refs, dict) or
            set(evidence_refs) != original_parties):
        raise EconomicInputError("PAYMENT_PROGRESS_BOTH_INDEPENDENT_OWNER_SOURCES_REQUIRED")
    # Optional pinned revisions strengthen same-KPB checks without changing
    # existing R2.6 terms or generating new settlement/payment records.
    if "evidence_revisions" in row:
        revisions = row["evidence_revisions"]
        if (not isinstance(revisions, dict)
                or set(revisions) != original_parties
                or any(not isinstance(rev, str) or not rev.strip()
                       or len(rev) > 128 for rev in revisions.values())):
            raise EconomicInputError(
                "PAYMENT_PROGRESS_INDEPENDENT_EVIDENCE_REVISIONS_INVALID"
            )
    if "owner_attestations" in row:
        statements = row["owner_attestations"]
        if (not isinstance(statements, dict)
                or set(statements) != original_parties
                or any(not isinstance(claim, dict)
                       or set(claim) != {"reported_at", "reported_amount"}
                       for claim in statements.values())):
            raise EconomicInputError(
                "PAYMENT_PROGRESS_INDEPENDENT_OWNER_REPORTS_REQUIRED"
            )
        # Two independent references are insufficient to prove identical
        # statements. Match each owner's declared amount and time to this
        # original partial-transfer report, not to a second cash ledger.
        for claim in statements.values():
            if (type(claim["reported_at"]) is not int
                    or claim["reported_at"] != row.get("at")
                    or _amount(claim["reported_amount"]) !=
                       _amount(row.get("amount"))):
                raise EconomicInputError(
                    "PAYMENT_PROGRESS_INDEPENDENT_OWNER_REPORTS_CONFLICT"
                )
    for owner in sorted(original_parties):
        source = owner_sources[owner]
        if (not isinstance(source, str) or
                sources.get(source, {}).get("owner") != owner):
            raise EconomicInputError("PAYMENT_PROGRESS_OWNER_SOURCE_INVALID")
        if source == terms["owner_sources"][owner]:
            raise EconomicInputError("PAYMENT_PROGRESS_MUST_HAVE_NEW_EVENT_SOURCE")
        ref = evidence_refs[owner]
        expected_prefix = f"model://{owner}/"
        if (not isinstance(ref, str) or
                not ref.startswith(expected_prefix) or
                len(ref) <= len(expected_prefix) or len(ref) > 180):
            raise EconomicInputError("PAYMENT_PROGRESS_INDEPENDENT_EVENT_REFERENCE_REQUIRED")
        if ref in used_refs or ref == sources[source]["reference"]:
            raise EconomicInputError("PAYMENT_PROGRESS_EVENT_REFERENCE_NOT_UNIQUE")
        used_refs.add(ref)


def _review_work_payment_progress(
    original_view: dict[str, Any], *,
    settlement_claims: Any, due_amendments: Any,
    raw_terms: list[Mapping[str, Any]],
    sources: Mapping[str, Mapping[str, str]],
    transfer_index: Mapping[str, Mapping[str, Any]],
    works: Mapping[str, Any], trace: Sequence[Mapping[str, Any]],
    cash_timing: Mapping[str, Any],
) -> dict[str, list[tuple[int, Decimal]]] | None:
    """R2.6: source-bound statements about ORIGINAL transfers, not a money ledger.

    Add annotations to the existing R2.5 causal view. A claimed settlement
    cannot create an extra transfer, alter signed network sums, certify a bank
    payment, or retroactively amend a legal due date.
    """
    if settlement_claims is None and due_amendments is None:
        return None
    if settlement_claims is not None and (
            not isinstance(settlement_claims, list) or
            len(settlement_claims) > _MAX_RECORDS):
        raise EconomicInputError("INVALID_PAYMENT_SETTLEMENT_CLAIM_LIST")
    if due_amendments is not None and (
            not isinstance(due_amendments, list) or
            len(due_amendments) > _MAX_RECORDS):
        raise EconomicInputError("INVALID_PAYMENT_DUE_AMENDMENT_LIST")
    settled = settlement_claims if settlement_claims is not None else []
    amended = due_amendments if due_amendments is not None else []
    horizon = cash_timing["horizon_end"]
    windows = {row["transfer_id"]: row for row in cash_timing["transfer_windows"]}
    indexed_terms = {row["transfer_id"]: row for row in raw_terms}
    indexed_bindings = {row["transfer_id"]: row
                        for row in original_view["bindings"]}
    def t(value: Any) -> int:
        if type(value) is not int or not 0 <= value <= horizon:
            raise EconomicInputError("INVALID_PAYMENT_PROGRESS_MODEL_TIME")
        return value

    # Evidence must be independent of the original contract reference and
    # unique within this set of claims; reused identifiers do not prove payment.
    evidence_refs: set[str] = set()
    event_ids: set[str] = set()
    amendments_by_transfer: dict[str, str] = {}
    model_due: dict[str, int] = {}
    for row in amended:
        required_fields = {
            "id", "transfer_id", "agreed_at", "prior_due_at", "new_due_at",
            "owner_sources", "evidence_refs", "work_source_revision", "org_revision",
        }
        if isinstance(row, dict) and "evidence_revisions" in row:
            required_fields.add("evidence_revisions")
        _record(row, required_fields, "PAYMENT_DUE_AMENDMENT")
        event_id = _identifier(row["id"], "PAYMENT_AMENDMENT_ID")
        transfer_id = _identifier(row["transfer_id"], "PAYMENT_AMENDMENT_TRANSFER")
        if event_id in event_ids:
            raise EconomicInputError("DUPLICATE_PAYMENT_EVIDENCE_EVENT_ID")
        if event_id in transfer_index:
            raise EconomicInputError("PAYMENT_PROGRESS_EVENT_ID_CLASH_WITH_ORIGINAL_TRANSFER")
        event_ids.add(event_id)
        if transfer_id not in indexed_terms:
            raise EconomicInputError("PAYMENT_AMENDMENT_NOT_IN_ORIGINAL_WORK_TERMS")
        if transfer_id in amendments_by_transfer:
            raise EconomicInputError("DUPLICATE_PAYMENT_AMENDMENT_FOR_TRANSFER")
        term = indexed_terms[transfer_id]
        original = transfer_index[transfer_id]
        work = works[original["work"]]
        if (row["work_source_revision"] != work.source_revision or
                row["org_revision"] != term["org_revision"]):
            raise EconomicInputError("PAYMENT_AMENDMENT_WORK_OR_ORG_REVISION_MISMATCH")
        _payment_owner_evidence(row, original, term, sources, evidence_refs)
        agreed_at, prior_due, new_due = (
            t(row["agreed_at"]), t(row["prior_due_at"]), t(row["new_due_at"])
        )
        if prior_due != term["due_at"]:
            raise EconomicInputError("PAYMENT_AMENDMENT_PRIOR_DUE_MISMATCH")
        commits = [event["at"] for event in trace
                   if event.get("outcome") == "APPLIED"
                   and event.get("work") == original["work"]
                   and event.get("action") == "commit"]
        committed_at = commits[-1] if commits else None
        condition_at = indexed_bindings[transfer_id]["original_condition_at"]
        if committed_at is None or agreed_at < committed_at:
            status = "PAYMENT_AMENDMENT_WITHOUT_ORIGINAL_COMMIT"
        elif agreed_at > prior_due:
            status = "RETROACTIVE_DUE_AMENDMENT_NOT_QUALIFIED"
        elif new_due < agreed_at or (condition_at is not None and new_due < condition_at):
            status = "AMENDED_DUE_BEFORE_ECONOMIC_CONDITION"
        else:
            status = "BILATERAL_MODEL_DUE_CHANGE_UNVERIFIED_LEGALLY"
            model_due[transfer_id] = new_due
        amendments_by_transfer[transfer_id] = status
        binding = indexed_bindings[transfer_id]
        binding["model_amendment_status"] = status
        binding["model_amendment_at"] = agreed_at
        binding["source_declared_revised_due_at"] = (
            new_due if transfer_id in model_due else None
        )
        binding["original_due_remains_independently_binding_until_legal_verification"] = True

    for transfer_id, new_due in model_due.items():
        binding = indexed_bindings[transfer_id]
        trigger, expected = (binding["original_condition_at"],
                             binding["same_original_transfer_expected_posting_at"])
        if (trigger is not None and expected is not None and
                trigger < expected <= new_due):
            if binding["status"] == "CASH_FORECAST_AFTER_DECLARED_DUE_WITHOUT_AMENDMENT":
                binding["status"] = "MODEL_REVISED_DUE_FORECAST_CONSISTENT_NOT_LEGAL"
        elif (expected is not None and expected > new_due
              and binding["status"] == "CASH_FORECAST_AFTER_DECLARED_DUE_WITHOUT_AMENDMENT"):
            binding["status"] = "CASH_FORECAST_AFTER_MODEL_AMENDED_DUE"

    # Keep the old causal counters accurate if an explicitly DECLARED revision
    # alters the comparison. It never makes real legal validity true.
    consistent = {
        "MODEL_ORIGINAL_TRIGGER_DUE_AND_POSTING_ORDER_CONSISTENT",
        "MODEL_REVISED_DUE_FORECAST_CONSISTENT_NOT_LEGAL",
    }
    original_view["source_declared_consistent_count"] = sum(
        row["status"] in consistent for row in original_view["bindings"]
    )
    original_view["contradictory_or_missing_timing_count"] = sum(
        row["status"] not in consistent
        and row["status"] != "ORIGINAL_CONDITIONAL_TRIGGER_NOT_APPLIED"
        for row in original_view["bindings"]
    )
    original_view["status"] = (
        "INCOMPLETE_ORIGINAL_WORK_PAYMENT_TERMS"
        if original_view["original_work_transfer_without_terms_count"] else
        "UNOBSERVED_OR_INCONSISTENT_PAYMENT_CAUSAL_SEQUENCE"
        if (original_view["contradictory_or_missing_timing_count"]
            or original_view["unobserved_trigger_count"]
            or any(v != "BILATERAL_MODEL_DUE_CHANGE_UNVERIFIED_LEGALLY"
                   for v in amendments_by_transfer.values())) else
        "DECLARED_CAUSAL_PAYMENT_ORDER_ONLY_NOT_SETTLEMENT"
    )

    events: dict[str, list[tuple[int, str, Decimal, str]]] = {}
    gross_claimed: dict[str, Decimal] = {}
    qualified: dict[str, list[tuple[int, Decimal]]] = {}
    for row in settled:
        required_fields = {
            "id", "transfer_id", "at", "amount", "owner_sources", "evidence_refs",
        }
        if isinstance(row, dict) and "evidence_revisions" in row:
            required_fields.add("evidence_revisions")
        if isinstance(row, dict) and "owner_attestations" in row:
            required_fields.add("owner_attestations")
        _record(row, required_fields, "PAYMENT_SETTLEMENT_CLAIM")
        event_id = _identifier(row["id"], "PAYMENT_SETTLEMENT_ID")
        transfer_id = _identifier(row["transfer_id"], "PAYMENT_SETTLEMENT_TRANSFER")
        if event_id in event_ids:
            raise EconomicInputError("DUPLICATE_PAYMENT_EVIDENCE_EVENT_ID")
        if event_id in transfer_index:
            raise EconomicInputError("PAYMENT_PROGRESS_EVENT_ID_CLASH_WITH_ORIGINAL_TRANSFER")
        event_ids.add(event_id)
        if transfer_id not in indexed_terms:
            raise EconomicInputError("PAYMENT_SETTLEMENT_NOT_IN_ORIGINAL_WORK_TERMS")
        original = transfer_index[transfer_id]
        term = indexed_terms[transfer_id]
        _payment_owner_evidence(row, original, term, sources, evidence_refs)
        at, claimed_amount = t(row["at"]), _amount(row["amount"])
        if claimed_amount <= 0:
            raise EconomicInputError("PAYMENT_SETTLEMENT_AMOUNT_MUST_BE_POSITIVE")
        aggregate = gross_claimed.get(transfer_id, Decimal(0)) + claimed_amount
        if aggregate > original["decimal_amount"]:
            raise EconomicInputError("PAYMENT_SETTLEMENT_EXCEEDS_ORIGINAL_TRANSFER")
        gross_claimed[transfer_id] = aggregate
        trigger = indexed_bindings[transfer_id]["original_condition_at"]
        if trigger is None or at < trigger:
            status = "PAYMENT_CLAIM_BEFORE_OR_WITHOUT_CONDITION"
        elif at == trigger:
            status = "PAYMENT_CLAIM_SAME_TICK_CAUSAL_ORDER_UNQUALIFIED"
        else:
            status = "BILATERAL_MODEL_SETTLEMENT_ASSERTED_UNVERIFIED"
            qualified.setdefault(transfer_id, []).append((at, claimed_amount))
        events.setdefault(transfer_id, []).append((at, event_id, claimed_amount, status))

    splits: dict[str, list[tuple[int, Decimal]]] = {}
    partial_count = full_count = claim_conflict_count = 0
    late_count = 0
    for transfer_id, binding in indexed_bindings.items():
        original_amount = transfer_index[transfer_id]["decimal_amount"]
        owner_events = sorted(events.get(transfer_id, []))
        eligible_amount = sum(
            (amount for _at, amount in qualified.get(transfer_id, [])), Decimal(0)
        )
        status_conflicts = any(
            reason != "BILATERAL_MODEL_SETTLEMENT_ASSERTED_UNVERIFIED"
            for _at, _id, _amt, reason in owner_events
        )
        remaining = original_amount - eligible_amount
        if status_conflicts:
            status = "PAYMENT_CLAIMS_CAUSALLY_INCONSISTENT"
            claim_conflict_count += 1
        elif not owner_events:
            status = "NO_PAYMENT_SOURCE_CLAIM_DOES_NOT_PROVE_UNPAID"
        elif remaining == 0:
            status = "FULLY_SOURCE_MATCHED_MODEL_ONLY_NOT_BANK_PAYMENT"
            full_count += 1
        else:
            status = "PARTIALLY_SOURCE_MATCHED_MODEL_ONLY_NOT_BANK_PAYMENT"
            partial_count += 1
        effective = model_due.get(transfer_id, binding["original_due_at"])
        late_rows = [at for at, _id, _amount_row, _reason in owner_events
                     if at > effective]
        late_count += len(late_rows)
        binding["settlement_progress"] = {
            "status": status,
            "event_count": len(owner_events),
            "source_claimed_eligible_amount": f"{eligible_amount:.2f}",
            "original_transfer_claim_amount": f"{original_amount:.2f}",
            "unconfirmed_remainder_not_actual_bank_debt": f"{remaining:.2f}",
            "late_against_model_declared_due_event_count": len(late_rows),
            "private_model_evidence": [
                {"id": event_id, "at": at, "amount": f"{amt:.2f}",
                 "causal_status": reason}
                for at, event_id, amt, reason in owner_events
            ],
            "bank_actual_settlement_authenticated": False,
            "unreported_payment_is_not_zero_actual_payment": True,
        }
        if owner_events and not status_conflicts and eligible_amount > 0:
            window = windows.get(transfer_id)
            if window is None:
                claim_conflict_count += 1
                continue
            original_expected = window["at"]
            parts = list(qualified[transfer_id])
            if remaining > 0:
                parts.append((original_expected, remaining))
            splits[transfer_id] = sorted(parts)
    original_view["settlement_progress"] = {
        "evidence": "MODEL_ONLY_BILATERAL_ORIGINAL_SOURCE_CLAIMS",
        "source_claimed_partial_transfer_count": partial_count,
        "source_claimed_full_transfer_count": full_count,
        "source_claim_event_count": len(settled),
        "causal_conflict_transfer_count": claim_conflict_count,
        "late_payment_claim_event_count": late_count,
        "source_declared_amendment_count": len(model_due),
        "retroactive_or_inconsistent_amendment_count": sum(
            status != "BILATERAL_MODEL_DUE_CHANGE_UNVERIFIED_LEGALLY"
            for status in amendments_by_transfer.values()
        ),
        "missing_evidence_does_not_mean_paid_zero": True,
        "original_transfer_amounts_not_rewritten": True,
        "actual_bank_payment_verified": False,
        "legal_revision_of_due_date_verified": False,
        "partial_evidence_is_a_split_of_original_forecast_not_new_money": True,
    }
    if claim_conflict_count or any(
            status != "BILATERAL_MODEL_DUE_CHANGE_UNVERIFIED_LEGALLY"
            for status in amendments_by_transfer.values()):
        original_view["status"] = "PAYMENT_PROGRESS_EVIDENCE_OR_AMENDMENT_CONFLICT"
        return None
    # An incomplete Work payment contract cannot make a subset of original
    # payment claims appear to qualify the entire network trajectory.
    if (original_view["original_work_transfer_without_terms_count"]
            or original_view["contradictory_or_missing_timing_count"]
            or original_view["unobserved_trigger_count"]):
        original_view["settlement_progress"][
            "conditional_network_claim_projection_held_due_to_incomplete_work_terms"
        ] = True
        return None
    # Only use source-consistent claims as a CONDITIONAL CASH PATH. All other
    # original transfers stay in the original forecast; no realized bank fact.
    return splits if splits else None

def evaluate_economic_claims(raw: Any, subjects: Mapping[str, Any], works: Mapping[str, Any],
                             cooperation_links: Sequence[CooperationLink] = (),
                             trace: Sequence[Mapping[str, Any]] = (), *,
                             strict_outside_installment_count: int = 0) -> dict[str, Any]:
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
                "work_payment_settlement_claims", "work_payment_due_amendments",
                "joint_purchasing_original_cash_bindings",
                "joint_purchasing_ancillary_original_bindings",
                "operator_service_economics", "recipient_use_value_evidence", "market_order_economics",
                "uncommitted_order_cost_evidence", "portfolio_scope_evidence",
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
    # Qualify ORIGINAL Work -> due cause before running the SAME cash model:
    # the obligor's adverse stress cannot silently defer an earlier source-
    # declared contractual due date merely because a forecast says "later".
    payment_splits = None
    if (("work_payment_settlement_claims" in doc or
         "work_payment_due_amendments" in doc)
        and "work_payment_conditions" not in doc):
        raise EconomicInputError("PAYMENT_PROGRESS_REQUIRES_ORIGINAL_WORK_TERMS")
    if "work_payment_conditions" in doc:
        view = _review_work_payment_conditions(
            doc["work_payment_conditions"], works=works, trace=trace,
            sources=sources, transfer_index=transfer_index,
            resource_index=resource_index, cash_timing=doc.get("cash_timing"),
        )
        if ("work_payment_settlement_claims" in doc or
                "work_payment_due_amendments" in doc):
            payment_splits = _review_work_payment_progress(
                view, settlement_claims=doc.get("work_payment_settlement_claims"),
                due_amendments=doc.get("work_payment_due_amendments"),
                raw_terms=doc["work_payment_conditions"],
                sources=sources, transfer_index=transfer_index,
                works=works, trace=trace, cash_timing=doc["cash_timing"],
            )
        output["work_payment_causality"] = view
    agreed_installments = {}
    # Only the end-of-run strict source gate can qualify the new cash path.
    # The legacy private prospective subset without Work terms does not use
    # subsequent settlement claims as a prediction of the owner's decision.
    if "work_payment_conditions" in doc:
        offers = {r["outside_offer_id"]: r for r in trace
                  if r.get("action") == "outside_supplier_offer" and r.get("outcome") == "APPLIED"
                  and "outside_offer_installments" in r}
        committed = {r["work"] for r in trace
                     if r.get("action") == "commit" and r.get("outcome") == "APPLIED"}
        for request in trace:
            if (request.get("action") != "request" or request.get("outcome") != "APPLIED"
                    or request.get("work") not in committed):
                continue
            offer = offers.get(request.get("outside_work_origin", {}).get("outside_offer_id"))
            if offer is None:
                continue
            selected = [key for key, row in transfer_index.items()
                        if row["work"] == request["work"] and row["scenario"] == "COOPERATION"
                        and row["payer"] == offer["outside_offer_buyer"] and row["payee"] == offer["actor"]]
            if len(selected) != 1:
                raise EconomicInputError("OUTSIDE_INSTALLMENT_SINGLE_ORIGINAL_TRANSFER_REQUIRED")
            schedule = offer["outside_offer_installments"]
            if (payment_splits is None or payment_splits.get(selected[0]) !=
                    [(r["at"], Decimal(r["amount"])) for r in schedule]):
                raise EconomicInputError("OUTSIDE_INSTALLMENT_ORIGINAL_PAYMENT_PROGRESS_REQUIRED")
            agreed_installments[selected[0]] = schedule
    if len(agreed_installments) != strict_outside_installment_count:
        raise EconomicInputError("OUTSIDE_INSTALLMENT_STRICT_OWNER_SOURCE_QUALIFICATION_REQUIRED")
    if "cash_timing" in doc:
        # One original money ledger and one pair of owner/network cash clocks.
        # The original declared due remains a conservative due-date obligation
        # in owner stress, even if a new due is merely MODEL asserted.
        due_dates = {
            row["transfer_id"]: row["original_due_at"]
            for row in output.get("work_payment_causality", {}).get("bindings", [])
            if row["original_condition_at"] is not None
            and row["original_due_at"] >= row["original_condition_at"]
        }
        try:
            output["cash_timing"] = evaluate_cash_timing(
                doc["cash_timing"], sources=sources,
                transfer_index=transfer_index, coverage=covered, subjects=subjects,
                outside=outside, original_payment_due=due_dates,
                settlement_splits=payment_splits,
                agreed_installments=agreed_installments or None,
            )
        except LiquidityInputError as exc:
            raise EconomicInputError(str(exc)) from exc
    if "lifecycle_costs" in doc:
        try:
            output["lifecycle_resource_costs"] = classify_lifecycle_costs(
                doc["lifecycle_costs"], sources=sources,
                resource_index=resource_index, subjects=subjects, outside=outside,
                works=works, trace=trace, cooperation_links=cooperation_links,
                allocated_by_work=output.get("common_work_allocations", {}).get(
                    "by_work", {}
                ),
            )
        except LifecycleInputError as exc:
            raise EconomicInputError(str(exc)) from exc
    return output


def review_original_operator_service_economics(
    raw: Any, *, economic_claims: Mapping[str, Any], economic_view: Mapping[str, Any],
    works: Mapping[str, Any], subjects: Mapping[str, Any], operator: str,
    strict_work_ids: str | tuple[str, ...] | None,
) -> dict[str, Any]:
    """Model contribution and fee envelope over original rows, not a second ledger.

    The operator's independently held scope declaration explicitly asserts that
    every listed noncash cost is an opportunity/resource cost NOT already paid
    through any of the listed cash costs. Without that declaration no addition
    is permitted. No price, payment, resource, consent or Work is created here.
    A payer ceiling is an owner's declared period budget, not authenticated
    willingness, alternative advantage or a feasible amended payment schedule.
    """
    _record(raw, {"owner", "source", "fee_transfer_ids", "cash_cost_transfer_ids",
                  "exclusive_resource_use_ids", "payer_fee_limits"},
            "OPERATOR_SERVICE_ECONOMICS")
    if (raw["owner"] != operator or operator not in subjects
            or getattr(subjects[operator], "kind", None) != "OPERATOR"):
        raise EconomicInputError("OPERATOR_SERVICE_REQUIRES_ORIGINAL_OPERATOR")
    if (not isinstance(strict_work_ids, tuple) or not strict_work_ids
            or not economic_view.get("original_strict_context_source_qualification")):
        raise EconomicInputError("OPERATOR_SERVICE_REQUIRES_STRICT_MULTIPERIOD_ORIGINAL_SCOPE")
    scope = set(strict_work_ids)
    source_map = dict(economic_view["declared_source_index"])
    source = _flow_ref(raw["source"], source_map, {operator})
    if any(getattr(works[key], "result", None) != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
           for key in scope):
        raise EconomicInputError("OPERATOR_SERVICE_REQUIRES_ACCEPTED_ORIGINAL_RESULTS")

    transfers = {row["id"]: row for row in economic_claims["transfers"]
                 if operator in {row["payer"], row["payee"]}}
    resources = {row["id"]: row for row in economic_claims["resource_uses"]
                 if row["owner"] == operator}
    if any(row["scenario"] != "COOPERATION" or row["work"] not in scope
           for row in (*transfers.values(), *resources.values())):
        raise EconomicInputError("OPERATOR_SERVICE_ORIGINAL_SCOPE_MISMATCH")
    existing_scope_sources = {row["source"] for row in (*transfers.values(), *resources.values())}
    existing_scope_sources.add(economic_claims["coverage"]["COOPERATION"].get(operator))
    existing_scope_sources.add(economic_claims.get("lifecycle_costs", {}).get(
        "scope_proofs", {}).get("COOPERATION", {}).get(operator))
    if source_map[source]["reference"] in {
            source_map[key]["reference"] for key in existing_scope_sources if key in source_map}:
        raise EconomicInputError("OPERATOR_SERVICE_SEPARATE_COST_NONOVERLAP_SOURCE_REQUIRED")

    def ids(field: str) -> set[str]:
        rows = _bounded_list(raw[field], "OPERATOR_SERVICE_REFERENCE")
        keys = [_identifier(value, "OPERATOR_SERVICE_REFERENCE") for value in rows]
        if len(set(keys)) != len(keys):
            raise EconomicInputError("OPERATOR_SERVICE_DUPLICATE_REFERENCE")
        return set(keys)

    fee_ids = ids("fee_transfer_ids")
    cash_ids = ids("cash_cost_transfer_ids")
    noncash_ids = ids("exclusive_resource_use_ids")
    if (not fee_ids or not noncash_ids or fee_ids & cash_ids
            or fee_ids | cash_ids != set(transfers) or noncash_ids != set(resources)):
        raise EconomicInputError("OPERATOR_SERVICE_FULL_DISJOINT_ORIGINAL_COST_SCOPE_REQUIRED")
    if any(transfers[key]["payee"] != operator or transfers[key]["payer"] == "EXTERNAL"
           for key in fee_ids) or any(transfers[key]["payer"] != operator for key in cash_ids):
        raise EconomicInputError("OPERATOR_SERVICE_TRANSFER_DIRECTION_MISMATCH")
    if ({transfers[key]["work"] for key in fee_ids} != scope
            or {resources[key]["work"] for key in noncash_ids} != scope):
        raise EconomicInputError("OPERATOR_SERVICE_ALL_PERIODS_REQUIRE_FEE_AND_COST_ROWS")
    if not economic_view["per_subject"][operator]["declared_complete"]["COOPERATION"]:
        raise EconomicInputError("OPERATOR_SERVICE_FULL_CASH_SCOPE_REQUIRED")
    life = economic_view.get("lifecycle_resource_costs", {})
    owner_scope = life.get("owner_scoped_details", {}).get(operator, {}).get(
        "scenarios", {}).get("COOPERATION", {})
    if not owner_scope.get("declared_resource_scope_complete_not_audited"):
        raise EconomicInputError("OPERATOR_SERVICE_FULL_RESOURCE_SCOPE_REQUIRED")
    timed = life.get("original_work_event_timing", {}).get("by_original_work", {})
    anchored = {row["resource_use_id"] for key in scope
                for row in timed.get(key, {}).get("per_original_scenario_owner", {})
                .get("COOPERATION", {}).get(operator, ())}
    if anchored != noncash_ids:
        raise EconomicInputError("OPERATOR_SERVICE_ORIGINAL_COST_ANCHORS_REQUIRED")
    terms = {row["transfer_id"]: row for row in
             economic_view.get("work_payment_causality", {}).get("bindings", ())}
    if any(terms.get(key, {}).get("status") !=
           "MODEL_ORIGINAL_TRIGGER_DUE_AND_POSTING_ORDER_CONSISTENT"
           for key in transfers):
        raise EconomicInputError("OPERATOR_SERVICE_ORIGINAL_PAYMENT_CAUSALITY_REQUIRED")
    fees_by_payer: dict[str, Decimal] = defaultdict(Decimal)
    for key in fee_ids:
        fees_by_payer[transfers[key]["payer"]] += _amount(transfers[key]["amount"])
    caps = {}
    for row in _bounded_list(raw["payer_fee_limits"], "OPERATOR_SERVICE_PAYER_LIMIT"):
        _record(row, {"owner", "source", "maximum_total_fee"}, "OPERATOR_SERVICE_PAYER_LIMIT")
        owner = _identifier(row["owner"], "OPERATOR_SERVICE_PAYER")
        if owner in caps or owner not in fees_by_payer:
            raise EconomicInputError("OPERATOR_SERVICE_PAYER_LIMIT_SCOPE_MISMATCH")
        payer_source = _flow_ref(row["source"], source_map, {owner})
        if source_map[payer_source]["reference"] in {
                source_map[transfers[key]["source"]]["reference"] for key in fee_ids}:
            raise EconomicInputError("OPERATOR_SERVICE_SEPARATE_PAYER_LIMIT_SOURCE_REQUIRED")
        caps[owner] = _amount(row["maximum_total_fee"])
    if set(caps) != set(fees_by_payer):
        raise EconomicInputError("OPERATOR_SERVICE_ALL_INDEPENDENT_PAYER_LIMITS_REQUIRED")

    fees = sum(fees_by_payer.values(), Decimal(0))
    cash_cost = sum((_amount(transfers[key]["amount"]) for key in cash_ids), Decimal(0))
    noncash = sum((_amount(resources[key]["amount"]) for key in noncash_ids), Decimal(0))
    floor = cash_cost + noncash
    ceiling = sum(caps.values(), Decimal(0))
    contribution = fees - floor
    liquidity = economic_view.get("cash_timing", {}).get(
        "per_original_owner_private_research_projection", {})
    paths = {owner: liquidity.get(owner, {}).get("scenario_paths", {}).get(
        "COOPERATION", {}).get("declared_late_case", {}).get("status", "NOT_IDENTIFIABLE")
        for owner in (operator, *sorted(caps))}
    return {
        "evidence": "MODEL_ONLY_SOURCE_DECLARED_NONOVERLAPPING_SERVICE_COST",
        "original_work_count": len(scope),
        "original_fee_transfer_count": len(fee_ids),
        "original_cash_cost_transfer_count": len(cash_ids),
        "original_exclusive_resource_use_count": len(noncash_ids),
        "independent_payer_count": len(caps),
        "contribution_direction": "POSITIVE" if contribution > 0 else "ZERO" if contribution == 0 else "NEGATIVE",
        "declared_fee_envelope_status": (
            "POSITIVE_CONTRIBUTION_POSSIBLE_WITHIN_DECLARED_CAPS_ONLY"
            if ceiling > floor else "BREAK_EVEN_ONLY_WITHIN_DECLARED_CAPS"
            if ceiling == floor else "DECLARED_CAPS_CANNOT_COVER_COST"),
        "current_fee_respects_all_declared_caps": all(
            fees_by_payer[owner] <= caps[owner] for owner in caps),
        "current_modeled_stress_reserve_status_counts": {
            status: list(paths.values()).count(status) for status in sorted(set(paths.values()))
        },
        "local_research_only": {
            "original_fee_amount": _sum_str([fees]),
            "original_cash_cost": _sum_str([cash_cost]),
            "original_declared_cash_net": _sum_str([fees - cash_cost]),
            "exclusive_noncash_resource_cost": _sum_str([noncash]),
            "model_service_contribution": _sum_str([contribution]),
            "break_even_total_fee": _sum_str([floor]),
            "aggregate_declared_payer_ceiling": _sum_str([ceiling]),
            "maximum_model_contribution_within_caps": _sum_str([ceiling - floor]),
            "current_owner_stress_reserve_status": paths,
        },
        "cash_and_resource_addition_requires_explicit_owned_nonoverlap_declaration": True,
        "fee_ceiling_does_not_prove_payer_advantage_or_agreement": True,
        "alternative_fee_timing_and_liquidity_not_simulated": True,
        "original_transfers_resources_results_and_consents_unchanged": True,
        "real_profit_and_causal_additionality": "NOT_IDENTIFIABLE",
    }


def review_original_recipient_use_value(
    raw: Any, *, economic_claims: Mapping[str, Any], economic_view: Mapping[str, Any],
    works: Mapping[str, Any], trace: Sequence[Mapping[str, Any]],
    strict_work_ids: str | tuple[str, ...] | None,
) -> dict[str, Any]:
    """Recipient's own incremental use value, over existing Work-linked costs.

    Baseline is a declared no-selected-order scenario, not an executed outside
    alternative. Outcome units, valuation rate and nonoverlap are separately
    held original owner model documents. No new price, payment, Result or
    inferred causal gain. Use value excludes receipts and resource/cash costs.
    """
    from decimal import ROUND_HALF_UP

    records = _bounded_list(raw, "RECIPIENT_VALUE")
    if not records:
        raise EconomicInputError("RECIPIENT_VALUE_EVIDENCE_REQUIRED")
    scope = (strict_work_ids,) if isinstance(strict_work_ids, str) else strict_work_ids
    strict = economic_view.get("original_strict_context_source_qualification", {})
    if not scope or strict.get("status") != "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED":
        raise EconomicInputError("RECIPIENT_VALUE_ORIGINAL_STRICT_SCOPE_REQUIRED")
    if strict.get("source_scoped_original_recipient_value_count") != len(records):
        raise EconomicInputError("RECIPIENT_VALUE_ORIGINAL_HISTORICAL_SOURCES_REQUIRED")
    sources = dict(economic_view["declared_source_index"])
    money = economic_claims
    horizon = money.get("cash_timing", {}).get("horizon_end")
    if type(horizon) is not int:
        raise EconomicInputError("RECIPIENT_VALUE_ORIGINAL_HORIZON_REQUIRED")
    life = economic_view.get("lifecycle_resource_costs", {})
    timed = life.get("original_work_event_timing", {}).get("by_original_work", {})
    payment = {row["transfer_id"]: row for row in
               economic_view.get("work_payment_causality", {}).get("bindings", ())}
    seen, output, private = set(), [], {}
    qty_pattern = re.compile(r"(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,4})?\Z")

    def quantity(value):
        if not isinstance(value, str) or not qty_pattern.fullmatch(value):
            raise EconomicInputError("RECIPIENT_VALUE_EXACT_QUANTITY_REQUIRED")
        return Decimal(value)

    def ids(values):
        keys = [_identifier(v, "RECIPIENT_VALUE_ORIGINAL_ROW")
                for v in _bounded_list(values, "RECIPIENT_VALUE_ORIGINAL_ROW")]
        if len(keys) != len(set(keys)):
            raise EconomicInputError("RECIPIENT_VALUE_DUPLICATE_ORIGINAL_ROW")
        return set(keys)

    def direction(value):
        return "POSITIVE" if value > 0 else "ZERO" if value == 0 else "NEGATIVE"

    for row in records:
        _record(row, {"work", "owner", "work_revision", "result_ref", "basis",
                      "unit", "valuation_horizon", "baseline", "outcome", "rate",
                      "nonoverlap_source", "transfer_ids", "resource_use_ids",
                      "incremental_costs_exclude_value_and_each_other"},
                "RECIPIENT_VALUE")
        work_id = _identifier(row["work"], "RECIPIENT_VALUE_WORK")
        owner = _identifier(row["owner"], "RECIPIENT_VALUE_OWNER")
        if work_id in seen or work_id not in scope or work_id not in works:
            raise EconomicInputError("RECIPIENT_VALUE_ORIGINAL_WORK_SCOPE_REQUIRED")
        seen.add(work_id)
        work = works[work_id]
        if owner != work.customer or row["work_revision"] != work.source_revision:
            raise EconomicInputError("RECIPIENT_VALUE_ORIGINAL_CUSTOMER_REVISION_REQUIRED")
        _identifier(row["basis"], "RECIPIENT_VALUE_USE_BASIS")
        _identifier(row["unit"], "RECIPIENT_VALUE_UNIT")
        _identifier(row["result_ref"], "RECIPIENT_VALUE_RESULT")
        if type(row["valuation_horizon"]) is not int or row["valuation_horizon"] != horizon:
            raise EconomicInputError("RECIPIENT_VALUE_MATCHED_HORIZON_REQUIRED")
        baseline = _record(row["baseline"], {"source", "at", "quantity", "kind"},
                           "RECIPIENT_VALUE_BASELINE")
        outcome = _record(row["outcome"], {"source", "at", "quantity", "kind"},
                          "RECIPIENT_VALUE_OUTCOME")
        rate = _record(row["rate"], {"source", "at", "amount", "currency"},
                       "RECIPIENT_VALUE_RATE")
        if (baseline["kind"] != "DECLARED_NO_SELECTED_ORDER_BASELINE"
                or outcome["kind"] != "DECLARED_USE_OF_ACCEPTED_RESULT"
                or rate["currency"] != money["currency"]
                or row["incremental_costs_exclude_value_and_each_other"] is not True):
            raise EconomicInputError("RECIPIENT_VALUE_INCREMENTAL_NONOVERLAP_BASIS_REQUIRED")
        before, after, unit_rate = quantity(baseline["quantity"]), quantity(outcome["quantity"]), _amount(rate["amount"])
        refs = [sources[_flow_ref(item, sources, {owner})]["reference"]
                for item in (baseline["source"], outcome["source"], rate["source"], row["nonoverlap_source"])]
        all_owner_transfers = [t for t in money["transfers"] if owner in {t["payer"], t["payee"]}]
        all_owner_resources = [r for r in money["resource_uses"] if r["owner"] == owner]
        excluded = {sources[r["source"]]["reference"] for r in
                    (*all_owner_transfers, *all_owner_resources)}
        for key in (money["coverage"]["COOPERATION"].get(owner),
                    money.get("lifecycle_costs", {}).get("scope_proofs", {}).get("COOPERATION", {}).get(owner)):
            if key in sources:
                excluded.add(sources[key]["reference"])
        for binding in money.get("lifecycle_costs", {}).get("event_bindings", []):
            if binding["owner"] == owner:
                excluded.add(binding["cost_evidence_ref"])
        for field in ("work_payment_settlement_claims", "work_payment_due_amendments"):
            owner_ids = {t["id"] for t in all_owner_transfers}
            for item in money.get(field, []):
                if item["transfer_id"] in owner_ids:
                    excluded.update(item.get("evidence_refs", {}).values())
        for event in trace:
            if event.get("actor") == owner and event.get("work") == work_id:
                for field in ("quality_evidence_ref", "review_source_ref", "result_ref"):
                    if isinstance(event.get(field), str):
                        excluded.add(event[field])
        if len(set(refs)) != 4 or set(refs) & excluded:
            raise EconomicInputError("RECIPIENT_VALUE_DISTINCT_OWNER_DOCUMENTS_REQUIRED")
        transfers = {t["id"]: t for t in all_owner_transfers if t["work"] == work_id}
        resources = {r["id"]: r for r in all_owner_resources if r["work"] == work_id}
        if (ids(row["transfer_ids"]) != set(transfers)
                or ids(row["resource_use_ids"]) != set(resources)
                or any(r["scenario"] != "COOPERATION" for r in (*transfers.values(), *resources.values()))
                or any(r["work"] is None for r in (*all_owner_transfers, *all_owner_resources))):
            raise EconomicInputError("RECIPIENT_VALUE_COMPLETE_INCREMENTAL_ORIGINAL_ROWS_REQUIRED")
        if not any(t["payer"] == owner and t["payee"] != "EXTERNAL"
                   and _amount(t["amount"]) > 0 for t in transfers.values()):
            raise EconomicInputError("RECIPIENT_VALUE_ORIGINAL_PURCHASE_REQUIRED")
        events = [e for e in trace if e.get("work") == work_id and e.get("outcome") == "APPLIED"]
        commits = [e["at"] for e in events if e["action"] == "commit"]
        accepts = [e["at"] for e in events if e["action"] == "accept" and e.get("actor") == owner]
        reasons = []
        if (work.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT" or work.obligation != "FULFILLED"
                or len(commits) != 1 or len(accepts) != 1):
            reasons.append("ORIGINAL_ACCEPTED_RESULT_REQUIRED")
        else:
            if row["result_ref"] != work.result_ref:
                raise EconomicInputError("RECIPIENT_VALUE_ORIGINAL_RESULT_REFERENCE_MISMATCH")
            if not (0 <= baseline["at"] <= rate["at"] < commits[0] < accepts[0] < outcome["at"] <= horizon):
                raise EconomicInputError("RECIPIENT_VALUE_BASELINE_AND_OUTCOME_TIME_ORDER_REQUIRED")
        owner_scope = life.get("owner_scoped_details", {}).get(owner, {}).get("scenarios", {}).get("COOPERATION", {})
        anchors = {item["resource_use_id"] for item in timed.get(work_id, {}).get(
            "per_original_scenario_owner", {}).get("COOPERATION", {}).get(owner, [])}
        if (not economic_view["per_subject"][owner]["declared_complete"]["COOPERATION"]
                or not owner_scope.get("declared_resource_scope_complete_not_audited")
                or anchors != set(resources)
                or any(payment.get(key, {}).get("status") !=
                       "MODEL_ORIGINAL_TRIGGER_DUE_AND_POSTING_ORDER_CONSISTENT" for key in transfers)):
            reasons.append("ORIGINAL_INCREMENTAL_COST_SCOPE_INCOMPLETE")
        base = {"work": work_id, "owner": owner,
                "status": "UNKNOWN" if reasons else "MODEL_ORIGINAL_RECIPIENT_INCREMENTAL_USE_VALUE",
                "reasons": sorted(set(reasons))}
        if not reasons:
            gross = ((after - before) * unit_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            net_cash = sum((_amount(t["amount"]) * (1 if t["payee"] == owner else -1)
                            for t in transfers.values()), Decimal(0))
            noncash = sum((_amount(r["amount"]) for r in resources.values()), Decimal(0))
            surplus = gross + net_cash - noncash
            base["incremental_use_value_direction"] = direction(gross)
            base["recipient_model_surplus_direction"] = direction(surplus)
            private[work_id] = {
                "incremental_gross_noncash_use_value": _sum_str([gross]),
                "original_recipient_incremental_net_cash": _sum_str([net_cash]),
                "original_recipient_exclusive_resource_cost": _sum_str([noncash]),
                "recipient_model_surplus_vs_declared_no_order": _sum_str([surplus]),
            }
        output.append(base)
    return {
        "schema": "AKIS_ORIGINAL_RECIPIENT_USE_VALUE/1.0",
        "status": "MODEL_ONLY", "results": sorted(output, key=lambda r: r["work"]),
        "qualified_original_recipient_count": len(private),
        "local_research_only": private,
        "no_order_baseline_not_executed_alternative": True,
        "cash_receipts_not_counted_as_use_value": True,
        "incremental_nonoverlap_is_owner_declaration_not_audit": True,
        "actual_use_value_profit_and_causal_additionality": "NOT_IDENTIFIABLE",
        "original_work_result_payments_and_consent_unchanged": True,
    }


def _qualified_activity_efficiency(
    *, state: Any, money: Mapping[str, Any], work_ids: set[str],
    owners: set[str], transfers: Mapping[str, Any], resources: Mapping[str, Any],
    accepted_work_use_value: Mapping[str, Decimal],
    expected_contribution: Decimal,
) -> dict[str, Any]:
    """Observe economics of already qualified ORIGINAL activity.

    No new cost, financial account, search, optimizer, consent or event.
    Use value is not enterprise revenue. Transfer amounts are declared
    model obligations, not automatically bank receipts or accounting profit.
    The consolidated cost denominator excludes all internal transfers.
    """
    zero = Decimal(0)

    def amount(value):
        return _sum_str([value])

    def ratio(numerator, denominator):
        return f"{numerator / denominator:.4f}" if denominator > 0 else None

    if not set(accepted_work_use_value) <= work_ids:
        raise EconomicInputError("ACTIVITY_EFFICIENCY_ORIGINAL_ACCEPTED_SCOPE_MISMATCH")
    work_values = {key: accepted_work_use_value.get(key, zero) for key in sorted(work_ids)}
    recipients = {state.works[key].customer for key in work_ids}
    cash_in = {o: zero for o in owners}
    cash_out, outside_in, own_cost, use_value = (dict(cash_in) for _ in range(4))
    per_work = {key: {
        "external_in": zero, "external_out": zero, "resource_cost": zero,
        "precommit_resource_cost": zero, "rework_resource_cost": zero,
        "rework_cost_record_count": 0,
        "resource_restoration_cost": zero, "resource_restoration_cost_count": 0,
        "supplementary_handoff_resource_cost": zero, "supplementary_handoff_cost_count": 0,
    } for key in work_values}
    internal_turnover = zero
    for key, value in work_values.items():
        use_value[state.works[key].customer] += value
    for row in transfers.values():
        key, payer, payee = row["work"], row["payer"], row["payee"]
        value = _amount(row["amount"])
        if payer != "EXTERNAL":
            cash_out[payer] += value
        if payee != "EXTERNAL":
            cash_in[payee] += value
        if payer == "EXTERNAL":
            outside_in[payee] += value
            per_work[key]["external_in"] += value
        elif payee == "EXTERNAL":
            per_work[key]["external_out"] += value
        else:
            internal_turnover += value

    lifecycle = money["lifecycle_costs"]
    classifications = {b["resource_use_id"]: b for b in lifecycle["bindings"]
                       if b["resource_use_id"] in resources}
    anchors = {b["resource_use_id"]: b for b in lifecycle["event_bindings"]
               if b["resource_use_id"] in resources}
    if set(classifications) != set(resources) or set(anchors) != set(resources):
        raise EconomicInputError("ACTIVITY_EFFICIENCY_COMPLETE_ORIGINAL_COST_ANCHORS_REQUIRED")
    stage_cost = {stage: zero for stage in STAGES}
    nature_cost = {nature: zero for nature in NATURES}
    histories = {key: [r for r in state.trace if r.get("work") == key] for key in work_values}
    first_attempt = {key: min((r["at"] for r in history if r["action"] == "commit"),
                              default=None)
                     for key, history in histories.items()}
    for rid, row in resources.items():
        key, owner = row["work"], row["owner"]
        value = _amount(row["amount"])
        stage = classifications[rid]["stage"]
        stage_cost[stage] += value
        nature_cost[classifications[rid]["nature"]] += value
        own_cost[owner] += value
        per_work[key]["resource_cost"] += value
        if first_attempt[key] is not None and anchors[rid]["at"] < first_attempt[key]:
            per_work[key]["precommit_resource_cost"] += value
        if stage == "CLAIMS_AND_REWORK":
            per_work[key]["rework_resource_cost"] += value
            per_work[key]["rework_cost_record_count"] += 1
        if anchors[rid]["action"] == "resource_status":
            per_work[key]["resource_restoration_cost"] += value
            per_work[key]["resource_restoration_cost_count"] += 1
        anchor = state.trace[anchors[rid]["trace_position"]]
        if (anchor.get("action") in {"handoff_dispatch", "handoff_receive", "handoff_quality"}
                and anchor.get("material_replenishment_round", 1) > 1):
            per_work[key]["supplementary_handoff_resource_cost"] += value
            per_work[key]["supplementary_handoff_cost_count"] += 1

    def summarize(external_in, external_out, resource_cost, value):
        cost = external_out + resource_cost
        balance = value + external_in - cost
        return {
            "gross_incremental_recipient_use_value": amount(value),
            "external_declared_transfer_inflows": amount(external_in),
            "external_declared_transfer_outflows": amount(external_out),
            "exclusive_noncash_resource_cost": amount(resource_cost),
            "external_outflows_plus_exclusive_resource_cost": amount(cost),
            "model_economic_contribution": amount(balance),
            # Unclassified external receipts may represent funding rather
            # than output. Do not label their return as operating profit.
            "use_value_to_cost_ratio": ratio(value, cost) if external_in == 0 else None,
            "contribution_to_cost_ratio": ratio(balance, cost) if external_in == 0 else None,
            "cost_ratio_status": ("UNCLASSIFIED_EXTERNAL_INFLOW"
                                  if external_in != 0 else
                                  "POSITIVE_DECLARED_COST_DENOMINATOR"
                                  if cost > 0 else "ZERO_COST_DENOMINATOR"),
        }

    horizon = money["cash_timing"]["horizon_end"]
    work_details = {}
    for key, history in histories.items():
        applied = [r for r in history if r["outcome"] == "APPLIED"]
        requests = [r["at"] for r in applied if r["action"] == "request"]
        commits = [r["at"] for r in applied if r["action"] == "commit"]
        accepts = [r["at"] for r in applied if r["action"] == "accept"]
        completed = key in accepted_work_use_value
        if completed != (len(accepts) == 1):
            raise EconomicInputError("ACTIVITY_EFFICIENCY_ORIGINAL_ACCEPTANCE_MISMATCH")
        c = per_work[key]
        rejects = [r["at"] for r in applied if r["action"] == "reject"]
        resubmits = [r["at"] for r in applied if r["action"] == "resubmit"]
        negative = sum(r["action"] == "assess_result_quality" and
                       r.get("quality_verdict") == "DOES_NOT_MEET" for r in applied)
        submitted = [r["at"] for r in applied if r["action"] == "complete"]
        recovery = completed and bool(rejects) and bool(resubmits)
        quality_cost_status = (
            "DECLARED_ORIGINAL_REWORK_RESOURCE_ROWS_NOT_ACTUAL_COST_AUDIT"
            if c["rework_cost_record_count"] else
            "QUALITY_SIGNAL_WITHOUT_SEPARATE_REWORK_COST_MEASUREMENT"
            if rejects or resubmits or negative else
            "NO_ORIGINAL_FAILURE_SIGNAL_OR_REWORK_COST_ROW")
        disturbance = original_execution_readiness_view(state.trace, key, horizon)
        original_work = state.works[key]
        replenished = {}
        for batch in original_work.material_batches:
            st = original_work.material_states[batch.key]
            if not st.previous_rounds:
                continue
            dispatched = st.observed_total("dispatched")
            received = st.observed_total("received")
            accepted = st.observed_total("accepted")
            rejected = st.observed_total("rejected")
            replenished[batch.key] = {
                "unit": batch.unit,
                "planned_quantity": str(batch.planned_quantity),
                "cumulative_dispatched_quantity": str(dispatched),
                "cumulative_received_quantity": str(received) if received is not None else None,
                "cumulative_accepted_quantity": str(accepted) if accepted is not None else None,
                "cumulative_rejected_quantity": str(rejected) if rejected is not None else None,
                "cumulative_unreceived_quantity": (
                    str(dispatched-received) if st.received is not None else None),
                "cumulative_unassessed_quantity": (
                    str(received-accepted-rejected) if st.quality_ref is not None else None),
                "original_round_count": len(st.previous_rounds)+1,
                "qualified_quantity_to_dispatched_ratio": (
                    ratio(accepted, dispatched) if st.quality_ref is not None else None),
            }
        material_effect = {}
        if replenished:
            material_effect = {
                "original_material_replenishment": {
                    "per_original_batch": replenished,
                    "original_applied_supplementary_dispatch_count": sum(
                        r["action"] == "handoff_dispatch" and
                        r.get("material_replenishment_round", 1) > 1 for r in applied),
                    "original_applied_supplementary_inspection_count": sum(
                        r["action"] == "handoff_quality" and
                        r.get("material_replenishment_round", 1) > 1 for r in applied),
                    "separately_declared_supplementary_handoff_resource_cost": (
                        amount(c["supplementary_handoff_resource_cost"])
                        if c["supplementary_handoff_cost_count"] else None),
                    "supplementary_handoff_original_cost_row_count": (
                        c["supplementary_handoff_cost_count"]),
                    "quantities_and_ratios_not_physical_inventory_audit": True,
                    "costs_are_existing_exclusive_rows_not_new_expenses": True,
                    "rejected_or_unreceived_material_not_reclassified_as_usable": True,
                }
            }
        work_details[key] = {
            **material_effect,
            **({"original_execution_readiness": disturbance,
                "separately_declared_resource_restoration_cost": (
                    amount(c["resource_restoration_cost"]) if c["resource_restoration_cost_count"] else None),
                "resource_restoration_cost_record_count": c["resource_restoration_cost_count"]}
               if disturbance is not None else {}),
            **summarize(c["external_in"], c["external_out"], c["resource_cost"], work_values[key]),
            "accepted_original_result": completed,
            "request_to_accept_model_ticks": (
                accepts[0] - requests[0] if completed and len(requests) == 1 else None),
            "commit_to_accept_model_ticks": (
                accepts[0] - commits[0] if completed and len(commits) == 1 else None),
            "precommit_exclusive_resource_cost": (
                amount(c["precommit_resource_cost"]) if first_attempt[key] is not None else None),
            "claims_and_rework_exclusive_resource_cost": amount(c["rework_resource_cost"]),
            "original_reject_or_resubmit_transition_count": len(rejects)+len(resubmits),
            "original_negative_quality_assessment_count": negative,
            "original_quality_assessment_count": sum(
                r["action"] == "assess_result_quality" for r in applied),
            "original_rejected_result_count": len(rejects),
            "original_resubmission_count": len(resubmits),
            "accepted_without_prior_result_rejection": completed and not rejects,
            "accepted_after_result_resubmission": recovery,
            "first_submission_to_accept_model_ticks": (
                accepts[0]-submitted[0] if completed and len(submitted) == 1 else None),
            "first_rejection_to_accept_model_ticks": (
                accepts[0]-rejects[0] if recovery else None),
            "claims_and_rework_original_resource_row_count": c["rework_cost_record_count"],
            "claims_and_rework_measurement_status": quality_cost_status,
            "separately_measured_rework_resource_cost": (
                amount(c["rework_resource_cost"]) if c["rework_cost_record_count"] else None),
            "resubmission_does_not_establish_physical_rework": True,
        }
    # Keep incomparable resource units separate; reservation time is not
    # actual machine time. The reservation ledger is never changed.
    reserved = {key: 0 for key in sorted(state.resources)}
    for item in state.capacity_ledger.reservations:
        if item.work in work_ids:
            reserved[item.resource] += max(0, min(item.end, horizon)-item.start) * item.units

    private = {}
    for owner in sorted(owners):
        balance = cash_in[owner] - cash_out[owner] - own_cost[owner]
        private[owner] = {
            "original_recipient_in_selected_scope": owner in recipients,
            "original_operator": owner == state.institution.operator,
            "declared_transfer_inflows": amount(cash_in[owner]),
            "declared_transfer_outflows": amount(cash_out[owner]),
            "exclusive_noncash_resource_cost": amount(own_cost[owner]),
            "model_cash_resource_balance": amount(balance),
            "gross_incremental_recipient_use_value": amount(use_value[owner]),
            "model_economic_contribution": amount(balance + use_value[owner]),
            "nonrecipient_balance_to_declared_inflows_ratio": (
                ratio(balance, cash_in[owner])
                if owner not in recipients and outside_in[owner] == 0 else None),
        }
    consolidated = summarize(
        sum((v["external_in"] for v in per_work.values()), zero),
        sum((v["external_out"] for v in per_work.values()), zero),
        sum(own_cost.values(), zero), sum(work_values.values(), zero))
    if (Decimal(consolidated["model_economic_contribution"]) != expected_contribution
            or sum((Decimal(v["model_economic_contribution"]) for v in private.values()), zero)
                != expected_contribution
            or sum((Decimal(v["model_economic_contribution"]) for v in work_details.values()), zero)
                != expected_contribution
            or sum(stage_cost.values(), zero) != sum(own_cost.values(), zero)
            or sum(nature_cost.values(), zero) != sum(own_cost.values(), zero)):
        raise EconomicInputError("ACTIVITY_EFFICIENCY_ORIGINAL_CONSOLIDATION_MISMATCH")
    return {
        "schema": "AKIS_QUALIFIED_ORIGINAL_ACTIVITY_EFFICIENCY/1.0",
        "status": "MODEL_DECLARED_COST_VALUE_AND_EXECUTED_WORK_MEASURES",
        "selected_original_work_count": len(work_ids),
        "accepted_original_work_count": len(accepted_work_use_value),
        "accepted_without_prior_result_rejection_count": sum(
            w["accepted_without_prior_result_rejection"] for w in work_details.values()),
        "accepted_after_result_resubmission_count": sum(
            w["accepted_after_result_resubmission"] for w in work_details.values()),
        "original_quality_signal_without_separately_measured_rework_cost_work_count": sum(
            w["claims_and_rework_measurement_status"] ==
            "QUALITY_SIGNAL_WITHOUT_SEPARATE_REWORK_COST_MEASUREMENT"
            for w in work_details.values()),
        "consolidated": consolidated,
        "per_original_owner": private,
        "per_original_work": work_details,
        "exclusive_resource_cost_by_stage": {k: amount(v) for k, v in stage_cost.items()},
        "exclusive_resource_cost_by_nature": {k: amount(v) for k, v in nature_cost.items()},
        "internal_transfer_turnover_not_system_output": amount(internal_turnover),
        "reserved_capacity_unit_ticks_by_resource": reserved,
        "capacity_measure": "PLANNED_RESERVATION_WITHIN_MODEL_HORIZON_NOT_ACTUAL_MACHINE_TIME",
        "elapsed_time_measure": "ORIGINAL_EVENT_CLOCK_TICKS_NOT_PHYSICAL_TIME",
        "selected_work_counts_not_homogeneous_physical_quantity": True,
        "stage_and_nature_are_two_views_of_same_cost_not_additive": True,
        "use_value_is_not_enterprise_sales_or_cash": True,
        "accounting_profit_actual_productivity_and_causal_effect": "NOT_IDENTIFIABLE",
        "no_original_activity_selected_ranked_or_changed": True,
    }


def review_original_market_order_economics(
    raw: Any, *, state: Any, economic_claims: Mapping[str, Any],
    economic_view: Mapping[str, Any], strict_work_ids: str | tuple[str, ...] | None,
) -> dict[str, Any]:
    """Read-only selected order projection over the original cumulative ledger.

    Cash transfers cancel on consolidation. Independently declared incremental
    resource and opportunity costs must exclude paid expenses and each other.
    The buyer's own no-order valuation is NOT an executed counterfactual.
    """
    _record(raw, {"work", "work_revision", "result_ref", "owner_scopes"}, "MARKET_ORDER")
    scope = (strict_work_ids,) if isinstance(strict_work_ids, str) else strict_work_ids
    strict = economic_view.get("original_strict_context_source_qualification", {})
    key = _identifier(raw["work"], "MARKET_ORDER_WORK")
    if not scope or key not in scope or key not in state.works or strict.get("status") != (
            "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED"):
        raise EconomicInputError("MARKET_ORDER_ORIGINAL_STRICT_WORK_SCOPE_REQUIRED")
    work = state.works[key]
    op, buyer = state.institution.operator, work.customer
    providers = state.capacity_ledger.original_owners(work.resource_requirements)
    owners = providers | {buyer, op}
    buyer_produces = buyer in providers
    scoped_owners = owners if buyer_produces else owners - {buyer}
    if (len(providers) < 2 or len(work.operations) < 2
            or op in providers or op == buyer or raw["work_revision"] != work.source_revision):
        raise EconomicInputError("MARKET_ORDER_ORIGINAL_INDEPENDENT_TECHNOLOGY_SCOPE_REQUIRED")
    if not isinstance(raw["owner_scopes"], dict) or not set(raw["owner_scopes"]) <= scoped_owners:
        raise EconomicInputError("MARKET_ORDER_ORIGINAL_OWNER_SCOPE_INVALID")
    if strict.get("source_scoped_market_order_owner_count") != len(raw["owner_scopes"]):
        raise EconomicInputError("MARKET_ORDER_ORIGINAL_OWNER_HISTORICAL_SOURCES_REQUIRED")
    events = [e for e in state.trace if e.get("work") == key and e.get("outcome") == "APPLIED"]
    commits = [e for e in events if e["action"] == "commit"]
    accepts = [e for e in events if e["action"] == "accept" and e.get("actor") == buyer]
    market = commits[0].get("technology_route_market_feasibility", {}) if len(commits) == 1 else {}
    feasibility = market.get("status", "NOT_IDENTIFIABLE")
    reasons = set()
    accepted = (work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                and work.obligation == "FULFILLED" and len(accepts) == len(commits) == 1)
    if accepted:
        if raw["result_ref"] != work.result_ref:
            raise EconomicInputError("MARKET_ORDER_ORIGINAL_RESULT_MISMATCH")
    else:
        reasons.add("ORIGINAL_ACCEPTED_RESULT_REQUIRED")
    if not market.get("selected_cooperative_plan_preview_feasible"):
        reasons.add("ORIGINAL_COMMIT_MARKET_SCOPE_REQUIRED")
    money = economic_claims
    horizon = money.get("cash_timing", {}).get("horizon_end")
    sources = dict(economic_view["declared_source_index"])
    life = economic_view.get("lifecycle_resource_costs", {})
    timed = life.get("original_work_event_timing", {}).get("by_original_work", {}).get(
        key, {}).get("per_original_scenario_owner", {}).get("COOPERATION", {})
    payment = {row["transfer_id"]: row for row in
               economic_view.get("work_payment_causality", {}).get("bindings", ())}
    transfers = {t["id"]: t for t in money["transfers"] if t["work"] == key}
    resources = {r["id"]: r for r in money["resource_uses"] if r["work"] == key}
    if (any({t["payer"], t["payee"]} - {"EXTERNAL"} - owners
            or t["scenario"] != "COOPERATION" for t in transfers.values())
            or any(r["owner"] not in owners or r["scenario"] != "COOPERATION"
                   for r in resources.values())):
        raise EconomicInputError("MARKET_ORDER_COMPLETE_SELECTED_BOUNDARY_REQUIRED")
    if any(payment.get(i, {}).get("status") !=
           "MODEL_ORIGINAL_TRIGGER_DUE_AND_POSTING_ORDER_CONSISTENT" for i in transfers):
        reasons.add("ORIGINAL_PAYMENT_CAUSALITY_INCOMPLETE")
    if set(raw["owner_scopes"]) != scoped_owners:
        reasons.add("INDEPENDENT_OWNER_COST_SCOPE_INCOMPLETE")
    buyer_value = economic_view.get("original_recipient_use_value", {}).get(
        "local_research_only", {}).get(key)
    if not buyer_value:
        reasons.add("ORIGINAL_RECIPIENT_USE_VALUE_INCOMPLETE")

    def ids(values):
        keys = [_identifier(i, "MARKET_ORDER_ORIGINAL_ROW")
                for i in _bounded_list(values, "MARKET_ORDER_ORIGINAL_ROW")]
        if len(keys) != len(set(keys)):
            raise EconomicInputError("MARKET_ORDER_DUPLICATE_ORIGINAL_ROW")
        return set(keys)

    amounts, paths = {}, {}
    liquidity = economic_view.get("cash_timing", {}).get(
        "per_original_owner_private_research_projection", {})
    for owner in sorted(owners):
        cash_rows = {i: t for i, t in transfers.items() if owner in {t["payer"], t["payee"]}}
        cost_rows = {i: r for i, r in resources.items() if owner == r["owner"]}
        owner_scope = life.get("owner_scoped_details", {}).get(owner, {}).get(
            "scenarios", {}).get("COOPERATION", {})
        if (not cash_rows or not cost_rows
                or not economic_view["per_subject"][owner]["declared_complete"]["COOPERATION"]
                or not owner_scope.get("declared_resource_scope_complete_not_audited")
                or {row["resource_use_id"] for row in timed.get(owner, ())} != set(cost_rows)):
            reasons.add("ORIGINAL_COMPLETE_OWNER_COST_SCOPE_REQUIRED")
        if buyer_produces and owner == buyer:
            # The customer is also an original productive principal. Its
            # own production must be witnessed, not inferred from receipt
            # or quality assessment of the Result.
            produced = any(state.resources[operation.primary_resource] == buyer
                           for operation in work.operations)
            production_costs = {b["resource_use_id"] for b in money.get(
                "lifecycle_costs", {}).get("event_bindings", [])
                if b["owner"] == buyer and b.get("work") == key
                and b.get("action") in {"start_operation", "complete_operation"}}
            if (not produced or not production_costs.intersection(cost_rows)
                    or not any(e["action"] == "complete_operation"
                               and e.get("actor") == buyer for e in events)):
                reasons.add("ORIGINAL_RECIPIENT_PRODUCTION_COST_SCOPE_REQUIRED")
        if owner in raw["owner_scopes"]:
            row = _record(raw["owner_scopes"][owner],
                          {"source", "observed_at", "transfer_ids", "resource_use_ids",
                           "incremental_costs_exclude_each_other_and_include_opportunity_costs"},
                          "MARKET_ORDER_OWNER_SCOPE")
            ref = sources[_flow_ref(row["source"], sources, {owner})]["reference"]
            owner_transfers = [t for t in money["transfers"] if owner in {t["payer"], t["payee"]}]
            owner_rows = owner_transfers + [r for r in money["resource_uses"] if r["owner"] == owner]
            excluded = {sources[r["source"]]["reference"] for r in owner_rows}
            for source in (money["coverage"]["COOPERATION"].get(owner),
                           money.get("lifecycle_costs", {}).get("scope_proofs", {}).get(
                               "COOPERATION", {}).get(owner)):
                if source in sources:
                    excluded.add(sources[source]["reference"])
            for binding in money.get("lifecycle_costs", {}).get("event_bindings", []):
                if binding["owner"] == owner:
                    excluded.add(binding["cost_evidence_ref"])
            for field in ("work_payment_settlement_claims", "work_payment_due_amendments"):
                for claim in money.get(field, []):
                    if claim["transfer_id"] in {t["id"] for t in owner_transfers}:
                        excluded.update(claim.get("evidence_refs", {}).values())
            if buyer_produces and owner == buyer:
                for value in money.get("recipient_use_value_evidence", []):
                    if value["work"] == key:
                        for source_id in (value["baseline"]["source"], value["outcome"]["source"],
                                          value["rate"]["source"], value["nonoverlap_source"]):
                            excluded.add(sources[source_id]["reference"])
            if ref in excluded:
                raise EconomicInputError("MARKET_ORDER_DISTINCT_OWNER_INCREMENTAL_SCOPE_SOURCE_REQUIRED")
            if (ids(row["transfer_ids"]) != set(cash_rows)
                    or ids(row["resource_use_ids"]) != set(cost_rows)):
                raise EconomicInputError("MARKET_ORDER_COMPLETE_OWNER_ORIGINAL_ROWS_REQUIRED")
            if (type(row["observed_at"]) is not int or type(horizon) is not int
                    or not 0 <= row["observed_at"] <= horizon
                    or accepted and row["observed_at"] <= accepts[0]["at"]):
                raise EconomicInputError("MARKET_ORDER_OWNER_OBSERVATION_TIME_INVALID")
            if row["incremental_costs_exclude_each_other_and_include_opportunity_costs"] is not True:
                reasons.add("INDEPENDENT_OWNER_COST_NONOVERLAP_AND_OPPORTUNITY_SCOPE_REQUIRED")
        net = sum((_amount(t["amount"]) * (1 if t["payee"] == owner else -1)
                   for t in cash_rows.values()), Decimal(0))
        resource = sum((_amount(r["amount"]) for r in cost_rows.values()), Decimal(0))
        gross = Decimal(buyer_value["incremental_gross_noncash_use_value"]) if owner == buyer and buyer_value else Decimal(0)
        amounts[owner] = (net, resource, gross, gross + net - resource)
        path = liquidity.get(owner, {}).get("scenario_paths", {}).get("COOPERATION", {})
        paths[owner] = {name: path.get(name, {}).get("status", "NOT_IDENTIFIABLE")
                        for name in ("expected", "declared_late_case")}
    output = {
        "schema": "AKIS_ORIGINAL_MARKET_ORDER_ECONOMICS/1.0",
        "status": "UNKNOWN" if reasons else "MODEL_ORIGINAL_ACCEPTED_ORDER_ECONOMICS",
        "original_commit_market_feasibility": feasibility,
        "original_independent_supplier_count": len(providers - {buyer}),
        **({"original_recipient_is_coproducer": True,
            "original_technology_performer_count": len(providers),
            "recipient_assessment_of_own_stage_not_independent_production_audit": True}
           if buyer_produces else {}),
        "original_owner_count": len(owners),
        "original_accepted_result": accepted,
        **({"original_precommit_commercial_terms_matched_to_payment_conditions": True}
           if len(commits) == 1 and commits[0].get("technology_route_commercial_fingerprint")
           and strict.get("original_commercial_order_payment_terms_matched_count", 0) > 0 else {}),
        "reasons": sorted(reasons),
        "real_market_additionality_and_profit": "NOT_IDENTIFIABLE",
        "declared_no_order_baseline_not_executed_counterfactual": True,
        "original_internal_transfers_cancel_on_consolidation": True,
        "no_new_payment_ledger_or_consent_created": True,
    }
    if reasons:
        return output
    met = "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    positive = sum(v[3] > 0 for v in amounts.values())
    total = sum((v[3] for v in amounts.values()), Decimal(0))
    reserves_met = all(v == met for row in paths.values() for v in row.values())
    expanded = feasibility == "COOPERATIVE_PLAN_EXPANDS_DECLARED_FEASIBLE_ORDER_SET"
    receipts = sum((_amount(t["amount"]) for t in transfers.values()
                    if t["payer"] == buyer and t["payee"] in providers | {op}), Decimal(0))
    external = sum((v[0] for v in amounts.values()), Decimal(0))
    output.update({
        "positive_original_owner_contribution_count": positive,
        "zero_original_owner_contribution_count": sum(v[3] == 0 for v in amounts.values()),
        "negative_original_owner_contribution_count": sum(v[3] < 0 for v in amounts.values()),
        "consolidated_model_contribution_direction": (
            "POSITIVE" if total > 0 else "ZERO" if total == 0 else "NEGATIVE"),
        "all_owner_declared_reserves_met": reserves_met,
        "all_owner_positive_contribution_and_reserves": positive == len(owners) and reserves_met,
        "newly_feasible_order_all_owner_viability": (
            "MODEL_CRITERIA_MET" if expanded and positive == len(owners) and reserves_met
            else "NOT_ESTABLISHED"),
        "local_research_only": {
            "buyer_payment_to_original_suppliers_and_operator": _sum_str([receipts]),
            "gross_incremental_recipient_use_value": _sum_str([amounts[buyer][2]]),
            "consolidated_external_cash_net": _sum_str([external]),
            "consolidated_exclusive_resource_cost": _sum_str([v[1] for v in amounts.values()]),
            "consolidated_model_contribution": _sum_str([total]),
            "activity_efficiency": _qualified_activity_efficiency(
                state=state, money=money, work_ids={key}, owners=owners,
                transfers=transfers, resources=resources,
                accepted_work_use_value={key: amounts[buyer][2]},
                expected_contribution=total),
            "per_owner": {owner: {
                "selected_work_net_cash": _sum_str([v[0]]),
                "exclusive_incremental_resource_cost": _sum_str([v[1]]),
                "incremental_recipient_use_value": _sum_str([v[2]]),
                "model_contribution": _sum_str([v[3]]),
                "cumulative_reserve_paths": paths[owner],
            } for owner, v in amounts.items()},
        },
    })
    return output


def review_original_uncommitted_order_costs(
    raw: Any, *, state: Any, economic_claims: Mapping[str, Any],
    economic_view: Mapping[str, Any], strict_work_ids: str | tuple[str, ...] | None,
) -> dict[str, Any]:
    """Cost of unsuccessful formation, not an invented zero-cost alternative.

    Only the original requested Work, independent declined interest and
    blocked commitment are read. No new payment or fictitious accepted Result.
    Zero selected-work cash requires every owner's own explicit scope, not
    the mere absence of a row. Costs remain original resource-use rows.
    """
    capacity_case = isinstance(raw, dict) and "capacity_block" in raw
    base_fields = {"work", "work_revision", "owner_scopes", "recipient_no_order_observation"}
    _record(raw, base_fields | ({"capacity_block"} if capacity_case else
                               {"refusing_owner", "refusal_at"}), "UNCOMMITTED_ORDER")
    key = _identifier(raw["work"], "UNCOMMITTED_ORDER_WORK")
    strict = economic_view.get("original_strict_context_source_qualification", {})
    if (not isinstance(strict_work_ids, tuple) or key not in strict_work_ids
            or key not in state.works or not strict.get("source_scoped_uncommitted_recipient_observation")):
        raise EconomicInputError("UNCOMMITTED_ORDER_ORIGINAL_STRICT_SCOPE_REQUIRED")
    work = state.works[key]
    providers = state.capacity_ledger.original_owners(work.resource_requirements)
    owners = providers | {work.customer, state.institution.operator}
    if (raw["work_revision"] != work.source_revision
            or work.obligation != "NOT_ACCEPTED" or work.result != "NOT_SUBMITTED"):
        raise EconomicInputError("UNCOMMITTED_ORDER_ORIGINAL_INDEPENDENT_REFUSAL_REQUIRED")
    events = [e for e in state.trace if e.get("work") == key]
    commits = [e for e in events if e.get("action") == "commit"]
    if capacity_case:
        block = _record(raw["capacity_block"], {"at", "resource", "competing_work"},
                        "UNCOMMITTED_ORDER_CAPACITY_BLOCK")
        resource = _identifier(block["resource"], "CAPACITY_RESOURCE")
        competitor = _identifier(block["competing_work"], "COMPETING_WORK")
        # The original failed atomic commitment is the decisive evidence.
        # A named earlier accepted reservation must overlap this order's
        # actual resource interval. A forecast or unavailable asset alone
        # is not an observed competition between two original Works.
        from .technology import operation_reservations
        from .capacity import Reservation
        planned = (operation_reservations(key, work.operations) if work.operations else
                   [Reservation(n.resource, key, work.slot_start, work.slot_end, n.units)
                    for n in work.resource_requirements])
        reservations = state.capacity_ledger.reservations
        if (type(block["at"]) is not int or competitor == key
                or competitor not in strict_work_ids
                or len(commits) != 1 or commits[0].get("outcome") != "BLOCKED"
                or commits[0].get("reason") not in {"RESOURCE_CAPACITY_EXCEEDED",
                                                    "RESOURCE_CALENDAR_CAPACITY_EXCEEDED"}
                or commits[0].get("blocking_resource") != resource
                or commits[0]["at"] != block["at"]
                or commits[0].get("original_named_capacity_conflict", {}).get("competing_work") != competitor
                or commits[0].get("original_named_capacity_conflict", {}).get("resource") != resource
                or not commits[0].get("original_named_capacity_conflict", {}).get(
                    "capacity_violation_removed_by_named_work_absence")
                or not any(e.get("work") == competitor and e.get("action") == "commit"
                           and e.get("outcome") == "APPLIED" and e["at"] < block["at"]
                           for e in state.trace)
                or not any(r.work == competitor and r.resource == resource
                           and p.resource == resource and max(r.start, p.start) < min(r.end, p.end)
                           for r in reservations for p in planned)
                or any(r.work == key for r in reservations)):
            raise EconomicInputError("UNCOMMITTED_ORDER_ORIGINAL_CAPACITY_CONFLICT_REQUIRED")
    else:
        refusals = [e for e in events if e.get("actor") == raw["refusing_owner"]
                    and e.get("action") == "interest_update" and e.get("outcome") == "APPLIED"]
        if raw["refusing_owner"] not in providers | {work.customer}:
            raise EconomicInputError("UNCOMMITTED_ORDER_ORIGINAL_INDEPENDENT_REFUSAL_REQUIRED")
        if (not refusals or refusals[-1].get("interest_willingness") != "DECLINES"
                or type(raw["refusal_at"]) is not int or refusals[-1]["at"] != raw["refusal_at"]
                or len(commits) != 1 or commits[0].get("outcome") != "BLOCKED"
                or commits[0].get("reason") not in {
                    "INDEPENDENT_ACCEPTANCE_MISSING", "FORMATION_INTEREST_ORIGINAL_OWNER_DECLINES"}
                or commits[0]["at"] <= raw["refusal_at"]):
            raise EconomicInputError("UNCOMMITTED_ORDER_ORIGINAL_REFUSAL_AND_BLOCKED_COMMIT_REQUIRED")
    money = economic_claims
    if any(t["work"] == key for t in money["transfers"]):
        raise EconomicInputError("UNCOMMITTED_ORDER_ZERO_TRANSFER_SCOPE_CONTRADICTED")
    if (not isinstance(raw["owner_scopes"], dict) or set(raw["owner_scopes"]) != owners
            or strict.get("source_scoped_uncommitted_order_owner_count") != len(owners)):
        raise EconomicInputError("UNCOMMITTED_ORDER_ALL_ORIGINAL_OWNER_SCOPES_REQUIRED")
    horizon = money.get("cash_timing", {}).get("horizon_end")
    sources = dict(economic_view["declared_source_index"])
    life = economic_view.get("lifecycle_resource_costs", {})
    timed = life.get("original_work_event_timing", {}).get("by_original_work", {}).get(
        key, {}).get("per_original_scenario_owner", {}).get("COOPERATION", {})
    resources = {r["id"]: r for r in money["resource_uses"] if r["work"] == key}
    if (not resources or any(r["owner"] not in owners or r["scenario"] != "COOPERATION"
                            for r in resources.values())):
        raise EconomicInputError("UNCOMMITTED_ORDER_ORIGINAL_PRECOMMIT_COST_BOUNDARY_REQUIRED")
    precommit_actions = {"request", "offer", "authorize", "consent", "interest_update", "function_prepare"}
    values = {}
    scope_refs = set()
    for owner in sorted(owners):
        row = _record(raw["owner_scopes"][owner],
                      {"source", "observed_at", "resource_use_ids", "zero_transfer_declared",
                       "complete_exclusive_precommit_resource_scope"}, "UNCOMMITTED_ORDER_OWNER")
        if (row["zero_transfer_declared"] is not True
                or row["complete_exclusive_precommit_resource_scope"] is not True
                or type(row["observed_at"]) is not int or type(horizon) is not int
                or not commits[0]["at"] < row["observed_at"] <= horizon):
            raise EconomicInputError("UNCOMMITTED_ORDER_EXPLICIT_COMPLETE_ZERO_TRANSFER_SCOPE_REQUIRED")
        ref = sources[_flow_ref(row["source"], sources, {owner})]["reference"]
        own = {i: r for i, r in resources.items() if r["owner"] == owner}
        ids = [_identifier(i, "UNCOMMITTED_ORDER_RESOURCE_ROW")
               for i in _bounded_list(row["resource_use_ids"], "UNCOMMITTED_ORDER_RESOURCE_ROW")]
        anchors = timed.get(owner, [])
        owner_rows = [t for t in money["transfers"] if owner in {t["payer"], t["payee"]}]
        owner_rows += [r for r in money["resource_uses"] if r["owner"] == owner]
        excluded = {sources[r["source"]]["reference"] for r in owner_rows}
        for source in (money["coverage"]["COOPERATION"].get(owner),
                       money.get("lifecycle_costs", {}).get("scope_proofs", {}).get("COOPERATION", {}).get(owner)):
            if source in sources:
                excluded.add(sources[source]["reference"])
        for binding in money.get("lifecycle_costs", {}).get("event_bindings", []):
            if binding["owner"] == owner:
                excluded.add(binding["cost_evidence_ref"])
        excluded.update(e.get("interest_evidence_ref") for e in events if e.get("actor") == owner)
        if ref in excluded or ref in scope_refs:
            raise EconomicInputError("UNCOMMITTED_ORDER_DISTINCT_OWNER_SCOPE_SOURCE_REQUIRED")
        scope_refs.add(ref)
        if (len(ids) != len(set(ids)) or set(ids) != set(own)
                or {a["resource_use_id"] for a in anchors} != set(own)
                or any(a["original_applied_action"] not in precommit_actions
                       or a["original_event_at"] >= commits[0]["at"] for a in anchors)
                or not economic_view["per_subject"][owner]["declared_complete"]["COOPERATION"]
                or not life.get("owner_scoped_details", {}).get(owner, {}).get(
                    "scenarios", {}).get("COOPERATION", {}).get("declared_resource_scope_complete_not_audited")):
            raise EconomicInputError("UNCOMMITTED_ORDER_ALL_ORIGINAL_PRECOMMIT_COSTS_REQUIRED")
        values[owner] = sum((_amount(r["amount"]) for r in own.values()), Decimal(0))
    observation = _record(raw["recipient_no_order_observation"],
                          {"source", "at", "quantity", "unit", "basis", "valuation_horizon"},
                          "UNCOMMITTED_ORDER_RECIPIENT")
    ref = sources[_flow_ref(observation["source"], sources, {work.customer})]["reference"]
    buyer = work.customer
    excluded_observation_refs = {sources[r["source"]]["reference"] for r in money["transfers"]
                                 if buyer in {r["payer"], r["payee"]}}
    excluded_observation_refs.update(sources[r["source"]]["reference"] for r in money["resource_uses"]
                                     if r["owner"] == buyer)
    excluded_observation_refs.update(r["cost_evidence_ref"] for r in money.get(
        "lifecycle_costs", {}).get("event_bindings", []) if r["owner"] == buyer)
    for source in (money["coverage"]["COOPERATION"].get(buyer),
                   money.get("lifecycle_costs", {}).get("scope_proofs", {}).get("COOPERATION", {}).get(buyer)):
        if source in sources:
            excluded_observation_refs.add(sources[source]["reference"])
    if (ref in scope_refs or ref in excluded_observation_refs or type(observation["at"]) is not int
            or not commits[0]["at"] < observation["at"] <= horizon
            or observation["valuation_horizon"] != horizon
            or not isinstance(observation["quantity"], str)
            or not re.fullmatch(r"(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,4})?", observation["quantity"])):
        raise EconomicInputError("UNCOMMITTED_ORDER_DISTINCT_RECIPIENT_OBSERVATION_REQUIRED")
    _identifier(observation["unit"], "UNCOMMITTED_ORDER_UNIT")
    _identifier(observation["basis"], "UNCOMMITTED_ORDER_USE_BASIS")
    return {
        "schema": "AKIS_ORIGINAL_UNCOMMITTED_ORDER_COST/1.0",
        "status": "MODEL_ORIGINAL_UNCOMMITTED_ORDER_COST_SCOPE",
        "original_independent_refusal_applied": not capacity_case,
        **({"original_capacity_conflict_applied": True} if capacity_case else {}),
        "original_commit_blocked": True,
        "original_accepted_result": False,
        "independent_zero_transfer_declaration_count": len(owners),
        "original_precommit_resource_cost_count": len(resources),
        "positive_precommit_cost_owner_count": sum(v > 0 for v in values.values()),
        "no_order_recipient_quantity_source_qualified_not_measured": True,
        "no_original_work_transfer_or_result_created": True,
        "actual_costs_use_value_and_causal_effect": "NOT_IDENTIFIABLE",
        "local_research_only": {
            "total_exclusive_precommit_resource_cost": _sum_str(list(values.values())),
            "per_owner_exclusive_precommit_resource_cost": {k: _sum_str([v]) for k, v in values.items()},
            "declared_no_order_recipient_quantity": observation["quantity"],
            "declared_no_order_recipient_unit": observation["unit"],
            "declared_no_order_recipient_basis": observation["basis"],
            "declared_no_order_recipient_valuation_horizon": horizon,
        },
    }


def _original_incomplete_activity_cost_exposure(
    *, state: Any, money: Mapping[str, Any], keys: set[str], pending: list[str],
    owners: set[str], transfers: Mapping[str, Any], resources: Mapping[str, Any],
    payment: Mapping[str, Any], horizon: int,
) -> dict[str, Any] | None:
    """Observe committed unfinished activity without fabricating a final Result.

    The original payment condition determines which declared obligations
    have a modeled trigger, NOT whether payment occurred. Incurred costs
    remain owner declarations tied to applied original events. No new
    ledger, forecast, cancellation, output value, or optimization.
    """
    zero = Decimal(0)
    consistent = "MODEL_ORIGINAL_TRIGGER_DUE_AND_POSTING_ORDER_CONSISTENT"
    conditional = "ORIGINAL_CONDITIONAL_TRIGGER_NOT_APPLIED"
    observations = {}
    for key in pending:
        work = state.works[key]
        history = [e for e in state.trace if e.get("work") == key and e["outcome"] == "APPLIED"]
        commits = [e["at"] for e in history if e["action"] == "commit"]
        readiness = original_execution_readiness_view(state.trace, key, horizon)
        if (work.obligation != "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
                or work.execution != "IN_PROGRESS" or work.result != "NOT_SUBMITTED"
                or len(commits) != 1 or readiness is None
                or readiness["all_observed_readiness_interruptions_closed"]):
            return None
        observations[key] = (work, commits[0], readiness)
    if not observations:
        return None
    for ident, row in transfers.items():
        binding = payment.get(ident, {})
        status = binding.get("status")
        progress = binding.get("settlement_progress", {})
        if (progress.get("status") == "PAYMENT_CLAIMS_CAUSALLY_INCONSISTENT"
                or binding.get("model_amendment_status") not in (
                    None, "BILATERAL_MODEL_DUE_CHANGE_UNVERIFIED_LEGALLY")):
            return None
        if status == consistent:
            continue
        if (row["work"] not in observations or status != conditional
                or binding.get("condition") != "ON_CUSTOMER_ACCEPTANCE"
                or binding.get("original_condition_at") is not None
                or progress.get("event_count", 0) != 0):
            return None
    by_work = {}
    for key, (work, commit, readiness) in observations.items():
        declared = {i: t for i, t in transfers.items() if t["work"] == key}
        costs = {i: r for i, r in resources.items() if r["work"] == key}
        triggered = {i: t for i, t in declared.items() if payment[i]["status"] == consistent}
        contingent = {i: t for i, t in declared.items() if payment[i]["status"] == conditional}
        own = {}
        for owner in sorted(owners):
            def net(rows):
                return sum((_amount(t["amount"]) *
                            ((1 if t["payee"] == owner else 0) - (1 if t["payer"] == owner else 0))
                            for t in rows.values()), zero)
            resource_cost = sum((_amount(r["amount"]) for r in costs.values()
                                 if r["owner"] == owner), zero)
            active_net = net(triggered)
            own[owner] = {
                "triggered_declared_net_transfer": _sum_str([active_net]),
                "untriggered_conditional_net_transfer": _sum_str([net(contingent)]),
                "source_anchored_exclusive_resource_cost": _sum_str([resource_cost]),
                "triggered_net_less_declared_resource_cost": _sum_str([active_net-resource_cost]),
                "final_owner_profit": None,
            }
        outflow = sum((_amount(t["amount"]) for t in triggered.values() if t["payee"] == "EXTERNAL"), zero)
        inflow = sum((_amount(t["amount"]) for t in triggered.values() if t["payer"] == "EXTERNAL"), zero)
        cost = sum((_amount(r["amount"]) for r in costs.values()), zero)
        exposure = outflow + cost
        if sum((Decimal(r["triggered_net_less_declared_resource_cost"]) for r in own.values()), zero) != (
                inflow-exposure):
            raise EconomicInputError("INCOMPLETE_ACTIVITY_ORIGINAL_SCOPE_CONSOLIDATION_MISMATCH")
        by_work[key] = {
            "original_result_state": work.result,
            "original_commitment_remains": True,
            "commit_to_observation_cutoff_model_ticks": horizon-commit,
            "original_execution_readiness": readiness,
            "completed_original_operation_count": sum(
                v == "COMPLETED" for v in work.operation_states.values()),
            "in_progress_original_operation_count": sum(
                v == "IN_PROGRESS" for v in work.operation_states.values()),
            "triggered_declared_external_outflows": _sum_str([outflow]),
            "triggered_declared_external_inflows": _sum_str([inflow]),
            "source_anchored_exclusive_resource_cost": _sum_str([cost]),
            "triggered_external_outflows_plus_exclusive_resource_cost": _sum_str([exposure]),
            "untriggered_conditional_transfer_amount_not_collected_revenue": _sum_str(
                [_amount(t["amount"]) for t in contingent.values()]),
            "accepted_recipient_use_value": None,
            "net_economic_contribution": None,
            "actual_bank_payment_and_realized_loss": "NOT_IDENTIFIABLE",
            "per_original_owner": own,
        }
    return {
        "schema": "AKIS_ORIGINAL_COMMITTED_INCOMPLETE_ACTIVITY_EXPOSURE/1.0",
        "status": "MODEL_ORIGINAL_COMMITTED_INCOMPLETE_COST_EXPOSURE",
        "selected_original_unfinished_work_count": len(by_work),
        "all_selected_owner_cost_scopes_qualified_at_cutoff": True,
        "not_final_profit_or_loss": True,
        "untriggered_conditional_payments_not_current_revenue": True,
        "unaccepted_use_value_unknown_not_zero": True,
        "source_declared_cost_and_triggered_obligation_not_bank_settlement": True,
        "no_new_original_event_or_economic_row": True,
        "local_research_only": {"per_original_unfinished_work": by_work},
    }


def review_original_portfolio_economics(
    raw: Any, *, state: Any, economic_claims: Mapping[str, Any],
    economic_view: Mapping[str, Any], strict_work_ids: str | tuple[str, ...] | None,
) -> dict[str, Any]:
    """One fixed population and selected Work set, one original ledger.

    This adds no cash row, reservation, value or choice. Each owner declares
    complete nonoverlapping incremental costs across the selected portfolio.
    Historical cash remains in liquidity paths. A lost alternative receipt
    is not added as a cost when its distinct order is already compared.
    """
    _record(raw, {"works", "owner_scopes"}, "PORTFOLIO_SCOPE")
    works = [_identifier(w, "PORTFOLIO_WORK") for w in _bounded_list(raw["works"], "PORTFOLIO_WORK")]
    keys = set(works)
    strict = economic_view.get("original_strict_context_source_qualification", {})
    owners = set(state.subjects)
    if (len(works) < 2 or len(keys) != len(works)
            or not isinstance(strict_work_ids, tuple) or not keys <= set(strict_work_ids)
            or strict.get("status") != "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED"
            or not isinstance(raw["owner_scopes"], dict) or set(raw["owner_scopes"]) != owners
            or strict.get("source_scoped_original_portfolio_owner_count") != len(owners)):
        raise EconomicInputError("PORTFOLIO_ORIGINAL_FIXED_OWNER_AND_WORK_SCOPE_REQUIRED")
    money = economic_claims
    horizon = money.get("cash_timing", {}).get("horizon_end")
    sources = dict(economic_view["declared_source_index"])
    life = economic_view.get("lifecycle_resource_costs", {})
    timed = life.get("original_work_event_timing", {}).get("by_original_work", {})
    liquidity = economic_view.get("cash_timing", {}).get("per_original_owner_private_research_projection", {})
    payment = {row["transfer_id"]: row for row in
               economic_view.get("work_payment_causality", {}).get("bindings", ())}
    transfers = {t["id"]: t for t in money["transfers"] if t["work"] in keys}
    resources = {r["id"]: r for r in money["resource_uses"] if r["work"] in keys}
    value = economic_view.get("original_recipient_use_value", {}).get("local_research_only", {})
    uncommitted = economic_view.get("original_uncommitted_order_costs", {})
    rejected_key = money.get("uncommitted_order_cost_evidence", {}).get("work")
    accepted, blocked, pending, reasons = [], [], [], set()
    gross = {o: Decimal(0) for o in owners}
    decision_ticks = []
    for key in works:
        work = state.works[key]
        if work.obligation == "FULFILLED" and work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT":
            accepts = [e["at"] for e in state.trace if e.get("work") == key and
                       e.get("action") == "accept" and e.get("outcome") == "APPLIED"]
            if key not in value or len(accepts) != 1:
                reasons.add("PORTFOLIO_ORIGINAL_RECIPIENT_VALUE_INCOMPLETE")
                continue
            accepted.append(key)
            decision_ticks.extend(accepts)
            decision_ticks.extend(v["outcome"]["at"] for v in money["recipient_use_value_evidence"]
                                  if v["work"] == key)
            gross[work.customer] += Decimal(value[key]["incremental_gross_noncash_use_value"])
        elif (key == rejected_key and uncommitted.get("original_capacity_conflict_applied")
              and uncommitted.get("status") == "MODEL_ORIGINAL_UNCOMMITTED_ORDER_COST_SCOPE"):
            blocked.append(key)
            decision_ticks.extend((
                money["uncommitted_order_cost_evidence"]["capacity_block"]["at"],
                money["uncommitted_order_cost_evidence"]["recipient_no_order_observation"]["at"]))
        else:
            reasons.add("PORTFOLIO_ORIGINAL_RESULT_OR_CAPACITY_BLOCK_REQUIRED")
            if (work.obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
                    and work.execution == "IN_PROGRESS" and work.result == "NOT_SUBMITTED"):
                pending.append(key)
    if len({state.works[k].customer for k in keys}) != len(keys):
        reasons.add("PORTFOLIO_DISTINCT_ORIGINAL_RECIPIENTS_REQUIRED")
    if any(payment.get(i, {}).get("status") !=
           "MODEL_ORIGINAL_TRIGGER_DUE_AND_POSTING_ORDER_CONSISTENT" for i in transfers):
        reasons.add("PORTFOLIO_ORIGINAL_PAYMENT_CAUSALITY_INCOMPLETE")

    def ids(values):
        rows = [_identifier(i, "PORTFOLIO_ORIGINAL_ROW") for i in
                _bounded_list(values, "PORTFOLIO_ORIGINAL_ROW")]
        if len(rows) != len(set(rows)):
            raise EconomicInputError("PORTFOLIO_DUPLICATE_ORIGINAL_ROW")
        return set(rows)

    # A scope source must be distinct from every original cost, valuation,
    # settlement, coverage and single-order declaration. An independent
    # document for portfolio nonoverlap cannot be its own underlying row.
    used_ids = set()
    for row in (*money["transfers"], *money["resource_uses"]):
        used_ids.add(row["source"])
    for mapping in (money["coverage"]["COOPERATION"],
                    money.get("lifecycle_costs", {}).get("scope_proofs", {}).get("COOPERATION", {})):
        used_ids.update(mapping.values())
    for row in money.get("recipient_use_value_evidence", []):
        used_ids.update(row[k]["source"] for k in ("baseline", "outcome", "rate"))
        used_ids.add(row["nonoverlap_source"])
    for field in ("market_order_economics", "uncommitted_order_cost_evidence"):
        used_ids.update(r["source"] for r in money.get(field, {}).get("owner_scopes", {}).values())
    no_order = money.get("uncommitted_order_cost_evidence", {}).get("recipient_no_order_observation")
    if no_order:
        used_ids.add(no_order["source"])
    for field in ("work_payment_conditions", "work_payment_settlement_claims",
                  "work_payment_due_amendments"):
        for row in money.get(field, []):
            used_ids.update(row.get("owner_sources", {}).values())
    used_refs = {sources[i]["reference"] for i in used_ids if i in sources}
    used_refs.update(b["cost_evidence_ref"] for b in money.get("lifecycle_costs", {}).get("event_bindings", []))
    for field in ("work_payment_settlement_claims", "work_payment_due_amendments"):
        for row in money.get(field, []):
            used_refs.update(row.get("evidence_refs", {}).values())
    # Scope cannot certify value or costs observed only later. A no-order
    # observation at the final horizon can be certified at that same tick.
    decision_ticks.extend(b["at"] for b in money["lifecycle_costs"]["event_bindings"]
                          if b["work"] in keys)
    decision_ticks.extend(r["at"] for r in money.get("work_payment_settlement_claims", [])
                          if r["transfer_id"] in transfers)
    seen_refs, private = set(), {}
    for owner in sorted(owners):
        row = _record(raw["owner_scopes"][owner], {"source", "observed_at", "transfer_ids",
                      "resource_use_ids", "complete_exclusive_portfolio_cost_and_value_scope"},
                      "PORTFOLIO_OWNER_SCOPE")
        ref = sources[_flow_ref(row["source"], sources, {owner})]["reference"]
        if (ref in used_refs or ref in seen_refs
                or row["complete_exclusive_portfolio_cost_and_value_scope"] is not True
                or type(row["observed_at"]) is not int or type(horizon) is not int
                or not decision_ticks or not max(decision_ticks) <= row["observed_at"] <= horizon):
            raise EconomicInputError("PORTFOLIO_INDEPENDENT_NONOVERLAP_SCOPE_REQUIRED")
        seen_refs.add(ref)
        ts = {i: t for i, t in transfers.items() if owner in {t["payer"], t["payee"]}}
        rs = {i: r for i, r in resources.items() if r["owner"] == owner}
        anchors = {b["resource_use_id"] for k in keys for b in timed.get(k, {}).get(
            "per_original_scenario_owner", {}).get("COOPERATION", {}).get(owner, [])}
        if (ids(row["transfer_ids"]) != set(ts) or ids(row["resource_use_ids"]) != set(rs)
                or anchors != set(rs)
                or not economic_view["per_subject"][owner]["declared_complete"]["COOPERATION"]
                or not life.get("owner_scoped_details", {}).get(owner, {}).get(
                    "scenarios", {}).get("COOPERATION", {}).get("declared_resource_scope_complete_not_audited")):
            reasons.add("PORTFOLIO_COMPLETE_ORIGINAL_OWNER_ROWS_REQUIRED")
        path = liquidity.get(owner, {}).get("scenario_paths", {}).get("COOPERATION", {})
        paths = {k: path.get(k, {}).get("status") for k in ("expected", "declared_late_case")}
        if any(v is None or v in {"UNKNOWN", "NOT_IDENTIFIABLE"} for v in paths.values()):
            reasons.add("PORTFOLIO_CUMULATIVE_LIQUIDITY_UNKNOWN")
        cash = sum((_amount(t["amount"]) * (1 if t["payee"] == owner else -1)
                    for t in ts.values()), Decimal(0))
        cost = sum((_amount(r["amount"]) for r in rs.values()), Decimal(0))
        private[owner] = {"selected_work_net_cash": _sum_str([cash]),
                          "exclusive_incremental_resource_cost": _sum_str([cost]),
                          "incremental_recipient_use_value": _sum_str([gross[owner]]),
                          "model_contribution": _sum_str([cash+gross[owner]-cost]),
                          "cumulative_reserve_paths": paths}
    output = {"schema": "AKIS_ORIGINAL_MULTI_ORDER_PORTFOLIO/1.0",
              "status": "UNKNOWN" if reasons else "MODEL_ORIGINAL_MULTI_ORDER_PORTFOLIO_ECONOMICS",
              "original_owner_count": len(owners), "selected_work_count": len(keys),
              "original_accepted_order_count": len(accepted),
              "original_capacity_blocked_order_count": len(blocked),
              "reasons": sorted(reasons),
              "internal_transfers_cancel_on_consolidation": True,
              "historical_cash_preserved_in_cumulative_liquidity": True,
              "no_foregone_receipt_added_to_another_order": True,
              "actual_costs_use_value_profit_and_causal_effect": "NOT_IDENTIFIABLE"}
    if reasons:
        # A complete cutoff-specific owner scope can expose retained costs
        # even when final portfolio contribution is not qualified. Never
        # publish the private final-balance calculation above in that case.
        if (pending and len(accepted)+len(blocked)+len(pending) == len(keys)
                and reasons <= {"PORTFOLIO_ORIGINAL_RESULT_OR_CAPACITY_BLOCK_REQUIRED",
                               "PORTFOLIO_ORIGINAL_PAYMENT_CAUSALITY_INCOMPLETE",
                               "PORTFOLIO_CUMULATIVE_LIQUIDITY_UNKNOWN"}
                and all(row["observed_at"] == horizon for row in raw["owner_scopes"].values())):
            observation = _original_incomplete_activity_cost_exposure(
                state=state, money=money, keys=keys, pending=pending, owners=owners,
                transfers=transfers, resources=resources, payment=payment, horizon=horizon)
            if observation is not None:
                output["incomplete_original_activity_observation"] = observation
        return output
    total = sum((Decimal(r["model_contribution"]) for r in private.values()), Decimal(0))
    met = "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    output.update({
        "all_owner_declared_reserves_met": all(v == met for r in private.values()
                                               for v in r["cumulative_reserve_paths"].values()),
        "local_research_only": {"per_owner": private,
                                "consolidated_model_contribution": _sum_str([total]),
                                "gross_incremental_recipient_use_value": _sum_str(list(gross.values())),
                                "activity_efficiency": _qualified_activity_efficiency(
                                    state=state, money=money, work_ids=keys, owners=owners,
                                    transfers=transfers, resources=resources,
                                    accepted_work_use_value={
                                        key: Decimal(value[key]["incremental_gross_noncash_use_value"])
                                        for key in accepted},
                                    expected_contribution=total)},
    })
    return output
