"""Independent Python check of public Agent05 owner pin diagnostic.

Validates source-level SHA-1 byte identity and branch-head mismatch only.
No private Agent or Windows executable is imported, built or executed.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
FILES = {
    "index.mjs": "6dd21b566f6dfe3d2e920d3e877548361653460e",
    "model-step-selection.mjs": "45263714c1c2440406889e4ba5791686bc386c8f",
}

def git_blob(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") +
                        b"\0" + data).hexdigest()

def qualify() -> dict:
    head = os.environ["GITHUB_SHA"]
    frozen = os.environ["K02_PINNED_SOURCE_SHA"]
    source = ROOT / "consumers" / "agent05-owner-source-pin-check.mjs"
    output = subprocess.run(["node", str(source)], encoding="utf-8",
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            check=True, timeout=20).stdout
    assert output.startswith("K02_AGENT05_OWNER_SOURCE_PIN "), "marker_missing"
    obj = json.loads(output.split(" ", 1)[1])
    assert obj["schema"] == "IWXA.K02.AGENT05_OWNER_SOURCE_PIN_DIAGNOSTIC/0.1.0"
    assert obj["pinnedCommit"] == frozen
    assert obj["observedBranchHead"] == head
    assert obj["actualPinnedWindowsBinaryVerified"] is False
    assert obj["installedAgentVerified"] is False
    for path, expected in FILES.items():
        actual = git_blob((ROOT / path).read_bytes())
        assert actual == expected, "owner_api_blob_drift:" + path
        assert obj["observedApiBlobs"][path] == actual
        assert obj["pinnedApiBlobs"][path] == expected
    assert obj["sourceApiByteIdentical"] is True
    expected_equal = head == frozen
    assert obj["branchHeadMatchesPinnedSource"] is expected_equal
    assert obj["branchCheckoutWithShaAssertionWouldPass"] is expected_equal
    assert obj["status"] == ("BRANCH_HEAD_MATCHES_FROZEN_PIN" if expected_equal
        else "BRANCH_HEAD_MOVED_FROZEN_API_STABLE")
    return {"status": "PASS", "sourceBlobs": 2,
            "frozenSourceByteIdentical": True,
            "branchCheckoutWouldPass": expected_equal,
            "scope": "PUBLIC_SOURCE_ONLY_NOT_WINDOWS_OWNER_ACCEPTANCE"}

if __name__ == "__main__":
    print("K02_OWNER_PIN_PYTHON " + json.dumps(qualify(), sort_keys=True))
