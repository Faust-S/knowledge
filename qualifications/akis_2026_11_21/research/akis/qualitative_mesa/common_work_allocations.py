"""Owner-scoped attribution of existing common money and resource rows (R2).

No new monetary ledger. Cross-enterprise payment attribution is possible
only with TWO separate original principals' model source declarations of an
identical amount for an identical Work and original payment. Their declarations
are NOT cryptographic signatures, settled invoices, or legal authorizations.
"""
from __future__ import annotations

from decimal import Decimal
import re
from typing import Any, Mapping


class CommonAllocationError(ValueError):
    """Source-scoped common row cannot be attributed to original Work."""


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
    """Read only. Original transfers/resource uses remain the only money rows.

    For a shared *internal* payment two independent original owner-source
    claims with equal amounts are required. They define ONE allocation amount,
    not the sum of both declarations. This preserves network consolidation.
    """
    if not isinstance(raw, list) or len(raw) > 2048:
        raise CommonAllocationError("COMMON_ALLOCATION_INVALID_LIST")
    records: dict[str, tuple[str, Mapping[str, Any]]] = {
        **{key: ("TRANSFER", value) for key, value in transfer_index.items()},
        **{key: ("RESOURCE_USE", value) for key, value in resource_index.items()},
    }
    by_record: dict[str, list[dict[str, Any]]] = {}
    by_work: dict[str, dict[str, dict[str, dict[str, str]]]] = {}
    sums: dict[str, Decimal] = {}
    seen: set[tuple[str, str, str]] = set()
    # group inter-party payment declarations before booking a single slice
    internal: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}

    def book(rid: str, work: str, sc: str, kind: str,
             amount: Decimal, record: Mapping[str, Any],
             evidence: dict[str, Any]) -> None:
        new_total = sums.get(rid, Decimal(0)) + amount
        if new_total > record["decimal_amount"]:
            raise CommonAllocationError("COMMON_ALLOCATION_EXCEEDS_ORIGINAL_AMOUNT")
        sums[rid] = new_total
        by_record.setdefault(rid, []).append(evidence)
        by_work.setdefault(work, {}).setdefault(sc, {}).setdefault(kind, {})[rid] = f"{amount:.2f}"

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
        if (rid, work, owner) in seen:
            raise CommonAllocationError("COMMON_ALLOCATION_DUPLICATE_ORIGINAL_PARTY")
        seen.add((rid, work, owner))

        if kind == "TRANSFER":
            if record["payer"] == "EXTERNAL":
                permitted = {record["payee"]}
            elif record["payee"] == "EXTERNAL":
                permitted = {record["payer"]}
            else:
                permitted = {record["payer"], record["payee"]}
        else:
            permitted = {record["owner"]}
        if owner not in permitted:
            raise CommonAllocationError("COMMON_ALLOCATION_ORIGINAL_OWNER_MISMATCH")
        source = sources.get(source_id)
        if source is None or source["owner"] != owner or source["revision"] != revision:
            raise CommonAllocationError("COMMON_ALLOCATION_OWNER_SOURCE_REVISION_MISMATCH")
        if not driver.startswith(f"model://{owner}/"):
            raise CommonAllocationError("COMMON_ALLOCATION_OWNER_DRIVER_SOURCE_MISMATCH")
        evidence = {
            "work": work, "scenario": sc, "owner": owner,
            "amount": f"{value:.2f}", "source": source_id,
            "source_revision": revision, "driver_ref": driver,
        }

        if kind == "TRANSFER" and len(permitted) == 2:
            internal.setdefault((rid, work), {})[owner] = evidence
        else:
            book(rid, work, sc, kind, value, record, evidence)

    paired_count = 0
    for rid, work in sorted(internal):
        claims = internal[(rid, work)]
        _kind, record = records[rid]
        expected_owners = {record["payer"], record["payee"]}
        if set(claims) != expected_owners:
            raise CommonAllocationError("COMMON_ALLOCATION_INTERNAL_TRANSFER_REQUIRES_BOTH_PRINCIPALS")
        payer, payee = record["payer"], record["payee"]
        payer_claim, payee_claim = claims[payer], claims[payee]
        if payer_claim["amount"] != payee_claim["amount"]:
            raise CommonAllocationError("COMMON_ALLOCATION_INTERNAL_PARTY_AMOUNT_MISMATCH")
        if record["source"] not in (payer_claim["source"], payee_claim["source"]):
            raise CommonAllocationError("COMMON_ALLOCATION_INTERNAL_ORIGINAL_SOURCE_NOT_ATTESTED")
        amount = Decimal(payer_claim["amount"])
        evidence = {
            "work": work, "scenario": record["scenario"],
            "amount": f"{amount:.2f}", "owner": payer,
            "original_payer": payer, "original_payee": payee,
            "original_party_source_claims": [payer_claim, payee_claim],
            "model_bilateral_only_not_a_legal_confirmation": True,
        }
        book(rid, work, record["scenario"], "TRANSFER", amount, record, evidence)
        paired_count += 1

    remainders = {
        key: f"{row['decimal_amount'] - sums.get(key, Decimal(0)):.2f}"
        for key, (_kind, row) in records.items() if row["work"] is None
    }
    return {
        "evidence": "MODEL_ONLY_ORIGINAL_OWNER_ALLOCATION_NOT_AUDITED",
        "by_original_record": {key: by_record[key] for key in sorted(by_record)},
        "by_work": {key: by_work[key] for key in sorted(by_work)},
        "unallocated_remainders": dict(sorted(remainders.items())),
        "original_common_records_seen": sum(
            row["work"] is None for _kind, row in records.values()
        ),
        "fully_attributed_common_original_records": sum(
            Decimal(remaining) == 0 for remaining in remainders.values()
        ),
        "model_bilateral_internal_transfer_slices": paired_count,
        "real_dual_signatures_verified": False,
        "original_both_parties_model_sources_required": True,
        "new_cash_or_cost_records_created": 0,
        "model_only_no_real_cost_driver_verified": True,
        "entire_source_ledger_unmodified": True,
        "internal_transfer_allocation_not_qualified": paired_count == 0,
        "cash_and_noncash_not_summed_into_profit": True,
    }
