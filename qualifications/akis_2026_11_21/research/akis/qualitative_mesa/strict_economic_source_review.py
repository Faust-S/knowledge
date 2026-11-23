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
    seen: set[str] = set()
    covered: set[str] = set()
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
    return {
        "status": "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED",
        "original_source_count": len(seen),
        "covered_original_subject_count": len(covered),
        "all_original_work_principals_have_own_sources": True,
        "original_work_and_source_scope_preserved": True,
        "economic_input_not_new_ledger_or_consent": True,
        "source_review_does_not_verify_actual_cost_or_bank_settlement": True,
        "member_private_cash_values_or_source_refs_redisclosed": False,
        "measured_network_additionality": "NOT_IDENTIFIABLE",
    }
