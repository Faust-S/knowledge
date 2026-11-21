"""Time-qualified ORIGINAL context revisions for owner-private payment forecasts.

This module adds no source of money, no new transfer, no rights, and no new
Mesa/QualitativeAKIS event. A qualified original source_update may change one
owner's research expectation for ONE existing transfer, not the original
shared transfer, the other party's expectation or bank settlement.

All inputs, even CONFIRMED ContextBasis sources, remain synthetic MODEL_ONLY.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Mapping, Sequence


class ForecastRevisionInputError(ValueError):
    """An owner has not established the provenance for a forecast revision."""


@dataclass(frozen=True)
class OwnerForecastRevision:
    owner: str
    work: str
    source: str
    expected_before_revision: str
    new_source_revision: str
    effective_at: int
    transfer_id: str
    expected_at: int
    late_at: int


def _text(raw: Any, label: str) -> str:
    if not isinstance(raw, str) or not raw or len(raw) > 128:
        raise ForecastRevisionInputError("INVALID_FORECAST_" + label)
    return raw


def parse_forecast_revisions(
    raw: Any, *, state: Any, original_money: Mapping[str, Any],
    owner_claims: Sequence[Any],
) -> tuple[OwnerForecastRevision, ...]:
    """Tie the optional forecast to an EXISTING owner's source_update event.

    This check is intentionally stricter than 'model://owner' strings.
    Source updates remain MODEL_ONLY input, not an authenticated bank event.
    """
    if not isinstance(raw, list) or len(raw) > 256:
        raise ForecastRevisionInputError("INVALID_FORECAST_REVISION_COUNT")
    if not raw:
        return ()
    if state.context_basis is None or not isinstance(original_money, dict):
        raise ForecastRevisionInputError("FORECAST_REVISION_REQUIRES_ORIGINAL_CONTEXT_AND_ECONOMICS")
    timing = original_money.get("cash_timing")
    if not isinstance(timing, dict):
        raise ForecastRevisionInputError("FORECAST_REVISION_REQUIRES_ORIGINAL_CASH_TIMING")
    transfers = {
        row.get("id"): row
        for row in original_money.get("transfers", ())
        if isinstance(row, dict) and isinstance(row.get("id"), str)
    }
    windows = {
        row.get("transfer_id"): row
        for row in timing.get("transfer_windows", ())
        if isinstance(row, dict)
    }
    horizon = timing.get("horizon_end")
    if type(horizon) is not int:
        raise ForecastRevisionInputError("FORECAST_REVISION_HORIZON_INVALID")
    original_events = {
        (event.get("at"), event.get("source"), event.get("actor"),
         event.get("new_revision"), event.get("status"))
        for event in state.events
        if event.get("action") == "source_update"
    }
    known_keys: set[tuple[str, str, str]] = set()
    updates: list[OwnerForecastRevision] = []
    for row in raw:
        required = {
            "owner", "work", "context_source", "expected_context_revision",
            "new_context_revision", "effective_at", "transfer_id",
            "expected_at", "late_at",
        }
        if not isinstance(row, dict) or set(row) != required:
            raise ForecastRevisionInputError("INVALID_FORECAST_REVISION_FIELDS")
        owner = _text(row["owner"], "OWNER")
        work_id = _text(row["work"], "WORK")
        source = _text(row["context_source"], "CONTEXT_SOURCE")
        previous = _text(row["expected_context_revision"], "SOURCE_REVISION")
        revision = _text(row["new_context_revision"], "NEW_SOURCE_REVISION")
        transfer = _text(row["transfer_id"], "ORIGINAL_TRANSFER")
        at, expected, late = (row["effective_at"], row["expected_at"], row["late_at"])
        if (any(type(t) is not int for t in (at, expected, late))
                or not 0 <= at <= expected <= late <= horizon):
            raise ForecastRevisionInputError("FORECAST_REVISION_TIMES_INVALID")
        work = state.works.get(work_id)
        if work is None:
            raise ForecastRevisionInputError("FORECAST_REVISION_UNKNOWN_ORIGINAL_WORK")
        principals = (state.capacity_ledger.original_owners(work.resource_requirements)
                      | {work.customer})
        if owner not in principals or not any(
            claim.owner == owner and claim.work == work_id
            and claim.available_at <= at < claim.expires_at
            and claim.work_revision == work.source_revision
            and claim.org_revision == state.institution.revision
            for claim in owner_claims
        ):
            raise ForecastRevisionInputError("FORECAST_REVISION_REQUIRES_CURRENT_ORIGINAL_OWNER_CLAIM")
        current = state.context_basis.sources.get(source)
        requirement = state.context_basis.requirements.get((work_id, "interest_update"))
        if (current is None or current.owner != owner or owner not in current.usable_by
                or current.revision != previous or revision == previous
                or requirement is None or source not in requirement.sources
                or requirement.expected_revisions[requirement.sources.index(source)] != revision):
            raise ForecastRevisionInputError("FORECAST_REVISION_CONTEXT_OWNERSHIP_OR_SCOPE_MISMATCH")
        if (at, source, owner, revision, "CONFIRMED") not in original_events:
            raise ForecastRevisionInputError("FORECAST_REVISION_REQUIRES_EXACT_ORIGINAL_SOURCE_EVENT")
        original = transfers.get(transfer)
        window = windows.get(transfer)
        if (original is None or window is None or owner not in {
                original.get("payer"), original.get("payee")}):
            raise ForecastRevisionInputError("FORECAST_REVISION_TRANSFER_NOT_ORIGINAL_OWNER_PAYMENT")
        parties = window.get("owner_sources", {})
        if not isinstance(parties, dict) or owner not in parties:
            raise ForecastRevisionInputError("FORECAST_REVISION_OWNER_TIMING_SOURCE_MISSING")
        key = (owner, work_id, transfer)
        if key in known_keys:
            # Explicitly reject a second, ambiguous revision of one owner's
            # same transfer until ordering/version semantics are established.
            raise ForecastRevisionInputError("FORECAST_REVISION_OVERLAPPING_OWNER_TRANSFER")
        known_keys.add(key)
        updates.append(OwnerForecastRevision(
            owner, work_id, source, previous, revision, at, transfer,
            expected, late,
        ))
    return tuple(sorted(updates, key=lambda x:(x.effective_at,x.owner,x.work,x.transfer_id)))


def private_forecast_override(
    revisions: Sequence[OwnerForecastRevision], *, owner: str, work: str,
    at: float, original_money: Mapping[str, Any], state: Any,
) -> dict[str, Any] | None:
    """Owner-only ephemeral projection; no external contract or new transfer.

    The ContextBasis source_update must have ACTUALLY APPLIED on the original
    research state, not just been proposed in events. A denied, expired,
    revoked, superseded or unauthorised context source is not evidence.
    """
    active = [
        r for r in revisions
        if r.owner == owner and r.work == work and r.effective_at <= at
    ]
    if not active:
        return None
    if state.context_basis is None:
        return None
    from .context_basis import ContextBlocked
    try:
        state.context_basis.assert_allowed(work, "interest_update", owner, int(at))
    except ContextBlocked:
        return None
    changed = []
    for row in active:
        current = state.context_basis.sources.get(row.source)
        if (current is None or current.owner != owner or current.status != "CONFIRMED"
                or current.revision != row.new_source_revision
                or owner not in current.usable_by):
            continue
        if not any(
            entry["outcome"] == "APPLIED" and entry["action"] == "source_update"
            and entry["at"] == row.effective_at and entry["actor"] == owner
            and entry["source"] == row.source
            for entry in state.trace
        ):
            continue
        changed.append(row)
    if not changed:
        return None
    # Copy is local to the requesting principal's evaluator. The global
    # research economic ledger and other owners' positions stay untouched.
    original = original_money.get("cash_timing", {})
    private = deepcopy(original)
    windows = {row["transfer_id"]:row for row in private["transfer_windows"]}
    for row in changed:
        window = windows[row.transfer_id]
        window["at"] = row.expected_at
        window["late_at"] = row.late_at
    return private
