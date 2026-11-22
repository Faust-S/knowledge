"""AKIS R1-T2: one original 13-field model OC role and responsibility shift.

After accepted W2 and applied L0 -> L1, EVERY affected SME separately
accepts prospective model functions and model accountability; founders review
the SAME 13-record fingerprint. The ORIGINAL W3 must still be requested,
prepared, independently consented, and accepted in the original Mesa.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.org_code_policy import (
    original_model_code_fingerprint,
)
from .test_r1t_prospective_original_oc_code_edition_mesa import (
    model_edition_case,
)
from .test_r1q_original_coalition_membership_mesa import reports


def r1t2_case(*, missing=None, objecting=None):
    d = model_edition_case()
    # Preserve the historical accepted Result, L0 and the first source
    # transition to L1. Make space for a second, independently reviewed
    # MODEL source edition BEFORE the original future W3 actions.
    for event in d["events"]:
        if event["at"] >= 85:
            event["at"] += 8
        if (event["action"] == "function_review"
                and event.get("work") == "w3"
                and event.get("prepared_at", 0) >= 85):
            event["prepared_at"] += 8
    d["model_horizon"] += 8
    prior = next(e for e in d["events"]
                 if e["action"] == "model_code_apply")
    old = {x["field"]: x["control"] for x in prior["model_code_records"]}
    assert next(x for x in old["Рол"]["role_bindings"]
                if x["subject"] == "b")["items"] == ["CUSTOMER"]
    assert next(x for x in old["Отв"]["responsibilities"]
                if x["action"] == "commit")["original_principals"] == ["a", "b"]

    revised = deepcopy(prior["model_code_records"])
    controls = {row["field"]: row["control"] for row in revised}
    next(row for row in controls["Рол"]["role_bindings"]
         if row["subject"] == "b")["items"] = ["CUSTOMER", "ENTERPRISE"]
    next(row for row in controls["Отв"]["responsibilities"]
         if row["action"] == "commit")["original_principals"] = ["b", "c"]
    for entry in revised:
        entry["available_at"] = 92
        entry["expires_at"] = 160
        entry["source_ref"] = f"model://op/r1t2-complete-{entry['field']}"
    fingerprint = original_model_code_fingerprint(revised)
    d["events"].append({
        "at": 85, "action": "model_code_propose", "actor": "op",
        "model_code_change_kind": "REASSIGN_EXISTING_MODEL_FUNCTIONS",
        "org_revision": "oc-1", "model_code_change_id": "r1t2-func-1",
        "model_code_fingerprint": fingerprint,
        "expected_model_edition": "model-oc-2",
        "new_model_edition": "model-oc-3",
        "proposed_subject": "b",
        "expected_model_roles": ["CUSTOMER"],
        "proposed_model_roles": ["CUSTOMER", "ENTERPRISE"],
        "expected_model_commit_responsible": ["a", "b"],
        "proposed_model_commit_responsible": ["b", "c"],
        "cooperation_link": "l2", "cooperation_source_revision": "rel-2",
        "original_cooperation_change_id": "chg-w2",
        "pilot_work": "w2", "pilot_result_ref": "model://w2-result",
        "pilot_decision_at": 65,
        "model_code_source_ref": "model://op/independent-future-role-proposal",
    })
    # The original affected owners must agree to the *exact same* future
    # model-source edition. Their responses are not founder votes, property
    # transfers, or substitutes for independent W3 consents.
    for time, party in ((86, "c"), (87, "a"), (88, "b")):
        if missing == party:
            continue
        d["events"].append({
            "at": time, "action": "model_code_function_response",
            "actor": party, "org_revision": "oc-1",
            "model_code_change_id": "r1t2-func-1",
            "model_code_fingerprint": fingerprint,
            "new_model_edition": "model-oc-3",
            "model_code_decision": (
                "OBJECT_FUNCTION_CHANGE" if objecting == party
                else "SUPPORT_FUNCTION_CHANGE"
            ),
            "model_code_decision_source_ref": (
                f"model://{party}/r1t2-own-function-and-liability-position"
            ),
        })
    for time, founder in ((89, "op"), (90, "a"), (91, "b")):
        if missing == f"founder-{founder}":
            continue
        d["events"].append({
            "at": time, "action": "model_code_response",
            "actor": founder, "org_revision": "oc-1",
            "model_code_change_id": "r1t2-func-1",
            "model_code_fingerprint": fingerprint,
            "new_model_edition": "model-oc-3",
            "model_code_decision": (
                "OBJECT_MODEL_REVISION" if objecting == f"founder-{founder}"
                else "SUPPORT_MODEL_REVISION"
            ),
            "model_code_decision_source_ref": (
                f"model://{founder}/r1t2-independent-founder-assent"
            ),
        })
    d["events"].append({
        "at": 92, "action": "model_code_apply", "actor": "op",
        "org_revision": "oc-1",
        "model_code_change_id": "r1t2-func-1",
        "model_code_fingerprint": fingerprint,
        "expected_model_edition": "model-oc-2",
        "new_model_edition": "model-oc-3",
        "model_code_records": revised,
    })
    d["events"].sort(key=lambda row: row["at"])
    return d


def _applied_code(out):
    return reports(out, "model_code_apply")[-1]


def test_r1t2_full_strict_successor_original_accepted_result_role_and_liability_revision():
    scenario = r1t2_case()
    before = deepcopy(scenario)
    out = simulate(scenario)
    assert before == scenario
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"]) for x in out["trace"]
        if x["outcome"] == "BLOCKED"
    ]
    assert [out["works"][k]["result"] for k in ("w1", "w2", "w3")] == [
        "ACCEPTED_BY_ORIGINAL_RECIPIENT",
    ] * 3
    assert out["works"]["w1"]["consenting_principals"] == ["a", "b"]
    assert out["works"]["w2"]["consenting_principals"] == ["a", "b"]
    assert set(out["works"]["w3"]["consenting_principals"]) == {"a", "b", "c"}
    assert out["resources"]["rc"]["owner"] == "c"
    responses = reports(out, "model_code_function_response")
    assert [x["actor"] for x in responses] == ["c", "a", "b"]
    assert all(x["outcome"] == "APPLIED" for x in responses)
    assert _applied_code(out)["model_code_function_change_applied"] is True
    assert _applied_code(out)["original_resources_and_work_principals_preserved"]
    assert out["general_akis_model"]["model_organizational_code_review"][
        "original_model_source_edition"
    ] == "model-oc-3"
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "strict_original_entry_to_accepted_resource_work_link_count"
    ] == 1
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "original_model_function_reassignments_followed_by_accepted_work"
    ] == 1
    private = out["general_akis_private_cycle_evidence"][
        "original_model_function_and_responsibility_successions"
    ]
    assert len(private) == 1
    assert private[0]["original_accepted_pilot_work"] == "w2"
    assert private[0]["later_accepted_original_work"] == "w3"
    assert private[0]["new_model_commit_accountable_principals"] == ["b", "c"]
    assert private[0]["original_actual_consent_owners"] == ["a", "b", "c"]
    assert private[0]["real_resource_liability_rights_or_money_verified"] is False
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "all_nine_component_original_causal_closure_proven"
    ] is False
    assert simulate(deepcopy(scenario)) == out


@pytest.mark.parametrize("party", ["a", "b", "c"])
def test_r1t2_each_affected_original_principal_has_independent_veto(party):
    out = simulate(r1t2_case(missing=party))
    assert _applied_code(out)["reason"] == (
        "OC_MODEL_FUNCTION_ALL_AFFECTED_RESPONSES_REQUIRED"
    )
    assert out["general_akis_model"]["model_organizational_code_review"][
        "original_model_source_edition"
    ] == "model-oc-2"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("party", ["a", "b", "c"])
def test_r1t2_affected_principal_refusal_blocks_future_change(party):
    out = simulate(r1t2_case(objecting=party))
    assert _applied_code(out)["reason"] == "OC_MODEL_FUNCTION_AFFECTED_PARTY_OBJECTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t2_original_founder_approval_is_separate_from_affected_owner_assent():
    out = simulate(r1t2_case(missing="founder-a"))
    assert len(reports(out, "model_code_function_response")) == 3
    assert _applied_code(out)["reason"] == "OC_MODEL_EDITION_ALL_FOUNDERS_RESPONSE_REQUIRED"


def test_r1t2_unchanged_old_roles_cannot_be_used_as_false_function_change():
    d = r1t2_case()
    proposal = next(x for x in d["events"]
                    if x["action"] == "model_code_propose"
                    and x.get("model_code_change_id") == "r1t2-func-1")
    proposal["proposed_model_roles"] = ["CUSTOMER"]
    out = simulate(d)
    assert [x for x in reports(out, "model_code_propose")
            if x["at"] == 85][0]["reason"] == (
        "OC_MODEL_FUNCTION_EXPECTED_AND_FUTURE_ROLES_REQUIRED"
    )
    assert _applied_code(out)["outcome"] == "BLOCKED"


def test_r1t2_foreign_model_resource_owner_cannot_be_fabricated():
    d = r1t2_case()
    proposal = next(x for x in d["events"]
                    if x["action"] == "model_code_propose"
                    and x.get("model_code_change_id") == "r1t2-func-1")
    proposal["proposed_model_roles"] = ["CUSTOMER", "RESOURCE_OWNER"]
    out = simulate(d)
    assert [x for x in reports(out, "model_code_propose")
            if x["at"] == 85][0]["reason"] == (
        "OC_MODEL_FUNCTION_RESOURCE_OWNERSHIP_CANNOT_BE_ASSUMED"
    )


def test_r1t2_nonmatching_source_digest_is_not_independent_owner_assent():
    d = r1t2_case()
    response = next(e for e in d["events"]
                    if e["action"] == "model_code_function_response"
                    and e["actor"] == "c")
    response["model_code_fingerprint"] = "0" * 64
    out = simulate(d)
    assert next(x for x in reports(out, "model_code_function_response")
                if x["actor"] == "c")["reason"] == (
        "OC_MODEL_FUNCTION_RESPONSE_STALE_OR_CONTENT_MISMATCH"
    )
    assert _applied_code(out)["reason"] == "OC_MODEL_FUNCTION_ALL_AFFECTED_RESPONSES_REQUIRED"


def test_r1t2_previous_accepted_result_is_immutable_even_after_reassigning_roles():
    out = simulate(r1t2_case())
    parent = next(x for x in out["cooperation"]["links"] if x["id"] == "l1")
    successor = next(x for x in out["cooperation"]["links"] if x["id"] == "l2")
    assert parent["works"] == ["w0", "w1", "w2"]
    assert successor["works"] == ["w3"]
    assert _applied_code(out)["historical_accepted_results_and_consents_preserved"]
    assert all(x["model_code_current_source_edition"] in {
        "model-oc-2", "model-oc-3"
    } for x in reports(out, "model_code_apply"))


def test_r1t2_operator_cannot_rename_an_unrelated_source_field_as_owner_approval():
    d = r1t2_case()
    apply = next(x for x in d["events"] if x["action"] == "model_code_apply"
                 and x.get("new_model_edition") == "model-oc-3")
    record = next(x for x in apply["model_code_records"]
                  if x["field"] == "Пр")
    record["control"]["permitted"][0]["items"].append("consent")
    out = simulate(d)
    assert _applied_code(out)["reason"] == "OC_MODEL_EDITION_CONTENT_CHANGED_AFTER_REVIEW"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t2_model_role_assent_never_substitutes_resource_owner_c_work_consent():
    d = r1t2_case()
    d["events"] = [row for row in d["events"]
                   if not (row["action"] == "consent"
                           and row["work"] == "w3"
                           and row["actor"] == "c")]
    out = simulate(d)
    assert _applied_code(out)["outcome"] == "APPLIED"
    assert [row for row in reports(out, "commit")
            if row["work"] == "w3"][0]["reason"] == (
        "INDEPENDENT_ACCEPTANCE_MISSING"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "original_model_function_reassignments_followed_by_accepted_work"
    ] == 0


def test_r1t2_affected_owners_cannot_approve_from_foreign_sources():
    d = r1t2_case()
    row = next(x for x in d["events"]
               if x["action"] == "model_code_function_response"
               and x["actor"] == "c")
    row["model_code_decision_source_ref"] = "model://op/foreign-signature"
    out = simulate(d)
    response = next(x for x in reports(out, "model_code_function_response")
                    if x["actor"] == "c")
    assert response["reason"] == "OC_MODEL_EDITION_OWNER_SOURCE_REQUIRED"
    assert _applied_code(out)["reason"] == (
        "OC_MODEL_FUNCTION_ALL_AFFECTED_RESPONSES_REQUIRED"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t2_historical_baseline_and_two_successive_model_editions_are_observable():
    out = simulate(r1t2_case())
    evolution = [
        (row["at"], row["projection"]["model_organizational_code_review"][
            "original_model_source_edition"
        ])
        for row in out["general_akis_model"]["read_only_evolution"]
    ]
    assert any(t < 84 and edition == "BASE" for t, edition in evolution)
    assert any(84 <= t < 92 and edition == "model-oc-2"
               for t, edition in evolution)
    assert any(t >= 92 and edition == "model-oc-3"
               for t, edition in evolution)
    assert out["general_akis_model"]["model_organizational_code_review"][
        "original_model_source_edition"
    ] == "model-oc-3"
    assert out["institution"]["revision"] == "oc-1"
