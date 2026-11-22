"""M3.2: accepted Result -> source-scoped claimed reuse -> later Work.

Synthetic comparisons are not verified competence gains or causal economics.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.competence_reuse import ReuseInputError
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_work_assurance_mesa import scenario as prior_work, execution_events, quality_event


def measurement(tag, value="10.0000"):
    return {"source_ref": f"model://a/{tag}", "source_revision": "k1",
            "value": value, "unit": "hours/unit", "quantity": "100.0000",
            "scope": "same-scope", "quality_basis": "q-agreed"}


def claim():
    return {"id": "reuse-1", "prior_work": "w1", "later_work": "w2",
            "actor": "a", "prior_result_ref": "model://final-v1",
            "competence_ref": "model://a/observed-reuse",
            "source_id": "experience-a", "source_revision": "k1",
            "applied_at": 19, "kind": "TECHNOLOGY", "metric": "LABOR_TIME_PER_UNIT",
            "direction": "LOWER_IS_BETTER",
            "independent_baseline": measurement("independent-baseline"),
            "subsequent_observation": measurement("later-observed", "8.0000")}


def complete_case():
    d = prior_work()
    d["works"].append({"id": "w2", "customer": "c", "resource": "ra",
                       "source_revision": "d2", "slot_start": 8, "slot_end": 12,
                       "requires_accepted": ["w1"]})
    d["events"] = execution_events() + [
        quality_event(12),
        quality_event(13, criterion_id="documents"),
        {"at": 14, "action": "accept", "actor": "c", "work": "w1"},
        {"at": 15, "action": "offer", "actor": "op", "work": "w2"},
        {"at": 16, "action": "authorize", "actor": "op", "work": "w2"},
        {"at": 17, "action": "consent", "actor": "a", "work": "w2",
         "source_revision": "d2", "org_revision": "oc-1"},
        {"at": 18, "action": "consent", "actor": "c", "work": "w2",
         "source_revision": "d2", "org_revision": "oc-1"},
        {"at": 19, "action": "commit", "actor": "op", "work": "w2"},
        {"at": 20, "action": "start", "actor": "a", "work": "w2"},
        {"at": 21, "action": "complete", "actor": "a", "work": "w2",
         "result_ref": "model://new-final"},
        {"at": 22, "action": "accept", "actor": "c", "work": "w2"},
    ]
    d["context_evidence"] = {"strict": False, "sources": [
        {"id": "experience-a", "owner": "a", "revision": "k1",
         "status": "CONFIRMED", "usable_by": ["a"]}
    ], "requirements": []}
    d["competence_reuse_evidence"] = [claim()]
    return d


def test_original_mesa_reuse_sequence_can_be_compared_without_inferred_profit():
    d = complete_case()
    out = simulate(d)
    view = out["competence_reuse_dynamics"]
    assert out["counts"]["blocked"] == 0, out["trace"]
    assert view["comparable_sequence_count"] == 1
    link = view["links"][0]
    assert link["model_claim_status"] == "MODEL_REPORTED_COMPARABLE_REUSE_SEQUENCE"
    assert link["declared_metric_change_favourable_positive"] == "2.0000"
    assert link["prior_accepted_at"] == 14 and link["later_started_at"] == 20
    assert link["later_accepted_at"] == 22
    assert view["original_cash_and_resource_uses_added"] == 0
    assert view["causal_competence_effect"] == "NOT_IDENTIFIABLE"
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert simulate(deepcopy(d)) == out


@pytest.mark.parametrize("change,reason", [
    ({"applied_at": 14}, "PRIOR_ORIGINAL_RESULT_NOT_ACCEPTED_BEFORE_APPLICATION"),
    ({"applied_at": 20}, "NO_SUBSEQUENT_ORIGINAL_EXECUTION_AFTER_APPLICATION"),
    ({"source_revision": "stale"}, "CONTEXT_SOURCE_REVISION_CHANGED"),
    ({"prior_result_ref": "model://wrong"}, "PRIOR_ORIGINAL_RESULT_NOT_ACCEPTED_BEFORE_APPLICATION"),
    ({"actor": "op"}, "NO_CONTINUOUS_ORIGINAL_COMPETENCE_OWNER"),
])
def test_invalid_or_unqualified_reuse_cannot_claim_measured_gain(change, reason):
    d = complete_case()
    d["competence_reuse_evidence"][0].update(change)
    if change.get("actor") == "op":
        d["competence_reuse_evidence"][0]["competence_ref"] = "model://op/my-claim"
    link = simulate(d)["competence_reuse_dynamics"]["links"][0]
    assert reason in link["unqualified_reasons"]
    assert link["declared_metric_change_favourable_positive"] is None


def test_scope_mismatch_and_revocation_block_comparability_preserve_old_results():
    d = complete_case()
    d["competence_reuse_evidence"][0]["subsequent_observation"]["quality_basis"] = "other"
    row = simulate(d)["competence_reuse_dynamics"]["links"][0]
    assert "INDEPENDENT_COMPARATOR_NOT_EQUIVALENT" in row["unqualified_reasons"]
    assert row["declared_metric_change_favourable_positive"] is None
    d = complete_case()
    d["events"].append({"at": 23, "action": "source_update", "actor": "a",
                        "source": "experience-a", "status": "UNKNOWN",
                        "new_revision": "k2"})
    out = simulate(d)
    row = out["competence_reuse_dynamics"]["links"][0]
    assert "CONTEXT_SOURCE_REVISION_CHANGED" in row["unqualified_reasons"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_unaccepted_next_result_does_not_create_competence_effect():
    d = complete_case()
    d["events"].pop()
    out = simulate(d)
    row = out["competence_reuse_dynamics"]["links"][0]
    assert "SUBSEQUENT_ORIGINAL_RESULT_NOT_ACCEPTED" in row["unqualified_reasons"]
    assert out["works"]["w2"]["result"] == "SUBMITTED"


def test_legacy_model_output_unchanged_without_reuse_evidence():
    d = complete_case()
    del d["competence_reuse_evidence"]
    out = simulate(d)
    assert "competence_reuse_dynamics" not in out


@pytest.mark.parametrize("mutator", [
    lambda c: c.update(id=""),
    lambda c: c["independent_baseline"].update(value="-1.00"),
    lambda c: c["independent_baseline"].update(source_ref="model://c/foreign"),
    lambda c: c.update(applied_at=True),
])
def test_malformed_model_reuse_input_fails_closed(mutator):
    d = complete_case()
    mutator(d["competence_reuse_evidence"][0])
    with pytest.raises(Exception, match="REUSE"):
        simulate(d)


def test_m3_2_general_model_reads_reuse_without_new_agent_or_ledger():
    from .test_general_system_mesa_integration import design
    d = complete_case()
    d["general_akis"] = design()
    out = simulate(d)
    assert out["general_akis_model"]["competence_reproduction_feedback"]["model_comparable_sequences"] == 1
    assert out["general_akis_model"]["competence_reproduction_feedback"]["causal_economic_gain"] == "NOT_IDENTIFIABLE"
    assert out["general_akis_model"]["work_quality_feedback"]["accepted_quality_proves_reusable_competence"] is False
