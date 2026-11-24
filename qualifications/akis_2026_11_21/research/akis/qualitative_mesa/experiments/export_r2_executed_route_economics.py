"""Redacted deterministic experiment for two independently executed routes.

Only directions, statuses and counts are exported. Local research reports
contain synthetic per-owner cash and source-scoped costs, not shared data.
"""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.tests.test_r2_executed_route_economics_mesa import (
    compare, paired_economics, OUTSIDE,
)


def direction(value):
    exact = Decimal(value)
    return "POSITIVE" if exact > 0 else "NEGATIVE" if exact < 0 else "ZERO"


def export_executed_route_economics():
    assert mesa.__version__ == "3.5.2"
    trials = {
        "supplier_cash_positive": paired_economics(cooperative_price="1200.00"),
        "supplier_cash_neutral": paired_economics(cooperative_price="1050.00"),
        "supplier_cash_negative": paired_economics(cooperative_price="900.00"),
        "outside_result_not_accepted": paired_economics(),
        "missing_cost_scope": paired_economics(),
        "missing_cost_anchor": paired_economics(),
    }
    d = trials["outside_result_not_accepted"]["outside"]
    d["events"] = [
        row for row in d["events"]
        if not (row.get("work") == OUTSIDE and row["action"] == "accept")
    ]
    for d in trials["missing_cost_scope"].values():
        del d["economic_claims"]["lifecycle_costs"]["scope_proofs"]["COOPERATION"]["b"]
    trials["missing_cost_anchor"]["outside"]["economic_claims"]["lifecycle_costs"][
        "event_bindings"].pop()
    reports = []
    for label, docs in sorted(trials.items()):
        report = compare(docs)
        private = report.pop("local_research_only")
        delta = private["boundary_and_cost_contrast"]
        owner_delta = private["original_owner_contrasts"]
        report["trial"] = label
        if delta is not None:
            report["declared_boundary_and_cost_directions"] = {
                key: direction(value) for key, value in sorted(delta.items())
            }
            report["supplier_declared_cash_direction"] = direction(
                owner_delta["a"]["cash_cooperation_minus_outside"])
            report["operator_reserve_risk_in_declared_late_case"] = (
                private["original_owner_projections"]["cooperation"]["op"][
                    "late_receipt_liquidity"]
                == "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
            )
        else:
            report["declared_boundary_and_cost_directions"] = None
            report["supplier_declared_cash_direction"] = "UNKNOWN"
        reports.append(report)
    by = {row["trial"]: row for row in reports}
    for label, expected in (
        ("supplier_cash_positive", "POSITIVE"),
        ("supplier_cash_neutral", "ZERO"),
        ("supplier_cash_negative", "NEGATIVE"),
    ):
        assert by[label]["supplier_declared_cash_direction"] == expected
    assert all(by[label]["declared_boundary_and_cost_directions"] is None
               for label in ("outside_result_not_accepted", "missing_cost_scope", "missing_cost_anchor"))
    manifest = {
        "schema": "AKIS_R2_EXECUTED_ROUTE_REDACTED_ECONOMICS/1.0",
        "engine": "MESA_3_5_2",
        "trials": reports,
        "private_owner_amounts_and_source_references_excluded": True,
        "no_cash_and_noncash_addition": True,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }
    payload = json.dumps(manifest, sort_keys=True, ensure_ascii=False,
                         indent=2, allow_nan=False) + "\n"
    assert "model://" not in payload
    assert "original_owner_contrasts" not in payload
    path = Path(__file__).resolve().parent / "r2_executed_route_economics_evidence.json"
    path.write_text(payload, encoding="utf-8")
    return path, sha256(payload.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    path, digest = export_executed_route_economics()
    print(f"AKIS_R2_EXECUTED_ROUTE_ECONOMICS_SHA256={digest}")
    print(f"AKIS_R2_EXECUTED_ROUTE_ECONOMICS_JSON={path}")
