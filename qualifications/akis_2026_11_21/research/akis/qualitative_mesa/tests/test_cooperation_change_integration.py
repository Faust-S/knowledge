"""Whole-AKIS model reconfiguration consultations on the ORIGINAL event route.

Every record is MODEL_ONLY. Consultation never amends a contract, a Result,
institutional code or an original principal's independent capabilities.
"""
import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.cooperation import cooperation_change_reviews, cooperation_system_view
from research.akis.qualitative_mesa.tests.test_cooperation_akis_integration import linked_world
from research.akis.qualitative_mesa.tests.test_technology import signed


def scenario():
    d = linked_world()
    d["subjects"].append({"id": "d", "kind": "SME"})
    return d


def propose(at=1, **changes):
    event = {
        "at": at, "action": "cooperation_change_propose", "actor": "b",
        "cooperation_link": "network-1",
        "cooperation_source_revision": "nw-r1", "org_revision": "oc-1",
        "change_id": "chg-1", "change_kind": "ADD_FUTURE_PARTICIPANT",
        "proposed_subject": "d", "economic_channel": "TRANSACTION_COST",
        "change_source_ref": "model://new-enterprise-review",
    }
    event.update(changes)
    return event


def respond(actor, at=2, decision="SUPPORT_MODEL_PROPOSAL", **changes):
    event = {
        "at": at, "action": "cooperation_change_response", "actor": actor,
        "cooperation_link": "network-1",
        "cooperation_source_revision": "nw-r1", "org_revision": "oc-1",
        "change_id": "chg-1", "change_decision": decision,
        "change_source_ref": f"model://review-{actor}-{at}",
    }
    event.update(changes)
    return event


def test_independent_five_party_consultation_does_not_admit_or_sign_for_new_entrant():
    s = QualitativeAKIS(scenario())
    assert s.apply(propose(), 1)["outcome"] == "APPLIED"
    for at, actor in enumerate(("a", "b", "c", "op", "d"), start=2):
        assert s.apply(respond(actor, at=at), at)["outcome"] == "APPLIED"
    review = cooperation_change_reviews(s.cooperation_links, s.trace)[0]
    assert review["required_count"] == 5
    assert review["consulted_count"] == 5
    assert review["review_status"] == "MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION"
    assert s.cooperation_links[0].participants == ("a", "b", "c", "op")
    assert s.cooperation_links[0].works == ("w1",)
    assert s.works["w1"].consents == {}
    assert s.works["w1"].obligation == "NOT_ACCEPTED"
    assert s.works["w1"].result == "NOT_SUBMITTED"
    view = cooperation_system_view(
        s.cooperation_links, s.works, s.resources, s.subjects, s.institution, s.trace
    )["relations"][0]
    assert view["components"]["ОК"]["change_consultation_is_not_authorization"] is True
    assert view["components"]["Э"]["reconfiguration_costs"] == "REBASELINE_REQUIRED"
    assert view["components"]["ЖЦ"]["organizational_change"] == "NOT_AUTOMATIC"


def test_original_contract_survives_objection_and_consultation():
    s = QualitativeAKIS(scenario())
    signed(s)
    old_obligation = s.works["w1"].obligation
    old_consents = dict(s.works["w1"].consents)
    assert s.apply(propose(at=7), 7)["outcome"] == "APPLIED"
    assert s.apply(respond("b", at=8, decision="OBJECT_MODEL_PROPOSAL"), 8)["outcome"] == "APPLIED"
    review = cooperation_change_reviews(s.cooperation_links, s.trace)[0]
    assert review["review_status"] == "SOURCE_DECLARED_OBJECTION_REQUIRES_REVIEW"
    assert review["old_work_obligations_and_results"] == "UNCHANGED"
    assert s.works["w1"].consents == old_consents
    assert s.works["w1"].obligation == old_obligation
    assert s.works["w1"].result == "NOT_SUBMITTED"


