"""R1-S: the ORIGINAL R1-M/N/O/P strict path survives L0 -> L1 membership.

One Mesa clock, one trace. A newcomer first evaluates its own alternatives,
not the predecessor Result. Prior Results and all existing consents remain in L0.
"""
from copy import deepcopy

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1p_original_capability_cooperation_cycle_mesa import r1p_case
from .test_r1q_original_coalition_membership_mesa import reports


def strict_successor_case():
    data = r1p_case()
    data["subjects"].append({"id": "c", "kind": "SME"})
    proposal = next(e for e in data["events"]
                    if e["action"] == "cooperation_change_propose"
                    and e["change_id"] == "chg-w2")
    proposal.update(
        change_kind="ADD_FUTURE_PARTICIPANT", proposed_subject="c",
    )
    # The old pilot must NOT be relocated to l2. The old reviews still
    # refer to the ORIGINAL relation l1 and its accepted second Work.
    need = next(e for e in data["events"] if e["action"] == "need_emerge"
                and e["work"] == "w3")
    need["at"] = 79
    need["cooperation_link"] = "l2"
    need["cooperation_source_revision"] = "rel-2"
    for e in data["events"]:
        if (e["action"] == "request"
                and e["work_spec"]["id"] == "w3"):
            e["cooperation_link"] = "l2"
            e["cooperation_source_revision"] = "rel-2"
        if e["action"] == "interest_update" and e["work"] == "w3":
            e["cooperation_link"] = "l2"
            e["cooperation_source_revision"] = "rel-2"
    data["events"].extend([
        {
            "at": 74, "action": "cooperation_entry_assess", "actor": "c",
            "change_id": "chg-w2", "cooperation_link": "l1",
            "cooperation_source_revision": "rel-1",
            "org_revision": "oc-1", "entry_willingness": "WILLING",
            "entry_outside_option": "UNKNOWN",
            "entry_goal_source_ref": "model://c/prospective-own-goal",
            "entry_alternative_source_ref": "model://c/independent-alternative",
            "entry_assessment_source_ref": "model://c/entry-evaluation",
            "entry_valid_until": 160,
        },
        {
            "at": 75, "action": "cooperation_change_response", "actor": "c",
            "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
            "org_revision": "oc-1", "change_id": "chg-w2",
            "change_decision": "SUPPORT_MODEL_PROPOSAL",
            "change_source_ref": "model://c/independent-l1-membership-approval",
        },
        {
            "at": 76, "action": "cooperation_membership_apply", "actor": "a",
            "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
            "org_revision": "oc-1", "change_id": "chg-w2",
            "pilot_work": "w2", "pilot_result_ref": "model://w2-result",
            "pilot_decision_at": 65,
            "new_link_id": "l2", "new_link_revision": "rel-2",
            "new_link_source_ref": "model://a/prospective-l2-source",
        },
        *[{
            "at": at, "action": "participation_status", "actor": actor,
            "org_revision": "oc-1", "cooperation_link": "l2",
            "cooperation_source_revision": "rel-2",
            "new_participation": "OPEN_TO_NEW_WORK",
            "economic_channel": "TRANSACTION_COST",
            "participation_evidence_ref": f"model://{actor}/l2-own-pilot-evaluation",
            "evaluated_work": "w2", "evaluated_work_revision": "d-2",
            "evaluated_result_ref": "model://w2-result",
            "evaluated_decision_at": 65,
            "evaluation_verdict": "FAVOURABLE_DECLARED",
            "formation_phase_source_ref": f"model://{actor}/formation-8",
        } for at, actor in ((77, "a"), (78, "b"))],
    ])
    data["events"].sort(key=lambda x: x["at"])
    return data


