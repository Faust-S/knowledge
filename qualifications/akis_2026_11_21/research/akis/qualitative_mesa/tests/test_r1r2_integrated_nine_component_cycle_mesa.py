"""R1/R2 integrated experiment: nine author components, one original Mesa.

All four arms begin with identical registered actors, source-scoped money
claims, Work and original context. Only independent acts or one original
capacity interruption change. No claimed bank payment becomes a fact.
"""
from copy import deepcopy
import json

import pytest

from research.akis.qualitative_mesa.comparative_trajectories import (
    TrajectoryComparisonError, compare_original_trajectories,
)
from research.akis.qualitative_mesa.integrated_nine_component_cycle import (
    COMPONENTS, IntegratedCycleError, original_nine_component_work_view,
)
from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel, simulate
from research.akis.qualitative_mesa.rules import InputError

from .test_r1u4_strict_original_source_rights_mesa import e
from .test_r1v2c2b_registered_subject_cooperation_work_mesa import _insert_before
from .test_r2_strict_original_payment_evidence_mesa import (
    scoped_bilateral_payment_case,
)


def integrated_nine_component_scenarios():
    baseline = scoped_bilateral_payment_case()
    scenarios = {
        name: deepcopy(baseline)
        for name in (
            "accepted",
            "independent_principal_refusal",
            "new_owner_capacity_unavailable",
            "customer_acceptance_withheld",
        )
    }
    refusal = scenarios["independent_principal_refusal"]
    refusal["events"] = [
        event for event in refusal["events"]
        if not (
            event["action"] == "consent"
            and event.get("work") == "w2"
            and event["actor"] == "b"
        )
    ]
    disrupted = scenarios["new_owner_capacity_unavailable"]
    _insert_before(
        disrupted["events"],
        lambda event: event["action"] == "commit"
        and event.get("work") == "w2",
        e(0, "resource_status", "c", resource="rc",
          availability="UNAVAILABLE"),
    )
    disrupted["events"].sort(key=lambda event: event["at"])
    withheld = scenarios["customer_acceptance_withheld"]
    withheld["events"] = [
        event for event in withheld["events"]
        if not (
            event["action"] == "accept"
            and event.get("work") == "w2"
        )
    ]
    for name, scenario in scenarios.items():
        assert len({item["at"] for item in scenario["events"]}) == len(
            scenario["events"]
        ), name
        scenario["model_horizon"] = max(
            104, scenario["model_horizon"],
            max(item["at"] for item in scenario["events"]) + 1,
        )
    return scenarios


def integrated_nine_component_run():
    scenarios = integrated_nine_component_scenarios()
    untouched = deepcopy(scenarios)
    outputs = {name: simulate(value) for name, value in scenarios.items()}
    assert scenarios == untouched
    comparison = compare_original_trajectories(
        scenarios, outputs, pilot_work="w1", next_work="w2",
    )
    views = {
        name: original_nine_component_work_view(output)
        for name, output in outputs.items()
    }
    return scenarios, outputs, comparison, views


def test_one_original_work_process_exhibits_four_nine_component_trajectories():
    scenarios, outputs, comparison, views = integrated_nine_component_run()
    assert len(scenarios) == len(outputs) == len(views) == 4
    assert comparison["accepted_next_work_count"] == 1
    assert comparison["observed_divergent_work_results"]
    assert comparison["source_declared_economic_inputs_held_constant"]
    assert comparison["historical_pilot_result_unchanged"]
    assert {
        name: view["difference_driver"] for name, view in views.items()
    } == {
        "accepted": "ACCEPTED_ORIGINAL_WORK_AND_RESULT",
        "independent_principal_refusal": "INDEPENDENT_PRINCIPAL_DID_NOT_CONSENT",
        "new_owner_capacity_unavailable": "ORIGINAL_RESOURCE_NOT_AVAILABLE",
        "customer_acceptance_withheld": "RECIPIENT_ACCEPTANCE_NOT_RECORDED",
    }
    for name, view in views.items():
        assert tuple(view["components"]) == COMPONENTS, name
        assert view["components"]["У"]["new_original_subject_registered"]
        assert view["components"]["У"]["new_cooperation_edition_applied"]
        assert view["components"]["КПБ"]["historical_event_rights_replayed"]
        assert view["components"]["КПБ"]["current_source_read_checked"]
        assert view["components"]["КЖ"]["pilot_result_accepted"]
        assert view["components"]["Э"]["original_payment_source_claim_events"] == 2
        assert view["components"]["Э"]["independent_source_witnesses"] == 4
        assert view["components"]["Э"]["verified_bank_settlement"] is False
        assert view["components"]["ЖЦ"]["previous_accepted_result_preserved"]
        assert view["realized_network_additionality"] == "NOT_IDENTIFIABLE"
        assert not view["all_nine_author_components_causally_closed"]
        assert outputs[name]["works"]["w1"]["result"] == (
            "ACCEPTED_BY_ORIGINAL_RECIPIENT"
        )


