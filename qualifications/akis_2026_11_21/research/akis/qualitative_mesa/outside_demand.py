"""R4 buyer-originated outside demand in ONE original Mesa event trace.

An independent buyer's model-source-scoped statement is NOT a new Work,
offer accepted by a supplier, contract, external market price, bank payment,
reservation or authenticated third-party identity. It can only narrow the
owner's nonbinding economic comparison after original ContextBasis checks.
"""
from __future__ import annotations

from decimal import Decimal
import re
from typing import Any, Mapping, Sequence

from .context_basis import ContextBlocked
from .strict_economic_source_review import original_owner_economic_core


class OutsideDemandBlocked(ValueError):
    """External request is not independently source-qualified in original Mesa."""


_MONEY = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?\Z")
_CURRENCY = re.compile(r"[A-Z]{3}\Z")
_INDEPENDENT_BUYER_KINDS = frozenset({
    "SME", "NATURAL_PERSON", "PUBLIC_INSTITUTION", "SECTOR_BODY",
})
_WITHDRAW_FIELDS = frozenset({
    "at", "action", "actor", "outside_demand_id",
    "outside_withdrawal_source_ref", "outside_withdrawal_source_revision",
})
_SOURCE_FIELDS = frozenset({
    "at", "action", "actor", "outside_demand_id", "outside_supplier",
    "outside_relation", "outside_relation_revision",
    "outside_candidate_work", "outside_work_revision", "outside_resource",
    "outside_units", "outside_slot_start", "outside_slot_end",
    "outside_deliverable", "outside_quality_basis", "outside_currency",
    "outside_price_ceiling", "outside_demand_source_ref",
    "outside_demand_source_revision", "outside_demand_valid_until",
})


def _identifier(raw: Any) -> bool:
    return isinstance(raw, str) and 0 < len(raw.strip()) <= 128


def _original_relation(state: Any, key: str, revision: str) -> Any | None:
    return next(
        (link for link in state.cooperation_links
         if link.key == key and link.source_revision == revision), None
    )


def qualify_original_outside_demand_signal(
    state: Any, event: Mapping[str, Any], at: int,
) -> dict[str, Any]:
    """Check the buyer's own original source before applying ONE trace event."""
    if (set(event) not in (_SOURCE_FIELDS, _SOURCE_FIELDS | {"outside_candidate_operation"})
            or event.get("action") != "outside_demand_signal"):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_ORIGINAL_EVENT_FIELDS_REQUIRED")
    buyer = event["actor"]
    seller = event["outside_supplier"]
    demand_id = event["outside_demand_id"]
    if any(not _identifier(event[k]) for k in (
        "actor", "outside_supplier", "outside_demand_id",
        "outside_relation", "outside_relation_revision",
        "outside_candidate_work", "outside_work_revision",
        "outside_resource", "outside_deliverable", "outside_quality_basis",
        "outside_demand_source_ref", "outside_demand_source_revision",
    )):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_IDENTIFIERS_REQUIRED")
    if "outside_candidate_operation" in event and not _identifier(event["outside_candidate_operation"]):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_ORIGINAL_OPERATION_IDENTIFIER_REQUIRED")
    participants = state.subjects
    if (
        buyer == seller or buyer == state.institution.operator
        or buyer not in participants or seller not in participants
        or not participants[buyer].active or not participants[seller].active
        or participants[buyer].kind not in _INDEPENDENT_BUYER_KINDS
    ):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_INDEPENDENT_ACTIVE_BUYER_REQUIRED")
    link = _original_relation(
        state, event["outside_relation"], event["outside_relation_revision"],
    )
    if (link is None or seller not in link.participants
            or buyer in link.participants):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_BUYER_NOT_EXTERNAL_TO_COOPERATION")
    if state.resources.get(event["outside_resource"]) != seller:
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_ORIGINAL_SUPPLIER_RESOURCE_REQUIRED")
    start, end = event["outside_slot_start"], event["outside_slot_end"]
    units = event["outside_units"]
    until = event["outside_demand_valid_until"]
    if (type(at) is not int or type(start) is not int or type(end) is not int
            or type(units) is not int or type(until) is not int
            or not 0 <= at < until <= 10000
            or not 0 <= start < end <= 10000
            or not 1 <= units <= 1000000):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_TIME_OR_RESOURCE_UNITS_INVALID")
    price = event["outside_price_ceiling"]
    currency = event["outside_currency"]
    if (not isinstance(price, str) or not _MONEY.fullmatch(price)
            or Decimal(price) <= 0 or not isinstance(currency, str)
            or not _CURRENCY.fullmatch(currency)):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_PRICE_OR_CURRENCY_INVALID")
    if any(
        item.get("action") == "outside_demand_signal"
        and item.get("outcome") == "APPLIED"
        and item.get("outside_demand_id") == demand_id
        for item in state.trace
    ):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_DUPLICATE_ORIGINAL_SIGNAL")
    context = state.context_basis
    core = original_owner_economic_core(participants[buyer].kind)
    if context is None or core is None:
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_ORIGINAL_KPB_REQUIRED")
    try:
        context.assert_original_independent_outside_demand_source(
            buyer,
            event["outside_demand_source_ref"],
            event["outside_demand_source_revision"],
            core=core, recipient=seller, at=at,
        )
    except ContextBlocked as exc:
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_BUYER_SOURCE_NOT_QUALIFIED") from exc
    return {
        "outside_demand_id": demand_id,
        "outside_supplier": seller,
        "outside_relation": link.key,
        "outside_relation_revision": link.source_revision,
        "outside_candidate_work": event["outside_candidate_work"],
        **({"outside_candidate_operation": event["outside_candidate_operation"]}
           if "outside_candidate_operation" in event else {}),
        "outside_work_revision": event["outside_work_revision"],
        "outside_resource": event["outside_resource"],
        "outside_units": units,
        "outside_slot_start": start,
        "outside_slot_end": end,
        "outside_deliverable": event["outside_deliverable"],
        "outside_quality_basis": event["outside_quality_basis"],
        "outside_currency": currency,
        "outside_price_ceiling": f"{Decimal(price):.2f}",
        "outside_demand_source_ref": event["outside_demand_source_ref"],
        "outside_demand_source_revision": event["outside_demand_source_revision"],
        "outside_demand_valid_until": until,
        "model_buyer_source_not_real_offer_or_contract": True,
    }


