"""Organization capital across accepted Work, source changes and renewal.

Use the existing three-period experiment, original Work/Result, ContextBasis,
formation gates and original cost ledger. No alternative engine or cost rows.
"""
from copy import deepcopy
from decimal import Decimal
from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.comparative_trajectories import (
    compare_original_preparation_pattern_reuse,
)
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.process_preparation import (
    _accepted_pattern_predecessor,
)
from .test_s0_s1_s2_original_preparation_economics_mesa import preparation_pattern_routes

SOURCE = "model://op/structural-preparation-pattern"
ACCEPTED = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
STALE_PACKET = "FORMATION_AGENT_ORIGINAL_PATTERN_SOURCE_CHANGED_AFTER_PACKET"


def event(doc, action, work):
    return next(row for row in doc["events"]
                if row["action"] == action and row.get("work") == work)


def trace_event(out, action, work):
    return next(row for row in out["trace"]
                if row["action"] == action and row.get("work") == work)


def pattern_source(doc):
    return next(row for row in doc["context_evidence"]["sources"]
                if row["id"] == SOURCE)


def without_costs(doc):
    doc.pop("economic_claims", None)
    doc.pop("strict_economic_source_works", None)
    return doc


def change_source_between(doc, earlier, later):
    used = {row["at"] for row in doc["events"]}
    at = next(t for t in range(earlier + 1, later) if t not in used)
    doc["events"].append({
        "at": at, "action": "source_update", "actor": "op",
        "source": SOURCE, "status": "CONFIRMED",
        "expected_revision": "pattern-v1", "new_revision": "pattern-v2",
    })
    doc["events"].sort(key=lambda row: row["at"])
    if "economic_claims" in doc:
        positions = {row["at"]: pos for pos, row in enumerate(doc["events"])}
        for binding in doc["economic_claims"]["lifecycle_costs"]["event_bindings"]:
            binding["trace_position"] = positions[binding["at"]]
    return at


def revision_routes(*, mode="S2", reuse_rate="8.00"):
    docs = preparation_pattern_routes(mode=mode, reuse_rate=reuse_rate)
    for arm, doc in docs.items():
        change_source_between(doc, event(doc, "accept", "w1")["at"],
                              event(doc, "function_prepare", "w2")["at"])
        second = event(doc, "function_prepare", "w2")["preparation_pattern"]
        third = event(doc, "function_prepare", "w3")["preparation_pattern"]
        second["source_revision"] = third["source_revision"] = "pattern-v2"
        if arm == "REUSE":
            previous = {key: second.pop(key) for key in (
                "prior_work", "prior_prepare_at", "prior_result_ref", "prior_accepted_at",
            )}
            previous.update(pattern_id=second["pattern_id"], source_revision="pattern-v1")
            second.update(operation="BUILD", pattern_id="template-w2-v2", revises=previous)
            third["pattern_id"] = "template-w2-v2"
            row = next(row for row in doc["economic_claims"]["resource_uses"]
                       if row["id"] == "w2-coordination")
            row["amount"] = f"{Decimal(row['amount']) + Decimal('60') - Decimal(reuse_rate):.2f}"
    return docs


@pytest.mark.parametrize("mode,rate,expected,total", [
    ("S1", "8.00", "52.00", "377.00"),
    ("S2", "8.00", "52.00", "281.00"),
    ("S2", "60.00", "0.00", "333.00"),
    ("S2", "80.00", "-20.00", "353.00"),
])
def test_revision_pays_full_build_and_only_later_use_saves(mode, rate, expected, total):
    docs = revision_routes(mode=mode, reuse_rate=rate)
    original = deepcopy(docs)
    report = compare_original_preparation_pattern_reuse(docs)
    assert docs == original
    local = report["local_research_only"]
    assert local["rebuild_minus_reuse_declared_preparation_cost"] == expected
    reuse = local["arms"]["REUSE"]
    assert reuse["original_pattern_build_count"] == 2
    assert reuse["original_pattern_reuse_count"] == 1
    assert reuse["original_pattern_revision_count"] == 1
    assert reuse["declared_preparation_resource_cost"] == total
    assert reuse["human_validation_units"] == 39
    out = simulate(docs["REUSE"])
    assert out["counts"]["blocked"] == 0
    assert all(out["works"][w]["result"] == ACCEPTED for w in ("w1", "w2", "w3"))
    revised = trace_event(out, "function_prepare", "w2")
    assert revised["model_preparation_pattern"]["original_pattern_revision"]["prior_work"] == "w1"
    assert revised["model_preparation_activity"]["units"]["pattern_build"] == 1
    assert revised["model_preparation_activity"]["units"]["pattern_reuse"] == 0
    assert trace_event(out, "function_prepare", "w3")["model_preparation_activity"]["units"]["pattern_reuse"] == 1
    assert out == simulate(deepcopy(docs["REUSE"]))


