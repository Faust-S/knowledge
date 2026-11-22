"""R1-T: 13 original model OC controls may gain one NEW admitted owner.

One original state/trace and single native Mesa scheduler. All founder choices
are original events, not an invented governance engine, signature, IAM or legal
rights. A potential resource-owning SME was known to the original scenario but
NOT included in the former 13-field OC source records.
"""
from copy import deepcopy

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.org_code_policy import (
    original_model_code_fingerprint,
)
from .test_r1s_strict_successor_lineage_mesa import (
    strict_entrant_resource_case,
)
from .test_r1q_original_coalition_membership_mesa import reports


def model_edition_case(*, omission=None, objection=None,
                       wrong_expected=False, change_source=False):
    d = strict_entrant_resource_case()
    records = {row["field"]: row["control"]
               for row in d["general_akis"]["organizational_code"]}
    records["С"]["subjects"].remove("c")
    records["ИД"]["model_identified"].remove("c")
    records["Рол"]["role_bindings"] = [
        row for row in records["Рол"]["role_bindings"]
        if row["subject"] != "c"
    ]
    # The old 13-field source knows no c. A COMPLETE NEW 13-field edition
    # has distinct source refs and begins only after 3 founder responses.
    future = deepcopy(d["general_akis"]["organizational_code"])
    candidate = {row["field"]: row["control"] for row in future}
    candidate["С"]["subjects"].append("c")
    candidate["ИД"]["model_identified"].append("c")
    candidate["Рол"]["role_bindings"].append({
        "subject": "c", "items": ["RESOURCE_OWNER"]
    })
    for row in future:
        row["available_at"] = 84
        row["expires_at"] = 160
        row["source_ref"] = f"model://op/r1t-policy-v2-{row['field']}"
    fingerprint = original_model_code_fingerprint(future)
    # Keep all Work slots, Result IDs and pilot acceptance times fixed.
    # Shift ONLY future event instants and corresponding packet references.
    for row in d["events"]:
        if row["at"] >= 80:
            row["at"] += 5
        if (row["action"] == "function_review"
                and row.get("work") == "w3"
                and row.get("prepared_at", 0) >= 80):
            row["prepared_at"] += 5
    d["events"].append({
        "at": 80, "action": "model_code_propose", "actor": "op",
        "org_revision": "oc-1",
        "model_code_change_id": "r1t-code-1",
        "model_code_fingerprint": fingerprint,
        "expected_model_edition": "OLD" if wrong_expected else "BASE",
        "new_model_edition": "model-oc-2",
        "original_cooperation_change_id": "chg-w2",
        "proposed_subject": "c", "proposed_model_role": "RESOURCE_OWNER",
        "model_code_source_ref": (
            "model://c/foreign-proposal" if change_source
            else "model://op/proposed-policy-for-c"
        ),
    })
    for at, actor in ((81, "op"), (82, "a"), (83, "b")):
        if actor == omission:
            continue
        d["events"].append({
            "at": at, "action": "model_code_response", "actor": actor,
            "org_revision": "oc-1",
            "model_code_change_id": "r1t-code-1",
            "model_code_fingerprint": fingerprint,
            "new_model_edition": "model-oc-2",
            "model_code_decision": (
                "OBJECT_MODEL_REVISION" if actor == objection
                else "SUPPORT_MODEL_REVISION"
            ),
            "model_code_decision_source_ref": (
                f"model://{actor}/original-independent-review"
            ),
        })
    d["events"].append({
        "at": 84, "action": "model_code_apply", "actor": "op",
        "org_revision": "oc-1",
        "model_code_change_id": "r1t-code-1",
        "model_code_fingerprint": fingerprint,
        "expected_model_edition": "BASE",
        "new_model_edition": "model-oc-2",
        "model_code_records": future,
    })
    d["events"].sort(key=lambda x: x["at"])
    return d


def _one(output, action):
    return reports(output, action)[0]


def rebind_reviewed_document(d):
    """For one focused test, make all founder responses review the new content."""
    records = next(e["model_code_records"] for e in d["events"]
                   if e["action"] == "model_code_apply")
    digest = original_model_code_fingerprint(records)
    for row in d["events"]:
        if row["action"] in {
            "model_code_propose", "model_code_response", "model_code_apply"
        }:
            row["model_code_fingerprint"] = digest


