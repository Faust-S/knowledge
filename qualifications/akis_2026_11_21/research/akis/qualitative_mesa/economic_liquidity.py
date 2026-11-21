"""One-ledger time and liquidity projection for AKIS independent principals.

All money comes from EXISTING economic_claims.transfers: no synthetic loans,
cost rates, discount, new settlement, work or economic value. Owner-scoped
opening/reserve positions are model assertions, not audited bank balances.
Time is an integer research index, NOT a confirmed bank statement timestamp.
"""
from __future__ import annotations

from decimal import Decimal
import re
from typing import Any, Mapping

class LiquidityInputError(ValueError):
    """Invalid owner-scoped, nonbinding projected cash timing."""

_MONEY = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?\Z")
_SCENARIOS = ("COOPERATION", "INDEPENDENT_ALTERNATIVE")

def _name(v: Any, error: str) -> str:
    if not isinstance(v, str) or not v or len(v) > 128:
        raise LiquidityInputError(error)
    return v

def _money(v: Any) -> Decimal:
    if not isinstance(v, str) or not _MONEY.fullmatch(v):
        raise LiquidityInputError("INVALID_LIQUIDITY_AMOUNT")
    return Decimal(v)

def _at(v: Any, horizon: int) -> int:
    if type(v) is not int or not 0 <= v <= horizon:
        raise LiquidityInputError("INVALID_LIQUIDITY_TIME")
    return v

def _as_str(value: Decimal) -> str:
    return f"{value:.2f}"

def _bounds(
    opening: Decimal, events: list[tuple[int, Decimal]], reserve: Decimal,
) -> dict[str, str]:
    """Best/worst attainable minimum within an unresolved same-time tick.

    Conservative accounting: if an incoming and outgoing payment are only
    time-stamped at the same step, the model cannot assume receipt before pay.
    """
    groups: dict[int, list[Decimal]] = {}
    for at, value in events:
        groups.setdefault(at, []).append(value)
    balance = opening
    low = opening
    high = opening
    for at in sorted(groups):
        debits = sum((v for v in groups[at] if v < 0), Decimal("0"))
        credits = sum((v for v in groups[at] if v > 0), Decimal("0"))
        low = min(low, balance + debits)
        balance += credits + debits
        high = min(high, balance)
    if high < reserve:
        status = "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
    elif low >= reserve:
        status = "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    else:
        status = "SAME_TICK_SETTLEMENT_ORDER_NOT_QUALIFIED"
    return {
        "status": status,
        "minimum_before_unverified_same_tick_inflows": _as_str(low),
        "maximum_possible_minimum_if_same_tick_receipts_first": _as_str(high),
        "end_of_horizon_cash_from_declared_transfers": _as_str(balance),
        "reserve_cash": _as_str(reserve),
    }

