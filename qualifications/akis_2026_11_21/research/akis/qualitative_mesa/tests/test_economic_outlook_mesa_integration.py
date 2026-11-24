"""Native Mesa only: outlooks move owner assessments, not rights or Results."""
from copy import deepcopy
import pytest

mesa = pytest.importorskip("mesa", reason="Official native Mesa not installed: NOT_RUN")

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_cooperation_akis_integration import linked_world
from research.akis.qualitative_mesa.tests.test_economic_outlook import outlook


def scenario():
    data = linked_world()
    data["decision_profiles"] = [{
        "subject": "a", "work": "w1", "source_revision": "d1",
        "org_revision": "oc-1", "willingness": "WILLING", "outside_option": "UNKNOWN",
    }]
    data["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
    ]
    current = outlook(relation="network-1", at=3)
    current["work_source_revision"] = "d1"
    current["relation_source_revision"] = "nw-r1"
    current["org_revision"] = "oc-1"
    current["expires_at"] = 9
    alternative = deepcopy(current)
    alternative["available_at"] = 5
    alternative["source_ref"] = "model://a/quote-5"
    alternative["cash"]["COOPERATION"]["operator_fee_cash"] = "60.00"
    data["economic_outlooks"] = [current, alternative]
    return data


def test_economic_outlooks_change_in_model_time_without_automatic_contract():
    data = scenario()
    out = simulate(data)
    rows = [row for row in out["decision_observations"]
            if row["subject"] == "a"]
    by_at = {row["at"]: row for row in rows}
    assert by_at[2.0]["assessment"] == "OUTSIDE_OPTION_UNKNOWN"
    assert by_at[3.0]["assessment"] == "REVIEWABLE_NOT_CONSENTED"
    assert by_at[5.0]["assessment"] == "PREFERS_OUTSIDE_OPTION"
    assert by_at[3.0]["economic_position"] == "COOPERATION_PREFERRED"
    assert by_at[5.0]["economic_position"] == "OUTSIDE_PREFERRED"
    assert "private_owner_comparison" not in str(out)
    assert "28.00" not in str(out)
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w1"]["consenting_principals"] == []
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(data)) == out


def test_original_owner_interest_is_stronger_than_simulated_cash_preference():
    data = scenario()
    data["events"].append({
        "at": 4, "action": "interest_update", "actor": "a", "work": "w1",
        "source_revision": "d1", "org_revision": "oc-1",
        "cooperation_link": "network-1", "cooperation_source_revision": "nw-r1",
        "economic_channel": "TRANSACTION_COST",
        "new_willingness": "DECLINES", "new_outside_option": "OUTSIDE_PREFERRED",
        "interest_evidence_ref": "model://a-decline",
    })
    out = simulate(data)
    latest = [row for row in out["decision_observations"]
              if row["subject"] == "a" and row["at"] == 5.0]
    assert latest[-1]["assessment"] == "INDEPENDENT_DECLINE"
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_no_forecasts_retains_previous_execution_shape():
    data = linked_world()
    data["events"] = [{"at":1, "action":"offer","actor":"op","work":"w1"}]
    out = simulate(data)
    assert "decision_observations" not in out
    assert "economic_outlooks" not in out


