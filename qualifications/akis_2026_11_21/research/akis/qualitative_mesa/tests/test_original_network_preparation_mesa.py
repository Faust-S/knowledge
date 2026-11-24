"""Exact sparse general checkpoints must equal the original dense observer."""
from copy import deepcopy
from decimal import Decimal

import pytest

pytest.importorskip("mesa", reason="Official Mesa 3.5.2 required")

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from research.akis.qualitative_mesa.experiments.export_original_network_preparation import (
    preparation_document, compare_preparation,
)
from .test_original_delegation_recovery_mesa import renewal_routes, idle_mandate_route
from .test_original_pattern_evolution_mesa import expiry_route, edition_pattern_route


def compare_observers(document):
    dense = deepcopy(document)
    dense["network_scale"] = True
    dense.pop("network_observation_ticks", None)
    dense.pop("network_exact_preparation_observation", None)
    sparse = deepcopy(dense)
    sparse["network_observation_ticks"] = [0, sparse["model_horizon"]]
    sparse["network_exact_preparation_observation"] = True
    a, b = simulate(dense), simulate(sparse)
    for key in ("trace", "works", "subjects", "counts", "capacity"):
        assert a[key] == b[key], key
    if "economics" in a:
        assert a["economics"] == b["economics"]
    ga, gb = a["general_akis_model"], b["general_akis_model"]
    for key in ("author_operator_reproducibility", "agent_function_formation_model_gate"):
        assert ga[key] == gb[key], key
    assert len(gb["read_only_evolution"]) == 2
    assert len(ga["read_only_evolution"]) > 2
    assert gb["network_observation_design"]["preparation_exposure"] == (
        "EXACT_ORIGINAL_TRANSITIONS_AND_SOURCE_BOUNDARIES")
    assert gb["network_observation_design"]["full_history_endpoint_cross_checked"]
    return b


@pytest.mark.parametrize("patterns", [False, True])
@pytest.mark.parametrize("same_revision", [False, True])
def test_recovery_preserves_exact_mandate_and_packet_time(patterns, same_revision):
    doc = renewal_routes(patterns=patterns, same_revision=same_revision)["RECOVERED"]
    compare_observers(doc)


@pytest.mark.parametrize("kind", ["source", "function", "oc"])
def test_idle_expiry_is_integrated_without_a_business_event(kind):
    doc, tick = idle_mandate_route(kind)
    out = compare_observers(doc)
    assert not any(row["at"] == tick for row in out["trace"])
    gate = out["general_akis_model"]["agent_function_formation_model_gate"]
    assert gate["original_delegation_model_time"]["pending_work_model_ticks_without_current_mandate"] == (
        doc["model_horizon"]-tick)


@pytest.mark.parametrize("revise", [False, True])
def test_accepted_pattern_stock_and_expiry_have_exact_exposure(revise):
    doc, _ = expiry_route(revise=revise)
    compare_observers(doc)


@pytest.mark.parametrize("renew", [False, True])
def test_dynamic_oc_edition_and_new_expiry_are_observed(renew):
    doc, _ = edition_pattern_route(renew=renew)
    compare_observers(doc)


def test_mass_preparation_exact_observation_and_independent_cost_scope():
    doc = preparation_document(10, 2)
    out = compare_observers(doc)
    assert out["counts"]["blocked"] == 2
    gate = out["general_akis_model"]["agent_function_formation_model_gate"]
    assert gate["original_delegation_scope"]["applied_mandate_count"] == 22
    assert gate["original_delegation_scope"]["accepted_effective_mandate_count"] == 20
    assert gate["original_delegation_scope"]["current_mandate_scope"]["uncommitted_works_without_current_mandate"] == 2
    repro = out["general_akis_model"]["author_operator_reproducibility"]
    assert repro["structural_preparation_scope"]["accepted_effective_reuse_count"] == 10
    assert repro["structural_preparation_scope"]["accepted_versions_with_current_source_and_oc"] == 0


def test_two_independently_executed_arms_reconcile_all_attempts_not_only_accepted_work():
    report = compare_preparation(10, 2)
    assert Decimal(report["declared_noncash_saving_rub"]) == 165
    assert report["enterprises_with_changed_net_contribution"] == 0
    for row in (report["fresh_build"], report["reuse"]):
        totals = row["declared_attempt_costs_rub"]
        assert Decimal(totals["all_mandate_cost"]) == 88
        assert Decimal(totals["other_mandate_cost"]) == 8
        assert row["capacity_blocked_original_works"] == 2
        assert row["full_checkpoint_count"] == 2


def test_sparse_checkpoints_without_exact_opt_in_still_reject_preparation_sampling():
    doc = preparation_document(10, 1)
    doc.pop("network_exact_preparation_observation")
    with pytest.raises(InputError, match="NETWORK_CHECKPOINTS_REQUIRE_EXACT_DELEGATION_AND_PATTERN_OBSERVATION"):
        simulate(doc)


def test_exact_opt_in_without_network_checkpoints_rejected():
    doc = preparation_document(10, 1)
    doc.pop("network_observation_ticks")
    with pytest.raises(InputError, match="EXACT_PREPARATION_REQUIRES_NETWORK_CHECKPOINTS"):
        simulate(doc)
