"""Dynamic cooperative future participation on the ORIGINAL AKIS event path.

Research only: a future-work pause is not withdrawal from existing obligations,
exclusion from the institution, an authenticated legal notice, or a second Result.
"""
import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.tests.test_technology import act, signed
from research.akis.qualitative_mesa.tests.test_cooperation_akis_integration import linked_world


def availability_event(at, actor="b", status="PAUSED_NEW_WORK", **change):
    value = {
        "at": at, "action": "participation_status", "actor": actor,
        "cooperation_link": "network-1", "cooperation_source_revision": "nw-r1",
        "org_revision": "oc-1", "new_participation": status,
        "economic_channel": "TRANSACTION_COST",
        "participation_evidence_ref": f"model://owner-{actor}-{at}",
    }
    value.update(change)
    return value


def test_original_member_can_pause_and_resume_without_creating_contract():
    s = QualitativeAKIS(linked_world())
    assert s.apply(availability_event(1), 1)["outcome"] == "APPLIED"
    assert act(s, 2, "offer", "op")["outcome"] == "APPLIED"
    assert act(s, 3, "authorize", "op")["outcome"] == "APPLIED"
    assert act(s, 4, "consent", "a", source_revision="d1", org_revision="oc-1")["outcome"] == "APPLIED"
    assert act(s, 5, "consent", "b", source_revision="d1", org_revision="oc-1")["reason"] == "COOPERATION_ORIGINAL_PARTY_PAUSED_NEW_WORK"
    assert act(s, 6, "consent", "c", source_revision="d1", org_revision="oc-1")["outcome"] == "APPLIED"
    assert s.works["w1"].consents.keys() == {"a", "c"}
    assert s.works["w1"].obligation == "NOT_ACCEPTED"
    assert s.apply(availability_event(7, status="OPEN_TO_NEW_WORK"), 7)["outcome"] == "APPLIED"
    assert act(s, 8, "consent", "b", source_revision="d1", org_revision="oc-1")["outcome"] == "APPLIED"
    assert act(s, 9, "commit", "op")["outcome"] == "APPLIED"
    assert s.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert s.works["w1"].result == "NOT_SUBMITTED"
    assert s.snapshot()["cooperation"]["links"][0]["relation_state"] == "ORIGINAL_COMMITMENTS_ACTIVE"


def test_pause_after_consents_but_before_commit_blocks_without_erasing_consents():
    s = QualitativeAKIS(linked_world())
    for t, actor, action in [(1, "op", "offer"), (2, "op", "authorize")]:
        assert act(s, t, action, actor)["outcome"] == "APPLIED"
    for t, actor in [(3, "a"), (4, "b"), (5, "c")]:
        assert act(s, t, "consent", actor, source_revision="d1", org_revision="oc-1")["outcome"] == "APPLIED"
    assert s.apply(availability_event(6), 6)["outcome"] == "APPLIED"
    assert act(s, 7, "commit", "op")["reason"] == "COOPERATION_ORIGINAL_PARTY_PAUSED_NEW_WORK"
    assert s.works["w1"].consents.keys() == {"a", "b", "c"}
    assert s.works["w1"].obligation == "NOT_ACCEPTED"
    assert s.capacity_ledger.reservations == []
    assert s.apply(availability_event(8, status="OPEN_TO_NEW_WORK"), 8)["outcome"] == "APPLIED"
    assert act(s, 9, "commit", "op")["outcome"] == "APPLIED"


def test_pausing_after_commit_cannot_cancel_accepted_work():
    s = QualitativeAKIS(linked_world())
    signed(s)
    assert s.apply(availability_event(7), 7)["outcome"] == "APPLIED"
    assert s.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert s.works["w1"].consents.keys() == {"a", "b", "c"}
    assert act(s, 8, "start_operation", "a", operation="cut")["outcome"] == "APPLIED"
    assert s.works["w1"].result == "NOT_SUBMITTED"


def test_unrelated_new_original_work_not_subject_to_cooperative_pause():
    from research.akis.qualitative_mesa.tests.test_cooperation_akis_integration import requested_work
    s = QualitativeAKIS(linked_world())
    assert s.apply(availability_event(1), 1)["outcome"] == "APPLIED"
    request = {"at":2, "action":"request", "actor":"c",
               "work_spec":requested_work(resource="ra")}
    assert s.apply(request, 2)["outcome"] == "APPLIED"
    assert s.works["w2"].proposal == "REQUESTED"
    assert s.cooperation_links[0].works == ("w1",)


