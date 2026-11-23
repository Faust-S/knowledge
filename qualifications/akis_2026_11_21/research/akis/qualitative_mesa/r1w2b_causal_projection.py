"""R1-W2B: causal projection from the ORIGINAL Mesa 3.5.2 Work.

This is a read-only evidence adapter for comparing independently executing
research models. It does not add a Work, Resource, MaterialBatch, monetary
transfer, scheduled task, Result or decision source to original AKIS.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping

SCHEMA = "IWXA_AKIS_R1W2B_NATIVE_CAUSAL_PROJECTION/0.1"


def _money(value: Any) -> str:
    return f"{Decimal(str(value)):.2f}"


def _source_trace(state: Any, work_id: str) -> list[dict[str, Any]]:
    # Keep event time and future planned-slot time explicitly separate.
    return [
        {
            "at": entry["at"],
            "action": entry["action"],
            "actor": entry["actor"],
            "outcome": entry["outcome"],
        }
        for entry in state.trace if entry.get("work") == work_id
    ]


def _economic_revision(entry: Mapping[str, Any]) -> dict[str, Any]:
    lot = entry["lot"]
    return {
        "id": entry["id"],
        "status": entry["status"],
        "supersedes": entry.get("quality_revision_of"),
        "total_units": lot["total_units"],
        "produced_units": lot["produced_units"],
        "usable_units": lot["usable_units"],
        "remaining_units": lot["remaining_units"],
        "original_cost_claim_rub": _money(lot["original_cost_claim"]),
        "saved_resources_rub": _money(lot["reusable_resources"]),
        "future_cost_rub": _money(lot["future_resource_cost"]),
        "material_value_rub": _money(lot["material_value"]),
        "handling_claim_rub": _money(lot["handling_cost"]),
        "recovery_claim_rub": _money(lot["claim_amount"]),
        "recovery_cash_status": lot["cash_recovery"],
        "future_planned_window": entry["next_window"],
    }


def project_original_work(state: Any, work_id: str = "w1") -> dict[str, Any]:
    """Inspect existing state, never change or infer its physical or cash facts."""
    work = state.works[work_id]
    original_batches = [
        {
            "id": batch.key,
            "material_id": batch.material,
            "unit": batch.unit,
            "planned_units": int(batch.planned_quantity),
            "declared_title_holder": batch.declared_title_holder,
            "original_origin_ref": batch.origin_ref,
            "original_quality_spec_ref": batch.quality_spec_ref,
            "accepted_units": (
                int(work.material_states[batch.key].accepted)
                if work.material_states[batch.key].accepted is not None else None
            ),
        }
        for batch in sorted(work.material_batches, key=lambda batch: batch.key)
    ]
    revisions = [_economic_revision(row) for row in work.wip_amendments]
    projected_lots = [
        {
            "batch": row["material_batch"],
            "revision": row["amendment"],
            "status": row["status"],
            "custody_state": row["custody_state"],
            "received_holder": row["holder"],
            "observed_quality_units": row.get("observed_accepted_units"),
            "quality_ref": row.get("custody_quality_ref"),
        }
        for row in sorted(work.wip_lots, key=lambda x: (
                x["amendment"], x.get("material_batch") or ""))
    ]
    responsibility = [
        {
            "criterion": criterion.key,
            "original_owner": criterion.responsible_owner,
            "effective_owner": work.assurance_responsibilities.get(
                criterion.key, {},
            ).get("effective_owner", criterion.responsible_owner),
            "assessor": criterion.assessor,
            "method": criterion.method,
            "revision": work.assurance_responsibilities.get(
                criterion.key, {},
            ).get("wip_id"),
        }
        for criterion in sorted(work.assurance_criteria, key=lambda c: c.key)
    ]
    resource_reservations = [
        {
            "resource": row.resource,
            "start": row.start, "end": row.end, "units": row.units,
        }
        for row in state.capacity_ledger.reservations if row.work == work_id
    ]
    return {
        "schema": SCHEMA,
        "original_work_id": work_id,
        "original_work_resource": work.resource,
        "customer": work.customer,
        "original_planned_slot": [work.slot_start, work.slot_end],
        "operation_ids": [op.key for op in work.operations],
        "operation_states": dict(sorted(work.operation_states.items())),
        "effective_operation_resources": dict(sorted(
            work.wip_operation_active_resources.items()
        )),
        "result": work.result,
        "result_ref": work.result_ref,
        "accepted_by_original_customer": (
            work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
        ),
        "original_material_batches": original_batches,
        "physical_wip_lots": projected_lots,
        "wip_economic_revisions": revisions,
        "assurance_responsibility": responsibility,
        "same_original_capacity_reservations": resource_reservations,
        "trace": _source_trace(state, work_id),
        "money_evidence": {
            "wip_original_expense": "SOURCE_DECLARED_NOT_BANK_VERIFIED",
            "recovery_claim": "NOT_RECORDED_AS_CASH",
            "compensation_cash": "NOT_BOUND_TO_WIP_NATIVE_PAYMENT",
            "payment_settlement": "NOT_ESTABLISHED_BY_THIS_PROJECTION",
            "bank_payment_authenticated": False,
            "internal_transfer_is_not_network_profit": True,
        },
        "comparison_limits": {
            "event_at_is_not_planned_slot": True,
            "native_materials_are_distinct_batches": True,
            "native_assurance_uses_original_criteria": True,
            "no_false_actual_payment": True,
            "no_original_result_revision": True,
        },
    }
