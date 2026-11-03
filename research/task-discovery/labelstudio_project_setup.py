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
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
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


def read_json(path: Path):
    raw = path.read_bytes()
    require(0 < len(raw) <= MAX_JSON_BYTES, "LOCAL_INPUT_SIZE_INVALID")
    return json.loads(raw)


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


def api(base: str, token: str, route: str, body: object = None):
    payload = (json.dumps(body, ensure_ascii=False).encode("utf-8")
               if body is not None else None)
    req = Request(base + route, data=payload,
                  method="POST" if body is not None else "GET",
                  headers={"Authorization": "Token " + token,
                           "Accept": "application/json",
                           "Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=25) as response:
            raw = response.read(MAX_JSON_BYTES + 1)
            require(response.status in (200, 201, 202) and
                    len(raw) <= MAX_JSON_BYTES, "LABEL_STUDIO_RESPONSE_INVALID")
        return json.loads(raw)
    except HTTPError as error:
        raise SetupHold("LABEL_STUDIO_HTTP_" + str(error.code)) from None
    except URLError:
        raise SetupHold("LOCAL_LABEL_STUDIO_UNAVAILABLE") from None


def create_projects(tasks: list[dict], xml: str, url: str, token: str,
                    *, slots: int = 2, call=api) -> dict:
    """Import and read back two separate blind projects; no human labels made."""
    base = local_url(url)
    require(slots in (1, 2) and bool(token), "PROJECT_SLOTS_OR_TOKEN_MISSING")
    originals = {t["data"]["source_sha256"]: t["data"] for t in tasks}
    require(len(tasks) == len(originals) == 8, "SOURCE_FIRST_IMPORT_INCOMPLETE")
    created = []
    try:
        for slot in range(slots):
            name = "A" if slot == 0 else "B"
            project = call(base, token, "/api/projects/", {
                "title": "IWXA TASK-EXP-01 blind source-first reviewer slot " + name,
                "description": "Exploratory 8 sources. Assign independent human reviewer manually; no method predictions or task gold.",
                "label_config": xml,
            })
            pid = project.get("id") if type(project) is dict else None
            require(type(pid) is int and pid > 0, "LABEL_STUDIO_PROJECT_NOT_CREATED")
            created.append(pid)
            imported = call(base, token,
                            f"/api/projects/{pid}/import?return_task_ids=true", tasks)
            require(type(imported) is dict and imported.get("task_count") == 8 and
                    (imported.get("task_ids") is None or
                     (type(imported["task_ids"]) is list and
                      len(set(imported["task_ids"])) == 8)),
                    "LABEL_STUDIO_IMPORT_COUNT_MISMATCH")
            exported = call(base, token,
                            f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true")
            require(type(exported) is list and len(exported) == 8,
                    "LABEL_STUDIO_READBACK_INCOMPLETE")
            seen = set()
            for record in exported:
                require(type(record) is dict and type(record.get("data")) is dict and
                        record.get("data", {}).get("source_sha256") in originals and
                        record["data"]["source_sha256"] not in seen and
                        record["data"] == originals[record["data"]["source_sha256"]] and
                        not record.get("annotations") and not record.get("predictions"),
                        "LABEL_STUDIO_READBACK_NOT_BLIND_OR_CHANGED")
                seen.add(record["data"]["source_sha256"])
            require(len(seen) == 8, "LABEL_STUDIO_READBACK_INCOMPLETE")
    except SetupHold as error:
        raise SetupHold(str(error), tuple(created)) from None
    return {"schema": SCHEMA, "status": "LOCAL_PROJECTS_CREATED_ALL_SOURCES_UNANNOTATED",
            "reviewer_slots": slots, "project_ids": created,
            "sources_per_project": 8, "human_reviews_completed": 0,
            "reviewer_independence_verified": False, "human_gold": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks", required=True, type=Path,
                        help="Owner-generated restricted labelstudio-import.json")
    parser.add_argument("--owner-label-config", required=True, type=Path,
                        help="Exact original TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml")
    parser.add_argument("--url", default="http://127.0.0.1:8080")
    parser.add_argument("--reviewer-slots", type=int, choices=(1, 2), default=2)
    parser.add_argument("--create-local-projects", action="store_true")
    parser.add_argument("--confirm-local-import", action="store_true")
    args = parser.parse_args()
    try:
        manifest = load_manifest()
        tasks = validate_import(read_json(args.tasks), manifest)
        xml = validate_owner_xml(args.owner_label_config.read_bytes())
        if args.create_local_projects:
            require(args.confirm_local_import, "EXPLICIT_LOCAL_IMPORT_CONFIRMATION_REQUIRED")
            token = os.environ.get("LABEL_STUDIO_API_KEY", "")
            result = create_projects(tasks, xml, args.url, token,
                                     slots=args.reviewer_slots)
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
