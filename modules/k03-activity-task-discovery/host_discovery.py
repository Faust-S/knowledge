#!/usr/bin/env python3
"""Host-neutral K03 intake of caller-authorized text and an ambiguous need.

Reuses the pinned original research U1 via the existing paired_pinned_u1 loader.
This is an experimental, source-bound candidate handoff, not production U1,
human gold, an accepted Task, a Task Engine or a rights verification service.
"""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys
from time import perf_counter_ns

import k03
import issue_replay  # existing public owner adapter; never import/copy U1 core

SCHEMA = "IWXA_K03_HOST_DISCOVERY/0.2.0"
SELECTION_SCHEMA = "IWXA_K03_HOST_SELECTION/0.2.0"
MAX_DOCUMENTS = 8
MAX_SOURCE_BYTES = 128_000
MAX_NEED_CHARS = 4_000
CUE_LIMIT = 8
VALID_TAGS = frozenset(("reported", "observed"))
TEXT_KINDS = frozenset(("PUBLIC_DOCUMENT_UTF8", "CORPORATE_DOCUMENT_UTF8",
                        "PERSONAL_NOTE_UTF8", "INTERVIEW_TRANSCRIPT_UTF8",
                        "GOVERNMENT_DOCUMENT_UTF8"))
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
SOURCE_ID = re.compile(r"[a-zA-Z0-9._:-]{1,80}\Z")
WORD = re.compile(r"[^\W\d_]{4,}", re.UNICODE)
NON_TOPICAL = frozenset(("хочу", "нужно", "надо", "чтобы", "очень", "плохо",
                         "сложно", "трудно", "пока", "иногда", "сейчас",
                         "please", "should", "need", "want", "have", "with"))
CHOICE = "HUMAN_SELECT_FOR_QUALIFICATION"


def require(ok: bool, code: str) -> None:
    if not ok:
        raise k03.DiscoveryHold(code)


def _ms(start: int) -> float:
    return round((perf_counter_ns() - start) / 1_000_000, 4)


def _terms(text: str) -> tuple[str, ...]:
    return tuple(sorted({w for w in WORD.findall(text.casefold())
                         if w not in NON_TOPICAL}))


def _validated_request(request: dict, sources: list) -> tuple[str, str, dict]:
    require(type(request) is dict and type(sources) is list,
            "K03_HOST_REQUEST_INVALID")
    mode, need_text = request.get("mode"), request.get("text")
    require(mode in ("CLEAR_TASK", "NEED") and type(need_text) is str
            and 0 < len(need_text.strip()) <= MAX_NEED_CHARS,
            "K03_HOST_NEED_INVALID")
    if mode == "CLEAR_TASK":
        require(type(request.get("expected_result")) is str
                and bool(request["expected_result"].strip()),
                "K03_HOST_CLEAR_TASK_RESULT_REQUIRED")
        return mode, need_text.strip(), {}
    require(request.get("expected_result") is None
            and type(request.get("expected_revisions")) is dict
            and len(sources) <= MAX_DOCUMENTS,
            "K03_HOST_SOURCE_SET_INVALID")
    expected = request["expected_revisions"]
    require(len(expected) == len(sources)
            and all(type(k) is str and SOURCE_ID.fullmatch(k) is not None
                    and type(v) is str and 0 < len(v) <= 128
                    for k, v in expected.items()),
            "K03_HOST_EXPECTED_REVISION_INVALID")
    return mode, need_text.strip(), expected