@pytest.mark.parametrize("action", ["function_prepare", "function_review"])
def test_source_expiry_after_applied_packet_blocks_next_original_transition(action):
    doc = without_costs(preparation_pattern_routes()["REUSE"])
    pattern_source(doc)["valid_until"] = event(doc, action, "w3")["at"]
    out = simulate(doc)
    assert trace_event(out, "function_prepare", "w3")["outcome"] == "APPLIED"
    review = trace_event(out, "function_review", "w3")
    if action == "function_prepare":
        assert review["reason"] == STALE_PACKET
    else:
        assert review["outcome"] == "APPLIED"
    assert trace_event(out, "commit", "w3")["reason"] == STALE_PACKET
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert all(out["works"][w]["result"] == ACCEPTED for w in ("w1", "w2"))


def test_historical_results_are_not_reopened_by_later_pattern_expiry():
    doc = without_costs(preparation_pattern_routes()["REUSE"])
    accepted = event(doc, "accept", "w3")["at"]
    pattern_source(doc)["valid_until"] = accepted
    doc["model_horizon"] = max(doc.get("model_horizon", 0), accepted + 1)
    out = simulate(doc)
    assert out["counts"]["blocked"] == 0
    assert all(out["works"][w]["result"] == ACCEPTED for w in ("w1", "w2", "w3"))


@pytest.mark.parametrize("key,value,reason", [
    ("source_revision", "made-up", "PREPARATION_PATTERN_REVISION_SOURCE_LINEAGE_MISMATCH"),
    ("prior_result_ref", "model://fabricated", "PREPARATION_PATTERN_PRIOR_ACCEPTED_RESULT_REQUIRED"),
    ("prior_prepare_at", 0, "PREPARATION_PATTERN_ORIGINAL_REUSE_CHAIN_NOT_QUALIFIED"),
    ("pattern_id", "template-w2-v2", "PREPARATION_PATTERN_REVISION_REQUIRES_NEW_ID"),
])
def test_revision_must_anchor_actual_prior_accepted_pattern(key, value, reason):
    doc = without_costs(revision_routes()["REUSE"])
    event(doc, "function_prepare", "w2")["preparation_pattern"]["revises"][key] = value
    out = simulate(doc)
    assert trace_event(out, "function_prepare", "w2")["reason"] == reason
    assert out["works"]["w1"]["result"] == ACCEPTED
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"


def test_unchanged_pattern_is_not_relabelled_as_revision():
    doc = without_costs(revision_routes()["REUSE"])
    doc["events"] = [row for row in doc["events"]
                     if not (row["action"] == "source_update" and row.get("source") == SOURCE)]
    for w in ("w2", "w3"):
        event(doc, "function_prepare", w)["preparation_pattern"]["source_revision"] = "pattern-v1"
    out = simulate(doc)
    assert trace_event(out, "function_prepare", "w2")["reason"] == (
        "PREPARATION_PATTERN_REVISION_REQUIRES_OBSERVED_CHANGE")
    assert out["works"]["w1"]["result"] == ACCEPTED


def test_prior_approved_but_superseded_packet_is_not_accepted_experience():
    # Unit witness of the original trace selector, complementary to the
    # three-work native experiments. The second packet is effective at commit.
    work = SimpleNamespace(key="new")
    old = SimpleNamespace(key="old", result=ACCEPTED, result_ref="model://old",
                          customer="b")
    common = {"work": "old", "outcome": "APPLIED", "org_revision": "oc-1",
              "work_source_revision": "d-1"}
    def row(at, action, **kw):
        return dict(common, at=at, action=action, **kw)
    trace = [
        row(1, "function_prepare", actor="op", function_id="f",
            model_preparation_pattern={"pattern_id": "first"}),
        row(2, "function_review", actor="b", function_id="f", prepared_at=1,
            human_decision="APPROVE"),
        row(3, "function_prepare", actor="op", function_id="f",
            model_preparation_pattern={"pattern_id": "effective"}),
        row(4, "function_review", actor="b", function_id="f", prepared_at=3,
            human_decision="APPROVE"),
        row(5, "commit", actor="op"),
        row(6, "accept", actor="b"),
    ]
    fn = {"work": "old", "work_revision": "d-1", "action": "REQUEST_APPROVAL",
          "revision": "oc-1", "available_at": 0, "expires_at": 10, "id": "f"}
    state = SimpleNamespace(works={"old": old}, trace=trace,
        formation_policy=SimpleNamespace(design=SimpleNamespace(
            declarations={"agent_functions": [fn]})))
    with pytest.raises(ValueError, match="PREPARATION_PATTERN_ORIGINAL_REUSE_CHAIN_NOT_QUALIFIED"):
        _accepted_pattern_predecessor(state, work, "op", "old", 1, "model://old", 6, "first", 8)
    assert _accepted_pattern_predecessor(
        state, work, "op", "old", 3, "model://old", 6, "effective", 8)["at"] == 3


