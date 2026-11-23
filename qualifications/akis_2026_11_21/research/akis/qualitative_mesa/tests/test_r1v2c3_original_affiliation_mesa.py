"""R1-V2C3: employee and division transfer, without retroactive Work rights."""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.affiliation import affiliation_fingerprint
from research.akis.qualitative_mesa.context_basis import (
    DECISION_SOURCE_FIELDS, DECISION_TARGET_FIELDS,
    DECISION_OPERATIONS, DECISION_PURPOSES,
    QUALIFIED_ACTIONS,
)
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1v2_intrafirm_original_subjects_mesa import intrafirm_case
from .test_r1l_post_result_original_reproduction_mesa import find


def _grant_original_right(basis, action, actor, target, fields, at, kind):
    core = "operator" if actor == "op" else "corporate"
    purpose = DECISION_PURPOSES[action]
    operation = DECISION_OPERATIONS[action]
    ref = f"model://{actor}/affiliation-owner-right-{target}-{action}-{at}"
    fields["source_rights_ref"] = ref
    refs = list(dict.fromkeys([
        ref, *(fields.get(n) for n in DECISION_SOURCE_FIELDS[action])
    ]))
    assert all(isinstance(x, str) for x in refs)
    for source_id in refs:
        if any(s["id"] == source_id for s in basis["sources"]):
            continue
        basis["sources"].append({
            "id": source_id, "owner": actor, "revision": "aff-r1",
            "status": "CONFIRMED", "usable_by": [actor],
            "core": core, "purposes": [purpose],
            "operations": [operation], "valid_from": 0,
            "valid_until": 90,
        })
    basis["decision_requirements"].append({
        "target": target, "action": action, "actor": actor,
        "sources": refs, "expected_revisions": ["aff-r1"] * len(refs),
        "core": core, "purpose": purpose, "operation": operation,
    })


def _strict_original_work_rights(d):
    basis = d["context_evidence"]
    basis["strict"] = True
    basis.setdefault("decision_requirements", [])
    used = {(r["work"], r["action"]) for r in basis["requirements"]}
    events = [e for e in d["events"]
              if e.get("work") in {"w1", "w2"}
              and e["action"] in QUALIFIED_ACTIONS]
    for work, action in sorted({(e["work"], e["action"]) for e in events} - used):
        actors = sorted({e["actor"] for e in events if e.get("work") == work
                         and e["action"] == action})
        key = f"model://op/affiliation-original-{work}-{action}"
        operation = ("EXECUTE" if action in {
            "start", "complete", "start_operation", "complete_operation",
            "resubmit", "handoff_dispatch", "handoff_receive",
        } else "ACCEPT")
        basis["sources"].append({
            "id": key, "owner": "op", "revision": "aff-work-r1",
            "status": "CONFIRMED", "usable_by": actors,
            "core": "institutional", "purposes": [f"AKIS_{work}_{action}"],
            "operations": [operation], "valid_from": 0, "valid_until": 90,
        })
        basis["requirements"].append({
            "work": work, "action": action, "sources": [key],
            "expected_revisions": ["aff-work-r1"],
            "core": "institutional", "purpose": f"AKIS_{work}_{action}",
            "operation": operation,
        })


def transfer_case(roles=("worker", "dept")):
    d = intrafirm_case()
    # The first Result and its independent owner assessments remain before
    # any transfer. Shift ONLY the second original Work cycle into the future.
    for ev in d["events"]:
        if ev["at"] >= 34:
            ev["at"] += 10
        if ev.get("prepared_at") is not None and ev["prepared_at"] >= 34:
            ev["prepared_at"] += 10
        if ev["action"] == "request" and ev["work_spec"]["id"] == "w2":
            ev["work_spec"]["slot_start"] += 10
            ev["work_spec"]["slot_end"] += 10
    d["model_horizon"] = 85
    _strict_original_work_rights(d)
    start = 32
    for index, who in enumerate(roles):
        at = start + 4 * index
        role = next(s for s in d["subjects"] if s["id"] == who)
        old = role["organization"]
        assert old == "a"
        old_ref = role["affiliation_source_ref"]
        new_ref = f"model://b/{who}-new-affiliation"
        record = {
            "affiliation_transfer_id": f"move-{who}",
            "role_target": who,
            "from_enterprise": old, "to_enterprise": "b",
            "old_affiliation_source_ref": old_ref,
            "new_affiliation_source_ref": new_ref,
            "self_role_source_ref": role["self_role_source_ref"],
            "pilot_work": "w1", "pilot_result_ref": "model://w1-result",
            "pilot_decision_at": 29, "org_revision": "oc-1",
        }
        digest = affiliation_fingerprint(record)
        events = [
            {"at": at, "actor": who, "action": "affiliation_transfer_propose",
             **record, "transfer_fingerprint": digest,
             "transfer_valid_until": 82,
             "transfer_source_ref": f"model://{who}/move-{who}-self"},
            {"at": at+1, "actor": "a", "action": "affiliation_transfer_review",
             "org_revision": "oc-1", "affiliation_transfer_id": f"move-{who}",
             "transfer_fingerprint": digest,
             "transfer_parent_source_ref": old_ref,
             "transfer_decision_source_ref": f"model://a/{who}-old-review",
             "transfer_decision": "SUPPORT_ORIGINAL_TRANSFER"},
            {"at": at+2, "actor": "b", "action": "affiliation_transfer_review",
             "org_revision": "oc-1", "affiliation_transfer_id": f"move-{who}",
             "transfer_fingerprint": digest,
             "transfer_parent_source_ref": new_ref,
             "transfer_decision_source_ref": f"model://b/{who}-new-review",
             "transfer_decision": "SUPPORT_ORIGINAL_TRANSFER"},
            {"at": at+3, "actor": "op", "action": "affiliation_transfer_apply",
             "org_revision": "oc-1", "affiliation_transfer_id": f"move-{who}",
             "transfer_fingerprint": digest},
        ]
        for event in events:
            _grant_original_right(
                d["context_evidence"], event["action"],
                event["actor"], event["affiliation_transfer_id"], event,
                event["at"], role["kind"],
            )
        # The receiving enterprise must separately grant the newly
        # affiliated role a purpose-limited share for future Work. Its
        # transfer review alone is insufficient.
        parent_source = next(
            row for row in d["context_evidence"]["sources"]
            if row["id"] == new_ref
        )
        parent_source["purposes"].append("AKIS_INTRA_WORK")
        parent_source["operations"].append("SHARE")
        parent_source["usable_by"].append(who)
        d["events"].extend(events)
    d["events"].sort(key=lambda e: e["at"])
    assert len({e["at"] for e in d["events"]}) == len(d["events"])
    return d


