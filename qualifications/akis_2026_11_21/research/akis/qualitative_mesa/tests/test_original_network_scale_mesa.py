"""Scale changes execution capacity, not original Work decision semantics."""
from copy import deepcopy
import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS, InputError
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.experiments.export_original_network_scale import (
    network_document, verify_network_result,
)


def test_network_profile_and_original_small_trace_are_identical():
    doc=network_document(10,2)
    ordinary=deepcopy(doc)
    ordinary.pop("network_scale")
    assert simulate(ordinary)==simulate(doc)
    verify_network_result(doc,simulate(doc),10,2)


def test_mass_scale_original_network_has_real_resource_contention_and_cash_rows():
    doc=network_document(100,3)
    summary=verify_network_result(doc,simulate(doc),100,3)
    assert summary["accepted_results"]==300
    assert summary["capacity_blocked_works"]==30
    assert not summary["full_nine_component_network_qualified"]


def test_standard_profile_retains_guard_and_network_profile_is_explicit():
    doc=network_document(100,3)
    doc.pop("economic_claims")
    ordinary=deepcopy(doc)
    ordinary.pop("network_scale")
    with pytest.raises(InputError,match="INVALID_EVENT_COUNT"):
        QualitativeAKIS(ordinary)
    assert len(QualitativeAKIS(doc).events)==len(doc["events"])
    doc["network_scale"]="yes"
    with pytest.raises(InputError,match="NETWORK_SCALE_MUST_BE_BOOLEAN"):
        QualitativeAKIS(doc)


def test_network_scale_does_not_grant_consent_or_create_result():
    doc=network_document(10,1)
    doc.pop("economic_claims")
    work="work-0-00000"
    doc["events"]=[row for row in doc["events"] if not (
        row.get("work")==work and row["action"]=="consent" and row["actor"]=="enterprise-00000")]
    out=simulate(doc)
    commit=next(row for row in out["trace"] if row.get("work")==work and row["action"]=="commit")
    assert commit["outcome"]=="BLOCKED"
    assert commit["reason"]=="INDEPENDENT_ACCEPTANCE_MISSING"
    assert out["works"][work]["result"]!="ACCEPTED_BY_ORIGINAL_RECIPIENT"