def qualify_original_outside_demand_withdrawal(
    state: Any, event: Mapping[str, Any], at: int,
) -> dict[str, Any]:
    """A buyer withdraws ONE earlier source-declared need in original trace.

    No new registry, cash movement, signature or resource reservation. The
    original event and all accepted Work/Result remain in their original
    historical states; withdrawal only blocks FUTURE model comparisons.
    """
    if (not isinstance(event, Mapping) or set(event) != _WITHDRAW_FIELDS
            or event.get("action") != "outside_demand_withdraw"):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_WITHDRAW_FIELDS_REQUIRED")
    buyer = event["actor"]
    demand_id = event["outside_demand_id"]
    withdrawal_source = event["outside_withdrawal_source_ref"]
    withdrawal_revision = event["outside_withdrawal_source_revision"]
    if any(not _identifier(value) for value in (
        buyer, demand_id, withdrawal_source, withdrawal_revision,
    )):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_WITHDRAW_IDENTIFIERS_REQUIRED")
    originals = [
        item for item in state.trace
        if item.get("action") == "outside_demand_signal"
        and item.get("outcome") == "APPLIED"
        and item.get("outside_demand_id") == demand_id
    ]
    if len(originals) != 1:
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_WITHDRAW_ORIGINAL_SIGNAL_REQUIRED")
    original = originals[0]
    if original.get("actor") != buyer:
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_WITHDRAW_ORIGINAL_BUYER_ONLY")
    if any(
        item.get("action") == "outside_demand_withdraw"
        and item.get("outcome") == "APPLIED"
        and item.get("outside_demand_id") == demand_id
        for item in state.trace
    ):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_ALREADY_WITHDRAWN")
    if (
        type(at) is not int
        or type(original.get("at")) is not int
        or type(original.get("outside_demand_valid_until")) is not int
        or not original["at"] < at < original["outside_demand_valid_until"]
    ):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_WITHDRAW_EVENT_TIME_INVALID")
    if withdrawal_source == original.get("outside_demand_source_ref"):
        raise OutsideDemandBlocked(
            "OUTSIDE_DEMAND_WITHDRAW_INDEPENDENT_OWNER_EDITION_REQUIRED"
        )
    seller = original.get("outside_supplier")
    party = state.subjects.get(buyer)
    core = original_owner_economic_core(party.kind) if party else None
    if not isinstance(seller, str) or core is None or state.context_basis is None:
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_WITHDRAW_ORIGINAL_KPB_REQUIRED")
    try:
        state.context_basis.assert_original_independent_outside_demand_source(
            buyer, withdrawal_source, withdrawal_revision,
            core=core, recipient=seller, at=at,
        )
    except ContextBlocked as exc:
        raise OutsideDemandBlocked(
            "OUTSIDE_DEMAND_WITHDRAW_SOURCE_NOT_QUALIFIED"
        ) from exc
    return {
        "outside_demand_id": demand_id,
        "outside_supplier": seller,
        "outside_withdrawal_source_ref": withdrawal_source,
        "outside_withdrawal_source_revision": withdrawal_revision,
        "original_buyer_withdrawal_not_contract_cancellation": True,
        "historical_original_Work_Result_not_rewritten": True,
    }


def assess_original_independent_outside_demand(
    *, demand: tuple[str, str, str] | None, owner: str,
    work: Any, relation: str, relation_revision: str,
    probe: tuple[str, int, int, int] | None,
    outside_external_sales: Decimal, currency: str,
    trace: Sequence[Mapping[str, Any]] | None,
    subjects: Mapping[str, Any] | None,
    links: Sequence[Any], context_basis: Any, at: int,
) -> str | None:
    """Return a precise missing-demand reason; None means model match only.

    Read ONE previously applied ORIGINAL buyer event, recheck source rights
    NOW, and compare the buyer's source-declared horizon/quality/price to
    the seller's forecast. An event never creates a sale or consent.
    """
    if demand is None:
        return None
    if probe is None or trace is None or subjects is None or context_basis is None:
        return "OUTSIDE_DEMAND_ORIGINAL_TRACE_KPB_AND_CAPACITY_REQUIRED"
    demand_id, deliverable, quality_basis = demand
    rows = [
        item for item in trace
        if item.get("action") == "outside_demand_signal"
        and item.get("outcome") == "APPLIED"
        and item.get("outside_demand_id") == demand_id
    ]
    if len(rows) != 1:
        return "OUTSIDE_DEMAND_INDEPENDENT_ORIGINAL_BUYER_SIGNAL_REQUIRED"
    source = rows[0]
    buyer = source.get("actor")
    buyer_subject = subjects.get(buyer) if isinstance(buyer, str) else None
    link = next(
        (link for link in links if link.key == relation
         and link.source_revision == relation_revision), None
    )
    if (
        buyer_subject is None or not buyer_subject.active
        or buyer == owner or buyer_subject.kind not in _INDEPENDENT_BUYER_KINDS
        or link is None or owner not in link.participants
        or buyer in link.participants
        or source.get("outside_supplier") != owner
        or source.get("outside_relation") != relation
        or source.get("outside_relation_revision") != relation_revision
    ):
        return "OUTSIDE_DEMAND_CURRENT_EXTERNAL_BUYER_NOT_INDEPENDENT"
    if (type(source.get("at")) is not int or source["at"] >= at
            or type(source.get("outside_demand_valid_until")) is not int
            or at >= source["outside_demand_valid_until"]):
        return "OUTSIDE_DEMAND_NOT_PRIOR_OR_CURRENT"
    # Check CURRENT buyer-owned read rights BEFORE examining its private
    # product, quantity, quality or quoted price. Historical trace persists
    # after revocation but new derived economic use is forbidden.
    core = original_owner_economic_core(buyer_subject.kind)
    if core is None:
        return "OUTSIDE_DEMAND_BUYER_CORE_UNKNOWN"
    try:
        context_basis.assert_original_independent_outside_demand_source(
            buyer, source["outside_demand_source_ref"],
            source["outside_demand_source_revision"],
            core=core, recipient=owner, at=at,
        )
    except ContextBlocked:
        return "OUTSIDE_DEMAND_CURRENT_BUYER_SOURCE_NO_LONGER_READABLE"
    # A buyer's own later APPLIED withdrawal supersedes that one demand
    # for economic use. It cannot erase past trace, or be undone by revoking
    # the withdrawal document or submitting a new independent request.
    closed = [
        item for item in trace
        if item.get("action") == "outside_demand_withdraw"
        and item.get("outcome") == "APPLIED"
        and item.get("outside_demand_id") == demand_id
        and item.get("actor") == buyer
        and type(item.get("at")) is int
        and source["at"] < item["at"] <= at
    ]
    if closed:
        return "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER"
    resource, units, start, end = probe
    if (
        source.get("outside_candidate_work") != work.key
        or source.get("outside_work_revision") != work.source_revision
        or source.get("outside_resource") != resource
        or source.get("outside_units") != units
        or source.get("outside_slot_start") != start
        or source.get("outside_slot_end") != end
        or source.get("outside_deliverable") != deliverable
        or source.get("outside_quality_basis") != quality_basis
    ):
        return "OUTSIDE_DEMAND_PRODUCT_QUANTITY_QUALITY_OR_PERIOD_MISMATCH"
    if (source.get("outside_currency") != currency
            or not isinstance(source.get("outside_price_ceiling"), str)
            or not _MONEY.fullmatch(source["outside_price_ceiling"])
            or Decimal(source["outside_price_ceiling"]) < outside_external_sales):
        return "OUTSIDE_DEMAND_PRICE_CEILING_OR_CURRENCY_NOT_COMPARABLE"
    return None


