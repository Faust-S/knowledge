"""Bounded material assertions on the existing AKIS work/handoff events.

Every asserted quantity, owner, source and timestamp is MODEL_ONLY. A reported
external reference is not an authenticated original or evidence of delivery.
No material store, title registry, scheduler, or second Result is created.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
import re
from typing import Any, Mapping, Sequence

from .handoff import Handoff

_AMOUNT = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?\Z")
MAX_BATCHES = 128  # input bound, not a physical model assumption
MAX_MATERIAL_ROUNDS = 16  # bounded research input, not a physical constraint


class MaterialInputError(ValueError):
    """An incomplete or ambiguous research lot declaration."""


class MaterialBlocked(Exception):
    """An event cannot change the existing work's material state."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def _identifier(value: Any, reason: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise MaterialInputError(reason)
    return value


def amount(value: Any, *, reason: str, allow_zero: bool = False) -> Decimal:
    if not isinstance(value, str) or _AMOUNT.fullmatch(value) is None:
        raise MaterialBlocked(reason)
    result = Decimal(value)
    if result < 0 or (result == 0 and not allow_zero):
        raise MaterialBlocked(reason)
    return result


@dataclass(frozen=True)
class MaterialBatch:
    key: str
    edge: tuple[str, str]
    material: str
    planned_quantity: Decimal
    unit: str
    declared_title_holder: str
    origin_source_owner: str
    origin_ref: str
    quality_spec_owner: str
    quality_spec_ref: str


@dataclass
class MaterialState:
    dispatched: Decimal | None = None
    received: Decimal | None = None
    accepted: Decimal | None = None
    rejected: Decimal | None = None
    dispatch_ref: str | None = None
    receipt_ref: str | None = None
    quality_ref: str | None = None
    dispatch_report: dict[str, Any] | None = None
    receipt_report: dict[str, Any] | None = None
    quality_report: dict[str, Any] | None = None
    replenishment_source_ref: str | None = None
    previous_rounds: list[dict[str, Any]] = field(default_factory=list)

    def current_round(self) -> dict[str, Any]:
        return {key: getattr(self, key) for key in (
            "dispatched", "received", "accepted", "rejected",
            "dispatch_ref", "receipt_ref", "quality_ref",
            "dispatch_report", "receipt_report", "quality_report",
            "replenishment_source_ref")}

    def all_rounds(self) -> list[dict[str, Any]]:
        return [*self.previous_rounds, self.current_round()]

    def observed_total(self, field_name: str) -> Decimal | None:
        known = [row[field_name] for row in self.all_rounds()
                 if row[field_name] is not None]
        return sum(known, Decimal(0)) if known else None

    def archive_for_replenishment(self) -> None:
        # Called only after the entire original edge has been validated.
        self.previous_rounds.append(self.current_round())
        for key in self.current_round():
            setattr(self, key, None)

    def evidence_references(self) -> set[str]:
        return {row[key] for row in self.all_rounds()
                for key in ("dispatch_ref", "receipt_ref", "quality_ref",
                            "replenishment_source_ref") if row[key] is not None}


