"""AKIS R1-P: one original Mesa witnesses competent learning, owner
capability adoption, fresh coalition consultation and later accepted Work.

All evidence is MODEL_ONLY; measured-looking observations remain declared,
not actual physical output, legal rights, independent profit or contracts.
"""
from copy import deepcopy

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1o_result_conditioned_cooperation_review_mesa import r1o_case
from .test_r1l_post_result_original_reproduction_mesa import find
from .test_r1_formation_original_gates_mesa import trace_for


def r1p_case(*, adopt=True):
    d = r1o_case()
    g = d["general_akis"]
    g["enforce_model_result_conditioned_capability_cooperation"] = True
    # All R1-I/O source gates must remain ORIGINAL, with a later bounded
    # validity window for a THIRD original cycle in the SAME scheduler.
    for category in ("goals", "formation_phases", "context_cores",
                     "agent_functions", "organizational_code"):
        for record in g[category]:
            record["expires_at"] = 160
    for source in d["context_evidence"]["sources"]:
        source["valid_until"] = 160

    # One owner, one original productive resource, two already accepted
    # comparable Results. The claim is NOT a verified productivity increase.
    d["competence_reuse_evidence"] = [{
        "id": "reuse-r1p", "prior_work": "w1", "later_work": "w2",
        "actor": "a", "prior_result_ref": "model://w1-result",
        "competence_ref": "model://a/learned-after-two-results",
        "source_id": "experience-r1p-a", "source_revision": "experience-v1",
        "applied_at": 62, "kind": "TECHNOLOGY",
        "metric": "LABOR_TIME_PER_UNIT", "direction": "LOWER_IS_BETTER",
        "independent_baseline": {
            "source_ref": "model://a/r1p-baseline", "source_revision": "v1",
            "value": "10.0000", "unit": "hours/unit",
            "quantity": "100.0000", "scope": "same-comparable-service",
            "quality_basis": "model-original-quality",
        },
        "subsequent_observation": {
            "source_ref": "model://a/r1p-subsequent", "source_revision": "v1",
            "value": "8.0000", "unit": "hours/unit",
            "quantity": "100.0000", "scope": "same-comparable-service",
            "quality_basis": "model-original-quality",
        },
    }]
    d["context_evidence"]["sources"].extend([
        {
            "id": "experience-r1p-a", "owner": "a",
            "revision": "experience-v1", "status": "CONFIRMED",
            "usable_by": ["a"], "core": "corporate",
            "purposes": ["competence-reuse"], "operations": ["DERIVE"],
            "valid_from": 0, "valid_until": 160,
        },
        {
            "id": "quality-r1p-b", "owner": "b",
            "revision": "quality-v1", "status": "CONFIRMED",
            "usable_by": ["b"], "core": "corporate",
            "purposes": ["quality-verification"], "operations": ["ACCEPT"],
            "valid_from": 0, "valid_until": 160,
        },
        {
            "id": "capability-r1p-a", "owner": "a",
            "revision": "capacity-v1", "status": "CONFIRMED",
            "usable_by": ["a"], "core": "corporate",
            "purposes": ["capability-adoption"], "operations": ["DERIVE"],
            "valid_from": 0, "valid_until": 160,
        },
    ])
    d["competence_measurement_protocols"] = [{
        "claim_id": "reuse-r1p", "assessor": "b",
        "source_id": "quality-r1p-b", "source_revision": "quality-v1",
        "standard_ref": "model://b/r1p-original-quality-standard",
        "method_ref": "model://b/r1p-comparable-method",
        "calibration_chain_ref": "model://b/r1p-model-calibration",
        "uncertainty_before": "0.2000", "uncertainty_after": "0.3000",
        "assessment_at": 67,
    }]
    d["capability_adoptions"] = [{
        "id": "capacity-r1p-a", "resource": "ra", "owner": "a",
        "reuse_claim": "reuse-r1p", "source_id": "capability-r1p-a",
        "source_revision": "capacity-v1",
        "source_ref": "model://a/r1p-future-capacity-declaration",
        "declared_units": 2, "initial_units": 1,
        "resource_unit": "UNIT", "from_slot": 106, "to_slot": 120,
        "authorized_future_works": ["w3"],
        "future_use_source_id": None, "future_use_source_revision": None,
    }]

    # Transfer the actual SECOND Work's complete original preparation,
    # agent-review, independent interest, consent and result path to w3.
    work2_request = next(e for e in d["events"]
                         if e["action"] == "request"
                         and e["work_spec"]["id"] == "w2")
    next_spec = deepcopy(work2_request["work_spec"])
    next_spec.update(
        id="w3", source_revision="d-3",
        slot_start=106, slot_end=120, requires_accepted=["w2"],
        resource_requirements=[{"resource": "ra", "units": 2}],
    )
    # A source-qualified Work with two units must use a later owner-adopted
    # capacity projection, never the declared baseline (one unit).
    d["resources"][0]["capacity_unit"] = "UNIT"
    d["resources"][0]["capacity_units"] = 1
    g["agent_functions"].append({
        **deepcopy(next(row for row in g["agent_functions"]
                        if row["id"] == "approval-w2")),
        "id": "approval-w3", "work": "w3", "work_revision": "d-3",
        "source_ref": "model://op/packet-approval-w3",
    })
    d["context_evidence"]["requirements"].append({
        "work": "w3", "action": "commit", "sources": ["commit-proof"],
        "expected_revisions": ["commit-r1"], "core": "corporate",
        "purpose": "decision-review", "operation": "ACCEPT",
    })
    originals = []
    for item in d["events"]:
        if item["at"] < 38 or (
            item.get("work") != "w2" and
            not (item["action"] == "request" and
                 item["work_spec"]["id"] == "w2")
        ):
            continue
        row = deepcopy(item)
        row["at"] += 45
        if row.get("work") == "w2":
            row["work"] = "w3"
        if row["action"] == "request":
            row["work_spec"] = deepcopy(next_spec)
            row["pilot_work"] = "w2"
            row["change_id"] = "chg-w2"
            row["emergent_goal_source_ref"] = (
                "model://b/goal-after-second-original-result"
            )
        if row.get("source_revision") == "d-2":
            row["source_revision"] = "d-3"
        if row.get("function_id") == "approval-w2":
            row["function_id"] = "approval-w3"
        if row.get("function_source_ref") == "model://op/packet-approval-w2":
            row["function_source_ref"] = "model://op/packet-approval-w3"
        if row.get("review_source_ref") == "model://b/independent-review-w2":
            row["review_source_ref"] = "model://b/independent-review-w3"
        if "prepared_at" in row:
            row["prepared_at"] += 45
        if row["action"] == "complete":
            row["result_ref"] = "model://w3-result"
        if row["action"] == "interest_update":
            row["pilot_work"] = "w2"
            row["pilot_result_ref"] = "model://w2-result"
            row["pilot_decision_at"] = 65
            row["interest_evidence_ref"] = (
                f"model://{row['actor']}/w3-independent-interest"
            )
            row["interest_valid_until"] = 160
        originals.append(row)

    d["events"].extend([
        {
            "at": 66, "action": "participation_status", "actor": "a",
            "org_revision": "oc-1", "cooperation_link": "l1",
            "cooperation_source_revision": "rel-1",
            "new_participation": "OPEN_TO_NEW_WORK",
            "economic_channel": "TRANSACTION_COST",
            "participation_evidence_ref": "model://a/second-result-evaluation",
            "evaluated_work": "w2", "evaluated_work_revision": "d-2",
            "evaluated_result_ref": "model://w2-result",
            "evaluated_decision_at": 65,
            "evaluation_verdict": "FAVOURABLE_DECLARED",
            "formation_phase_source_ref": "model://a/formation-8",
        },
        {
            "at": 67, "action": "participation_status", "actor": "b",
            "org_revision": "oc-1", "cooperation_link": "l1",
            "cooperation_source_revision": "rel-1",
            "new_participation": "OPEN_TO_NEW_WORK",
            "economic_channel": "TRANSACTION_COST",
            "participation_evidence_ref": "model://b/second-result-evaluation",
            "evaluated_work": "w2", "evaluated_work_revision": "d-2",
            "evaluated_result_ref": "model://w2-result",
            "evaluated_decision_at": 65,
            "evaluation_verdict": "FAVOURABLE_DECLARED",
            "formation_phase_source_ref": "model://b/formation-8",
        },
        {
            "at": 69, "action": "need_emerge", "actor": "b", "work": "w3",
            "work_source_revision": "d-3", "org_revision": "oc-1",
            "goal_source_ref": "model://b/goal-after-second-original-result",
            "goal_expires_at": 160, "goal_objective": "COMPETENCE",
            "goal_priority": 2, "cooperation_link": "l1",
            "cooperation_source_revision": "rel-1", "pilot_work": "w2",
            "pilot_result_ref": "model://w2-result",
            "pilot_decision_at": 65,
        },
        {
            "at": 70, "action": "cooperation_change_propose", "actor": "a",
            "org_revision": "oc-1", "cooperation_link": "l1",
            "cooperation_source_revision": "rel-1", "change_id": "chg-w2",
            "change_kind": "REVISE_RESOURCE_COOPERATION",
            "economic_channel": "TRANSACTION_COST",
            "change_source_ref": "model://a/proposal-after-capability-adoption",
            "pilot_work": "w2", "pilot_result_ref": "model://w2-result",
            "pilot_decision_at": 65,
        },
    ] + [
        {
            "at": t, "action": "cooperation_change_response", "actor": actor,
            "org_revision": "oc-1", "cooperation_link": "l1",
            "cooperation_source_revision": "rel-1", "change_id": "chg-w2",
            "change_decision": "SUPPORT_MODEL_PROPOSAL",
            "change_source_ref": f"model://{actor}/proposal-after-w2-{t}",
        } for t, actor in ((71, "a"), (72, "b"), (73, "op"))
    ])
    if adopt:
        d["events"].append({
            "at": 68, "action": "adopt_capability", "actor": "a",
            "resource": "ra", "capability": "capacity-r1p-a",
            "source_revision": "capacity-v1", "org_revision": "oc-1",
            "expected_capacity_revision": "BASE",
        })
    d["events"].extend(originals)
    d["events"].sort(key=lambda e: e["at"])
    d["model_horizon"] = 134
    return d