_OFFER_FIELDS = frozenset({
    "at", "action", "actor", "outside_demand_id", "outside_offer_id",
    "outside_offer_source_ref", "outside_offer_source_revision",
    "outside_offer_price", "outside_offer_currency",
    "outside_offer_resource", "outside_offer_units",
    "outside_offer_slot_start", "outside_offer_slot_end",
    "outside_offer_deliverable", "outside_offer_quality_basis",
    "outside_offer_valid_until",
})


def normalize_original_outside_installments(raw: Any, *, price: str, offered_at: int) -> list[dict]:
    """An optional edition of the ORIGINAL commercial offer, not another transfer.

    Each instalment has its own conditional trigger, expected date, due date
    and adverse receipt date. All ticks and amounts are explicit model inputs.
    The adverse date is a risk hypothesis, never a new contractual due date.
    """
    if not isinstance(raw, list) or not 1 <= len(raw) <= 16:
        raise OutsideDemandBlocked("OUTSIDE_INSTALLMENT_SCHEDULE_REQUIRED")
    total = Decimal(0)
    previous_at = offered_at
    previous_due = offered_at
    acceptance_phase = False
    normalized = []
    for row in raw:
        if not isinstance(row, Mapping) or set(row) != {
                "condition", "amount", "at", "due_at", "late_at"}:
            raise OutsideDemandBlocked("OUTSIDE_INSTALLMENT_FIELDS_INVALID")
        condition, amount = row["condition"], row["amount"]
        at, due, late = row["at"], row["due_at"], row["late_at"]
        if (condition not in ("ON_ORIGINAL_COMMIT", "ON_CUSTOMER_ACCEPTANCE")
                or not isinstance(amount, str) or not _MONEY.fullmatch(amount)
                or Decimal(amount) <= 0):
            raise OutsideDemandBlocked("OUTSIDE_INSTALLMENT_CONDITION_OR_AMOUNT_INVALID")
        if (any(type(t) is not int for t in (at, due, late))
                or not previous_at < at <= due <= 10000
                or not at <= late <= 10000 or due < previous_due):
            raise OutsideDemandBlocked("OUTSIDE_INSTALLMENT_TIME_INVALID")
        if acceptance_phase and condition == "ON_ORIGINAL_COMMIT":
            raise OutsideDemandBlocked("OUTSIDE_INSTALLMENT_ADVANCE_AFTER_ACCEPTANCE_PHASE")
        acceptance_phase = acceptance_phase or condition == "ON_CUSTOMER_ACCEPTANCE"
        total += Decimal(amount)
        previous_at, previous_due = at, due
        normalized.append({"condition": condition, "amount": f"{Decimal(amount):.2f}",
                           "at": at, "due_at": due, "late_at": late})
    if total != Decimal(price):
        raise OutsideDemandBlocked("OUTSIDE_INSTALLMENT_SUM_NOT_ORIGINAL_OFFER_PRICE")
    return normalized


