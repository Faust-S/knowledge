#!/usr/bin/env python3
"""Temporal co-occurrence of separately recorded Solve4X browser UI and OCEL.

UI timestamps and OCEL timestamps are compared on absolute UTC clock only.
A nearby UI event is *not* semantic equivalence, action verification, or E5 gold.
"""
from __future__ import annotations

from bisect import bisect_left
import csv
from datetime import datetime, timezone
from hashlib import sha256
from io import StringIO
import json
from pathlib import Path
import re
import sys

import solve4x_zip_range_probe as idx
import solve4x_small_member_pair as pair

SCHEMA="IWXA_SOLVE4X_UI_OCEL_TEMPORAL_CO_OCCURRENCE/0.1"
UI="scene01/scene01_ui.csv"
SCENE="scene01/scene01_ocel.json"
WINDOWS=(1, 5, 30)


def to_epoch(value: str) -> float:
    idx.check(isinstance(value, str) and value.strip() != "", "TIMESTAMP_EMPTY")
    s=value.strip()
    if s.endswith("Z"):
        s=s[:-1]+"+00:00"
    try:
        dt=datetime.fromisoformat(s)
    except ValueError:
        raise idx.Hold("TIMESTAMP_FORMAT_UNSUPPORTED") from None
    idx.check(dt.tzinfo is not None and dt.utcoffset() is not None,
              "TIMESTAMP_TIMEZONE_REQUIRED")
    return dt.timestamp()


def parse_csv(raw: bytes) -> list[float]:
    idx.check(0 < len(raw) <= 128*1024,"UI_SOURCE_SIZE_HOLD")
    try:
        s=raw.decode("utf-8-sig")
    except UnicodeError:
        raise idx.Hold("UI_SOURCE_ENCODING_HOLD") from None
    head=s.splitlines()[0]
    delim=max((",", ";", "\t"),key=lambda x:(head.count(x),x))
    idx.check(head.count(delim)>0,"UI_CSV_HEADER_INVALID")
    reader=csv.DictReader(StringIO(s),delimiter=delim)
    idx.check(reader.fieldnames and "timestamp" in reader.fieldnames,
              "UI_TIMESTAMP_FIELD_MISSING")
    rows=list(reader)
    idx.check(0<len(rows)<=10000 and all(None not in r and r.get("timestamp") for r in rows),
              "UI_CSV_ROW_INVALID")
    return [to_epoch(r["timestamp"]) for r in rows]


def _times(events:dict) -> list[float]:
    idx.check(isinstance(events,dict) and len(events)>0,"OCEL_EVENTS_INVALID")
    out=[]
    for item in events.values():
        idx.check(isinstance(item,dict),"OCEL_EVENT_TYPE_INVALID")
        out.append(to_epoch(item.get("ocel:timestamp")))
    return out


def counts_within(a: list[float], b: list[float], window:int) -> int:
    bs=sorted(b)
    if not bs:return 0
    count=0
    for stamp in a:
        i=bisect_left(bs,stamp)
        near=min((abs(bs[j]-stamp) for j in (i-1,i) if 0<=j<len(bs)),
                 default=float("inf"))
        if near<=window:count+=1
    return count


def analyze(ui_csv:bytes, scene:dict) -> dict:
    ui=parse_csv(ui_csv)
    idx.check(isinstance(scene,dict) and isinstance(scene.get("ocel:events"),dict),
              "SCENE_OCEL_EVENTS_MISSING")
    events=scene["ocel:events"]
    idx.check(len(events)>0,"SCENE_EVENTS_EMPTY")
    marked={k:e for k,e in events.items()
            if isinstance(e.get("ocel:vmap"),dict) and "end_time" in e["ocel:vmap"]}
    unmarked={k:e for k,e in events.items() if k not in marked}
    system_t=_times(unmarked)
    video_t=_times(marked)
    windows={}
    for delta in WINDOWS:
        windows[str(delta)+"s"]={
            "ui_near_system":counts_within(ui,system_t,delta),
            "system_near_ui":counts_within(system_t,ui,delta),
            "ui_near_video_derived":counts_within(ui,video_t,delta),
            "video_derived_near_ui":counts_within(video_t,ui,delta),
        }
    return {
        "schema":SCHEMA,
        "status":"DIRECT_UI_OCEL_ABSOLUTE_TIME_PROXIMITY_NOT_EVENT_IDENTITY",
        "counts":{"ui_rows":len(ui),"scene_system_candidate_events":len(system_t),
                  "scene_video_derived_events":len(video_t),
                  "ui_unique_timestamps":len(set(ui)),
                  "window_counts":windows},
        "limitations":{
            "aligned_clocks_proven":False,
            "temporal_proximity_confirms_same_action":False,
            "system_candidate_origin_independently_verified":False,
            "matched_event_pairs_are_not_one_to_one":True,
            "independent_human_action_truth":"NOT_MEASURED",
            "false_confident_claim_rate":"NOT_MEASURED",
            "correct_unknown_rate":"NOT_MEASURED",
            "accepted_tasks":0,
        },
        "raw_values_exported":False
    }


def run():
    index=idx.probe()
    entries={item["name"]:item for item in index["target_files"]}
    idx.check(UI in entries and SCENE in entries,"UI_SCENE_MEMBERS_MISSING")
    meta=idx._metadata()
    raw={}
    for name in (UI,SCENE):
        item=entries[name]
        idx.check(item["compression_method"]==8 and
                  0<item["compressed_bytes"]<=pair.MAX_COMPRESSED and
                  0<item["uncompressed_bytes"]<=pair.MAX_UNCOMPRESSED,
                  "UI_SCENE_MEMBER_BOUNDS_INVALID")
        raw[name]=pair._download_member(meta["download_url"],meta["archive_size"],item)
    report=analyze(raw[UI],json.loads(raw[SCENE]))
    report["source"]={
        "figshare_article_id":meta["article_id"],
        "archive_central_sha256":index["source"]["central_sha256"],
        "ui_csv_sha256":sha256(raw[UI]).hexdigest(),
        "scene_ocel_sha256":sha256(raw[SCENE]).hexdigest(),
        "full_archive_downloaded":False,
        "source_rows_published":False}
    return report


def main():
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument("--out",type=Path,required=True)
    a=p.parse_args()
    idx.check(not a.out.exists(),"OUTPUT_EXISTS")
    try:
        result=run()
        status=0
    except (idx.Hold,OSError,ValueError,TimeoutError) as err:
        result={"schema":SCHEMA,"status":"UI_OCEL_TIME_SOURCE_OR_CLOCK_HOLD",
                "failure_class":type(err).__name__,
                "failure_code":str(err)[:80] if isinstance(err,idx.Hold) else
                               "EXTERNAL_SOURCE_UNAVAILABLE",
                "limitations":{"accepted_tasks":0,
                  "independent_human_action_truth":"NOT_MEASURED"},
                "raw_values_exported":False}
        status=2
    a.out.write_text(json.dumps(result,sort_keys=True,indent=2)+"\n")
    print("SOLVE4X_UI_OCEL_TIME",result["status"],"counts",result.get("counts",{}))
    return status
if __name__=="__main__":sys.exit(main())
