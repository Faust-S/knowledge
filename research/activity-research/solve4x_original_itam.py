#!/usr/bin/env python3
"""Read original Solve4X ITAM JSONL selectively; publish only provenance and schema.
The JSONL source, not merged global_ocel.json, is the source candidate for a
separate IT asset-management channel. Its independence remains to be qualified.
"""
from __future__ import annotations
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys
import solve4x_zip_range_probe as index
import solve4x_small_member_pair as zip_member

NAME = "global/itam_ocel.jsonl"
SCHEMA = "IWXA_SOLVE4X_ORIGINAL_ITAM_JSONL_SOURCE/0.1"
MAX_BYTES = 256 * 1024
MAX_RECORDS = 5000

def parse_jsonl(raw: bytes, *, include_records: bool = False):
    index.check(isinstance(raw, bytes) and 0 < len(raw) <= MAX_BYTES,
                "ITAM_JSONL_BYTES_INVALID")
    try:
        data = raw.decode("utf-8-sig")
    except UnicodeError:
        raise index.Hold("ITAM_JSONL_ENCODING_HOLD") from None
    lines = [line for line in data.splitlines() if line.strip()]
    index.check(0 < len(lines) <= MAX_RECORDS, "ITAM_LINES_POPULATION_HOLD")
    records = []
    try:
        whole = json.loads(data)
    except ValueError:
        whole = None
    if isinstance(whole, dict):
        records = [whole]
        parse_mode = "WHOLE_JSON_OBJECT"
    elif isinstance(whole, list) and all(isinstance(x, dict) for x in whole):
        records = whole
        parse_mode = "WHOLE_JSON_ARRAY"
    elif whole is not None:
        raise index.Hold("ITAM_UNSUPPORTED_WHOLE_JSON_ROOT")
    else:
        parse_mode = "JSON_LINES"
        valid_json_lines = True
        for line in lines:
            try:
                item = json.loads(line)
            except ValueError:
                valid_json_lines = False
                break
            index.check(isinstance(item, dict), "ITAM_JSONL_OBJECT_EXPECTED")
            records.append(item)
        if not valid_json_lines:
            # Some exporters write adjacent pretty-printed JSON objects rather
            # than one object per physical line. Decode without accepting text
            # that is not valid JSON. This is not permissive error recovery.
            decoder = json.JSONDecoder()
            pos = 0
            records = []
            parse_mode = "MULTILINE_JSON_SEQUENCE"
            while pos < len(data):
                while pos < len(data) and data[pos].isspace():
                    pos += 1
                if pos == len(data):
                    break
                try:
                    item, pos = decoder.raw_decode(data, pos)
                except ValueError:
                    raise index.Hold("ITAM_NONSTANDARD_JSON_FRAMING_HOLD") from None
                index.check(isinstance(item, dict), "ITAM_SEQUENCE_OBJECT_EXPECTED")
                records.append(item)
                index.check(len(records) <= MAX_RECORDS, "ITAM_SEQUENCE_TOO_MANY_RECORDS")
    index.check(0 < len(records) <= MAX_RECORDS, "ITAM_RECORD_POPULATION_HOLD")
    # Top-level schemas are safe only for known field names; OCEL maps can be
    # keyed by employee, event or asset identifiers. Never disclose those keys.
    known_fields = {
        "ocel:events", "ocel:objects", "ocel:global-log",
        "ocel:global-event", "ocel:global-object", "ocel:activity",
        "ocel:timestamp", "ocel:omap", "ocel:vmap", "ocel:type",
        "id", "event_id", "object_id", "eventType", "event_type",
        "activity", "type", "time", "timestamp", "action",
        "attributes", "data", "events", "objects", "items", "records",
        "resource", "actor", "value", "changes",
    }
    keys = Counter(k for item in records for k in item if k in known_fields)
    unknown_key_occurrences = sum(1 for item in records
                                  for key in item if key not in known_fields)
    primary = records[0]
    nested = {key: {
        "container": type(value).__name__,
        "record_count": len(value),
        "sample_value_type": (type(next(iter(value.values()))).__name__
                              if isinstance(value, dict) and value else
                              type(value[0]).__name__
                              if isinstance(value, list) and value else "EMPTY"),
    } for key, value in primary.items()
         if key in known_fields and isinstance(value, (dict, list))}
    arrays = {k: len(v) for k, v in primary.items()
              if k in known_fields and isinstance(v, list)}
    report = {
        "schema":SCHEMA,
        "status":"ORIGINAL_ITAM_JSONL_LOADED_SCHEMA_ONLY",
        "source":{"archive_member":NAME,"sha256":sha256(raw).hexdigest(),
                  "bytes":len(raw),"raw_rows_published":False,
                  "full_archive_downloaded":False},
        "structure":{"nonempty_jsonl_rows":len(records),
                     "parse_mode":parse_mode,
                     "file_nonempty_lines":len(lines),
                     "outer_known_field_occurrences":dict(sorted(keys.items())),
                     "outer_other_field_occurrences":unknown_key_occurrences,
                     "outer_record_types":{"dict":len(records)},
                     "first_record_container_shapes":nested,
                     "first_record_array_sizes":arrays},
        "qualification":{"source_independence_from_joined_ocel":"NOT_YET_AUDITED",
                         "actual_person_work":"UNKNOWN",
                         "matched_scene_events":"NOT_MEASURED",
                         "accepted_tasks":0}
    }

    return (report, records) if include_records else report


