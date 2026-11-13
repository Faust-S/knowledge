"""Independent Agent 0.5 native-provider projection verification.

Consumes synthetic K02 JavaScript output and independently checks both
canonical SHA-256 plans and the absence of native execution authority.
Never accesses private Agent code, tests no actual Windows execution.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


def digest(value: dict, key: str) -> str:
    unsigned = {k: v for k, v in value.items() if k != key}
    raw = json.dumps(unsigned, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def check(data: dict) -> dict:
    assert data["schema"] == "IWXA.K02.AGENT05_NATIVE_CANDIDATE_VECTOR/0.1.0"
    assert data["scope"] == "SYNTHETIC_CONTRACT_ONLY_NO_AGENT_RESULT"
    recommendation = data["recommendation"]
    assert recommendation["schema"] == "IWXA.K02.TASK_STAGE_SELECTION/0.1.0"
    assert recommendation["decision"] == "STAGES_PROPOSED_NOT_AUTHORIZED"
    assert recommendation["recommendationDigest"] == digest(
        recommendation, "recommendationDigest")
    prior_plan = recommendation["plan"]
    assert prior_plan["planDigest"] == digest(prior_plan, "planDigest")
    assert prior_plan["taskId"] == data["taskId"]
    assert len(prior_plan["steps"]) == 2
    assert [s["providerId"] for s in prior_plan["steps"]] == [
        "candidate-small", "candidate-strong"]
    output = data["native"]
    assert output["schema"] == "IWXA.K02.AGENT05_OLLAMA_CANDIDATE/0.1.0"
    assert output["status"] == "SCOPED_NATIVE_MODEL_PROPOSED_NOT_AUTHORIZED"
    assert output["reason"] == "P01_OWNER_PLANS_AND_PER_STEP_PIN_CONFIRMATION_REQUIRED"
    assert output["taskId"] == data["taskId"]
    assert output["requirementId"] == "write"
    assert output["candidateProviderId"] == "candidate-strong"
    assert output["nativeProviderId"] == "OLLAMA_LOCAL_V1"
    assert output["originalK02PlanDigest"] == prior_plan["planDigest"]
    assert output["originalRecommendationDigest"] == recommendation["recommendationDigest"]
    assert output["planScope"] == "SINGLE_MODEL_REQUIREMENT_NOT_COMPLETE_TASK"
    assert output["fullTaskPlanUsable"] is False
    assert output["perStepPinConfirmationRequired"] is True
    assert output["globallySelectedModelMatches"] is False
    assert output["contextBinding"] == {
        "ref": data["context"]["ref"], "digest": data["context"]["digest"],
        "transferred": False}
    assert output["nativeOwnerAction"] == "REPLAN_WITH_PINNED_K02_K04_OWNER_CLI"
    assert output["nativeOwnerPreflightRequired"] is True
    native_plan = output["scopedPlanPreview"]
    assert native_plan["contractVersion"] == "IWXA.K02.INTEROP/0.1.0"
    assert native_plan["bindingVersion"] == "IWXA.K02.PLAN_BINDING/0.1.0"
    assert native_plan["planDigest"] == digest(native_plan, "planDigest")
    assert native_plan["taskId"] == data["taskId"]
    assert len(native_plan["steps"]) == 1
    step = native_plan["steps"][0]
    assert step["requirementId"] == "write"
    assert step["providerId"] == "OLLAMA_LOCAL_V1"
    assert step["modelPin"] == output["modelPin"]
    assert step["capabilityId"] == "text.generate"
    assert step["effectClass"] == "MODEL_INFERENCE"
    assert step["capabilityDigest"] == output["nativeCapabilityDigest"]
    assert step["capabilityDigest"] != prior_plan["steps"][1]["capabilityDigest"]
    assert step["hostApprovalRequired"] is True
    assert step["invocationState"] == "NOT_INVOKED"
    assert step["proofOfInvoke"] is None
    assert native_plan["estimates"]["hostComputeCostUsd"] is None
    for field in ("hostAuthorityGranted", "modelInvoked", "resultProduced",
                  "ownerReceiptsVerified", "nativeBindingVerified", "globalModelChanged"):
        assert output[field] is False, f"authority_field_incorrect:{field}"
    draft = data["owner"]
    assert draft["schema"] == "IWXA.K02.AGENT05_OWNER_REQUEST_DRAFT/0.1.0"
    assert draft["status"] == "OWNER_REQUEST_DRAFT_NOT_EXECUTED"
    assert draft["contextCurrentness"] == "FRESH_OBSERVED_NOT_OWNER_ATTESTED"
    assert draft["ownerExecuted"] is False
    assert draft["ownerReceiptsVerified"] is False
    assert draft["hostAuthorityGranted"] is False
    assert draft["graphChanged"] is False
    assert draft["modelInvoked"] is False
    assert draft["resultProduced"] is False
    assert draft["expectedOwnerPlanDigest"] == native_plan["planDigest"]
    owner = draft["ownerRequest"]
    assert draft["ownerRequestDigest"] == hashlib.sha256(json.dumps(
        owner, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False).encode("utf-8")).hexdigest()
    assert owner["schema"] == "PA.K02_K04.OWNER_REQUEST/0.1.0"
    assert owner["task_id"] == data["taskId"]
    k02 = owner["k02"]
    assert len(k02["providers"]) == 1
    assert k02["providers"][0]["providerId"] == "OLLAMA_LOCAL_V1"
    assert len(k02["solution"]["requirements"]) == 1
    assert k02["solution"]["requirements"][0]["modelPin"] == output["modelPin"]
    assert k02["selected_skills"] == []
    request = k02["model_recommendation"]
    assert set(request) == {"requirement_id", "step", "profiles", "quality_evidence",
                            "environment", "user_model_pin"}
    assert request["requirement_id"] == "write"
    assert request["user_model_pin"] == output["modelPin"]
    assert len(request["quality_evidence"]) == 1
    assert request["quality_evidence"][0]["providerId"] == "OLLAMA_LOCAL_V1"
    assert request["profiles"][0]["providerId"] == "OLLAMA_LOCAL_V1"
    assert request["quality_evidence"][0]["proofRef"] != "fixture-only-quality-evidence"
    return {"status": "PASS", "nativeProvider": step["providerId"],
            "originalStages": len(prior_plan["steps"]), "scopedNativeStages": 1,
            "ownerReceiptProduced": False, "agentResultProduced": False,
            "resultScope": "SYNTHETIC_CONTRACT_ONLY"}


if __name__ == "__main__":
    vector = Path(__file__).with_name("agent05-native-candidate-vector.mjs")
    execution = subprocess.run(
        ["node", str(vector)], text=True, capture_output=True,
        encoding="utf-8", timeout=20, check=True)
    output = check(json.loads(execution.stdout))
    print("K02_AGENT05_NATIVE_CANDIDATE_PYTHON " +
          json.dumps(output, sort_keys=True))
