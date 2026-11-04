#!/usr/bin/env python3
"""Owner-local Label Studio project setup for preverified TASK-EXP-01 imports.

Transport adapter ONLY. The owning iwxa task_exp_01_labelstudio_import.py
creates and validates the eight blinded tasks; this module never labels,
creates TaskCandidates, scores humans, or copies private evidence to GitHub.
Run on the reviewer's local machine with an existing Label Studio installation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import math
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "task_exp_01_source_metadata.json"
MANIFEST_GIT_BLOB = "4ecaa74522ba1c3fa4e8851e877200c7767ad0de"
OWNER_TASK_EXP_XML_BLOB = "7922b634b145bc064a33f95d04c058d3c5da18f6"
SCHEMA = "IWXA_TASK_EXP_01_LOCAL_LABEL_STUDIO_PROJECT_SETUP/0.1"
SHA256 = re.compile(r"sha256:[0-9a-f]{64}\Z")
ALLOWED_DATA = frozenset((
    "source_text", "source_sha256", "source_text_sha256",
    "source_text_origin", "source_docx_main_xml_sha256",
    "source_paragraph_locators", "source_ref", "source_edition",
    "source_as_of", "selection_sha256",
))
MAX_JSON_BYTES = 1_000_000


class _RejectRedirects(HTTPRedirectHandler):
    # A local Label Studio must not redirect API tokens or protected sources to
    # another endpoint. urllib forwards request headers on HTTP redirects.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# Ignore environment proxy variables even on localhost; all API data must stay
# on the direct loopback connection. Never install this opener globally.
_LOCAL_HTTP_OPENER = build_opener(ProxyHandler({}), _RejectRedirects())


def local_api_open(request: Request, timeout: int):
    return _LOCAL_HTTP_OPENER.open(request, timeout=timeout)


class SetupHold(ValueError):
    """Safe status code; partial project IDs permit cleanup after failure."""

    def __init__(self, code: str, created_project_ids: tuple[int, ...] = ()):
        super().__init__(code)
        self.created_project_ids = created_project_ids


def require(ok: bool, code: str) -> None:
    if not ok:
        raise SetupHold(code)


def git_blob(raw: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


def digest(raw: bytes) -> str:
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def strict_json_bytes(raw: bytes, *, prefix: str):
    """Reject ambiguous JSON from both local files and Label Studio HTTP.

    Duplicate keys and nonfinite numbers otherwise silently alter provenance,
    reviewer identity and annotations. Never include response bytes in errors.
    """
    def unique_pairs(pairs):
        obj = {}
        for key, value in pairs:
            require(key not in obj, prefix + "_DUPLICATE_KEY")
            obj[key] = value
        return obj

    def nonfinite(_value):
        raise SetupHold(prefix + "_NONFINITE_NUMBER")

    def finite_float(value):
        # A valid JSON numeral can overflow a Python float (1e999) and
        # silently become Infinity without invoking parse_constant.
        parsed = float(value)
        require(math.isfinite(parsed), prefix + "_NONFINITE_NUMBER")
        return parsed

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_pairs,
                          parse_constant=nonfinite, parse_float=finite_float)
    except SetupHold:
        raise
    except (UnicodeError, ValueError, RecursionError, TypeError):
        raise SetupHold(prefix + "_JSON_INVALID") from None


def read_json(path: Path):
    """Strict owner-local inputs; never print source contents or file paths."""
    require(path.is_file() and not path.is_symlink(),
            "LOCAL_INPUT_UNAVAILABLE")
    raw = path.read_bytes()
    require(0 < len(raw) <= MAX_JSON_BYTES, "LOCAL_INPUT_SIZE_INVALID")
    return strict_json_bytes(raw, prefix="LOCAL_INPUT")


def load_manifest(path: Path = MANIFEST,
                  expected_git_blob: str = MANIFEST_GIT_BLOB) -> dict:
    raw = path.read_bytes()
    require(git_blob(raw) == expected_git_blob, "FROZEN_SOURCE_MANIFEST_CHANGED")
    manifest = json.loads(raw)
    require(type(manifest) is dict and manifest.get("schema") ==
            "IWXA_TASK_EXP_01_PUBLIC_ISSUE_SOURCE_SLICE/0.1" and
            manifest.get("no_gold") is True and
            type(manifest.get("items")) is list and len(manifest["items"]) == 8,
            "FROZEN_SOURCE_MANIFEST_INVALID")
    return manifest


def validate_owner_xml(raw: bytes,
                       expected_blob: str = OWNER_TASK_EXP_XML_BLOB) -> str:
    require(git_blob(raw) == expected_blob, "TASK_EXP_LABEL_CONFIG_VERSION_CHANGED")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise SetupHold("TASK_EXP_LABEL_CONFIG_INVALID") from None
    require(root.tag == "View" and
            len(root.findall(".//Text[@name='source_text'][@value='$source_text']")) == 1 and
            len(root.findall(".//Labels[@name='taskness'][@toName='source_text']")) == 1 and
            len(root.findall(".//Choices[@name='review_coverage'][@toName='source_text']")) == 1 and
            all(len(root.findall(".//TextArea[@name='%s'][@toName='source_text']" % field)) == 1
                for field in ("goal", "expected_result", "acceptance_criterion")),
            "TASK_EXP_TASK_INTERPRETATION_CONTROLS_MISSING")
    return raw.decode("utf-8")


def validate_import(tasks: object, manifest: dict) -> list[dict]:
    require(type(tasks) is list and len(tasks) == 8,
            "SOURCE_FIRST_IMPORT_REQUIRES_EIGHT")
    originals = {"sha256:" + row["projection_sha256"]: row
                 for row in manifest["items"]}
    require(len(originals) == 8, "FROZEN_SOURCE_DUPLICATE")
    observed = set()
    selection_sha = None
    for task in tasks:
        require(type(task) is dict and set(task) == {"data"} and
                type(task["data"]) is dict and
                set(task["data"]) == ALLOWED_DATA,
                "SOURCE_FIRST_IMPORT_HAS_NON_SOURCE_FIELDS")
        data = task["data"]
        sha, text = data["source_sha256"], data["source_text"]
        record = originals.get(sha) if type(sha) is str else None
        require(record is not None and sha not in observed and
                type(text) is str and digest(text.encode("utf-8")) == sha and
                len(text.encode("utf-8")) == record["projection_bytes"] and
                data["source_ref"] == record["html_url"] and
                data["source_edition"] == record["updated_at"] and
                data["source_as_of"] == record["created_at"][:10] and
                data["source_text_sha256"] == sha and
                data["source_text_origin"] == "ORIGINAL_UTF8_TEXT_BYTES" and
                data["source_docx_main_xml_sha256"] is None and
                data["source_paragraph_locators"] == [] and
                type(data["selection_sha256"]) is str and
                SHA256.fullmatch(data["selection_sha256"]) is not None,
                "SOURCE_FIRST_IMPORT_SOURCE_MISMATCH")
        observed.add(sha)
        if selection_sha is None:
            selection_sha = data["selection_sha256"]
        require(data["selection_sha256"] == selection_sha,
                "SOURCE_FIRST_IMPORT_SELECTION_MISMATCH")
    require(observed == set(originals), "SOURCE_FIRST_IMPORT_INCOMPLETE")
    return tasks


def local_url(base: str) -> str:
    p = urlsplit(base)
    try:
        valid_port = p.port is None or 1 <= p.port <= 65535
    except ValueError:
        valid_port = False
    require(p.scheme == "http" and p.hostname in
            ("localhost", "127.0.0.1", "::1") and valid_port and
            p.username is None and p.password is None and
            p.path in ("", "/") and not p.query and not p.fragment,
            "OWNER_LOCAL_LABEL_STUDIO_URL_REQUIRED")
    return base.rstrip("/")


def resolve_api_credential(base: str, token: str, mode: str = "legacy") -> str:
    """Return a request credential for either Label Studio HTTP API token type.

    Legacy tokens use Token auth; Personal Access Tokens must first be
    exchanged for a short-lived JWT via the *existing* Label Studio API.
    No token is persisted or included in the result receipt.
    """
    base = local_url(base)
    require(type(token) is str and 0 < len(token) <= 8192 and
            "\n" not in token and "\r" not in token,
            "LABEL_STUDIO_API_KEY_MISSING_OR_INVALID")
    require(mode in ("legacy", "personal"), "LABEL_STUDIO_AUTH_MODE_INVALID")
    if mode == "legacy":
        return "Token " + token
    payload = json.dumps({"refresh": token}).encode("utf-8")
    request = Request(base + "/api/token/refresh/", data=payload, method="POST",
                      headers={"Accept": "application/json",
                               "Content-Type": "application/json"})
    try:
        with local_api_open(request, timeout=25) as response:
            raw = response.read(MAX_JSON_BYTES + 1)
            require(response.status in (200, 201) and len(raw) <= MAX_JSON_BYTES,
                    "LABEL_STUDIO_PERSONAL_TOKEN_RESPONSE_INVALID")
        result = strict_json_bytes(raw, prefix="LABEL_STUDIO_PERSONAL_TOKEN_RESPONSE")
        access = result.get("access") if type(result) is dict else None
        require(type(access) is str and 0 < len(access) <= 8192 and
                "\n" not in access and "\r" not in access,
                "LABEL_STUDIO_PERSONAL_TOKEN_RESPONSE_INVALID")
        return "Bearer " + access
    except HTTPError as error:
        raise SetupHold("LABEL_STUDIO_PERSONAL_TOKEN_HTTP_" + str(error.code)) from None
    except URLError:
        raise SetupHold("LOCAL_LABEL_STUDIO_UNAVAILABLE") from None
    except SetupHold:
        # SetupHold subclasses ValueError: preserve precise strict-JSON codes
        # instead of collapsing duplicate/nonfinite responses to INVALID.
        raise
    except (ValueError, UnicodeError):
        raise SetupHold("LABEL_STUDIO_PERSONAL_TOKEN_RESPONSE_INVALID") from None


def api(base: str, token: str, route: str, body: object = None):
    base = local_url(base)
    payload = (json.dumps(body, ensure_ascii=False).encode("utf-8")
               if body is not None else None)
    authorization = token if token.startswith(("Token ", "Bearer ")) else "Token " + token
    req = Request(base + route, data=payload,
                  method="POST" if body is not None else "GET",
                  headers={"Authorization": authorization,
                           "Accept": "application/json",
                           "Content-Type": "application/json"})
    try:
        with local_api_open(req, timeout=25) as response:
            raw = response.read(MAX_JSON_BYTES + 1)
            require(response.status in (200, 201, 202) and
                    len(raw) <= MAX_JSON_BYTES, "LABEL_STUDIO_RESPONSE_INVALID")
        return strict_json_bytes(raw, prefix="LABEL_STUDIO_RESPONSE")
    except HTTPError as error:
        raise SetupHold("LABEL_STUDIO_HTTP_" + str(error.code)) from None
    except URLError:
        raise SetupHold("LOCAL_LABEL_STUDIO_UNAVAILABLE") from None


def same_review_form(expected: str, saved: object) -> bool:
    """Compare actual persisted Label Studio form, ignoring only formatting.

    Preserve control order, text values and attributes. Cosmetic XML
    indentation is not a different reviewer form, but missing task fields are.
    """
    if type(saved) is not str:
        return False
    try:
        def signature(node):
            return (node.tag, tuple(sorted(node.attrib.items())),
                    (node.text or "").strip(),
                    tuple(signature(child) for child in node))
        return signature(ET.fromstring(expected)) == signature(ET.fromstring(saved))
    except (ET.ParseError, TypeError, ValueError):
        return False


def _blind_project_readback(exported: object, originals: dict[str, dict]) -> None:
    """Confirm every imported source is unchanged and has no review content."""
    require(type(exported) is list and len(exported) == 8,
            "LABEL_STUDIO_READBACK_INCOMPLETE")
    seen = set()
    for record in exported:
        require(type(record) is dict and type(record.get("data")) is dict and
                record["data"].get("source_sha256") in originals and
                record["data"]["source_sha256"] not in seen and
                record["data"] == originals[record["data"]["source_sha256"]] and
                not record.get("annotations") and not record.get("predictions"),
                "LABEL_STUDIO_READBACK_NOT_BLIND_OR_CHANGED")
        seen.add(record["data"]["source_sha256"])
    require(seen == set(originals), "LABEL_STUDIO_READBACK_INCOMPLETE")


def create_projects(tasks: list[dict], xml: str, url: str, token: str,
                    *, slots: int = 1, call=api) -> dict:
    """Import one source-first review project per isolated owner-local instance.

    Two slots remain explicit for legacy synthetic transport QA; two projects
    in one CE organization do not provide blind human-review isolation.
    """
    base = local_url(url)
    require(slots in (1, 2) and bool(token), "PROJECT_SLOTS_OR_TOKEN_MISSING")
    originals = {t["data"]["source_sha256"]: t["data"] for t in tasks}
    require(len(tasks) == len(originals) == 8, "SOURCE_FIRST_IMPORT_INCOMPLETE")
    created = []
    try:
        for slot in range(slots):
            name = "A" if slot == 0 else "B"
            project = call(base, token, "/api/projects/", {
                "title": "IWXA TASK-EXP-01 reviewer " + name,
                "description": "Exploratory 8 sources. Assign independent human reviewer manually; no method predictions or task gold.",
                "label_config": xml,
            })
            pid = project.get("id") if type(project) is dict else None
            require(type(pid) is int and pid > 0, "LABEL_STUDIO_PROJECT_NOT_CREATED")
            created.append(pid)
            # The form visible in the actual project must be the reviewed
            # owner form, not a server default or a truncated generic E5 form.
            persisted = call(base, token, f"/api/projects/{pid}/")
            require(type(persisted) is dict and persisted.get("id") == pid and
                    same_review_form(xml, persisted.get("label_config")),
                    "LABEL_STUDIO_SAVED_REVIEW_FORM_CHANGED")
            imported = call(base, token,
                            f"/api/projects/{pid}/import?return_task_ids=true", tasks)
            require(type(imported) is dict and imported.get("task_count") == 8 and
                    (imported.get("task_ids") is None or
                     (type(imported["task_ids"]) is list and
                      len(set(imported["task_ids"])) == 8)),
                    "LABEL_STUDIO_IMPORT_COUNT_MISMATCH")
            exported = call(base, token,
                            f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true")
            _blind_project_readback(exported, originals)
    except SetupHold as error:
        raise SetupHold(str(error), tuple(created)) from None
    return {"schema": SCHEMA, "status": "LOCAL_PROJECTS_CREATED_ALL_SOURCES_UNANNOTATED",
            "reviewer_slots": slots, "project_ids": created,
            "sources_per_project": 8, "persisted_review_form_checked": True,
            "human_reviews_completed": 0,
            "reviewer_independence_verified": False, "human_gold": False}



def verify_isolated_reviewers(url_a: str, token_a: str,
                              url_b: str, token_b: str, *, call=api) -> dict:
    """Reusable read-only account boundary for local independent review.

    Distinct account claims plus denied cross-auth are a technical gate, not
    evidence of separate storage, independent humans or an accepted task gold.
    """
    a, b = local_url(url_a), local_url(url_b)
    port_a = urlsplit(a).port or 80
    port_b = urlsplit(b).port or 80
    require(port_a != port_b, "ISOLATED_REVIEW_REQUIRES_DISTINCT_LOCAL_PORTS")
    require(type(token_a) is str and type(token_b) is str and
            bool(token_a) and bool(token_b) and token_a != token_b,
            "ISOLATED_REVIEW_CREDENTIALS_INVALID_OR_REUSED")
    ids = []
    for base, token in ((a, token_a), (b, token_b)):
        account = call(base, token, "/api/current-user/whoami")
        ident = account.get("id") if type(account) is dict else None
        require(type(ident) is int and ident > 0,
                "ISOLATED_REVIEW_ACCOUNT_NOT_VERIFIED")
        ids.append(ident)
    require(ids[0] != ids[1], "ISOLATED_NATIVE_REVIEWER_IDS_COLLIDE")
    for base, token in ((a, token_b), (b, token_a)):
        try:
            call(base, token, "/api/current-user/whoami")
        except SetupHold as error:
            require(str(error) in ("LABEL_STUDIO_HTTP_401",
                                   "LABEL_STUDIO_HTTP_403"),
                    "ISOLATED_REVIEW_CROSS_AUTH_NOT_PROVEN")
        else:
            raise SetupHold("ISOLATED_REVIEW_CROSS_ACCOUNT_ACCESSIBLE")
    return {
        "schema": SCHEMA,
        "status": "TWO_LOCAL_REVIEW_ACCOUNTS_API_PREFLIGHT_PASS_NOT_HUMAN_GOLD",
        "cross_instance_credentials_rejected": True,
        "reviewer_id_claims_distinct": True,
        "platform_storage_isolation_verified": False,
        "human_gold": False,
    }


def isolated_review_preflight(
        tasks: list[dict], xml: str,
        url_a: str, token_a: str, project_a: int,
        url_b: str, token_b: str, project_b: int, *, call=api) -> dict:
    """Read-only pre-human project/form/source gate on top of account preflight."""
    a, b = local_url(url_a), local_url(url_b)
    require(type(project_a) is int and project_a > 0 and
            type(project_b) is int and project_b > 0 and
            type(xml) is str and bool(xml),
            "ISOLATED_REVIEW_PREFLIGHT_ARGUMENTS_INVALID")
    # Shared account check, including cross-credential rejection. Never infer
    # cross-instance storage isolation merely from distinct account IDs.
    verify_isolated_reviewers(a, token_a, b, token_b, call=call)
    originals = {t["data"]["source_sha256"]: t["data"] for t in tasks}
    require(len(originals) == len(tasks) == 8, "SOURCE_FIRST_IMPORT_INCOMPLETE")
    for base, token, pid in ((a, token_a, project_a), (b, token_b, project_b)):
        saved = call(base, token, f"/api/projects/{pid}/")
        require(type(saved) is dict and saved.get("id") == pid and
                same_review_form(xml, saved.get("label_config")),
                "ISOLATED_REVIEW_SAVED_FORM_MISMATCH")
        exported = call(base, token,
                        f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true")
        _blind_project_readback(exported, originals)

    for base, foreign_token, pid in ((a, token_b, project_a),
                                     (b, token_a, project_b)):
        try:
            call(base, foreign_token,
                 f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true")
        except SetupHold as error:
            # A 404 is not evidence of authorization denial. It could be a
            # wrong API route/project, masking a broken preflight.
            require(str(error) in ("LABEL_STUDIO_HTTP_401",
                                   "LABEL_STUDIO_HTTP_403"),
                    "ISOLATED_REVIEW_CROSS_ACCESS_UNEXPECTED_ERROR")
        else:
            raise SetupHold("ISOLATED_REVIEW_CROSS_ACCESS_EXPOSED")
    return {
        "schema": SCHEMA,
        "status": "TWO_LOCAL_REVIEW_INSTANCES_API_PREFLIGHT_PASS_NOT_HUMAN_GOLD",
        "sources_each": 8, "persisted_owner_forms_checked": True,
        "unannotated_original_sources_checked": True,
        "cross_instance_identity_and_export_denied": True,
        "account_id_claims_differ": True,
        "human_independence_verified": False,
        "environmental_isolation_independently_verified": False,
        "human_gold": False, "adjudication_completed": False,
        "task_precision": None, "task_recall": None, "task_f1": None,
    }


def _checked_project_export(tasks: list[dict], base: str, token: str,
                            pid: int, *, expected_xml: str, call=api) -> tuple[list[dict], str]:
    """Recheck persisted reviewer form before exporting source-first records.

    The owner bridge alone judges review semantics; this transport refuses
    exports produced after a project form drifted from the frozen owner XML.
    """
    require(type(pid) is int and pid > 0, "REVIEW_PROJECT_ID_INVALID")
    require(type(expected_xml) is str and bool(expected_xml),
            "LABEL_STUDIO_EXPORT_EXPECTED_REVIEW_FORM_MISSING")
    persisted = call(base, token, f"/api/projects/{pid}/")
    require(type(persisted) is dict and persisted.get("id") == pid and
            same_review_form(expected_xml, persisted.get("label_config")),
            "LABEL_STUDIO_EXPORT_REVIEW_FORM_CHANGED")
    originals = {task["data"]["source_sha256"]: task["data"] for task in tasks}
    require(len(originals) == len(tasks) == 8, "SOURCE_FIRST_IMPORT_INCOMPLETE")
    exported = call(base, token,
                    f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true")
    require(type(exported) is list and len(exported) == 8,
            "LABEL_STUDIO_REVIEW_EXPORT_INCOMPLETE")
    found = set()
    ids = set()
    for record in exported:
        require(type(record) is dict and type(record.get("data")) is dict and
                not record.get("predictions") and
                type(record.get("annotations")) is list and
                len(record["annotations"]) == 1,
                "LABEL_STUDIO_REVIEW_EXPORT_NOT_SINGLE_COMPLETE")
        data = record["data"]
        source = data.get("source_sha256")
        require(source in originals and source not in found and
                data == originals[source],
                "LABEL_STUDIO_REVIEW_SOURCE_MISMATCH")
        found.add(source)
        review = record["annotations"][0]
        require(type(review) is dict and
                review.get("was_cancelled") is not True and
                type(review.get("result")) is list,
                "LABEL_STUDIO_REVIEW_UNFINISHED")
        # Minimal transport completeness required by the existing owner
        # Review Bridge: every source must explicitly record a final coverage
        # decision. An annotation with result=[] is not a completed review.
        # The owning bridge still judges labels, regions and Task semantics.
        coverage = [row for row in review["result"]
                    if type(row) is dict and
                    row.get("from_name") == "review_coverage"]
        require(len(coverage) == 1 and
                coverage[0].get("to_name") == "source_text" and
                coverage[0].get("type") == "choices" and
                type(coverage[0].get("value")) is dict and
                coverage[0]["value"].get("choices") in
                (["ALL_RELEVANT_SPANS_MARKED"], ["NO_TASK_RELEVANT_SPANS"]),
                "LABEL_STUDIO_REVIEW_COVERAGE_NOT_FINAL")
        reviewer = review.get("completed_by")
        if type(reviewer) is dict:
            reviewer = reviewer.get("id")
        require(type(reviewer) in (int, str) and
                (type(reviewer) is not int or reviewer > 0) and
                bool(str(reviewer).strip()),
                "LABEL_STUDIO_REVIEWER_IDENTIFIER_MISSING")
        ids.add(str(reviewer))
    require(found == set(originals) and len(ids) == 1,
            "LABEL_STUDIO_REVIEW_SOURCE_OR_REVIEWER_SET_MISMATCH")
    return exported, next(iter(ids))


def _write_restricted_exports(exports: tuple[tuple[Path, list[dict]], ...]) -> None:
    """Write verified exports only; remove partial files after write errors."""
    created = []
    try:
        for path, records in exports:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(path)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(records, stream, ensure_ascii=False, sort_keys=True)
                stream.write("\n")
    except (OSError, UnicodeError, ValueError, TypeError):
        for path in created:
            path.unlink(missing_ok=True)
        raise SetupHold("REVIEW_OUTPUT_WRITE_FAILED") from None


def review_progress(tasks: list[dict], url: str, token: str, pid: int, *,
                    expected_xml: str, call=api) -> dict:
    """Source-safe, read-only M3 progress for one isolated reviewer.

    Count coverage, not human gold or semantic correctness. The original
    owner bridge remains responsible for interpreting all region labels.
    No source text, identities, annotation data, or individual source refs
    appear in the result.
    """
    base = local_url(url)
    require(bool(token) and type(pid) is int and pid > 0 and
            type(expected_xml) is str and bool(expected_xml),
            "REVIEW_PROGRESS_ARGUMENTS_INVALID")
    originals = {task["data"]["source_sha256"]: task["data"] for task in tasks}
    require(len(tasks) == len(originals) == 8,
            "SOURCE_FIRST_IMPORT_INCOMPLETE")
    project = call(base, token, f"/api/projects/{pid}/")
    require(type(project) is dict and project.get("id") == pid and
            same_review_form(expected_xml, project.get("label_config")),
            "REVIEW_PROGRESS_OWNER_FORM_CHANGED")
    who = call(base, token, "/api/current-user/whoami")
    reviewer_id = who.get("id") if type(who) is dict else None
    require(type(reviewer_id) is int and reviewer_id > 0,
            "REVIEW_PROGRESS_ACCOUNT_NOT_VERIFIED")
    exported = call(base, token,
                    f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true")
    require(type(exported) is list and len(exported) == 8,
            "REVIEW_PROGRESS_SOURCE_SET_INCOMPLETE")
    found = set()
    unannotated = nonfinal = final = 0
    for row in exported:
        require(type(row) is dict and type(row.get("data")) is dict and
                type(row.get("annotations")) is list and
                not row.get("predictions") and len(row["annotations"]) <= 1,
                "REVIEW_PROGRESS_EXPORT_AMBIGUOUS")
        data = row["data"]
        sha = data.get("source_sha256")
        require(type(sha) is str and sha in originals and sha not in found and
                data == originals[sha],
                "REVIEW_PROGRESS_SOURCE_MISMATCH")
        found.add(sha)
        if not row["annotations"]:
            unannotated += 1
            continue
        ann = row["annotations"][0]
        ident = ann.get("completed_by") if type(ann) is dict else None
        if type(ident) is dict:
            ident = ident.get("id")
        require(type(ident) in (int, str) and type(ident) is not bool and
                str(ident) == str(reviewer_id),
                "REVIEW_PROGRESS_FOREIGN_ANNOTATOR")
        require(type(ann.get("result")) is list,
                "REVIEW_PROGRESS_ANNOTATION_MALFORMED")
        coverage = [part for part in ann["result"]
                    if type(part) is dict and
                    part.get("from_name") == "review_coverage"]
        require(len(coverage) <= 1, "REVIEW_PROGRESS_DUPLICATE_COVERAGE")
        if not coverage or ann.get("was_cancelled") is True:
            nonfinal += 1
            continue
        entry = coverage[0]
        valid = (entry.get("to_name") == "source_text" and
                 entry.get("type") == "choices" and
                 type(entry.get("value")) is dict and
                 entry["value"].get("choices") in
                 (["ALL_RELEVANT_SPANS_MARKED"], ["NO_TASK_RELEVANT_SPANS"]))
        if valid:
            final += 1
        else:
            nonfinal += 1
    require(found == set(originals), "REVIEW_PROGRESS_SOURCE_SET_INCOMPLETE")
    return {
        "schema": SCHEMA,
        "status": ("REVIEW_FINAL_COVERAGE_RECORDED_NOT_GOLD" if final == 8
                   else "REVIEW_COVERAGE_PARTIAL_NOT_GOLD"),
        "sources_checked": 8,
        "sources_unannotated": unannotated,
        "sources_with_nonfinal_annotation": nonfinal,
        "sources_with_final_coverage": final,
        "review_export_readiness": "COVERAGE_ONLY_NOT_OWNER_BRIDGE_QUALIFIED",
        "original_reviewer_id_exposed": False,
        "original_source_text_exposed": False,
        "reviewer_independence_verified": False,
        "human_gold": False,
    }


def export_single_reviewed_project(tasks: list[dict], url: str, token: str,
                                   pid: int, output: Path, *,
                                   expected_xml: str, call=api) -> dict:
    """Export one isolated CE installation, without claiming human independence."""
    base = local_url(url)
    require(bool(token) and type(pid) is int and pid > 0,
            "SINGLE_REVIEW_PROJECT_OR_TOKEN_MISSING")
    require(not output.exists() and not output.is_symlink(),
            "REVIEW_OUTPUT_PATHS_MUST_BE_NEW_AND_DISTINCT")
    data, reviewer = _checked_project_export(
        tasks, base, token, pid, expected_xml=expected_xml, call=call)
    # With isolated owner-local installations, export as the reviewer who
    # actually annotated. Distinct numeric IDs alone are not enough: the
    # source-bound annotations must match the currently authenticated user.
    # The check is performed before writing any protected export.
    account = call(base, token, "/api/current-user/whoami")
    actual_id = account.get("id") if type(account) is dict else None
    require(type(actual_id) is int and actual_id > 0 and
            str(actual_id) == reviewer,
            "SINGLE_REVIEW_EXPORT_AUTHOR_AUTH_MISMATCH")
    _write_restricted_exports(((output, data),))
    return {"schema": SCHEMA,
            "status": "ONE_OWNER_LOCAL_REVIEW_EXPORT_READY_FOR_OWNER_BRIDGE",
            "annotation_author_matches_authenticated_account": True,
            "project_id": pid, "sources_per_export": 8,
            "reviewer_id_claim_present": bool(reviewer),
            "reviewer_independence_verified": False,
            "platform_isolation_verified": False, "human_gold": False,
            "adjudication_completed": False,
            "task_precision": None, "task_recall": None, "task_f1": None}


def export_reviewed_projects(tasks: list[dict], url: str, token: str,
                             project_ids: tuple[int, int],
                             output_a: Path, output_b: Path, *,
                             expected_xml: str, call=api) -> dict:
    """Legacy same-server transport; distinct accounts alone are not blind."""
    base = local_url(url)
    require(bool(token) and type(project_ids) is tuple and
            len(project_ids) == 2 and
            all(type(pid) is int and pid > 0 for pid in project_ids) and
            project_ids[0] != project_ids[1], "TWO_DISTINCT_PROJECT_IDS_REQUIRED")
    require(output_a != output_b and
            not output_a.exists() and not output_b.exists() and
            not output_a.is_symlink() and not output_b.is_symlink(),
            "REVIEW_OUTPUT_PATHS_MUST_BE_NEW_AND_DISTINCT")
    collected = []
    reviewer_ids = []
    for pid in project_ids:
        export, reviewer = _checked_project_export(
            tasks, base, token, pid, expected_xml=expected_xml, call=call)
        collected.append(export)
        reviewer_ids.append(reviewer)
    require(len(set(reviewer_ids)) == 2,
            "LABEL_STUDIO_SAME_REVIEWER_IN_BOTH_PROJECTS")
    _write_restricted_exports(((output_a, collected[0]), (output_b, collected[1])))
    return {"schema": SCHEMA, "status": "TWO_OWNER_LOCAL_REVIEW_EXPORTS_READY_FOR_OWNER_BRIDGE",
            "project_ids": list(project_ids), "sources_per_export": 8,
            "reviewer_id_claims_distinct": True,
            "reviewer_independence_verified": False,
            "platform_isolation_verified": False,
            "human_gold": False, "adjudication_completed": False,
            "task_precision": None, "task_recall": None, "task_f1": None}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks", required=True, type=Path,
                        help="Owner-generated restricted labelstudio-import.json")
    parser.add_argument("--owner-label-config", required=True, type=Path,
                        help="Exact original TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml")
    parser.add_argument("--url", default="http://127.0.0.1:8080")
    parser.add_argument("--auth-mode", choices=("legacy", "personal"),
                        default="legacy",
                        help="Personal Access Token requires JWT refresh; legacy mode kept for old setups")
    parser.add_argument("--reviewer-slots", type=int, choices=(1, 2), default=1,
                        help="One per isolated instance (default); two only for synthetic transport QA")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--create-local-projects", action="store_true")
    mode.add_argument("--export-reviewed-projects", action="store_true")
    mode.add_argument("--export-single-reviewed-project", action="store_true")
    mode.add_argument("--preflight-isolated-reviewers", action="store_true")
    mode.add_argument("--review-progress", action="store_true",
                      help="Read-only 8-source coverage counts; never human gold")
    parser.add_argument("--project-id", type=int)
    parser.add_argument("--other-url")
    parser.add_argument("--other-project-id", type=int)
    parser.add_argument("--other-auth-mode", choices=("legacy", "personal"), default="legacy")
    parser.add_argument("--review-out", type=Path)
    parser.add_argument("--project-a-id", type=int)
    parser.add_argument("--project-b-id", type=int)
    parser.add_argument("--review-a-out", type=Path)
    parser.add_argument("--review-b-out", type=Path)
    parser.add_argument("--confirm-local-import", action="store_true")
    args = parser.parse_args()
    try:
        manifest = load_manifest()
        tasks = validate_import(read_json(args.tasks), manifest)
        xml = validate_owner_xml(args.owner_label_config.read_bytes())
        # One CE instance exposes all its projects to local users.
        # Do not present the synthetic two-project transport as human blinding.
        require(args.reviewer_slots == 1, "M3_TWO_PROJECTS_IN_ONE_CE_NOT_BLIND")
        if args.create_local_projects:
            require(args.confirm_local_import, "EXPLICIT_LOCAL_IMPORT_CONFIRMATION_REQUIRED")
            token = resolve_api_credential(args.url,
                                           os.environ.get("LABEL_STUDIO_API_KEY", ""),
                                           mode=args.auth_mode)
            result = create_projects(tasks, xml, args.url, token,
                                     slots=args.reviewer_slots)
        elif args.preflight_isolated_reviewers:
            require(not args.confirm_local_import and
                    args.project_id is not None and args.other_project_id is not None and
                    args.other_url is not None and
                    args.review_out is None and args.review_a_out is None and
                    args.review_b_out is None and
                    args.project_a_id is None and args.project_b_id is None,
                    "ISOLATED_REVIEW_PREFLIGHT_ARGUMENTS_INCOMPLETE")
            own_token = resolve_api_credential(
                args.url, os.environ.get("LABEL_STUDIO_API_KEY", ""),
                mode=args.auth_mode)
            other_token = resolve_api_credential(
                args.other_url, os.environ.get("LABEL_STUDIO_SECOND_API_KEY", ""),
                mode=args.other_auth_mode)
            result = isolated_review_preflight(
                tasks, xml, args.url, own_token, args.project_id,
                args.other_url, other_token, args.other_project_id)
        elif args.review_progress:
            require(not args.confirm_local_import and
                    args.project_id is not None and
                    args.other_url is None and args.other_project_id is None and
                    args.project_a_id is None and args.project_b_id is None and
                    args.review_out is None and args.review_a_out is None and
                    args.review_b_out is None,
                    "REVIEW_PROGRESS_ARGUMENTS_INCOMPLETE")
            token = resolve_api_credential(
                args.url, os.environ.get("LABEL_STUDIO_API_KEY", ""),
                mode=args.auth_mode)
            result = review_progress(
                tasks, args.url, token, args.project_id, expected_xml=xml)
        elif args.export_single_reviewed_project:
            require(not args.confirm_local_import and
                    args.project_id is not None and args.review_out is not None and
                    args.project_a_id is None and args.project_b_id is None and
                    args.review_a_out is None and args.review_b_out is None,
                    "SINGLE_REVIEW_EXPORT_ARGUMENTS_INCOMPLETE")
            token = resolve_api_credential(args.url,
                                           os.environ.get("LABEL_STUDIO_API_KEY", ""),
                                           mode=args.auth_mode)
            result = export_single_reviewed_project(
                tasks, args.url, token, args.project_id, args.review_out,
                expected_xml=xml)
        elif args.export_reviewed_projects:
            # Keep the paired function only for CI transport QA. Genuine M3
            # runs require single exports from isolated reviewer instances.
            raise SetupHold("M3_SAME_SERVER_PAIRED_EXPORT_NOT_BLIND")
        else:
            require(not args.confirm_local_import,
                    "IMPORT_CONFIRMATION_WITHOUT_CREATE_MODE")
            result = {"schema": SCHEMA, "status": "LOCAL_SOURCE_FIRST_IMPORT_READY",
                      "sources": 8, "reviewer_slots_planned": args.reviewer_slots,
                      "owner_label_config_git_blob": OWNER_TASK_EXP_XML_BLOB,
                      "human_gold": False}
    except SetupHold as error:
        print(json.dumps({"status": "HOLD", "code": str(error),
                          "created_project_ids": list(error.created_project_ids)},
                         sort_keys=True))
        return 2
    except (OSError, ValueError, KeyError, TypeError, UnicodeError):
        print(json.dumps({"status": "HOLD", "code": "OWNER_LOCAL_IMPORT_INPUT_INVALID"}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