def test_accepted_previous_result_unlocks_next_cooperation_review_without_new_consent():
    """A completed prior order can change later modeled choice, not legal authority."""
    from research.akis.qualitative_mesa.tests.test_rules import fixture as simple_fixture

    data = simple_fixture()
    data["resources"][0]["availability"] = "AVAILABLE"
    data["works"].append({
        "id": "w2", "customer": "b", "resource": "ra", "source_revision": "d-2",
        "slot_start": 13, "slot_end": 17,
    })
    data["cooperation_links"] = [{
        "id": "supply-network", "purpose": "repeated joint procurement and service",
        "coordinator": "op", "participants": ["a", "b", "op"],
        "works": ["w1", "w2"],
        "mechanisms": ["JOINT_PURCHASING", "TRANSACTION_COST", "SHARED_MARKETING"],
        "source_ref": "model://supply-network", "source_revision": "network-r1",
    }]
    data["decision_profiles"] = [
        {"subject": owner, "work": "w2", "source_revision": "d-2",
         "org_revision": "oc-1", "willingness": "WILLING", "outside_option": "UNKNOWN"}
        for owner in ["a", "b"]
    ]
    forecasts = []
    for owner in ["a", "b"]:
        row = outlook(owner=owner, relation="supply-network", at=3)
        row["work"] = "w2"
        row["work_source_revision"] = "d-2"
        row["relation_source_revision"] = "network-r1"
        row["org_revision"] = "oc-1"
        row["expires_at"] = 15
        row["requires_accepted_results"] = [{"work": "w1", "source_revision": "d-1"}]
        forecasts.append(row)
    data["economic_outlooks"] = forecasts
    data["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w2"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w2"},
        {"at": 4, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 5, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 6, "action": "consent", "actor": "a", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 7, "action": "consent", "actor": "b", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 8, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 9, "action": "start", "actor": "a", "work": "w1"},
        {"at": 10, "action": "complete", "actor": "a", "work": "w1",
         "result_ref": "model://completed-w1"},
        {"at": 11, "action": "accept", "actor": "b", "work": "w1"},
    ]
    output = simulate(data)
    assert output["counts"] == {"applied": 10, "blocked": 0}
    assert output["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert output["works"]["w2"]["obligation"] == "NOT_ACCEPTED"
    w2 = [row for row in output["decision_observations"] if row["work"] == "w2"]
    assert {row["assessment"] for row in w2 if row["at"] == 3.0} == {"OUTSIDE_OPTION_UNKNOWN"}
    assert {row["economic_reason"] for row in w2 if row["at"] == 3.0} == {"PRIOR_RESULT_NOT_ACCEPTED"}
    assert {row["assessment"] for row in w2 if row["at"] == 11.0} == {"REVIEWABLE_NOT_CONSENTED"}
    assert any(
        review.get("status") == "MODEL_READY_FOR_ORIGINAL_CONSENT_REVIEW"
        for row in w2 if row["at"] == 11.0
        for review in row.get("cooperation_model_review", ())
        if review.get("work") == "w2"
    )
    assert output["works"]["w2"]["consenting_principals"] == []
    assert output["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(data)) == output

    # An accepted earlier Result is not enough when a participant loses money.
    disadvantage = deepcopy(data)
    disadvantage["economic_outlooks"][1]["cash"]["COOPERATION"]["operator_fee_cash"] = "70.00"
    adverse = simulate(disadvantage)
    b_later = [row for row in adverse["decision_observations"]
               if row["work"] == "w2" and row["subject"] == "b" and row["at"] == 11.0]
    assert b_later[-1]["assessment"] == "PREFERS_OUTSIDE_OPTION"
    assert any(review.get("status") == "MODEL_INDEPENDENT_OPPOSITION"
               for review in b_later[-1].get("cooperation_model_review", ())
               if review["work"] == "w2")
    assert adverse["works"]["w2"]["consenting_principals"] == []


def test_continuing_outlook_trigger_at_same_time_as_source_event_is_not_misattributed():
    data = scenario()
    data["economic_outlooks"][0]["available_at"] = 2
    data["economic_outlooks"][0]["source_ref"] = "model://a/quote-2"
    result = simulate(data)
    both = [row for row in result["decision_observations"]
            if row["subject"] == "a" and row["at"] == 2.0]
    assert any(row["trigger"] == "authorize" and
               row["source_event_state_is_current"] is False for row in both)
    assert any(row["trigger"] == "economic_outlook_available" and
               row["source_event_state_is_current"] is True for row in both)
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_explicit_horizon_observes_forecast_expiry_in_same_native_mesa_clock():
    data = scenario()
    data["model_horizon"] = 10
    out = simulate(data)
    after_expiry = [row for row in out["decision_observations"]
                    if row["subject"] == "a" and row["at"] == 9.0]
    assert after_expiry
    assert after_expiry[-1]["trigger"] == "economic_outlook_expired"
    assert after_expiry[-1]["economic_reason"] == "NO_CURRENT_OWNER_OUTLOOK"
    assert after_expiry[-1]["assessment"] == "OUTSIDE_OPTION_UNKNOWN"
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


@pytest.mark.parametrize("horizon,error", [
    (True, "MODEL_HORIZON_MUST_BE_NONNEGATIVE_INTEGER"),
    (-1, "MODEL_HORIZON_MUST_BE_NONNEGATIVE_INTEGER"),
    (1, "MODEL_HORIZON_PRECEDES_ORIGINAL_EVENTS"),
])
def test_invalid_horizon_never_silently_discards_original_source_events(horizon, error):
    data = scenario()
    data["model_horizon"] = horizon
    from research.akis.qualitative_mesa.rules import InputError
    with pytest.raises(InputError, match=error):
        simulate(data)
