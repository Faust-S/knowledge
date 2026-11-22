"""R2: reconcile owner-declared splits of EXISTING original common economic rows.

This is an attribution VIEW of the one existing economic_claims ledger.
It does not create expenses, move money, certify accounting, prove a driver,
or grant a firm another participant's source/decision authority.

Initially, common inter-party transfers are deliberately unsupported: allocating
one party's internal payment also requires the other party's independent proof.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re
from typing import Any, Mapping

class CommonAllocationError(ValueError):
    pass

SCENARIOS = ("COOPERATION", "INDEPENDENT_ALTERNATIVE")
TYPES = ("TRANSFER", "RESOURCE_USE")
FIELDS = frozenset({
    "record_id", "record_type", "scenario", "work", "owner", "amount",
    "source", "source_revision", "driver_ref",
})
AMOUNT = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?\Z")


def _name(v: Any, label: str) -> str:
    if not isinstance(v, str) or not v or len(v) > 180:
        raise CommonAllocationError(f"COMMON_ALLOCATION_{label}_INVALID")
    return v


def _amount(v: Any) -> Decimal:
    if not isinstance(v, str) or not AMOUNT.fullmatch(v):
        raise CommonAllocationError("COMMON_ALLOCATION_AMOUNT_INVALID")
    value = Decimal(v)
    if value <= 0:
        raise CommonAllocationError("COMMON_ALLOCATION_AMOUNT_MUST_BE_POSITIVE")
    return value


def review_common_work_allocations(
    raw: Any, *, sources: Mapping[str, Any],
    transfer_index: Mapping[str, Any], resource_index: Mapping[str, Any],
    works: Mapping[str, Any],
) -> dict[str, Any]:
    if not isinstance(raw, list) or len(raw) > 2048:
        raise CommonAllocationError("COMMON_ALLOCATION_INVALID_LIST")
    records: dict[str, tuple[str, Mapping[str, Any]]] = {
        **{key: ("TRANSFER", value) for key, value in transfer_index.items()},
        **{key: ("RESOURCE_USE", value) for key, value in resource_index.items()},
    }
    by_record: dict[str, list[dict[str, str]]] = {}
    by_work: dict[str, dict[str, dict[str, dict[str, str]]]] = {}
    sums: dict[str, Decimal] = {}
    seen: set[tuple[str, str]] = set()
    for claim in raw:
        if not isinstance(claim, dict) or set(claim) != FIELDS:
            raise CommonAllocationError("COMMON_ALLOCATION_FIELDS_INVALID")
        rid = _name(claim["record_id"], "RECORD_ID")
        kind = claim["record_type"]
        sc = claim["scenario"]
        work = _name(claim["work"], "WORK")
        owner = _name(claim["owner"], "OWNER")
        source_id = _name(claim["source"], "SOURCE")
        revision = _name(claim["source_revision"], "SOURCE_REVISION")
        driver = _name(claim["driver_ref"], "DRIVER")
        value = _amount(claim["amount"])
        if rid not in records or kind not in TYPES or sc not in SCENARIOS:
            raise CommonAllocationError("COMMON_ALLOCATION_ORIGINAL_RECORD_UNKNOWN")
        record_type, record = records[rid]
        if record_type != kind or record["scenario"] != sc or record["work"] is not None:
            raise CommonAllocationError("COMMON_ALLOCATION_ONLY_ORIGINAL_COMMON_ROW")
        if work not in works:
            raise CommonAllocationError("COMMON_ALLOCATION_ORIGINAL_WORK_UNKNOWN")
        if (rid, work) in seen:
            raise CommonAllocationError("COMMON_ALLOCATION_DUPLICATE_RECORD_WORK")
        seen.add((rid, work))
        if kind == "TRANSFER":
            # Do not assign an internal payment without a signed proof from
            # both original parties, which is not yet part of this M2 record.
            if record["payer"] != "EXTERNAL" and record["payee"] != "EXTERNAL":
                raise CommonAllocationError("COMMON_ALLOCATION_INTERNAL_TRANSFER_NEEDS_BOTH_PRINCIPALS")
            actual_owner = (record["payee"] if record["payer"] == "EXTERNAL"
                            else record["payer"])
        else:
            actual_owner = record["owner"]
        if owner != actual_owner:
            raise CommonAllocationError("COMMON_ALLOCATION_ORIGINAL_OWNER_MISMATCH")
        source = sources.get(source_id)
        if source is None or source["owner"] != owner or source["revision"] != revision:
            raise CommonAllocationError("COMMON_ALLOCATION_OWNER_SOURCE_REVISION_MISMATCH")
        if not driver.startswith(f"model://{owner}/"):
            raise CommonAllocationError("COMMON_ALLOCATION_OWNER_DRIVER_SOURCE_MISMATCH")
        new_sum = sums.get(rid, Decimal(0)) + value
        if new_sum > record["decimal_amount"]:
            raise CommonAllocationError("COMMON_ALLOCATION_EXCEEDS_ORIGINAL_AMOUNT")
        sums[rid] = new_sum
        by_record.setdefault(rid, []).append({
            "work": work, "scenario": sc, "owner": owner,
            "amount": f"{value:.2f}", "source": source_id,
            "source_revision": revision, "driver_ref": driver,
        })
        by_work.setdefault(work, {}).setdefault(sc, {}).setdefault(kind, {})[rid] = f"{value:.2f}"
    remainders = {
        key: f"{row['decimal_amount'] - sums.get(key, Decimal(0)):.2f}"
        for key, (kind, row) in records.items()
        if row["work"] is None
    }
    return {
        "evidence": "MODEL_ONLY_ORIGINAL_OWNER_ALLOCATION_NOT_AUDITED",
        "by_original_record": {k: by_record[k] for k in sorted(by_record)},
        "by_work": {w: by_work[w] for w in sorted(by_work)},
        "unallocated_remainders": dict(sorted(remainders.items())),
        "original_common_records_seen": sum(
            row["work"] is None for _kind, row in records.values()
        ),
        "fully_attributed_common_original_records": sum(
            Decimal(value) == 0 for value in remainders.values()
        ),
        "new_cash_or_cost_records_created": 0,
        "model_only_no_real_cost_driver_verified": True,
        "entire_source_ledger_unmodified": True,
        "internal_transfer_allocation_not_qualified": True,
        "cash_and_noncash_not_summed_into_profit": True,
    }
