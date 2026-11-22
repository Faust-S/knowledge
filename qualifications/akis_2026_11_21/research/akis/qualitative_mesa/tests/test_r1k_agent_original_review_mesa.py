"""R1-K: A=F(P,OC,KPB) partial original program-preparation/customer-decision loop.

The ONLY authoritative business path remains original QualitativeAKIS
request, admission, independent principals' consent, commit and Result.
"""
from copy import deepcopy
import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1j_original_kpb_oc_formation_mesa import institutional_case
from .test_r1_formation_original_gates_mesa import trace_for


def agent_case(*, human_decision="APPROVE", include_review=True):
    d = institutional_case()
    general = d["general_akis"]
    general["enforce_model_formation_agent_review"] = True
    original_code = next(row for row in general["organizational_code"]
                         if row["field"] == "Авт")
    original_code["control"]["max_agent_function"] = "REQUEST_APPROVAL"
    corporate = next(row for row in general["context_cores"]
                     if row["core"] == "corporate")
    corporate["operation"] = "SHARE"
    basis = next(row for row in d["context_evidence"]["sources"]
                 if row["id"] == "basis-corporate")
    basis["operations"] = ["READ", "SHARE"]
    general["formation_phases"].append({
        "owner": "op", "source_ref": "model://op/formation-6",
        "revision": "oc-1", "available_at": 0, "expires_at": 90,
        "phase": 6,
    })
    general["agent_functions"].append({
        "owner": "op", "source_ref": "model://op/packet-approval-w1",
        "revision": "oc-1", "available_at": 0, "expires_at": 90,
        "id": "approval-w1", "work": "w1", "work_revision": "d-1",
        "autonomy": general["morphology"]["autonomy"],
        "action": "REQUEST_APPROVAL",
        "basis_source": "basis-corporate",
        "basis_revision": "source-r1",
        "purpose": "akis-formation", "operation": "SHARE",
    })
    # Insert independent original actions after the founding phase.
    for e in d["events"]:
        if e["at"] >= 12:
            e["at"] += 2
    d["events"].insert(11, {
        "at": 12, "action": "function_prepare",
        "actor": "op", "org_revision": "oc-1", "work": "w1",
        "function_id": "approval-w1",
        "function_source_ref": "model://op/packet-approval-w1",
        "function_phase_source_ref": "model://op/formation-6",
    })
    if include_review:
        d["events"].insert(12, {
            "at": 13, "action": "function_review",
            "actor": "b", "org_revision": "oc-1", "work": "w1",
            "function_id": "approval-w1", "prepared_at": 12,
            "human_decision": human_decision,
            "review_source_ref": "model://b/independent-review-w1",
        })
    d["model_horizon"] = 40
    return d