def _source_bytes(row: dict, expected: str) -> tuple[bytes, dict]:
    require(type(row) is dict and set(row) ==
            {"source_id", "revision", "text", "epistemic", "manifest"},
            "K03_HOST_SOURCE_SHAPE_INVALID")
    sid, rev = row["source_id"], row["revision"]
    require(type(sid) is str and SOURCE_ID.fullmatch(sid) is not None
            and type(rev) is str and rev == expected,
            "K03_HOST_SOURCE_REVISION_STALE")
    require(type(row["text"]) is str
            and type(row["epistemic"]) is str
            and row["epistemic"] in VALID_TAGS
            and type(row["manifest"]) is dict,
            "K03_HOST_SOURCE_CONTENT_INVALID")
    raw = row["text"].encode("utf-8", "strict")
    require(0 < len(raw) <= MAX_SOURCE_BYTES,
            "K03_HOST_SOURCE_SIZE_INVALID")
    claim = row["manifest"]
    digest = hashlib.sha256(raw).hexdigest()
    require(type(claim.get("sha256")) is str
            and HEX64.fullmatch(claim["sha256"]) is not None
            and digest == claim["sha256"], "K03_HOST_SOURCE_DIGEST_STALE")
    require(claim.get("kind") in TEXT_KINDS
            and type(claim.get("source_reference")) is str
            and bool(claim["source_reference"])
            and claim.get("purpose") == "ENGINE_RESEARCH_AND_TEST",
            "K03_HOST_U1_RESEARCH_ONLY_CONTRACT")
    # The originating host owns actual rights, latest revisions and source access.
    # Never change the source claim to PUBLIC or assert permission automatically.
    require(claim.get("permission_asserted") is True
            and claim.get("revocation_status") == "ACTIVE"
            and claim.get("authorized_actions") == ["LOCAL_ANALYSIS"],
            "K03_HOST_SOURCE_PERMISSION_NOT_ASSERTED")
    require(not (row["epistemic"] == "observed"
                 and claim["kind"] in ("PERSONAL_NOTE_UTF8", "INTERVIEW_TRANSCRIPT_UTF8")),
            "K03_HOST_SELF_REPORT_NOT_OBSERVED")
    return raw, claim


def _one_source(row: dict, expected: str, terms: tuple[str, ...], *,
                today: date, loader) -> tuple[list, list, dict]:
    raw, claim = _source_bytes(row, expected)
    u1, owner_blob, _ = loader()
    require(owner_blob == issue_replay.frozen.OWNER_U1_GIT_BLOB,
            "K03_HOST_U1_OWNER_REVISION_CHANGED")
    try:
        report = u1.inspect(raw, claim, today=today)
        hints = u1.review_hints(raw, claim, today=today)
    except Exception:
        # The native U1 enforces its own permissions/expiry; do not echo input.
        raise k03.DiscoveryHold("K03_HOST_NATIVE_U1_SOURCE_HOLD") from None
    units_list = report.get("units")
    cue_list = hints.get("hints")
    require(type(units_list) is list and type(cue_list) is list
            and type(report.get("unit_count")) is int
            and report["unit_count"] == len(units_list)
            and hints.get("hint_count") == len(cue_list)
            and report.get("source") == hints.get("source")
            and report["source"].get("sha256") == claim["sha256"]
            and report.get("engine_accepted") is False
            and hints.get("engine_accepted") is False
            and hints.get("candidate_task_count") == 0
            and hints.get("task_type_ids_assigned") == 0
            and report.get("task_type_ids_assigned") == 0,
            "K03_HOST_U1_INVALID_RECEIPT")
    units = {x["id"]: x for x in units_list}
    require(len(units) == len(units_list),
            "K03_HOST_U1_DUPLICATE_EVIDENCE")
    source_id = row["source_id"]
    base = {
        "source_id": source_id,
        "source_ref": claim["source_reference"],
        "source_revision": row["revision"],
        "source_sha256": claim["sha256"],
        "u1_source_id": report["source"]["id"],
        "source_rights": "HOST_CLAIM_NOT_INDEPENDENTLY_VERIFIED",
    }
    observations = [{
        "id": "O-" + source_id,
        "tag": row["epistemic"],
        "kind": "HOST_SUPPLIED_TEXT_NOT_INDEPENDENTLY_VERIFIED",
        "locator": {"byte_start": 0, "byte_end": len(raw)},
        **base,
    }]
    candidates = []
    # Conservative matching only, not a task-prediction model.
    for hint in cue_list:
        rid, a, b = hint.get("source_unit_id"), hint.get("cue_byte_start"), hint.get("cue_byte_end")
        unit = units.get(rid)
        require(unit is not None and unit.get("kind") == "RawStatement"
                and type(a) is int and type(b) is int
                and type(unit.get("locator")) is dict,
                "K03_HOST_U1_HINT_NOT_ANCHORED")
        start = unit["locator"].get("byte_start")
        end = unit["locator"].get("byte_end")
        require(type(start) is int and type(end) is int
                and 0 <= start <= a < b <= end <= len(raw)
                and raw[a:b].strip() != b""
                and hint.get("cue_kind") in issue_replay.PERMITTED_KINDS,
                "K03_HOST_U1_HINT_NOT_ANCHORED")
        line = raw[start:end].decode("utf-8", "strict").strip()
        if not terms or not any(w in line.casefold() for w in terms):
            continue
        evid = "E-" + hashlib.sha256(
            (source_id + claim["sha256"] + rid + str(a) + ":" + str(b)
             ).encode("utf-8")).hexdigest()[:20]
        obs = {
            "id": evid,
            "tag": row["epistemic"],
            "kind": hint["cue_kind"],
            "u1_evidence_id": rid,
            "locator": {"byte_start": a, "byte_end": b},
            "source_truth": "NOT_INDEPENDENTLY_VERIFIED",
            **base,
        }
        observations.append(obs)
        # User sees a concise source-native statement to qualify, not an
        # invented goal / acceptance criterion or a canonical TaskType.
        candidate = {
            "id": "H-" + evid[2:],
            "text": "Уточнить возможную задачу по свидетельству: " + line[:240],
            "tag": "inferred",
            "kind": "SOURCE_REPORTED_REQUEST_FOR_QUALIFICATION",
            "status": "PROPOSED_NOT_QUALIFIED_TASK",
            "evidence_links": [{
                "evidence_id": evid,
                "source_id": source_id,
                "source_ref": claim["source_reference"],
                "source_revision": row["revision"],
                "source_sha256": claim["sha256"],
                "locator": {"byte_start": a, "byte_end": b},
                "relation": "NATIVE_U1_LEXICAL_CUE_NOT_TASK_CONFIRMATION",
            }],
            "independent_field_confirmation": False,
            "result_not_yet_defined": True,
        }
        candidates.append(candidate)
        break  # At most one candidate per document; no excessive suggestions.
    return observations, candidates, {
        "source_id": source_id,
        "bytes_checked": len(raw),
        "literal_term_match": any(word in raw.decode("utf-8").casefold()
                                  for word in terms),
        "review_cue_count": hints["hint_count"],
        "scan_complete": hints.get("complete_lexical_scan") is True,
    }


