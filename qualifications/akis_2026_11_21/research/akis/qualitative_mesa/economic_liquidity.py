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


def _joint_network_settlement(
    *, owner_state: Mapping[str, tuple[Decimal, Decimal]],
    windows: Mapping[str, tuple[int, int]],
    transfer_index: Mapping[str, Mapping[str, Any]],
    coverage: Mapping[str, Mapping[str, str]],
    subjects: Mapping[str, Any], outside: Mapping[str, str],
    settlement_splits: Mapping[str, list[tuple[int, Decimal]]] | None = None,
    agreed_installments: Mapping[str, list[Mapping[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Optional read-only coherent settlement *hypothesis* on the same ledger.

    For each original internal transfer, sender and recipient post at the
    SAME declared date. This reconciles the network's cash conservation at
    every model tick, but never asserts that a delayed debtor is legally
    allowed to postpone an original due obligation. Its posted schedule
    must be compared with the existing owner-private due-date adverse stress.
    """
    scenarios: dict[str, Any] = {}
    all_owners = set(subjects)
    for scenario in _SCENARIOS:
        original = [(key, row) for key, row in sorted(transfer_index.items())
                    if row["scenario"] == scenario]
        missing_positions = all_owners - set(owner_state)
        missing_coverage = all_owners - set(coverage[scenario])
        missing_windows = {key for key, _row in original if key not in windows}
        if missing_positions or missing_coverage or missing_windows:
            scenarios[scenario] = {
                "status": "NETWORK_JOINT_SETTLEMENT_SCOPE_INCOMPLETE",
                "missing_original_owner_positions_count": len(missing_positions),
                "missing_owner_coverage_count": len(missing_coverage),
                "missing_original_transfer_windows_count": len(missing_windows),
                "unverified_values_not_imputed_as_zero": True,
            }
            continue

        # The same original internal transfer_id produces exactly two
        # opposite entries in this projected NETWORK timeline, at one tick.
        variants = (
            ("expected", "late", "claim_adjusted_expected")
            if settlement_splits is not None else ("expected", "late")
        )
        events = {
            variant: {owner: [] for owner in sorted(all_owners)}
            for variant in variants
        }
        by_tick: dict[str, dict[int, dict[str, Decimal]]] = {
            variant: {} for variant in variants
        }
        internal_original_count = 0
        for key, row in original:
            amount = row["decimal_amount"]
            at, late = windows[key]
            payer, payee = row["payer"], row["payee"]
            if payer != "EXTERNAL" and payee != "EXTERNAL":
                internal_original_count += 1
            installments = (agreed_installments or {}).get(key)
            postings = (
                [(variant, item[field], Decimal(item["amount"]))
                 for item in installments
                 for variant, field in (("expected", "at"), ("late", "late_at"))]
                if installments else [("expected", at, amount), ("late", late, amount)])
            if settlement_splits is not None:
                pieces = settlement_splits.get(key, [(at, amount)])
                if (not pieces or
                    sum((portion for _, portion in pieces), Decimal(0)) != amount or
                    any(type(tick) is not int or portion <= 0
                        for tick, portion in pieces)):
                    raise LiquidityInputError("PAYMENT_PROGRESS_ORIGINAL_AMOUNT_CONSERVATION_FAILED")
                postings.extend(
                    ("claim_adjusted_expected", tick, portion)
                    for tick, portion in pieces
                )
            for variant, tick, posted in postings:
                owner_tick = by_tick[variant].setdefault(
                    tick, {"internal": Decimal(0), "external": Decimal(0),
                           "sum_owner": Decimal(0)}
                )
                if payer != "EXTERNAL":
                    events[variant][payer].append((tick, -posted))
                    owner_tick["sum_owner"] -= posted
                if payee != "EXTERNAL":
                    events[variant][payee].append((tick, posted))
                    owner_tick["sum_owner"] += posted
                if payer != "EXTERNAL" and payee != "EXTERNAL":
                    owner_tick["internal"] -= posted
                    owner_tick["internal"] += posted
                elif payer == "EXTERNAL":
                    owner_tick["external"] += posted
                else:
                    owner_tick["external"] -= posted

        # A single global settlement timetable cannot create network money
        # by an internal transfer or break an external cash boundary at
        # any individual tick, not merely at the end of the period.
        for variant in variants:
            for balances in by_tick[variant].values():
                if (balances["internal"] != 0 or
                        balances["sum_owner"] != balances["external"]):
                    raise LiquidityInputError("JOINT_NETWORK_CASH_CONSERVATION_FAILED")

        owner_details: dict[str, Any] = {}
        for owner in sorted(all_owners):
            opening, reserve = owner_state[owner]
            owner_details[owner] = {
                "expected": _bounds(opening, events["expected"][owner], reserve),
                "joint_posted_late_case": _bounds(
                    opening, events["late"][owner], reserve
                ),
                "this_is_not_permission_to_defer_the_owner_payables": True,
                "real_bank_balance_not_verified": True,
            }
            if settlement_splits is not None:
                owner_details[owner]["claim_adjusted_expected"] = _bounds(
                    opening, events["claim_adjusted_expected"][owner], reserve
                )
        expected_external = sum(
            (row["external"] for row in by_tick["expected"].values()),
            Decimal(0),
        )
        late_external = sum(
            (row["external"] for row in by_tick["late"].values()),
            Decimal(0),
        )
        scenarios[scenario] = {
            "status": "SOURCE_DECLARED_JOINT_SETTLEMENT_ARITHMETIC_ONLY",
            "per_original_owner_private_research_projection": owner_details,
            "original_transfer_count": len(original),
            "internal_original_transfer_count": internal_original_count,
            "internal_cash_nets_to_zero_at_every_tick": True,
            "sum_owner_cash_changes_equals_original_external_cash_at_every_tick": True,
            "expected_original_external_cash_delta": _as_str(expected_external),
            "late_original_external_cash_delta": _as_str(late_external),
            "all_original_internal_party_cash_posted_at_the_same_tick": True,
            "model_time_not_a_verified_bank_settlement_date": True,
        }
        if settlement_splits is not None:
            scenarios[scenario]["claim_adjusted_original_money_conserved_per_tick"] = True
            scenarios[scenario]["claim_adjusted_splits_original_transfer_not_new_money"] = True
            scenarios[scenario]["claim_adjusted_bank_payment_verified"] = False
            scenarios[scenario]["independent_outside_option_not_credited_with_cooperation_payments"] = True

    if any(v["status"] != "SOURCE_DECLARED_JOINT_SETTLEMENT_ARITHMETIC_ONLY"
           for v in scenarios.values()):
        comparability = "INCOMPLETE_NETWORK_SETTLEMENT_SCOPE"
    elif any(outside.get(owner) != "FEASIBLE_DECLARED" for owner in all_owners):
        comparability = "OUTSIDE_OPTION_NOT_SOURCE_QUALIFIED_FOR_EVERY_OWNER"
    else:
        comparability = "TWO_DECLARED_NETWORK_SETTLEMENT_SCOPES_NOT_CAUSAL_VALUE"

    return {
        "evidence": "MODEL_ONLY_ONE_ORIGINAL_TRANSFER_ONE_JOINT_POSTING_DATE",
        "scenarios": scenarios,
        "network_comparability": comparability,
        "same_original_internal_transfer_only_one_joint_date": True,
        "joint_posting_does_not_reschedule_original_legal_due_dates": True,
        "individual_due_date_stress_remains_independently_required": True,
        "bank_settlement_or_legal_extension_verified": False,
        "no_extra_cash_or_financing_created": True,
        "legal_payment_or_owner_consent_created": False,
        "private_owner_opening_cash_reserve_and_paths_not_member_shareable": True,
        "network_value_added_and_actual_profit": "NOT_IDENTIFIABLE",
    }


def evaluate_cash_timing(
    raw: Any, *, sources: Mapping[str, Mapping[str, Any]],
    transfer_index: Mapping[str, Mapping[str, Any]],
    coverage: Mapping[str, Mapping[str, str]], subjects: Mapping[str, Any],
    outside: Mapping[str, str],
    original_payment_due: Mapping[str, int] | None = None,
    settlement_splits: Mapping[str, list[tuple[int, Decimal]]] | None = None,
    agreed_installments: Mapping[str, list[Mapping[str, Any]]] | None = None,
    network_scale: bool = False,
) -> dict[str, Any]:
    """Calculate only a SOURCE-DECLARED, owner-scoped liquidity conditional.

    - Both internal principals independently attest transfer timing with an
      ORIGINAL source owned by each; external party has no modelled attestation.
    - Only existing transfers carry signed cash. Resource uses never become
      cash a second time, nor does a stock of opening cash become system income.
    - Shortfalls are research constraints, not legal insolvency or a bank fact.
    - Late receipts are adverse to the owner; current contractual outflow
      obligations stay at their expected date in the owner's stress view.
      The stress is owner-specific, NOT a single joint settlement forecast.
    - Late dates must themselves be supplied; no random delay, credit or rate.
    """
    if not isinstance(raw, dict) or set(raw) != {
        "horizon_end", "owner_positions", "transfer_windows",
    }:
        raise LiquidityInputError("INVALID_LIQUIDITY_FIELDS")
    horizon = raw["horizon_end"]
    if type(horizon) is not int or not 0 <= horizon <= (3_000_000 if network_scale else 10000):
        raise LiquidityInputError("INVALID_LIQUIDITY_HORIZON")
    positions = raw["owner_positions"]
    settlements = raw["transfer_windows"]
    if (not isinstance(positions, list)
            or len(positions) > (100_001 if network_scale else 128)
            or not isinstance(settlements, list)
            or len(settlements) > (2_000_000 if network_scale else 4096)):
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

    # These schedules have already passed the original commercial and
    # independent receipt source review. Recheck money conservation here;
    # no scheduled amount can be added to the original transfer total.
    for key, parts in (agreed_installments or {}).items():
        if (key not in transfer_index or key not in windows or not parts
                or sum((_money(p["amount"]) for p in parts), Decimal(0))
                    != transfer_index[key]["decimal_amount"]
                or any(_money(p["amount"]) <= 0
                       or _at(p["at"], horizon) > _at(p["due_at"], horizon)
                       or p["at"] > _at(p["late_at"], horizon) for p in parts)
                or (settlement_splits or {}).get(key)
                    != [(p["at"], _money(p["amount"])) for p in parts]):
            raise LiquidityInputError("ORIGINAL_INSTALLMENT_CASH_CONSERVATION_OR_EVIDENCE_FAILED")
    # Index each original transfer by actual payer/payee once. Preserve
    # independent owner cash trajectories without scanning the whole ledger.
    owner_transfers: dict[tuple[str, str], list] = {}
    for key, record in transfer_index.items():
        for owner in {record["payer"], record["payee"]} - {"EXTERNAL"}:
            owner_transfers.setdefault((owner, record["scenario"]), []).append((key, record))
    per_owner: dict[str, Any] = {}
    scoped_counts = {"qualified_reserve_both_scenarios": 0,
                     "known_gap_in_either_scenario": 0,
                     "incomplete_time_or_initial_balance": 0,
                     "same_tick_order_unresolved": 0}
    for owner in sorted(subjects):
        outcome: dict[str, Any] = {}
        for scenario in _SCENARIOS:
            originals = owner_transfers.get((owner, scenario), ())
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
                    installments = (agreed_installments or {}).get(key)
                    if installments:
                        for item in installments:
                            part = _money(item["amount"]) * (1 if signed > 0 else -1)
                            expected.append((item["at"], part))
                            stress.append((item["late_at"] if part > 0
                                           else min(item["at"], item["due_at"]), part))
                        continue
                    expected.append((at, signed))
                    # Critical invariant: late receivables do not silently
                    # postpone a participant's payable obligations. Moving
                    # both sides to late_at could manufacture solvency for
                    # an operator even though suppliers are still due today.
                    # Original Work-specific due is a conservative constraint:
                    # neither a forecast nor an unverified term change grants
                    # permission to postpone this original payable.
                    due_at = (original_payment_due or {}).get(key, at)
                    stress.append((
                        late_at if signed > 0 else min(at, due_at), signed
                    ))
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
        # The two alternatives are distinct individual options, not a
        # combined network balance. Do not label cooperative feasibility
        # equivalent to a more/less favourable outside option.
        coop_path = outcome["COOPERATION"]
        alt_path = outcome["INDEPENDENT_ALTERNATIVE"]
        if any(path["status"] != "SOURCE_DECLARED_TIMING_ARITHMETIC_ONLY"
               for path in (coop_path, alt_path)):
            classification = "INCOMPLETE_INDIVIDUAL_LIQUIDITY_COMPARISON"
        elif outside.get(owner) != "FEASIBLE_DECLARED":
            classification = "OUTSIDE_ALTERNATIVE_FEASIBILITY_NOT_QUALIFIED"
        else:
            left = coop_path["declared_late_case"]["status"]
            right = alt_path["declared_late_case"]["status"]
            gap = "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
            met = "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
            if left == gap and right == met:
                classification = "COOPERATION_DECLARED_GAP_WHILE_OUTSIDE_RESERVE_MET"
            elif left == met and right == gap:
                classification = "COOPERATION_DECLARED_RESERVE_MET_WHILE_OUTSIDE_GAP"
            elif left == gap and right == gap:
                classification = "BOTH_ALTERNATIVES_DECLARED_LIQUIDITY_GAP"
            elif left == met and right == met:
                classification = "BOTH_ALTERNATIVES_DECLARED_RESERVE_MET"
            else:
                classification = "SETTLEMENT_ORDER_PREVENTS_LIQUIDITY_COMPARISON"
        per_owner[owner] = {
            "status": verdict,
            "original_owner_liquidity_comparison": {
                "classification": classification,
                "model_cooperation_stress": (
                    coop_path.get("declared_late_case", {}).get("status", "NOT_IDENTIFIABLE")
                ),
                "model_independent_stress": (
                    alt_path.get("declared_late_case", {}).get("status", "NOT_IDENTIFIABLE")
                ),
                "individual_owner_alternatives_not_pooled": True,
                "independent_alternative_real_feasibility_verified": False,
                "positive_net_cash_is_not_liquidity_proof": True,
                "late_receipts_not_assumed_to_postpone_outgoing_obligations": True,
                "stress_paths_not_joint_network_settlement_scenario": True,
                "real_bank_payment_capacity_and_lending_not_proven": True,
            },
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
        "adverse_receipts_late_obligations_due_in_owner_private_stress": True,
        "per_owner_stress_is_not_one_simultaneously_consistent_network_schedule": True,
        "outside_comparison_is_not_actual_profit_or_legal_consent": True,
        **({"original_agreed_installment_transfer_count": len(agreed_installments),
            "owner_and_joint_expected_paths_use_same_original_installments": True,
            "late_receipt_hypothesis_does_not_defer_original_installment_payables": True}
           if agreed_installments else {}),
        "joint_network_settlement": _joint_network_settlement(
            owner_state=owner_state, windows=windows,
            transfer_index=transfer_index, coverage=coverage,
            subjects=subjects, outside=outside,
            settlement_splits=settlement_splits,
            agreed_installments=agreed_installments,
        ),
    }
