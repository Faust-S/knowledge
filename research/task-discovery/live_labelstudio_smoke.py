#!/usr/bin/env python3
"""One-off native Label Studio 1.23.2 API integration, SYNTHETIC data only.

This calls the existing public M3 transport adapter with a disposable local
Label Studio instance. API-written coverage is NOT human annotation or gold.
No private owner XML, source bodies or secrets are imported into public CI.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
from urllib.error import HTTPError, URLError

import labelstudio_project_setup as transport

SCHEMA = "IWXA_TASK_EXP_01_SYNTHETIC_LABEL_STUDIO_LIVE_SMOKE/0.1"
# Synthetic form tests transport, not the owner-private exact XML blob.
SYNTHETIC_XML = """<View>
  <Text name="source_text" value="$source_text" valueType="text" granularity="word"/>
  <Labels name="taskness" toName="source_text" choice="single">
    <Label value="PROCESS"/>
    <Label value="INDEPENDENT_TASK"/>
    <Label value="OPERATION"/>
    <Label value="INSUFFICIENT_EVIDENCE"/>
  </Labels>
  <View visibleWhen="region-selected" whenTagName="source_text" whenLabelValue="INDEPENDENT_TASK">
    <Header value="Synthetic test-only goal, result and acceptance fields"/>
    <TextArea name="goal" toName="source_text" perRegion="true" maxSubmissions="1" rows="2"/>
    <TextArea name="expected_result" toName="source_text" perRegion="true" maxSubmissions="1" rows="2"/>
    <TextArea name="acceptance_criterion" toName="source_text" perRegion="true" maxSubmissions="1" rows="2"/>
  </View>
  <Choices name="review_coverage" toName="source_text" choice="single" required="true">
    <Choice value="ALL_RELEVANT_SPANS_MARKED"/>
    <Choice value="NO_TASK_RELEVANT_SPANS"/>
    <Choice value="REVIEW_INCOMPLETE"/>
  </Choices>
</View>"""


def traced_api(base: str, credential: str, route: str, body=None):
    """Fixed route-category diagnostic; never emit source, token or HTTP body."""
    if route == "/api/projects/":
        stage = "PROJECT_CREATE"
    elif "/import?" in route:
        stage = "TASK_IMPORT"
    elif "/annotations/" in route:
        stage = "ANNOTATION_WRITE"
    elif "/export?" in route:
        stage = "TASK_READBACK"
    else:
        stage = "WHOAMI"
    try:
        return transport.api(base, credential, route, body)
    except transport.SetupHold as error:
        raise transport.SetupHold("LIVE_" + stage + "_" + str(error)) from None


def synthetic_tasks() -> list[dict]:
    selection_sha = "sha256:" + hashlib.sha256(b"synthetic-local-api-smoke-1").hexdigest()
    tasks = []
    for n in range(8):
        raw = f"Synthetic {n + 1} — Проверка импорта\nNo real task labels.\n"
        ref = "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()
        tasks.append({"data": {
            "source_text": raw, "source_sha256": ref,
            "source_text_sha256": ref,
            "source_text_origin": "ORIGINAL_UTF8_TEXT_BYTES",
            "source_docx_main_xml_sha256": None, "source_paragraph_locators": [],
            "source_ref": f"https://example.invalid/ci-only/{n+1}",
            "source_edition": "SYNTHETIC_API_SMOKE_ONLY",
            "source_as_of": "2026-11-03",
            "selection_sha256": selection_sha,
        }})
    return tasks


def exercise_local_server(base: str, token: str) -> dict:
    """Real HTTP end-to-end; fail-closed on non-source-first export."""
    base = transport.local_url(base)
    credential = transport.resolve_api_credential(base, token, mode="legacy")
    account = traced_api(base, credential, "/api/current-user/whoami")
    transport.require(type(account) is dict and type(account.get("id")) is int,
                      "LIVE_LABEL_STUDIO_ACCOUNT_NOT_VERIFIED")
    tasks = synthetic_tasks()
    receipt = transport.create_projects(tasks, SYNTHETIC_XML, base, credential, slots=2, call=traced_api)
    project_ids = receipt["project_ids"]
    # No one completed a review. Programmatically exercise annotations so
    # the real API export format, IDs and import round-trip can be checked.
    annotated = 0
    for pid in project_ids:
        exported = traced_api(base, credential,
                                 f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true")
        transport.require(type(exported) is list and len(exported) == 8,
                          "LIVE_LABEL_STUDIO_EXPORT_INCOMPLETE")
        for item in exported:
            task_id = item.get("id") if type(item) is dict else None
            transport.require(type(task_id) is int and task_id > 0,
                              "LIVE_LABEL_STUDIO_TASK_ID_MISSING")
            response = traced_api(base, credential,
                f"/api/tasks/{task_id}/annotations/", {
                    "result": [{"from_name": "review_coverage", "to_name": "source_text",
                                "type": "choices", "value": {
                                    "choices": ["NO_TASK_RELEVANT_SPANS"]}}],
                    "was_cancelled": False,
                })
            transport.require(type(response) is dict and
                              type(response.get("id")) is int,
                              "LIVE_LABEL_STUDIO_ANNOTATION_API_FAILED")
            annotated += 1
    transport.require(annotated == 16, "LIVE_LABEL_STUDIO_ANNOTATION_COUNT_INVALID")
    # Both projects were annotated by the SAME CI account, so the production
    # two-independent-reviewer exporter MUST refuse and emit no export files.
    with tempfile.TemporaryDirectory(prefix="iwxa-ls-native-synthetic-") as directory:
        output_a, output_b = Path(directory) / "a.json", Path(directory) / "b.json"
        try:
            transport.export_reviewed_projects(
                tasks, base, credential, tuple(project_ids), output_a, output_b, call=traced_api)
        except transport.SetupHold as error:
            transport.require(str(error) == "LABEL_STUDIO_SAME_REVIEWER_IN_BOTH_PROJECTS",
                              "LIVE_LABEL_STUDIO_WRONG_EXPORT_REFUSAL")
        else:
            raise transport.SetupHold("LIVE_LABEL_STUDIO_SAME_USER_NOT_REFUSED")
        transport.require(not output_a.exists() and not output_b.exists(),
                          "LIVE_LABEL_STUDIO_UNEXPECTED_REVIEW_EXPORT")
    return {"schema": SCHEMA, "status": "ACTUAL_LABEL_STUDIO_HTTP_ROUNDTRIP_PASS",
            "label_studio_version_expected": "1.23.2",
            "synthetic_projects": 2, "synthetic_sources_per_project": 8,
            "api_created_coverage_annotations": annotated,
            "same_user_export_refused": True,
            "independent_human_review_completed": False,
            "owner_exact_xml_exercised": False,
            "human_task_gold": False,
            "task_precision": None, "task_recall": None, "task_f1": None,
            "raw_sources_in_receipt": False,
            "reviewer_identifiers_in_receipt": False}


def main() -> int:
    try:
        result = exercise_local_server(os.environ.get("LABEL_STUDIO_URL", "http://127.0.0.1:8080"),
                                       os.environ.get("LABEL_STUDIO_API_KEY", ""))
    except transport.SetupHold as error:
        # SetupHold contains only stable refusal/status codes, no source or token.
        print(json.dumps({"status": "HOLD", "code": str(error)}))
        return 2
    except (HTTPError, URLError, OSError, ValueError, TypeError):
        print(json.dumps({"status": "HOLD", "code": "LOCAL_LABEL_STUDIO_LIVE_API_NOT_QUALIFIED"}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
