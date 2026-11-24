"""One source-bounded dynamic view, without inventing owner assent or costs."""
from types import SimpleNamespace as N

from research.akis.qualitative_mesa.cooperation import (
    cooperative_model_readiness, cooperative_readiness_evolution,
)
from research.akis.qualitative_mesa.tests.test_cooperation import prepared


def ready_env():
    links, works, resources = prepared()
    works["x"].proposal = "OFFERED"
    works["x"].source_revision = "d1"
    institution = N(revision="oc1")
    return links, works, resources, institution


def response(subject, status="REVIEWABLE_NOT_CONSENTED", **overrides):
    data = {"subject": subject, "work": "x", "assessment": status,
            "work_source_revision": "d1", "org_revision": "oc1",
            "evidence": "MODEL_ONLY", "effect": "NO_AUTOMATIC_CONSENT",
            "observation_kind": "SIMULATED_SUBJECT_RESPONSE",
            "at": 1.0, "source_trace_position": 2}
    data.update(overrides)
    return data


def review(rows):
    links, works, resources, institution = ready_env()
    return cooperative_model_readiness(links, works, resources, institution, rows)[0]


def test_not_an_oracle_or_automatic_consent():
    row = review([response("a"), response("b"), response("c")])
    assert row["status"] == "MODEL_READY_FOR_ORIGINAL_CONSENT_REVIEW"
    assert row["original_principal_count"] == 3
    assert row["current_source_model_responses"] == 3
    assert row["original_consents_issued"] is False
    assert row["original_obligation"] == "NOT_ACCEPTED"
    assert row["economic_advantage"] == "NOT_DERIVED_FROM_MODEL_RESPONSES"
    assert not any(key in row for key in ("a", "b", "c", "owner_preferences"))


def test_missing_independent_principal_blocks_model_readiness():
    row = review([response("a"), response("c")])
    assert row["status"] == "MODEL_ORIGINAL_RESPONSE_INCOMPLETE"
    assert row["missing_current_source_responses"] == 1


def test_independent_principal_outside_option_reverses_group_readiness():
    row = review([response("a"), response("b"), response("c", "PREFERS_OUTSIDE_OPTION")])
    assert row["status"] == "MODEL_INDEPENDENT_OPPOSITION"
    assert row["original_consents_issued"] is False


def test_nonbinding_independent_participation_pause_reverses_model_readiness():
    row = review([response("a"), response("b", "COOPERATION_FUTURE_PARTICIPATION_PAUSED"), response("c")])
    assert row["status"] == "MODEL_INDEPENDENT_OPPOSITION"


def test_wrong_revision_or_nonauthoritative_response_cannot_count():
    row = review([response("a"), response("b"), response("c", org_revision="oc0")])
    assert row["status"] == "MODEL_ORIGINAL_RESPONSE_INCOMPLETE"
    row = review([response("a"), response("b"), response("c", evidence="ACTUAL_CONSENT")])
    assert row["status"] == "MODEL_ORIGINAL_RESPONSE_INCOMPLETE"
    row = review([response("a"), response("b"), response("c", effect="AUTO_ACCEPT")])
    assert row["status"] == "MODEL_ORIGINAL_RESPONSE_INCOMPLETE"


def test_operator_assessment_does_not_replace_original_principal():
    row = review([response("a"), response("b"), response("op")])
    assert row["current_source_model_responses"] == 2
    assert row["status"] == "MODEL_ORIGINAL_RESPONSE_INCOMPLETE"


def test_unknown_or_blocked_information_prevents_model_readiness():
    row = review([response("a"), response("b", "RESOURCE_NOT_AVAILABLE"), response("c")])
    assert row["status"] == "MODEL_BLOCKED_OR_UNCERTAIN"