def structural_view(out):
    return out["general_akis_model"]["author_operator_reproducibility"]["structural_preparation_scope"]


@pytest.mark.parametrize("arm,builds,reuses,share,returned,total", [
    ("REBUILD", 3, 0, "0.0000", "0.0000", "333.00"),
    ("REUSE", 1, 2, "0.6667", "1.0000", "229.00"),
])
def test_original_scope_counts_accepted_effective_patterns_not_full_author_ratios(
        arm, builds, reuses, share, returned, total):
    out = simulate(preparation_pattern_routes()[arm])
    view = structural_view(out)
    assert view["accepted_effective_build_count"] == builds
    assert view["accepted_effective_reuse_count"] == reuses
    assert view["accepted_preparation_reuse_share"] == share
    assert view["accepted_built_version_return_share"] == returned
    assert view["applied_preparation_count"] == view["accepted_effective_preparation_count"] == 3
    assert not view["full_author_repeatability_and_experience_return_ratios_identified"]
    assert view["original_pattern_cost_scope_complete"]
    costs = out["economics"]["original_pattern_reproduction_costs"]
    assert costs["accepted_effective_preparation_cost"] == total
    assert costs["other_applied_preparation_cost"] == "0.00"
    assert costs["new_cost_records_created"] == 0


def test_revision_preserves_historical_return_scope_and_only_current_version():
    out = simulate(revision_routes()["REUSE"])
    view = structural_view(out)
    assert view["distinct_accepted_built_versions"] == 2
    assert view["distinct_versions_returned_to_accepted_work"] == 1
    assert view["accepted_effective_revision_count"] == 1
    assert view["accepted_preparation_reuse_share"] == "0.3333"
    assert view["accepted_built_version_return_share"] == "0.5000"
    assert view["accepted_versions_with_current_source_and_oc"] == 1
    assert out["economics"]["original_pattern_reproduction_costs"]["accepted_effective_preparation_cost"] == "281.00"


def test_prepared_but_independently_rejected_work_not_counted_as_returned_experience():
    doc = without_costs(preparation_pattern_routes()["REUSE"])
    event(doc, "function_review", "w3")["human_decision"] = "REJECT"
    out = simulate(doc)
    view = structural_view(out)
    assert view["applied_preparation_count"] == 3
    assert view["accepted_effective_preparation_count"] == 2
    assert view["accepted_effective_reuse_count"] == 1
    assert view["preparations_on_not_accepted_works"] == 1
    assert view["accepted_preparation_reuse_share"] == "0.5000"
    assert not view["original_pattern_cost_scope_complete"]
    assert "economics" not in out


def test_prepared_pattern_without_any_accepted_work_does_not_claim_a_zero_return_ratio():
    doc = without_costs(preparation_pattern_routes()["REUSE"])
    event(doc, "function_review", "w1")["human_decision"] = "REJECT"
    out = simulate(doc)
    view = structural_view(out)
    assert view["applied_preparation_count"] >= 1
    assert view["accepted_effective_preparation_count"] == 0
    assert view["accepted_preparation_reuse_share"] == "UNKNOWN_ZERO_DENOMINATOR"
    assert view["accepted_built_version_return_share"] == "UNKNOWN_ZERO_DENOMINATOR"


def test_late_source_expiry_does_not_erase_the_history_of_returned_experience():
    doc = without_costs(preparation_pattern_routes()["REUSE"])
    accepted = event(doc, "accept", "w3")["at"]
    pattern_source(doc)["valid_until"] = accepted
    doc["model_horizon"] = max(doc.get("model_horizon", 0), accepted + 1)
    view = structural_view(simulate(doc))
    assert view["accepted_versions_with_current_source_and_oc"] == 0
    assert view["distinct_versions_returned_to_accepted_work"] == 1
    assert view["accepted_preparation_reuse_share"] == "0.6667"


def test_partial_cost_coverage_does_not_impute_zero_preparation_cost():
    from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel
    from research.akis.qualitative_mesa.process_preparation import original_pattern_reproduction_view
    model = OperatorAKISModel(preparation_pattern_routes()["REUSE"])
    out = model.execute()
    econ = deepcopy(out["economics"])
    rows = econ["lifecycle_resource_costs"]["original_preparation_activity_costs"]["items"]
    rows.pop()
    view, costs = original_pattern_reproduction_view(
        model.qualitative, at=int(model.time), economics=econ,
    )
    assert view["accepted_effective_preparation_count"] == 3
    assert not view["original_pattern_cost_scope_complete"]
    assert costs["status"] == "UNKNOWN_INCOMPLETE_ORIGINAL_PATTERN_COST_SCOPE"
    assert costs["accepted_effective_preparation_cost"] is None
    assert costs["other_applied_preparation_cost"] is None
    assert costs["total_original_pattern_preparation_cost"] is None
