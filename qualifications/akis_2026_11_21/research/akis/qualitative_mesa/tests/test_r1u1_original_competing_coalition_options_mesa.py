"""AKIS R1-U1: competing original prospective coalitions, one applied lineage.

c and its rc are absent from the initial native Mesa (R1-T4).  Two different
source-declared membership proposals compete after accepted W2.  Each affected
SME independently compares them before original L1->L2 member revision.  Only
one successor can be applied; the unchosen composition never acquires Work,
rights, a Result, or phantom profit.
"""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.cooperation import (
    CooperationLink, _competition_document,
)
from research.akis.qualitative_mesa.org_code_policy import (
    original_model_code_fingerprint,
)
from .test_r1t4_dynamic_original_sme_resource_mesa import (
    new_original_enterprise_case,
)
from .test_r1q_original_coalition_membership_mesa import reports


def competing_original_coalitions_case(*, no_vote=None, dissent=None,
                                        outside=None, foreign_source=None):
    data = new_original_enterprise_case()
    assert "c" not in {r["id"] for r in data["subjects"]}
    assert "rc" not in {r["id"] for r in data["resources"]}
    original = next(e for e in data["events"]
                    if e["action"] == "cooperation_change_propose"
                    and e["change_id"] == "chg-w2")
    assert original["change_kind"] == "ADD_FUTURE_PARTICIPANT"
    t = original["at"]
    # Freeze one additional original comparison and three owner decisions
    # before the existing R1-T4 membership, model OC, technology and Work.
    for e in data["events"]:
        if e["at"] > t:
            e["at"] += 5
        if type(e.get("prepared_at")) is int and e["prepared_at"] > t:
            e["prepared_at"] += 5
    for e in data["events"]:
        if e["action"] == "model_code_apply":
            for r in e["model_code_records"]:
                r["available_at"] = e["at"]
    for e in data["events"]:
        if e["action"] != "model_code_apply":
            continue
        digest = original_model_code_fingerprint(e["model_code_records"])
        for other in data["events"]:
            if (other.get("model_code_change_id") ==
                    e["model_code_change_id"]
                    and other["action"] in {
                        "model_code_propose", "model_code_response",
                        "model_code_function_response", "model_code_apply",
                    }):
                other["model_code_fingerprint"] = digest

    other = deepcopy(original)
    other.update({
        "at": t + 1,
        "change_id": "chg-w2-exit-a",
        "change_kind": "REVIEW_FUTURE_PARTICIPATION",
        "proposed_subject": "a",
        "change_source_ref": "model://a/independent-alternative-without-a",
    })
    link = next(x for x in data["cooperation_links"] if x["id"] == "l1")
    parent = CooperationLink(
        link["id"], link["purpose"], link["coordinator"],
        tuple(link["participants"]), tuple(link["works"]),
        tuple(link["mechanisms"]), link["source_ref"], link["source_revision"],
    )
    original_review = {
        **original, "outcome": "APPLIED",
        "original_consultees": ["a", "b", "c", "op"],
    }
    alternate_review = {
        **other, "outcome": "APPLIED",
        "original_consultees": ["a", "b", "op"],
    }
    scope = SimpleNamespace(
        trace=[original_review, alternate_review],
        subjects={k: SimpleNamespace(kind="SME", active=True)
                  for k in ("a", "b", "c")},
        institution=SimpleNamespace(revision="oc-1"),
    )
    scope.subjects["op"] = SimpleNamespace(kind="OPERATOR", active=True)
    digest, _ = _competition_document(
        scope, ["chg-w2", "chg-w2-exit-a"], parent,
        SimpleNamespace(key="w2", result_ref="model://w2-result"),
    )
    data["events"].extend([
        other,
        {
            "at": t + 2, "action": "coalition_options_propose", "actor": "a",
            "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
            "org_revision": "oc-1",
            "coalition_competition_id": "r1u1-options-of-w2",
            "coalition_change_ids": ["chg-w2", "chg-w2-exit-a"],
            "coalition_comparison_fingerprint": digest,
            "coalition_comparison_source_ref":
                "model://a/r1u1-independent-two-composition-comparison",
            "coalition_comparison_valid_until": 175,
            "pilot_work": "w2", "pilot_result_ref": "model://w2-result",
        },
    ])
    for i, actor in enumerate(("a", "b", "c"), start=3):
        if actor == no_vote:
            continue
        preferred = ("chg-w2-exit-a" if actor == dissent else "chg-w2")
        data["events"].append({
            "at": t + i, "action": "coalition_option_assess", "actor": actor,
            "org_revision": "oc-1",
            "coalition_competition_id": "r1u1-options-of-w2",
            "coalition_comparison_fingerprint": digest,
            "coalition_preferred_change_id": preferred,
            "coalition_willingness": "WILLING",
            "coalition_outside_option": (
                "OUTSIDE_PREFERRED" if actor == outside
                else "COOPERATION_PREFERRED"
            ),
            "coalition_evaluation_dimension": {
                "a": "CAPACITY", "b": "QUALITY", "c": "RISK",
            }[actor],
            "coalition_owner_source_ref": (
                "model://op/forged-personal-choice"
                if actor == foreign_source else
                f"model://{actor}/r1u1-my-own-comparison-of-two-alternatives"
            ),
        })
    selected = next(e for e in data["events"]
                    if e["action"] == "cooperation_membership_apply"
                    and e["change_id"] == "chg-w2")
    selected["coalition_competition_id"] = "r1u1-options-of-w2"
    selected["coalition_comparison_fingerprint"] = digest
    data["events"].sort(key=lambda e: e["at"])
    data["model_horizon"] += 5
    return data