def test_r1p_original_three_work_cycle_unites_competence_owner_adoption_and_review():
    d = r1p_case()
    initial = deepcopy(d)
    out = simulate(d)
    assert d == initial
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"])
        for x in out["trace"] if x["outcome"] == "BLOCKED"
    ]
    assert [out["works"][w]["result"] for w in ("w1", "w2", "w3")] == [
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    ] * 3
    assert find(out, "adopt_capability", actor="a")[0]["outcome"] == "APPLIED"
    assert find(out, "request", work="w3")[0]["outcome"] == "APPLIED"
    assert find(out, "commit", work="w3")[0]["outcome"] == "APPLIED"
    assert out["capability_dynamics"]["original_owner_adopted_count"] == 1
    cycle = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert cycle["same_original_causal_chain_includes_capability_and_institutional_change"]
    assert cycle["owner_capability_and_institutional_reproduction_link_count"] == 1
    witness = out["general_akis_private_cycle_evidence"][
        "owner_capability_and_institutional_reproduction_links"
    ]
    assert len(witness) == 1
    assert witness[0]["preceding_original_result"] == "w2"
    assert witness[0]["following_original_accepted_work"] == "w3"
    assert witness[0]["original_owner"] == "a"
    assert witness[0]["actual_capacity_or_economic_effect_verified"] is False
    assert out["general_akis_model"]["result_capability_cooperation_gate"][
        "opted_in"
    ] is True
    assert out["capability_dynamics"]["declarations"][0][
        "actual_resource_capacity_or_causal_learning_verified"
    ] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == out


