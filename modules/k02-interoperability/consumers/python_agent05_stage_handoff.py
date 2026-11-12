"""Independent Python verification of the public K02 -> Agent 0.5 handoff.

The model and quality evidence in this vector are synthetic contract fixtures.
This checker neither imports private Agent sources nor invokes a model/Task.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


def sha256_body(obj: dict, digest_field: str) -> str:
    clean = {k: v for k, v in obj.items() if k != digest_field}
    encoded = json.dumps(clean, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def verify(obj: dict) -> dict:
    assert obj["schema"] == "IWXA.K02.AGENT05_CROSS_LANGUAGE_HANDOFF_VECTOR/0.1.0"
    assert obj["evidenceScope"] == "SYNTHETIC_SHAPE_ONLY_NOT_AGENT_EXECUTION"
    recommendation = obj["recommendation"]
    assert recommendation["schema"] == "IWXA.K02.TASK_STAGE_SELECTION/0.1.0"
    assert recommendation["recommendationDigest"] == sha256_body(
        recommendation, "recommendationDigest")
    plan = recommendation["plan"]
    assert plan["planDigest"] == sha256_body(plan, "planDigest")
    assert plan["contractVersion"] == "IWXA.K02.INTEROP/0.1.0"
    assert plan["bindingVersion"] == "IWXA.K02.PLAN_BINDING/0.1.0"
    assert plan["taskId"] == obj["taskId"]
    assert recommendation["contextBinding"]["digest"] == obj["context"]["digest"]
    assert recommendation["contextBinding"]["transferred"] is False
    assert len(plan["steps"]) == 1
    stage = plan["steps"][0]
    assert stage["providerId"] == obj["providerId"] == "OLLAMA_LOCAL_V1"
    assert stage["modelPin"] == obj["pin"]
    assert stage["effectClass"] == "MODEL_INFERENCE"
    assert stage["hostApprovalRequired"] is True
    assert stage["invocationAuthority"] == "HOST_ONLY"
    assert stage["proofOfInvoke"] is None
    handoff = obj["handoff"]
    assert handoff["schema"] == "IWXA.K02.AGENT05_MODEL_STAGE_HANDOFF/0.1.0"
    assert handoff["status"] == "MODEL_STEP_MATCHED_P01_ATTESTATION_REQUIRED"
    assert handoff["providerId"] == obj["providerId"]
    assert handoff["modelPin"] == obj["pin"]
    assert handoff["k02PlanDigest"] == plan["planDigest"]
    assert handoff["recommendationDigest"] == recommendation["recommendationDigest"]
    assert handoff["hostAuthorityGranted"] is False
    assert handoff["modelInvoked"] is False
    assert handoff["nativeBindingVerified"] is False
    assert handoff["ownerReceiptsVerified"] is False
    assert handoff["resultProduced"] is False
    assert "P01_K02_K04_OWNER_RECEIPT_VALIDATION" in handoff["needs"]
    return {"status": "PASS", "stageCount": 1,
            "p01NativeProvider": handoff["providerId"],
            "hostAuthorityGranted": False, "agentResultProduced": False,
            "resultScope": "CONTRACT_ONLY"}


if __name__ == "__main__":
    script = Path(__file__).with_name("agent05-stage-handoff-vector.mjs")
    process = subprocess.run(
        ["node", str(script)], capture_output=True, text=True,
        encoding="utf-8", timeout=20, check=True)
    observed = json.loads(process.stdout)
    print("K02_AGENT05_PYTHON_HANDOFF " + json.dumps(
        verify(observed), sort_keys=True))