def test_independent_claimed_payments_do_not_create_accepted_work():
    _, outputs, _, views = integrated_nine_component_run()
    accepted = views["accepted"]
    assert accepted["components"]["Э"][
        "original_transfer_payment_claim_status"
    ] == "FULLY_SOURCE_MATCHED_MODEL_ONLY_NOT_BANK_PAYMENT"
    for name in ("independent_principal_refusal",
                 "new_owner_capacity_unavailable",
                 "customer_acceptance_withheld"):
        view = views[name]
        assert view["components"]["Э"]["original_payment_source_claim_events"] == 2
        assert not view["components"]["КЖ"]["followup_recipient_result_accepted"]
        assert outputs[name]["profit"]["system_increment"] == "UNKNOWN"
    assert outputs["customer_acceptance_withheld"]["works"]["w2"][
        "result"
    ] == "SUBMITTED"


def test_registered_entrant_and_owner_actions_remain_original_independent_events():
    _, outputs, _, views = integrated_nine_component_run()
    for output in outputs.values():
        assert sum(
            row["action"] == "subject_registration_apply"
            and row["outcome"] == "APPLIED" for row in output["trace"]
        ) == 1
        assert sum(
            row["action"] == "cooperation_membership_apply"
            and row["outcome"] == "APPLIED" for row in output["trace"]
        ) == 1
        assert output["subjects"]["c"]["kind"] == "SECTOR_BODY"
        assert output["capacity"]["resources"]["rc"]["owner"] == "c"
    assert views["independent_principal_refusal"]["components"]["У"][
        "original_followup_consents_applied"
    ] < views["accepted"]["components"]["У"][
        "original_followup_consents_applied"
    ]
    assert views["new_owner_capacity_unavailable"]["components"]["П"][
        "original_commit_applied"
    ] is False
    assert views["accepted"]["components"]["П"][
        "original_complete_applied"
    ] is True


def test_read_only_public_evidence_does_not_redisclose_original_cash_or_sources():
    _, _, _, views = integrated_nine_component_run()
    serialized = json.dumps(views, ensure_ascii=False, sort_keys=True)
    assert "model://" not in serialized
    assert "180000.00" not in serialized
    assert "25000.00" not in serialized
    assert all(
        view["owner_private_amounts_or_source_identifiers_exposed"] is False
        for view in views.values()
    )


def test_forged_accepted_result_without_original_accept_is_rejected():
    _, outputs, _, _ = integrated_nine_component_run()
    fabricated = deepcopy(outputs["independent_principal_refusal"])
    fabricated["works"]["w2"]["result"] = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    with pytest.raises(
        IntegratedCycleError, match="INTEGRATED_ACCEPTANCE_EVENT_NOT_APPLIED",
    ):
        original_nine_component_work_view(fabricated)


def test_non_comparable_change_to_original_payment_evidence_cannot_pass():
    scenarios, outputs, _, _ = integrated_nine_component_run()
    altered = deepcopy(scenarios)
    altered["independent_principal_refusal"][
        "economic_claims"
    ]["work_payment_settlement_claims"][0][
        "owner_attestations"
    ]["c"]["reported_amount"] = "1.00"
    with pytest.raises(
        TrajectoryComparisonError,
        match="COMPARATIVE_BASELINE_OR_ECONOMIC_SOURCES_CHANGED",
    ):
        compare_original_trajectories(
            altered, outputs, pilot_work="w1", next_work="w2",
        )
    with pytest.raises(InputError, match="ORIGINAL_PAYMENT_OWNER_REPORTS_CONFLICT"):
        simulate(altered["independent_principal_refusal"])


def test_later_owner_revocation_blocks_new_economic_projection_not_old_result():
    d = integrated_nine_component_scenarios()["accepted"]
    d["events"].append(e(
        103, "source_update", "c",
        source="model://c/partial-w2-01-statement",
        status="DISPROVED", expected_revision="receipt-r1",
        new_revision="receipt-r2",
    ))
    d["events"].sort(key=lambda event: event["at"])
    d["model_horizon"] = 105
    model = OperatorAKISModel(d)
    with pytest.raises(
        InputError, match="ORIGINAL_PAYMENT_EVIDENCE_NOT_USABLE_IN_STRICT_KPB"
    ):
        model.execute()
    assert model.qualitative.works["w1"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )
    assert model.qualitative.works["w2"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )
