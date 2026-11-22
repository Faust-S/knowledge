"""R1-T4. The future SME 'c' and its 'rc' are ABSENT at Mesa startup.

An accepted W2 is followed by independent application and founder review,
then the existing subjects and CapacityLedger acquire a new SME/resource.
ALL original R1-T3 membership, OC, route, Work, handoff, QA, Result gates
remain active. No parallel registry, new scheduler, invented contract or money.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import (
    OperatorAKISModel, simulate,
)
from research.akis.qualitative_mesa.org_code_policy import (
    original_model_code_fingerprint,
)
from research.akis.qualitative_mesa.source_registration import (
    registration_fingerprint,
)
from research.akis.qualitative_mesa.rules import InputError
from .test_r1t3_original_technology_route_mesa import (
    original_technology_route_case,
)
from .test_r1q_original_coalition_membership_mesa import reports


def new_original_enterprise_case(*, absent=None, objecting=None):
    data = original_technology_route_case()
    original_subjects = {x["id"] for x in data["subjects"]}
    original_resources = {x["id"] for x in data["resources"]}
    assert "c" in original_subjects and "rc" in original_resources
    rc_spec = next(x for x in data["resources"] if x["id"] == "rc")
    data["subjects"] = [r for r in data["subjects"] if r["id"] != "c"]
    data["resources"] = [r for r in data["resources"] if r["id"] != "rc"]
    assert "c" not in {x["id"] for x in data["subjects"]}
    assert "rc" not in {x["id"] for x in data["resources"]}

    # The earlier accepted W2 stays at t=65. Nine independent registry
    # events (operator/candidate/reviewers) precede the previously first
    # post-Result action, with no time collision and no new Mesa clock.
    for event in data["events"]:
        if event["at"] >= 66:
            event["at"] += 9
        if (type(event.get("prepared_at")) is int and
                event["prepared_at"] >= 66):
            event["prepared_at"] += 9
    for event in data["events"]:
        if event["action"] == "model_code_apply":
            for row in event["model_code_records"]:
                row["available_at"] = event["at"]
    for event in data["events"]:
        if event["action"] != "model_code_apply":
            continue
        digest = original_model_code_fingerprint(event["model_code_records"])
        target = event["model_code_change_id"]
        for related in data["events"]:
            if (related.get("model_code_change_id") == target
                    and related["action"] in {
                        "model_code_propose", "model_code_response",
                        "model_code_function_response", "model_code_apply"
                    }):
                related["model_code_fingerprint"] = digest
    for source in data["general_akis"]["formation_phases"]:
        if source["owner"] == "c":
            source["available_at"] = 70

    subject_claim = {
        "subject_registration_id": "r1t4-register-c",
        "new_subject": "c", "new_subject_kind": "SME",
        "pilot_work": "w2", "pilot_result_ref": "model://w2-result",
        "pilot_decision_at": 65,
    }
    subject_digest = registration_fingerprint(subject_claim)
    resource_digest = registration_fingerprint(rc_spec)
    registration = [
        {
            "at": 66, "action": "subject_registration_propose",
            "actor": "op", "org_revision": "oc-1",
            **subject_claim, "registration_fingerprint": subject_digest,
            "registration_source_ref": "model://op/r1t4-new-c-source",
            "registration_valid_until": 160,
        },
        {
            "at": 67, "action": "subject_registration_attest",
            "actor": "c", "org_revision": "oc-1",
            "subject_registration_id": "r1t4-register-c",
            "registration_fingerprint": subject_digest,
            "registration_self_ref": "model://c/r1t4-own-self-declaration",
            "registration_goal_source_ref": "model://c/r1t4-own-first-goal",
            "registration_alternative_source_ref":
                "model://c/r1t4-independent-first-alternative",
            "registration_willingness": "WILLING",
        },
        *[
            {
                "at": at, "action": "subject_registration_review",
                "actor": actor, "org_revision": "oc-1",
                "subject_registration_id": "r1t4-register-c",
                "registration_fingerprint": subject_digest,
                "registration_decision": (
                    "OBJECT_MODEL_SOURCE" if objecting ==
                        f"subject-{actor}" else "SUPPORT_MODEL_SOURCE"
                ),
                "registration_decision_source_ref":
                    f"model://{actor}/r1t4-independent-subject-review",
            }
            for at, actor in ((68, "a"), (69, "b"))
        ],
        {
            "at": 70, "action": "subject_registration_apply",
            "actor": "op", "org_revision": "oc-1",
            "subject_registration_id": "r1t4-register-c",
            "registration_fingerprint": subject_digest,
        },
        {
            "at": 71, "action": "resource_registration_propose",
            "actor": "c", "org_revision": "oc-1",
            "resource_registration_id": "r1t4-register-rc",
            "resource_spec": deepcopy(rc_spec),
            "resource_fingerprint": resource_digest,
            "registration_resource_source_ref":
                "model://c/r1t4-rc-owner-capacity-declaration",
            "registration_valid_until": 160,
        },
        *[
            {
                "at": at, "action": "resource_registration_review",
                "actor": actor, "org_revision": "oc-1",
                "resource_registration_id": "r1t4-register-rc",
                "resource_fingerprint": resource_digest,
                "registration_decision": (
                    "OBJECT_MODEL_SOURCE" if objecting ==
                        f"resource-{actor}" else "SUPPORT_MODEL_SOURCE"
                ),
                "registration_decision_source_ref":
                    f"model://{actor}/r1t4-independent-resource-review",
            }
            for at, actor in ((72, "a"), (73, "b"))
        ],
        {
            "at": 74, "action": "resource_registration_apply",
            "actor": "op", "org_revision": "oc-1",
            "resource_registration_id": "r1t4-register-rc",
            "resource_fingerprint": resource_digest,
            "resource_spec": deepcopy(rc_spec),
        },
    ]
    if absent is not None:
        registration = [e for e in registration if not (
            e["action"] == absent[0] and e["actor"] == absent[1]
        )]
    data["events"].extend(registration)
    data["events"].sort(key=lambda x: x["at"])
    data["model_horizon"] += 9
    return data


def applied(out, action):
    return [e for e in reports(out, action) if e["outcome"] == "APPLIED"]


def test_r1t4_true_absent_initial_sme_and_resource_become_original_mesa_actor_and_capacity():
    data = new_original_enterprise_case()
    untouched = deepcopy(data)
    model = OperatorAKISModel(data)
    assert "c" not in model.qualitative.subjects
    assert "rc" not in model.qualitative.resources
    assert "c" not in model._by_id
    assert "rc" not in model.qualitative.capacity_ledger.specs
    out = model.execute()
    assert data == untouched
    assert out["counts"]["blocked"] == 0, [
        (e["at"], e["action"], e["reason"])
        for e in out["trace"] if e["outcome"] == "BLOCKED"
    ]
    assert "c" in model.qualitative.subjects
    assert "c" in model._by_id
    assert sum(agent.party_id == "c" for agent in model.parties) == 1
    assert model.qualitative.subjects["c"].kind == "SME"
    assert model.qualitative.resources["rc"] == "c"
    assert model.qualitative.capacity_ledger.specs["rc"].owner == "c"
    assert model.qualitative.capacity_ledger.specs["rc"].units == 1
    assert len(applied(out, "subject_registration_apply")) == 1
    assert len(applied(out, "resource_registration_apply")) == 1
    assert [r["actor"] for r in reports(out, "subject_registration_review")] == [
        "a", "b"
    ]
    assert [r["actor"] for r in reports(out, "resource_registration_review")] == [
        "a", "b"
    ]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert set(out["works"]["w3"]["consenting_principals"]) == {"a", "b", "c"}
    assert [s["declared_performer_owner"]
            for s in out["works"]["w3"]["technology"]["operations"]] == ["a", "c"]
    assert out["works"]["w3"]["technology"]["handoffs"][
        "required_edges"
    ][0]["state"] == "RECEIVED"
    assert out["works"]["w3"]["assurance"]["model_reported_met_count"] == 2
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "accepted_original_cross_owner_technology_routes_with_handoff_and_quality"
    ] == 1
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "all_nine_component_original_causal_closure_proven"
    ] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(data)) == out


@pytest.mark.parametrize("missing", [
    ("subject_registration_attest", "c"),
    ("subject_registration_review", "a"),
    ("subject_registration_review", "b"),
])
def test_r1t4_missing_independent_original_subject_evidence_cannot_create_sme(missing):
    model = OperatorAKISModel(new_original_enterprise_case(absent=missing))
    out = model.execute()
    assert len(applied(out, "subject_registration_apply")) == 0
    assert "c" not in model.qualitative.subjects
    assert "rc" not in model.qualitative.resources
    assert "c" not in model._by_id
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("party", ["a", "b"])
def test_r1t4_original_sme_objection_blocks_new_actor(party):
    model = OperatorAKISModel(new_original_enterprise_case(
        objecting=f"subject-{party}"
    ))
    out = model.execute()
    assert reports(out, "subject_registration_apply")[0]["reason"] == (
        "REGISTRATION_INDEPENDENT_REVIEW_OBJECTION"
    )
    assert "c" not in model.qualitative.subjects
    assert "c" not in model._by_id


@pytest.mark.parametrize("missing", [
    ("resource_registration_review", "a"),
    ("resource_registration_review", "b"),
])
def test_r1t4_missing_resource_independent_review_does_not_create_resource(missing):
    model = OperatorAKISModel(new_original_enterprise_case(absent=missing))
    out = model.execute()
    assert "c" in model.qualitative.subjects
    assert "c" in model._by_id
    assert "rc" not in model.qualitative.resources
    assert "rc" not in model.qualitative.capacity_ledger.specs
    assert len(applied(out, "resource_registration_apply")) == 0
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("party", ["a", "b"])
def test_r1t4_existing_owner_can_refuse_fabricated_model_resource(party):
    out = simulate(new_original_enterprise_case(
        objecting=f"resource-{party}"
    ))
    assert reports(out, "resource_registration_apply")[0]["reason"] == (
        "REGISTRATION_INDEPENDENT_REVIEW_OBJECTION"
    )
    assert "rc" not in out["resources"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t4_changed_resource_spec_after_independent_review_never_enters_original_ledger():
    d = new_original_enterprise_case()
    apply = next(r for r in d["events"]
                 if r["action"] == "resource_registration_apply")
    apply["resource_spec"]["capacity_units"] = 99
    model = OperatorAKISModel(d)
    out = model.execute()
    assert reports(out, "resource_registration_apply")[0]["reason"] == (
        "REGISTRATION_RESOURCE_CHANGED_AFTER_INDEPENDENT_REVIEW"
    )
    assert "rc" not in model.qualitative.resources
    assert "rc" not in model.qualitative.capacity_ledger.specs
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t4_foreign_source_cannot_impersonate_independent_original_candidate():
    d = new_original_enterprise_case()
    attestation = next(x for x in d["events"]
                       if x["action"] == "subject_registration_attest")
    attestation["registration_self_ref"] = "model://op/fake-c-identity"
    out = simulate(d)
    assert reports(out, "subject_registration_attest")[0]["reason"] == (
        "REGISTRATION_INDEPENDENT_SOURCE_OWNER_REQUIRED"
    )
    assert "c" not in out["subjects"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t4_foreign_resource_claim_cannot_overwrite_another_owner_property():
    d = new_original_enterprise_case()
    proposal = next(x for x in d["events"]
                    if x["action"] == "resource_registration_propose")
    proposal["resource_spec"]["owner"] = "a"
    proposal["resource_fingerprint"] = registration_fingerprint(
        proposal["resource_spec"]
    )
    out = simulate(d)
    assert reports(out, "resource_registration_propose")[0]["reason"] == (
        "REGISTRATION_COMPLETE_NEW_OWNER_RESOURCE_REQUIRED"
    )
    assert "rc" not in out["resources"]
    assert out["resources"]["ra"]["owner"] == "a"


def test_r1t4_registration_requires_preexisting_accepted_result_not_fictional_pilot():
    d = new_original_enterprise_case()
    propose = next(x for x in d["events"]
                   if x["action"] == "subject_registration_propose")
    propose["pilot_result_ref"] = "model://fictional-other-result"
    propose["registration_fingerprint"] = registration_fingerprint({
        "subject_registration_id": propose["subject_registration_id"],
        "new_subject": propose["new_subject"],
        "new_subject_kind": "SME",
        "pilot_work": propose["pilot_work"],
        "pilot_result_ref": propose["pilot_result_ref"],
        "pilot_decision_at": propose["pilot_decision_at"],
    })
    out = simulate(d)
    assert reports(out, "subject_registration_propose")[0]["reason"] == (
        "REGISTRATION_ACCEPTED_ORIGINAL_PILOT_REQUIRED"
    )
    assert "c" not in out["subjects"]


def test_r1t4_future_owner_may_not_predeclare_past_scientific_source():
    d = new_original_enterprise_case()
    source = next(x for x in d["general_akis"]["formation_phases"]
                  if x["owner"] == "c")
    source["available_at"] = 0
    with pytest.raises(InputError, match="FUTURE_ORIGINAL_SME_CANNOT_CLAIM_PAST_SOURCE"):
        OperatorAKISModel(d)


def test_r1t4_duplicate_accepted_subject_registration_is_not_second_agent():
    d = new_original_enterprise_case()
    row = next(x for x in d["events"] if x["action"] == "subject_registration_apply")
    clone = deepcopy(row)
    clone["at"] = max(r["at"] for r in d["events"]) + 1
    # The duplicate is tested AFTER all original Results, without deleting
    # the first resource application or changing the future Work preflight.
    d["events"].append(clone)
    d["events"].sort(key=lambda x: x["at"])
    d["model_horizon"] = max(d["model_horizon"], clone["at"] + 1)
    model = OperatorAKISModel(d)
    out = model.execute()
    assert reports(out, "subject_registration_apply")[-1]["reason"] == (
        "REGISTRATION_DUPLICATE_OR_PREEXISTING_SUBJECT"
    )
    assert sum(x.party_id == "c" for x in model.parties) == 1
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
