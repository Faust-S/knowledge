"""AKIS R1-U3: original refusal, exit, dissolution and reconstitution.

Only the original Mesa trace, Work/Result and CapacityLedger are changed.
Loss of future cooperation cannot cancel already accepted obligations.
"""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.cooperation import (
    CooperationLink, _lifecycle_document,
)
from .test_r1q_original_coalition_membership_mesa import membership_case


def _e(t, action, actor, **rest):
    return {"at": t, "action": action, "actor": actor, **rest}


def _link(*, exited=False):
    return CooperationLink(
        "net-2", "original-cooperation", "op",
        ("b", "op") if exited else ("a", "b", "op", "c"),
        (), ("TRANSACTION_COST", "SHARED_LOGISTICS"),
        "model://b/net-2-source", "n-2",
    )


def _proposal(kind, t, ident, digest, pilot="w2", result="model://w2-result",
              decision_at=23, parties=(), **override):
    return _e(
        t, "cooperation_lifecycle_propose", "b",
        cooperation_link="net-2", cooperation_source_revision="n-2",
        org_revision="oc-1", lifecycle_id=ident, lifecycle_kind=kind,
        lifecycle_fingerprint=digest,
        lifecycle_source_ref=f"model://b/{ident}-origin",
        lifecycle_valid_until=85,
        lifecycle_new_participants=list(parties),
        pilot_work=pilot, pilot_result_ref=result,
        pilot_decision_at=decision_at,
        **override,
    )


def _response(t, ident, digest, person, decision="SUPPORT_MODEL_PROPOSAL"):
    return _e(
        t, "cooperation_lifecycle_response", person,
        cooperation_link="net-2", cooperation_source_revision="n-2",
        org_revision="oc-1", lifecycle_id=ident,
        lifecycle_fingerprint=digest, lifecycle_decision=decision,
        lifecycle_response_source_ref=f"model://{person}/{ident}-{t}",
    )


def _apply(t, ident, digest, **more):
    return _e(
        t, "cooperation_lifecycle_apply", "b",
        cooperation_link="net-2", cooperation_source_revision="n-2",
        org_revision="oc-1", lifecycle_id=ident,
        lifecycle_fingerprint=digest, **more,
    )


def _new_work(name, resource, start, end, prior="w2"):
    return {
        "id": name, "customer": "b", "resource": resource,
        "source_revision": f"source-{name}",
        "slot_start": start, "slot_end": end,
        "requires_accepted": [prior],
    }