def evaluate_cash_timing(
    raw: Any, *, sources: Mapping[str, Mapping[str, Any]],
    transfer_index: Mapping[str, Mapping[str, Any]],
    coverage: Mapping[str, Mapping[str, str]], subjects: Mapping[str, Any],
    outside: Mapping[str, str],
) -> dict[str, Any]:
    """Calculate only a SOURCE-DECLARED, owner-scoped liquidity conditional.

    - Both internal principals independently attest transfer timing with an
      ORIGINAL source owned by each; external party has no modelled attestation.
    - Only existing transfers carry signed cash. Resource uses never become
      cash a second time, nor does a stock of opening cash become system income.
    - Shortfalls are research constraints, not legal insolvency or a bank fact.
    - Late dates must themselves be supplied; no random delay, credit or rate.
    """
    if not isinstance(raw, dict) or set(raw) != {
        "horizon_end", "owner_positions", "transfer_windows",
    }:
        raise LiquidityInputError("INVALID_LIQUIDITY_FIELDS")
    horizon = raw["horizon_end"]
    if type(horizon) is not int or not 0 <= horizon <= 10000:
        raise LiquidityInputError("INVALID_LIQUIDITY_HORIZON")
    positions = raw["owner_positions"]
    settlements = raw["transfer_windows"]
    if (not isinstance(positions, list) or len(positions) > 128
            or not isinstance(settlements, list) or len(settlements) > 4096):
        raise LiquidityInputError("INVALID_LIQUIDITY_RECORD_COUNT")
    owner_state: dict[str, tuple[Decimal, Decimal]] = {}
    for p in positions:
        if not isinstance(p, dict) or set(p) != {
            "owner", "source", "opening_cash", "reserve_cash",
        }:
            raise LiquidityInputError("INVALID_OWNER_POSITION_FIELDS")
        owner = _name(p["owner"], "INVALID_LIQUIDITY_OWNER")
        src = _name(p["source"], "INVALID_LIQUIDITY_SOURCE")
        if owner not in subjects or owner in owner_state:
            raise LiquidityInputError("INVALID_OR_DUPLICATE_LIQUIDITY_OWNER")
        if src not in sources or sources[src]["owner"] != owner:
            raise LiquidityInputError("LIQUIDITY_POSITION_SOURCE_NOT_OWNER_SCOPED")
        owner_state[owner] = (_money(p["opening_cash"]), _money(p["reserve_cash"]))

    windows: dict[str, tuple[int, int]] = {}
    for row in settlements:
        if (not isinstance(row, dict) or
            set(row) not in ({"transfer_id", "at", "owner_sources"},
                            {"transfer_id", "at", "late_at", "owner_sources"})):
            raise LiquidityInputError("INVALID_TRANSFER_WINDOW_FIELDS")
        transfer_id = _name(row["transfer_id"], "INVALID_LIQUIDITY_TRANSFER")
        original = transfer_index.get(transfer_id)
        if original is None or transfer_id in windows:
            raise LiquidityInputError("UNKNOWN_OR_DUPLICATE_ORIGINAL_TRANSFER_WINDOW")
        at = _at(row["at"], horizon)
        late = _at(row.get("late_at", at), horizon)
        if late < at:
            raise LiquidityInputError("LATE_DATE_BEFORE_EXPECTED_DATE")
        parties = {original["payer"], original["payee"]} - {"EXTERNAL"}
        owners = row["owner_sources"]
        if not isinstance(owners, dict) or set(owners) != parties:
            raise LiquidityInputError("INDEPENDENT_TIMING_ATTESTATIONS_REQUIRED")
        for owner, source in owners.items():
            src = _name(source, "INVALID_LIQUIDITY_SOURCE")
            if src not in sources or sources[src]["owner"] != owner:
                raise LiquidityInputError("TRANSFER_WINDOW_SOURCE_NOT_OWNER_SCOPED")
        original_source = original["source"]
        original_owner = sources[original_source]["owner"]
        if owners[original_owner] != original_source:
            raise LiquidityInputError("ORIGINAL_TRANSFER_SOURCE_MUST_REMAIN_ATTACHED")
        windows[transfer_id] = at, late

    per_owner: dict[str, Any] = {}
    scoped_counts = {"qualified_reserve_both_scenarios": 0,
                     "known_gap_in_either_scenario": 0,
                     "incomplete_time_or_initial_balance": 0,
                     "same_tick_order_unresolved": 0}
    for owner in sorted(subjects):
        outcome: dict[str, Any] = {}
        for scenario in _SCENARIOS:
            originals = [(key, rec) for key, rec in transfer_index.items()
                         if rec["scenario"] == scenario
                         and owner in {rec["payer"], rec["payee"]}]
            if owner not in owner_state:
                outcome[scenario] = {"status": "OPENING_POSITION_NOT_SOURCE_DECLARED"}
            elif owner not in coverage[scenario]:
                outcome[scenario] = {"status": "FULL_CASH_SCOPE_NOT_SOURCE_DECLARED"}
            elif any(key not in windows for key, _ in originals):
                outcome[scenario] = {"status": "INCOMPLETE_ORIGINAL_TRANSFER_TIMING"}
            else:
                opening, reserve = owner_state[owner]
                expected: list[tuple[int, Decimal]] = []
                stress: list[tuple[int, Decimal]] = []
                for key, rec in originals:
                    amount = rec["decimal_amount"]
                    signed = amount if rec["payee"] == owner else -amount
                    at, late_at = windows[key]
                    expected.append((at, signed))
                    stress.append((late_at, signed))
                outcome[scenario] = {
                    "status": "SOURCE_DECLARED_TIMING_ARITHMETIC_ONLY",
                    "expected": _bounds(opening, expected, reserve),
                    "declared_late_case": _bounds(opening, stress, reserve),
                    "original_transfer_count": len(originals),
                    "all_counterparty_time_sources_source_declared": True,
                }
        states = [outcome[sc] for sc in _SCENARIOS]
        if any(row["status"] != "SOURCE_DECLARED_TIMING_ARITHMETIC_ONLY"
               for row in states):
            verdict = "INCOMPLETE_LIQUIDITY_EVIDENCE"
            scoped_counts["incomplete_time_or_initial_balance"] += 1
        elif any(row[k]["status"] == "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
                 for row in states for k in ("expected", "declared_late_case")):
            verdict = "DECLARED_LIQUIDITY_GAP_IN_ONE_OR_MORE_CASES"
            scoped_counts["known_gap_in_either_scenario"] += 1
        elif any(row[k]["status"] == "SAME_TICK_SETTLEMENT_ORDER_NOT_QUALIFIED"
                 for row in states for k in ("expected", "declared_late_case")):
            verdict = "LIQUIDITY_DEPENDS_ON_UNVERIFIED_SAME_TICK_ORDER"
            scoped_counts["same_tick_order_unresolved"] += 1
        elif outside.get(owner) != "FEASIBLE_DECLARED":
            verdict = "TIMED_CASH_PATHS_BUT_INDEPENDENT_OUTSIDE_OPTION_NOT_QUALIFIED"
            scoped_counts["incomplete_time_or_initial_balance"] += 1
        else:
            verdict = "DECLARED_LIQUIDITY_RESERVE_MET_FOR_BOTH_ALTERNATIVES"
            scoped_counts["qualified_reserve_both_scenarios"] += 1
        per_owner[owner] = {
            "status": verdict,
            "scenario_paths": outcome,
            "owner_scope_only": True,
            "real_bank_balance_verified": False,
            "legal_payment_completed": False,
            "comparison_of_real_options_proven": False,
        }
    return {
        "evidence": "MODEL_ONLY_ORIGINAL_CASH_FLOW_AND_OWNER_TIMING_DECLARATIONS",
        "horizon_end": horizon,
        "scenarios": list(_SCENARIOS),
        "per_original_owner_private_research_projection": per_owner,
        "cross_owner_nonfinancial_status_counts": scoped_counts,
        "original_transfer_records_referenced": len(windows),
        "original_transfer_record_count": len(transfer_index),
        "missing_transfer_window_count": len(transfer_index) - len(windows),
        "no_invented_credit_or_finance_cost": True,
        "stock_of_cash_not_treated_as_network_income": True,
        "original_money_and_resource_uses_unchanged": True,
        "real_liquidity_and_payments_not_authenticated": True,
        "operator_cash_position_is_independent": True,
    }