def test_r1p_owner_declared_learning_without_adoption_never_creates_capacity():
    d = r1p_case(adopt=False)
    out = simulate(d)
    assert out["capability_dynamics"]["original_owner_adopted_count"] == 0
    assert find(out, "request", work="w3")[0]["reason"] == (
        "FORMATION_CAPABILITY_ORIGINAL_OWNER_ADOPTION_REQUIRED"
    )
    assert "w3" not in out["works"]
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "owner_capability_and_institutional_reproduction_link_count"
    ] == 0
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1p_owner_capability_adopted_only_after_consultation_cannot_backdate_it():
    d = r1p_case()
    cap = next(e for e in d["events"] if e["action"] == "adopt_capability")
    cap["at"] = 74  # review closes at 73, original request at 83
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert find(out, "adopt_capability")[0]["outcome"] == "APPLIED"
    assert find(out, "request", work="w3")[0]["reason"] == (
        "FORMATION_CAPABILITY_OWNER_ADOPTION_BEFORE_REVIEW_REQUIRED"
    )
    assert "w3" not in out["works"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1p_owner_source_revoked_after_adoption_before_request_invalidates_future_capability():
    d = r1p_case()
    d["events"].append({
        "at": 80, "action": "source_update", "actor": "a",
        "source": "capability-r1p-a", "new_revision": "capacity-v2",
        "status": "UNKNOWN", "usable_by": ["a"],
    })
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert find(out, "adopt_capability")[0]["outcome"] == "APPLIED"
    assert find(out, "source_update")[0]["outcome"] == "APPLIED"
    assert find(out, "request", work="w3")[0]["reason"] == (
        "FORMATION_CAPABILITY_OWNER_SOURCE_NO_LONGER_CURRENT"
    )
    assert "w3" not in out["works"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1p_capability_cooperation_requires_the_original_post_result_review():
    d = r1p_case()
    d["general_akis"]["enforce_model_result_conditioned_reconfiguration"] = False
    import pytest
    with pytest.raises(ValueError, match="FORMATION_CAPABILITY_COOPERATION_REQUIRES_RESULT_RECONFIGURATION"):
        simulate(d)


def test_r1p_capability_owner_cannot_claim_foreign_original_resource():
    d = r1p_case()
    d["capability_adoptions"][0]["owner"] = "b"
    import pytest
    with pytest.raises(ValueError, match="CAPABILITY_ORIGINAL_RESOURCE_OWNER_MISMATCH"):
        simulate(d)


def test_r1p_late_owner_source_revocation_blocks_original_commit_and_joint_witness():
    d = r1p_case()
    commit = next(e for e in d["events"]
                  if e["action"] == "commit" and e["work"] == "w3")
    at = commit["at"]
    for event in d["events"]:
        if event["at"] >= at:
            event["at"] += 1
    d["events"].append({
        "at": at, "action": "source_update", "actor": "a",
        "source": "capability-r1p-a", "new_revision": "capacity-v2",
        "status": "UNKNOWN", "usable_by": ["a"],
    })
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert find(out, "request", work="w3")[0]["outcome"] == "APPLIED"
    assert find(out, "source_update")[0]["outcome"] == "APPLIED"
    assert find(out, "commit", work="w3")[0]["reason"] == (
        "FORMATION_CAPABILITY_OWNER_SOURCE_NO_LONGER_CURRENT"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    cycle = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert cycle["owner_capability_and_institutional_reproduction_link_count"] == 0
    assert cycle["same_original_causal_chain_includes_capability_and_institutional_change"] is False
    assert simulate(deepcopy(d)) == out


def test_r1p_positive_consent_and_reconfiguration_are_not_real_measured_network_savings():
    out = simulate(r1p_case())
    assert out["general_akis_model"]["post_result_cooperation_reconfiguration"][
        "real_transaction_savings_established"
    ] is False
    assert out["general_akis_model"]["result_capability_cooperation_gate"][
        "measured_real_productivity_gain_established"
    ] is False
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "all_nine_component_original_causal_closure_proven"
    ] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_r1p_retired_owner_capacity_after_third_accepted_result_does_not_erase_history():
    d = r1p_case()
    d["events"].append({
        "at": 112, "action": "source_update", "actor": "a",
        "source": "capability-r1p-a", "new_revision": "capacity-retired",
        "status": "UNKNOWN", "usable_by": ["a"],
    })
    d["events"].sort(key=lambda event: event["at"])
    out = simulate(d)
    assert find(out, "source_update")[0]["outcome"] == "APPLIED"
    assert all(
        out["works"][work]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
        for work in ("w1", "w2", "w3")
    )
    assert out["capability_dynamics"]["declarations"][0][
        "available_for_new_original_work"
    ] is False
    summary = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert summary["owner_capability_and_institutional_reproduction_link_count"] == 1
    assert summary["same_original_causal_chain_includes_capability_and_institutional_change"]
    prior = out["general_akis_private_cycle_evidence"][
        "owner_capability_and_institutional_reproduction_links"
    ]
    assert len(prior) == 1
    assert prior[0]["future_owner_source_still_current_at_horizon"] is False
    assert prior[0]["actual_capacity_or_economic_effect_verified"] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == out
