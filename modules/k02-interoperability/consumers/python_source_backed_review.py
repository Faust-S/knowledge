import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "consumers" / "source-backed-review.mjs"
SOURCE_PATH = "solutions/meeting-followup/agent.json"
HEX40 = re.compile(r"^[a-f0-9]{40}$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")


def authoritative_public_source(revision):
    url = (
        "https://api.github.com/repos/Faust-S/knowledge/contents/"
        + SOURCE_PATH + "?ref=" + revision
    )
    request = Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "IWXA-K02-Python-Independent-Consumer",
    })
    with urlopen(request, timeout=15) as response:
        metadata = json.load(response)
    assert metadata["type"] == "file"
    assert metadata["encoding"] == "base64"
    content = base64.b64decode(metadata["content"], validate=False)
    assert len(content) == metadata["size"]
    git_blob_sha1 = hashlib.sha1(
        b"blob " + str(len(content)).encode("ascii") + b"\0" + content
    ).hexdigest()
    assert git_blob_sha1 == metadata["sha"]
    return content.decode("utf-8")


def verify(receipt, original, source_revision, model_digest):
    assert receipt["contractVersion"] == "IWXA.K02.INTEROP/0.1.0"
    assert HEX64.fullmatch(receipt["planDigest"]) is not None
    assert receipt["solutionId"] == "meeting-followup-crewai"
    assert receipt["sourceDefinitionStatus"] == "SPEC_COMPLETE_NOT_EXECUTED"
    assert receipt["status"] == "DRAFT_REQUIRES_HUMAN_REVIEW"
    assert receipt["taskCreated"] is False and receipt["resultStored"] is False
    source = receipt["source"]
    assert source["revision"] == source_revision
    assert source["path"] == SOURCE_PATH
    assert source["sourceRef"] == (
        "github:Faust-S/knowledge@" + source_revision + ":" + SOURCE_PATH
    )
    assert source["sha256"] == hashlib.sha256(original.encode("utf-8")).hexdigest()
    assert source["quoteEvidence"] == "EXACT_SPAN_VERIFIED"
    definition = json.loads(original)
    assert definition["id"] == receipt["solutionId"]
    guard = next(x["guard"] for x in definition["state_machine"] if x["id"] == "human_review")
    assert guard == source["quote"]
    # Node offsets are UTF-16 code units, not Python's Unicode code-point indices.
    utf16 = original.encode("utf-16-le")
    assert utf16[source["start"] * 2:source["end"] * 2].decode("utf-16-le") == guard
    assert receipt["skill"]["skillId"] == "exact-source-audit"
    assert receipt["skill"]["auditStatus"] == "REVIEW_REQUIRED"
    assert receipt["skill"]["accepted"] == 1
    model = receipt["model"]
    assert model["modelDigest"] == model_digest
    assert isinstance(model["questionDraft"], str) and model["questionDraft"].strip()
    assert model["questionDraftSha256"] == hashlib.sha256(
        model["questionDraft"].encode("utf-8")
    ).hexdigest()
    assert model["questionVerifiedAsFact"] is False
    assert model["promptTokens"] >= 1 and model["completionTokens"] >= 1
    assert model["durationMs"] > 0
    assert model["inferenceProof"] == "REAL_LOCAL_MODEL_INFERENCE_NOT_PRODUCT_TASK"
    assert receipt["observations"]["providerFeeUsd"] == 0
    assert receipt["observations"]["localComputeCostUsd"] is None
    return {
        "contractVersion": receipt["contractVersion"],
        "sourceRevision": source_revision,
        "sourceSha256": source["sha256"],
        "quoteVerifiedAgainstIndependentFetch": True,
        "skillStatus": receipt["skill"]["auditStatus"],
        "modelDigest": model_digest,
        "modelPromptTokens": model["promptTokens"],
        "modelCompletionTokens": model["completionTokens"],
        "modelLatencyMs": round(model["durationMs"], 2),
        "draftSha256": model["questionDraftSha256"],
        "draftCharacters": len(model["questionDraft"]),
        "modelQualityHumanReviewed": False,
        "resultClass": "SOURCE_BACKED_DRAFT_NOT_PRODUCT_TASK",
    }


def main():
    source_revision = sys.argv[1]
    model_digest = os.environ["K02_MODEL_DIGEST"]
    assert HEX40.fullmatch(source_revision) is not None
    assert HEX64.fullmatch(model_digest) is not None
    receipt = None
    for attempt in range(3):
        output = subprocess.run(
            ["node", str(BRIDGE), source_revision],
            cwd=ROOT, capture_output=True, text=True,
            encoding="utf-8", timeout=150, check=False,
        )
        if output.returncode == 0:
            receipt = json.loads(output.stdout)
            break
        try:
            error_code = json.loads(output.stderr)["code"]
        except (ValueError, KeyError, TypeError):
            error_code = "BRIDGE_UNEXPECTED_FAILURE"
        # Retry only transient provider/network unavailability. A binding,
        # schema, authorization, or provenance error remains a hard failure.
        if error_code != "PROVIDER_UNAVAILABLE" or attempt == 2:
            raise RuntimeError("K02_BRIDGE_FAILED:" + error_code)
        import time
        time.sleep(attempt + 1)
    assert receipt is not None
    reference = authoritative_public_source(source_revision)
    result = verify(receipt, reference, source_revision, model_digest)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