@pytest.mark.parametrize("roles", [("worker",), ("dept",), ("worker", "dept")])
def test_original_role_transfer_changes_parent_only_after_independent_decisions(roles):
    d = transfer_case(roles)
    before = deepcopy(d)
    out = simulate(d)
    assert before == d
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    for who in roles:
        assert out["subjects"][who]["original_enterprise"] == "b"
        assert out["subjects"][who]["affiliation_transition_history"] == [
            {"from_enterprise": "a", "to_enterprise": "b",
             "applied_at": 35 + 4 * roles.index(who)},
        ]
    assert out["works"]["w1"]["original_affiliation_at_commit"] == {
        "dept": "a", "worker": "a",
    }
    assert out["works"]["w1"]["consenting_principals"] == ["dept", "worker"]
    if len(roles) == 2:
        assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
        assert out["works"]["w2"]["original_affiliation_at_commit"] == {
            "dept": "b", "worker": "b",
        }
        assert out["counts"]["blocked"] == 0, [
            (r["at"],r["action"],r["reason"])
            for r in out["trace"] if r["outcome"]=="BLOCKED"
        ]
    else:
        assert find(out, "commit", work="w2")[0]["reason"] == (
            "FORMATION_AUTHOR_INTRA_INDEPENDENT_EMPLOYEE_REQUIRED"
            if roles == ("worker",) else
            "FORMATION_AUTHOR_INTRA_INDEPENDENT_EMPLOYEE_REQUIRED"
        )


@pytest.mark.parametrize("actor", ["a","b"])
def test_one_enterprise_objection_blocks_transfer_without_affecting_result(actor):
    d = transfer_case(("worker",))
    event = next(x for x in d["events"] if x["action"] ==
                 "affiliation_transfer_review" and x["actor"] == actor)
    event["transfer_decision"] = "OBJECT_ORIGINAL_TRANSFER"
    out = simulate(d)
    assert out["subjects"]["worker"]["original_enterprise"] == "a"
    assert find(out, "affiliation_transfer_apply")[0]["reason"] == (
        "AFFILIATION_OLD_OR_NEW_ENTERPRISE_OBJECTED"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_transfer_rechecks_previously_granted_old_enterprise_right_at_apply():
    d = transfer_case(("worker",))
    for ev in d["events"]:
        if ev["at"] >= 35:
            ev["at"] += 1
    source = next(x for x in d["events"]
                  if x["action"] == "affiliation_transfer_review"
                  and x["actor"] == "a")["source_rights_ref"]
    d["events"].append({
        "at":35,"action":"source_update","actor":"a","source":source,
        "status":"DISPROVED","expected_revision":"aff-r1",
        "new_revision":"aff-r2",
    })
    d["events"].sort(key=lambda e:e["at"])
    d["model_horizon"] += 1
    out = simulate(d)
    assert find(out,"affiliation_transfer_apply")[0]["outcome"] == "BLOCKED"
    assert out["subjects"]["worker"]["original_enterprise"] == "a"


def test_transfer_cannot_create_new_original_work_without_new_parent_compatible_roles():
    d = transfer_case(("worker",))
    out = simulate(d)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"


def test_operator_cannot_initiate_own_employee_transfer():
    d = transfer_case(("worker",))
    propose = next(x for x in d["events"] if x["action"]=="affiliation_transfer_propose")
    propose["actor"] = "op"
    out = simulate(d)
    assert find(out,"affiliation_transfer_propose")[0]["outcome"] == "BLOCKED"
    assert out["subjects"]["worker"]["original_enterprise"] == "a"
