"""Execute both alternatives through original Work, independently in Mesa.

Both arms share initial declarations, source permissions and two accepted
Results. No alternate executor, bank, legal contract or empirical proof.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_rules import fixture
from .test_r1u4_strict_original_source_rights_mesa import _original_rights, e
from .test_r4_original_buyer_offer_response_mesa import (
    buyer_response_case, BUYER_RESPONSE_ID, BUYER_RESPONSE_SOURCE,
    BUYER_RESPONSE_REVISION,
)
from .test_r4_independent_external_buyer_demand_mesa import (
    BUYER, BUYER_SOURCE, DEMAND_ID,
)
from .test_r4_independent_supplier_offer_mesa import OFFER_ID, OFFER_SOURCE
from .test_r1l_post_result_original_reproduction_mesa import find


OUTSIDE = "w-outside"
QUALITY = "outside-source-declared-quality-v1"
ACCEPTED = "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def route(work, customer, revision, at, start, *, quality=False):
    result = f"model://a/{work}-completed"
    events = [
        e(at, "offer", "op", work=work),
        e(at+1, "authorize", "op", work=work),
        e(at+2, "consent", "a", work=work,
          source_revision=revision, org_revision="oc-1"),
        e(at+3, "consent", customer, work=work,
          source_revision=revision, org_revision="oc-1"),
        e(at+4, "commit", "op", work=work),
        e(start, "start", "a", work=work),
        e(start+1, "complete", "a", work=work, result_ref=result),
    ]
    if quality:
        events.append(e(start+2, "assess_result_quality", customer,
                        work=work, criterion=QUALITY,
                        quality_verdict="MEETS_DECLARED_REQUIREMENT",
                        quality_evidence_ref=f"model://{customer}/{work}-inspection",
                        result_ref=result, source_revision=revision,
                        org_revision="oc-1"))
    events.append(e(start+3, "accept", customer, work=work))
    return events


def original_outside_work_case(arm="outside"):
    d = fixture()
    d["subjects"].append({"id": BUYER, "kind": "SME"})
    d["resources"][0].update(
        availability="AVAILABLE", capacity_units=1, capacity_unit="UNIT"
    )
    d["capacity_strict"] = True
    d["works"][0].update(slot_start=7, slot_end=12)
    d["works"].extend([
        dict(id="w2", customer="b", resource="ra", source_revision="d-2",
             slot_start=27, slot_end=32, requires_accepted=["w1"]),
        dict(id="w3", customer="b", resource="ra", source_revision="d-3",
             slot_start=106, slot_end=120, requires_accepted=["w2"],
             assurance_criteria=[dict(
                 id=QUALITY, dimension="DELIVERABLE_CONFORMITY", operation="WORK",
                 responsible_owner="a", assessor="b", method="INSPECTION",
                 source_ref="model://b/w3-comparable-quality", source_revision="d-3"
             )]),
    ])
    d["cooperation_links"] = [{
        "id": "l1", "purpose": "matched-third-work",
        "coordinator": "op", "participants": ["op", "a", "b"],
        "works": ["w1", "w2", "w3"], "mechanisms": ["TRANSACTION_COST"],
        "source_ref": "model://op/l1", "source_revision": "rel-1",
    }]
    old = buyer_response_case()
    signals = []
    for action, at in (
        ("outside_demand_signal", 78), ("outside_supplier_offer", 79),
        ("outside_buyer_offer_response", 80),
    ):
        event = deepcopy(next(row for row in old["events"]
                              if row["action"] == action))
        event["at"] = at
        signals.append(event)
    request = e(
        81, "request", BUYER,
        outside_work_origin={
            "outside_demand_id": DEMAND_ID,
            "outside_offer_id": OFFER_ID,
            "outside_buyer_response_id": BUYER_RESPONSE_ID,
        },
        work_spec=dict(
            id=OUTSIDE, customer=BUYER, resource="ra",
            source_revision="outside-d1", slot_start=106, slot_end=120,
            resource_requirements=[{"resource": "ra", "units": 1}],
            requires_accepted=["w2"],
            assurance_criteria=[dict(
                id=QUALITY, dimension="DELIVERABLE_CONFORMITY", operation="WORK",
                responsible_owner="a", assessor=BUYER, method="INSPECTION",
                source_ref=BUYER_SOURCE, source_revision="outside-d1",
            )],
        ),
    )
    common = route("w1", "b", "d-1", 1, 7) + route("w2", "b", "d-2", 20, 27)
    common += signals + [request]
    outside = route(OUTSIDE, BUYER, "outside-d1", 83, 106, quality=True)
    cooperation = route("w3", "b", "d-3", 90, 112, quality=True)
    # Qualify both possible original paths in one identical starting KPB.
    # One resource can serve only one overlapping obligation.
    d["events"] = sorted(common + outside + cooperation, key=lambda row: row["at"])
    d["model_horizon"] = 134
    _original_rights(d)
    d["context_evidence"]["sources"].extend(
        deepcopy(row) for row in old["context_evidence"]["sources"]
        if row["id"] in {BUYER_SOURCE, OFFER_SOURCE, BUYER_RESPONSE_SOURCE}
    )
    if arm == "outside":
        d["events"] = common + outside
    elif arm == "cooperation":
        d["events"] = common + cooperation
    elif arm == "both":
        pass
    elif arm == "no_commit":
        d["events"] = common
    else:
        raise ValueError("unknown arm")
    return d


def request_event(d):
    return next(row for row in d["events"]
                if row["action"] == "request" and row["work_spec"]["id"] == OUTSIDE)


def original_outside_request(output):
    return find(output, "request", work=OUTSIDE)[0]


def assert_history(out):
    assert all(out["works"][w]["result"] == ACCEPTED for w in ("w1", "w2"))
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out["context_basis"]["strict"]


def test_two_executed_alternatives_use_same_original_capacity_and_independent_acceptance():
    external, cooperative = (original_outside_work_case(arm)
                             for arm in ("outside", "cooperation"))
    assert {k: v for k, v in external.items() if k != "events"} == {
        k: v for k, v in cooperative.items() if k != "events"}
    assert [e for e in external["events"] if e["at"] <= 81] == [
        e for e in cooperative["events"] if e["at"] <= 81]
    frozen = deepcopy(external)
    out, coop = simulate(external), simulate(cooperative)
    assert external == frozen
    for trial in (out, coop):
        assert_history(trial)
        assert trial["counts"]["blocked"] == 0, [
            (r["at"], r["action"], r["reason"])
            for r in trial["trace"] if r["outcome"] == "BLOCKED"]
    assert out["works"][OUTSIDE]["result"] == ACCEPTED
    assert coop["works"]["w3"]["result"] == ACCEPTED
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert coop["works"][OUTSIDE]["result"] == "NOT_SUBMITTED"
    assert original_outside_request(out)["outside_work_origin"] == (
        request_event(external)["outside_work_origin"])
    assert out["works"][OUTSIDE]["consenting_principals"] == ["a", BUYER]
    assert coop["works"]["w3"]["consenting_principals"] == ["a", "b"]
    assert out["works"][OUTSIDE]["assurance"]["current_result_quality_gate"] == "NONE"
    assert coop["works"]["w3"]["assurance"]["current_result_quality_gate"] == "NONE"


def test_original_request_itself_creates_no_obligation_or_result():
    out = simulate(original_outside_work_case("no_commit"))
    assert_history(out)
    assert original_outside_request(out)["outcome"] == "APPLIED"
    assert out["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"
    assert out["works"][OUTSIDE]["result"] == "NOT_SUBMITTED"


@pytest.mark.parametrize("edit,reason", [
    (lambda d: request_event(d)["outside_work_origin"].update(
        outside_offer_id="foreign-offer"), "OUTSIDE_WORK_THREE_ORIGINAL_EVENTS_REQUIRED"),
    (lambda d: request_event(d)["outside_work_origin"].pop(
        "outside_buyer_response_id"), "OUTSIDE_WORK_ORIGIN_FIELDS_REQUIRED"),
    (lambda d: request_event(d)["work_spec"].update(
        slot_end=121), "OUTSIDE_WORK_ORIGINAL_COMPARISON_BASIS_REQUIRED"),
    (lambda d: request_event(d)["work_spec"]["resource_requirements"][0].update(
        units=2), "OUTSIDE_WORK_ORIGINAL_RESOURCE_QUANTITY_MISMATCH"),
    (lambda d: request_event(d)["work_spec"].pop(
        "assurance_criteria"), "OUTSIDE_WORK_ORIGINAL_BUYER_QUALITY_BASIS_REQUIRED"),
    (lambda d: request_event(d)["work_spec"]["assurance_criteria"][0].update(
        id="unrelated-quality"), "OUTSIDE_WORK_ORIGINAL_BUYER_QUALITY_BASIS_REQUIRED"),
    (lambda d: next(row for row in d["events"]
                   if row["action"] == "outside_buyer_offer_response").update(
        outside_buyer_response_decision="DECLINES_OFFER"),
     "OUTSIDE_BUYER_INDEPENDENTLY_DECLINED_OFFER"),
    (lambda d: request_event(d).update(
        cooperation_link="l1", cooperation_source_revision="rel-1"),
     "OUTSIDE_WORK_NOT_PART_OF_COMPARISON_COOPERATION"),
])
def test_wrong_origin_terms_or_buyer_refusal_cannot_create_original_request(edit, reason):
    d = original_outside_work_case("no_commit")
    edit(d)
    out = simulate(d)
    assert_history(out)
    assert original_outside_request(out)["reason"] == reason
    assert OUTSIDE not in out["works"]


def test_same_original_demand_cannot_create_two_bound_requests():
    d = original_outside_work_case("no_commit")
    second = deepcopy(request_event(d))
    second["at"] = 82
    second["work_spec"]["id"] = "w-copy"
    d["events"].append(second)
    out = simulate(d)
    assert original_outside_request(out)["outcome"] == "APPLIED"
    assert find(out, "request", work="w-copy")[0]["reason"] == (
        "OUTSIDE_WORK_ORIGINAL_DEMAND_ALREADY_USED")
    assert "w-copy" not in out["works"]
    assert_history(out)


def test_original_supplier_and_buyer_consents_still_required():
    d = original_outside_work_case()
    d["events"] = [row for row in d["events"] if not (
        row["action"] == "consent" and row.get("work") == OUTSIDE
        and row["actor"] == BUYER)]
    out = simulate(d)
    assert original_outside_request(out)["outcome"] == "APPLIED"
    assert find(out, "commit", work=OUTSIDE)[0]["reason"] == (
        "INDEPENDENT_ACCEPTANCE_MISSING")
    assert out["works"][OUTSIDE]["result"] == "NOT_SUBMITTED"
    assert_history(out)


def test_response_revoked_after_request_before_commit_blocks_original_reservation():
    d = original_outside_work_case()
    d["events"].append(e(
        82, "source_update", BUYER, source=BUYER_RESPONSE_SOURCE,
        expected_revision=BUYER_RESPONSE_REVISION, new_revision="revoked-v2",
        status="DISPROVED",
    ))
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert original_outside_request(out)["outcome"] == "APPLIED"
    assert find(out, "source_update")[0]["outcome"] == "APPLIED"
    assert find(out, "commit", work=OUTSIDE)[0]["reason"] == (
        "OUTSIDE_WORK_ORIGINAL_SOURCE_NOT_CURRENT")
    assert out["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"
    assert_history(out)


def test_late_source_revocation_does_not_rewrite_accepted_original_obligation():
    d = original_outside_work_case()
    d["events"].append(e(
        100, "source_update", BUYER, source=BUYER_RESPONSE_SOURCE,
        expected_revision=BUYER_RESPONSE_REVISION, new_revision="revoked-v2",
        status="DISPROVED",
    ))
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert find(out, "commit", work=OUTSIDE)[0]["outcome"] == "APPLIED"
    assert find(out, "source_update")[0]["outcome"] == "APPLIED"
    assert out["works"][OUTSIDE]["result"] == ACCEPTED
    assert_history(out)


def test_alternative_cannot_double_book_original_resource():
    out = simulate(original_outside_work_case("both"))
    assert find(out, "commit", work=OUTSIDE)[0]["outcome"] == "APPLIED"
    assert find(out, "commit", work="w3")[0]["outcome"] == "BLOCKED"
    assert out["works"][OUTSIDE]["result"] == ACCEPTED
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert_history(out)


def test_outside_buyer_quality_decision_is_not_automatic():
    d = original_outside_work_case()
    d["events"] = [row for row in d["events"] if not (
        row["action"] == "assess_result_quality" and row.get("work") == OUTSIDE)]
    out = simulate(d)
    assert find(out, "accept", work=OUTSIDE)[0]["reason"] == (
        "QUALITY_ORIGINAL_ASSESSMENT_MISSING")
    assert out["works"][OUTSIDE]["result"] == "SUBMITTED"
    assert_history(out)


def test_failed_original_quality_does_not_make_external_result_accepted():
    d = original_outside_work_case()
    next(row for row in d["events"]
         if row["action"] == "assess_result_quality"
         and row.get("work") == OUTSIDE)["quality_verdict"] = "DOES_NOT_MEET"
    out = simulate(d)
    assert find(out, "accept", work=OUTSIDE)[0]["outcome"] == "BLOCKED"
    assert out["works"][OUTSIDE]["result"] == "SUBMITTED"
    assert_history(out)