def parse_batches(raw: Any, handoffs: Sequence[Handoff],
                  known_subjects: Mapping[str, Any], principals: set[str],
                  *, strict: bool) -> tuple[MaterialBatch, ...]:
    """Bind batches to the exact existing cross-site/owner handoff edges.

    The declared title holder and both source issuers must be ORIGINAL parties;
    this is a conservative model gate, not a finding of actual legal title.
    """
    if not strict:
        if raw is not None:
            raise MaterialInputError("MATERIAL_REQUIRES_STRICT_OPT_IN")
        return ()
    if not handoffs:
        if raw not in (None, []):
            raise MaterialInputError("MATERIAL_EDGE_NOT_REQUIRED")
        return ()
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_BATCHES:
        raise MaterialInputError("MATERIAL_BATCH_DECLARATION_REQUIRED")
    required = {"id", "from_operation", "to_operation", "material_id", "planned_quantity",
                "unit", "declared_title_holder", "origin_source_owner", "origin_ref",
                "quality_spec_owner", "quality_spec_ref"}
    valid_edges = {h.edge for h in handoffs}
    batches: list[MaterialBatch] = []
    identifiers: set[str] = set()
    for item in raw:
        if not isinstance(item, dict) or set(item) != required:
            raise MaterialInputError("INVALID_MATERIAL_BATCH_FIELDS")
        key = _identifier(item["id"], "INVALID_MATERIAL_BATCH_ID")
        if key in identifiers:
            raise MaterialInputError("DUPLICATE_MATERIAL_BATCH")
        identifiers.add(key)
        edge = (_identifier(item["from_operation"], "INVALID_MATERIAL_EDGE"),
                _identifier(item["to_operation"], "INVALID_MATERIAL_EDGE"))
        if edge not in valid_edges:
            raise MaterialInputError("MATERIAL_EDGE_NOT_REQUIRED")
        material = _identifier(item["material_id"], "INVALID_MATERIAL_ID")
        unit = _identifier(item["unit"], "INVALID_MATERIAL_UNIT")
        try:
            planned = amount(item["planned_quantity"], reason="INVALID_MATERIAL_QUANTITY")
        except MaterialBlocked as exc:
            raise MaterialInputError(exc.reason) from exc
        actors = tuple(_identifier(item[field], "INVALID_MATERIAL_SOURCE_OWNER")
                       for field in ("declared_title_holder", "origin_source_owner", "quality_spec_owner"))
        if any(actor not in known_subjects or actor not in principals for actor in actors):
            raise MaterialInputError("MATERIAL_ORIGINAL_PARTY_REQUIRED")
        refs = tuple(item[field] for field in ("origin_ref", "quality_spec_ref"))
        if any(not isinstance(ref, str) or not ref.startswith("model://") or
               len(ref) > 180 or len(ref) <= len("model://") for ref in refs):
            raise MaterialInputError("MATERIAL_MODEL_ONLY_SOURCE_REQUIRED")
        batches.append(MaterialBatch(key, edge, material, planned, unit,
                                     actors[0], actors[1], refs[0], actors[2], refs[1]))
    if {b.edge for b in batches} != valid_edges:
        raise MaterialInputError("MATERIAL_BATCH_FOR_EACH_HANDOFF_REQUIRED")
    return tuple(sorted(batches, key=lambda b: (b.edge, b.key)))


def quantities(raw: Any, batches: Sequence[MaterialBatch], edge: tuple[str, str],
               states: Mapping[str, MaterialState], *, dispatch: bool,
               replenishment: bool = False) -> dict[str, Decimal]:
    """Check all lots on one edge atomically, without changing their state."""
    eligible = {b.key: b for b in batches if b.edge == edge}
    if not isinstance(raw, list) or len(raw) != len(eligible):
        raise MaterialBlocked("MATERIAL_BATCH_QUANTITIES_REQUIRED")
    got: dict[str, Decimal] = {}
    for item in raw:
        if not isinstance(item, dict) or set(item) != {"batch", "quantity"}:
            raise MaterialBlocked("INVALID_MATERIAL_QUANTITY_CLAIM")
        key = item["batch"]
        if not isinstance(key, str) or key not in eligible or key in got:
            raise MaterialBlocked("MATERIAL_BATCH_MISMATCH")
        q = amount(item["quantity"], reason="INVALID_MATERIAL_QUANTITY",
                   allow_zero=not dispatch or replenishment)
        maximum = eligible[key].planned_quantity if dispatch else states[key].dispatched
        if dispatch and replenishment:
            maximum -= states[key].observed_total("accepted") or Decimal(0)
        if maximum is None or q > maximum:
            raise MaterialBlocked("MATERIAL_QUANTITY_EXCEEDS_DECLARATION")
        got[key] = q
    if got.keys() != eligible.keys():
        raise MaterialBlocked("MATERIAL_BATCH_MISMATCH")
    if replenishment and dispatch and not any(got.values()):
        raise MaterialBlocked("MATERIAL_REPLENISHMENT_POSITIVE_SHORTFALL_REQUIRED")
    return got


