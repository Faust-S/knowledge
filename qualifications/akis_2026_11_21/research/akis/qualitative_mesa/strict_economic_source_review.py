"""Strict-KPB review of ORIGINAL economic-claim sources in the SAME Mesa.

This is a permission check through the *existing* original ContextBasis,
not a second IAM, ledger, event stream, Work, monetary calculation or grant.
A source-declared cost or transfer does not become verified settlement.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Mapping

from .context_basis import ContextBlocked


class StrictEconomicSourceBlocked(ValueError):
    """Original source rights are not sufficient for this research use."""


_OWNER_CORES = {
    "OPERATOR": "operator",
    "SECTOR_BODY": "institutional",
    "PUBLIC_INSTITUTION": "institutional",
    "NATURAL_PERSON": "personal",
    "SME": "corporate",
    "DIVISION": "corporate",
    "EMPLOYEE": "corporate",
}
_PURPOSE = "AKIS_ECONOMIC_WORK_EVIDENCE"
_OPERATION = "READ"


def original_owner_economic_core(kind: str) -> str | None:
    """Use the existing original economic owner-kind mapping, not new IAM."""
    return _OWNER_CORES.get(kind)


def review_original_strict_economic_sources(
    *, state: Any, original_claims: Mapping[str, Any],
    work_id: str | tuple[str, ...], at: int,
) -> dict[str, Any]:
    """Check rights to examine each source, not rights to execute a payment.

    The original work must already exist, and each original resource owner
    and recipient must provide at least one currently usable own source.
    This evaluation is performed *after* the Mesa trace, allowing only
    successfully registered new subjects to participate. It never mutates
    the original ContextBasis or creates a subject from a declaration.

    Result intentionally contains no owner IDs, source refs or cash values.
    """
    context = getattr(state, "context_basis", None)
    if context is None or not context.strict:
        raise StrictEconomicSourceBlocked(
            "ORIGINAL_ECONOMIC_STRICT_CONTEXT_REQUIRED"
        )
    if type(at) is not int or at < 0 or at > 10000:
        raise StrictEconomicSourceBlocked(
            "ORIGINAL_ECONOMIC_CONTEXT_TIME_INVALID"
        )
    work_ids = (work_id,) if isinstance(work_id, str) else work_id
    if (not isinstance(work_ids, tuple) or not 1 <= len(work_ids) <= 256
            or any(not isinstance(key, str) or key not in state.works
                   for key in work_ids)
            or len(set(work_ids)) != len(work_ids)):
        raise StrictEconomicSourceBlocked(
            "ORIGINAL_ECONOMIC_WORK_MUST_EXIST"
        )
    if not isinstance(original_claims, Mapping):
        raise StrictEconomicSourceBlocked(
            "ORIGINAL_ECONOMIC_SOURCE_DOCUMENT_REQUIRED"
        )
    # Multi-period qualification uses the original single economic
    # document. Do not let it silently include a Work outside the declared
    # strict source scope, or claim historical coverage of an absent period.
    uncommitted = original_claims.get("uncommitted_order_cost_evidence")
    uncommitted_key = None
    if uncommitted is not None:
        if (not isinstance(work_id, tuple) or not isinstance(uncommitted, dict)
                or not isinstance(uncommitted.get("work"), str)
                or uncommitted["work"] not in work_ids):
            raise StrictEconomicSourceBlocked("UNCOMMITTED_ORDER_ORIGINAL_MULTIPERIOD_SCOPE_REQUIRED")
        uncommitted_key = uncommitted["work"]
        candidate = state.works[uncommitted_key]
        if (candidate.obligation != "NOT_ACCEPTED" or candidate.result != "NOT_SUBMITTED"
                or any(e.get("work") == uncommitted_key and e.get("action") in {"commit", "accept"}
                       and e.get("outcome") == "APPLIED" for e in state.trace)):
            raise StrictEconomicSourceBlocked("UNCOMMITTED_ORDER_CANNOT_OMIT_COMMITTED_TRANSFERS")
    if isinstance(work_id, tuple):
        for field in ("transfers", "resource_uses"):
            expected = set(work_ids) - ({uncommitted_key} if field == "transfers" and uncommitted_key else set())
            records = original_claims.get(field)
            if (not isinstance(records, list)
                    or any(not isinstance(row, dict)
                           or row.get("work") not in work_ids
                           or row.get("scenario") != "COOPERATION"
                           for row in records)
                    or {row["work"] for row in records} != expected):
                raise StrictEconomicSourceBlocked(
                    "ORIGINAL_ECONOMIC_MULTI_WORK_SCOPE_INCOMPLETE"
                )
    rows = original_claims.get("sources")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 2048:
        raise StrictEconomicSourceBlocked(
            "ORIGINAL_ECONOMIC_OWNER_SOURCES_REQUIRED"
        )
    def _qualify_original_event_evidence(
            owner: str, source_ref: str | None,
            pinned_revision: str | None, core: str, event_at: int,
    ) -> None:
        # Historical legitimacy is evaluated using the ORIGINAL applied
        # owner source updates, not today's rewritten status. Access to
        # this same evidence is ALSO checked against the current source
        # scope before it can enter any financial research projection.
        if event_at > at:
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_EVENT_AFTER_MODEL_HORIZON"
            )
        current_source = (
            context.sources.get(source_ref)
            if isinstance(source_ref, str) else None
        )
        try:
            context.assert_original_historical_form_role_source(
                owner, source_ref, pinned_revision, core=core,
                purpose=_PURPOSE, operation=_OPERATION,
                recipients={owner}, at=event_at,
            )
        except ContextBlocked as exc:
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_HISTORICAL_SOURCE_NOT_QUALIFIED"
            ) from exc
        try:
            context.assert_original_form_role_source(
                owner, source_ref,
                current_source.revision if current_source is not None else None,
                core=core, purpose=_PURPOSE, operation=_OPERATION,
                recipients={owner}, at=at,
            )
        except ContextBlocked as exc:
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_CURRENT_READ_NOT_PERMITTED"
            ) from exc

    seen: set[str] = set()
    covered: set[str] = set()
    sources_by_id: dict[str, dict[str, Any]] = {}
    for record in rows:
        if (not isinstance(record, dict)
                or set(record) != {"id", "owner", "reference", "revision"}):
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_SOURCE_FIELDS_INVALID"
            )
        ref = record["reference"]
        owner = record["owner"]
        revision = record["revision"]
        key = record["id"]
        if not isinstance(key, str) or not key or key in seen:
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_SOURCE_DUPLICATE"
            )
        seen.add(key)
        sources_by_id[key] = record
        subject = state.subjects.get(owner) if isinstance(owner, str) else None
        if subject is None or not subject.active:
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_SOURCE_ACTOR_NOT_REGISTERED"
            )
        core = _OWNER_CORES.get(subject.kind)
        if core is None:
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_OWNER_CORE_UNKNOWN"
            )
        try:
            context.assert_original_form_role_source(
                owner, ref, revision, core=core, purpose=_PURPOSE,
                operation=_OPERATION, recipients={owner}, at=at,
            )
        except ContextBlocked as exc:
            # Never include the owner's source reference or cash amount in
            # an inter-enterprise error/result.
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_SOURCE_NOT_USABLE_IN_STRICT_KPB"
            ) from exc
        covered.add(owner)
    outside_price_qualified = False
    qualified_commercial_orders = 0
    for scoped_work in work_ids:
        work = state.works[scoped_work]
        principals = (
            state.capacity_ledger.original_owners(
                work.resource_requirements
            ) | {work.customer}
        )
        if not principals.issubset(covered):
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_INDEPENDENT_PRINCIPAL_SOURCE_MISSING"
            )
        # The commercial route's ORIGINAL accepted digest pins the purchase
        # obligations. Later financial records cannot silently reprice it.
        commercial_commits = [row for row in state.trace if row["action"] == "commit"
            and row["outcome"] == "APPLIED" and row.get("work") == scoped_work
            and row.get("technology_route_commercial_fingerprint") is not None]
        if commercial_commits:
            if len(commercial_commits) != 1:
                raise StrictEconomicSourceBlocked("COMMERCIAL_ORIGINAL_COMMIT_AMBIGUOUS")
            committed = commercial_commits[0]
            raw = committed.get("technology_route_commercial_terms_private_research_only")
            from .technology import (technology_route_fingerprint,
                                     read_original_route_commercial_sources, TechnologyRouteBlocked)
            if (not isinstance(raw, dict)
                    or technology_route_fingerprint(raw) != committed["technology_route_commercial_fingerprint"]):
                raise StrictEconomicSourceBlocked("COMMERCIAL_ORIGINAL_COMMITTED_TERMS_REQUIRED")
            try:
                read_original_route_commercial_sources(state, raw, committed["at"], historical=True)
                read_original_route_commercial_sources(state, raw, at)
            except TechnologyRouteBlocked as exc:
                raise StrictEconomicSourceBlocked("COMMERCIAL_COMMITTED_OWNER_SOURCES_NOT_READABLE") from exc
            transfers = original_claims.get("transfers")
            conditions = original_claims.get("work_payment_conditions")
            if (not isinstance(transfers, list) or not isinstance(conditions, list)
                    or original_claims.get("currency") != raw["currency"]):
                raise StrictEconomicSourceBlocked("COMMERCIAL_ORIGINAL_PAYMENT_DOCUMENT_REQUIRED")
            buyer = raw["buyer"]
            payments = [r for r in transfers if isinstance(r, dict)
                and r.get("work") == scoped_work and r.get("scenario") == "COOPERATION"
                and r.get("payer") == buyer and r.get("payee") != "EXTERNAL"]
            quotes = {r["payee"]: r for r in raw["offers"]}
            if (len(payments) != len(quotes) or {r.get("payee") for r in payments} != set(quotes)):
                raise StrictEconomicSourceBlocked("COMMERCIAL_ORIGINAL_PURCHASE_PARTIES_MISMATCH")
            for payment in payments:
                quote = quotes[payment["payee"]]
                matched = [r for r in conditions if isinstance(r, dict)
                           and r.get("transfer_id") == payment["id"]]
                try:
                    amount_ok = (isinstance(payment.get("amount"), str)
                                 and Decimal(payment["amount"]).is_finite()
                                 and Decimal(payment["amount"]) == Decimal(quote["amount"]))
                except (InvalidOperation, TypeError, ValueError):
                    amount_ok = False
                if not amount_ok:
                    raise StrictEconomicSourceBlocked("COMMERCIAL_ORIGINAL_PURCHASE_PRICE_MISMATCH")
                if (len(matched) != 1 or matched[0].get("condition") != quote["condition"]
                        or matched[0].get("due_at") != quote["due_at"]
                        or matched[0].get("work_source_revision") != raw["work_revision"]
                        or matched[0].get("org_revision") != committed["org_revision"]):
                    raise StrictEconomicSourceBlocked("COMMERCIAL_ORIGINAL_PAYMENT_CONDITION_MISMATCH")
            qualified_commercial_orders += 1
        # For an outside Work whose original request pinned the three earlier
        # events, compare a declared purchase payment with that original offer.
        # This is a strict-KPB review of EXISTING rows, never a new obligation.
        origin_rows = [
            row for row in state.trace
            if row.get("action") == "request" and row.get("outcome") == "APPLIED"
            and row.get("work") == scoped_work
            and isinstance(row.get("outside_work_origin"), Mapping)
        ]
        if origin_rows and "work_payment_conditions" in original_claims and scoped_work != uncommitted_key:
            if len(origin_rows) != 1:
                raise StrictEconomicSourceBlocked("OUTSIDE_WORK_ORIGINAL_REQUEST_AMBIGUOUS")
            request = origin_rows[0]
            origin = request["outside_work_origin"]
            offers = [
                row for row in state.trace
                if row.get("action") == "outside_supplier_offer"
                and row.get("outcome") == "APPLIED"
                and row.get("outside_offer_id") == origin["outside_offer_id"]
                and row.get("outside_demand_id") == origin["outside_demand_id"]
            ]
            if len(offers) != 1:
                raise StrictEconomicSourceBlocked("OUTSIDE_WORK_ORIGINAL_OFFER_REQUIRED")
            offer = offers[0]
            buyer, seller = work.customer, offer["actor"]
            core = _OWNER_CORES.get(state.subjects[seller].kind)
            if core is None or buyer == seller or offer["outside_offer_buyer"] != buyer:
                raise StrictEconomicSourceBlocked("OUTSIDE_WORK_ORIGINAL_PAYMENT_PARTIES_REQUIRED")
            # Historical qualification does not grant current access to the
            # original commercial terms. Check both before reading the price.
            try:
                context.assert_original_historical_form_role_source(
                    seller, offer["outside_offer_source_ref"],
                    offer["outside_offer_source_revision"], core=core,
                    purpose="AKIS_EXTERNAL_DEMAND_EVIDENCE",
                    operation="READ", recipients={buyer}, at=request["at"],
                )
                context.assert_original_independent_supplier_offer_source(
                    seller, offer["outside_offer_source_ref"],
                    offer["outside_offer_source_revision"], core=core,
                    buyer=buyer, at=at,
                )
            except ContextBlocked as exc:
                raise StrictEconomicSourceBlocked(
                    "OUTSIDE_WORK_ORIGINAL_OFFER_PRICE_SOURCE_NOT_READABLE"
                ) from exc
            transfers = original_claims.get("transfers")
            terms = original_claims.get("work_payment_conditions")
            if not isinstance(transfers, list) or not isinstance(terms, list):
                raise StrictEconomicSourceBlocked("OUTSIDE_WORK_ORIGINAL_PAYMENT_DOCUMENT_REQUIRED")
            payments = [
                row for row in transfers if isinstance(row, dict)
                and row.get("work") == scoped_work
                and row.get("scenario") == "COOPERATION"
                and row.get("payer") == buyer and row.get("payee") == seller
            ]
            if len(payments) != 1:
                raise StrictEconomicSourceBlocked("OUTSIDE_WORK_SINGLE_ORIGINAL_PURCHASE_TRANSFER_REQUIRED")
            payment = payments[0]
            if sum(isinstance(row, dict) and row.get("transfer_id") == payment.get("id")
                   for row in terms) != 1:
                raise StrictEconomicSourceBlocked("OUTSIDE_WORK_ORIGINAL_PURCHASE_TERMS_REQUIRED")
            try:
                exact = (isinstance(payment.get("amount"), str)
                         and Decimal(payment["amount"]).is_finite()
                         and Decimal(payment["amount"]) == Decimal(offer["outside_offer_price"]))
            except (InvalidOperation, ValueError, TypeError):
                exact = False
            if not exact or original_claims.get("currency") != offer["outside_offer_currency"]:
                raise StrictEconomicSourceBlocked("OUTSIDE_WORK_ORIGINAL_PURCHASE_PRICE_MISMATCH")
            outside_price_qualified = True

    # Original R2.6 payment claims are annotations on EXISTING transfers.
    # Each new two-party claim must have two independent, revision-pinned
    # owner-held source assertions valid at the claim's own declared time.
    # These are not bank-authenticated receipts, new payments or a ledger.
    transfers = {
        row.get("id"): row for row in original_claims.get("transfers", [])
        if isinstance(row, dict) and isinstance(row.get("id"), str)
    }
    qualified_payment_events = 0
    qualified_owner_witnesses = 0
    for field, time_field in (
        ("work_payment_settlement_claims", "at"),
        ("work_payment_due_amendments", "agreed_at"),
    ):
        claims = original_claims.get(field, [])
        if not isinstance(claims, list) or len(claims) > 2048:
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_PAYMENT_EVIDENCE_LIST_INVALID"
            )
        for record in claims:
            if not isinstance(record, dict):
                raise StrictEconomicSourceBlocked(
                    "ORIGINAL_PAYMENT_EVIDENCE_FIELDS_INVALID"
                )
            payment_time = record.get(time_field)
            if type(payment_time) is not int or not 0 <= payment_time <= 10000:
                raise StrictEconomicSourceBlocked(
                    "ORIGINAL_PAYMENT_EVIDENCE_TIME_INVALID"
                )
            original_transfer = transfers.get(record.get("transfer_id"))
            if (not isinstance(original_transfer, dict)
                    or original_transfer.get("work") not in work_ids
                    or original_transfer.get("scenario") != "COOPERATION"):
                raise StrictEconomicSourceBlocked(
                    "ORIGINAL_PAYMENT_WRONG_WORK_OR_TRANSFER_SCOPE"
                )
            parties = {
                original_transfer.get("payer"), original_transfer.get("payee")
            } - {"EXTERNAL"}
            # R2.6's bilateral payment-progress contract requires exactly
            # two original parties; unilateral external cash forecasts stay
            # source-declared, not authenticated payment progress.
            if len(parties) != 2 or not all(
                isinstance(owner, str) for owner in parties
            ):
                raise StrictEconomicSourceBlocked(
                    "ORIGINAL_PAYMENT_TWO_INDEPENDENT_PARTIES_REQUIRED"
                )
            owner_sources = record.get("owner_sources")
            evidence_refs = record.get("evidence_refs")
            pinned_revisions = record.get("evidence_revisions")
            if any(
                not isinstance(mapping, dict) or set(mapping) != parties
                for mapping in (
                    owner_sources, evidence_refs, pinned_revisions
                )
            ):
                raise StrictEconomicSourceBlocked(
                    "ORIGINAL_PAYMENT_PINNED_INDEPENDENT_EVIDENCE_REQUIRED"
                )
            if field == "work_payment_settlement_claims":
                # Two references must lead to *two independently stated*
                # amounts/times. Otherwise the operator could write one
                # amount and merely attach two unrelated source identifiers.
                statements = record.get("owner_attestations")
                if (not isinstance(statements, dict)
                        or set(statements) != parties
                        or any(not isinstance(claim, dict)
                               or set(claim) != {
                                   "reported_at", "reported_amount"
                               } for claim in statements.values())):
                    raise StrictEconomicSourceBlocked(
                        "ORIGINAL_PAYMENT_INDEPENDENT_OWNER_REPORTS_REQUIRED"
                    )
                if any(
                    type(claim["reported_at"]) is not int
                    or claim["reported_at"] != payment_time
                    or not isinstance(claim["reported_amount"], str)
                    or claim["reported_amount"] != record.get("amount")
                    for claim in statements.values()
                ):
                    raise StrictEconomicSourceBlocked(
                        "ORIGINAL_PAYMENT_OWNER_REPORTS_CONFLICT"
                    )
            for owner in sorted(parties):
                source_id = owner_sources[owner]
                economic_source = sources_by_id.get(source_id)
                if (economic_source is None
                        or economic_source["owner"] != owner):
                    raise StrictEconomicSourceBlocked(
                        "ORIGINAL_PAYMENT_INDEPENDENT_SOURCE_OWNER_REQUIRED"
                    )
                original_actor = state.subjects.get(owner)
                if original_actor is None or not original_actor.active:
                    raise StrictEconomicSourceBlocked(
                        "ORIGINAL_PAYMENT_OWNER_NOT_ACTIVE"
                    )
                core = _OWNER_CORES.get(original_actor.kind)
                if core is None:
                    raise StrictEconomicSourceBlocked(
                        "ORIGINAL_PAYMENT_OWNER_CORE_UNKNOWN"
                    )
                # Source-declared availability prior to registration is not
                # the registration itself. Check the original APPLIED event.
                if owner in getattr(context, "prospective_subjects", set()):
                    if not any(
                        row.get("action") == "subject_registration_apply"
                        and row.get("outcome") == "APPLIED"
                        and row.get("registered_original_subject") == owner
                        and type(row.get("at")) is int
                        and row["at"] < payment_time
                        for row in state.trace
                    ):
                        raise StrictEconomicSourceBlocked(
                            "ORIGINAL_PAYMENT_PRIOR_TO_OWNER_REGISTRATION"
                        )
                try:
                    _qualify_original_event_evidence(
                        owner, economic_source["reference"],
                        economic_source["revision"], core, payment_time,
                    )
                    _qualify_original_event_evidence(
                        owner, evidence_refs[owner],
                        pinned_revisions[owner], core, payment_time,
                    )
                except StrictEconomicSourceBlocked as exc:
                    raise StrictEconomicSourceBlocked(
                        "ORIGINAL_PAYMENT_EVIDENCE_NOT_USABLE_IN_STRICT_KPB"
                    ) from exc
                qualified_owner_witnesses += 1
            qualified_payment_events += 1

    # The original lifecycle model already anchors declared resource costs
    # to APPLIED Work events. Strict mode now independently qualifies the
    # owner-held evidence for that *same* row at its original event time.
    # Anchor + scope does not prove actual cost incurrence or cash payment.
    lifecycle = original_claims.get("lifecycle_costs", {})
    if not isinstance(lifecycle, dict):
        raise StrictEconomicSourceBlocked(
            "ORIGINAL_ECONOMIC_LIFECYCLE_DOCUMENT_INVALID"
        )
    event_bindings = lifecycle.get("event_bindings", [])
    if not isinstance(event_bindings, list) or len(event_bindings) > 2048:
        raise StrictEconomicSourceBlocked(
            "ORIGINAL_ECONOMIC_COST_EVENT_COUNT_INVALID"
        )
    qualified_original_cost_events = 0
    for binding in event_bindings:
        if not isinstance(binding, dict):
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_COST_EVENT_INVALID"
            )
        owner = binding.get("owner")
        event_time = binding.get("at")
        position = binding.get("trace_position")
        binding_work = binding.get("work")
        if (binding_work not in work_ids
                or type(event_time) is not int
                or type(position) is not int
                or not 0 <= position < len(state.trace)
                or state.trace[position].get("outcome") != "APPLIED"
                or state.trace[position].get("work") != binding_work
                or state.trace[position].get("action") != binding.get("action")
                or state.trace[position].get("at") != event_time):
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_COST_ORIGINAL_EVENT_MISMATCH"
            )
        economic_source = sources_by_id.get(binding.get("source"))
        subject = state.subjects.get(owner) if isinstance(owner, str) else None
        if (economic_source is None
                or economic_source.get("owner") != owner
                or subject is None or not subject.active):
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_COST_OWNER_SOURCE_REQUIRED"
            )
        core = _OWNER_CORES.get(subject.kind)
        if core is None:
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_COST_OWNER_CORE_UNKNOWN"
            )
        revision = binding.get("cost_evidence_revision")
        if not isinstance(revision, str) or not revision.strip():
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_COST_REVISION_PIN_REQUIRED"
            )
        if owner in getattr(context, "prospective_subjects", set()):
            if not any(
                row.get("action") == "subject_registration_apply"
                and row.get("outcome") == "APPLIED"
                and row.get("registered_original_subject") == owner
                and type(row.get("at")) is int
                and row["at"] < event_time
                for row in state.trace
            ):
                raise StrictEconomicSourceBlocked(
                    "ORIGINAL_ECONOMIC_COST_OWNER_NOT_YET_REGISTERED"
                )
        try:
            _qualify_original_event_evidence(
                owner, economic_source["reference"],
                economic_source["revision"], core, event_time,
            )
            _qualify_original_event_evidence(
                owner, binding.get("cost_evidence_ref"),
                revision, core, event_time,
            )
        except StrictEconomicSourceBlocked as exc:
            raise StrictEconomicSourceBlocked(
                "ORIGINAL_ECONOMIC_COST_SOURCE_NOT_USABLE_IN_STRICT_KPB"
            ) from exc
        qualified_original_cost_events += 1

    qualified_recipient_values = 0
    value_rows = original_claims.get("recipient_use_value_evidence", [])
    if not isinstance(value_rows, list) or len(value_rows) > 128:
        raise StrictEconomicSourceBlocked("RECIPIENT_VALUE_SOURCE_LIST_INVALID")
    for record in value_rows:
        if not isinstance(record, dict):
            raise StrictEconomicSourceBlocked("RECIPIENT_VALUE_SOURCE_RECORD_INVALID")
        owner, work = record.get("owner"), record.get("work")
        if (not isinstance(owner, str) or not isinstance(work, str)
                or work not in work_ids or owner != state.works[work].customer):
            raise StrictEconomicSourceBlocked("RECIPIENT_VALUE_ORIGINAL_CUSTOMER_REQUIRED")
        subject = state.subjects.get(owner)
        core = _OWNER_CORES.get(subject.kind) if subject is not None else None
        if core is None or not subject.active:
            raise StrictEconomicSourceBlocked("RECIPIENT_VALUE_ORIGINAL_OWNER_REQUIRED")
        try:
            outcome_time = record["outcome"]["at"]
            items = [(record[key]["source"], record[key]["at"])
                     for key in ("baseline", "outcome", "rate")]
            items.append((record["nonoverlap_source"], outcome_time))
            for source_id, event_time in items:
                if not isinstance(source_id, str) or type(event_time) is not int or not 0 <= event_time <= at:
                    raise StrictEconomicSourceBlocked("RECIPIENT_VALUE_SOURCE_TIME_INVALID")
                source = sources_by_id.get(source_id)
                if source is None or source["owner"] != owner:
                    raise StrictEconomicSourceBlocked("RECIPIENT_VALUE_INDEPENDENT_CUSTOMER_SOURCE_REQUIRED")
                if owner in getattr(context, "prospective_subjects", set()) and not any(
                        e.get("action") == "subject_registration_apply" and e.get("outcome") == "APPLIED"
                        and e.get("registered_original_subject") == owner and e["at"] < event_time
                        for e in state.trace):
                    raise StrictEconomicSourceBlocked("RECIPIENT_VALUE_OWNER_NOT_YET_REGISTERED")
                _qualify_original_event_evidence(owner, source["reference"], source["revision"], core, event_time)
        except (KeyError, TypeError, StrictEconomicSourceBlocked) as exc:
            raise StrictEconomicSourceBlocked("RECIPIENT_VALUE_ORIGINAL_OWNER_HISTORICAL_SOURCE_NOT_QUALIFIED") from exc
        qualified_recipient_values += 1

    qualified_uncommitted_owners = 0
    if uncommitted is not None:
        try:
            candidate = state.works[uncommitted_key]
            principals = state.capacity_ledger.original_owners(candidate.resource_requirements) | {
                candidate.customer, state.institution.operator}
            declarations = uncommitted["owner_scopes"]
            if not isinstance(declarations, dict) or set(declarations) != principals:
                raise StrictEconomicSourceBlocked("UNCOMMITTED_ORDER_ALL_ORIGINAL_OWNER_SCOPES_REQUIRED")
            for owner, item in declarations.items():
                source = sources_by_id[item["source"]]
                tick = item["observed_at"]
                if source["owner"] != owner or type(tick) is not int or not 0 <= tick <= at:
                    raise StrictEconomicSourceBlocked("UNCOMMITTED_ORDER_INDEPENDENT_OWNER_SOURCE_REQUIRED")
                if owner in getattr(context, "prospective_subjects", set()) and not any(
                        e.get("action") == "subject_registration_apply" and e.get("outcome") == "APPLIED"
                        and e.get("registered_original_subject") == owner and e["at"] < tick
                        for e in state.trace):
                    raise StrictEconomicSourceBlocked("UNCOMMITTED_ORDER_OWNER_NOT_YET_REGISTERED")
                _qualify_original_event_evidence(owner, source["reference"], source["revision"],
                                                 _OWNER_CORES[state.subjects[owner].kind], tick)
                qualified_uncommitted_owners += 1
            observation = uncommitted["recipient_no_order_observation"]
            source = sources_by_id[observation["source"]]
            tick = observation["at"]
            if source["owner"] != candidate.customer or type(tick) is not int or not 0 <= tick <= at:
                raise StrictEconomicSourceBlocked("UNCOMMITTED_ORDER_RECIPIENT_SOURCE_REQUIRED")
            _qualify_original_event_evidence(candidate.customer, source["reference"], source["revision"],
                                             _OWNER_CORES[state.subjects[candidate.customer].kind], tick)
        except (KeyError, TypeError, StrictEconomicSourceBlocked) as exc:
            raise StrictEconomicSourceBlocked("UNCOMMITTED_ORDER_ORIGINAL_HISTORICAL_SCOPE_NOT_QUALIFIED") from exc

    qualified_market_owners = 0
    market_order = original_claims.get("market_order_economics")
    if market_order is not None:
        try:
            selected_work = market_order["work"]
            declarations = market_order["owner_scopes"]
            if selected_work not in work_ids or not isinstance(declarations, dict) or len(declarations) > 128:
                raise StrictEconomicSourceBlocked("MARKET_ORDER_SOURCE_SCOPE_INVALID")
            selected = state.works[selected_work]
            production_owners = state.capacity_ledger.original_owners(selected.resource_requirements)
            principals = production_owners | {state.institution.operator}
            for owner, item in declarations.items():
                if owner not in principals:
                    raise StrictEconomicSourceBlocked("MARKET_ORDER_ORIGINAL_OWNER_REQUIRED")
                source = sources_by_id[item["source"]]
                tick = item["observed_at"]
                if source["owner"] != owner or type(tick) is not int or not 0 <= tick <= at:
                    raise StrictEconomicSourceBlocked("MARKET_ORDER_INDEPENDENT_OWNER_SOURCE_REQUIRED")
                if owner in getattr(context, "prospective_subjects", set()) and not any(
                        e.get("action") == "subject_registration_apply" and e.get("outcome") == "APPLIED"
                        and e.get("registered_original_subject") == owner and e["at"] < tick
                        for e in state.trace):
                    raise StrictEconomicSourceBlocked("MARKET_ORDER_OWNER_NOT_YET_REGISTERED")
                _qualify_original_event_evidence(owner, source["reference"], source["revision"],
                                                 _OWNER_CORES[state.subjects[owner].kind], tick)
                qualified_market_owners += 1
        except (KeyError, TypeError, StrictEconomicSourceBlocked) as exc:
            raise StrictEconomicSourceBlocked("MARKET_ORDER_ORIGINAL_OWNER_HISTORICAL_SOURCE_NOT_QUALIFIED") from exc

    portfolio = original_claims.get("portfolio_scope_evidence")
    qualified_portfolio_owners = 0
    if portfolio is not None:
        try:
            scopes = portfolio["owner_scopes"]
            if (not isinstance(work_id, tuple) or not isinstance(portfolio["works"], list)
                    or not set(portfolio["works"]) <= set(work_ids)
                    or not isinstance(scopes, dict) or set(scopes) != set(state.subjects)):
                raise StrictEconomicSourceBlocked("PORTFOLIO_ORIGINAL_FIXED_SCOPE_REQUIRED")
            for owner, item in scopes.items():
                source = sources_by_id[item["source"]]
                tick = item["observed_at"]
                if source["owner"] != owner or type(tick) is not int or not 0 <= tick <= at:
                    raise StrictEconomicSourceBlocked("PORTFOLIO_ORIGINAL_OWNER_SOURCE_REQUIRED")
                if owner in getattr(context, "prospective_subjects", set()) and not any(
                        e.get("action") == "subject_registration_apply" and e.get("outcome") == "APPLIED"
                        and e.get("registered_original_subject") == owner and e["at"] < tick
                        for e in state.trace):
                    raise StrictEconomicSourceBlocked("PORTFOLIO_OWNER_NOT_YET_REGISTERED")
                _qualify_original_event_evidence(owner, source["reference"], source["revision"],
                                                 _OWNER_CORES[state.subjects[owner].kind], tick)
                qualified_portfolio_owners += 1
        except (KeyError, TypeError, StrictEconomicSourceBlocked) as exc:
            raise StrictEconomicSourceBlocked("PORTFOLIO_ORIGINAL_OWNER_HISTORICAL_SCOPE_NOT_QUALIFIED") from exc
    return {
        "status": "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED",
        **({"source_scoped_original_portfolio_owner_count": qualified_portfolio_owners}
           if portfolio is not None else {}),
        **({"original_commercial_order_payment_terms_matched_count": qualified_commercial_orders}
           if qualified_commercial_orders else {}),
        **({"source_scoped_uncommitted_order_owner_count": qualified_uncommitted_owners,
            "source_scoped_uncommitted_recipient_observation": True}
           if uncommitted is not None else {}),
        **({"source_scoped_market_order_owner_count": qualified_market_owners}
           if market_order is not None else {}),
        **({"source_scoped_original_recipient_value_count": qualified_recipient_values}
           if value_rows else {}),
        "original_source_count": len(seen),
        **({"original_strict_work_scope_count": len(work_ids)}
           if isinstance(work_id, tuple) else {}),
        "covered_original_subject_count": len(covered),
        "all_original_work_principals_have_own_sources": True,
        "source_scoped_original_payment_event_count": qualified_payment_events,
        "source_scoped_original_cost_event_count": qualified_original_cost_events,
        "source_scoped_independent_payment_owner_witness_count": (
            qualified_owner_witnesses
        ),
        "payment_witnesses_checked_at_declared_time": True,
        "historical_event_revision_replayed_in_original_KPB": True,
        "current_original_read_right_checked_separately": True,
        "future_source_claims_cannot_precede_model_horizon": True,
        "payment_witnesses_are_not_bank_settlement": True,
        "original_work_and_source_scope_preserved": True,
        "economic_input_not_new_ledger_or_consent": True,
        **({"outside_work_original_offer_purchase_transfer_price_matched": True}
           if outside_price_qualified else {}),
        "source_review_does_not_verify_actual_cost_or_bank_settlement": True,
        "member_private_cash_values_or_source_refs_redisclosed": False,
        "measured_network_additionality": "NOT_IDENTIFIABLE",
    }