def qualify_original_outside_supplier_offer(
    state: Any, event: Mapping[str, Any], at: int,
) -> dict[str, Any]:
    """One independent supplier-declared PRE-CONTRACT response in original trace.

    Neither a signed order nor an independent physical delivery/settlement.
    Do not add Work, capacity reservation, consent, or economic claim.
    """
    if (not isinstance(event, Mapping)
            or set(event) not in (_OFFER_FIELDS, _OFFER_FIELDS | {"outside_offer_installments"})
            or event.get("action") != "outside_supplier_offer"):
        raise OutsideDemandBlocked("OUTSIDE_OFFER_ORIGINAL_EVENT_FIELDS_REQUIRED")
    seller = event["actor"]
    demand_id = event["outside_demand_id"]
    offer_id = event["outside_offer_id"]
    ref = event["outside_offer_source_ref"]
    rev = event["outside_offer_source_revision"]
    for key in (
        "actor", "outside_demand_id", "outside_offer_id",
        "outside_offer_source_ref", "outside_offer_source_revision",
        "outside_offer_resource", "outside_offer_deliverable",
        "outside_offer_quality_basis",
    ):
        if not _identifier(event[key]):
            raise OutsideDemandBlocked("OUTSIDE_OFFER_IDENTIFIERS_REQUIRED")
    if (type(at) is not int
            or type(event["outside_offer_valid_until"]) is not int
            or not 0 <= at < event["outside_offer_valid_until"] <= 10000):
        raise OutsideDemandBlocked("OUTSIDE_OFFER_TIME_INVALID")
    if any(
        row.get("action") == "outside_supplier_offer"
        and row.get("outcome") == "APPLIED"
        and row.get("outside_offer_id") == offer_id
        for row in state.trace
    ):
        raise OutsideDemandBlocked("OUTSIDE_OFFER_DUPLICATE_ORIGINAL_ID")
    originals = [
        row for row in state.trace
        if row.get("action") == "outside_demand_signal"
        and row.get("outcome") == "APPLIED"
        and row.get("outside_demand_id") == demand_id
    ]
    if len(originals) != 1:
        raise OutsideDemandBlocked("OUTSIDE_OFFER_APPLIED_BUYER_DEMAND_REQUIRED")
    source = originals[0]
    buyer = source.get("actor")
    buyer_party = state.subjects.get(buyer)
    seller_party = state.subjects.get(seller)
    if (
        buyer == seller or buyer_party is None or seller_party is None
        or not buyer_party.active or not seller_party.active
        or buyer_party.kind not in _INDEPENDENT_BUYER_KINDS
        or source.get("outside_supplier") != seller
    ):
        raise OutsideDemandBlocked("OUTSIDE_OFFER_ORIGINAL_INDEPENDENT_PARTIES_REQUIRED")
    if (type(source.get("at")) is not int
            or type(source.get("outside_demand_valid_until")) is not int
            or not source["at"] < at < source["outside_demand_valid_until"]):
        raise OutsideDemandBlocked("OUTSIDE_OFFER_ACTIVE_BUYER_DEMAND_REQUIRED")
    if any(
        row.get("action") == "outside_demand_withdraw"
        and row.get("outcome") == "APPLIED"
        and row.get("outside_demand_id") == demand_id
        and source["at"] < row.get("at", -1) <= at
        for row in state.trace
    ):
        raise OutsideDemandBlocked("OUTSIDE_OFFER_BUYER_DEMAND_WITHDRAWN")
    source_scope = state.context_basis
    buyer_core = original_owner_economic_core(buyer_party.kind)
    seller_core = original_owner_economic_core(seller_party.kind)
    if source_scope is None or buyer_core is None or seller_core is None:
        raise OutsideDemandBlocked("OUTSIDE_OFFER_ORIGINAL_KPB_REQUIRED")
    try:
        # Read rights precede any offer-price, quality or resource comparison.
        source_scope.assert_original_independent_outside_demand_source(
            buyer, source["outside_demand_source_ref"],
            source["outside_demand_source_revision"],
            core=buyer_core, recipient=seller, at=at,
        )
    except ContextBlocked as exc:
        raise OutsideDemandBlocked(
            "OUTSIDE_OFFER_BUYER_SOURCE_NOT_CURRENT"
        ) from exc
    try:
        source_scope.assert_original_independent_supplier_offer_source(
            seller, ref, rev, core=seller_core, buyer=buyer, at=at,
        )
    except ContextBlocked as exc:
        raise OutsideDemandBlocked(
            "OUTSIDE_OFFER_SELLER_SOURCE_NOT_QUALIFIED"
        ) from exc
    if state.resources.get(event["outside_offer_resource"]) != seller:
        raise OutsideDemandBlocked("OUTSIDE_OFFER_ORIGINAL_SELLER_RESOURCE_REQUIRED")
    link = _original_relation(
        state, source["outside_relation"],
        source["outside_relation_revision"],
    )
    if (link is None or seller not in link.participants
            or buyer in link.participants):
        raise OutsideDemandBlocked("OUTSIDE_OFFER_EXTERNAL_TO_COOPERATION_REQUIRED")
    unit = event["outside_offer_units"]
    start, end = event["outside_offer_slot_start"], event["outside_offer_slot_end"]
    if (type(unit) is not int or not 1 <= unit <= 1000000
            or type(start) is not int or type(end) is not int
            or not 0 <= start < end <= 10000):
        raise OutsideDemandBlocked("OUTSIDE_OFFER_UNITS_OR_HORIZON_INVALID")
    price = event["outside_offer_price"]
    currency = event["outside_offer_currency"]
    if (not isinstance(price, str) or not _MONEY.fullmatch(price)
            or Decimal(price) <= 0
            or not isinstance(currency, str) or not _CURRENCY.fullmatch(currency)):
        raise OutsideDemandBlocked("OUTSIDE_OFFER_PRICE_OR_CURRENCY_INVALID")
    if any((
        event["outside_offer_resource"] != source["outside_resource"],
        unit != source["outside_units"],
        start != source["outside_slot_start"],
        end != source["outside_slot_end"],
        event["outside_offer_deliverable"] != source["outside_deliverable"],
        event["outside_offer_quality_basis"] != source["outside_quality_basis"],
        currency != source["outside_currency"],
        Decimal(price) > Decimal(source["outside_price_ceiling"]),
    )):
        raise OutsideDemandBlocked("OUTSIDE_OFFER_BUYER_TERMS_NOT_COMPARABLE")
    installments = (normalize_original_outside_installments(
        event["outside_offer_installments"], price=price, offered_at=at)
        if "outside_offer_installments" in event else None)
    return {
        **({"outside_offer_installments": installments} if installments is not None else {}),
        "outside_demand_id": demand_id,
        "outside_offer_id": offer_id,
        "outside_offer_source_ref": ref,
        "outside_offer_source_revision": rev,
        "outside_offer_buyer": buyer,
        "outside_supplier": seller,
        "outside_offer_price": f"{Decimal(price):.2f}",
        "outside_offer_currency": currency,
        "outside_offer_resource": event["outside_offer_resource"],
        "outside_offer_units": unit,
        "outside_offer_slot_start": start,
        "outside_offer_slot_end": end,
        "outside_offer_deliverable": event["outside_offer_deliverable"],
        "outside_offer_quality_basis": event["outside_offer_quality_basis"],
        "outside_offer_valid_until": event["outside_offer_valid_until"],
        "outside_offer_independent_model_response_not_accepted_contract": True,
    }


