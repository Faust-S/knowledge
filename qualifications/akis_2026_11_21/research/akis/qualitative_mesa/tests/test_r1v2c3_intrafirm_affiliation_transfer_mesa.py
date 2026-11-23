"""R1-V2C3: original employee and division independently change employer.

No accepted Work or Result is retroactively reassigned. Strict ContextBasis
rechecks both enterprise decisions and the role's self-issued proposal.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.affiliation import (
    _document, affiliation_fingerprint,
)
from research.akis.qualitative_mesa.context_basis import (
    DECISION_OPERATIONS, DECISION_PURPOSES, DECISION_SOURCE_FIELDS,
    DECISION_TARGET_FIELDS, QUALIFIED_ACTIONS,
)
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1v2_intrafirm_original_subjects_mesa import intrafirm_case


def _rows(out, action):
    return [x for x in out["trace"] if x["action"] == action]


def _add_work_kpb(data):
    """Existing ContextBasis with source-scoped original Work decisions."""
    basis = data["context_evidence"]
    basis["strict"] = True
    known = {
        (r["work"], r["action"]) for r in basis["requirements"]
    }
    actions = {}
    for row in data["events"]:
        work = (
            row["work_spec"]["id"] if row["action"] == "request"
            else row.get("work")
        )
        if work in {"w1", "w2", "w3"} and row["action"] in QUALIFIED_ACTIONS:
            actions.setdefault((work, row["action"]), set()).add(row["actor"])
    for (work, action), actors in sorted(actions.items()):
        if (work, action) in known:
            continue
        sid = f"model://op/r1v2c3-context-{work}-{action}"
        operation = (
            "EXECUTE" if action in {
                "start", "complete", "resubmit", "start_operation",
                "complete_operation",
            } else "ACCEPT"
        )
        basis["sources"].append({
            "id": sid, "owner": "op", "revision": "scope-r1",
            "status": "CONFIRMED", "usable_by": sorted(actors),
            "core": "institutional",
            "purposes": [f"AKIS_ORIGINAL_WORK_{work}"],
            "operations": [operation],
            "valid_from": 0, "valid_until": 170,
        })
        basis["requirements"].append({
            "work": work, "action": action, "sources": [sid],
            "expected_revisions": ["scope-r1"],
            "core": "institutional",
            "purpose": f"AKIS_ORIGINAL_WORK_{work}",
            "operation": operation,
        })


def _add_transfer_kpb(data):
    basis = data["context_evidence"]
    source_map = {r["id"]: r for r in basis["sources"]}
    for row in data["events"]:
        action = row["action"]
        if action not in DECISION_SOURCE_FIELDS or not action.startswith(
            "affiliation_transfer_"
        ):
            continue
        actor = row["actor"]
        own = f"model://{actor}/r1v2c3-right-{action}-{row['affiliation_transfer_id']}"
        row["source_rights_ref"] = own
        references = list(dict.fromkeys([
            own,
            *(row.get(name) for name in DECISION_SOURCE_FIELDS[action]),
        ]))
        assert all(ref and ref.startswith(f"model://{actor}/")
                   for ref in references)
        for ref in references:
            if ref in source_map:
                continue
            new = {
                "id": ref, "owner": actor, "revision": "rights-r1",
                "status": "CONFIRMED", "usable_by": [actor],
                "valid_until": 170,
                "core": "operator" if actor == "op" else "corporate",
                "purposes": [DECISION_PURPOSES[action]],
                "operations": [DECISION_OPERATIONS[action]],
                "valid_from": 0,
            }
            basis["sources"].append(new)
            source_map[ref] = new
        basis.setdefault("decision_requirements", []).append({
            "target": row[DECISION_TARGET_FIELDS[action]],
            "action": action, "actor": actor,
            "sources": references,
            "expected_revisions": [source_map[ref]["revision"] for ref in references],
            "core": "operator" if actor == "op" else "corporate",
            "purpose": DECISION_PURPOSES[action],
            "operation": DECISION_OPERATIONS[action],
        })


def _one_transfer(data, role, *, start, pilot_work="w2",
                  pilot_result_ref="model://w2-result", pilot_decision_at=59):
    subject = next(x for x in data["subjects"] if x["id"] == role)
    previous = subject["organization"]
    assert previous == "a"
    target = "b"
    ident = f"transfer-{role}"
    new_ref = f"model://b/new-{role}-affiliation"
    proposal = {
        "at": start,
        "action": "affiliation_transfer_propose",
        "actor": role, "role_target": role,
        "affiliation_transfer_id": ident,
        "from_enterprise": previous, "to_enterprise": target,
        "old_affiliation_source_ref": subject["affiliation_source_ref"],
        "new_affiliation_source_ref": new_ref,
        "self_role_source_ref": subject["self_role_source_ref"],
        "transfer_source_ref": f"model://{role}/self-transfer-intent",
        "org_revision": "oc-1",
        "pilot_work": pilot_work,
        "pilot_result_ref": pilot_result_ref,
        "pilot_decision_at": pilot_decision_at,
        "transfer_valid_until": 160,
    }
    digest = affiliation_fingerprint(_document(proposal))
    proposal["transfer_fingerprint"] = digest
    data["events"].append(proposal)
    for t, owner, ref in (
        (start + 1, previous, subject["affiliation_source_ref"]),
        (start + 2, target, new_ref),
    ):
        data["events"].append({
            "at": t, "action": "affiliation_transfer_review",
            "actor": owner, "affiliation_transfer_id": ident,
            "transfer_fingerprint": digest, "org_revision": "oc-1",
            "transfer_parent_source_ref": ref,
            "transfer_decision_source_ref":
                f"model://{owner}/independent-{ident}-review",
            "transfer_decision": "SUPPORT_ORIGINAL_TRANSFER",
        })
    data["events"].append({
        "at": start + 3, "action": "affiliation_transfer_apply",
        "actor": "op", "affiliation_transfer_id": ident,
        "transfer_fingerprint": digest, "org_revision": "oc-1",
    })


def transfer_case(role="worker"):
    data = intrafirm_case()
    # Both accepted original works must predate the independent new
    # affiliation. No prior Work/Result is produced by a transfer event.
    _one_transfer(data, role, start=63)
    _add_work_kpb(data)
    _add_transfer_kpb(data)
    data["events"].sort(key=lambda row: row["at"])
    data["model_horizon"] = 85
    return data


@pytest.mark.parametrize("role", ["worker", "dept"])
def test_original_role_three_independent_decisions_apply_future_affiliation(role):
    data = transfer_case(role)
    original = deepcopy(data)
    out = simulate(data)
    assert original == data
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"])
        for r in out["trace"] if r["outcome"] == "BLOCKED"
    ]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["subjects"][role]["original_enterprise"] == "b"
    assert out["subjects"][role]["affiliation_transition_history"] == [{
        "from_enterprise": "a", "to_enterprise": "b", "applied_at": 66,
    }]
    for work in ("w1", "w2"):
        assert out["works"][work]["original_affiliation_at_commit"] == {
            "dept": "a", "worker": "a",
        }
    assert [r["actor"] for r in _rows(out, "affiliation_transfer_review")] == [
        "a", "b",
    ]
    assert _rows(out, "affiliation_transfer_apply")[0]["outcome"] == "APPLIED"
    assert out == simulate(deepcopy(data))


@pytest.mark.parametrize("role", ["worker", "dept"])
def test_old_or_new_enterprise_objection_blocks_transfer_and_keeps_results(role):
    for owner in ("a", "b"):
        data = transfer_case(role)
        next(row for row in data["events"]
             if row["action"] == "affiliation_transfer_review"
             and row["actor"] == owner)[
                 "transfer_decision"
             ] = "OBJECT_ORIGINAL_TRANSFER"
        out = simulate(data)
        assert _rows(out, "affiliation_transfer_apply")[0]["reason"] == (
            "AFFILIATION_OLD_OR_NEW_ENTERPRISE_OBJECTED"
        )
        assert out["subjects"][role]["original_enterprise"] == "a"
        assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_one_enterprise_cannot_decide_for_other_enterprise():
    data = transfer_case("worker")
    data["events"] = [
        r for r in data["events"]
        if not (r["action"] == "affiliation_transfer_review"
                and r["actor"] == "b")
    ]
    out = simulate(data)
    assert _rows(out, "affiliation_transfer_apply")[0]["reason"] == (
        "AFFILIATION_BOTH_ENTERPRISE_DECISIONS_REQUIRED"
    )
    assert out["subjects"]["worker"]["original_enterprise"] == "a"


def test_new_enterprise_source_revoked_after_review_blocks_apply():
    data = transfer_case("worker")
    apply = next(r for r in data["events"]
                 if r["action"] == "affiliation_transfer_apply")
    apply["at"] += 1
    data["events"].append({
        "at": 66, "action": "source_update", "actor": "b",
        "source": "model://b/new-worker-affiliation",
        "status": "DISPROVED", "expected_revision": "rights-r1",
        "new_revision": "rights-r2",
    })
    data["events"].sort(key=lambda r: r["at"])
    out = simulate(data)
    assert _rows(out, "source_update")[0]["outcome"] == "APPLIED"
    assert _rows(out, "affiliation_transfer_apply")[0]["reason"] == (
        "CONTEXT_REVISION_STALE"
    )
    assert out["subjects"]["worker"]["original_enterprise"] == "a"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_unfinished_original_work_blocks_affiliation_without_losing_accepted_pilot():
    data = transfer_case("worker")
    data["events"] = [
        row for row in data["events"]
        if not (row["action"] == "accept" and row.get("work") == "w2")
    ]
    for row in data["events"]:
        if row["action"] == "affiliation_transfer_propose":
            row.update(
                pilot_work="w1", pilot_result_ref="model://w1-result",
                pilot_decision_at=29,
            )
            row["transfer_fingerprint"] = affiliation_fingerprint(
                _document(row)
            )
            digest = row["transfer_fingerprint"]
        if row["action"] in {
            "affiliation_transfer_review", "affiliation_transfer_apply",
        }:
            row["transfer_fingerprint"] = digest
    out = simulate(data)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert _rows(out, "affiliation_transfer_apply")[0]["reason"] == (
        "AFFILIATION_UNFINISHED_ORIGINAL_OBLIGATION"
    )
    assert out["subjects"]["worker"]["original_enterprise"] == "a"


def test_role_cannot_borrow_enterprise_original_right():
    data = transfer_case("worker")
    next(row for row in data["events"]
         if row["action"] == "affiliation_transfer_propose")[
             "source_rights_ref"
         ] = "model://a/borrowed-role-right"
    out = simulate(data)
    assert _rows(out, "affiliation_transfer_propose")[0]["reason"] == (
        "CONTEXT_DECISION_INDEPENDENT_OWNER_RIGHT_MISSING"
    )
    assert _rows(out, "affiliation_transfer_apply")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
