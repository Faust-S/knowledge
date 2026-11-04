import hashlib
import json
import pathlib
import re
import subprocess
import sys

MODULE = pathlib.Path(__file__).resolve().parents[1]
BRIDGE = MODULE / "consumers" / "public-source-bridge.mjs"


def consume(revision: str, relative_path: str) -> dict:
    if re.fullmatch(r"[0-9a-f]{40}", revision) is None:
        raise ValueError("full immutable revision required")
    proc = subprocess.run(
        ["node", str(BRIDGE), revision, relative_path],
        cwd=MODULE,
        capture_output=True, text=True, encoding="utf-8", timeout=30, check=True,
    )
    receipt = json.loads(proc.stdout)
    output = receipt["output"]
    assert receipt["status"] == "SUCCEEDED"
    assert receipt["providerId"] == "github-public-rest"
    assert receipt["contractVersion"] == "IWXA.K02.INTEROP/0.1.0"
    assert output["revision"] == revision
    assert output["sourceRef"] == f"github:Faust-S/knowledge@{revision}:{relative_path}"
    assert hashlib.sha256(output["content"].encode("utf-8")).hexdigest() == output["sha256"]
    assert receipt["observation"]["durationMs"] > 0
    assert receipt["observation"]["actualProviderFeeUsd"] == 0
    return receipt


if __name__ == "__main__":
    pinned_revision = sys.argv[1]
    relative_path = sys.argv[2]
    result = consume(pinned_revision, relative_path)
    if relative_path.endswith("/agent.json"):
        agent = json.loads(result["output"]["content"])
        assert agent["schema"] == "iwxa.specialized-agent-definition/0.1"
        assert agent["id"] == "meeting-followup-crewai"
        assert agent["status"] == "SPEC_COMPLETE_NOT_EXECUTED"
    print(json.dumps({
        "contractVersion": result["contractVersion"],
        "providerId": result["providerId"],
        "status": result["status"],
        "sourceRef": result["output"]["sourceRef"],
        "sha256": result["output"]["sha256"],
        "durationMs": round(result["observation"]["durationMs"], 2),
        "actualProviderFeeUsd": result["observation"]["actualProviderFeeUsd"],
        "resultClass": "PUBLIC_SOURCE_READ_NOT_AGENT_EXECUTION",
    }, sort_keys=True))