def original_dissolution_case(*, objection=None, missing=None,
                              forged_dissolution=False,
                              forged_restoration=False, no_restoration=False):
    d = membership_case()
    events = d["events"]
    # A new original, already accepted obligation exists at the moment of
    # dissolution. The ownership / Result of this Work survives the closure.
    events += [
        _e(24, "request", "b", cooperation_link="net-2",
           cooperation_source_revision="n-2",
           work_spec=_new_work("w3", "rc", 60, 70)),
        _e(25, "offer", "op", work="w3"),
        _e(26, "authorize", "op", work="w3"),
        _e(27, "consent", "b", work="w3",
           source_revision="source-w3", org_revision="oc-1"),
        _e(28, "consent", "c", work="w3",
           source_revision="source-w3", org_revision="oc-1"),
        _e(29, "commit", "op", work="w3"),
        # 'a' declines future involvement on its own; no old Work is erased.
        _e(30, "participation_status", "a",
           cooperation_link="net-2", cooperation_source_revision="n-2",
           org_revision="oc-1", new_participation="PAUSED_NEW_WORK",
           economic_channel="TRANSACTION_COST",
           participation_evidence_ref="model://a/independent-refusal"),
        _e(31, "request", "b", cooperation_link="net-2",
           cooperation_source_revision="n-2",
           work_spec=_new_work("w4", "ra", 75, 85)),
    ]
    dissolve_hash = _lifecycle_document(
        _link(), "DISSOLVE", "w2", "model://w2-result", 23, ()
    )
    events.append(_proposal("DISSOLVE", 32, "dissolve-1", dissolve_hash))
    for i, person in enumerate(("a", "b", "c", "op")):
        if person == missing:
            continue
        events.append(_response(
            33 + i, "dissolve-1", dissolve_hash, person,
            "OBJECT_MODEL_PROPOSAL" if person == objection
            else "SUPPORT_MODEL_PROPOSAL",
        ))
    events.append(_apply(
        37, "dissolve-1",
        ("f" * 64 if forged_dissolution else dissolve_hash)
    ))
    events.append(_e(
        38, "request", "b",
        cooperation_link="net-2", cooperation_source_revision="n-2",
        work_spec=_new_work("w5", "rc", 75, 85),
    ))
    restore_members = ("b", "c", "op")
    restore_hash = _lifecycle_document(
        _link(), "RECONSTITUTE", "w2", "model://w2-result",
        23, restore_members,
    )
    if not no_restoration:
        events.append(_proposal(
            "RECONSTITUTE", 39, "restore-1", restore_hash,
            parties=restore_members,
        ))
        for i, person in enumerate(restore_members):
            events.append(_response(
                40 + i, "restore-1", restore_hash, person
            ))
        events.append(_apply(
            43, "restore-1",
            "e" * 64 if forged_restoration else restore_hash,
            new_link_id="net-3", new_link_revision="n-3",
            new_link_source_ref="model://b/net-3-source",
        ))
    events.extend([
        _e(44, "start", "c", work="w3"),
        _e(45, "complete", "c", work="w3",
           result_ref="model://c/w3-original-result"),
        _e(46, "accept", "b", work="w3"),
        _e(47, "request", "b", cooperation_link="net-2",
           cooperation_source_revision="n-2",
           work_spec=_new_work("w5-late", "rc", 88, 97)),
    ])
    if not no_restoration:
        events.extend([
            _e(48, "request", "b",
               cooperation_link="net-3",
               cooperation_source_revision="n-3",
               work_spec=_new_work("w6", "rc", 80, 90, prior="w3")),
            _e(49, "offer", "op", work="w6"),
            _e(50, "authorize", "op", work="w6"),
            _e(51, "consent", "b", work="w6",
               source_revision="source-w6", org_revision="oc-1"),
            _e(52, "consent", "c", work="w6",
               source_revision="source-w6", org_revision="oc-1"),
            _e(53, "commit", "op", work="w6"),
            _e(54, "start", "c", work="w6"),
            _e(55, "complete", "c", work="w6",
               result_ref="model://c/w6-original-result"),
            _e(56, "accept", "b", work="w6"),
            # 'a' did not rejoin; the successor cannot consume its resource.
            _e(57, "request", "b",
               cooperation_link="net-3", cooperation_source_revision="n-3",
               work_spec=_new_work("w7", "ra", 100, 110, prior="w6")),
        ])
    d["events"] = sorted(events, key=lambda x: x["at"])
    d["model_horizon"] = 61
    return d


def rows(output, action):
    return [x for x in output["trace"] if x["action"] == action]


def test_original_pending_obligation_survives_dissolution_and_new_relationship_recovers():
    d = original_dissolution_case()
    copy = deepcopy(d)
    out = simulate(d)
    assert copy == d
    assert rows(out, "cooperation_lifecycle_apply")[0]["outcome"] == "APPLIED"
    dissolved = rows(out, "cooperation_lifecycle_apply")[0]
    assert dissolved["lifecycle_old_original_outstanding_work"] == ["w3"]
    assert rows(out, "cooperation_lifecycle_apply")[1]["outcome"] == "APPLIED"
    reconstructed = rows(out, "cooperation_lifecycle_apply")[1]
    assert reconstructed["lifecycle_successor_link"] == "net-3"
    assert reconstructed["lifecycle_not_rejoined_original_members"] == ["a"]
    assert reconstructed["lifecycle_old_original_outstanding_work"] == ["w3"]
    links = {x["id"]: x for x in out["cooperation"]["links"]}
    assert links["net-2"]["future_cooperation_status"] == "DISSOLVED_FOR_FUTURE_WORK"
    assert links["net-2"]["reconstituted_as"] == "net-3"
    assert links["net-3"]["reconstituted_from"] == "net-2"
    assert links["net-3"]["works"] == ["w6"]
    assert links["net-3"]["original_participants"] == ["b", "c", "op"]
    assert all(out["works"][key]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for key in ("w1", "w2", "w3", "w6"))
    assert out["works"]["w1"]["consenting_principals"] == ["a", "b"]
    assert out["works"]["w3"]["consenting_principals"] == ["b", "c"]
    assert out["works"]["w6"]["consenting_principals"] == ["b", "c"]
    assert out["resources"]["ra"]["owner"] == "a"
    assert out["resources"]["rc"]["owner"] == "c"
    assert rows(out, "request")[-1]["reason"] == (
        "COOPERATION_NEW_ORIGINAL_PARTY_REQUIRES_REVIEW"
    )
    assert simulate(deepcopy(d)) == out