def test_r1t_first_original_newcomer_work_requires_new_fully_reviewed_model_code():
    d = model_edition_case()
    saved = deepcopy(d)
    out = simulate(d)
    assert d == saved
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"]) for r in out["trace"]
        if r["outcome"] == "BLOCKED"
    ]
    assert [out["works"][w]["result"] for w in ("w1", "w2", "w3")] == [
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    ] * 3
    assert _one(out, "model_code_propose")["outcome"] == "APPLIED"
    assert [x["actor"] for x in reports(out, "model_code_response")] == [
        "op", "a", "b"
    ]
    assert _one(out, "model_code_apply")["outcome"] == "APPLIED"
    assert _one(out, "model_code_apply")[
        "model_code_all_thirteen_source_records_requalified"
    ]
    assert out["general_akis_model"]["model_organizational_code_review"][
        "original_model_source_edition"
    ] == "model-oc-2"
    assert out["general_akis_model"]["model_organizational_code_review"][
        "accepted_prospective_model_editions"
    ] == 1
    assert set(out["works"]["w3"]["consenting_principals"]) == {"a", "b", "c"}
    assert out["works"]["w1"]["consenting_principals"] == ["a", "b"]
    assert out["works"]["w2"]["consenting_principals"] == ["a", "b"]
    assert _one(out, "model_code_apply")["model_code_legal_rights_authenticated"] is False
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "strict_original_entry_to_accepted_resource_work_link_count"
    ] == 1
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "all_nine_component_original_causal_closure_proven"
    ] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == out


def test_r1t_without_explicit_new_model_code_resource_owner_actions_remain_blocked():
    d = model_edition_case()
    d["events"] = [e for e in d["events"] if e["action"] not in {
        "model_code_propose", "model_code_response", "model_code_apply",
    }]
    out = simulate(d)
    own = next(x for x in reports(out, "interest_update")
               if x["actor"] == "c" and x["work"] == "w3")
    assert own["reason"] == "OC_ORIGINAL_SUBJECT_OR_IDENTITY_CLAIM_MISSING"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"