def _selected(out):
    return reports(out, "cooperation_membership_apply")[0]


def test_r1u1_competitive_independent_owner_choice_then_original_work_quality_result():
    d = competing_original_coalitions_case()
    copy = deepcopy(d)
    out = simulate(d)
    assert d == copy
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"])
        for x in out["trace"] if x["outcome"] == "BLOCKED"
    ]
    proposals = reports(out, "cooperation_change_propose")
    assert {p["change_id"] for p in proposals if p["at"] > 65} == {
        "chg-w2", "chg-w2-exit-a"
    }
    chosen = _selected(out)
    assert chosen["original_competing_coalition_selection_qualified"] is True
    assert chosen["coalition_unselected_change_id"] == "chg-w2-exit-a"
    assert chosen["coalition_independent_choice_smes"] == ["a", "b", "c"]
    assert len(reports(out, "coalition_option_assess")) == 3
    links = {x["id"]: x for x in out["cooperation"]["links"]}
    assert set(links["l2"]["original_participants"]) == {
        "a", "b", "c", "op"
    }
    assert links["l1"]["work_results"]["w2"] == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )
    assert links["l2"]["works"] == ["w3"]
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert set(out["works"]["w3"]["consenting_principals"]) == {"a", "b", "c"}
    assert out["resources"]["ra"]["owner"] == "a"
    assert out["resources"]["rc"]["owner"] == "c"
    general = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert general[
        "independently_selected_competing_coalitions_with_accepted_work"
    ] == 1, (
        [(x["prospective_successor_link"],
          x["original_accepted_pilot_work"],
          x["new_original_accepted_work_ids"])
         for x in out["general_akis_private_cycle_evidence"][
             "original_coalition_membership_successions"]],
        [(x.get("coalition_competition_id"),
          x.get("coalition_comparison_fingerprint"),
          x.get("coalition_independent_choice_smes"),
          x.get("change_id"))
         for x in reports(out, "cooperation_membership_apply")],
        [(x["actor"], x.get("coalition_preferred_change_id"),
          x.get("coalition_owner_source_ref"))
         for x in reports(out, "coalition_option_assess")],
    )
    assert general["unselected_alternative_not_a_second_realized_coalition"]
    assert general["all_nine_component_original_causal_closure_proven"] is False
    private = out["general_akis_private_cycle_evidence"][
        "original_competing_coalition_choices_followed_by_accepted_work"
    ]
    assert len(private) == 1
    assert private[0]["selected_original_change_id"] == "chg-w2"
    assert private[0]["unselected_proposal_no_original_successor"] == (
        "chg-w2-exit-a"
    )
    assert private[0]["fresh_original_accepted_Work_Result"] == ["w3"]
    assert private[0]["owner_choice_not_source_of_verified_profit"] is True
    relation = next(row for row in out["cooperation"]["system_projection"][
        "relations"
    ] if row["link"] == "l1")
    exposures = relation["components"]["Э"]["transaction_coordination_exposures"]
    assert exposures["observed_coordination_events"][
        "RENEGOTIATION_AND_ADAPTATION"
    ]["applied"] >= 4
    assert exposures["event_counts_are_monetary_costs"] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == out


