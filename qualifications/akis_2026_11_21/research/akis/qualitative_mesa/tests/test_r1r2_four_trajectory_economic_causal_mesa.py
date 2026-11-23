"""R1/R2: four competing original Work paths under one economic source set.

This is an explicit attempt to falsify an unwarranted conclusion: positive
source-declared Work cash difference is NOT proof of new accepted Result,
realized network value, or unilateral operator authority.

All four trials run the exact SAME original Mesa and economic source claims.
Only original independent actions and one explicit availability shock differ.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.comparative_trajectories import (
    TrajectoryComparisonError, compare_original_trajectories,
)
from research.akis.qualitative_mesa.mesa_model import simulate

from .test_work_counterfactual_mesa import counterfactual_case


def original_four_trajectory_inputs():
    baseline = counterfactual_case()
    baseline["endogenous_subjects"] = True
    baseline["model_horizon"] = max(baseline["model_horizon"], 29)
    baseline["decision_profiles"] = [
        {
            "subject": owner, "work": "w2",
            "source_revision": "d2", "org_revision": "oc-1",
            "willingness": "WILLING", "outside_option":
                "COOPERATION_PREFERRED",
        }
        for owner in ("b", "c")
    ]
    scenarios = {
        name: deepcopy(baseline)
        for name in (
            "accepted_cooperation", "independent_refusal",
            "capacity_unavailable", "result_not_accepted",
        )
    }
    refusal = scenarios["independent_refusal"]
    for profile in refusal["decision_profiles"]:
        if profile["subject"] == "b":
            profile["outside_option"] = "OUTSIDE_PREFERRED"
    refusal["events"] = [
        row for row in refusal["events"]
        if not (row["action"] == "consent"
                and row.get("work") == "w2"
                and row["actor"] == "b")
    ]

    disruption = scenarios["capacity_unavailable"]
    for row in disruption["events"]:
        if row["at"] >= 19:
            row["at"] += 1
    disruption["events"].append({
        "at": 19, "action": "resource_status", "actor": "b",
        "resource": "rb", "availability": "UNAVAILABLE",
    })
    disruption["events"].sort(key=lambda row: row["at"])

    withheld = scenarios["result_not_accepted"]
    withheld["events"] = [
        row for row in withheld["events"]
        if not (row["action"] == "accept" and row.get("work") == "w2")
    ]
    for label, scenario in scenarios.items():
        assert len({row["at"] for row in scenario["events"]}) == len(
            scenario["events"]
        ), label
    return scenarios


def original_four_trajectory_run():
    scenarios = original_four_trajectory_inputs()
    copy = deepcopy(scenarios)
    outputs = {name: simulate(scenario) for name, scenario in scenarios.items()}
    assert scenarios == copy
    review = compare_original_trajectories(
        scenarios, outputs, pilot_work="w1", next_work="w2",
    )
    return scenarios, outputs, review


def test_four_original_trajectories_diverge_without_inventing_network_profit():
    scenarios, outputs, review = original_four_trajectory_run()
    assert len(scenarios) == len(outputs) == len(review["trials"]) == 4
    by_name = {row["trial"]: row for row in review["trials"]}
    assert {
        name: row["original_next_work_result"]
        for name, row in by_name.items()
    } == {
        "accepted_cooperation": "ACCEPTED_BY_ORIGINAL_RECIPIENT",
        "independent_refusal": "NOT_SUBMITTED",
        "capacity_unavailable": "NOT_SUBMITTED",
        "result_not_accepted": "SUBMITTED",
    }
    assert review["accepted_next_work_count"] == 1
    assert review["observed_divergent_work_results"]
    assert review["historical_pilot_result_unchanged"]
    assert review["source_declared_economic_inputs_held_constant"]
    assert review["realized_caused_network_gain"] == "NOT_IDENTIFIABLE"
    assert review["actual_profit"] == "UNKNOWN"
    assert all(row["observed_realized_cash_gain"] is None for row in review["trials"])
    assert all(row["observed_causal_network_value"] is None for row in review["trials"])
    assert all(
        out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
        for out in outputs.values()
    )
    assert all(
        out["profit"]["system_increment"] == "UNKNOWN"
        for out in outputs.values()
    )
    # The same earlier ownership and original cash source rows are preserved;
    # economic claims cannot become booked income through interpretation.
    assert {
        out["economics"]["consolidated_external_cash_from_claims"][
            "COOPERATION"
        ] for out in outputs.values()
    } == {"270.00"}


def test_original_independent_refusal_not_automatically_signed_by_mesa_agent():
    _, outputs, review = original_four_trajectory_run()
    negative = outputs["independent_refusal"]
    assert negative["works"]["w2"]["consenting_principals"] == ["c"]
    assert negative["works"]["w2"]["result"] == "NOT_SUBMITTED"
    assert any(
        row["action"] == "commit"
        and row["outcome"] == "BLOCKED"
        and row["reason"] == "INDEPENDENT_ACCEPTANCE_MISSING"
        for row in negative["trace"]
    )
    assert review["independent_choices_create_no_automatic_original_consents"]
    # One original economic owner's outside preference remains only a
    # nonbinding Mesa-agent observation, never a fabricated legal signature.
    assert any(
        row["status"] == "INDEPENDENT_REFUSAL_PREVENTS_REVIEW_CONSENSUS"
        for row in negative["endogenous_subjects"]["read_only_evolution"]
    )


def test_same_original_work_cannot_commit_after_owner_resource_shock():
    _, outputs, review = original_four_trajectory_run()
    interrupted = outputs["capacity_unavailable"]
    assert interrupted["works"]["w2"]["result"] == "NOT_SUBMITTED"
    assert any(
        row["action"] == "resource_status"
        and row["outcome"] == "APPLIED"
        and row["resource"] == "rb"
        for row in interrupted["trace"]
    )
    assert any(
        row["action"] == "commit"
        and row["reason"] == "RESOURCE_NOT_AVAILABLE"
        for row in interrupted["trace"]
    )
    assert next(
        row for row in review["trials"]
        if row["trial"] == "capacity_unavailable"
    )["accepted_by_original_recipient"] is False


def test_no_new_acceptance_means_submitted_not_realized_benefit():
    _, outputs, review = original_four_trajectory_run()
    out = outputs["result_not_accepted"]
    assert out["works"]["w2"]["result"] == "SUBMITTED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert not any(
        row["action"] == "accept" and row["work"] == "w2"
        for row in out["trace"]
    )
    accepted = next(
        row for row in review["trials"]
        if row["trial"] == "accepted_cooperation"
    )
    unfinished = next(
        row for row in review["trials"]
        if row["trial"] == "result_not_accepted"
    )
    assert accepted["accepted_by_original_recipient"]
    assert not unfinished["accepted_by_original_recipient"]
    assert unfinished["observed_realized_cash_gain"] is None


def test_comparator_refuses_to_compare_different_money_or_initial_owners():
    scenarios, outputs, _ = original_four_trajectory_run()
    for mutate in (
        lambda d: d["economic_claims"]["transfers"][0].update(
            amount="999.00"
        ),
        lambda d: d["subjects"][0].update(kind="SME"),
        lambda d: d["work_counterfactuals"][0]["equivalence"].update(
            quality=False
        ),
    ):
        bad = deepcopy(scenarios)
        mutate(bad["independent_refusal"])
        with pytest.raises(
            TrajectoryComparisonError,
            match="COMPARATIVE_BASELINE_OR_ECONOMIC_SOURCES_CHANGED",
        ):
            compare_original_trajectories(
                bad, outputs, pilot_work="w1", next_work="w2",
            )


def test_comparator_rejects_retroactive_fabricated_prior_result():
    scenarios, outputs, _ = original_four_trajectory_run()
    altered = deepcopy(outputs)
    altered["independent_refusal"]["works"]["w1"][
        "result_ref"
    ] = "model://unrelated-after-transfer"
    with pytest.raises(
        TrajectoryComparisonError,
        match="COMPARATIVE_HISTORICAL_RESULT_CHANGED_BY_INTERVENTION",
    ):
        compare_original_trajectories(
            scenarios, altered, pilot_work="w1", next_work="w2",
        )
