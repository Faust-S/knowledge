"""Read-only K05 verification of one actual pinned K03 issue output.

K03 independently owns U1, cues and selection. K05 checks source revision and
byte locators; neither turns a cue into task truth or replays a new U1.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
K03_OWNER = ROOT / ".k03-owner"
sys.path.insert(0, str(ROOT / "research" / "cross-lab"))
sys.path.insert(0, str(K03_OWNER / "modules" / "k03-activity-task-discovery"))

import k05_evaluation as k05
import issue_replay as k03_issue

SOURCE = "https://github.com/paperless-ngx/paperless-ngx/issues/14657"


def main() -> None:
    # Frozen K03 owner logic reads exactly one selected original issue.
    cache: dict[str, bytes] = {}

    def get_once(item: dict) -> bytes:
        key = item["html_url"]
        if key not in cache:
            cache[key] = k03_issue.source._projection(item, None)
        return cache[key]

    result = k03_issue.replay_issue(SOURCE, get_source=get_once)
    assert result["source_verified"] is True
    assert result["human_task_gold"] is False
    assert result["accepted_task_count"] == 0
    assert len(cache) == 1 and SOURCE in cache
    manifest_bytes = k03_issue.frozen.SELECTION.read_bytes()
    expected_manifest_git_blob = k03_issue.frozen.MANIFEST_GIT_BLOB
    original_bytes = cache[SOURCE]

    evidence = k05.project_k03_issue_evidence(
        result, original_bytes,
        manifest_bytes=manifest_bytes,
        expected_manifest_git_blob=expected_manifest_git_blob,
    )
    assert evidence["source_sha256"] == result["source_sha256"]
    assert evidence["measured"]["observation_count"] == len(
        result["activity_observations"]
    )
    assert evidence["scope"]["k03_native_u1_replayed_by_k05"] is False
    assert evidence["scope"]["source_sha256_verified"] is True
    assert evidence["scope"]["source_locator_verified"] is True
    assert evidence["unknown"]["task_precision"] is None
    assert evidence["unknown"]["task_f1"] is None
    assert evidence["unknown"]["agent_result_readback"] == "NOT_TESTED"
    assert k05.verify_k03_source_projection(
        evidence, result, original_bytes,
        manifest_bytes=manifest_bytes,
        expected_manifest_git_blob=expected_manifest_git_blob,
    )
    injected = copy.deepcopy(result)
    injected["activity_observations"][0]["claim"] = "CONFIRMED_USER_TASK"
    try:
        k05.project_k03_issue_evidence(
            injected, original_bytes,
            manifest_bytes=manifest_bytes,
            expected_manifest_git_blob=expected_manifest_git_blob,
        )
    except k05.PinMismatch as error:
        assert str(error) == "UNSUPPORTED_SEMANTIC_ASSERTION"
    else:
        raise AssertionError("UNSUPPORTED_CLAIM_WAS_ACCEPTED")
    # Byte volume is only a technical proxy, not end-to-end effort or human time.
    print(json.dumps({
        "status": "K05_K03_REAL_ISSUE_SOURCE_PROOF_PASS",
        "source_count": len(cache),
        "source_bytes_verified": evidence["measured"]["source_integrity_scan_bytes"],
        "cue_excerpt_bytes": evidence["measured"]["pinned_cue_excerpt_bytes"],
        "observations_checked": evidence["measured"]["observation_count"],
        "human_gold": False,
        "task_f1": None,
        "agent_result_readback": "NOT_TESTED",
    }, sort_keys=True))


if __name__ == "__main__":
    main()
