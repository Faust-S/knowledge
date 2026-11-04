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
    """Report only fixed stage and bounded synthetic form-validation details."""
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
        if stage == "PROJECT_CREATE":
            # This run uses only a synthetic form and CI account. Capture the
            # exact API validation category, not credentials or source texts.
            from urllib.request import Request, urlopen
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            req = Request(base + route, data=data, method="POST",
                          headers={"Authorization": credential,
                                   "Accept": "application/json",
                                   "Content-Type": "application/json"})
            try:
                with urlopen(req, timeout=25) as response:
                    return json.loads(response.read(1_000_000))
            except HTTPError as error:
                payload = error.read(6000)
                try:
                    parsed = json.loads(payload)
                    detail = {k: str(v)[:350] for k, v in parsed.items()
                              if k in ("detail", "label_config", "validation_errors",
                                       "non_field_errors", "organization", "message")}
                    print(json.dumps({"phase": "LIVE_SYNTHETIC_PROJECT_CREATE",
                                      "status_code": error.code,
                                      "validation_fields": sorted(parsed),
                                      "validation_details": detail}, sort_keys=True))
                except (ValueError, TypeError, AttributeError):
                    print(json.dumps({"phase": "LIVE_SYNTHETIC_PROJECT_CREATE",
                                      "status_code": error.code,
                                      "validation_response_format": "NON_OBJECT"}))
                raise transport.SetupHold("LABEL_STUDIO_HTTP_" + str(error.code)) from None
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


def exercise_local_server(base: str, token: str, *, second_token: str = '') -> dict:
    """Real HTTP end-to-end; fail-closed on non-source-first export."""
    base = transport.local_url(base)
    credential = transport.resolve_api_credential(base, token, mode="legacy")
    account = traced_api(base, credential, "/api/current-user/whoami")
    transport.require(type(account) is dict and type(account.get("id")) is int,
                      "LIVE_LABEL_STUDIO_ACCOUNT_NOT_VERIFIED")
    second_credential = None
    if second_token:
        second_credential = transport.resolve_api_credential(base, second_token, mode="legacy")
        second_account = traced_api(base, second_credential, "/api/current-user/whoami")
        transport.require(type(second_account) is dict and
                          type(second_account.get("id")) is int and
                          second_account["id"] != account["id"],
                          "LIVE_SYNTHETIC_REVIEWER_ACCOUNTS_NOT_DISTINCT")
    tasks = synthetic_tasks()
    receipt = transport.create_projects(tasks, SYNTHETIC_XML, base, credential, slots=2, call=traced_api)
    project_ids = receipt["project_ids"]
    # No one completed a review. Programmatically exercise annotations so
    # the real API export format, IDs and import round-trip can be checked.
    annotated = 0
    for project_index, pid in enumerate(project_ids):
        writer = (second_credential if project_index == 1 and second_credential
                  else credential)
        exported = traced_api(base, credential,
                                 f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true")
        transport.require(type(exported) is list and len(exported) == 8,
                          "LIVE_LABEL_STUDIO_EXPORT_INCOMPLETE")
        for item in exported:
            task_id = item.get("id") if type(item) is dict else None
            transport.require(type(task_id) is int and task_id > 0,
                              "LIVE_LABEL_STUDIO_TASK_ID_MISSING")
            response = traced_api(base, writer,
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
        # Both original synthetic API projects can also be read by the
        # independent-instance transport, without asserting CE isolation.
        single_a, single_b = Path(directory) / "single-a.json", Path(directory) / "single-b.json"
        for index, single_out in enumerate((single_a, single_b)):
            single_receipt = transport.export_single_reviewed_project(
                tasks, base, credential, project_ids[index], single_out,
                expected_xml=SYNTHETIC_XML, call=traced_api)
            transport.require(single_receipt["sources_per_export"] == 8 and
                              single_receipt["human_gold"] is False and
                              single_receipt["platform_isolation_verified"] is False and
                              len(json.loads(single_out.read_text("utf-8"))) == 8,
                              "LIVE_SINGLE_INSTANCE_EXPORT_FAILED")
        if second_credential:
            exported_receipt = transport.export_reviewed_projects(
                tasks, base, credential, tuple(project_ids), output_a, output_b,
                expected_xml=SYNTHETIC_XML, call=traced_api)
            transport.require(exported_receipt["sources_per_export"] == 8 and
                              exported_receipt["reviewer_id_claims_distinct"] is True and
                              exported_receipt["human_gold"] is False and
                              output_a.is_file() and output_b.is_file(),
                              "LIVE_TWO_SYNTHETIC_ACCOUNTS_EXPORT_FAILED")
            for saved in (output_a, output_b):
                records = json.loads(saved.read_text("utf-8"))
                transport.require(len(records) == 8 and
                                  all(len(entry.get("annotations", [])) == 1
                                      for entry in records),
                                  "LIVE_TWO_SYNTHETIC_ACCOUNTS_EXPORT_INCOMPLETE")
        else:
            try:
                transport.export_reviewed_projects(
                    tasks, base, credential, tuple(project_ids), output_a, output_b,
                expected_xml=SYNTHETIC_XML, call=traced_api)
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
            "same_user_export_refused": second_credential is None,
            "single_project_export_http_passed": True,
            "two_synthetic_accounts_export_passed": second_credential is not None,
            "independent_human_review_completed": False,
            "owner_exact_xml_exercised": False,
            "human_task_gold": False,
            "task_precision": None, "task_recall": None, "task_f1": None,
            "raw_sources_in_receipt": False,
            "reviewer_identifiers_in_receipt": False}


def main() -> int:
    try:
        result = exercise_local_server(os.environ.get("LABEL_STUDIO_URL", "http://127.0.0.1:8080"),
                                       os.environ.get("LABEL_STUDIO_API_KEY", ""),
                                       second_token=os.environ.get("LABEL_STUDIO_SECOND_API_KEY", ""))
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