def assess_original_outside_supplier_offer(
    *, offer_id: str | None, demand_id: str, owner: str,
    buyer: str | None, trace: Sequence[Mapping[str, Any]] | None,
    subjects: Mapping[str, Any] | None, context_basis: Any,
    price: Decimal, currency: str, probe: tuple[str, int, int, int],
    deliverable: str, quality_basis: str, at: int,
) -> str | None:
    """Read current supplier evidence AFTER buyer demand rights and BEFORE capacity."""
    if offer_id is None:
        return None
    if trace is None or subjects is None or context_basis is None:
        return "OUTSIDE_OFFER_ORIGINAL_TRACE_KPB_REQUIRED"
    rows = [
        row for row in trace
        if row.get("action") == "outside_supplier_offer"
        and row.get("outcome") == "APPLIED"
        and row.get("outside_offer_id") == offer_id
    ]
    if len(rows) != 1:
        return "OUTSIDE_OFFER_APPLIED_INDEPENDENT_RESPONSE_REQUIRED"
    offer = rows[0]
    seller = subjects.get(owner)
    if (seller is None or not seller.active or buyer is None
            or offer.get("actor") != owner
            or offer.get("outside_offer_buyer") != buyer
            or offer.get("outside_demand_id") != demand_id):
        return "OUTSIDE_OFFER_ORIGINAL_OWNER_AND_DEMAND_REQUIRED"
    if (type(offer.get("at")) is not int
            or type(offer.get("outside_offer_valid_until")) is not int
            or not offer["at"] < at < offer["outside_offer_valid_until"]):
        return "OUTSIDE_OFFER_NOT_PRIOR_OR_CURRENT"
    scope = original_owner_economic_core(seller.kind)
    if scope is None:
        return "OUTSIDE_OFFER_ORIGINAL_OWNER_SCOPE_REQUIRED"
    try:
        context_basis.assert_original_independent_supplier_offer_source(
            owner, offer["outside_offer_source_ref"],
            offer["outside_offer_source_revision"],
            core=scope, buyer=buyer, at=at,
        )
    except ContextBlocked:
        return "OUTSIDE_OFFER_CURRENT_SELLER_SOURCE_NO_LONGER_READABLE"
    resource, units, start, end = probe
    if any((
        offer.get("outside_offer_resource") != resource,
        offer.get("outside_offer_units") != units,
        offer.get("outside_offer_slot_start") != start,
        offer.get("outside_offer_slot_end") != end,
        offer.get("outside_offer_deliverable") != deliverable,
        offer.get("outside_offer_quality_basis") != quality_basis,
        offer.get("outside_offer_currency") != currency,
        offer.get("outside_offer_price") != f"{price:.2f}",
    )):
        return "OUTSIDE_OFFER_SELLER_DOCUMENT_NOT_COMPARABLE"
    return None


_BUYER_OFFER_RESPONSE_FIELDS = frozenset({
    "at", "action", "actor", "outside_demand_id", "outside_offer_id",
    "outside_offer_source_revision", "outside_buyer_response_id",
    "outside_buyer_response_decision",
    "outside_buyer_response_source_ref",
    "outside_buyer_response_source_revision",
    "outside_buyer_response_valid_until",
})
_BUYER_OFFER_RESPONSES = frozenset({
    "WILLING_TO_NEGOTIATE", "DECLINES_OFFER",
})