def event_report(ev: Mapping[str, Any]) -> dict[str, Any]:
    """Capture an attributed external-time assertion, never a verified t_fact."""
    time = ev.get("reported_actual_at")
    source = ev.get("reported_external_ref")
    if time is None and source is None:
        return {"reported_actual_at": None, "reported_external_ref": None,
                "source_verification": "NOT_OBSERVED"}
    if not isinstance(time, str) or not isinstance(source, str):
        raise MaterialBlocked("MATERIAL_REPORTED_FACT_SOURCE_REQUIRED")
    if (len(source) > 256 or not source.startswith(("urn:", "https://")) or
            source.startswith("urn:model:") or not source.strip()):
        raise MaterialBlocked("MATERIAL_REPORTED_EXTERNAL_REFERENCE_INVALID")
    try:
        timestamp = datetime.fromisoformat(time.replace("Z", "+00:00"))
        if timestamp.tzinfo is None or timestamp.utcoffset() is None:
            raise ValueError("timestamp must have timezone")
    except (ValueError, OverflowError) as exc:
        raise MaterialBlocked("MATERIAL_REPORTED_TIME_INVALID") from exc
    return {"reported_actual_at": timestamp.isoformat(), "reported_external_ref": source,
            "source_verification": "EXTERNAL_CLAIM_UNVERIFIED"}


def assert_reported_order(first: Mapping[str, Any] | None,
                          second: Mapping[str, Any]) -> None:
    if first is None or first["reported_actual_at"] is None or second["reported_actual_at"] is None:
        return
    a = datetime.fromisoformat(first["reported_actual_at"])
    b = datetime.fromisoformat(second["reported_actual_at"])
    if b < a:
        raise MaterialBlocked("MATERIAL_REPORTED_TIME_CONTRADICTION")


def assert_inbound_ready(batches: Sequence[MaterialBatch], states: Mapping[str, MaterialState],
                         operation: str) -> None:
    for batch in batches:
        if batch.edge[1] != operation:
            continue
        state = states[batch.key]
        if state.received is None or (state.observed_total("received") or Decimal(0)) < batch.planned_quantity:
            raise MaterialBlocked("MATERIAL_QUANTITY_SHORT")
        if state.accepted is None:
            raise MaterialBlocked("MATERIAL_QUALITY_NOT_ASSESSED")
        if (state.observed_total("accepted") or Decimal(0)) < batch.planned_quantity:
            raise MaterialBlocked("MATERIAL_QUALITY_INSUFFICIENT")


