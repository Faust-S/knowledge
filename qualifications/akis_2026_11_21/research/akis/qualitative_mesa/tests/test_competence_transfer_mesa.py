"""M3.3: original independent principals own sources for cross-firm knowledge."""
from copy import deepcopy
import pytest
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_competence_reuse_mesa import complete_case


def interfirm_case():
    d=complete_case()
    d["works"][1]["resource"]="rb"
    for e in d["events"]:
        if e.get("work")=="w2" and e.get("actor")=="a" and e["action"] in ("consent","start","complete"):
            e["actor"]="b"
    claim=d["competence_reuse_evidence"][0]
    claim["recipient"]="b"
    for field in ("independent_baseline","subsequent_observation"):
        claim[field]["source_ref"]=claim[field]["source_ref"].replace("model://a/","model://b/")
    d["context_evidence"]["sources"][0]["usable_by"]=["a","b"]
    d["context_evidence"]["sources"].append({
        "id":"license-a","owner":"a","revision":"lic-1","status":"CONFIRMED",
        "usable_by":["a","b"],"core":"corporate",
        "purposes":["competence-reuse"],"operations":["SHARE"],
        "valid_from":0,"valid_until":23,
    })
    d["competence_reuse_permissions"]=[{
        "claim_id":"reuse-1","holder":"a","recipient":"b",
        "competence_ref":"model://a/observed-reuse",
        "source_id":"license-a","source_revision":"lic-1",
        "grant_ref":"model://a/permission-for-b",
        "recipient_ack_ref":"model://b/acknowledgement",
        "work":"w2","metric":"LABOR_TIME_PER_UNIT",
        "valid_from":15,"valid_until":22,
    }]
    return d


def test_original_owners_and_consent_preserved_for_cross_firm_reuse():
    d=interfirm_case()
    out=simulate(d)
    assert out["counts"]["blocked"]==0,out["trace"]
    assert out["competence_reuse_dynamics"]["comparable_sequence_count"]==1
    row=out["competence_reuse_dynamics"]["links"][0]
    assert row["model_recipient_of_knowledge"]=="b"
    assert row["modeled_transfer_permission"]["legal_licence_verified"] is False
    assert out["competence_reuse_dynamics"]["permission_evidence"]["cross_enterprise_model_permission_count"]==1
    assert out["works"]["w1"]["result"]==out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["profit"]["system_increment"]=="UNKNOWN"
    assert simulate(deepcopy(d))==out


@pytest.mark.parametrize("change,reason",[
    (lambda d: d.pop("competence_reuse_permissions"),"REUSE_INTERFIRM_OWNER_PERMISSION_MISSING"),
    (lambda d: d["competence_reuse_permissions"][0].update(work="w1"),"REUSE_PERMISSION_SCOPE_MISMATCH"),
    (lambda d: d["competence_reuse_permissions"][0].update(valid_from=20),"REUSE_PERMISSION_TIME_INVALID"),
    (lambda d: d["competence_reuse_permissions"][0].update(source_revision="old"),"REUSE_PERMISSION_SOURCE_REVISION_STALE"),
    (lambda d: d["context_evidence"]["sources"][1].update(usable_by=["a"]),"REUSE_PERMISSION_SOURCE_NOT_USABLE_BY_BOTH"),
    (lambda d: d["context_evidence"]["sources"][1].update(operations=["READ"]),"REUSE_PERMISSION_CONTEXT_SCOPE_MISMATCH"),
    (lambda d: d["context_evidence"]["sources"][0].update(usable_by=["a"]),"REUSE_ORIGINAL_COMPETENCE_NOT_SHARED_WITH_RECIPIENT"),
])
def test_third_party_licence_never_inferred(change,reason):
    d=interfirm_case()
    change(d)
    out=simulate(d)
    row=out["competence_reuse_dynamics"]["links"][0]
    assert reason in row["unqualified_reasons"]
    assert row["declared_metric_change_favourable_positive"] is None
    assert out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_owner_revocation_blocks_fresh_read_without_removing_prior_results():
    d=interfirm_case()
    d["events"].append({"at":23,"action":"source_update","actor":"a","source":"license-a",
                        "new_revision":"lic-2","status":"UNKNOWN","usable_by":["a"]})
    out=simulate(d)
    row=out["competence_reuse_dynamics"]["links"][0]
    assert "REUSE_PERMISSION_SOURCE_REVISION_STALE" in row["unqualified_reasons"]
    assert out["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("change",[
    lambda d: d["competence_reuse_permissions"][0].update(grant_ref="model://op/forged"),
    lambda d: d["competence_reuse_permissions"][0].update(recipient_ack_ref="model://a/forged"),
    lambda d: d["competence_reuse_permissions"][0].update(valid_until=15),
    lambda d: d["competence_reuse_permissions"].append(deepcopy(d["competence_reuse_permissions"][0])),
])
def test_malformed_transfer_research_source_fails_closed(change):
    d=interfirm_case()
    change(d)
    with pytest.raises(ValueError,match="REUSE_PERMISSION"):
        simulate(d)


def test_non_transfer_fixture_unchanged_without_rights_input():
    d=complete_case()
    out=simulate(d)
    assert "permission_evidence" not in out["competence_reuse_dynamics"]
    assert out["competence_reuse_dynamics"]["comparable_sequence_count"]==1