@pytest.mark.parametrize("invalid,reason", [
    ({"actor": "d"}, "COOPERATION_CHANGE_ORIGINAL_PROPOSER_REQUIRED"),
    ({"org_revision": "future"}, "STALE_ORGANIZATIONAL_CODE"),
    ({"cooperation_source_revision": "old"}, "COOPERATION_CHANGE_SOURCE_REVISION_STALE"),
    ({"economic_channel": "NEW_DISCOUNT_RATE"}, "COOPERATION_CHANGE_CHANNEL_NOT_DECLARED"),
    ({"change_source_ref": "http://unsigned"}, "COOPERATION_CHANGE_MODEL_SOURCE_REQUIRED"),
])
def test_invalid_proposals_do_not_change_existing_state(invalid, reason):
    s = QualitativeAKIS(scenario())
    original = s.snapshot()["works"]
    result = s.apply(propose(**invalid), 1)
    assert result["outcome"] == "BLOCKED"
    assert result["reason"] == reason
    assert s.snapshot()["works"] == original
    assert cooperation_change_reviews(s.cooperation_links, s.trace) == []


def test_response_before_proposal_blocked_and_not_counted():
    s = QualitativeAKIS(scenario())
    result = s.apply(respond("a", at=1), 1)
    assert result["reason"] == "COOPERATION_CHANGE_PROPOSAL_NOT_FOUND"
    assert cooperation_change_reviews(s.cooperation_links, s.trace) == []


def test_strict_kpb_declines_unqualified_cooperative_revision_communication():
    d = scenario()
    d["context_evidence"] = {"strict": True, "sources": [], "requirements": []}
    s = QualitativeAKIS(d)
    result = s.apply(propose(), 1)
    assert result["reason"] == "COOPERATION_CHANGE_SOURCE_RIGHTS_NOT_QUALIFIED"
    assert s.works["w1"].obligation == "NOT_ACCEPTED"


def test_official_mesa_proposal_and_response_follow_original_schedule():
    pytest.importorskip("mesa", reason="Official Mesa is required")
    from research.akis.qualitative_mesa.mesa_model import simulate
    d = scenario()
    d["events"] = [propose(), respond("b", at=2, decision="OBJECT_MODEL_PROPOSAL")]
    output = simulate(d)
    assert output["counts"] == {"applied": 2, "blocked": 0}
    relation = output["cooperation"]["system_projection"]["relations"][0]
    assert relation["proposed_cooperation_changes"] == 1
    assert relation["components"]["ЖЦ"]["reconfiguration_reviews"][0]["status"] == "SOURCE_DECLARED_OBJECTION_REQUIRES_REVIEW"
    assert relation["components"]["Э"]["profit"] == "NOT_IDENTIFIABLE"
    assert output["works"]["w1"]["result"] == "NOT_SUBMITTED"


def test_real_original_mode_event_invalidates_old_model_consent_without_erasing_trace():
    s = QualitativeAKIS(scenario())
    assert s.apply(propose(), 1)["outcome"] == "APPLIED"
    for at, actor in enumerate(("a", "b", "c", "op", "d"), start=2):
        assert s.apply(respond(actor, at=at), at)["outcome"] == "APPLIED"
    old = cooperation_change_reviews(s.cooperation_links, s.trace,
                                     current_org_revision=s.institution.revision,
                                     subjects=s.subjects)[0]
    assert old["review_status"] == "MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION"
    change = {
        "at": 7, "action": "change_mode", "actor": "FOUNDERS",
        "expected_revision": "oc-1", "new_revision": "oc-2",
        "new_mode": "COLLEGIAL", "authorized_by": ["op", "a", "b"],
    }
    assert s.apply(change, 7)["outcome"] == "APPLIED"
    latest = cooperation_change_reviews(s.cooperation_links, s.trace,
                                        current_org_revision=s.institution.revision,
                                        subjects=s.subjects)[0]
    assert latest["historical_review_status"] == "MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION"
    assert latest["review_status"] == "MODEL_REVIEW_STALE_ORGANIZATIONAL_CODE_REVALIDATION_REQUIRED"
    assert latest["requires_fresh_original_qualification"] is True
    attempt = s.apply(respond("a", at=8, org_revision="oc-2"), 8)
    assert attempt["reason"] == "COOPERATION_CHANGE_PROPOSAL_REVISION_STALE"
    assert s.works["w1"].obligation == "NOT_ACCEPTED"