def qualify_original_outside_buyer_offer_response(
    state: Any, event: Mapping[str, Any], at: int,
) -> dict[str, Any]:
    """Apply independent BUYER intent for exactly one original supplier offer.

    This is NOT an accepted order, legal signature or original Work consent.
    One applied response per original offer; changing the response requires
    a fresh seller offer and independent buyer-owned model evidence.
    """
    if (not isinstance(event, Mapping)
            or set(event) not in (_BUYER_OFFER_RESPONSE_FIELDS,
                                  _BUYER_OFFER_RESPONSE_FIELDS | {"outside_buyer_response_installments"})
            or event.get("action") != "outside_buyer_offer_response"):
        raise OutsideDemandBlocked("OUTSIDE_BUYER_RESPONSE_FIELDS_REQUIRED")
    buyer = event["actor"]
    demand_id = event["outside_demand_id"]
    offer_id = event["outside_offer_id"]
    response_id = event["outside_buyer_response_id"]
    response_source = event["outside_buyer_response_source_ref"]
    response_revision = event["outside_buyer_response_source_revision"]
    for value in (buyer, demand_id, offer_id, response_id, response_source,
                  response_revision, event["outside_offer_source_revision"]):
        if not _identifier(value):
            raise OutsideDemandBlocked("OUTSIDE_BUYER_RESPONSE_IDENTIFIERS_REQUIRED")
    if (not isinstance(event["outside_buyer_response_decision"], str)
            or event["outside_buyer_response_decision"] not in _BUYER_OFFER_RESPONSES):
        raise OutsideDemandBlocked("OUTSIDE_BUYER_RESPONSE_DECISION_INVALID")
    valid_until = event["outside_buyer_response_valid_until"]
    if (type(at) is not int or type(valid_until) is not int
            or not 0 <= at < valid_until <= 10000):
        raise OutsideDemandBlocked("OUTSIDE_BUYER_RESPONSE_TIME_INVALID")
    originals = [
        row for row in state.trace
        if row.get("action") == "outside_demand_signal"
        and row.get("outcome") == "APPLIED"
        and row.get("outside_demand_id") == demand_id
    ]
    offers = [
        row for row in state.trace
        if row.get("action") == "outside_supplier_offer"
        and row.get("outcome") == "APPLIED"
        and row.get("outside_offer_id") == offer_id
    ]
    if len(originals) != 1 or len(offers) != 1:
        raise OutsideDemandBlocked(
            "OUTSIDE_BUYER_RESPONSE_ORIGINAL_DEMAND_AND_OFFER_REQUIRED"
        )
    demand, offer = originals[0], offers[0]
    seller = offer.get("actor")
    buyer_party = state.subjects.get(buyer)
    seller_party = state.subjects.get(seller)
    if (
        demand.get("actor") != buyer
        or offer.get("outside_offer_buyer") != buyer
        or offer.get("outside_demand_id") != demand_id
        or buyer == seller
        or buyer_party is None or seller_party is None
        or not buyer_party.active or not seller_party.active
        or buyer_party.kind not in _INDEPENDENT_BUYER_KINDS
    ):
        raise OutsideDemandBlocked(
            "OUTSIDE_BUYER_RESPONSE_ORIGINAL_INDEPENDENT_BUYER_ONLY"
        )
    if any(
        row.get("action") == "outside_buyer_offer_response"
        and row.get("outcome") == "APPLIED"
        and (row.get("outside_buyer_response_id") == response_id
             or row.get("outside_offer_id") == offer_id)
        for row in state.trace
    ):
        raise OutsideDemandBlocked(
            "OUTSIDE_BUYER_RESPONSE_ALREADY_RECORDED_FOR_OFFER"
        )
    if (
        type(demand.get("at")) is not int
        or type(offer.get("at")) is not int
        or type(demand.get("outside_demand_valid_until")) is not int
        or type(offer.get("outside_offer_valid_until")) is not int
        or not demand["at"] < offer["at"] < at
        or valid_until > min(
            demand["outside_demand_valid_until"],
            offer["outside_offer_valid_until"],
        )
    ):
        raise OutsideDemandBlocked(
            "OUTSIDE_BUYER_RESPONSE_OFFER_OR_DEMAND_NOT_CURRENT"
        )
    if any(
        row.get("action") == "outside_demand_withdraw"
        and row.get("outcome") == "APPLIED"
        and row.get("outside_demand_id") == demand_id
        and type(row.get("at")) is int
        and demand["at"] < row["at"] <= at
        for row in state.trace
    ):
        raise OutsideDemandBlocked(
            "OUTSIDE_BUYER_RESPONSE_DEMAND_ALREADY_WITHDRAWN"
        )
    if event["outside_offer_source_revision"] != offer.get(
            "outside_offer_source_revision"):
        raise OutsideDemandBlocked(
            "OUTSIDE_BUYER_RESPONSE_OFFER_SOURCE_REVISION_MISMATCH"
        )
    if (response_source == demand.get("outside_demand_source_ref")
            or response_source == offer.get("outside_offer_source_ref")):
        raise OutsideDemandBlocked(
            "OUTSIDE_BUYER_RESPONSE_SEPARATE_OWNER_EDITION_REQUIRED"
        )
    if state.context_basis is None:
        raise OutsideDemandBlocked("OUTSIDE_BUYER_RESPONSE_ORIGINAL_KPB_REQUIRED")
    buyer_core = original_owner_economic_core(buyer_party.kind)
    seller_core = original_owner_economic_core(seller_party.kind)
    if buyer_core is None or seller_core is None:
        raise OutsideDemandBlocked("OUTSIDE_BUYER_RESPONSE_ORIGINAL_KPB_REQUIRED")
    try:
        state.context_basis.assert_original_independent_outside_demand_source(
            buyer, demand["outside_demand_source_ref"],
            demand["outside_demand_source_revision"],
            core=buyer_core, recipient=seller, at=at,
        )
    except ContextBlocked as exc:
        raise OutsideDemandBlocked(
            "OUTSIDE_BUYER_RESPONSE_DEMAND_SOURCE_NOT_READABLE"
        ) from exc
    try:
        state.context_basis.assert_original_independent_supplier_offer_source(
            seller, offer["outside_offer_source_ref"],
            offer["outside_offer_source_revision"],
            core=seller_core, buyer=buyer, at=at,
        )
    except ContextBlocked as exc:
        raise OutsideDemandBlocked(
            "OUTSIDE_BUYER_RESPONSE_SUPPLIER_SOURCE_NOT_READABLE"
        ) from exc
    try:
        state.context_basis.assert_original_independent_outside_demand_source(
            buyer, response_source, response_revision,
            core=buyer_core, recipient=seller, at=at,
        )
    except ContextBlocked as exc:
        raise OutsideDemandBlocked(
            "OUTSIDE_BUYER_RESPONSE_OWN_SOURCE_NOT_QUALIFIED"
        ) from exc
    installments = offer.get("outside_offer_installments")
    if installments is not None:
        echoed = normalize_original_outside_installments(
            event.get("outside_buyer_response_installments"),
            price=offer["outside_offer_price"], offered_at=offer["at"])
        if echoed != installments or echoed[0]["at"] <= at:
            raise OutsideDemandBlocked("OUTSIDE_BUYER_RESPONSE_INSTALLMENTS_MISMATCH")
    elif "outside_buyer_response_installments" in event:
        raise OutsideDemandBlocked("OUTSIDE_BUYER_RESPONSE_INSTALLMENTS_WITHOUT_OFFER")
    return {
        **({"outside_buyer_response_installments": installments} if installments is not None else {}),
        "outside_demand_id": demand_id,
        "outside_offer_id": offer_id,
        "outside_buyer_response_id": response_id,
        "outside_offer_source_revision": offer["outside_offer_source_revision"],
        "outside_buyer_response_decision": event["outside_buyer_response_decision"],
        "outside_buyer_response_source_ref": response_source,
        "outside_buyer_response_source_revision": response_revision,
        "outside_buyer_response_valid_until": valid_until,
        "outside_buyer_model_intent_not_legal_acceptance": True,
        "original_work_and_bank_settlement_not_created": True,
    }


def assess_original_buyer_offer_response(
    *, response_id: str | None, offer_id: str, demand_id: str,
    buyer: str | None, seller: str, trace: Sequence[Mapping[str, Any]] | None,
    subjects: Mapping[str, Any] | None, context_basis: Any, at: int,
) -> str | None:
    """Read current response source without treating model intent as a sale.

    Buyer is resolved from ORIGINAL demand trace, never selected by seller.
    Uses one ContextBasis: no second identity, contract or money ledger.
    """
    if response_id is None:
        return None
    if (trace is None or subjects is None or context_basis is None
            or buyer is None):
        return "OUTSIDE_BUYER_RESPONSE_ORIGINAL_TRACE_KPB_REQUIRED"
    matches = [
        row for row in trace
        if row.get("action") == "outside_buyer_offer_response"
        and row.get("outcome") == "APPLIED"
        and row.get("outside_buyer_response_id") == response_id
    ]
    if len(matches) != 1:
        return "OUTSIDE_BUYER_RESPONSE_INDEPENDENT_EVENT_REQUIRED"
    response = matches[0]
    buyer_party = subjects.get(buyer)
    if (
        buyer_party is None or not buyer_party.active
        or buyer_party.kind not in _INDEPENDENT_BUYER_KINDS
        or response.get("actor") != buyer
        or response.get("outside_offer_id") != offer_id
        or response.get("outside_demand_id") != demand_id
        or buyer == seller
    ):
        return "OUTSIDE_BUYER_RESPONSE_INDEPENDENT_OWNER_AND_OFFER_REQUIRED"
    if (type(response.get("at")) is not int
            or type(response.get("outside_buyer_response_valid_until")) is not int
            or not response["at"] < at < response["outside_buyer_response_valid_until"]):
        return "OUTSIDE_BUYER_RESPONSE_NOT_PRIOR_OR_CURRENT"
    core = original_owner_economic_core(buyer_party.kind)
    if core is None:
        return "OUTSIDE_BUYER_RESPONSE_SOURCE_SCOPE_REQUIRED"
    try:
        context_basis.assert_original_independent_outside_demand_source(
            buyer, response["outside_buyer_response_source_ref"],
            response["outside_buyer_response_source_revision"],
            core=core, recipient=seller, at=at,
        )
    except ContextBlocked:
        return "OUTSIDE_BUYER_RESPONSE_CURRENT_SOURCE_NO_LONGER_READABLE"
    if response.get("outside_buyer_response_decision") == "DECLINES_OFFER":
        return "OUTSIDE_BUYER_INDEPENDENTLY_DECLINED_OFFER"
    if response.get("outside_buyer_response_decision") != "WILLING_TO_NEGOTIATE":
        return "OUTSIDE_BUYER_RESPONSE_DECISION_INVALID"
    return None


