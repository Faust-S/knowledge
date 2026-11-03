#!/usr/bin/env python3
"""Check the owning TASK-EXP-01 Label Studio UI contract, without annotations.

This is a read-only compatibility gate for an existing owner-controlled XML form.
The independent reviewer work and the E5 import/review bridge stay at Faust-S/iwxa.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import argparse
import sys
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
TASK_EXP_XML_BLOB = "7922b634b145bc064a33f95d04c058d3c5da18f6"
GENERIC_E5_XML_BLOB = "7b82dbd05b4e28c53446d863c5bb48b72245a10d"
LABELS = ("PROCESS", "INDEPENDENT_TASK", "OPERATION", "INSUFFICIENT_EVIDENCE")
REVIEW_COVERAGE = (
    "ALL_RELEVANT_SPANS_MARKED", "NO_TASK_RELEVANT_SPANS", "REVIEW_INCOMPLETE"
)
INTERPRETATION = ("goal", "expected_result", "acceptance_criterion")


class ContractHold(ValueError):
    """A stable non-sensitive failure code."""


def require(ok: bool, code: str) -> None:
    if not ok:
        raise ContractHold(code)


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def check_xml(raw: bytes, *, pinned_blob: str = TASK_EXP_XML_BLOB) -> dict:
    require(isinstance(raw, bytes) and bool(raw), "FORM_EMPTY")
    require(git_blob_sha(raw) == pinned_blob, "TASK_EXP_OWNER_XML_PIN_MISMATCH")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise ContractHold("LABEL_STUDIO_XML_INVALID") from None
    require(root.tag == "View", "NOT_LABEL_STUDIO_VIEW")
    texts = root.findall(".//Text")
    require(len(texts) == 1 and texts[0].get("name") == "source_text"
            and texts[0].get("value") == "$source_text", "SOURCE_TEXT_CONTROL_MISMATCH")
    labels = root.findall(".//Labels")
    require(len(labels) == 1 and labels[0].get("name") == "taskness"
            and labels[0].get("toName") == "source_text" and
            tuple(x.get("value") for x in labels[0].findall("Label")) == LABELS,
            "TASKNESS_LABEL_CONTROL_MISMATCH")
    coverage = root.findall(".//Choices")
    require(len(coverage) == 1 and coverage[0].get("name") == "review_coverage"
            and coverage[0].get("toName") == "source_text" and
            tuple(x.get("value") for x in coverage[0].findall("Choice")) == REVIEW_COVERAGE,
            "SOURCE_REVIEW_COVERAGE_CONTROL_MISMATCH")
    # The owner review_bridge.parse_annotation() REQUIRES all 3 text fields for
    # an INDEPENDENT_TASK. The generic E5 XML does not expose these controls.
    conditional = [v for v in root.findall(".//View")
                   if v.get("visibleWhen") == "region-selected"
                   and v.get("whenTagName") == "source_text"
                   and v.get("whenLabelValue") == "INDEPENDENT_TASK"]
    require(len(conditional) == 1, "INDEPENDENT_TASK_CONDITIONAL_VIEW_MISSING")
    areas = root.findall(".//TextArea")
    require(len(areas) == len(INTERPRETATION)
            and {x.get("name") for x in areas} == set(INTERPRETATION)
            and set(areas) == set(conditional[0].findall("TextArea"))
            and all(x.get("toName") == "source_text" and
                    x.get("perRegion") == "true" and
                    x.get("maxSubmissions") == "1" for x in areas),
            "INDEPENDENT_TASK_INTERPRETATION_CONTROL_MISMATCH")
    return {
        "schema": "IWXA_TASK_EXP_01_EXISTING_LABEL_STUDIO_UI_CONTRACT/0.1",
        "status": "OWNER_UI_FIELDS_COMPATIBLE_NOT_HUMAN_REVIEWED",
        "task_exp_owner_xml_git_blob": git_blob_sha(raw),
        "generic_e5_xml_is_not_this_form": pinned_blob != GENERIC_E5_XML_BLOB,
        "source_text_control": "source_text",
        "taskness_values": list(LABELS),
        "independent_task_fields": list(INTERPRETATION),
        "review_coverage_values": list(REVIEW_COVERAGE),
        "owner_bridge_expected_fields_present": True,
        "label_studio_ui_run": "NOT_RUN",
        "independent_reviewers": 0,
        "human_gold": False,
        "task_precision": None,
        "task_recall": None,
        "task_f1": None,
    }


def check_file(path: Path) -> dict:
    require(path.is_file() and not path.is_symlink(), "OWNER_XML_NOT_AVAILABLE")
    return check_xml(path.read_bytes())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-xml", type=Path, required=True,
                        help="Existing exact TASK-EXP-01 XML in the owner-local checkout")
    args = parser.parse_args()
    try:
        print(json.dumps(check_file(args.owner_xml), sort_keys=True))
        return 0
    except (ContractHold, OSError, ValueError):
        print(json.dumps({"status": "HOLD", "code": "TASK_EXP_LABEL_UI_CONTRACT_UNAVAILABLE"},
                         sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