def material_view(batches: Sequence[MaterialBatch], states: Mapping[str, MaterialState]) -> dict[str, Any]:
    """Return claimed balances, explicitly unverified and not a second Result."""
    rows: list[dict[str, Any]] = []
    for batch in batches:
        state = states[batch.key]
        dispatched = state.observed_total("dispatched")
        received = state.observed_total("received")
        accepted = state.observed_total("accepted")
        rejected = state.observed_total("rejected")
        delta_transit = (dispatched - received
                         if state.dispatched is not None and state.received is not None else None)
        unqualified = (received - accepted - rejected
                       if state.received is not None and state.accepted is not None and state.rejected is not None
                       else None)
        round_view = {}
        if state.previous_rounds:
            def serialize_round(row):
                return {key: str(value) if isinstance(value, Decimal) else value
                        for key, value in row.items()}
            round_view = {
                "material_round_count": len(state.previous_rounds)+1,
                "original_material_rounds": [dict(round=index+1, **serialize_round(row))
                                             for index, row in enumerate(state.all_rounds())],
                "current_round_quality_complete": state.quality_ref is not None,
                "totals_are_cumulative_observed_claims_not_physical_inventory": True,
                "rejected_and_unreceived_quantities_not_converted_into_accepted": True,
            }
        rows.append({
            "batch": batch.key, "edge": list(batch.edge), "material_id": batch.material,
            "unit": batch.unit, "planned_quantity": str(batch.planned_quantity),
            "dispatched_quantity": str(dispatched) if dispatched is not None else None,
            "received_quantity": str(received) if received is not None else None,
            "accepted_quantity": str(accepted) if accepted is not None else None,
            "rejected_quantity": str(rejected) if rejected is not None else None,
            "unreceived_quantity": str(delta_transit) if delta_transit is not None else None,
            "unassessed_quantity": str(unqualified) if unqualified is not None else None,
            "declared_title_holder": batch.declared_title_holder,
            "origin_source_owner": batch.origin_source_owner, "origin_ref": batch.origin_ref,
            "quality_spec_owner": batch.quality_spec_owner, "quality_spec_ref": batch.quality_spec_ref,
            "dispatch_ref": state.dispatch_ref, "receipt_ref": state.receipt_ref,
            "quality_ref": state.quality_ref,
            "dispatch_report": state.dispatch_report, "receipt_report": state.receipt_report,
            "quality_report": state.quality_report,
            "readiness": ("ACCEPTED_MODEL_CLAIM" if state.accepted is not None and
                          accepted == batch.planned_quantity else "NOT_QUALIFIED"),
            **round_view,
        })
    return {"evidence": "MODEL_ONLY", "physical_proof": "NOT_AUTHENTICATED",
            "reported_actual_time": "EXTERNAL_CLAIM_UNVERIFIED_WHEN_SUPPLIED",
            "title_transfer": "NOT_INFERRED", "transport_cost": "NOT_IDENTIFIABLE",
            "result_role": "INTERNAL_STAGE_CLAIMS_NOT_ORIGINAL_WORK_RESULT",
            "batches": rows}



def original_unresolved_material_view(
    batches: Sequence[MaterialBatch], states: Mapping[str, MaterialState],
    operation_states: Mapping[str, str],
) -> dict[str, Any] | None:
    """Observe a retained, source-declared shortage before downstream start.

    Mere planning or absent initial receipt/quality is not an observed loss.
    A subsequent dispatched or received but not yet assessed round does not
    erase earlier reported quantities or establish final usable inventory.
    All quantities are the original model claims, not an inventory audit.
    """
    rows = {}
    for batch in batches:
        if operation_states.get(batch.edge[1]) != "NOT_STARTED":
            continue
        st = states[batch.key]
        received = st.observed_total("received")
        accepted = st.observed_total("accepted")
        rejected = st.observed_total("rejected")
        dispatched = st.observed_total("dispatched")
        shortage = ((received is not None and received < batch.planned_quantity)
                    or (accepted is not None and accepted < batch.planned_quantity))
        if not shortage or (st.quality_ref is not None and accepted == batch.planned_quantity):
            continue
        rows[batch.key] = {
            "unit": batch.unit,
            "planned_quantity": str(batch.planned_quantity),
            "cumulative_dispatched_quantity": str(dispatched) if dispatched is not None else None,
            "cumulative_received_claim_quantity": str(received) if received is not None else None,
            "cumulative_accepted_claim_quantity": str(accepted) if accepted is not None else None,
            "cumulative_rejected_claim_quantity": str(rejected) if rejected is not None else None,
            "quantity_remaining_to_qualified_requirement": (
                str(batch.planned_quantity-accepted) if accepted is not None else None),
            "cumulative_unreceived_quantity": (
                str(dispatched-received) if st.received is not None else None),
            "original_round_count": len(st.previous_rounds)+1,
            "current_round_receipt_declared": st.receipt_ref is not None,
            "current_round_quality_declared": st.quality_ref is not None,
            "original_downstream_not_started": True,
        }
    if not rows:
        return None
    return {
        "status": "MODEL_ORIGINAL_MATERIAL_REQUIREMENT_NOT_YET_QUALIFIED",
        "per_original_batch": rows,
        "original_prior_round_quantities_retained": True,
        "missing_assessment_is_not_zero_accepted_quantity": True,
        "physical_inventory_and_scrap_cost": "NOT_IDENTIFIABLE",
    }