def compare_original_itam_to_scene(raw: bytes, scene_raw: bytes) -> dict:
    """Only exact registered-event evidence; no inferred person actions."""
    report, records = parse_jsonl(raw, include_records=True)
    try:
        scene = json.loads(scene_raw)
    except (UnicodeError, ValueError):
        raise index.Hold("SCENE_OCEL_JSON_INVALID") from None
    index.check(isinstance(scene, dict) and
                isinstance(scene.get("ocel:events"), dict),
                "SCENE_OCEL_EVENTS_MISSING")
    scene_events = scene["ocel:events"]
    source_events = {}
    representation = "UNRECOGNISED"
    if len(records) == 1 and isinstance(records[0].get("ocel:events"), dict):
        source_events = records[0]["ocel:events"]
        representation = "OCEL_EVENT_MAP"
    elif records and all(isinstance(r.get("ocel:activity"), str) and
                         isinstance(r.get("ocel:timestamp"), str)
                         for r in records):
        # Source records are standalone events; their original IDs, when
        # present, are used only for exact provenance comparisons.
        representation = "INDIVIDUAL_OCEL_EVENTS"
        for index_number, item in enumerate(records):
            key = item.get("ocel:eid", item.get("event_id", item.get("id")))
            if key is not None:
                index.check(isinstance(key, (str, int)),
                            "ITAM_EVENT_ID_TYPE_INVALID")
                key = str(key)
            else:
                key = "UNIDENTIFIED_EVENT_" + str(index_number)
            index.check(key not in source_events, "ITAM_EVENT_ID_DUPLICATE")
            source_events[key] = item
    else:
        return {
            "status": "ORIGINAL_ITAM_EVENT_SCHEMA_NOT_QUALIFIED",
            "record_representation": representation,
            "source_record_count": len(records),
            "matched_scene_unmarked": "NOT_MEASURED",
            "accepted_tasks": 0,
            "raw_values_exported": False,
        }
    index.check(len(source_events) <= MAX_RECORDS, "ITAM_EVENT_COUNT_EXCESSIVE")
    def signature(event):
        if not isinstance(event, dict):
            return None
        a, t = event.get("ocel:activity"), event.get("ocel:timestamp")
        return (a, t) if isinstance(a, str) and isinstance(t, str) else None
    source_signatures = Counter(x for x in
                                (signature(e) for e in source_events.values())
                                if x is not None)
    candidates = {k:e for k,e in scene_events.items()
                  if isinstance(e, dict) and
                  not (isinstance(e.get("ocel:vmap"), dict) and
                       "end_time" in e["ocel:vmap"])}
    candidate_signatures = Counter(x for x in
                                   (signature(e) for e in candidates.values())
                                   if x is not None)
    valid_shared_ids = set(source_events).intersection(candidates)
    exact_ids_and_signatures = sum(
        signature(source_events[k]) is not None and
        signature(source_events[k]) == signature(candidates[k])
        for k in valid_shared_ids)
    return {
        "status": "ORIGINAL_ITAM_SCENE_DESCRIPTIVE_COMPARISON",
        "record_representation": representation,
        "source_record_count": len(source_events),
        "source_records_with_valid_activity_and_time":
            sum(source_signatures.values()),
        "scene_non_video_marker_events": len(candidates),
        "literal_activity_and_timestamp_multiset_intersection":
            sum((source_signatures & candidate_signatures).values()),
        "literal_event_id_intersection": len(valid_shared_ids),
        "exact_ids_and_activity_timestamp": exact_ids_and_signatures,
        "time_zone_or_clock_calibration_proven": False,
        "literal_event_match_proves_independent_human_action": False,
        "source_lineage_independence_from_joined_ocel": "NOT_ATTESTED",
        "human_task_gold": "NOT_MEASURED",
        "accepted_tasks": 0,
        "raw_values_exported": False,
    }


