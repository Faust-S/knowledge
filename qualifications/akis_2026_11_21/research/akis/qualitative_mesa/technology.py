"""Source-declared multi-operation production plan within one AKIS work.

This is a bounded MODEL_ONLY process decomposition, not a production optimizer,
measured duration, accepted Result, or alternative event scheduler.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .capacity import ResourceNeed, Reservation, parse_resource_needs, CapacityInputError

MAX_OPERATIONS = 32  # bounded input handling, not a scientific capacity limit


class TechnologyInputError(ValueError):
    """Invalid source-declared operation graph."""


@dataclass(frozen=True)
class Operation:
    key: str
    primary_resource: str
    requires_completed: tuple[str, ...]
    resource_requirements: tuple[ResourceNeed, ...]
    slot_start: int
    slot_end: int


def _id(v: Any, label: str) -> str:
    if not isinstance(v, str) or not v.strip() or len(v) > 128:
        raise TechnologyInputError(f"INVALID_{label.upper()}")
    return v


def parse_operations(
    raw: Any, *, work_primary: str, work_start: int, work_end: int,
    resources: Mapping[str, str],
) -> tuple[Operation, ...]:
    """Validate a DAG and planned precedence; no inferred logistics or duration."""
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_OPERATIONS:
        raise TechnologyInputError("INVALID_OPERATION_LIST")
    ops: dict[str, Operation] = {}
    expected_fields = {"id", "primary_resource", "requires_completed",
                       "resource_requirements", "slot_start", "slot_end"}
    for row in raw:
        if not isinstance(row, dict) or set(row) != expected_fields:
            raise TechnologyInputError("INVALID_OPERATION_FIELDS")
        oid = _id(row["id"], "operation_id")
        if oid in ops:
            raise TechnologyInputError("DUPLICATE_OPERATION")
        primary = _id(row["primary_resource"], "operation_resource")
        if primary not in resources:
            raise TechnologyInputError("UNKNOWN_OPERATION_RESOURCE")
        start, end = row["slot_start"], row["slot_end"]
        if (type(start) is not int or type(end) is not int or
                start < work_start or end > work_end or start >= end):
            raise TechnologyInputError("INVALID_OPERATION_SLOT")
        predecessors = row["requires_completed"]
        if (not isinstance(predecessors, list) or len(predecessors) > MAX_OPERATIONS or
                any(not isinstance(x, str) or not x.strip() or len(x) > 128 for x in predecessors)):
            raise TechnologyInputError("INVALID_OPERATION_PREDECESSORS")
        if len(set(predecessors)) != len(predecessors):
            raise TechnologyInputError("DUPLICATE_OPERATION_PREDECESSOR")
        if oid in predecessors:
            raise TechnologyInputError("OPERATION_SELF_DEPENDENCY")
        try:
            needs = parse_resource_needs(row, primary, resources)
        except CapacityInputError as exc:
            raise TechnologyInputError(str(exc)) from exc
        ops[oid] = Operation(oid, primary, tuple(predecessors), needs, start, end)
    if not any(any(need.resource == work_primary for need in op.resource_requirements)
               for op in ops.values()):
        raise TechnologyInputError("WORK_PRIMARY_MUST_BE_IN_OPERATIONS")
    visited: set[str] = set()
    active: set[str] = set()

    def check(key: str) -> None:
        if key in active:
            raise TechnologyInputError("CYCLIC_OPERATION_DEPENDENCY")
        if key in visited:
            return
        active.add(key)
        op = ops[key]
        for pred in op.requires_completed:
            if pred not in ops:
                raise TechnologyInputError("UNKNOWN_OPERATION_PREDECESSOR")
            check(pred)
        active.remove(key)
        visited.add(key)
    for oid in sorted(ops):
        check(oid)
    for op in ops.values():
        for pred in op.requires_completed:
            if ops[pred].slot_end > op.slot_start:
                raise TechnologyInputError("OPERATION_PLAN_PRECEDENCE_CONFLICT")
    return tuple(ops[key] for key in sorted(ops))


def owners_summary(operations: Sequence[Operation]) -> tuple[ResourceNeed, ...]:
    """Owner enumeration only: max declared demand per resource, not booking."""
    units: dict[str, int] = {}
    for op in operations:
        for n in op.resource_requirements:
            units[n.resource] = max(units.get(n.resource, 0), n.units)
    return tuple(ResourceNeed(key, qty) for key, qty in sorted(units.items()))


def operation_reservations(work: str, operations: Sequence[Operation]) -> tuple[Reservation, ...]:
    """Reserve each operation's planned interval; parallel operations may overlap."""
    return tuple(Reservation(n.resource, work, op.slot_start, op.slot_end, n.units)
                 for op in operations for n in op.resource_requirements)


def technology_view(operations: Sequence[Operation], states: Mapping[str, str],
                    evidence: Mapping[str, str], owners: Mapping[str, str]) -> dict[str, Any]:
    original_owners = sorted({owners[n.resource] for op in operations
                              for n in op.resource_requirements})
    return {
        "evidence": "MODEL_ONLY", "planned_time": "SYMBOLIC_SEPARATE_FROM_EVENT_CLOCK",
        "physical_productivity": "NOT_IDENTIFIABLE",
        "resource_summary_role": "OWNER_ENUMERATION_NOT_WHOLE_WORK_RESERVATION",
        "original_resource_owners": original_owners,
        "cross_owner_capability_structure": ("MULTIPLE_ORIGINAL_OWNERS" if len(original_owners) > 1
                                            else "SINGLE_ORIGINAL_OWNER"),
        "operations": [
            {"id": op.key, "primary_resource": op.primary_resource,
             "declared_performer_owner": owners[op.primary_resource],
             "requires_completed": list(op.requires_completed),
             "slot_start": op.slot_start, "slot_end": op.slot_end,
             "resource_requirements": [{"resource": n.resource, "units": n.units}
                                       for n in op.resource_requirements],
             "execution": states[op.key], "model_evidence": evidence.get(op.key)}
            for op in operations
        ],
    }