def test_r1s_strict_original_goals_interests_review_capability_and_membership_succeed():
    d = strict_successor_case()
    assert all(d["general_akis"][key] for key in (
        "enforce_model_formation_lifecycle",
        "enforce_model_result_conditioned_goals",
        "enforce_model_result_conditioned_interests",
        "enforce_model_result_conditioned_reconfiguration",
        "enforce_model_result_conditioned_capability_cooperation",
    ))
    result = simulate(deepcopy(d))
    assert result["counts"]["blocked"] == 0, [
        (e["at"], e["action"], e["reason"]) for e in result["trace"]
        if e["outcome"] == "BLOCKED"
    ]
    assert [result["works"][w]["result"] for w in ("w1", "w2", "w3")] == [
        "ACCEPTED_BY_ORIGINAL_RECIPIENT",
    ] * 3
    links = {row["id"]: row for row in result["cooperation"]["links"]}
    assert links["l1"]["works"] == ["w0", "w1", "w2"]
    assert links["l2"]["works"] == ["w3"]
    assert set(links["l1"]["original_participants"]) == {"a", "b", "op"}
    assert set(links["l2"]["original_participants"]) == {"a", "b", "op", "c"}
    assert reports(result, "cooperation_membership_apply")[0][
        "new_entrant_independently_assessed_model_only"
    ]
    assert reports(result, "request")[-1]["request_consultation_source"] == (
        "APPLIED_ORIGINAL_MEMBERSHIP_SUCCESSION"
    )
    assert result["capability_dynamics"]["original_owner_adopted_count"] == 1
    assert result["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == result


def test_r1s_missing_entrant_assessment_stops_strict_revision_and_second_coalition_work():
    d = strict_successor_case()
    d["events"] = [x for x in d["events"]
                   if x["action"] != "cooperation_entry_assess"]
    out = simulate(d)
    assert reports(out, "cooperation_membership_apply")[0]["reason"] == (
        "COOPERATION_MEMBERSHIP_ENTRANT_ASSESSMENT_REQUIRED"
    )
    assert "l2" not in [r["id"] for r in out["cooperation"]["links"]]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"].get("w3") is None


def test_r1s_original_customer_cannot_omit_own_assessment_after_relation_revision():
    d = strict_successor_case()
    d["events"] = [x for x in d["events"]
                   if x["at"] != 78]
    out = simulate(d)
    assert reports(out, "cooperation_membership_apply")[0]["outcome"] == "APPLIED"
    assert reports(out, "need_emerge")[-1]["reason"] == (
        "FORMATION_EMERGENT_OWN_POST_RESULT_DECISION_REQUIRED"
    )
    assert reports(out, "request")[-1]["outcome"] == "BLOCKED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1s_successor_cannot_cite_unrelated_or_nonexistent_original_pilot():
    d = strict_successor_case()
    row = next(x for x in d["events"] if x["action"] == "request"
               and x["work_spec"]["id"] == "w3")
    row["pilot_work"] = "w1"
    out = simulate(d)
    assert reports(out, "request")[-1]["outcome"] == "BLOCKED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1s_strict_successor_request_fails_without_applied_membership():
    d = strict_successor_case()
    d["events"] = [x for x in d["events"]
                   if x["action"] != "cooperation_membership_apply"]
    out = simulate(d)
    assert reports(out, "request")[-1]["outcome"] == "BLOCKED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def strict_entrant_resource_case():
    """The newcomer must independently prepare and consent to its OWN resource.

    The original old Result remains the causal pilot but is not treated as
    the new resource owner's past personal experience. All strict gates stay on.
    """
    data = strict_successor_case()
    data["resources"].append({
        "id": "rc", "owner": "c", "availability": "AVAILABLE",
        "capacity_units": 1, "capacity_unit": "UNIT",
    })
    request = next(row for row in data["events"]
                   if row["action"] == "request"
                   and row["work_spec"]["id"] == "w3")
    request["work_spec"]["resource_requirements"].append(
        {"resource": "rc", "units": 1}
    )
    data["general_akis"]["formation_phases"].append({
        "phase": 3, "owner": "c", "source_ref": "model://c/formation-3",
        "revision": "oc-1", "available_at": 0, "expires_at": 160,
    })
    # Reserve three event positions INSIDE the original W3 sequence.
    # Original future slot, source revisions and all prior Result times remain.
    for row in data["events"]:
        if row["at"] >= 86:
            row["at"] += 1
        if row["at"] >= 90:
            row["at"] += 1
        if row["at"] >= 104:
            row["at"] += 1
        if (row["action"] == "function_review" and
                row.get("work") == "w3"):
            row["prepared_at"] += 2
    data["events"].extend([
        {
            "at": 86, "action": "interest_update", "actor": "c",
            "work": "w3", "source_revision": "d-3",
            "org_revision": "oc-1", "cooperation_link": "l2",
            "cooperation_source_revision": "rel-2",
            "economic_channel": "TRANSACTION_COST",
            "new_willingness": "WILLING", "new_outside_option": "UNKNOWN",
            "interest_evidence_ref": "model://c/w3-original-interest",
            "interest_valid_until": 160,
            "entry_change_id": "chg-w2",
            "entry_assessment_source_ref": "model://c/entry-evaluation",
        },
        {
            "at": 90, "action": "formation_confirm", "actor": "c",
            "work": "w3", "phase": 3, "org_revision": "oc-1",
            "formation_source_ref": "model://c/formation-3",
        },
        {
            "at": 104, "action": "consent", "actor": "c", "work": "w3",
            "source_revision": "d-3", "org_revision": "oc-1",
        },
    ])
    data["events"].sort(key=lambda row: row["at"])
    return data


def test_r1s_new_entrant_resource_requires_own_interests_phase_and_work_consent():
    d = strict_entrant_resource_case()
    out = simulate(deepcopy(d))
    assert out["counts"]["blocked"] == 0, [
        (row["at"], row["action"], row["reason"])
        for row in out["trace"] if row["outcome"] == "BLOCKED"
    ]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert set(out["works"]["w3"]["consenting_principals"]) == {"a", "b", "c"}
    own_interest = [row for row in reports(out, "interest_update")
                    if row["actor"] == "c" and row["work"] == "w3"][0]
    assert own_interest["interest_entry_change_id"] == "chg-w2"
    assert own_interest["interest_pilot_work"] is None
    assert reports(out, "cooperation_membership_apply")[0][
        "new_entrant_previous_pilot_experience_not_imputed"
    ] is True
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == out


def test_r1s_entrant_cannot_replace_work_interest_with_membership_vote():
    d = strict_entrant_resource_case()
    d["events"] = [row for row in d["events"]
                   if not (row["action"] == "interest_update"
                           and row["actor"] == "c")]
    out = simulate(d)
    assert reports(out, "cooperation_membership_apply")[0]["outcome"] == "APPLIED"
    assert [row for row in reports(out, "commit")
            if row["work"] == "w3"][0]["reason"] == (
        "FORMATION_INTEREST_INDEPENDENT_OWNER_POSITION_REQUIRED"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1s_entrant_resource_owner_must_confirm_own_phase_three():
    d = strict_entrant_resource_case()
    d["events"] = [row for row in d["events"]
                   if not (row["action"] == "formation_confirm"
                           and row["actor"] == "c")]
    out = simulate(d)
    assert [row for row in reports(out, "commit")
            if row["work"] == "w3"][0]["outcome"] == "BLOCKED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1s_entrant_cannot_fabricate_experience_of_predecessor_pilot():
    d = strict_entrant_resource_case()
    entrant_interest = next(row for row in d["events"]
                            if row["action"] == "interest_update"
                            and row["actor"] == "c")
    entrant_interest.update(
        pilot_work="w2", pilot_result_ref="model://w2-result",
        pilot_decision_at=65,
    )
    out = simulate(d)
    own = [row for row in reports(out, "interest_update")
           if row["actor"] == "c" and row["work"] == "w3"][0]
    assert own["reason"] == "FORMATION_INTEREST_ENTRANT_OWN_SOURCE_BINDING_REQUIRED"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1s_expired_entrant_source_cannot_authorize_new_work_after_membership():
    d = strict_entrant_resource_case()
    entry = next(row for row in d["events"]
                 if row["action"] == "cooperation_entry_assess")
    entry["entry_valid_until"] = 85
    out = simulate(d)
    assert reports(out, "cooperation_membership_apply")[0]["outcome"] == "APPLIED"
    own = [row for row in reports(out, "interest_update")
           if row["actor"] == "c" and row["work"] == "w3"][0]
    assert own["reason"] == "FORMATION_INTEREST_ENTRANT_ASSESSMENT_NO_LONGER_CURRENT"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1s_newcomer_must_consent_to_concrete_work_in_addition_to_membership():
    d = strict_entrant_resource_case()
    d["events"] = [row for row in d["events"]
                   if not (row["action"] == "consent" and row["actor"] == "c")]
    out = simulate(d)
    final = [row for row in reports(out, "commit")
             if row["work"] == "w3"][0]
    assert final["reason"] == "INDEPENDENT_ACCEPTANCE_MISSING"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
