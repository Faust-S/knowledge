"""R1-R: prospective entrant makes an ORIGINAL independent appraisal.

No borrowed assessment of the predecessor Result, no automatically created
interest, obligation, financial gain or ownership right. Uses original Mesa.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.cooperation import (
    CooperationInputError, apply_cooperation_membership_revision,
)
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import QualitativeAKIS
from .test_r1q_original_coalition_membership_mesa import membership_case, reports


def entry_case(*, willingness="WILLING", outside="UNKNOWN",
               expiry=50, source_owner="c", include=True):
    data = membership_case()
    # Place assessment after the proposal and before ALL consultations,
    # retaining strictly increasing event times and original Result history.
    for event in data["events"]:
        if event["at"] >= 10:
            event["at"] += 1
    if include:
        data["events"].append({
            "at": 10, "action": "cooperation_entry_assess", "actor": "c",
            "cooperation_link": "net", "cooperation_source_revision": "n-1",
            "org_revision": "oc-1", "change_id": "member-1",
            "entry_goal_source_ref": f"model://{source_owner}/entry-goal",
            "entry_alternative_source_ref": "model://c/entry-outside",
            "entry_assessment_source_ref": "model://c/entry-decision",
            "entry_willingness": willingness, "entry_outside_option": outside,
            "entry_valid_until": expiry,
        })
    data["events"].sort(key=lambda row: row["at"])
    data["model_horizon"] = 32
    return data


def original_strict_application(data):
    model = QualitativeAKIS({
        k: deepcopy(v) for k, v in data.items() if k != "model_horizon"
    })
    application = next(e for e in data["events"]
                       if e["action"] == "cooperation_membership_apply")
    for event in data["events"]:
        if event is application:
            break
        model.apply(event, event["at"])
    return apply_cooperation_membership_revision(
        application, model.cooperation_links, model.subjects, model.works,
        model.trace, org_revision=model.institution.revision,
        at=application["at"], require_entry_assessment=True,
    )


def test_entrant_independent_source_and_interest_enable_strict_future_membership():
    d = entry_case()
    links, proof = original_strict_application(d)
    assert proof["new_entrant_independently_assessed_model_only"] is True
    assert proof["new_entrant_previous_pilot_experience_not_imputed"] is True
    assert proof["new_entrant_outside_option"] == "UNKNOWN"
    assert proof["new_entrant_own_economic_advantage_proven"] is False
    assert next(x for x in links if x.key == "net-2").participants == (
        "a", "b", "op", "c"
    )
    out = simulate(deepcopy(d))
    assert reports(out, "cooperation_entry_assess")[0]["outcome"] == "APPLIED"
    assert reports(out, "cooperation_membership_apply")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_strict_membership_does_not_invent_newcomer_history():
    with pytest.raises(CooperationInputError,
                       match="COOPERATION_MEMBERSHIP_ENTRANT_ASSESSMENT_REQUIRED"):
        original_strict_application(entry_case(include=False))


@pytest.mark.parametrize("willingness", ["DECLINES", "UNKNOWN"])
def test_entrant_non_willing_assessment_cannot_turn_into_strict_membership(willingness):
    with pytest.raises(CooperationInputError,
                       match="COOPERATION_MEMBERSHIP_ENTRANT_INTEREST_NOT_ESTABLISHED"):
        original_strict_application(entry_case(willingness=willingness))


def test_expired_entrant_evaluation_is_not_renewed_by_old_vote():
    with pytest.raises(CooperationInputError,
                       match="COOPERATION_MEMBERSHIP_ENTRANT_ASSESSMENT_EXPIRED"):
        original_strict_application(entry_case(expiry=15))


def test_foreign_source_cannot_be_presented_as_entrant_own_assessment():
    out = simulate(entry_case(source_owner="b"))
    assert reports(out, "cooperation_entry_assess")[0]["reason"] == (
        "COOPERATION_ENTRY_SOURCE_OWNER_REQUIRED"
    )
    assert reports(out, "cooperation_membership_apply")[0]["outcome"] == "APPLIED"
    # Legacy opt-out remains backward compatible; strict evaluation still
    # requires the missing qualified event.
    with pytest.raises(CooperationInputError,
                       match="COOPERATION_MEMBERSHIP_ENTRANT_ASSESSMENT_REQUIRED"):
        original_strict_application(entry_case(source_owner="b"))


def test_assessment_after_entrant_vote_requires_new_independent_response():
    d = entry_case()
    assessment = next(x for x in d["events"]
                      if x["action"] == "cooperation_entry_assess")
    response = next(x for x in d["events"]
                    if x["action"] == "cooperation_change_response"
                    and x["actor"] == "c")
    assessment["at"], response["at"] = response["at"], assessment["at"]
    d["events"].sort(key=lambda x: x["at"])
    with pytest.raises(CooperationInputError,
                       match="COOPERATION_MEMBERSHIP_ENTRANT_NEW_RESPONSE_REQUIRED"):
        original_strict_application(d)


def test_entry_assessment_preserves_original_results_and_is_deterministic():
    d = entry_case()
    first, second = simulate(deepcopy(d)), simulate(deepcopy(d))
    assert first == second
    assert first["works"]["w1"]["consenting_principals"] == ["a", "b"]
    assert first["works"]["w2"]["consenting_principals"] == ["b", "c"]
