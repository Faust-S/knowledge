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

def parse_jsonl(raw: bytes) -> dict:
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
    return {
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
    result=parse_jsonl(raw)
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
        success=False
    args.out.write_text(json.dumps(result,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("SOLVE4X_ORIGINAL_ITAM",result["status"],
          "rows",result.get("structure",{}).get("nonempty_jsonl_rows","UNKNOWN"))
    return 0 if success else 2

if __name__=="__main__":
    sys.exit(main())
