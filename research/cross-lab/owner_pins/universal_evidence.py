#!/usr/bin/env python3
"""IWXA Engine E1/U1: offline, non-authoritative multi-source evidence intake.

Does not read/write the canonical task catalog, connect to networks, authenticate
reviewers, recognize source truth, or decide that a process step is a TaskType.
Raw content stays in its local owner-controlled input file; receipts omit content.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path
from typing import Any

VERSION = "IWXA_ENGINE_UNIVERSAL_EVIDENCE/0.1"
MAX_BYTES = 4 * 1024 * 1024
MAX_UNITS = 10_000
MAX_LINE = 128 * 1024
BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL"
SOURCE_KINDS = frozenset({
    "PUBLIC_DOCUMENT_UTF8", "CORPORATE_DOCUMENT_UTF8", "GOVERNMENT_DOCUMENT_UTF8",
    "PERSONAL_NOTE_UTF8", "INTERVIEW_TRANSCRIPT_UTF8",
    "EVENT_LOG_JSONL", "PROCESS_BPMN_XML",
})
TEXT_KINDS = frozenset({
    "PUBLIC_DOCUMENT_UTF8", "CORPORATE_DOCUMENT_UTF8", "GOVERNMENT_DOCUMENT_UTF8",
    "PERSONAL_NOTE_UTF8", "INTERVIEW_TRANSCRIPT_UTF8",
})
PROCESS_NODES = frozenset({
    "task", "userTask", "manualTask", "serviceTask", "scriptTask",
    "businessRuleTask", "sendTask", "receiveTask",
})
SOURCE_KEYS = frozenset({
    "schema", "kind", "owner_ref", "jurisdiction", "as_of", "retention_until",
    "purpose", "disclosure", "access_basis", "authorization_ref",
    "permission_asserted", "authorized_actions", "revocation_status",
    "sha256", "source_reference",
})
OBS_KEYS = frozenset({
    "subject_line", "actor_role", "principal_role", "trigger", "goal",
    "result", "object", "interpretation", "evidence_ids", "caveat",
})
SUBJECT_LINES = frozenset({"Personal", "Corporate", "Operator", "Institutional/Public",
                           "UNDETERMINED"})

# A small deterministic, read-only bootstrap for corpus creation. These rules
# are NOT a general language understanding model or independently validated
# Task Discovery. They highlight source lines that merit human review.
REVIEW_HINT_VERSION = "IWXA_U1_REVIEW_HINTS_RESEARCH/0.1"
MAX_REVIEW_HINTS = 80
MAX_HINT_LINE_CHARS = 4096
_EXPLICIT_RU = re.compile(
    r"\b(?:нужно|надо|необходимо|следует|требуется|хочу|планирую)"
    r"\s+(?:срочно\s+|сначала\s+)?[а-яё-]{2,}(?:ть|ться|ти|чь)\b", re.IGNORECASE)
_EXPLICIT_EN = re.compile(
    r"\b(?:need\s+to|have\s+to|must|should|plan\s+to|want\s+to)"
    r"\s+[a-z][a-z-]*\b", re.IGNORECASE)
_PROBLEM_RU = re.compile(
    r"\b(?:не\s+(?:работает|удалось|получилось|пришло|доставлено|сработало|хватает)"
    r"|задержива(?:ется|ются|лись|лась|лся)|задержал[а-яё]*"
    r"|пропустил[а-яё]*|просрочил[а-яё]*|опоздал[а-яё]*"
    r"|ошибк[а-яё]*|сбо[йяе]|позже\s+(?:запланированного\s+)?срока)\b",
    re.IGNORECASE)
_PROBLEM_EN = re.compile(
    r"\b(?:failed\s+to|not\s+working|does\s+not\s+work|doesn't\s+work"
    r"|missing\s+result|not\s+added|no\s+document\s+is\s+added"
    r"|overdue|delayed|deadline\s+missed|reject(?:s|ed|ing)?|error)\b",
    re.IGNORECASE)
_CANCEL_ACTION = re.compile(
    r"\b(?:не\s+(?:нужно|надо|требуется|следует)|нет\s+необходимости"
    r"|no\s+need\s+to|do\s+not\s+need\s+to|don't\s+need\s+to)\b",
    re.IGNORECASE)
_CANCEL_PROBLEM = re.compile(
    r"\b(?:нет|без)\s+(?:ошиб[а-яё]*|задерж[а-яё]*|сбо[а-яё]*)\b",
    re.IGNORECASE)


class Rejected(ValueError):
    """A fail-closed rejection. Do not attach raw input or private exception text."""


def require(ok: bool, code: str) -> None:
    if not ok:
        raise Rejected(code)


def strict_json(data: bytes) -> Any:
    def no_duplicate(pairs):
        result = {}
        for k, v in pairs:
            require(k not in result, "JSON_DUPLICATE_KEY")
            result[k] = v
        return result

    def no_constant(_value):
        raise Rejected("JSON_NONFINITE_NUMBER")

    try:
        return json.loads(data.decode("utf-8", "strict"), object_pairs_hook=no_duplicate,
                          parse_constant=no_constant)
    except Rejected:
        raise
    except (UnicodeError, json.JSONDecodeError, ValueError, RecursionError):
        raise Rejected("INVALID_UTF8_OR_JSON") from None


def canonical(obj: object) -> bytes:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def identifier(prefix: str, obj: object) -> str:
    return prefix + sha(canonical(obj))[:32]


def shape(obj: object, keys: frozenset, label: str) -> dict:
    require(type(obj) is dict and set(obj) == keys, label + "_FIELDS_INVALID")
    return obj


def nonempty(v: Any, label: str, max_chars: int = 512) -> str:
    require(type(v) is str and 0 < len(v.strip()) <= max_chars and
            not any(ord(ch) < 32 for ch in v), label + "_INVALID")
    return v


def day(v: Any, label: str) -> date:
    require(type(v) is str and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", v)),
            label + "_DATE_INVALID")
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise Rejected(label + "_DATE_INVALID") from None


def validate_source(raw: bytes, manifest: dict, *, today: date | None = None) -> dict:
    """Check a local evidence claim. SHA proves byte equality, not publisher origin."""
    m = shape(manifest, SOURCE_KEYS, "SOURCE")
    require(m["schema"] == VERSION, "SOURCE_SCHEMA_UNSUPPORTED")
    require(type(m["kind"]) is str and m["kind"] in SOURCE_KINDS, "SOURCE_KIND_UNSUPPORTED")
    require(type(raw) is bytes and 0 < len(raw) <= MAX_BYTES, "SOURCE_SIZE_INVALID")
    nonempty(m["owner_ref"], "OWNER_REF", 150)
    nonempty(m["jurisdiction"], "JURISDICTION", 64)
    nonempty(m["source_reference"], "SOURCE_REFERENCE", 500)
    nonempty(m["authorization_ref"], "AUTHORIZATION_REF", 200)
    require(m["purpose"] == "ENGINE_RESEARCH_AND_TEST", "PURPOSE_NOT_ALLOWED")
    require(type(m["disclosure"]) is str and m["disclosure"] in {"PUBLIC", "CONFIDENTIAL", "PERSONAL", "REGULATED"},
            "DISCLOSURE_INVALID")
    require(type(m["access_basis"]) is str and m["access_basis"] in {"PUBLIC_REUSE_CLAIM", "OWNER_AUTHORIZATION_CLAIM",
                                  "PARTICIPANT_CONSENT_CLAIM", "INTERNAL_MANDATE_CLAIM"},
            "ACCESS_BASIS_INVALID")
    require(m["permission_asserted"] is True, "PERMISSION_NOT_ASSERTED")
    require(m["authorized_actions"] == ["LOCAL_ANALYSIS"], "ACTIONS_NOT_ALLOWED")
    require(m["revocation_status"] == "ACTIVE", "ACCESS_REVOKED_OR_UNKNOWN")
    if m["kind"] in {"PERSONAL_NOTE_UTF8", "INTERVIEW_TRANSCRIPT_UTF8"}:
        require(m["access_basis"] in {"OWNER_AUTHORIZATION_CLAIM", "PARTICIPANT_CONSENT_CLAIM"},
                "PERSONAL_CONSENT_CLAIM_REQUIRED")
        require(m["disclosure"] in {"PERSONAL", "CONFIDENTIAL"}, "PERSONAL_SCOPE_INVALID")
    if m["kind"] == "GOVERNMENT_DOCUMENT_UTF8":
        require(m["access_basis"] == "INTERNAL_MANDATE_CLAIM", "GOVERNMENT_MANDATE_CLAIM_REQUIRED")
        require(m["disclosure"] == "REGULATED", "GOVERNMENT_RESTRICTED_SCOPE_REQUIRED")
    if m["kind"] == "PUBLIC_DOCUMENT_UTF8":
        require(m["disclosure"] == "PUBLIC", "PUBLIC_SOURCE_DISCLOSURE_MISMATCH")
    source_date = day(m["as_of"], "SOURCE_AS_OF")
    expiry = day(m["retention_until"], "RETENTION_UNTIL")
    require(expiry >= source_date and expiry >= (today or date.today()),
            "RETENTION_EXPIRED")
    require(type(m["sha256"]) is str and re.fullmatch("[a-f0-9]{64}", m["sha256"]) is not None,
            "SOURCE_SHA_FORMAT_INVALID")
    require(sha(raw) == m["sha256"], "SOURCE_BYTES_SHA_MISMATCH")
    return {
        "id": identifier("ESRC-", m), "sha256": m["sha256"], "byte_length": len(raw),
        "kind": m["kind"], "jurisdiction": m["jurisdiction"], "as_of": m["as_of"],
        "disclosure": m["disclosure"], "source_origin": "LOCALLY_SUPPLIED_ORIGIN_NOT_INDEPENDENTLY_VERIFIED",
        "rights": "CLAIM_ONLY_NOT_INDEPENDENTLY_VERIFIED",
        "authorized_scope": "LOCAL_ANALYSIS_ONLY",
        "retention_until": m["retention_until"],
        "export_authorized": False,
    }


def _line_records(raw: bytes):
    offset = 0
    for i, part in enumerate(raw.splitlines(keepends=True)):
        if not part.strip():
            offset += len(part)
            continue
        require(len(part) <= MAX_LINE, "LINE_TOO_LONG")
        yield i, offset, offset + len(part), part.rstrip(b"\r\n")
        offset += len(part)


def _unit(source_id: str, kind: str, locator: dict, payload_sha: str,
          evidence_strength: str) -> dict:
    return {"id": identifier("REV-", [source_id, kind, locator, payload_sha]),
            "kind": kind, "locator": locator, "sha256": payload_sha,
            "evidence_strength": evidence_strength,
            "taskness": "NOT_DETERMINED", "authority": "NOT_VERIFIED"}


def _text_units(raw: bytes, source: dict) -> list[dict]:
    try:
        raw.decode("utf-8", "strict")
    except UnicodeError:
        raise Rejected("TEXT_NOT_UTF8") from None
    units = []
    evidence = "PARTICIPANT_REPORT_NOT_OBSERVATION" if source["kind"] == "INTERVIEW_TRANSCRIPT_UTF8" else \
               "SELF_REPORTED_NOT_OBSERVATION" if source["kind"] == "PERSONAL_NOTE_UTF8" else \
               "TEXT_CONTENT_NOT_REAL_WORLD_EXECUTION_PROOF"
    for index, start, end, line in _line_records(raw):
        require(len(units) < MAX_UNITS, "EXCESSIVE_UNITS")
        units.append(_unit(source["id"], "RawStatement", {"line_index": index,
                "byte_start": start, "byte_end": end}, sha(line), evidence))
    require(units, "NO_RESEARCHABLE_UNITS")
    return units


def timestamp(value: object) -> datetime:
    require(type(value) is str and len(value) <= 60, "EVENT_TIME_INVALID")
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise Rejected("EVENT_TIME_INVALID") from None
    require(t.tzinfo is not None and t.utcoffset() is not None, "EVENT_TIMEZONE_REQUIRED")
    return t


def _event_units(raw: bytes, source: dict) -> list[dict]:
    units, ids, cases = [], set(), {}
    for line_index, start, end, line in _line_records(raw):
        require(len(units) < MAX_UNITS, "EXCESSIVE_UNITS")
        data = strict_json(line)
        require(type(data) is dict and {"event_id", "case_id", "activity", "timestamp"} <= set(data)
                and set(data) <= {"event_id", "case_id", "activity", "timestamp", "actor", "attributes"},
                "EVENT_FIELDS_INVALID")
        for key in ("event_id", "case_id", "activity"):
            nonempty(data[key], "EVENT_" + key.upper(), 200)
        if "actor" in data:
            nonempty(data["actor"], "EVENT_ACTOR", 200)
        if "attributes" in data:
            attrs = data["attributes"]
            require(type(attrs) is dict, "EVENT_ATTRIBUTES_INVALID")
            def check_attributes(obj: object, depth: int = 0) -> int:
                require(depth <= 8, "EVENT_ATTRIBUTES_TOO_DEEP")
                if type(obj) is dict:
                    require(len(obj) <= 128 and all(type(k) is str for k in obj),
                            "EVENT_ATTRIBUTES_TOO_COMPLEX")
                    return 1 + sum(check_attributes(v, depth + 1) for v in obj.values())
                if type(obj) is list:
                    require(len(obj) <= 128, "EVENT_ATTRIBUTES_TOO_COMPLEX")
                    return 1 + sum(check_attributes(v, depth + 1) for v in obj)
                require(obj is None or type(obj) in (str, int, float, bool),
                        "EVENT_ATTRIBUTE_VALUE_INVALID")
                return 1
            require(check_attributes(attrs) <= 256 and len(canonical(attrs)) <= 16000,
                    "EVENT_ATTRIBUTES_INVALID")
        recorded_at = timestamp(data["timestamp"])
        require(data["event_id"] not in ids, "DUPLICATE_EVENT_ID")
        ids.add(data["event_id"])
        unit = _unit(source["id"], "RawEvent",
                    {"jsonl_line_index": line_index, "byte_start": start, "byte_end": end,
                     "event_id_fingerprint": sha(data["event_id"].encode("utf-8"))},
                    sha(line), "REPORTED_EVENT_IN_UNVERIFIED_LOG")
        units.append(unit)
        # Case IDs group reported events, not independently observed work.
        # Never copy case ID, activity, actor or timestamp into a receipt.
        cases.setdefault(data["case_id"], []).append((recorded_at, line_index, data["activity"], unit))
    require(units, "NO_RESEARCHABLE_UNITS")
    for case_index, records in enumerate(cases.values()):
        ordered = sorted(records, key=lambda item: (item[0], item[1]))
        has_timestamp_ties = any(ordered[i][0] == ordered[i - 1][0]
                                 for i in range(1, len(ordered)))
        activity_count = len({item[2] for item in ordered})
        for position, (_, _, _, unit) in enumerate(ordered):
            # Sibling context is excluded from the immutable REV- evidence ID.
            unit["process_context"] = {
                "scope": "REPORTED_CASE_SEQUENCE_NOT_VERIFIED_EXECUTION",
                "case_index": case_index,
                "case_event_count": len(ordered),
                "distinct_declared_activity_count": activity_count,
                "position_by_reported_timestamp": position,
                "timestamp_ties_present": has_timestamp_ties,
                "ordering_proof": "DECLARED_TIMESTAMPS_ONLY_NO_CAUSALITY",
                "task_type_identity": "NOT_DETERMINED",
            }
    return units


def _bpmn_units(raw: bytes, source: dict) -> list[dict]:
    require(b"<!DOCTYPE" not in raw.upper() and b"<!ENTITY" not in raw.upper()
            and b"<XI:INCLUDE" not in raw.upper(), "XML_EXTERNAL_REFERENCE_FORBIDDEN")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise Rejected("INVALID_BPMN_XML") from None
    require(root.tag == "{" + BPMN_NS + "}definitions", "BPMN_ROOT_INVALID")
    elements = list(root.iter())
    require(len(elements) <= MAX_UNITS, "BPMN_TOO_COMPLEX")
    seen, units = set(), []
    for element in elements:
        key = element.get("id")
        if key is not None:
            nonempty(key, "BPMN_ID", 200)
            require(key not in seen, "DUPLICATE_BPMN_ID")
            seen.add(key)
    processes = [e for e in root if e.tag == "{" + BPMN_NS + "}process"]
    require(processes, "BPMN_PROCESS_MISSING")
    for process_index, process in enumerate(processes):
        process_id = nonempty(process.get("id"), "BPMN_PROCESS_ID", 200)
        # BPMN sequence flows describe a model, not actual executions or authority.
        # Context is a sibling of the immutable raw locator, preserving REV- IDs.
        graph_nodes = {node.get("id"): node for node in process.iter()
                       if node.get("id") is not None}
        flows = []
        for edge in process.iter("{" + BPMN_NS + "}sequenceFlow"):
            src = nonempty(edge.get("sourceRef"), "BPMN_FLOW_SOURCE", 200)
            dst = nonempty(edge.get("targetRef"), "BPMN_FLOW_TARGET", 200)
            flows.append((src, dst))
        complete = bool(flows) and all(src in graph_nodes and dst in graph_nodes
                                        for src, dst in flows)
        adjacency = {}
        for src, dst in flows:
            adjacency.setdefault(src, set()).add(dst)

        def cycle_status(node_id: str) -> str:
            # An absent or incomplete graph cannot prove absence of a cycle.
            # Avoid pathological O(V^2) work on large, otherwise valid models.
            if not complete or len(graph_nodes) > 512 or len(flows) > 1024:
                return "UNKNOWN_GRAPH_UNAVAILABLE_OR_LIMITED"
            pending, visited = list(adjacency.get(node_id, ())), set()
            while pending:
                current = pending.pop()
                if current == node_id:
                    return "RETURN_PATH_PRESENT_IN_MODEL"
                if current not in visited:
                    visited.add(current)
                    pending.extend(adjacency.get(current, ()))
            return "NO_RETURN_PATH_IN_SUPPLIED_MODEL"

        gateway_names = {"exclusiveGateway", "parallelGateway", "inclusiveGateway",
                         "eventBasedGateway", "complexGateway"}
        for step_index, step in enumerate(process.iter()):
            local = step.tag.removeprefix("{" + BPMN_NS + "}")
            if step.tag not in {"{" + BPMN_NS + "}" + s for s in PROCESS_NODES}:
                continue
            require(len(units) < MAX_UNITS, "EXCESSIVE_UNITS")
            node_id = nonempty(step.get("id"), "BPMN_STEP_ID", 200)
            name = nonempty(step.get("name"), "BPMN_STEP_NAME", 500)
            segment = ET.tostring(step, encoding="utf-8")
            unit = _unit(source["id"], "RawProcessStep",
                         {"process_index": process_index, "step_index": step_index,
                          "process_id_fingerprint": sha(process_id.encode("utf-8")),
                          "step_id_fingerprint": sha(node_id.encode("utf-8")),
                          "step_type": local}, sha(segment),
                         "PROCESS_MODEL_DESCRIBES_STEP_NOT_OBSERVED_EXECUTION")
            incoming = [src for src, dst in flows if dst == node_id]
            outgoing = [dst for src, dst in flows if src == node_id]
            gateway = lambda n: (n.tag.rsplit("}", 1)[-1]
                                  if n is not None else "")
            assignee_declared = any(key.rsplit("}", 1)[-1] in
                                    {"assignee", "candidateGroups", "candidateUsers"}
                                    for key in step.attrib)
            unit["process_context"] = {
                "scope": "DECLARED_BPMN_PROCESS_NOT_EXECUTION",
                "sequence_flow_status": ("COMPLETE_REFERENCE_SET" if complete else
                                         "MISSING_OR_INCOMPLETE_SEQUENCE_FLOWS"),
                "incoming_count": len(incoming), "outgoing_count": len(outgoing),
                "incoming_gateway_types": sorted({gateway(graph_nodes.get(x))
                                                  for x in incoming
                                                  if gateway(graph_nodes.get(x)) in gateway_names}),
                "outgoing_gateway_types": sorted({gateway(graph_nodes.get(x))
                                                  for x in outgoing
                                                  if gateway(graph_nodes.get(x)) in gateway_names}),
                "return_path": cycle_status(node_id),
                "assignment_declared_not_verified": assignee_declared,
                "task_type_identity": "NOT_DETERMINED",
            }
            units.append(unit)
    require(units, "BPMN_NO_TASK_STEPS")
    return units


def inspect(raw: bytes, manifest: dict, *, today: date | None = None) -> dict:
    source = validate_source(raw, manifest, today=today)
    if manifest["kind"] in TEXT_KINDS:
        units = _text_units(raw, source)
    elif manifest["kind"] == "EVENT_LOG_JSONL":
        units = _event_units(raw, source)
    else:
        units = _bpmn_units(raw, source)
    return {"schema": VERSION, "source": source, "units": units,
            "unit_count": len(units), "data_export": "NONE_RECEIPT_ONLY",
            "source_permission_independent_verification": "NOT_PERFORMED",
            "task_type_ids_assigned": 0, "catalogue_write_authorized": False,
            "expert_review": "NOT_PERFORMED", "engine_accepted": False}



def review_hints(raw: bytes, manifest: dict, *, today: date | None = None) -> dict:
    """Surface lexical REVIEW CUES grounded in immutable U1 RawStatement IDs.

    This optional read-only helper is deliberately not u.propose(): no goals,
    actors, result claims or TaskCandidate objects are synthesized. It cannot
    prove the existence of a task or the truth of the source text.
    No raw text or matched phrase is included in the output receipt.
    """
    report = inspect(raw, manifest, today=today)
    require(report["source"]["kind"] in TEXT_KINDS, "REVIEW_HINTS_TEXT_ONLY")
    hints: list[dict] = []
    extra_hints = 0
    too_long = 0
    for unit in report["units"]:
        loc = unit["locator"]
        fragment = raw[loc["byte_start"]:loc["byte_end"]].rstrip(b"\r\n")
        require(sha(fragment) == unit["sha256"], "REVIEW_HINTS_EVIDENCE_MISMATCH")
        line = fragment.decode("utf-8", "strict")
        if len(line) > MAX_HINT_LINE_CHARS:
            too_long += 1
            continue
        action = None
        if not _CANCEL_ACTION.search(line):
            action = _EXPLICIT_RU.search(line) or _EXPLICIT_EN.search(line)
        problem = None
        if not _CANCEL_PROBLEM.search(line):
            problem = _PROBLEM_RU.search(line) or _PROBLEM_EN.search(line)
        if action is not None:
            kind, cue = "EXPLICIT_REQUEST_REVIEW_CUE", action
        elif problem is not None:
            kind, cue = "REPORTED_PROBLEM_REVIEW_CUE", problem
        else:
            continue
        start = loc["byte_start"] + len(line[:cue.start()].encode("utf-8"))
        end = loc["byte_start"] + len(line[:cue.end()].encode("utf-8"))
        if len(hints) >= MAX_REVIEW_HINTS:
            extra_hints += 1
            continue
        hints.append({
            "hint_id": identifier("RHNT-", [report["source"]["id"], unit["id"],
                                           kind, start, end]),
            "source_unit_id": unit["id"],
            "source_line_index": loc["line_index"],
            "cue_byte_start": start, "cue_byte_end": end,
            "cue_kind": kind,
            "evidence_scope": unit["evidence_strength"],
            "taskness": "NOT_DETERMINED",
            "human_review": "REQUIRED_BEFORE_TASK_FORMULATION",
            "source_truth": "NOT_INDEPENDENTLY_VERIFIED",
        })
    partial = bool(extra_hints or too_long)
    return {
        "schema": REVIEW_HINT_VERSION,
        "status": ("PARTIAL_REVIEW_CUE_COVERAGE"
                   if partial else "REVIEW_CUES_FOUND_NOT_TASKS"
                   if hints else "NO_LEXICAL_CUES_NOT_PROOF_OF_NO_TASK"),
        "source": report["source"], "u1_unit_count": report["unit_count"],
        "hint_count": len(hints), "hints": hints,
        "omitted_hint_count": extra_hints,
        "unscanned_long_unit_count": too_long,
        "complete_lexical_scan": not partial,
        "scope": "RULE_BASED_RU_EN_TEXT_ONLY_NO_MODEL",
        "source_content_exported": False,
        "reviewed_by_human": False, "independent_gold": False,
        "candidate_task_count": 0, "task_type_ids_assigned": 0,
        "catalogue_write_authorized": False, "external_effects_authorized": False,
        "engine_accepted": False, "quality_measured": False,
    }


def propose(raw: bytes, manifest: dict, interpretation: dict,
            *, today: date | None = None) -> dict:
    report = inspect(raw, manifest, today=today)
    draft = shape(interpretation, OBS_KEYS, "INTERPRETATION")
    require(draft["subject_line"] in SUBJECT_LINES, "SUBJECT_LINE_INVALID")
    for k in ("actor_role", "principal_role", "trigger", "goal", "result", "object", "caveat"):
        nonempty(draft[k], "INTERPRETATION_" + k.upper(), 2000)
    require(draft["interpretation"] == "RESEARCHER_HYPOTHESIS", "INTERPRETATION_CANNOT_SELF_APPROVE")
    selected = draft["evidence_ids"]
    require(type(selected) is list and 1 <= len(selected) <= 50 and
            all(type(x) is str for x in selected) and len(set(selected)) == len(selected),
            "EVIDENCE_SELECTION_INVALID")
    available = {unit["id"] for unit in report["units"]}
    require(set(selected) <= available, "EVIDENCE_ANCHOR_NOT_IN_SOURCE")
    fingerprint = sha(canonical(draft))
    candidate_id = identifier("CAND-", [report["source"]["id"], sorted(selected), fingerprint])
    return {
        "schema": VERSION, "status": "UNQUALIFIED_RESEARCH_HYPOTHESIS",
        "source_id": report["source"]["id"],
        "source_sha256": report["source"]["sha256"],
        "raw_evidence_ids": selected,
        "normalized_observation": {"id": identifier("OBS-", [selected, fingerprint]),
                                   "interpretation_sha256": fingerprint,
                                   "status": "INTERPRETATION_NOT_INDEPENDENTLY_VERIFIED"},
        "TaskCandidate": {"provisional_id": candidate_id,
                          "taskness": "REVIEW_PENDING", "distinctness": "REVIEW_PENDING",
                          "russian_applicability": "RU_AUDIT_PENDING",
                          "authority": "NOT_VERIFIED", "human_decision": "PENDING",
                          "task_type_id": None, "catalogue_write_authorized": False,
                          "external_effects_authorized": False},
        "private_payload_exported": False, "engine_accepted": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inspect", "hints", "propose"))
    parser.add_argument("--document", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--interpretation", type=Path)
    parser.add_argument("--public-stdout", action="store_true",
                        help="Allow stdout only for declared public UTF-8 document evidence")
    parser.add_argument("--restricted-output", type=Path,
                        help="Write a private result into a new file in an owned directory outside Git")
    args = parser.parse_args(argv)
    try:
        require(args.command != "propose" or args.interpretation is not None,
                "INTERPRETATION_PATH_REQUIRED")
        document = args.document.read_bytes()
        source = strict_json(args.source.read_bytes())
        result = (inspect(document, source) if args.command == "inspect"
                  else review_hints(document, source) if args.command == "hints"
                  else propose(document, source, strict_json(args.interpretation.read_bytes())))
        require((args.restricted_output is not None) != args.public_stdout,
                "OUTPUT_MODE_REQUIRED_OR_CONFLICT")
        if args.public_stdout:
            require(source["kind"] == "PUBLIC_DOCUMENT_UTF8" and
                    source["disclosure"] == "PUBLIC",
                    "PUBLIC_OUTPUT_SOURCE_POLICY_REJECTED")
        try:
            from .local_output import emit_result
        except ImportError:
            from local_output import emit_result
        emit_result(result, restricted_output=args.restricted_output,
                    public_stdout=args.public_stdout)
        return 0
    except (Rejected, OSError, ValueError) as exc:
        # Do not echo exception data, full paths, or document content to stderr.
        print('{"status":"REJECTED_FAIL_CLOSED","code":"U1_INPUT_OR_OUTPUT_REJECTED"}',
              file=sys.stderr)
        return 2
    except Exception:
        print('{"status":"REJECTED_FAIL_CLOSED","code":"U1_INPUT_OR_OUTPUT_REJECTED"}',
              file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