def test_r1k_program_packet_customer_approval_precedes_independent_original_work():
    d = agent_case()
    raw = deepcopy(d)
    out = simulate(d)
    assert d == raw
    assert out["counts"] == {"applied": 21, "blocked": 0}, out["trace"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    packet = trace_for(out, "function_prepare")[0]
    approval = trace_for(out, "function_review")[0]
    assert packet["program_packet"] == "HUMAN_REVIEW_PACKET_COMPUTED"
    assert packet["work_source_revision"] == "d-1"
    assert packet["program_cannot_create_original_work_or_result"] is True
    assert approval["human_decision"] == "APPROVE"
    assert approval["human_review_is_not_original_work_consent"] is True
    assert trace_for(out, "commit")[0]["outcome"] == "APPLIED"
    review = out["general_akis_model"]["agent_function_formation_model_gate"]
    assert review["opted_in"] is True
    assert review["original_bounded_preparations"] == 1
    assert review["independent_original_customer_approvals"] == 1
    assert review["full_author_A_F_P_OC_KPB_implemented"] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out == simulate(deepcopy(d))


def test_r1k_no_customer_review_blocks_original_commit_without_removing_consents():
    d = agent_case(include_review=False)
    out = simulate(d)
    assert trace_for(out, "commit")[0]["reason"] == (
        "FORMATION_AGENT_ORIGINAL_CUSTOMER_APPROVAL_REQUIRED"
    )
    assert [x["outcome"] for x in trace_for(out, "consent")] == [
        "APPLIED", "APPLIED"
    ]
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_r1k_explicit_customer_rejection_blocks_original_commit():
    d = agent_case(human_decision="REJECT")
    out = simulate(d)
    assert trace_for(out, "function_review")[0]["outcome"] == "APPLIED"
    assert trace_for(out, "commit")[0]["reason"] == (
        "FORMATION_AGENT_ORIGINAL_CUSTOMER_REJECTED"
    )
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert out["general_akis_model"]["agent_function_formation_model_gate"][
        "independent_original_customer_rejections"] == 1


@pytest.mark.parametrize("modify,reason", [
    (lambda d: next(e for e in d["events"]
         if e["action"] == "function_prepare").update(actor="a"),
     "FORMATION_AGENT_ORIGINAL_FUNCTION_OWNER_REQUIRED"),
    (lambda d: next(e for e in d["events"]
         if e["action"] == "function_prepare").update(
             function_source_ref="model://op/another-function"),
     "FORMATION_AGENT_FUNCTION_SOURCE_MISMATCH"),
    (lambda d: next(e for e in d["events"]
         if e["action"] == "function_prepare").update(
             function_phase_source_ref="model://op/wrong-phase"),
     "FORMATION_AGENT_PHASE_SIX_SOURCE_REQUIRED"),
    (lambda d: next(e for e in d["events"]
         if e["action"] == "function_review").update(actor="op"),
     "FORMATION_AGENT_INDEPENDENT_CUSTOMER_REQUIRED"),
    (lambda d: next(e for e in d["events"]
         if e["action"] == "function_review").update(
             review_source_ref="model://op/forged-human"),
     "FORMATION_AGENT_ORIGINAL_CUSTOMER_SOURCE_REQUIRED"),
    (lambda d: next(e for e in d["events"]
         if e["action"] == "function_review").update(prepared_at=8),
     "FORMATION_AGENT_CURRENT_PREPARATION_REQUIRED"),
    (lambda d: next(e for e in d["events"]
         if e["action"] == "function_review").update(human_decision="AUTO"),
     "FORMATION_AGENT_HUMAN_DECISION_REQUIRED"),
])
def test_r1k_an_original_role_source_decision_or_packet_cannot_be_forged(modify, reason):
    d = agent_case()
    modify(d)
    out = simulate(d)
    candidates = trace_for(out, "function_prepare") + trace_for(out, "function_review")
    assert any(x["reason"] == reason for x in candidates)
    assert trace_for(out, "commit")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


def test_r1k_preparation_cannot_bypass_a_missing_founder_confirmation():
    d = agent_case()
    d["events"] = [e for e in d["events"] if not (
        e["action"] == "formation_confirm" and
        e["phase"] == 5 and e["actor"] == "b"
    )]
    out = simulate(d)
    assert trace_for(out, "function_prepare")[0]["outcome"] == "BLOCKED"
    assert trace_for(out, "function_review")[0]["outcome"] == "BLOCKED"
    assert trace_for(out, "commit")[0]["outcome"] == "BLOCKED"


def test_r1k_expired_program_source_blocks_new_human_approval():
    d = agent_case()
    d["general_akis"]["agent_functions"][0]["expires_at"] = 13
    out = simulate(d)
    assert trace_for(out, "function_prepare")[0]["outcome"] == "APPLIED"
    assert trace_for(out, "function_review")[0]["outcome"] == "BLOCKED"
    assert trace_for(out, "commit")[0]["outcome"] == "BLOCKED"


def test_r1k_original_context_revocation_after_approval_blocks_new_work():
    d = agent_case()
    for event in d["events"]:
        if event["at"] >= 18:
            event["at"] += 1
    d["events"].insert(17, {
        "at": 18, "action": "source_update", "actor": "a",
        "source": "basis-corporate", "status": "UNKNOWN",
    })
    out = simulate(d)
    assert trace_for(out, "function_review")[0]["human_decision"] == "APPROVE"
    assert trace_for(out, "source_update")[0]["outcome"] == "APPLIED"
    assert trace_for(out, "commit")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


def test_r1k_original_accepted_result_survives_late_source_revocation():
    d = agent_case()
    d["events"].append({
        "at": 30, "action": "source_update", "actor": "a",
        "source": "basis-corporate", "status": "DISPROVED",
    })
    out = simulate(d)
    assert trace_for(out, "source_update")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["obligation"] == "FULFILLED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1k_approved_program_packet_does_not_replace_other_principal_consent():
    d = agent_case()
    d["events"] = [
        e for e in d["events"] if not (
            e["action"] == "consent" and e["actor"] == "a")
    ]
    out = simulate(d)
    assert trace_for(out, "function_review")[0]["outcome"] == "APPLIED"
    assert trace_for(out, "commit")[0]["reason"] == (
        "INDEPENDENT_ACCEPTANCE_MISSING"
    )
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


def test_r1k_cannot_enable_phase_six_without_existing_five_stage_gates():
    d = agent_case()
    d["general_akis"]["enforce_model_formation_context_code"] = False
    with pytest.raises(ValueError, match="FORMATION_AGENT_REVIEW_REQUIRES_KPB_OC_GATES"):
        simulate(d)


def test_r1k_opt_out_does_not_grant_agent_decisions_or_change_previous_work():
    d = agent_case()
    d["general_akis"]["enforce_model_formation_agent_review"] = False
    out = simulate(d)
    assert all(row["outcome"] == "BLOCKED"
               for row in trace_for(out, "function_prepare") + trace_for(out, "function_review"))
    assert trace_for(out, "commit")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


from .test_r1j_original_kpb_oc_formation_mesa import two_cycle_case


def two_cycle_agent_case(*, second_review=True, forge_second_preparation=False):
    """First Result causes a new independent Work, not inherited program consent."""
    d = two_cycle_case()
    g = d["general_akis"]
    g["enforce_model_formation_agent_review"] = True
    next(x for x in g["organizational_code"] if x["field"] == "Авт")[
        "control"]["max_agent_function"] = "REQUEST_APPROVAL"
    next(x for x in g["context_cores"] if x["core"] == "corporate")[
        "operation"] = "SHARE"
    next(x for x in d["context_evidence"]["sources"]
         if x["id"] == "basis-corporate")["operations"] = ["READ", "SHARE"]
    g["formation_phases"].append({
        "owner": "op", "source_ref": "model://op/formation-6",
        "revision": "oc-1", "available_at": 0, "expires_at": 90,
        "phase": 6,
    })
    for work, revision in (("w1", "d-1"), ("w2", "d-2")):
        g["agent_functions"].append({
            "owner": "op", "source_ref": f"model://op/approval-{work}",
            "revision": "oc-1", "available_at": 0, "expires_at": 90,
            "id": f"approval-{work}", "work": work, "work_revision": revision,
            "autonomy": g["morphology"]["autonomy"],
            "action": "REQUEST_APPROVAL", "basis_source": "basis-corporate",
            "basis_revision": "source-r1", "purpose": "akis-formation",
            "operation": "SHARE",
        })
    for e in d["events"]:
        if e["at"] >= 40:
            e["at"] += 4
        elif e["at"] >= 12:
            e["at"] += 2
    for work, at in (("w1", 12), ("w2", 42)):
        d["events"].append({
            "at": at, "action": "function_prepare", "actor": "op",
            "org_revision": "oc-1", "work": work,
            "function_id": f"approval-{work}",
            "function_source_ref": f"model://op/approval-{work}",
            "function_phase_source_ref": "model://op/formation-6",
        })
        if work == "w1" or second_review:
            d["events"].append({
                "at": at + 1, "action": "function_review", "actor": "b",
                "org_revision": "oc-1", "work": work,
                "function_id": f"approval-{work}",
                "prepared_at": (12 if forge_second_preparation and
                                work == "w2" else at),
                "human_decision": "APPROVE",
                "review_source_ref": f"model://b/review-{work}",
            })
    d["events"].sort(key=lambda e: e["at"])
    d["model_horizon"] = 85
    return d


def test_r1k_two_accepted_results_have_two_program_packets_and_two_human_decisions():
    d = two_cycle_agent_case()
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, out["trace"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert [(row["work"], row["at"]) for row in trace_for(out, "function_prepare")] == [
        ("w1", 12), ("w2", 42),
    ]
    assert [(row["work"], row["prepared_at"]) for row in
            trace_for(out, "function_review")] == [
        ("w1", 12), ("w2", 42),
    ]
    assert out["general_akis_model"]["agent_function_formation_model_gate"][
        "independent_original_customer_approvals"] == 2
    assert out["general_akis_model"]["agent_function_formation_model_gate"][
        "full_author_A_F_P_OC_KPB_implemented"] is False
    assert out == simulate(deepcopy(d))


def test_r1k_second_work_cannot_reuse_first_customer_approval():
    d = two_cycle_agent_case(second_review=False)
    out = simulate(d)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert trace_for(out, "commit")[-1]["reason"] == (
        "FORMATION_AGENT_ORIGINAL_CUSTOMER_APPROVAL_REQUIRED"
    )
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w2"]["result"] == "NOT_SUBMITTED"


def test_r1k_second_work_cannot_claim_first_work_packet_identity():
    d = two_cycle_agent_case(forge_second_preparation=True)
    out = simulate(d)
    assert trace_for(out, "function_review")[-1]["reason"] == (
        "FORMATION_AGENT_CURRENT_PREPARATION_REQUIRED"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"


def test_r1k_revoking_source_after_first_result_does_not_erase_history_or_qualify_second():
    d = two_cycle_agent_case()
    for e in d["events"]:
        if e["at"] >= 31:
            e["at"] += 1
    d["events"].append({
        "at": 31, "action": "source_update", "actor": "a",
        "source": "basis-corporate", "status": "UNKNOWN",
    })
    d["events"].sort(key=lambda x: x["at"])
    d["model_horizon"] = 87
    out = simulate(d)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "NOT_SUBMITTED"
    assert trace_for(out, "commit")[-1]["outcome"] == "BLOCKED"


def changed_source_epoch_case(*, renew_packet=False):
    d = agent_case()
    for e in d["events"]:
        if e["at"] >= 18:
            e["at"] += (4 if renew_packet else 2)
    d["events"].extend([
        {"at": 18, "action": "source_update", "actor": "a",
         "source": "basis-corporate", "status": "UNKNOWN"},
        {"at": 19, "action": "source_update", "actor": "a",
         "source": "basis-corporate", "status": "CONFIRMED"},
    ])
    if renew_packet:
        d["events"].extend([
            {"at": 20, "action": "function_prepare", "actor": "op",
             "org_revision": "oc-1", "work": "w1",
             "function_id": "approval-w1",
             "function_source_ref": "model://op/packet-approval-w1",
             "function_phase_source_ref": "model://op/formation-6"},
            {"at": 21, "action": "function_review", "actor": "b",
             "org_revision": "oc-1", "work": "w1",
             "function_id": "approval-w1", "prepared_at": 20,
             "human_decision": "APPROVE",
             "review_source_ref": "model://b/second-independent-review"},
        ])
    d["events"].sort(key=lambda x: x["at"])
    d["model_horizon"] = 44
    return d


def test_r1k_reconfirming_recalled_context_does_not_reactivate_old_agent_packet():
    d = changed_source_epoch_case()
    out = simulate(d)
    assert [row["outcome"] for row in trace_for(out, "source_update")] == [
        "APPLIED", "APPLIED"
    ]
    assert out["context_basis"]["sources"]["basis-corporate"]["status"] == "CONFIRMED"
    assert trace_for(out, "commit")[0]["reason"] == (
        "FORMATION_AGENT_ORIGINAL_KPB_CHANGED_AFTER_PACKET"
    )
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


def test_r1k_fresh_packet_and_new_customer_approval_after_restoration_allow_commit():
    d = changed_source_epoch_case(renew_packet=True)
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, out["trace"]
    assert [row["at"] for row in trace_for(out, "function_prepare")] == [12, 20]
    assert [row["prepared_at"] for row in trace_for(out, "function_review")] == [12, 20]
    assert trace_for(out, "commit")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out == simulate(deepcopy(d))