def discover(request: dict, sources: list, *, today: date | None = None,
             u1_loader=None) -> dict:
    """Accept explicit host input; never read GitHub issues or a user Store."""
    start = perf_counter_ns()
    mode, need_text, expected = _validated_request(request, sources)
    if mode == "CLEAR_TASK":
        direct = k03.bypass_clear_task(need_text, request["expected_result"])
        return {
            "schema": SCHEMA, "route": direct["route"],
            "task_input": direct["task_input"],
            "expected_result": direct["expected_result"],
            "task_hypotheses": [], "clarification_requests": [],
            "source_count": 0, "processed_source_bytes": 0,
            "native_u1_calls": 0, "accepted_task_count": 0,
            "task_created": False, "result_created": False,
            "next_owner": "HOST_TASK_QUALIFICATION",
            "metrics": {"processing_ms": _ms(start), "human_time_saved_ms": None},
        }
    ids = [r.get("source_id") if type(r) is dict else None for r in sources]
    require(len(set(ids)) == len(ids)
            and set(ids) == set(expected),
            "K03_HOST_SOURCE_IDENTITY_INVALID")
    terms = _terms(need_text)
    observations = [{
        "id": "TARGET-NEED",
        "tag": "target",
        "kind": "USER_REPORTED_DESIRED_CHANGE_NOT_OBSERVED_ACTIVITY",
        "text": need_text,
        "source_id": None,
    }]
    hypotheses, summaries = [], []
    loader = u1_loader if u1_loader is not None else issue_replay.paired.load_owner
    # All supplied sources use the same pinned native U1 owner. Loading the
    # owner once per request avoids repeated module/source reads while keeping
    # inspect/review_hints and the permission check per document.
    owner_once = None
    def pinned_owner():
        nonlocal owner_once
        if owner_once is None:
            owner_once = loader()
        return owner_once

    for row in sources:
        o, h, summary = _one_source(
            row, expected[row["source_id"]], terms,
            today=today or date.today(), loader=loader)
        observations.extend(o)
        hypotheses.extend(h)
        summaries.append(summary)
    require(len(hypotheses) <= CUE_LIMIT, "K03_HOST_TOO_MANY_HYPOTHESES")
    return {
        "schema": SCHEMA,
        "route": "QUALIFICATION_REQUIRED" if hypotheses
                 else "CLARIFICATION_REQUIRED",
        "mode": "NEED",
        "activity_observations": observations,
        "task_hypotheses": hypotheses,
        "clarification_requests": [{
            "id": "Q-NEED-1",
            "question": (
                "Какой результат нужен и какая из подтверждённых исходным "
                "документом потребностей относится к вашей ситуации?"
                if hypotheses else
                "Вспомните конкретный случай: что произошло, какой результат "
                "нужен и какой разрешённый источник может это подтвердить?"),
            "reason": "OWNER_TASK_QUALIFICATION_REQUIRED"
                      if hypotheses else "INSUFFICIENT_RELEVANT_SOURCE_CUES",
        }],
        "source_count": len(sources),
        "processed_source_bytes": sum(s["bytes_checked"] for s in summaries),
        "native_u1_calls": len(sources) * 2,
        "sources_checked": summaries,
        "accepted_task_count": 0,
        "task_type_accepted": False,
        "task_created": False,
        "result_created": False,
        "human_task_gold": False,
        "task_precision": None, "task_recall": None, "task_f1": None,
        "native_u1_scope": "ENGINE_RESEARCH_AND_TEST_ONLY",
        "independent_source_truth": "NOT_MEASURED",
        "metrics": {
            "processing_ms": _ms(start),
            "human_time_saved_ms": None,
            "comparison": {
                "direct_question": {
                    "source_bytes_read": 0, "linked_candidates": 0,
                    "clarification_count": 1,
                },
                "literal_term_search": {
                    "query_terms": len(terms),
                    "source_hits": sum(s["literal_term_match"] for s in summaries),
                    "task_quality_measured": False,
                },
                "k03": {
                    "source_bytes_read": sum(s["bytes_checked"] for s in summaries),
                    "linked_candidates": len(hypotheses),
                    "clarification_count": 1,
                },
            },
        },
    }