def test_original_committed_obligation_is_never_reversed_by_later_opposition():
    links, works, resources, institution = ready_env()
    works["x"].obligation = "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    works["x"].result = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    row = cooperative_model_readiness(links, works, resources, institution,
                                      [response("a", "INDEPENDENT_DECLINE")])[0]
    assert row["status"] == "ORIGINAL_OBLIGATION_UNCHANGED"
    assert row["original_result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_request_without_offer_does_not_become_new_business():
    links, works, resources, institution = ready_env()
    works["x"].proposal = "REQUESTED"
    row = cooperative_model_readiness(links, works, resources, institution,
                                      [response("a"), response("b"), response("c")])[0]
    assert row["status"] == "MODEL_OFFER_NOT_CURRENT"


def test_dynamic_evolution_is_derived_from_existing_observations_only():
    links, works, resources, institution = ready_env()
    observations = []
    for i, assessment in enumerate([response("a"), response("b"), response("c"),
                                    response("c", "INDEPENDENT_DECLINE"),
                                    response("c", "INDEPENDENT_DECLINE")]):
        assessment = dict(assessment, at=i + 1, source_trace_position=i + 1)
        observations.append(assessment)
        assessment["cooperation_model_review"] = cooperative_model_readiness(
            links, works, resources, institution, observations)
    trajectory = cooperative_readiness_evolution(observations)
    changes = trajectory["changes"]
    assert [row["current_responses"] for row in changes] == [1, 2, 3, 3]
    assert [row["readiness"] for row in changes] == [
        "MODEL_ORIGINAL_RESPONSE_INCOMPLETE", "MODEL_ORIGINAL_RESPONSE_INCOMPLETE",
        "MODEL_READY_FOR_ORIGINAL_CONSENT_REVIEW", "MODEL_INDEPENDENT_OPPOSITION"]
    assert [row["at"] for row in changes] == [1, 2, 3, 4]
    assert trajectory["actual_agreements_or_results_created"] == 0
    assert trajectory["no_additional_scheduler_or_ledger"] is True


def test_cooperation_evolution_cannot_use_future_knowledge_after_revision():
    links, works, resources, institution = ready_env()
    old = [response("a"), response("b"), response("c")]
    assert cooperative_model_readiness(links, works, resources, institution, old)[0]["status"] == "MODEL_READY_FOR_ORIGINAL_CONSENT_REVIEW"
    institution.revision = "oc2"
    row = cooperative_model_readiness(links, works, resources, institution, old)[0]
    assert row["status"] == "MODEL_ORIGINAL_RESPONSE_INCOMPLETE"
    assert row["current_source_model_responses"] == 0


def test_one_work_projection_does_not_invent_relation_or_other_work():
    links, works, resources, institution = ready_env()
    assert cooperative_model_readiness(links, works, resources, institution,
                                       [response("a")], work_id="missing") == []
    row = cooperative_model_readiness(links, works, resources, institution,
                                      [response("a")], work_id="x")
    assert len(row) == 1 and row[0]["relation"] == "collab"
    assert row[0]["work"] == "x"


def test_co_temporal_future_event_not_misattributed_to_previous_response():
    links, works, resources, institution = ready_env()
    a = response("a", source_event_state_is_current=False)
    a["cooperation_model_review"] = cooperative_model_readiness(
        links, works, resources, institution, [a])
    b = response("b", at=2, source_trace_position=3,
                 source_event_state_is_current=True)
    b["cooperation_model_review"] = cooperative_model_readiness(
        links, works, resources, institution, [a, b])
    path = cooperative_readiness_evolution([a, b])["changes"]
    assert len(path) == 1
    assert path[0]["source_trace_position"] == 3
    assert path[0]["current_responses"] == 2


def test_one_work_in_two_relations_must_not_reuse_one_choice_as_two_agreements():
    from dataclasses import replace
    links, works, resources, institution = ready_env()
    other = replace(links[0], key="other-relation", source_revision="r2")
    rows = cooperative_model_readiness(
        (links[0], other), works, resources, institution,
        [response("a"), response("b"), response("c")])
    assert len(rows) == 2
    assert {item["status"] for item in rows} == {"MODEL_RELATION_CHOICE_AMBIGUOUS"}
    assert all(item["original_consents_issued"] is False for item in rows)
