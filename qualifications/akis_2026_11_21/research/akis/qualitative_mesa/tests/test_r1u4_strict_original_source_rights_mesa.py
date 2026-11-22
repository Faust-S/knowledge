"""AKIS R1-U4: original strict KPB rights for new SME, asset and lifecycle.

Uses the SAME original ContextBasis source assertions, revisions, owner
updates, scope predicates, QualitativeAKIS, Work/Result and Mesa 3.5.2.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.context_basis import (
    DECISION_OPERATIONS, DECISION_PURPOSES, DECISION_SOURCE_FIELDS,
    DECISION_TARGET_FIELDS, QUALIFIED_ACTIONS,
)
from research.akis.qualitative_mesa.cooperation import (
    CooperationLink, _lifecycle_document,
)
from research.akis.qualitative_mesa.source_registration import (
    registration_fingerprint,
)
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_cooperation_change_to_work_mesa import prepare, accept_first_work


def e(at, action, actor, **more):
    return {"at": at, "action": action, "actor": actor, **more}


def accepted_result(out, name):
    return out["works"][name]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def rows(out, action):
    return [x for x in out["trace"] if x["action"] == action]


def _original_rights(data):
    """Source assertions all reside in the original ContextBasis, no new IAM."""
    sources = []
    rules = []
    work_rules = []
    seen = set()
    work_actor_uses = {}
    for ev in data["events"]:
        action = ev["action"]
        if action not in QUALIFIED_ACTIONS:
            continue
        work = ev.get("work")
        if work is None:
            continue
        work_actor_uses.setdefault((work, action), set()).add(ev["actor"])
    op_names = {
        "authorize": "ACCEPT", "consent": "ACCEPT",
        "commit": "ACCEPT", "start": "EXECUTE", "complete": "EXECUTE",
        "accept": "ACCEPT", "resubmit": "EXECUTE", "interest_update": "ACCEPT",
    }
    for (work, action), actors in sorted(work_actor_uses.items()):
        source_id = f"model://op/work-{work}-{action}-context"
        operation = op_names.get(action, "ACCEPT")
        purpose = f"AKIS_WORK_{work}"
        sources.append({
            "id": source_id, "owner": "op", "revision": "rev-1",
            "status": "CONFIRMED", "usable_by": sorted(actors),
            "valid_until": 180, "core": "institutional",
            "purposes": [purpose], "operations": [operation],
        })
        work_rules.append({
            "work": work, "action": action,
            "sources": [source_id], "expected_revisions": ["rev-1"],
            "core": "institutional", "purpose": purpose,
            "operation": operation,
        })
    for ev in data["events"]:
        action = ev["action"]
        if action not in DECISION_SOURCE_FIELDS:
            continue
        actor = ev["actor"]
        target = ev[DECISION_TARGET_FIELDS[action]]
        right_ref = f"model://{actor}/r1u4-{action}-{ev['at']}"
        assert len(right_ref) <= 128
        ev["source_rights_ref"] = right_ref
        originals = [
            ev[k] for k in DECISION_SOURCE_FIELDS[action]
            if k in ev
        ]
        if action == "cooperation_lifecycle_apply" and (
                ev.get("lifecycle_kind") == "RECONSTITUTE"):
            originals.append(ev["new_link_source_ref"])
        refs = list(dict.fromkeys([right_ref, *originals]))
        purpose = DECISION_PURPOSES[action]
        operation = DECISION_OPERATIONS[action]
        core = "operator" if actor == "op" else "corporate"
        for ref in refs:
            assert ref.startswith(f"model://{actor}/"), (action, actor, ref)
            if ref not in seen:
                seen.add(ref)
                sources.append({
                    "id": ref, "owner": actor, "revision": "rev-1",
                    "status": "CONFIRMED", "usable_by": [actor],
                    "valid_until": 180, "core": core,
                    "purposes": [purpose], "operations": [operation],
                })
        rules.append({
            "target": target, "action": action, "actor": actor,
            "sources": refs, "expected_revisions": ["rev-1"] * len(refs),
            "core": core, "purpose": purpose, "operation": operation,
        })
    data["context_evidence"] = {
        "strict": True, "sources": sources, "requirements": work_rules,
        "decision_requirements": rules,
    }
    return data


def registration_case():
    data = prepare()
    subjects_before = {x["id"] for x in data["subjects"]}
    assert "c" not in subjects_before
    assert "rc" not in {x["id"] for x in data["resources"]}
    resource = {
        "id": "rc", "owner": "c", "availability": "AVAILABLE",
        "capacity_units": 1, "capacity_unit": "machine", "site": "plant-c",
    }
    claim = {
        "subject_registration_id": "admit-c", "new_subject": "c",
        "new_subject_kind": "SME", "pilot_work": "w1",
        "pilot_result_ref": "model://a/first-execution",
        "pilot_decision_at": 8,
    }
    subject_sha = registration_fingerprint(claim)
    resource_sha = registration_fingerprint(resource)
    data["events"] = accept_first_work() + [
        e(9, "subject_registration_propose", "op",
          org_revision="oc-1", **claim,
          registration_source_ref="model://op/admit-c-proposal",
          registration_valid_until=70,
          registration_fingerprint=subject_sha),
        e(10, "subject_registration_attest", "c",
          org_revision="oc-1", subject_registration_id="admit-c",
          registration_fingerprint=subject_sha,
          registration_self_ref="model://c/own-identity",
          registration_goal_source_ref="model://c/own-goal",
          registration_alternative_source_ref="model://c/own-alternative",
          registration_willingness="WILLING"),
        e(11, "subject_registration_review", "a",
          org_revision="oc-1", subject_registration_id="admit-c",
          registration_fingerprint=subject_sha,
          registration_decision="SUPPORT_MODEL_SOURCE",
          registration_decision_source_ref="model://a/admit-c-review"),
        e(12, "subject_registration_review", "b",
          org_revision="oc-1", subject_registration_id="admit-c",
          registration_fingerprint=subject_sha,
          registration_decision="SUPPORT_MODEL_SOURCE",
          registration_decision_source_ref="model://b/admit-c-review"),
        e(13, "subject_registration_apply", "op",
          org_revision="oc-1", subject_registration_id="admit-c",
          registration_fingerprint=subject_sha),
        e(14, "resource_registration_propose", "c",
          org_revision="oc-1", resource_registration_id="register-rc",
          resource_spec=deepcopy(resource),
          resource_fingerprint=resource_sha,
          registration_resource_source_ref="model://c/own-rc",
          registration_valid_until=70),
        e(15, "resource_registration_review", "a",
          org_revision="oc-1", resource_registration_id="register-rc",
          resource_fingerprint=resource_sha,
          registration_decision="SUPPORT_MODEL_SOURCE",
          registration_decision_source_ref="model://a/rc-review"),
        e(16, "resource_registration_review", "b",
          org_revision="oc-1", resource_registration_id="register-rc",
          resource_fingerprint=resource_sha,
          registration_decision="SUPPORT_MODEL_SOURCE",
          registration_decision_source_ref="model://b/rc-review"),
        e(17, "resource_registration_apply", "op",
          org_revision="oc-1", resource_registration_id="register-rc",
          resource_fingerprint=resource_sha,
          resource_spec=deepcopy(resource)),
        e(18, "request", "c", work_spec={
            "id": "w2", "customer": "c", "resource": "rc",
            "source_revision": "w2-r1", "slot_start": 40, "slot_end": 50,
            "requires_accepted": ["w1"],
        }),
        e(19, "offer", "op", work="w2"),
        e(20, "authorize", "op", work="w2"),
        e(21, "consent", "c", work="w2",
          source_revision="w2-r1", org_revision="oc-1"),
        e(22, "commit", "op", work="w2"),
        e(23, "start", "c", work="w2"),
        e(24, "complete", "c", work="w2", result_ref="model://c/second-result"),
        e(25, "accept", "c", work="w2"),
    ]
    data["model_horizon"] = 28
    return _original_rights(data)


def lifecycle_case():
    data = prepare()
    data["resources"].append({
        "id": "rb", "owner": "b", "availability": "AVAILABLE",
    })
    raw = data["cooperation_links"][0]
    link = CooperationLink(
        raw["id"], raw["purpose"], raw["coordinator"],
        tuple(raw["participants"]), tuple(raw["works"]),
        tuple(raw["mechanisms"]), raw["source_ref"], raw["source_revision"],
    )
    dissolve_sha = _lifecycle_document(
        link, "DISSOLVE", "w1",
        "model://a/first-execution", 8, ()
    )
    restore_sha = _lifecycle_document(
        link, "RECONSTITUTE", "w1",
        "model://a/first-execution", 8, ("b", "op")
    )
    data["events"] = accept_first_work() + [
        e(9, "request", "b",
          cooperation_link="net", cooperation_source_revision="n-1",
          work_spec={
              "id": "w2", "customer": "b", "resource": "ra",
              "source_revision": "d-2", "slot_start": 50, "slot_end": 60,
              "requires_accepted": ["w1"],
          }),
        e(10, "offer", "op", work="w2"),
        e(11, "authorize", "op", work="w2"),
        e(12, "consent", "a", work="w2",
          source_revision="d-2", org_revision="oc-1"),
        e(13, "consent", "b", work="w2",
          source_revision="d-2", org_revision="oc-1"),
        e(14, "commit", "op", work="w2"),
        e(15, "cooperation_lifecycle_propose", "b",
          org_revision="oc-1", cooperation_link="net",
          cooperation_source_revision="n-1",
          lifecycle_id="close-net", lifecycle_kind="DISSOLVE",
          lifecycle_fingerprint=dissolve_sha,
          lifecycle_source_ref="model://b/close-net",
          lifecycle_valid_until=80,
          lifecycle_new_participants=[],
          pilot_work="w1", pilot_result_ref="model://a/first-execution",
          pilot_decision_at=8),
        *[
            e(16 + i, "cooperation_lifecycle_response", who,
              org_revision="oc-1", cooperation_link="net",
              cooperation_source_revision="n-1",
              lifecycle_id="close-net", lifecycle_fingerprint=dissolve_sha,
              lifecycle_decision="SUPPORT_MODEL_PROPOSAL",
              lifecycle_response_source_ref=f"model://{who}/close-review")
            for i, who in enumerate(("a", "b", "op"))
        ],
        e(19, "cooperation_lifecycle_apply", "b",
          org_revision="oc-1", cooperation_link="net",
          cooperation_source_revision="n-1",
          lifecycle_id="close-net", lifecycle_kind="DISSOLVE",
          lifecycle_fingerprint=dissolve_sha),
        e(20, "cooperation_lifecycle_propose", "b",
          org_revision="oc-1", cooperation_link="net",
          cooperation_source_revision="n-1",
          lifecycle_id="restore-net", lifecycle_kind="RECONSTITUTE",
          lifecycle_fingerprint=restore_sha,
          lifecycle_source_ref="model://b/restore-net",
          lifecycle_valid_until=80, lifecycle_new_participants=["b", "op"],
          pilot_work="w1", pilot_result_ref="model://a/first-execution",
          pilot_decision_at=8),
        e(21, "cooperation_lifecycle_response", "b",
          org_revision="oc-1", cooperation_link="net",
          cooperation_source_revision="n-1",
          lifecycle_id="restore-net", lifecycle_fingerprint=restore_sha,
          lifecycle_decision="SUPPORT_MODEL_PROPOSAL",
          lifecycle_response_source_ref="model://b/restore-review"),
        e(22, "cooperation_lifecycle_response", "op",
          org_revision="oc-1", cooperation_link="net",
          cooperation_source_revision="n-1",
          lifecycle_id="restore-net", lifecycle_fingerprint=restore_sha,
          lifecycle_decision="SUPPORT_MODEL_PROPOSAL",
          lifecycle_response_source_ref="model://op/restore-review"),
        e(23, "cooperation_lifecycle_apply", "b",
          org_revision="oc-1", cooperation_link="net",
          cooperation_source_revision="n-1",
          lifecycle_id="restore-net", lifecycle_kind="RECONSTITUTE",
          lifecycle_fingerprint=restore_sha,
          new_link_id="net-2", new_link_revision="n-2",
          new_link_source_ref="model://b/new-net-source"),
        e(24, "start", "a", work="w2"),
        e(25, "complete", "a", work="w2",
          result_ref="model://a/w2-completed-under-old-obligation"),
        e(26, "accept", "b", work="w2"),
        e(27, "request", "b", cooperation_link="net-2",
          cooperation_source_revision="n-2",
          work_spec={
              "id": "w3", "customer": "b", "resource": "rb",
              "source_revision": "d-3", "slot_start": 70, "slot_end": 80,
              "requires_accepted": ["w2"],
          }),
        e(28, "offer", "op", work="w3"),
        e(29, "authorize", "op", work="w3"),
        e(30, "consent", "b", work="w3",
          source_revision="d-3", org_revision="oc-1"),
        e(31, "commit", "op", work="w3"),
        e(32, "start", "b", work="w3"),
        e(33, "complete", "b", work="w3",
          result_ref="model://b/w3-new-relation-result"),
        e(34, "accept", "b", work="w3"),
    ]
    data["model_horizon"] = 38
    return _original_rights(data)


def test_strict_kpb_independently_registers_new_enterprise_and_own_resource():
    d = registration_case()
    copy = deepcopy(d)
    out = simulate(d)
    assert d == copy
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"])
        for x in out["trace"] if x["outcome"] == "BLOCKED"
    ]
    assert "c" in out["subjects"]
    assert out["resources"]["rc"]["owner"] == "c"
    assert accepted_result(out, "w1")
    assert accepted_result(out, "w2")
    assert rows(out, "subject_registration_apply")[0]["outcome"] == "APPLIED"
    assert rows(out, "resource_registration_apply")[0]["outcome"] == "APPLIED"
    assert out["context_basis"]["strict"] is True


def test_strict_kpb_dissolves_and_reconstitutes_without_discarding_old_accepted_work():
    d = lifecycle_case()
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"])
        for x in out["trace"] if x["outcome"] == "BLOCKED"
    ]
    assert all(accepted_result(out, w) for w in ("w1", "w2", "w3"))
    links = {x["id"]: x for x in out["cooperation"]["links"]}
    assert links["net"]["future_cooperation_status"] == "DISSOLVED_FOR_FUTURE_WORK"
    assert links["net-2"]["original_participants"] == ["b", "op"]
    assert links["net"]["work_results"]["w2"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert links["net-2"]["work_results"]["w3"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("phase,missing_actor", [
    ("subject_registration_review", "a"),
    ("resource_registration_review", "b"),
])
def test_strict_registration_missing_principal_right_never_applies(phase, missing_actor):
    d = registration_case()
    d["context_evidence"]["decision_requirements"] = [
        r for r in d["context_evidence"]["decision_requirements"]
        if not (r["action"] == phase and r["actor"] == missing_actor)
    ]
    out = simulate(d)
    blocked = next(
        x for x in rows(out, phase) if x["actor"] == missing_actor
    )
    assert blocked["reason"] == "CONTEXT_DECISION_RIGHTS_REQUIREMENT_MISSING"
    if phase.startswith("subject_"):
        assert rows(out, "subject_registration_apply")[0]["outcome"] == "BLOCKED"
        assert "c" not in out["subjects"]
    else:
        assert rows(out, "resource_registration_apply")[0]["outcome"] == "BLOCKED"
        assert "rc" not in out["resources"]
    assert accepted_result(out, "w1")


def test_strict_subject_registration_blocks_revoked_prior_founder_source():
    d = registration_case()
    affected = next(
        x for x in d["events"]
        if x["action"] == "subject_registration_review" and x["actor"] == "a"
    )
    for row in d["events"]:
        if row["at"] >= 13:
            row["at"] += 1
    d["events"].append(e(
        13, "source_update", "a",
        source=affected["registration_decision_source_ref"],
        status="DISPROVED", expected_revision="rev-1", new_revision="rev-2"
    ))
    d["events"].sort(key=lambda x: x["at"])
    d["model_horizon"] += 1
    out = simulate(d)
    assert rows(out, "source_update")[0]["outcome"] == "APPLIED"
    assert rows(out, "subject_registration_apply")[0]["reason"] == (
        "CONTEXT_REVISION_STALE"
    )
    assert "c" not in out["subjects"]
    assert accepted_result(out, "w1")


def test_strict_resource_attestation_without_current_owner_right_fails_closed():
    d = registration_case()
    proposal = next(
        x for x in d["events"] if x["action"] == "resource_registration_propose"
    )
    proposal["source_rights_ref"] = "model://op/borrowed-right"
    out = simulate(d)
    assert rows(out, "resource_registration_propose")[0]["reason"] == (
        "CONTEXT_DECISION_INDEPENDENT_OWNER_RIGHT_MISSING"
    )
    assert "rc" not in out["resources"]
    assert accepted_result(out, "w1")


def test_strict_lifecycle_cannot_use_unqualified_operation_scope():
    d = lifecycle_case()
    operation = next(
        x for x in d["events"]
        if x["action"] == "cooperation_lifecycle_apply"
        and x["lifecycle_kind"] == "DISSOLVE"
    )
    original = operation["source_rights_ref"]
    source = next(
        x for x in d["context_evidence"]["sources"]
        if x["id"] == original
    )
    source["operations"] = ["READ"]
    out = simulate(d)
    assert rows(out, "cooperation_lifecycle_apply")[0]["reason"] == (
        "CONTEXT_OPERATION_NOT_PERMITTED"
    )
    assert accepted_result(out, "w2")
    assert all(x["id"] != "net-2" for x in out["cooperation"]["links"])


def test_strict_lifecycle_rechecks_revoked_old_independent_response():
    d = lifecycle_case()
    response = next(
        x for x in d["events"]
        if x["action"] == "cooperation_lifecycle_response"
        and x["actor"] == "a"
    )
    for row in d["events"]:
        if row["at"] >= 19:
            row["at"] += 1
    d["events"].append(e(
        19, "source_update", "a",
        source=response["lifecycle_response_source_ref"],
        status="DISPROVED", expected_revision="rev-1", new_revision="rev-2"
    ))
    d["events"].sort(key=lambda x: x["at"])
    d["model_horizon"] += 1
    out = simulate(d)
    assert rows(out, "cooperation_lifecycle_apply")[0]["reason"] == (
        "CONTEXT_REVISION_STALE"
    )
    assert accepted_result(out, "w2")
    assert all(x["id"] != "net-2" for x in out["cooperation"]["links"])


def test_strict_context_missing_source_eligibility_cannot_be_declared_after_result():
    d = registration_case()
    original = next(
        x for x in d["context_evidence"]["decision_requirements"]
        if x["action"] == "subject_registration_attest"
    )
    original["sources"] = original["sources"][:-1]
    original["expected_revisions"] = original["expected_revisions"][:-1]
    out = simulate(d)
    assert rows(out, "subject_registration_attest")[0]["reason"] == (
        "CONTEXT_DECISION_ORIGINAL_OWNER_SOURCE_UNQUALIFIED"
    )
    assert "c" not in out["subjects"]


def test_strict_owner_sources_not_authenticated_real_documents():
    out = simulate(registration_case())
    basis = out["context_basis"]
    assert basis["authenticated_documents"] is False
    assert basis["strict"] is True
    assert len(basis["original_decision_source_rights"]) >= 9
    assert all(not x["real_identity_or_document_right_authenticated"]
               for x in basis["original_decision_source_rights"])



@pytest.mark.parametrize("change", ["missing_expected", "same_revision"])
def test_strict_rights_owner_update_requires_cas_and_new_revision(change):
    d = registration_case()
    for ev in d["events"]:
        if ev["at"] >= 13:
            ev["at"] += 1
    owner = next(
        x for x in d["events"]
        if x["action"] == "subject_registration_review" and x["actor"] == "a"
    )
    patch = e(
        13, "source_update", "a",
        source=owner["registration_decision_source_ref"],
        status="DISPROVED",
        expected_revision="rev-1", new_revision="rev-2",
    )
    if change == "missing_expected":
        del patch["expected_revision"]
    else:
        patch["new_revision"] = "rev-1"
    d["events"].append(patch)
    d["events"].sort(key=lambda x: x["at"])
    d["model_horizon"] += 1
    out = simulate(d)
    assert rows(out, "source_update")[0]["reason"] == (
        "CONTEXT_OWNER_RIGHTS_COMPARE_AND_SET_REQUIRED"
        if change == "missing_expected" else
        "CONTEXT_OWNER_RIGHTS_FRESH_REVISION_REQUIRED"
    )
    # Rejected update must not change the source used for independent
    # original approval and may not undo prior accepted Result.
    assert rows(out, "subject_registration_apply")[0]["outcome"] == "APPLIED"
    assert rows(out, "resource_registration_apply")[0]["outcome"] == "APPLIED"
    assert accepted_result(out, "w1")
    assert accepted_result(out, "w2")


def test_strict_independent_review_source_expires_before_registration_apply():
    d = registration_case()
    target = next(
        x for x in d["events"]
        if x["action"] == "subject_registration_review" and x["actor"] == "a"
    )
    source = next(
        x for x in d["context_evidence"]["sources"]
        if x["id"] == target["registration_decision_source_ref"]
    )
    source["valid_until"] = 12
    out = simulate(d)
    assert rows(out, "subject_registration_review")[0]["outcome"] == "APPLIED"
    assert rows(out, "subject_registration_apply")[0]["reason"] == (
        "CONTEXT_SOURCE_EXPIRED"
    )
    assert "c" not in out["subjects"]
    assert accepted_result(out, "w1")


def test_strict_unshared_principal_source_cannot_be_used_for_registration_review():
    d = registration_case()
    row = next(
        x for x in d["events"]
        if x["action"] == "resource_registration_review" and x["actor"] == "b"
    )
    source = next(
        x for x in d["context_evidence"]["sources"]
        if x["id"] == row["source_rights_ref"]
    )
    source["usable_by"] = ["op"]
    out = simulate(d)
    assert next(
        x for x in rows(out, "resource_registration_review")
        if x["actor"] == "b"
    )["reason"] == "CONTEXT_USE_NOT_PERMITTED"
    assert rows(out, "resource_registration_apply")[0]["outcome"] == "BLOCKED"
    assert "rc" not in out["resources"]
    assert accepted_result(out, "w1")


def test_strict_owner_new_confirmed_revision_still_requires_new_decision():
    d = registration_case()
    for ev in d["events"]:
        if ev["at"] >= 13:
            ev["at"] += 1
    owner = next(
        x for x in d["events"]
        if x["action"] == "subject_registration_review" and x["actor"] == "a"
    )
    d["events"].append(e(
        13, "source_update", "a",
        source=owner["registration_decision_source_ref"],
        status="CONFIRMED", expected_revision="rev-1", new_revision="rev-2",
    ))
    d["events"].sort(key=lambda x: x["at"])
    d["model_horizon"] += 1
    out = simulate(d)
    assert rows(out, "source_update")[0]["outcome"] == "APPLIED"
    assert rows(out, "subject_registration_apply")[0]["reason"] == (
        "CONTEXT_REVISION_STALE"
    )
    assert "c" not in out["subjects"]
    assert accepted_result(out, "w1")


def test_strict_original_registered_asset_source_owner_cannot_be_substituted():
    d = registration_case()
    original = next(
        x for x in d["events"]
        if x["action"] == "resource_registration_propose"
    )
    source = next(
        x for x in d["context_evidence"]["sources"]
        if x["id"] == original["registration_resource_source_ref"]
    )
    source["owner"] = "op"
    out = simulate(d)
    assert rows(out, "resource_registration_propose")[0]["reason"] == (
        "CONTEXT_DECISION_ORIGINAL_OWNER_SOURCE_UNQUALIFIED"
    )
    assert "rc" not in out["resources"]
    assert accepted_result(out, "w1")



def test_strict_kpb_new_enterprise_original_nine_component_witness_needs_result():
    from .test_general_system_mesa_integration import design
    d = registration_case()
    d["general_akis"] = design()
    out = simulate(d)
    private = out["general_akis_private_cycle_evidence"][
        "strict_kpb_original_new_enterprise_resource_accepted_result"
    ]
    shared = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert len(private) == 1
    assert private[0]["new_original_enterprise"] == "c"
    assert private[0]["registered_original_owned_resource"] == "rc"
    assert private[0]["new_original_accepted_work"] == "w2"
    assert shared[
        "strict_kpb_source_qualified_new_enterprise_accepted_result_count"
    ] == 1
    assert shared[
        "strict_kpb_source_qualified_reconstitution_accepted_result_count"
    ] == 0
    assert not shared["all_nine_component_original_causal_closure_proven"]
    assert not shared["full_real_lifecycle_or_causal_value_added_proven"]


def test_strict_kpb_registered_enterprise_without_result_is_not_reproduction():
    from .test_general_system_mesa_integration import design
    d = registration_case()
    d["events"] = [
        x for x in d["events"]
        if not (x["action"] == "accept" and x.get("work") == "w2")
    ]
    d["general_akis"] = design()
    out = simulate(d)
    shared = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert out["works"]["w2"]["result"] == "SUBMITTED"
    assert shared[
        "strict_kpb_source_qualified_new_enterprise_accepted_result_count"
    ] == 0
    assert out["general_akis_private_cycle_evidence"][
        "strict_kpb_original_new_enterprise_resource_accepted_result"
    ] == []
    assert accepted_result(out, "w1")


def test_strict_kpb_restored_relation_nine_component_witness_needs_new_result():
    from .test_general_system_mesa_integration import design
    d = lifecycle_case()
    d["general_akis"] = design()
    out = simulate(d)
    shared = out["general_akis_model"]["system_causal_cycle_feedback"]
    private = out["general_akis_private_cycle_evidence"][
        "strict_kpb_original_reconstitution_accepted_result"
    ]
    assert shared[
        "strict_kpb_source_qualified_reconstitution_accepted_result_count"
    ] == 1
    assert len(private) == 1
    assert private[0]["restored_original_relation"] == "net-2"
    assert private[0]["outstanding_original_work_at_dissolution"] == ["w2"]
    assert private[0]["new_original_accepted_work_ids"] == ["w3"]
    assert shared[
        "previously_outstanding_original_work_accepted_after_dissolution"
    ] == 1
    assert not shared["all_nine_component_original_causal_closure_proven"]


def test_strict_kpb_lifecycle_without_new_result_cannot_count_reconstitution():
    from .test_general_system_mesa_integration import design
    d = lifecycle_case()
    d["events"] = [
        x for x in d["events"]
        if not (x["action"] == "accept" and x.get("work") == "w3")
    ]
    d["general_akis"] = design()
    out = simulate(d)
    shared = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert accepted_result(out, "w2")
    assert out["works"]["w3"]["result"] == "SUBMITTED"
    assert shared[
        "strict_kpb_source_qualified_reconstitution_accepted_result_count"
    ] == 0
    assert out["general_akis_private_cycle_evidence"][
        "strict_kpb_original_reconstitution_accepted_result"
    ] == []
    assert not shared["all_nine_component_original_causal_closure_proven"]
