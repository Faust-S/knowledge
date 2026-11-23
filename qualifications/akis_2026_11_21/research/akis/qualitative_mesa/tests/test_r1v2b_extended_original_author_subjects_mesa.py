"""AKIS R1-V2B. Sector / public / person original actors and owned sources.

Three different author forms execute in ONE original Mesa, ContextBasis,
OC, CapacityLedger, Work/Result and phase-8 causal cycle. All permissions
are owner-scoped MODEL_ONLY assertions; no real mandate is authenticated.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError

from .test_r1l_post_result_original_reproduction_mesa import (
    two_cycle_lifecycle_case, find,
)


KINDS = {
    "sector": ("SECTOR_BODY", "sector", "a", "RESOURCE_OWNER",
               "AKIS_SECTOR_ROLE", "AKIS_SECTOR_STANDARD", "institutional"),
    "macro": ("PUBLIC_INSTITUTION", "public", "b", "CUSTOMER",
              "AKIS_PUBLIC_ROLE", "AKIS_PUBLIC_MANDATE", "institutional"),
    "trace": ("NATURAL_PERSON", "person", "b", "CUSTOMER",
              "AKIS_PERSON_ROLE", "AKIS_PERSON_CONTEXT_ACCESS", "personal"),
}
EXPECTED_STATUS = {
    "sector": "ORIGINAL_SECTOR_SME_STANDARDS_WORK_PARTIAL",
    "macro": "ORIGINAL_PUBLIC_INSTITUTION_SME_WORK_PARTIAL",
    "trace": "ORIGINAL_PERSON_CONTEXT_SME_WORK_PARTIAL",
}
OWNER_SCOPES = {
    "sector": "ORIGINAL_SECTOR_BODY_SME_WORK",
    "macro": "ORIGINAL_PUBLIC_INSTITUTION_SME_WORK",
    "trace": "ORIGINAL_NATURAL_PERSON_CONTEXT_SME_WORK",
}


def case(form: str):
    assert form in KINDS
    kind, name, replaces, role, own_purpose, scope_purpose, core = KINDS[form]
    d = two_cycle_lifecycle_case()
    first_source = f"model://{name}/r1v2b-own-role"
    access_source = f"model://{name}/r1v2b-access"
    subject = {
        "id": name, "kind": kind, "self_role_source_ref": first_source,
        "role_source_revision": "role-r1",
        ("context_source_ref" if form == "trace" else "mandate_source_ref"):
            access_source,
    }
    d["subjects"].append(subject)

    if replaces == "a":
        for res in d["resources"]:
            if res["owner"] == "a":
                res["owner"] = name
    else:
        for work in d["works"]:
            if work["customer"] == "b":
                work["customer"] = name
    d["cooperation_links"][0]["participants"] = sorted(["op", name,
                                                         "b" if replaces == "a"
                                                         else "a"])
    g = d["general_akis"]
    g["configuration"] = form
    g["enforce_model_author_configuration_work_scope"] = True
    if form == "sector":
        g["morphology"]["scale"] = "отраслевые"
        g["morphology"]["knowledge"] = "отраслевой"
    elif form == "macro":
        g["morphology"]["scale"] = "региональные"
        g["morphology"]["data"] = "доверенные"
    else:
        g["morphology"]["scale"] = "региональные"
        g["morphology"]["data"] = "доверенные"

    code = {r["field"]: r["control"] for r in g["organizational_code"]}
    code["С"]["subjects"].append(name)
    code["ИД"]["model_identified"].append(name)
    code["Рол"]["role_bindings"].append({
        "subject": name, "items": [role],
    })
    responsible = next(row for row in code["Отв"]["responsibilities"]
                       if row["action"] == "commit")
    responsible["original_principals"] = sorted(
        ["b", name] if replaces == "a" else ["a", name]
    )

    if replaces == "b":
        for goal in g["goals"]:
            if goal["owner"] == "b":
                goal["owner"] = name
                goal["source_ref"] = goal["source_ref"].replace(
                    "model://b/", f"model://{name}/"
                )
    for phase in g["formation_phases"]:
        owner, step = phase["owner"], phase["phase"]
        replace_phase = (
            (replaces == "a" and owner == "a" and step in {3, 8})
            or (replaces == "b" and owner == "b"
                and step in {1, 2, 7, 8})
        )
        if replace_phase:
            phase["owner"] = name
            phase["source_ref"] = phase["source_ref"].replace(
                f"model://{owner}/", f"model://{name}/"
            )
    for event in d["events"]:
        action = event["action"]
        if action == "request" and replaces == "b":
            event["actor"] = name
            event["work_spec"]["customer"] = name
        elif action == "formation_confirm":
            phase = event["phase"]
            owner = event["actor"]
            swap = (
                (replaces == "a" and owner == "a" and phase == 3)
                or (replaces == "b" and owner == "b" and phase in {1, 2})
            )
            if swap:
                event["actor"] = name
                event["formation_source_ref"] = event[
                    "formation_source_ref"
                ].replace(f"model://{owner}/", f"model://{name}/")
        elif action in {"consent", "start", "complete", "accept"}:
            if event["actor"] == replaces:
                event["actor"] = name
        elif action == "function_review" and replaces == "b":
            event["actor"] = name
            event["review_source_ref"] = event["review_source_ref"].replace(
                "model://b/", f"model://{name}/"
            )
        elif action == "participation_status" and event["actor"] == replaces:
            event["actor"] = name
            for field in (
                "participation_evidence_ref", "formation_phase_source_ref",
            ):
                event[field] = event[field].replace(
                    f"model://{replaces}/", f"model://{name}/"
                )

    # SAME ContextBasis containing the existing corporate/institutional
    # original sources. Its strict version also covers all Work actions.
    basis = d["context_evidence"]
    basis["strict"] = True
    other = "b" if replaces == "a" else "a"
    for source, purpose, operation, people in [
        (first_source, own_purpose, "ACCEPT", [name]),
        (access_source, scope_purpose, "SHARE", [name, other]),
    ]:
        basis["sources"].append({
            "id": source, "owner": name,
            "revision": "role-r1", "status": "CONFIRMED",
            "usable_by": people, "core": core,
            "purposes": [purpose], "operations": [operation],
            "valid_from": 0, "valid_until": 90,
        })

    actions = {
        (ev.get("work"), ev["action"])
        for ev in d["events"]
        if ev.get("work") in {"w1", "w2"}
        and ev["action"] in {
            "authorize", "consent", "commit", "start",
            "complete", "accept", "reject", "resubmit",
        }
    }
    existing = {
        (row["work"], row["action"])
        for row in basis["requirements"]
    }
    for work, action in sorted(actions - existing):
        people = sorted({
            e["actor"] for e in d["events"]
            if e.get("work") == work and e["action"] == action
        })
        operation = "EXECUTE" if action in {
            "start", "complete", "resubmit",
        } else "ACCEPT"
        source = f"model://op/context-{work}-{action}"
        basis["sources"].append({
            "id": source, "owner": "op", "revision": "work-r1",
            "status": "CONFIRMED", "usable_by": people,
            "core": "institutional",
            "purposes": [f"AKIS_ORIGINAL_WORK_{work}"],
            "operations": [operation],
            "valid_from": 0, "valid_until": 90,
        })
        basis["requirements"].append({
            "work": work, "action": action, "sources": [source],
            "expected_revisions": ["work-r1"],
            "core": "institutional",
            "purpose": f"AKIS_ORIGINAL_WORK_{work}",
            "operation": operation,
        })
    return d


@pytest.mark.parametrize("form", sorted(KINDS))
def test_extended_original_author_form_has_own_actor_two_accepted_work_results(form):
    d = case(form)
    unchanged = deepcopy(d)
    out = simulate(d)
    assert d == unchanged
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"])
        for x in out["trace"] if x["outcome"] == "BLOCKED"
    ]
    kind, name, _, _, _, _, _ = KINDS[form]
    assert out["subjects"][name]["kind"] == kind
    assert out["subjects"][name][
        "real_person_or_institutional_mandate_authenticated"
    ] is False
    assert [out["works"][w]["result"] for w in ("w1", "w2")] == [
        "ACCEPTED_BY_ORIGINAL_RECIPIENT",
        "ACCEPTED_BY_ORIGINAL_RECIPIENT",
    ]
    principals = sorted(["b", name] if form == "sector" else ["a", name])
    for w in ("w1", "w2"):
        assert out["works"][w]["consenting_principals"] == principals
    assert out["context_basis"]["strict"]
    assert out["context_basis"]["authenticated_documents"] is False
    conf = out["general_akis_model"]["configuration_dynamics"]
    assert conf["configuration"] == form
    assert conf["status"] == EXPECTED_STATUS[form]
    assert conf["required_but_unmodelled_roles"] == []
    assert all(row["configuration_applicability"] == OWNER_SCOPES[form]
               for row in conf["original_work_scope"])
    assert all(row["model_scope_result"] == "NONE"
               for row in conf["original_commit_form_gate"]["original_work_checks"])
    witnesses = out["general_akis_private_cycle_evidence"][
        "original_author_form_eight_phase_reproduction"
    ]
    assert len(witnesses) == 1, witnesses
    assert witnesses[0]["author_selected_form"] == form
    assert witnesses[0]["original_phase_8_independent_principals"] == principals
    assert witnesses[0]["followup_original_work"] == "w2"
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out == simulate(deepcopy(d))


@pytest.mark.parametrize("form", sorted(KINDS))
def test_missing_strict_kpb_cannot_create_original_extended_role_work(form):
    d = case(form)
    d["context_evidence"]["strict"] = False
    out = simulate(d)
    assert find(out, "request", work="w1")[0]["reason"] == (
        "AUTHOR_EXTENDED_ROLE_ORIGINAL_STRICT_KPB_REQUIRED"
    )
    assert "w1" not in out["works"]


@pytest.mark.parametrize("form", sorted(KINDS))
def test_extended_role_source_owner_cannot_be_borrowed_from_other_principal(form):
    d = case(form)
    _, name, _, _, _, _, _ = KINDS[form]
    row = next(x for x in d["subjects"] if x["id"] == name)
    row["self_role_source_ref"] = "model://op/borrowed-role"
    with pytest.raises(InputError, match=(
        "AUTHOR_ROLE_INDEPENDENT_SOURCE_OWNER_REQUIRED"
    )):
        simulate(d)


@pytest.mark.parametrize("form", sorted(KINDS))
def test_extended_form_requires_original_independent_role_consent(form):
    d = case(form)
    _, name, _, _, _, _, _ = KINDS[form]
    d["events"] = [
        e for e in d["events"] if not (
            e["action"] == "consent" and e["actor"] == name
            and e.get("work") == "w1"
        )
    ]
    out = simulate(d)
    assert find(out, "commit", work="w1")[0]["reason"] == (
        "INDEPENDENT_ACCEPTANCE_MISSING"
    )
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


@pytest.mark.parametrize("form", sorted(KINDS))
def test_extended_form_without_second_accepted_result_not_reproduction(form):
    d = case(form)
    d["events"] = [
        e for e in d["events"]
        if not (e["action"] == "accept" and e.get("work") == "w2")
    ]
    out = simulate(d)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "SUBMITTED"
    assert out["general_akis_private_cycle_evidence"][
        "original_author_form_eight_phase_reproduction"
    ] == []
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "r1v1_original_author_form_eight_phase_accepted_result_count"
    ] == 0


@pytest.mark.parametrize("form", sorted(KINDS))
def test_owner_revocation_after_first_result_denies_new_work_not_original_result(form):
    d = case(form)
    _, name, _, _, _, _, _ = KINDS[form]
    subject = next(s for s in d["subjects"] if s["id"] == name)
    scope_ref = subject.get("mandate_source_ref", subject.get("context_source_ref"))
    d["events"].append({
        "at": 32, "action": "source_update", "actor": name,
        "source": scope_ref, "status": "DISPROVED",
        "expected_revision": "role-r1", "new_revision": "role-r2",
    })
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert find(out, "source_update", actor=name)[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert find(out, "request", work="w2")[0]["reason"] == (
        "CONTEXT_REVISION_STALE"
    )
    assert "w2" not in out["works"]


@pytest.mark.parametrize("form", sorted(KINDS))
def test_extended_source_must_be_shared_with_actual_original_counterparty(form):
    d = case(form)
    _, name, _, _, _, _, _ = KINDS[form]
    subject = next(s for s in d["subjects"] if s["id"] == name)
    scope_ref = subject.get("mandate_source_ref", subject.get("context_source_ref"))
    source = next(s for s in d["context_evidence"]["sources"]
                  if s["id"] == scope_ref)
    source["usable_by"] = [name]
    out = simulate(d)
    assert find(out, "request", work="w1")[0]["reason"] == (
        "CONTEXT_USE_NOT_PERMITTED"
    )
    assert "w1" not in out["works"]


def test_personal_access_source_purpose_cannot_be_forged_as_read_only():
    d = case("trace")
    source = next(s for s in d["context_evidence"]["sources"]
                  if s["id"] == "model://person/r1v2b-access")
    source["operations"] = ["READ"]
    out = simulate(d)
    assert find(out, "request", work="w1")[0]["outcome"] == "BLOCKED"
    assert "w1" not in out["works"]


def test_public_mandate_revocation_preserves_started_original_obligation():
    d = case("macro")
    # After original commit (at 18), before completion (at 28):
    # revocation must not rewrite the accepted old obligation/Result.
    d["events"].append({
        "at": 22, "action": "source_update", "actor": "public",
        "source": "model://public/r1v2b-access", "status": "DISPROVED",
        "expected_revision": "role-r1", "new_revision": "role-r2",
    })
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert find(out, "source_update", actor="public")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert find(out, "request", work="w2")[0]["reason"] == (
        "CONTEXT_REVISION_STALE"
    )


def test_extended_rights_source_update_without_CAS_is_refused():
    d = case("sector")
    d["events"].append({
        "at": 32, "action": "source_update", "actor": "sector",
        "source": "model://sector/r1v2b-access", "status": "DISPROVED",
    })
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert find(out, "source_update", actor="sector")[0]["reason"] == (
        "CONTEXT_OWNER_RIGHTS_COMPARE_AND_SET_REQUIRED"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