@pytest.mark.parametrize("actor", ["a", "b", "c"])
def test_r1u1_each_original_enterprise_must_independently_review_both_alternatives(actor):
    out = simulate(competing_original_coalitions_case(no_vote=actor))
    assert _selected(out)["reason"] == (
        "COALITION_COMPETITION_ALL_INDEPENDENT_ALTERNATIVES_REQUIRED"
    )
    assert "l2" not in [l["id"] for l in out["cooperation"]["links"]]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "independently_selected_competing_coalitions_with_accepted_work"
    ] == 0


@pytest.mark.parametrize("actor", ["a", "b", "c"])
def test_r1u1_each_owner_may_prefer_rival_without_operator_overriding(actor):
    out = simulate(competing_original_coalitions_case(dissent=actor))
    assert _selected(out)["reason"] == (
        "COALITION_COMPETITION_OWNER_PREFERENCE_OR_OUTSIDE_VETO"
    )
    assert "l2" not in [l["id"] for l in out["cooperation"]["links"]]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("actor", ["a", "b", "c"])
def test_r1u1_own_outside_opportunity_overrides_cooperative_preference(actor):
    out = simulate(competing_original_coalitions_case(outside=actor))
    assert _selected(out)["reason"] == (
        "COALITION_COMPETITION_OWNER_PREFERENCE_OR_OUTSIDE_VETO"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1u1_original_member_cannot_forge_newcomer_alternative_preference():
    out = simulate(competing_original_coalitions_case(foreign_source="c"))
    own = next(x for x in reports(out, "coalition_option_assess")
               if x["actor"] == "c")
    assert own["reason"] == (
        "COALITION_COMPETITION_INDEPENDENT_OWNER_SOURCE_REQUIRED"
    )
    assert _selected(out)["reason"] == (
        "COALITION_COMPETITION_ALL_INDEPENDENT_ALTERNATIVES_REQUIRED"
    )


def test_r1u1_no_competition_source_reference_cannot_skip_owner_decisions():
    d = competing_original_coalitions_case()
    application = next(x for x in d["events"]
                       if x["action"] == "cooperation_membership_apply"
                       and x["change_id"] == "chg-w2")
    application.pop("coalition_competition_id")
    out = simulate(d)
    assert _selected(out)["reason"] == (
        "COALITION_COMPETITION_EXPLICIT_SELECTION_REQUIRED"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1u1_altered_fingerprint_after_independent_choice_cannot_apply_membership():
    d = competing_original_coalitions_case()
    application = next(x for x in d["events"]
                       if x["action"] == "cooperation_membership_apply"
                       and x["change_id"] == "chg-w2")
    application["coalition_comparison_fingerprint"] = "0" * 64
    out = simulate(d)
    assert _selected(out)["reason"] == (
        "COALITION_COMPETITION_SELECTION_CONTENT_OR_TIME_STALE"
    )
    assert "l2" not in [l["id"] for l in out["cooperation"]["links"]]


def test_r1u1_comparison_alone_does_not_create_a_second_coalition_or_result():
    d = competing_original_coalitions_case()
    application = next(x for x in d["events"]
                       if x["action"] == "cooperation_membership_apply"
                       and x["change_id"] == "chg-w2")
    # Comparison remains, but membership application is not the right
    # content; its explicit source digest was changed.
    application["coalition_comparison_fingerprint"] = "0" * 64
    out = simulate(d)
    assert reports(out, "coalition_options_propose")[0]["outcome"] == "APPLIED"
    assert "l2" not in [l["id"] for l in out["cooperation"]["links"]]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["profit"]["system_increment"] == "UNKNOWN"



def selection_of_rival_exit_case(*, incumbent_dissent=False,
                                 newcomer_assesses=False):
    """The R1-Q original Work really executes in the alternative coalition.

    The LOSING entrant does not get to block an unrelated incumbent choice.
    The exiting owner remains owner of ra, and W2 uses customer b's own rb.
    """
    from .test_r1q_original_coalition_membership_mesa import membership_case
    d = membership_case(change="REVIEW_FUTURE_PARTICIPATION")
    original = next(x for x in d["events"]
                    if x["action"] == "cooperation_change_propose"
                    and x["change_id"] == "member-1")
    original.update(
        pilot_work="w1", pilot_result_ref="model://a/first-execution",
        pilot_decision_at=8,
    )
    t = original["at"]
    for row in d["events"]:
        if row["at"] > t:
            row["at"] += 5
    alt = deepcopy(original)
    alt.update(
        at=t + 1,
        change_id="member-1-add-c",
        change_kind="ADD_FUTURE_PARTICIPANT",
        proposed_subject="c",
        change_source_ref="model://b/r1u1-independent-new-entrant-alternative",
    )
    link = next(x for x in d["cooperation_links"] if x["id"] == "net")
    parent = CooperationLink(
        link["id"], link["purpose"], link["coordinator"],
        tuple(link["participants"]), tuple(link["works"]),
        tuple(link["mechanisms"]), link["source_ref"], link["source_revision"],
    )
    scope = SimpleNamespace(
        trace=[
            {**original, "outcome": "APPLIED",
             "original_consultees": ["a", "b", "op"]},
            {**alt, "outcome": "APPLIED",
             "original_consultees": ["a", "b", "c", "op"]},
        ],
        subjects={
            "a": SimpleNamespace(kind="SME", active=True),
            "b": SimpleNamespace(kind="SME", active=True),
            "c": SimpleNamespace(kind="SME", active=True),
            "op": SimpleNamespace(kind="OPERATOR", active=True),
        },
        institution=SimpleNamespace(revision="oc-1"),
    )
    digest, _ = _competition_document(
        scope, ["member-1", "member-1-add-c"], parent,
        SimpleNamespace(key="w1", result_ref="model://a/first-execution"),
    )
    d["events"].extend([
        alt,
        {
            "at": t + 2, "action": "coalition_options_propose",
            "actor": "b", "org_revision": "oc-1",
            "cooperation_link": "net", "cooperation_source_revision": "n-1",
            "coalition_competition_id": "r1u1-exit-or-invite",
            "coalition_change_ids": ["member-1", "member-1-add-c"],
            "coalition_comparison_fingerprint": digest,
            "coalition_comparison_source_ref":
                "model://b/r1u1-two-real-potential-compositions",
            "coalition_comparison_valid_until": 85,
            "pilot_work": "w1", "pilot_result_ref":
                "model://a/first-execution",
        },
        *[
            {
                "at": t + 3 + i, "action": "coalition_option_assess",
                "actor": owner, "org_revision": "oc-1",
                "coalition_competition_id": "r1u1-exit-or-invite",
                "coalition_comparison_fingerprint": digest,
                "coalition_preferred_change_id": (
                    "member-1-add-c" if (
                        owner == "c" or owner == "a" and incumbent_dissent
                    ) else "member-1"
                ),
                "coalition_willingness": "WILLING",
                "coalition_outside_option": (
                    "OUTSIDE_PREFERRED" if owner in {"a", "c"}
                    else "COOPERATION_PREFERRED"
                ),
                "coalition_evaluation_dimension": "CAPACITY",
                "coalition_owner_source_ref":
                    f"model://{owner}/r1u1-own-alternative-choice",
            }
            for i, owner in enumerate(
                ("a", "b", "c") if newcomer_assesses else ("a", "b")
            )
        ],
    ])
    selected = next(x for x in d["events"]
                    if x["action"] == "cooperation_membership_apply")
    selected["coalition_competition_id"] = "r1u1-exit-or-invite"
    selected["coalition_comparison_fingerprint"] = digest
    d["model_horizon"] += 5
    d["events"].sort(key=lambda x: x["at"])
    return d


def test_r1u1_other_competing_option_can_be_selected_and_produce_its_own_result():
    out = simulate(selection_of_rival_exit_case())
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"]) for x in out["trace"]
        if x["outcome"] == "BLOCKED"
    ]
    chosen = _selected(out)
    assert chosen["change_id"] == "member-1"
    assert chosen["former_model_party"] == "a"
    assert chosen["coalition_independent_choice_smes"] == ["a", "b"]
    assert chosen["coalition_unselected_change_id"] == "member-1-add-c"
    assert out["resources"]["ra"]["owner"] == "a"
    assert out["resources"]["rb"]["owner"] == "b"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["consenting_principals"] == ["b"]
    assert next(x for x in out["cooperation"]["links"]
                if x["id"] == "net-2")["original_participants"] == [
        "b", "op"
    ]


def test_r1u1_unselected_entrant_has_no_veto_on_incumbent_other_coalition():
    out = simulate(selection_of_rival_exit_case(newcomer_assesses=True))
    assert out["counts"]["blocked"] == 0
    chosen = _selected(out)
    assert chosen["coalition_independent_choice_smes"] == ["a", "b"]
    assert chosen["coalition_consulted_other_option_smes"] == ["c"]
    assert chosen["coalition_nonselected_entrant_has_no_veto_over_existing_members"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1u1_rival_selection_still_requires_departing_original_owner_assent():
    out = simulate(selection_of_rival_exit_case(incumbent_dissent=True))
    assert _selected(out)["reason"] == (
        "COALITION_COMPETITION_OWNER_PREFERENCE_OR_OUTSIDE_VETO"
    )
    assert "net-2" not in [x["id"] for x in out["cooperation"]["links"]]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"



def test_r1u1_operator_cannot_select_uncompared_third_coalition_to_skip_member_choice():
    d = competing_original_coalitions_case()
    apply = next(r for r in d["events"]
                 if r["action"] == "cooperation_membership_apply"
                 and r["change_id"] == "chg-w2")
    apply["change_id"] = "unreviewed-third-option"
    out = simulate(d)
    assert _selected(out)["reason"] == (
        "COALITION_COMPETITION_SELECTED_OPTION_OUTSIDE_REVIEW"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert "l2" not in [x["id"] for x in out["cooperation"]["links"]]



def test_r1u1_compared_options_without_recipient_accepted_work_do_not_count_reproduction():
    d = competing_original_coalitions_case()
    d["events"] = [e for e in d["events"]
                   if not (e["action"] == "assess_result_quality"
                           and e.get("work") == "w3"
                           and e.get("criterion") == "q-stage-c")]
    out = simulate(d)
    assert _selected(out)["outcome"] == "APPLIED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["result"] == "SUBMITTED"
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "independently_selected_competing_coalitions_with_accepted_work"
    ] == 0
    assert out["general_akis_private_cycle_evidence"][
        "original_competing_coalition_choices_followed_by_accepted_work"
    ] == []


def test_r1u1_strict_original_context_cannot_be_bypassed_by_competition_proposal():
    from research.akis.qualitative_mesa.rules import QualitativeAKIS
    from .test_rules import fixture
    state = QualitativeAKIS(fixture())
    state.context_basis = SimpleNamespace(strict=True)
    denied = state.apply({
        "at": 1, "action": "coalition_options_propose", "actor": "a",
    }, 1)
    assert denied["outcome"] == "BLOCKED"
    assert denied["reason"] == (
        "COALITION_COMPETITION_SOURCE_RIGHTS_NOT_QUALIFIED"
    )
    assert state.works["w1"].result == "NOT_SUBMITTED"
