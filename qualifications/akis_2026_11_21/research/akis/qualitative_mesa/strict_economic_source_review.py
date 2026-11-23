"""Strict-KPB review of ORIGINAL economic-claim sources in the SAME Mesa.

This is a permission check through the *existing* original ContextBasis,
not a second IAM, ledger, event stream, Work, monetary calculation or grant.
A source-declared cost or transfer does not become verified settlement.
"""
from __future__ import annotations

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


def review_original_strict_economic_sources(
    *, state: Any, original_claims: Mapping[str, Any],
    work_id: str, at: int,
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
    if not isinstance(work_id, str) or work_id not in state.works:
        raise StrictEconomicSourceBlocked(
            "ORIGINAL_ECONOMIC_WORK_MUST_EXIST"
        )
    if not isinstance(original_claims, Mapping):
        raise StrictEconomicSourceBlocked(
            "ORIGINAL_ECONOMIC_SOURCE_DOCUMENT_REQUIRED"
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
    work = state.works[work_id]
    principals = (
        state.capacity_ledger.original_owners(
            work.resource_requirements
        ) | {work.customer}
    )
    if not principals.issubset(covered):
        raise StrictEconomicSourceBlocked(
            "ORIGINAL_ECONOMIC_INDEPENDENT_PRINCIPAL_SOURCE_MISSING"
        )
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
                    or original_transfer.get("work") != work_id
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
        if (binding.get("work") != work_id
                or type(event_time) is not int
                or type(position) is not int
                or not 0 <= position < len(state.trace)
                or state.trace[position].get("outcome") != "APPLIED"
                or state.trace[position].get("work") != work_id
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

    return {
        "status": "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED",
        "original_source_count": len(seen),
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
        "source_review_does_not_verify_actual_cost_or_bank_settlement": True,
        "member_private_cash_values_or_source_refs_redisclosed": False,
        "measured_network_additionality": "NOT_IDENTIFIABLE",
    }
