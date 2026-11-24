"""Original AKIS + Mesa interaction tests; no mock Mesa passes as native."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest

from research.akis.qualitative_mesa.context_basis import ContextInputError

ROOT = Path(__file__).resolve().parents[1]


def model_case():
    sample = json.loads((ROOT / "fixtures" / "sole_flow.json").read_text(encoding="utf-8"))
    sample["resources"][0]["availability"] = "AVAILABLE"
    sample["context_evidence"] = {
        "strict": True,
        "sources": [{
            "id": "b-original", "owner": "b", "revision": "doc-r1",
            "status": "CONFIRMED", "usable_by": ["op", "a", "b"],
        }],
        "requirements": [
            {"work": "w1", "action": action, "sources": ["b-original"],
             "expected_revisions": ["doc-r1"]}
            for action in ("authorize", "consent", "commit", "start", "complete", "accept")
        ],
    }
    return sample


def apply_model(data):
    from research.akis.qualitative_mesa.rules import QualitativeAKIS
    state = QualitativeAKIS(data)
    for event in state.events:
        state.apply(event, event["at"])
    return state.snapshot()


def test_strict_context_valid_path_does_not_change_model_contract_meaning():
    result = apply_model(model_case())
    assert result["counts"] == {"applied": 8, "blocked": 0}
    assert result["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["context_basis"]["authenticated_documents"] is False
    assert result["evidence"] == "MODEL_ONLY"
    assert set(result["profit"].values()) == {"UNKNOWN"}


def test_context_unknown_blocks_new_commit_but_not_old_consents_or_rights():
    raw = model_case()
    raw["events"] = [*deepcopy(raw["events"][:4]),
        {"at": 5, "action": "source_update", "actor": "b", "source": "b-original", "status": "UNKNOWN"},
        {"at": 6, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 7, "action": "source_update", "actor": "b", "source": "b-original", "status": "CONFIRMED"},
        {"at": 8, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 9, "action": "start", "actor": "a", "work": "w1"},
        {"at": 10, "action": "complete", "actor": "a", "work": "w1", "result_ref": "model://retested"},
        {"at": 11, "action": "accept", "actor": "b", "work": "w1"},
    ]
    result = apply_model(raw)
    assert result["counts"] == {"applied": 10, "blocked": 1}
    assert result["trace"][5]["reason"] == "CONTEXT_SOURCE_UNKNOWN"
    assert result["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["context_basis"]["sources"]["b-original"]["status"] == "CONFIRMED"


def test_revoked_use_before_execution_preserves_already_accepted_obligation():
    raw = model_case()
    raw["events"] = [*deepcopy(raw["events"][:5]),
        {"at": 6, "action": "source_update", "actor": "b", "source": "b-original", "status": "DISPROVED"},
        {"at": 7, "action": "start", "actor": "a", "work": "w1"},
    ]
    result = apply_model(raw)
    assert result["trace"][6]["reason"] == "CONTEXT_SOURCE_DISPROVED"
    assert result["works"]["w1"]["obligation"] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert result["works"]["w1"]["execution"] == "NOT_STARTED"


def test_unowned_source_update_blocked_without_partial_mutation():
    raw = model_case()
    raw["events"] = [{"at": 1, "action": "source_update", "actor": "op", "source": "b-original", "status": "DISPROVED"}]
    result = apply_model(raw)
    assert result["counts"] == {"applied": 0, "blocked": 1}
    assert result["trace"][0]["reason"] == "CONTEXT_SOURCE_OWNER_REQUIRED"
    assert result["context_basis"]["sources"]["b-original"]["status"] == "CONFIRMED"


def test_strict_path_rejects_legacy_default_resource_even_if_document_looks_confirmed():
    raw = model_case()
    del raw["resources"][0]["availability"]
    result = apply_model(raw)
    assert result["trace"][4]["reason"] == "RESOURCE_READINESS_UNSUPPORTED"
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_old_input_without_context_remains_compatible_and_not_qualified():
    raw = model_case()
    raw.pop("context_evidence")
    del raw["resources"][0]["availability"]
    result = apply_model(raw)
    assert result["counts"] == {"applied": 8, "blocked": 0}
    assert "context_basis" not in result
    assert result["resources"]["ra"]["basis"] == "LEGACY_FIXTURE_DEFAULT"


def test_context_does_not_accidentally_accept_unrecognized_actor():
    raw = model_case()
    raw["events"][2]["actor"] = "op"  # a resource owner does not grant their consent by association
    result = apply_model(raw)
    assert result["trace"][2]["outcome"] == "BLOCKED"
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_source_records_only_change_through_present_owner_event():
    raw = model_case()
    raw["context_evidence"]["sources"][0]["status"] = "CONTRADICTORY"
    from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
    with pytest.raises(InputError, match="INVALID_CONTEXT_STATUS"):
        QualitativeAKIS(raw)


def test_native_mesa_and_real_rules_handle_source_revocation_in_one_event_queue():
    mesa = pytest.importorskip("mesa", reason="Actual Mesa 3.5.2 required for native qualification")
    from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel
    raw = model_case()
    raw["events"] = [*deepcopy(raw["events"][:4]),
        {"at": 5, "action": "source_update", "actor": "b", "source": "b-original", "status": "UNKNOWN"},
        {"at": 6, "action": "commit", "actor": "op", "work": "w1"},
    ]
    model = OperatorAKISModel(raw)
    assert isinstance(model, mesa.Model)
    result = model.execute()
    assert result["trace"][-1]["reason"] == "CONTEXT_SOURCE_UNKNOWN"
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert result["evidence"] == "MODEL_ONLY"


def test_null_context_basis_cannot_disable_strict_qualification_silently():
    raw = model_case()
    raw["context_evidence"] = None
    from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
    with pytest.raises(InputError, match="INVALID_CONTEXT_BASIS"):
        QualitativeAKIS(raw)