def framing_profile(raw: bytes) -> dict:
    """Safe format diagnostics, never record text or arbitrary JSON keys."""
    index.check(isinstance(raw, bytes) and 0 < len(raw) <= MAX_BYTES,
                "FRAMING_DIAGNOSTIC_INPUT_INVALID")
    try:
        text = raw.decode("utf-8-sig", errors="strict")
    except UnicodeError:
        return {"encoding": "INVALID_UTF8", "source_contents_returned": False}
    first = text.lstrip()[:1]
    kind = {"{": "OBJECT", "[": "ARRAY", '"': "STRING"}.get(
        first, "OTHER" if first else "EMPTY")
    nonempty = [line for line in text.splitlines() if line.strip()]
    valid = invalid = objects = 0
    for line in nonempty[:MAX_RECORDS]:
        try:
            parsed = json.loads(line)
            valid += 1
            if isinstance(parsed, dict):
                objects += 1
        except ValueError:
            invalid += 1
    return {
        "encoding": "UTF8",
        "first_token_class": kind,
        "physical_nonempty_lines": len(nonempty),
        "individually_valid_json_lines": valid,
        "invalid_individual_json_lines": invalid,
        "individually_valid_object_lines": objects,
        "source_contents_returned": False,
    }


def probe() -> dict:
    zip_index=index.probe()
    candidates=[e for e in zip_index["target_files"] if e["name"]==NAME]
    index.check(len(candidates)==1, "ORIGINAL_ITAM_MEMBER_MISSING")
    item=candidates[0]
    index.check(item["compression_method"]==8 and
        0<item["compressed_bytes"]<=64*1024 and
        0<item["uncompressed_bytes"]<=MAX_BYTES, "ITAM_MEMBER_CAP_HOLD")
    meta=index._metadata()
    raw=zip_member._download_member(meta["download_url"],meta["archive_size"],
        item,max_compressed=64*1024,max_uncompressed=MAX_BYTES)
    try:
        result=parse_jsonl(raw)
    except index.Hold as exc:
        exc.framing_profile = framing_profile(raw)
        raise
    # Compare directly against the original scene export only after a valid
    # original ITAM parse; no extra data fetch is needed for a schema HOLD.
    scene_members = [e for e in zip_index["target_files"]
                     if e["name"] == "scene01/scene01_ocel.json"]
    index.check(len(scene_members) == 1, "SCENE_OCEL_MEMBER_NOT_FOUND")
    scene_item = scene_members[0]
    index.check(scene_item["uncompressed_bytes"] <= zip_member.MAX_UNCOMPRESSED
                and scene_item["compressed_bytes"] <= zip_member.MAX_COMPRESSED,
                "SCENE_OCEL_TOO_LARGE")
    scene_raw = zip_member._download_member(meta["download_url"],
                                            meta["archive_size"], scene_item)
    result["original_itam_vs_scene"] = compare_original_itam_to_scene(
        raw, scene_raw)
    result["source"]["scene_ocel_sha256"] = sha256(scene_raw).hexdigest()
    result["source"]["figshare_article_id"]=meta["article_id"]
    result["source"]["central_sha256"]=zip_index["source"]["central_sha256"]
    return result

def main():
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument("--out",required=True,type=Path)
    args=p.parse_args()
    index.check(not args.out.exists(),"OUTPUT_EXISTS")
    try:
        result=probe(); success=True
    except (index.Hold,OSError,ValueError,TimeoutError) as ex:
        result={"schema":SCHEMA,"status":"ORIGINAL_ITAM_JSONL_HOLD",
                "reason_class":type(ex).__name__,
                "reason_code":str(ex)[:90] if isinstance(ex,index.Hold) else "SOURCE_UNAVAILABLE",
                "source":{"raw_rows_published":False,"full_archive_downloaded":False},
                "qualification":{"accepted_tasks":0,"matched_scene_events":"NOT_MEASURED"}}
        if hasattr(ex, "framing_profile"):
            result["framing_profile"] = ex.framing_profile
        success=False
    args.out.write_text(json.dumps(result,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("SOLVE4X_ORIGINAL_ITAM",result["status"],
          "rows",result.get("structure",{}).get("nonempty_jsonl_rows","UNKNOWN"))
    return 0 if success else 2

if __name__=="__main__":
    sys.exit(main())