def test_original_exclusion_event_requires_revalidation_of_future_partner():
    s = QualitativeAKIS(scenario())
    assert s.apply(propose(), 1)["outcome"] == "APPLIED"
    for at, actor in enumerate(("a", "b", "c", "op", "d"), start=2):
        assert s.apply(respond(actor, at=at), at)["outcome"] == "APPLIED"
    assert s.apply({"at": 7, "action": "exclude", "actor": "op", "subject": "d"}, 7)["outcome"] == "APPLIED"
    review = cooperation_change_reviews(s.cooperation_links, s.trace,
                                        current_org_revision="oc-1",
                                        subjects=s.subjects)[0]
    assert review["historical_review_status"] == "MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION"
    assert review["review_status"] == "MODEL_REVIEW_PARTICIPANT_AVAILABILITY_REVALIDATION_REQUIRED"
    assert "d" not in s.cooperation_links[0].participants
    assert s.works["w1"].result == "NOT_SUBMITTED"


def test_nine_component_diagnostic_does_not_use_period_end_economics_as_prior_consent():
    s = QualitativeAKIS(scenario())
    assert s.apply(propose(), 1)["outcome"] == "APPLIED"
    view = cooperation_system_view(s.cooperation_links, s.works, s.resources,
                                   s.subjects, s.institution, s.trace, economics={})
    entry = view["relations"][0]
    assert len(entry["components"]["ОК"]["original_thirteen_code_requirements"]) == 1
    gate = entry["components"]["ОК"]["original_thirteen_code_requirements"][0]
    assert gate["qualified_original_field_count"] == 0
    assert gate["legal_authorization"] == "NOT_ESTABLISHED"
    economics = entry["components"]["Э"]["reconfiguration_economic_evidence"][0]
    assert economics["source_time_available_before_proposal"] == "NOT_QUALIFIED"
    assert economics["system_wide_net_gain"] is None
    assert entry["components"]["ЖЦ"]["organizational_change"] == "NOT_AUTOMATIC"


def test_original_consultees_frozen_inside_existing_qualitative_trace():
    from research.akis.qualitative_mesa.cooperation import cooperative_coordination_observations
    s = QualitativeAKIS(scenario())
    assert s.apply(propose(at=1), 1)["outcome"] == "APPLIED"
    opening = s.trace[-1]
    assert opening["original_consultees"] == ["a", "b", "c", "d", "op"]
    assert opening["original_relation_participants"] == ["a", "b", "c", "op"]
    assert opening["source_authentication"] == "MODEL_ONLY_DECLARED_UNVERIFIED"
    for at, party in enumerate(opening["original_consultees"], start=2):
        assert s.apply(respond(party, at=at), at)["outcome"] == "APPLIED"
    review = cooperation_change_reviews(
        s.cooperation_links, s.trace,
        current_org_revision=s.institution.revision, subjects=s.subjects,
    )[0]
    assert review["required_count"] == 5
    assert review["supporting_model_declarations"] == 5
    assert review["consultation_counts_originally_frozen"] is True
    assert review["organizational_code_authorization"] == "NOT_IMPLEMENTED"
    observed = cooperative_coordination_observations(s.cooperation_links[0], s.trace)
    assert observed["observed_coordination_events"]["RENEGOTIATION_AND_ADAPTATION"]["applied"] == 6
    assert observed["real_transaction_cost_amount"] is None
    assert observed["counterfactual_avoided_transactions"] == "NOT_IDENTIFIABLE"
    assert s.cooperation_links[0].participants == ("a","b","c","op")
    assert s.works["w1"].result == "NOT_SUBMITTED"


def test_original_response_cannot_precede_its_proposal_even_on_direct_event_path():
    s = QualitativeAKIS(scenario())
    assert s.apply(propose(at=10), 10)["outcome"] == "APPLIED"
    attempt = s.apply(respond("a", at=9), 9)
    assert attempt["outcome"] == "BLOCKED"
    assert attempt["reason"] == "COOPERATION_CHANGE_RESPONSE_MUST_FOLLOW_PROPOSAL"
    assert cooperation_change_reviews(s.cooperation_links, s.trace)[0]["consulted_count"] == 0
    assert s.works["w1"].obligation == "NOT_ACCEPTED"