def test_r1t_founder_missing_refuses_future_model_edition():
    out = simulate(model_edition_case(omission="a"))
    assert _one(out, "model_code_apply")["reason"] == (
        "OC_MODEL_EDITION_ALL_FOUNDERS_RESPONSE_REQUIRED"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t_founder_objection_refuses_future_model_edition():
    out = simulate(model_edition_case(objection="b"))
    assert _one(out, "model_code_apply")["reason"] == (
        "OC_MODEL_EDITION_FOUNDER_OBJECTION"
    )
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"


def test_r1t_stale_expected_edition_is_not_accepted():
    out = simulate(model_edition_case(wrong_expected=True))
    assert _one(out, "model_code_propose")["reason"] == (
        "OC_MODEL_EDITION_EXPECTED_REVISION_STALE"
    )
    assert _one(out, "model_code_apply")["outcome"] == "BLOCKED"


def test_r1t_foreign_operator_source_is_rejected():
    out = simulate(model_edition_case(change_source=True))
    assert _one(out, "model_code_propose")["reason"] == (
        "OC_MODEL_EDITION_OWNER_SOURCE_REQUIRED"
    )
    assert _one(out, "model_code_apply")["outcome"] == "BLOCKED"


def test_r1t_edition_requires_all_13_distinct_new_original_sources():
    d = model_edition_case()
    apply = next(row for row in d["events"] if row["action"] == "model_code_apply")
    apply["model_code_records"].pop()
    out = simulate(d)
    assert _one(out, "model_code_apply")["reason"] == (
        "OC_MODEL_EDITION_ALL_THIRTEEN_RECORDS_REQUIRED"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t_new_code_cannot_broaden_preexisting_rights_without_review():
    d = model_edition_case()
    candidate = next(e for e in d["events"]
                     if e["action"] == "model_code_apply")["model_code_records"]
    next(row for row in candidate if row["field"] == "Событ")[
        "control"]["new_work_events"].remove("interest_update")
    rebind_reviewed_document(d)
    out = simulate(d)
    assert _one(out, "model_code_apply")["reason"] == (
        "OC_MODEL_EDITION_OTHER_RIGHTS_OR_FUNCTIONS_UNREVIEWED"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t_new_model_sources_must_not_be_retroactively_effective():
    d = model_edition_case()
    candidate = next(e for e in d["events"]
                     if e["action"] == "model_code_apply")["model_code_records"]
    candidate[0]["available_at"] = 0
    rebind_reviewed_document(d)
    out = simulate(d)
    assert _one(out, "model_code_apply")["reason"] == (
        "OC_MODEL_EDITION_CURRENT_SOURCE_TIME_REQUIRED"
    )


def test_r1t_duplicate_apply_cannot_reissue_earlier_model_edition():
    d = model_edition_case()
    first = next(e for e in d["events"] if e["action"] == "model_code_apply")
    later = deepcopy(first)
    later["at"] = 85
    d["events"].append(later)
    d["events"].sort(key=lambda x: x["at"])
    out = simulate(d)
    assert [r["outcome"] for r in reports(out, "model_code_apply")] == [
        "APPLIED", "BLOCKED"
    ]
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t_prospective_policy_cannot_authorize_unrecognized_entrant_without_membership():
    d = model_edition_case()
    d["events"] = [
        e for e in d["events"] if e["action"] != "cooperation_membership_apply"
    ]
    out = simulate(d)
    assert _one(out, "model_code_propose")["reason"] == (
        "OC_MODEL_EDITION_INDEPENDENT_ENTRANT_MEMBERSHIP_REQUIRED"
    )
    assert _one(out, "model_code_apply")["outcome"] == "BLOCKED"


def test_r1t_approved_digest_fails_if_operator_substitutes_actual_model_code():
    d = model_edition_case()
    records = next(e["model_code_records"] for e in d["events"]
                   if e["action"] == "model_code_apply")
    next(row for row in records if row["field"] == "Рол")[
        "source_ref"
    ] = "model://op/swapped-after-founder-review"
    out = simulate(d)
    assert _one(out, "model_code_apply")["reason"] == (
        "OC_MODEL_EDITION_CONTENT_CHANGED_AFTER_REVIEW"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"


def test_r1t_individual_founder_must_bind_response_to_same_model_code_contents():
    d = model_edition_case()
    response = next(r for r in d["events"]
                    if r["action"] == "model_code_response"
                    and r["actor"] == "a")
    response["model_code_fingerprint"] = "0" * 64
    out = simulate(d)
    assert [r for r in reports(out, "model_code_response")
            if r["actor"] == "a"][0]["reason"] == (
        "OC_MODEL_EDITION_FOUNDERS_MUST_REVIEW_EXACT_CONTENT"
    )
    assert _one(out, "model_code_apply")["reason"] == (
        "OC_MODEL_EDITION_ALL_FOUNDERS_RESPONSE_REQUIRED"
    )


def test_r1t_original_new_work_and_review_store_actual_source_edition_at_event_time():
    d = model_edition_case()
    out = simulate(d)
    consent_c = [r for r in reports(out, "consent")
                 if r["actor"] == "c" and r["work"] == "w3"][0]
    assert consent_c["org_code_model_source_edition"] == "model-oc-2"
    old_consents = [r for r in reports(out, "consent")
                    if r["work"] in {"w1", "w2"}]
    assert all(row["org_code_model_source_edition"] == "BASE"
               for row in old_consents)
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t_original_nine_component_time_evolution_keeps_old_code_snapshots():
    out = simulate(model_edition_case())
    revisions = [
        (entry["at"], entry["projection"]["model_organizational_code_review"][
            "original_model_source_edition"
        ])
        for entry in out["general_akis_model"]["read_only_evolution"]
    ]
    assert any(when < 84 and edition == "BASE" for when, edition in revisions)
    assert any(when >= 84 and edition == "model-oc-2"
               for when, edition in revisions)
    assert out["general_akis_model"]["organizational_code"][
        "missing_fields"
    ] == []
    assert out["general_akis_model"]["model_organizational_code_review"][
        "all_thirteen_model_controls_active"
    ] is True
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
