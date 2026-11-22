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
    assert out["capability_dynamics"]["declarations"][0][
        "actual_resource_capacity_or_causal_learning_verified"
    ] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == out


def test_r1p_owner_declared_learning_without_adoption_never_creates_capacity():
    d = r1p_case(adopt=False)
    out = simulate(d)
    assert out["capability_dynamics"]["original_owner_adopted_count"] == 0
    assert find(out, "request", work="w3")[0]["outcome"] == "APPLIED"
    assert find(out, "commit", work="w3")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