def test_linked_new_request_blocked_by_original_party_pause():
    from research.akis.qualitative_mesa.tests.test_cooperation_akis_integration import requested_work
    s = QualitativeAKIS(linked_world())
    assert s.apply(availability_event(1), 1)["outcome"] == "APPLIED"
    request = {"at":2, "action":"request", "actor":"c",
               "work_spec":requested_work(resource="rb"),
               "cooperation_link":"network-1",
               "cooperation_source_revision":"nw-r1"}
    result = s.apply(request, 2)
    assert result["reason"] == "COOPERATION_ORIGINAL_PARTY_PAUSED_NEW_WORK"
    assert "w2" not in s.works
    assert s.cooperation_links[0].works == ("w1",)
    assert s.apply(availability_event(3, status="OPEN_TO_NEW_WORK"), 3)["outcome"] == "APPLIED"
    request["at"] = 4
    assert s.apply(request, 4)["outcome"] == "APPLIED"
    assert s.cooperation_links[0].works == ("w1", "w2")
    assert s.works["w2"].obligation == "NOT_ACCEPTED"


@pytest.mark.parametrize("change,reason", [
    ({"actor":"outside"}, "PARTICIPATION_SUBJECT_NOT_ACTIVE"),
    ({"cooperation_link":"missing"}, "PARTICIPATION_ORIGINAL_MEMBER_REQUIRED"),
    ({"actor":"op"}, "PARTICIPATION_ORIGINAL_ENTERPRISE_REQUIRED"),
    ({"cooperation_source_revision":"stale"}, "COOPERATION_SOURCE_REVISION_STALE"),
    ({"org_revision":"future"}, "STALE_ORGANIZATIONAL_CODE"),
    ({"economic_channel":"UNRELATED_ERP"}, "COOPERATION_INTEREST_CHANNEL_NOT_DECLARED"),
    ({"new_participation":["PAUSED_NEW_WORK"]}, "PARTICIPATION_STATUS_INVALID"),
    ({"new_participation":"CANCEL_EXISTING_CONTRACT"}, "PARTICIPATION_STATUS_INVALID"),
    ({"participation_evidence_ref":"https://unverified"}, "PARTICIPATION_MODEL_SOURCE_REQUIRED"),
])
def test_invalid_owner_or_claim_cannot_change_future_participation(change, reason):
    s = QualitativeAKIS(linked_world())
    result = s.apply(availability_event(1, **change), 1)
    assert result["outcome"] == "BLOCKED"
    assert result["reason"] == reason
    assert not [row for row in s.trace if row["action"] == "participation_status" and
                row["outcome"] == "APPLIED"]


def test_original_founders_code_change_does_not_resume_member_paused_by_self():
    s = QualitativeAKIS(linked_world())
    assert s.apply(availability_event(1), 1)["outcome"] == "APPLIED"
    # Simulate an independent institutional revision at the original institution
    # without pretending an existing party's pause is revoked.
    s.institution.revision = "oc-2"
    from research.akis.qualitative_mesa.cooperation import latest_future_participation
    assert latest_future_participation(
        s.trace, "network-1", "b", "nw-r1", s.institution.revision,
    ) == "PAUSED_NEW_WORK"


def test_native_mesa_observes_participant_pause_without_automatic_exit():
    pytest.importorskip("mesa", reason="Official native Mesa required")
    from research.akis.qualitative_mesa.mesa_model import simulate
    d = linked_world()
    d["events"] = [
        {"at":1,"action":"offer","actor":"op","work":"w1"},
        {"at":2, **availability_event(2)},
        {"at":3,"action":"authorize","actor":"op","work":"w1"},
        {"at":4,"action":"consent","actor":"a","work":"w1","source_revision":"d1","org_revision":"oc-1"},
        {"at":5,"action":"consent","actor":"b","work":"w1","source_revision":"d1","org_revision":"oc-1"},
    ]
    result = simulate(d)
    assert result["counts"] == {"applied":4,"blocked":1}
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert result["cooperation"]["system_projection"]["relations"][0]["components"]["У"]["paused_for_new_cooperation_count"] == 1