@pytest.mark.parametrize("person", ["a", "b", "c", "op"])
def test_each_original_party_can_block_operator_imposed_dissolution(person):
    d = original_dissolution_case(objection=person, no_restoration=True)
    out = simulate(d)
    assert rows(out, "cooperation_lifecycle_apply")[0]["reason"] == (
        "COOPERATION_LIFECYCLE_INDEPENDENT_OBJECTION_OR_REFUSAL"
    )
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert next(x for x in out["cooperation"]["links"]
                if x["id"] == "net-2")["future_cooperation_status"] == (
                    "OPEN_FOR_NEW_ORIGINAL_WORK"
                )


@pytest.mark.parametrize("person", ["a", "b", "c", "op"])
def test_each_missing_original_response_blocks_dissolution(person):
    out = simulate(original_dissolution_case(
        missing=person, no_restoration=True
    ))
    assert rows(out, "cooperation_lifecycle_apply")[0]["reason"] == (
        "COOPERATION_LIFECYCLE_INDEPENDENT_RESPONSES_MISSING"
    )
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_dissolution_never_occurred_if_original_fingerprint_forged():
    out = simulate(original_dissolution_case(
        forged_dissolution=True, no_restoration=True
    ))
    assert rows(out, "cooperation_lifecycle_apply")[0]["reason"] == (
        "COOPERATION_LIFECYCLE_APPLICATION_ORIGINAL_SCOPE_STALE"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_reconstitution_requires_original_unchanged_source_fingerprint():
    out = simulate(original_dissolution_case(forged_restoration=True))
    assert rows(out, "cooperation_lifecycle_apply")[1]["reason"] == (
        "COOPERATION_LIFECYCLE_APPLICATION_ORIGINAL_SCOPE_STALE"
    )
    assert "net-3" not in [x["id"] for x in out["cooperation"]["links"]]
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_independent_paused_participation_blocks_future_but_not_accepted_work():
    out = simulate(original_dissolution_case(no_restoration=True))
    earlier = next(x for x in rows(out, "request") if x["at"] == 31)
    assert earlier["reason"] == "COOPERATION_ORIGINAL_PARTY_PAUSED_NEW_WORK"
    assert rows(out, "commit")[-1]["outcome"] == "APPLIED"
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert next(x for x in rows(out, "request") if x["at"] == 38)[
        "reason"] == "COOPERATION_RELATION_DISSOLVED_FOR_FUTURE_WORK"


def test_restoration_does_not_bypass_strict_original_context_rights():
    d = original_dissolution_case()
    state = QualitativeAKIS({
        k: v for k, v in d.items() if k != "model_horizon"
    })
    state.context_basis = SimpleNamespace(strict=True)
    proposal = next(
        e for e in d["events"] if e["action"] == "cooperation_lifecycle_propose"
    )
    blocked = state.apply(proposal, proposal["at"])
    assert blocked["outcome"] == "BLOCKED"
    assert blocked["reason"] == "COOPERATION_LIFECYCLE_SOURCE_RIGHTS_NOT_QUALIFIED"


def test_reconstruction_cannot_begin_without_prior_actual_dissolution():
    d = original_dissolution_case()
    d["events"] = [
        x for x in d["events"]
        if x["action"] != "cooperation_lifecycle_apply"
        or x.get("lifecycle_id") != "dissolve-1"
    ]
    out = simulate(d)
    attempt = next(x for x in rows(out, "cooperation_lifecycle_propose")
                   if x["lifecycle_kind"] == "RECONSTITUTE")
    assert attempt["reason"] == "COOPERATION_LIFECYCLE_PRIOR_DISSOLUTION_REQUIRED"
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_dissolved_relation_cannot_be_reconstituted_twice():
    d = original_dissolution_case()
    d["events"].extend([
        _proposal(
            "RECONSTITUTE", 58, "restore-2",
            _lifecycle_document(
                _link(), "RECONSTITUTE", "w3",
                "model://c/w3-original-result", 46, ("b", "c", "op")
            ),
            pilot="w3", result="model://c/w3-original-result", decision_at=46,
            parties=("b", "c", "op"),
        ),
    ])
    d["model_horizon"] = 62
    out = simulate(d)
    assert rows(out, "cooperation_lifecycle_propose")[-1]["reason"] == (
        "COOPERATION_LIFECYCLE_ALREADY_RECONSTITUTED"
    )
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"



def test_old_consents_without_original_commit_never_survive_dissolution_as_commit():
    d = membership_case()
    events = d["events"]
    events.extend([
        _e(24, "request", "b", cooperation_link="net-2",
           cooperation_source_revision="n-2",
           work_spec=_new_work("w3", "rc", 60, 70)),
        _e(25, "offer", "op", work="w3"),
        _e(26, "authorize", "op", work="w3"),
        _e(27, "consent", "b", work="w3",
           source_revision="source-w3", org_revision="oc-1"),
        _e(28, "consent", "c", work="w3",
           source_revision="source-w3", org_revision="oc-1"),
    ])
    digest = _lifecycle_document(
        _link(), "DISSOLVE", "w2", "model://w2-result", 23, ()
    )
    events.append(_proposal("DISSOLVE", 29, "close-pending", digest))
    for i, member in enumerate(("a", "b", "c", "op")):
        events.append(_response(30 + i, "close-pending", digest, member))
    events.extend([
        _apply(34, "close-pending", digest),
        _e(35, "commit", "op", work="w3"),
    ])
    d["events"] = sorted(events, key=lambda x: x["at"])
    d["model_horizon"] = 38
    out = simulate(d)
    assert rows(out, "cooperation_lifecycle_apply")[0]["outcome"] == "APPLIED"
    assert rows(out, "commit")[-1]["reason"] == (
        "COOPERATION_RELATION_DISSOLVED_FOR_FUTURE_WORK"
    )
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert out["works"]["w3"]["consenting_principals"] == ["b", "c"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_explicit_original_exit_then_dissolution_then_new_accepted_result():
    d = membership_case(change="REVIEW_FUTURE_PARTICIPATION")
    # R1-Q already executed the independent departure of 'a'. Its original
    # Work/Result remains historical; the future successor is 'b,op'.
    digest_close = _lifecycle_document(
        _link(exited=True), "DISSOLVE", "w2",
        "model://w2-result", 23, ()
    )
    digest_restore = _lifecycle_document(
        _link(exited=True), "RECONSTITUTE", "w2",
        "model://w2-result", 23, ("b", "op")
    )
    d["events"].extend([
        _proposal("DISSOLVE", 24, "exit-close", digest_close),
        _response(25, "exit-close", digest_close, "b"),
        _response(26, "exit-close", digest_close, "op"),
        _apply(27, "exit-close", digest_close),
        _proposal(
            "RECONSTITUTE", 28, "exit-reconstitute", digest_restore,
            parties=("b", "op"),
        ),
        _response(29, "exit-reconstitute", digest_restore, "b"),
        _response(30, "exit-reconstitute", digest_restore, "op"),
        _apply(
            31, "exit-reconstitute", digest_restore,
            new_link_id="net-3", new_link_revision="n-3",
            new_link_source_ref="model://b/exit-restored-link",
        ),
        _e(
            32, "request", "b", cooperation_link="net-3",
            cooperation_source_revision="n-3",
            work_spec=_new_work("w3", "rb", 42, 52),
        ),
        _e(33, "offer", "op", work="w3"),
        _e(34, "authorize", "op", work="w3"),
        _e(35, "consent", "b", work="w3",
           source_revision="source-w3", org_revision="oc-1"),
        _e(36, "commit", "op", work="w3"),
        _e(37, "start", "b", work="w3"),
        _e(38, "complete", "b", work="w3",
           result_ref="model://b/w3-after-reconstitution"),
        _e(39, "accept", "b", work="w3"),
    ])
    d["model_horizon"] = 44
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"])
        for x in out["trace"] if x["outcome"] == "BLOCKED"
    ]
    links = {x["id"]: x for x in out["cooperation"]["links"]}
    assert links["net"]["future_cooperation_status"] == (
        "SUPERSEDED_FOR_FUTURE_WORK"
    )
    assert links["net-2"]["future_cooperation_status"] == (
        "DISSOLVED_FOR_FUTURE_WORK"
    )
    assert links["net-3"]["original_participants"] == ["b", "op"]
    assert links["net-3"]["works"] == ["w3"]
    assert links["net-3"]["reconstituted_from"] == "net-2"
    assert all(out["works"][k]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for k in ("w1", "w2", "w3"))
    assert out["resources"]["ra"]["owner"] == "a"
    assert out["works"]["w1"]["consenting_principals"] == ["a", "b"]
    assert out["subjects"]["a"]["active_for_new_work"] is True


def test_foreign_original_source_cannot_impersonate_a_coalition_owner():
    d = original_dissolution_case(no_restoration=True)
    forged = next(
        x for x in d["events"]
        if x["action"] == "cooperation_lifecycle_response"
        and x["actor"] == "c"
    )
    forged["lifecycle_response_source_ref"] = "model://b/false-c-response"
    out = simulate(d)
    assert next(
        x for x in rows(out, "cooperation_lifecycle_response")
        if x["actor"] == "c"
    )["reason"] == "COOPERATION_LIFECYCLE_INDEPENDENT_OWNER_SOURCE_REQUIRED"
    assert rows(out, "cooperation_lifecycle_apply")[0]["reason"] == (
        "COOPERATION_LIFECYCLE_INDEPENDENT_RESPONSES_MISSING"
    )
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_operator_cannot_author_original_lifecycle_for_enterprise():
    d = original_dissolution_case(no_restoration=True)
    proposal = next(
        x for x in d["events"]
        if x["action"] == "cooperation_lifecycle_propose"
    )
    proposal["actor"] = "op"
    out = simulate(d)
    assert rows(out, "cooperation_lifecycle_propose")[0]["reason"] == (
        "COOPERATION_LIFECYCLE_ORIGINAL_SME_AND_REVISION_REQUIRED"
    )
    assert rows(out, "cooperation_lifecycle_apply")[0]["reason"] == (
        "COOPERATION_LIFECYCLE_ORIGINAL_PROPOSAL_REQUIRED"
    )
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_reconstitution_repeated_apply_does_not_create_second_successor():
    d = original_dissolution_case()
    digest = _lifecycle_document(
        _link(), "RECONSTITUTE", "w2", "model://w2-result", 23,
        ("b", "c", "op"),
    )
    d["events"].append(_apply(
        58, "restore-1", digest,
        new_link_id="net-4", new_link_revision="n-4",
        new_link_source_ref="model://b/second-illegal-successor",
    ))
    d["model_horizon"] = 63
    out = simulate(d)
    assert rows(out, "cooperation_lifecycle_apply")[-1]["reason"] == (
        "COOPERATION_LIFECYCLE_ALREADY_RECONSTITUTED"
    )
    assert "net-4" not in [x["id"] for x in out["cooperation"]["links"]]
    assert out["works"]["w6"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_missing_true_accepted_result_cannot_be_used_as_dissolution_basis():
    d = membership_case()
    d["events"] = [
        x for x in d["events"]
        if not (x["action"] == "accept" and x.get("work") == "w2")
    ]
    digest = _lifecycle_document(
        _link(), "DISSOLVE", "w2", "model://w2-result", 23, ()
    )
    d["events"].append(_proposal(
        "DISSOLVE", 24, "not-accepted-pilot", digest
    ))
    d["model_horizon"] = 27
    out = simulate(d)
    assert rows(out, "cooperation_lifecycle_propose")[0]["reason"] == (
        "COOPERATION_LIFECYCLE_ACCEPTED_ORIGINAL_RESULT_REQUIRED"
    )
    assert out["works"]["w2"]["result"] == "SUBMITTED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
