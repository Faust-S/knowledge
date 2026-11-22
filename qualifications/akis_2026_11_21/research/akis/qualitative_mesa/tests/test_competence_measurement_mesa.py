"""M3.3: independent source-declared measurement protocol is not real calibration."""
from copy import deepcopy
import pytest
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_work_counterfactual_mesa import counterfactual_case


def measurement_case():
    d=counterfactual_case()
    d["context_evidence"]["sources"].append({
        "id":"quality-protocol-c","owner":"c","revision":"qp1",
        "status":"CONFIRMED","usable_by":["c"],"core":"corporate",
        "purposes":["quality-verification"],"operations":["ACCEPT"],
        "valid_from":0,"valid_until":40,
    })
    d["competence_measurement_protocols"]=[{
        "claim_id":"reuse-1","assessor":"c","source_id":"quality-protocol-c",
        "source_revision":"qp1","standard_ref":"model://c/standard-123",
        "method_ref":"model://c/method-1",
        "calibration_chain_ref":"model://c/calibration-chain-1",
        "uncertainty_before":"0.2000","uncertainty_after":"0.3000",
        "assessment_at":23,
    }]
    return d


def test_measurement_protocol_declares_difference_beyond_uncertainty_not_real_causality():
    d=measurement_case()
    result=simulate(d)
    status=result["competence_reuse_dynamics"]["declared_measurement_protocols"]
    assert status["measurements_independently_authenticated"] is False
    line=status["protocols"][0]
    assert line["model_status"]=="MODEL_DECLARED_DIFFERENCE_ABOVE_SUMMED_UNCERTAINTY"
    assert line["declared_sum_uncertainty"]=="0.5000"
    assert line["declared_favourable_metric_difference"]=="2.0000"
    assert line["statistical_significance_or_causality_established"] is False
    assert result["general_akis_model"]["competence_reproduction_feedback"]["model_protocol_count"]==1
    assert result["work_counterfactual_dynamics"]["actual_profit"]=="UNKNOWN"
    assert simulate(deepcopy(d))==result


def test_large_uncertainty_blocks_interpretation_of_claimed_improvement():
    d=measurement_case()
    d["competence_measurement_protocols"][0]["uncertainty_after"]="2.5000"
    out=simulate(d)["competence_reuse_dynamics"]["declared_measurement_protocols"]["protocols"][0]
    assert out["model_status"]=="MODEL_DECLARED_DIFFERENCE_NOT_SEPARATED_BY_UNCERTAINTY"
    assert out["accredited_lab_or_real_traceability_verified"] is False


@pytest.mark.parametrize("change,reason",[
    (lambda d:d["competence_measurement_protocols"][0].update(assessment_at=22),
     "MEASUREMENT_AFTER_ACCEPTED_RESULT_NOT_DECLARED"),
    (lambda d:d["competence_measurement_protocols"][0].update(source_revision="qp-old"),
     "MEASUREMENT_SOURCE_REVISION_CHANGED"),
    (lambda d:d["context_evidence"]["sources"][-1].update(status="UNKNOWN"),
     "MEASUREMENT_SOURCE_NOT_CURRENTLY_USABLE"),
    (lambda d:d["context_evidence"]["sources"][-1].update(operations=["READ"]),
     "MEASUREMENT_SOURCE_SCOPE_NOT_QUALIFIED"),
    (lambda d:d["context_evidence"]["sources"][-1].update(valid_until=20),
     "MEASUREMENT_SOURCE_EXPIRED_AT_REVIEW"),
    (lambda d:d["competence_reuse_permissions"][0].update(work="w1"),
     "MEASUREMENT_ORIGINAL_REUSE_SEQUENCE_UNQUALIFIED"),
])
def test_measurement_source_and_result_revision_gates(change,reason):
    d=measurement_case()
    change(d)
    out=simulate(d)
    line=out["competence_reuse_dynamics"]["declared_measurement_protocols"]["protocols"][0]
    assert reason in line["model_scope_reasons"]
    assert line["declared_favourable_metric_difference"] is None
    assert out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("change",[
    lambda d:d["competence_measurement_protocols"][0].update(assessor="b"),
    lambda d:d["competence_measurement_protocols"][0].update(uncertainty_before="-0.1"),
    lambda d:d["competence_measurement_protocols"][0].update(assessment_at=True),
    lambda d:d["competence_measurement_protocols"].append(deepcopy(d["competence_measurement_protocols"][0])),
])
def test_unauthenticated_or_malformed_measurement_rejected(change):
    d=measurement_case()
    change(d)
    with pytest.raises(ValueError,match="MEASUREMENT_PROTOCOL"):
        simulate(d)


def test_revocation_of_measurement_source_does_not_erase_accepted_result():
    d=measurement_case()
    d["events"].append({"at":25,"action":"source_update","actor":"c",
                        "source":"quality-protocol-c","new_revision":"qp2",
                        "status":"UNKNOWN","usable_by":["c"]})
    out=simulate(d)
    proof=out["competence_reuse_dynamics"]["declared_measurement_protocols"]["protocols"][0]
    assert "MEASUREMENT_SOURCE_REVISION_CHANGED" in proof["model_scope_reasons"]
    assert out["works"]["w1"]["result"]==out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_optional_protocol_does_not_modify_prior_m3_2_model():
    d=measurement_case()
    del d["competence_measurement_protocols"]
    out=simulate(d)
    assert "declared_measurement_protocols" not in out["competence_reuse_dynamics"]
