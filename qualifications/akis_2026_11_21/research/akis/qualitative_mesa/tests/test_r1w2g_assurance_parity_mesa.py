"""R1-W2G: both common causal trajectories execute on original Mesa 3.5.2."""
from copy import deepcopy
import json
from pathlib import Path

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.r1w2g_assurance_projection import (
    SCHEMA, project_native_r1w2g,
)
from .test_work_assurance_mesa import scenario, quality_event, execution_events


def common_contract():
    path = Path(__file__).resolve().parents[1] / "fixtures" / "r1w2g_assurance_causal_contract.json"
    return json.loads(path.read_text(encoding="utf-8"))


class OriginalScenario:
    """Build the original events, obtaining real proposal fingerprints.
    
    The builder does not manufacture outcomes. The entire event stream is
    then executed independently on the actual Mesa clock.
    """
    def __init__(self, contract):
        assert contract["schema"] == SCHEMA
        assert contract["inputs"]["currency"] == "RUB"
        assert contract["inputs"]["criterion_ids"] == ["fit", "documents"]
        assert contract["inputs"]["failed_criterion"] == "documents"
        self.d = scenario()
        # Both shared criteria belong to the terminal original operation.
        first = self.d["works"][0]["assurance_criteria"][0]
        first.update(operation="pack", responsible_owner="b")
        self.state = QualitativeAKIS(self.d)
        self.events = []
        self.labels = {}
        self.at = 0
        for event in execution_events():
            self.emit(event)
        self.assess("fit", True, "model://final-v1")
        self.assess("documents", False, "model://final-v1")

    def emit(self, event, label=None, expected="APPLIED"):
        self.at = event["at"]
        if label:
            assert label not in self.labels
            self.labels[label] = len(self.events)
        self.events.append(deepcopy(event))
        result = self.state.apply(event, self.at)
        assert result["outcome"] == expected, (event, result)
        return result

    def action(self, action, actor, *, at=None, label=None, expected="APPLIED", **fields):
        return self.emit(dict(at=self.at+1 if at is None else at,
            action=action, actor=actor, work="w1", **fields), label, expected)

    def assess(self, key, passed, result, *, label=None, expected="APPLIED", **fields):
        event = quality_event(self.at+1, criterion_id=key,
            verdict="MEETS_DECLARED_REQUIREMENT" if passed else "DOES_NOT_MEET",
            result_ref=result, **fields)
        return self.emit(event, label, expected)

    def actual_mesa(self):
        self.d["events"] = deepcopy(self.events)
        self.d["model_horizon"] = self.at+2
        result = simulate(deepcopy(self.d))
        assert result["trace"] == self.state.trace
        assert result["counts"]["applied"] + result["counts"]["blocked"] == len(self.events)
        return result, self.labels, self.d


def reassessment_case(contract):
    case = OriginalScenario(contract)
    case.action("accept", "c", label="accept_negative", expected="BLOCKED")
    case.assess("documents", True, "model://final-v1",
                label="overwrite", expected="BLOCKED")
    previous = case.state.works["w1"].assurance_reviews["documents"]["model_ref"]
    case.assess("documents", True, "model://final-v1",
                quality_reassessment_of=previous,
                quality_reassessment_reason=contract["inputs"]["reassessment_reason"],
                quality_reassessment_ref="model://c/measurement-error-evidence")
    case.action("accept", "b", label="accept_wrong", expected="BLOCKED")
    case.action("accept", "c", label="accept_original")
    return case.actual_mesa()


