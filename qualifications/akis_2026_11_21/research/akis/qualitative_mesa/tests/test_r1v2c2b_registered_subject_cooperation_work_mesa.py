"""R1-V2C2B. A genuinely newly registered actor enters an existing coalition.

The SAME qualified Mesa runs subject admission, optional sector capacity,
prospective membership, original formation/OC/KPB, fresh Work and Result.
Earlier Result, resources and independent decisions remain untouched.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.context_basis import (
    DECISION_OPERATIONS, DECISION_PURPOSES, DECISION_SOURCE_FIELDS,
    DECISION_TARGET_FIELDS,
)
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.source_registration import registration_fingerprint

from .test_r1v2b_extended_original_author_subjects_mesa import case, KINDS
from .test_r1u4_strict_original_source_rights_mesa import e, rows, accepted_result


def _shift_work_two(events, delta):
    for ev in events:
        if ev["at"] >= 34:
            ev["at"] += delta
        if type(ev.get("prepared_at")) is int and ev["prepared_at"] >= 34:
            ev["prepared_at"] += delta
        if ev["action"] == "request" and ev["work_spec"]["id"] == "w2":
            ev["work_spec"]["slot_start"] += delta
            ev["work_spec"]["slot_end"] += delta


def _insert_before(events, matching, new_event):
    next_event = next(ev for ev in events if matching(ev))
    at = next_event["at"]
    for ev in events:
        if ev["at"] >= at:
            ev["at"] += 1
        if type(ev.get("prepared_at")) is int and ev["prepared_at"] >= at:
            ev["prepared_at"] += 1
    new_event["at"] = at
    events.append(new_event)


def _original_actor_rights(d, kind):
    """Extend the ORIGINAL ContextBasis with scoped owner-held decisions.

    No synthesized grants in rules.py: every source/requirement is visible in
    a single input and is rechecked by ContextBasis on membership apply.
    """
    basis = d["context_evidence"]
    core = {
        "SECTOR_BODY": "institutional",
        "PUBLIC_INSTITUTION": "institutional",
        "NATURAL_PERSON": "personal",
    }[kind]
    role = {
        "SECTOR_BODY": ("AKIS_SECTOR_ROLE", "AKIS_SECTOR_STANDARD"),
        "PUBLIC_INSTITUTION": ("AKIS_PUBLIC_ROLE", "AKIS_PUBLIC_MANDATE"),
        "NATURAL_PERSON": ("AKIS_PERSON_ROLE", "AKIS_PERSON_CONTEXT_ACCESS"),
    }[kind]
    for reference, purpose, operation, recipients in [
        ("model://c/new-role", role[0], "ACCEPT", ["c"]),
        ("model://c/new-scope", role[1], "SHARE",
         ["c", "a", "b", "sector", "public", "person"]),
        ("model://c/new-role-management", "AKIS_ROLE_MANAGEMENT",
         "EXECUTE", ["c"]),
    ]:
        # Do not include names of actors that do not exist in this form.
        known = {row["id"] for row in d["subjects"]} | {"c"}
        basis["sources"].append({
            "id": reference, "owner": "c", "revision": "role-r1",
            "status": "CONFIRMED", "usable_by": sorted(set(recipients) & known),
            "valid_until": 120, "core": core, "purposes": [purpose],
            "operations": [operation], "valid_from": 0,
        })
    if kind == "SECTOR_BODY":
        # An existing sector service independently permits the prospective
        # new actor to use this precise cooperation context after admission.
        for source in basis["sources"]:
            if source["id"] == "model://sector/r1v2b-access":
                source["usable_by"] = sorted(set(source["usable_by"]) | {"c"})
    for event in d["events"]:
        action = event["action"]
        if action not in DECISION_SOURCE_FIELDS:
            continue
        actor = event["actor"]
        decision_core = (
            "operator" if actor == "op" else
            core if actor == "c" else
            "personal" if actor == "person" else
            "institutional" if actor in {"sector", "public"} else
            "corporate"
        )
        own = f"model://{actor}/r1v2c2b-{action}-{event['at']}"
        event["source_rights_ref"] = own
        originals = [
            event[name] for name in DECISION_SOURCE_FIELDS[action]
            if name in event
        ]
        refs = list(dict.fromkeys([own, *originals]))
        for source_id in refs:
            if any(row["id"] == source_id for row in basis["sources"]):
                continue
            basis["sources"].append({
                "id": source_id, "owner": actor, "revision": "rights-r1",
                "status": "CONFIRMED", "usable_by": [actor],
                "valid_until": 120, "core": decision_core,
                "purposes": [DECISION_PURPOSES[action]],
                "operations": [DECISION_OPERATIONS[action]],
                "valid_from": 0,
            })
        basis.setdefault("decision_requirements", []).append({
            "target": event[DECISION_TARGET_FIELDS[action]],
            "action": action, "actor": actor,
            "sources": refs, "expected_revisions": ["rights-r1"] * len(refs),
            "core": decision_core, "purpose": DECISION_PURPOSES[action],
            "operation": DECISION_OPERATIONS[action],
        })


def original_new_actor_cycle(form="sector"):
    assert form in {"sector", "macro", "trace"}
    kind, existing, _, role_name, _, _, core = KINDS[form]
    d = case(form)
    _shift_work_two(d["events"], 24)
    pilot = {
        "pilot_work": "w1", "pilot_result_ref": "model://w1-result",
        "pilot_decision_at": 29,
    }
    declaration = {
        "id": "c", "kind": kind,
        "self_role_source_ref": "model://c/new-role",
        ("context_source_ref" if form == "trace" else "mandate_source_ref"):
            "model://c/new-scope",
        "role_source_revision": "role-r1",
        "role_management_source_ref": "model://c/new-role-management",
    }
    registration = {
        "subject_registration_id": "admit-c", "new_subject": "c",
        "new_subject_kind": kind, "new_subject_spec": deepcopy(declaration),
        **pilot,
    }
    fingerprint = registration_fingerprint(registration)
    d["events"].extend([
        e(32, "subject_registration_propose", "op",
          org_revision="oc-1", **registration,
          registration_source_ref="model://op/admit-c-proposal",
          registration_valid_until=110, registration_fingerprint=fingerprint),
        e(33, "subject_registration_attest", "c",
          org_revision="oc-1", subject_registration_id="admit-c",
          registration_fingerprint=fingerprint,
          registration_self_ref="model://c/own-identity",
          registration_goal_source_ref="model://c/own-goal",
          registration_alternative_source_ref="model://c/own-alternative",
          registration_willingness="WILLING"),
        e(34, "subject_registration_review", "a",
          org_revision="oc-1", subject_registration_id="admit-c",
          registration_fingerprint=fingerprint,
          registration_decision="SUPPORT_MODEL_SOURCE",
          registration_decision_source_ref="model://a/admit-c-review"),
        e(35, "subject_registration_review", "b",
          org_revision="oc-1", subject_registration_id="admit-c",
          registration_fingerprint=fingerprint,
          registration_decision="SUPPORT_MODEL_SOURCE",
          registration_decision_source_ref="model://b/admit-c-review"),
        e(36, "subject_registration_apply", "op",
          org_revision="oc-1", subject_registration_id="admit-c",
          registration_fingerprint=fingerprint),
    ])
    if form == "sector":
        resource = {
            "id": "rc", "owner": "c", "availability": "AVAILABLE",
            "capacity_units": 1, "capacity_unit": "service",
            "site": "sector-c",
        }
        resource_sha = registration_fingerprint(resource)
        d["events"].extend([
            e(37, "resource_registration_propose", "c",
              org_revision="oc-1", resource_registration_id="rc-admission",
              resource_spec=deepcopy(resource), resource_fingerprint=resource_sha,
              registration_resource_source_ref="model://c/rc-ownership",
              registration_valid_until=110),
            e(38, "resource_registration_review", "a",
              org_revision="oc-1", resource_registration_id="rc-admission",
              resource_fingerprint=resource_sha,
              registration_decision="SUPPORT_MODEL_SOURCE",
              registration_decision_source_ref="model://a/rc-review"),
            e(39, "resource_registration_review", "b",
              org_revision="oc-1", resource_registration_id="rc-admission",
              resource_fingerprint=resource_sha,
              registration_decision="SUPPORT_MODEL_SOURCE",
              registration_decision_source_ref="model://b/rc-review"),
            e(40, "resource_registration_apply", "op",
              org_revision="oc-1", resource_registration_id="rc-admission",
              resource_fingerprint=resource_sha, resource_spec=deepcopy(resource)),
        ])
    link = d["cooperation_links"][0]
    proposer = "b" if form == "sector" else "a"
    member_change = {
        "cooperation_link": link["id"],
        "cooperation_source_revision": link["source_revision"],
        "org_revision": "oc-1", "change_id": "admit-cooperation-c",
    }
    d["events"].extend([
        e(41, "cooperation_change_propose", proposer, **member_change,
          change_kind="ADD_FUTURE_PARTICIPANT", proposed_subject="c",
          economic_channel="TRANSACTION_COST",
          change_source_ref=f"model://{proposer}/c-membership-proposal",
          **pilot),
        e(42, "cooperation_entry_assess", "c", **member_change,
          entry_goal_source_ref="model://c/entry-goal",
          entry_alternative_source_ref="model://c/entry-outside",
          entry_assessment_source_ref="model://c/entry-position",
          entry_willingness="WILLING",
          entry_outside_option="UNKNOWN", entry_valid_until=110),
    ])
    for t, actor in enumerate(sorted(set(link["participants"]) | {"c"}), 43):
        d["events"].append(e(
            t, "cooperation_change_response", actor, **member_change,
            change_decision="SUPPORT_MODEL_PROPOSAL",
            change_source_ref=f"model://{actor}/c-membership-response",
        ))
    d["events"].append(e(
        47, "cooperation_membership_apply", proposer, **member_change,
        **pilot, new_link_id="l2", new_link_revision="rel-2",
        new_link_source_ref=f"model://{proposer}/l2-membership-edition",
    ))
    request = next(ev for ev in d["events"] if ev["action"] == "request"
                   and ev["work_spec"]["id"] == "w2")
    request["cooperation_link"] = "l2"
    request["cooperation_source_revision"] = "rel-2"
    request["change_id"] = "admit-cooperation-c"
    spec = request["work_spec"]
    if form == "sector":
        spec["resource_requirements"] = [
            {"resource": spec["resource"], "units": 1},
            {"resource": "rc", "units": 1},
        ]
        # The new sector participant independently confirms its readiness.
        d["general_akis"]["formation_phases"].append({
            "owner": "c", "source_ref": "model://c/formation-3",
            "revision": "oc-1", "available_at": 36, "expires_at": 90,
            "phase": 3,
        })
        _insert_before(
            d["events"],
            lambda ev: ev["action"] == "formation_confirm"
            and ev.get("work") == "w2" and ev.get("phase") == 4,
            e(0, "formation_confirm", "c", work="w2",
              org_revision="oc-1", work_source_revision="d-2",
              phase=3, formation_source_ref="model://c/formation-3"),
        )
        _insert_before(
            d["events"],
            lambda ev: ev["action"] == "commit" and ev.get("work") == "w2",
            e(0, "consent", "c", work="w2", source_revision="d-2",
              org_revision="oc-1"),
        )
    else:
        # Existing public/person was customer of accepted w1. The NEW person
        # or institute becomes the independent customer of subsequent w2.
        original_customer = spec["customer"]
        assert original_customer == existing
        spec["customer"] = "c"
        request["actor"] = "c"
        for ev in d["events"]:
            if ev.get("work") != "w2":
                continue
            if ev["actor"] == original_customer and ev["action"] in {
                "formation_confirm", "function_review", "consent", "accept",
            }:
                ev["actor"] = "c"
                if ev["action"] == "formation_confirm":
                    ev["formation_source_ref"] = (
                        ev["formation_source_ref"].replace(
                            f"model://{existing}/", "model://c/"
                        )
                    )
                elif ev["action"] == "function_review":
                    ev["review_source_ref"] = "model://c/independent-review-w2"
        for goal in d["general_akis"]["goals"]:
            if goal.get("work") == "w2":
                goal["owner"] = "c"
                goal["source_ref"] = "model://c/goal-w2"
                goal["available_at"] = 36
        for phase in (1, 2, 7):
            d["general_akis"]["formation_phases"].append({
                "owner": "c",
                "source_ref": f"model://c/formation-{phase}",
                "revision": "oc-1", "available_at": 36,
                "expires_at": 90, "phase": phase,
            })
        # The original code still controls independent subject decisions:
        # the supplier remains responsible, both customers consent in their
        # respective works. No single public actor signs for another.
        code = {r["field"]: r["control"]
                for r in d["general_akis"]["organizational_code"]}
        for responsibility in code["Отв"]["responsibilities"]:
            if responsibility["action"] == "commit":
                responsibility["original_principals"] = ["a"]
    code = {r["field"]: r["control"]
            for r in d["general_akis"]["organizational_code"]}
    code["С"]["subjects"].append("c")
    code["ИД"]["model_identified"].append("c")
    code["Рол"]["role_bindings"].append({
        "subject": "c", "items": [role_name],
    })
    # The new principal has its own actual Work consent, checked against
    # the same operator-owned action-scoped KPB source as former principals.
    for item in d["context_evidence"]["requirements"]:
        if item["work"] == "w2" and item["action"] == "consent":
            for source in d["context_evidence"]["sources"]:
                if source["id"] in item["sources"]:
                    source["usable_by"] = sorted(
                        set(source["usable_by"]) | {"c"}
                    )
    d["events"].sort(key=lambda ev: ev["at"])
    assert len({ev["at"] for ev in d["events"]}) == len(d["events"])
    _original_actor_rights(d, kind)
    d["model_horizon"] = max(89, max(x["at"] for x in d["events"]) + 1)
    return d


@pytest.mark.parametrize("form", ["sector", "macro", "trace"])
def test_registered_actor_independently_joins_original_coalition_and_accepts_fresh_result(form):
    d = original_new_actor_cycle(form)
    initial = deepcopy(d)
    out = simulate(d)
    assert initial == d
    failures = [
        f"{r['at']} {r['action']} {r['reason']}"
        for r in out["trace"] if r["outcome"] == "BLOCKED"
    ]
    assert not failures, "\\n".join(failures)
    assert out["subjects"]["c"]["kind"] == KINDS[form][0]
    assert accepted_result(out, "w1")
    assert accepted_result(out, "w2")
    assert rows(out, "subject_registration_apply")[0]["outcome"] == "APPLIED"
    assert rows(out, "cooperation_membership_apply")[0]["outcome"] == "APPLIED"
    links = {l["id"]: l for l in out["cooperation"]["links"]}
    assert "c" not in links["l1"]["original_participants"]
    assert "c" in links["l2"]["original_participants"]
    assert links["l1"]["works"] == ["w0", "w1"]
    assert links["l2"]["works"] == ["w2"]
    assert "c" in out["works"]["w2"]["consenting_principals"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w1"]["result_history"] == simulate(deepcopy(d))[
        "works"]["w1"]["result_history"]
    assert out["context_basis"]["strict"]
    assert out["profit"]["system_increment"] == "UNKNOWN"
    if form == "sector":
        assert out["capacity"]["resources"]["rc"]["owner"] == "c"
        assert out["works"]["w2"]["consenting_principals"] == [
            "b", "c", "sector",
        ]
    else:
        assert out["works"]["w2"]["consenting_principals"] == [
            "a", "c",
        ]


def test_membership_refuses_old_source_revoked_before_apply():
    d = original_new_actor_cycle("sector")
    request = next(ev for ev in d["events"]
                   if ev["action"] == "cooperation_change_response"
                   and ev["actor"] == "a")
    source = request["source_rights_ref"]
    for ev in d["events"]:
        if ev["at"] >= 47:
            ev["at"] += 1
    d["events"].append(e(
        47, "source_update", "a", source=source,
        status="DISPROVED", expected_revision="rights-r1",
        new_revision="rights-r2",
    ))
    d["events"].sort(key=lambda ev: ev["at"])
    d["model_horizon"] += 1
    out = simulate(d)
    assert accepted_result(out, "w1")
    assert rows(out, "cooperation_membership_apply")[0]["outcome"] == "BLOCKED"
    assert not any(l["id"] == "l2" for l in out["cooperation"]["links"])
    assert not accepted_result(out, "w2") if "w2" in out["works"] else True


def test_new_result_absence_never_counts_as_reproduction():
    d = original_new_actor_cycle("sector")
    d["events"] = [ev for ev in d["events"]
                   if not (ev["action"] == "accept" and ev.get("work") == "w2")]
    out = simulate(d)
    assert accepted_result(out, "w1")
    assert not accepted_result(out, "w2")
    assert out["works"]["w2"]["result"] == "SUBMITTED"
