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
                "work_payment_settlement_claims", "work_payment_due_amendments",
                "joint_purchasing_original_cash_bindings",
                "joint_purchasing_ancillary_original_bindings",
                "operator_service_economics", "recipient_use_value_evidence", "market_order_economics",
                "uncommitted_order_cost_evidence",
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
    if (len(providers) < 2 or len(work.operations) < 2 or buyer in providers
            or op in providers or op == buyer or raw["work_revision"] != work.source_revision):
        raise EconomicInputError("MARKET_ORDER_ORIGINAL_INDEPENDENT_TECHNOLOGY_SCOPE_REQUIRED")
    if not isinstance(raw["owner_scopes"], dict) or not set(raw["owner_scopes"]) <= owners - {buyer}:
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
    if set(raw["owner_scopes"]) != owners - {buyer}:
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
        if owner != buyer and owner in raw["owner_scopes"]:
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
        "original_independent_supplier_count": len(providers),
        "original_owner_count": len(owners),
        "original_accepted_result": accepted,
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
    _record(raw, {"work", "work_revision", "refusing_owner", "refusal_at",
                  "owner_scopes", "recipient_no_order_observation"}, "UNCOMMITTED_ORDER")
    key = _identifier(raw["work"], "UNCOMMITTED_ORDER_WORK")
    strict = economic_view.get("original_strict_context_source_qualification", {})
    if (not isinstance(strict_work_ids, tuple) or key not in strict_work_ids
            or key not in state.works or not strict.get("source_scoped_uncommitted_recipient_observation")):
        raise EconomicInputError("UNCOMMITTED_ORDER_ORIGINAL_STRICT_SCOPE_REQUIRED")
    work = state.works[key]
    providers = state.capacity_ledger.original_owners(work.resource_requirements)
    owners = providers | {work.customer, state.institution.operator}
    if (raw["work_revision"] != work.source_revision or raw["refusing_owner"] not in providers | {work.customer}
            or work.obligation != "NOT_ACCEPTED" or work.result != "NOT_SUBMITTED"):
        raise EconomicInputError("UNCOMMITTED_ORDER_ORIGINAL_INDEPENDENT_REFUSAL_REQUIRED")
    events = [e for e in state.trace if e.get("work") == key]
    refusals = [e for e in events if e.get("actor") == raw["refusing_owner"]
                and e.get("action") == "interest_update" and e.get("outcome") == "APPLIED"]
    commits = [e for e in events if e.get("action") == "commit"]
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
        "original_independent_refusal_applied": True,
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