def select_for_p01(result: dict, hypothesis_id: str, *, choice: str,
                   selection_ref: str, request: dict, sources: list,
                   today: date | None = None, u1_loader=None) -> dict:
    """Fresh replay; a human selection intent, not P01 Task creation."""
    require(type(result) is dict and result.get("schema") == SCHEMA,
            "K03_HOST_SELECTION_INPUT_INVALID")
    require(choice == CHOICE and type(selection_ref) is str
            and 1 <= len(selection_ref) <= 128
            and not any(ch.isspace() for ch in selection_ref),
            "K03_HOST_EXPLICIT_SELECTION_REQUIRED")
    replay = discover(request, sources, today=today, u1_loader=u1_loader)
    metricless = lambda r: {k: v for k, v in r.items() if k != "metrics"}
    require(metricless(result) == metricless(replay),
            "K03_HOST_SELECTION_SOURCE_OR_EVIDENCE_CHANGED")
    matched = [h for h in replay.get("task_hypotheses", [])
               if h["id"] == hypothesis_id
               and h["status"] == "PROPOSED_NOT_QUALIFIED_TASK"
               and len(h["evidence_links"]) >= 1]
    require(len(matched) == 1, "K03_HOST_UNSUPPORTED_HYPOTHESIS")
    h = matched[0]
    return {
        "schema": SELECTION_SCHEMA,
        "status": "SELECTED_CANDIDATE_AWAITING_HOST_TASK_QUALIFICATION",
        "choice": choice, "selection_ref": selection_ref,
        "hypothesis_id": h["id"], "candidate_text": h["text"],
        "evidence_links": h["evidence_links"],
        "human_selection_attested_by_host": True,
        "human_selection_independently_verified": False,
        "task_created": False, "task_id": None, "result_created": False,
        "next_owner": "P01_EXISTING_TASK_QUALIFICATION",
        "native_u1_scope": "ENGINE_RESEARCH_AND_TEST_ONLY",
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--input-json", type=Path, required=True)
    p.add_argument("--select-hypothesis")
    p.add_argument("--selection-ref")
    a = p.parse_args()
    try:
        require((a.select_hypothesis is None) == (a.selection_ref is None),
                "K03_HOST_SELECTION_ARGUMENTS_INCOMPLETE")
        payload = json.loads(a.input_json.read_text("utf-8"))
        require(type(payload) is dict and set(payload) == {"request", "sources"},
                "K03_HOST_INPUT_JSON_INVALID")
        result = discover(payload["request"], payload["sources"])
        if a.select_hypothesis is not None:
            result = select_for_p01(
                result, a.select_hypothesis,
                choice=CHOICE, selection_ref=a.selection_ref,
                request=payload["request"], sources=payload["sources"])
        print(json.dumps(result, ensure_ascii=False, sort_keys=True,
                         allow_nan=False))
        return 0
    except (k03.DiscoveryHold, ValueError, OSError, UnicodeError):
        print(json.dumps({"status": "HOLD",
                          "code": "K03_HOST_INPUT_OR_SOURCE_UNAVAILABLE"}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