_OUTSIDE_WORK_ORIGIN_FIELDS = frozenset({
    "outside_demand_id", "outside_offer_id", "outside_buyer_response_id",
})


def qualify_original_outside_work_origin(
    state: Any, work: Any, binding: Any, at: int,
) -> dict[str, str]:
    """Validate provenance for one ordinary Work requested by its buyer.

    No Work, resource reservation, legal consent, payment or second store is
    created here. The ORIGINAL request and commitment paths remain responsible
    for those model transitions. For this single-resource comparison the
    quality-basis identifier must be represented in original Work assurance.
    """
    if (not isinstance(binding, Mapping)
            or set(binding) != _OUTSIDE_WORK_ORIGIN_FIELDS
            or any(not _identifier(value) for value in binding.values())):
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGIN_FIELDS_REQUIRED")
    if type(at) is not int or not 0 <= at <= 10000:
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGIN_TIME_INVALID")
    demand_id = binding["outside_demand_id"]
    offer_id = binding["outside_offer_id"]
    response_id = binding["outside_buyer_response_id"]
    origins = [
        row for row in state.trace
        if row.get("action") == "request"
        and row.get("outcome") == "APPLIED"
        and isinstance(row.get("outside_work_origin"), Mapping)
        and row.get("work") != work.key
        and row["outside_work_origin"].get("outside_demand_id") == demand_id
    ]
    if origins:
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_DEMAND_ALREADY_USED")

    def original(action: str, field: str, value: str) -> Mapping[str, Any]:
        rows = [
            row for row in state.trace
            if row.get("action") == action and row.get("outcome") == "APPLIED"
            and row.get(field) == value
        ]
        if len(rows) != 1:
            raise OutsideDemandBlocked("OUTSIDE_WORK_THREE_ORIGINAL_EVENTS_REQUIRED")
        return rows[0]

    demand = original("outside_demand_signal", "outside_demand_id", demand_id)
    offer = original("outside_supplier_offer", "outside_offer_id", offer_id)
    response = original(
        "outside_buyer_offer_response", "outside_buyer_response_id", response_id
    )
    buyer = work.customer
    seller = state.resources.get(work.resource)
    buyer_party = state.subjects.get(buyer)
    seller_party = state.subjects.get(seller)
    if (
        buyer_party is None or seller_party is None
        or not buyer_party.active or not seller_party.active or buyer == seller
        or buyer_party.kind not in _INDEPENDENT_BUYER_KINDS
        or demand.get("actor") != buyer
        or demand.get("outside_supplier") != seller
        or offer.get("actor") != seller
        or offer.get("outside_offer_buyer") != buyer
        or offer.get("outside_demand_id") != demand_id
        or response.get("actor") != buyer
        or response.get("outside_offer_id") != offer_id
        or response.get("outside_demand_id") != demand_id
        or response.get("outside_offer_source_revision")
            != offer.get("outside_offer_source_revision")
    ):
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_INDEPENDENT_PARTIES_REQUIRED")
    buyer_core = original_owner_economic_core(buyer_party.kind)
    seller_core = original_owner_economic_core(seller_party.kind)
    context = state.context_basis
    if buyer_core is None or seller_core is None or context is None:
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_KPB_REQUIRED")
    # All three current read scopes precede any use of their private terms.
    try:
        context.assert_original_independent_outside_demand_source(
            buyer, demand["outside_demand_source_ref"],
            demand["outside_demand_source_revision"],
            core=buyer_core, recipient=seller, at=at,
        )
        context.assert_original_independent_supplier_offer_source(
            seller, offer["outside_offer_source_ref"],
            offer["outside_offer_source_revision"],
            core=seller_core, buyer=buyer, at=at,
        )
        context.assert_original_independent_outside_demand_source(
            buyer, response["outside_buyer_response_source_ref"],
            response["outside_buyer_response_source_revision"],
            core=buyer_core, recipient=seller, at=at,
        )
    except ContextBlocked as exc:
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_SOURCE_NOT_CURRENT") from exc
    if not (
        demand["at"] < offer["at"] < response["at"] < at
        < min(
            demand["outside_demand_valid_until"],
            offer["outside_offer_valid_until"],
            response["outside_buyer_response_valid_until"],
        )
    ):
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_INTENT_NOT_CURRENT")
    candidate = state.works.get(demand["outside_candidate_work"])
    relation = next((
        link for link in state.cooperation_links
        if link.key == demand["outside_relation"]
        and link.source_revision == demand["outside_relation_revision"]
    ), None)
    if (
        candidate is None or candidate.key == work.key or relation is None
        or candidate.key not in relation.works
        or candidate.source_revision != demand["outside_work_revision"]
    ):
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_COMPARISON_BASIS_REQUIRED")
    if "outside_candidate_operation" in demand:
        _qualify_original_operation_resource_comparison(state, candidate, demand, at)
    elif (candidate.slot_start, candidate.slot_end) != (work.slot_start, work.slot_end):
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_COMPARISON_BASIS_REQUIRED")
    needs = tuple((need.resource, need.units) for need in work.resource_requirements)
    if needs != ((work.resource, offer["outside_offer_units"]),):
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_RESOURCE_QUANTITY_MISMATCH")
    probe = (work.resource, needs[0][1], work.slot_start, work.slot_end)
    price = Decimal(offer["outside_offer_price"])
    currency = offer["outside_offer_currency"]
    deliverable = offer["outside_offer_deliverable"]
    quality_basis = offer["outside_offer_quality_basis"]
    for reason in (
        assess_original_independent_outside_demand(
            demand=(demand_id, deliverable, quality_basis), owner=seller,
            work=candidate, relation=relation.key,
            relation_revision=relation.source_revision, probe=probe,
            outside_external_sales=price, currency=currency,
            trace=state.trace, subjects=state.subjects,
            links=state.cooperation_links, context_basis=context, at=at,
        ),
        assess_original_outside_supplier_offer(
            offer_id=offer_id, demand_id=demand_id, owner=seller, buyer=buyer,
            trace=state.trace, subjects=state.subjects, context_basis=context,
            price=price, currency=currency, probe=probe,
            deliverable=deliverable, quality_basis=quality_basis, at=at,
        ),
        assess_original_buyer_offer_response(
            response_id=response_id, offer_id=offer_id, demand_id=demand_id,
            buyer=buyer, seller=seller, trace=state.trace,
            subjects=state.subjects, context_basis=context, at=at,
        ),
    ):
        if reason is not None:
            raise OutsideDemandBlocked(reason)
    if not any(
        criterion.key == quality_basis
        and criterion.assessor == buyer
        and criterion.responsible_owner == seller
        and criterion.source_ref == demand["outside_demand_source_ref"]
        for criterion in work.assurance_criteria
    ):
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_BUYER_QUALITY_BASIS_REQUIRED")
    installments = offer.get("outside_offer_installments")
    if installments is not None:
        if (response.get("outside_buyer_response_installments") != installments
                or installments[0]["at"] <= at
                or any(row["condition"] == "ON_ORIGINAL_COMMIT"
                       and row["due_at"] >= work.slot_start for row in installments)):
            raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_INSTALLMENT_TIMING_NOT_QUALIFIED")
    # IDs identify existing original events; no financial values or new
    # executable authority are added to the request.
    return {key: binding[key] for key in sorted(_OUTSIDE_WORK_ORIGIN_FIELDS)}


