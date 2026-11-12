"""Independently validate open Ollama native owner draft and evidence.

This checks publicly executed Ollama outputs, not Personal Agent owner CLI
execution or accepted Task/Result. The evidence sample is small (2 trials).
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


def digest(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def check(directory: Path):
    trial = json.loads((directory / "native-ollama-candidate.json").read_text(
        encoding="utf-8"))
    assert trial["schema"] == "IWXA.K02.OPEN_OLLAMA_NATIVE_REBIND_TRIAL/0.1.0"
    assert trial["boundary"] == "REAL_OPEN_OLLAMA_NOT_PRIVATE_AGENT_P01"
    assert trial["nativeAgentResultProduced"] is False
    assert trial["measuredHostComputeCostUsd"] is None
    if trial["status"] == "NOT_RUN":
        assert trial["ownerRequestDraftStatus"] == "NOT_RUN"
        return {"status": "NOT_RUN", "reason": "NO_QUALIFIED_OPEN_HOST_MODEL"}
    assert trial["status"] == "REAL_NATIVE_OPEN_HOST_MODEL_INVOKE"
    assert trial["hostProviderInvoked"] is True
    assert trial["proofClass"] == "REAL_LOCAL_MODEL_INFERENCE_NOT_PRODUCT_TASK"
    assert trial["nativeModelPin"]["name"]
    assert len(trial["nativeModelPin"]["digest"]) == 64
    quality = trial["independentNativeQuality"]
    assert quality["attempts"] == len(quality["trialResults"]) == 2
    assert quality["passed"] == sum(
        1 for row in quality["trialResults"] if row["correct"])
    assert quality["proofRef"].startswith("open-real-native:")
    assert quality["qualification"] == (
        "OBSERVED_OPEN_HOST_SAMPLE_NOT_QUALITY_GUARANTEE")
    candidate = directory / "native-owner-request-draft.json"
    if trial["ownerRequestDraftStatus"] == "OWNER_REQUEST_HOLD":
        assert quality["passed"] < 1
        assert trial["ownerRequestDigest"] is None
        assert not candidate.exists()
        return {"status": "PASS", "result": "QUALIFIED_OWNER_REQUEST_HELD",
                "nativeTrials": quality["attempts"],
                "nativeCorrect": quality["passed"],
                "agentOwnerReceipt": False}
    assert trial["ownerRequestDraftStatus"] == "OWNER_REQUEST_DRAFT_NOT_EXECUTED"
    assert quality["passed"] >= 1
    assert candidate.exists(), "owner_request_missing"
    data = json.loads(candidate.read_text(encoding="utf-8"))
    assert data["boundary"] == "OPEN_HOST_DRAFT_NOT_AGENT_U01_OWNER_RECEIPT"
    assert data["modelInvokedByOwner"] is False
    assert data["ownerReceiptProduced"] is False
    request = data["ownerRequest"]
    assert request["schema"] == "PA.K02_K04.OWNER_REQUEST/0.1.0"
    assert request["task_id"].startswith("TASK-")
    assert data["ownerRequestDigest"] == trial["ownerRequestDigest"] == digest(request)
    assert request["k02"]["trial_evidence"] is None
    assert request["k02"]["selected_skills"] == []
    assert len(request["k02"]["solution"]["requirements"]) == 1
    assert len(request["k02"]["providers"]) == 1
    descriptor = request["k02"]["providers"][0]
    assert descriptor["providerId"] == "OLLAMA_LOCAL_V1"
    recommendation = request["k02"]["model_recommendation"]
    assert set(recommendation) == {
        "requirement_id", "step", "profiles", "quality_evidence",
        "environment", "user_model_pin"}
    assert recommendation["user_model_pin"] == trial["nativeModelPin"]
    assert recommendation["requirement_id"] == "summary"
    evidence = recommendation["quality_evidence"]
    assert len(evidence) == 1
    assert evidence[0]["providerId"] == "OLLAMA_LOCAL_V1"
    assert evidence[0]["modelPin"] == trial["nativeModelPin"]
    assert evidence[0]["proofRef"] == quality["proofRef"]
    assert evidence[0]["passed"] == quality["passed"]
    assert evidence[0]["attempts"] == quality["attempts"]
    assert len(recommendation["profiles"]) == 1
    assert recommendation["profiles"][0]["providerId"] == "OLLAMA_LOCAL_V1"
    assert len(trial["ownerPlanPreviewDigest"]) == 64
    return {"status": "PASS", "result": "OWNER_DRAFT_BOUND_NO_EXECUTION",
            "nativeTrials": quality["attempts"],
            "nativeCorrect": quality["passed"],
            "ownerRequestDigest": data["ownerRequestDigest"],
            "agentOwnerReceipt": False, "agentResultProduced": False}


if __name__ == "__main__":
    root = os.environ.get("K02_CASE_OUTPUT_DIR")
    if not root:
        raise SystemExit("K02_CASE_OUTPUT_DIR_REQUIRED")
    result = check(Path(root))
    print("K02_INDEPENDENT_NATIVE_OWNER_DRAFT " + json.dumps(result, sort_keys=True))