def reexecution_case(contract):
    case = OriginalScenario(contract)
    case.action("accept", "c", label="accept_negative", expected="BLOCKED")
    case.action("reject", "c")
    case.action("resubmit", "a", result_ref="model://unexecuted-result",
                label="unexecuted", expected="BLOCKED")
    result = "model://final-v1"
    amounts = contract["inputs"]["additional_resources_rub"]
    for i, amount in enumerate(amounts, 1):
        ident = f"correction-{i}"
        start = case.at + 11
        end = start + (2 if i == 1 else 1)
        fields = dict(quality_correction_id=ident, result_ref=result,
                      source_revision="d1", org_revision="oc-1")
        proposed = case.action("quality_correction_propose", "c", **fields,
            operation="pack", quality_correction_slot_start=start,
            quality_correction_slot_end=end, quality_correction_valid_until=start-1,
            quality_correction_source_ref=f"model://c/correction-{i}",
            quality_correction_resource_ref=f"model://b/correction-resources-{i}",
            quality_correction_cost=str(amount), quality_correction_currency="RUB")
        fields["quality_correction_fingerprint"] = proposed["quality_correction_fingerprint"]
        case.action("quality_correction_apply", "c", **fields,
                    quality_correction_source_ref=f"model://c/early-apply-{i}",
                    label=f"early_apply_{i}", expected="BLOCKED")
        for owner in proposed["quality_correction_required"]:
            case.action("quality_correction_review", owner, **fields,
                quality_correction_decision="SUPPORT",
                quality_correction_source_ref=f"model://{owner}/correction-vote-{i}")
        case.action("quality_correction_apply", "c", **fields,
                    quality_correction_source_ref=f"model://c/correction-apply-{i}",
                    label=f"apply_{i}")
        case.action("quality_correction_start", "b", at=start, **fields,
                    quality_correction_source_ref=f"model://b/correction-start-{i}",
                    quality_correction_cost_ref=f"model://b/correction-cost-{i}",
                    quality_correction_cost=str(amount))
        case.action("quality_correction_complete", "b", at=end, **fields,
                    quality_correction_source_ref=f"model://b/correction-done-{i}")
        result = f"model://final-v{i+1}"
        case.action("resubmit", "a", result_ref=result,
                    quality_correction_id=ident,
                    quality_correction_fingerprint=fields["quality_correction_fingerprint"])
        case.action("accept", "c", label=f"accept_missing_{i}", expected="BLOCKED")
        case.assess("fit", True, result)
        case.action("accept", "c", label=f"accept_partial_{i}", expected="BLOCKED")
        case.assess("documents", i == len(amounts), result)
        if i < len(amounts):
            case.action("reject", "c")
    case.action("accept", "b", label="accept_wrong", expected="BLOCKED")
    case.action("accept", "c", label="accept_original")
    return case.actual_mesa()


def project(contract):
    r, lr, rd = reassessment_case(contract)
    p, lp, pd = reexecution_case(contract)
    before = deepcopy([r, p, contract])
    out = project_native_r1w2g(r, p, lr, lp)
    assert [r, p, contract] == before
    return out, (r, p), (rd, pd)


def test_real_native_mesa_matches_every_common_assurance_causal_observation():
    contract = common_contract()
    out, _, _ = project(contract)
    assert out["common"] == contract["expected_common"]
    assert out["boundary"]["execution_scope"] == "TERMINAL_OPERATION_AFTER_SUBMITTED_RESULT"
    assert out["boundary"]["currency_semantics"] == "DECLARED_NONCASH_RESOURCE_USE_CLAIM"
    assert out["boundary"]["actual_principal_counts"] == [3, 3]
    assert out["boundary"]["bank_payment_proved"] is False
    print("AKIS_R1W2G_NATIVE_PROJECTION=" + json.dumps(out, ensure_ascii=False, sort_keys=True))


def test_projection_replays_deterministically_and_does_not_mutate_original_inputs():
    contract = common_contract()
    a, snapshots, scenarios = project(contract)
    b, _, _ = project(contract)
    assert a == b
    assert all(simulate(deepcopy(d)) == observed for d, observed in zip(scenarios, snapshots))


def test_shared_cost_values_are_read_from_executed_correction_not_expected_answer():
    contract = common_contract()
    changed = deepcopy(contract)
    changed["inputs"]["additional_resources_rub"][0] = 4501
    out, _, _ = project(changed)
    assert out["common"]["reexecution"]["additional_resource_amounts_rub"] == [4501, 1700]
    assert out["common"] != contract["expected_common"]