def _qualify_original_operation_resource_comparison(state, candidate, demand, at, *, prospective=False):
    """Independent demand competes for a source-declared stage resource.

    The second demand is a different product, potentially with a different
    window. The existing ledger, not this provenance check, determines
    whether both can be committed. The candidate's actually APPLIED original
    market route must identify the selected or compatible stage resource;
    a buyer cannot claim an arbitrary resource was released.
    """
    from .technology import technology_route_fingerprint

    operation = next((op for op in candidate.operations
                      if op.key == demand["outside_candidate_operation"]), None)
    if operation is None:
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_OPERATION_REQUIRED")
    if prospective and candidate.obligation != "NOT_ACCEPTED":
        raise OutsideDemandBlocked("OUTSIDE_STAGE_PROSPECTIVE_UNCOMMITTED_WORK_REQUIRED")
    action = "request" if prospective else "commit"
    originals = [r for r in state.trace if r["action"] == action and r["outcome"] == "APPLIED"
                 and r.get("work") == candidate.key and (r["at"] <= at if prospective else r["at"] < at)
                 and r.get("technology_route_market_scope_fingerprint")]
    if len(originals) != 1:
        raise OutsideDemandBlocked("OUTSIDE_STAGE_PROSPECTIVE_REQUEST_MARKET_REQUIRED" if prospective
                                   else "OUTSIDE_WORK_ORIGINAL_COMMITTED_STAGE_MARKET_REQUIRED")
    original = originals[0]
    events = [e for e in state.events if e["action"] == action
              and e.get("work", e.get("work_spec", {}).get("id")) == candidate.key and e["at"] == original["at"]]
    market = events[0].get("technology_route_market_scope") if len(events) == 1 else None
    if (not isinstance(market, dict)
            or technology_route_fingerprint(market) != original["technology_route_market_scope_fingerprint"]
            or market.get("work") != candidate.key or market.get("work_revision") != candidate.source_revision):
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_STAGE_MARKET_FINGERPRINT_MISMATCH")
    requirements = [r for r in market["requirements"] if r["operation"] == operation.key]
    resource, seller = demand["outside_resource"], demand["outside_supplier"]
    if (len(requirements) != 1 or resource not in requirements[0]["compatible_resources"]
            or state.resources.get(resource) != seller):
        raise OutsideDemandBlocked("OUTSIDE_WORK_RESOURCE_NOT_IN_ORIGINAL_STAGE_CATALOGUE")
    requirement = requirements[0]
    offers = [o for o in market["offers"] if o["resource"] == resource and o["owner"] == seller
              and o["capability"] == requirement["capability"]
              and o["capacity_unit"] == requirement["capacity_unit"]
              and o["available_at"] <= original["at"] < o["expires_at"]
              and o["available_at"] <= at < o["expires_at"]]
    if not offers:
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_STAGE_OFFER_NOT_CURRENT")
    basis = state.context_basis
    buyer = market["buyer_source"]
    try:
        basis.assert_original_historical_form_role_source(
            candidate.customer, buyer["reference"], buyer["revision"], core="corporate",
            purpose="AKIS_TECHNOLOGY_MARKET_EVIDENCE", operation="READ",
            recipients={candidate.customer}, at=original["at"])
        basis.assert_original_form_role_source(
            candidate.customer, buyer["reference"], buyer["revision"], core="corporate",
            purpose="AKIS_TECHNOLOGY_MARKET_EVIDENCE", operation="READ",
            recipients={candidate.customer}, at=at)
        qualified = False
        for offer in offers:
            try:
                basis.assert_original_historical_form_role_source(
                    seller, offer["source_ref"], market["offer_revisions"][offer["id"]],
                    core="corporate", purpose="AKIS_TECHNOLOGY_MARKET_EVIDENCE",
                    operation="READ", recipients={candidate.customer}, at=original["at"])
                basis.assert_original_form_role_source(
                    seller, offer["source_ref"], market["offer_revisions"][offer["id"]],
                    core="corporate", purpose="AKIS_TECHNOLOGY_MARKET_EVIDENCE",
                    operation="READ", recipients={candidate.customer}, at=at)
                qualified = True
                break
            except ContextBlocked:
                continue
        if not qualified:
            raise ContextBlocked("OUTSIDE_STAGE_OWNER_OFFER_NOT_READABLE")
    except ContextBlocked as exc:
        raise OutsideDemandBlocked("OUTSIDE_WORK_ORIGINAL_STAGE_MARKET_SOURCE_NOT_CURRENT") from exc
