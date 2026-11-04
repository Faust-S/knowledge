#!/usr/bin/env python3
"""Solve4X C12: conditional UI/sensor/video overlap, no human-task claims."""
from __future__ import annotations
from datetime import datetime
from collections import Counter
from hashlib import sha256
from pathlib import Path
from io import StringIO
import csv
import json
import sys

import solve4x_zip_range_probe as zipindex
import solve4x_small_member_pair as members
from solve4x_scene_component_lineage import analyze as trace

SCHEMA="IWXA_SOLVE4X_C12_MULTICHANNEL/0.1"
SHA={
"scene01/scene01_video_ocel.json":"619f52a0fb845926790388008b505fff5969adcd25cac31f0bb0e62d01980e99",
"scene01/scene01_sensors_ocel.json":"4f16d799a7ff96b99e25192331fa6ef4edf3dcac876e9f8adc4e570514318918",
"scene01/scene01_ocel.json":"5de185ada7d0e8d82e3f43929e594c31a1c52aad334197557cc7c2550d3f1f15",
"scene01/scene01_ui.csv":"653e0b52ec64c9f1629eb758091cdad5e5c3cb47d68531b2174ec0c6a6c0a1bb"}
class Hold(Exception):pass
def ensure(value,code):
 if not value:raise Hold(code)
def stamp(value):
 ensure(isinstance(value,str) and value.strip(),"TIMESTAMP_MISSING")
 try:dt=datetime.fromisoformat(value)
 except ValueError:raise Hold("TIMESTAMP_INVALID") from None
 ensure(dt.tzinfo is None,"CLOCK_CALIBRATION_UNKNOWN")
 return (dt-datetime(1970,1,1)).total_seconds()
def ui_values(raw):
 ensure(type(raw) is bytes and 0<len(raw)<=131072,"UI_FILE_INVALID")
 try:s=raw.decode("utf-8-sig")
 except UnicodeError:raise Hold("UI_ENCODING_INVALID") from None
 first=s.splitlines()[0]
 sep=max((",", ";", "\t"),key=lambda c:(first.count(c),c))
 ensure(sep in first,"UI_DELIMITER_MISSING")
 reader=csv.DictReader(StringIO(s),delimiter=sep)
 ensure(reader.fieldnames and "timestamp" in reader.fieldnames,"UI_TIMESTAMP_COLUMN_MISSING")
 rows=list(reader)
 ensure(0<len(rows)<=10000 and all(None not in row and row.get("timestamp") for row in rows),"UI_ROWS_INVALID")
 return [stamp(row["timestamp"]) for row in rows]
def event_values(doc):
 ensure(isinstance(doc,dict) and isinstance(doc.get("ocel:events"),dict),"OCEL_EVENTS_MISSING")
 values=[stamp(e.get("ocel:timestamp")) for e in doc["ocel:events"].values()]
 ensure(bool(values),"OCEL_EVENTS_EMPTY")
 return values
def spans(video):
 ensure(isinstance(video,dict) and isinstance(video.get("ocel:events"),dict),"VIDEO_EVENTS_MISSING")
 result=[]
 for event in video["ocel:events"].values():
  ensure(isinstance(event.get("ocel:vmap"),dict),"VIDEO_END_MISSING")
  start,end=stamp(event.get("ocel:timestamp")),stamp(event["ocel:vmap"].get("end_time"))
  ensure(end>=start,"VIDEO_INTERVAL_INVALID")
  result.append((start,end))
 ensure(bool(result),"VIDEO_INTERVALS_EMPTY")
 return result
def inside(timestamps,intervals):
 degree=[sum(a<=t<=b for a,b in intervals) for t in timestamps]
 return {"inside":sum(bool(x) for x in degree),"outside":sum(x==0 for x in degree),
         "ambiguous":sum(x>1 for x in degree),
         "video_intervals_covered":sum(any(a<=t<=b for t in timestamps) for a,b in intervals)}
def pairing(sensor,ui,window):
 ensure(window in (1,5,30),"WINDOW_UNDECLARED")
 edges=[[i for i,x in enumerate(ui) if abs(x-y)<=window] for y in sensor]
 assigned={}
 def augment(i,seen):
  for j in sorted(edges[i],key=lambda j:(abs(sensor[i]-ui[j]),j)):
   if j in seen:continue
   seen.add(j)
   if j not in assigned or augment(assigned[j],seen):
    assigned[j]=i
    return True
  return False
 for i in sorted(range(len(sensor)),key=lambda i:(len(edges[i]),i)):
  augment(i,set())
 counts=Counter(j for row in edges for j in row)
 return {"sensor_with_ui":sum(bool(e) for e in edges),"ui_with_sensor":len(counts),
         "candidate_edges":sum(map(len,edges)),
         "ambiguous_sensor":sum(len(e)>1 for e in edges),
         "ambiguous_ui":sum(x>1 for x in counts.values()),
         "one_to_one_upper_bound":len(assigned)}
def analyze(video,sensors,ui_csv):
 intervals=spans(video);sen=event_values(sensors);ui=ui_values(ui_csv)
 ensure(max(b for a,b in intervals)-min(a for a,b in intervals)<86400,"VIDEO_SCOPE_TOO_LARGE")
 return {"schema":SCHEMA,"status":"SOURCE_COVERAGE_ONLY_NO_HUMAN_GOLD",
         "denominators":{"video_intervals":len(intervals),"sensor_events":len(sen),"ui_records":len(ui)},
         "sensor_video":inside(sen,intervals),"ui_video":inside(ui,intervals),
         "sensor_ui":{str(w)+"s":pairing(sen,ui,w) for w in (1,5,30)},
         "plus_90_seconds_sensitivity":{str(w)+"s":pairing(sen,[v+90 for v in ui],w) for w in (1,5,30)},
         "plus_one_day_negative":{str(w)+"s":pairing(sen,[v+86400 for v in ui],w) for w in (1,5,30)},
         "review_targets_not_tasks":{
            "sensor_outside_video_near_ui_5s":sum(not any(a<=t<=b for a,b in intervals) and any(abs(t-u)<=5 for u in ui) for t in sen),
            "sensor_outside_video_no_near_ui_5s":sum(not any(a<=t<=b for a,b in intervals) and not any(abs(t-u)<=5 for u in ui) for t in sen)},
         "calibrated_clock":False,"same_human_action_confirmed":False,
         "semantic_alignment":"NOT_MEASURED","independent_human_gold":"NOT_MEASURED",
         "false_confident_rate":"NOT_MEASURED","correct_unknown_rate":"NOT_MEASURED",
         "accepted_tasks":0,"raw_values_exported":False}
def probe():
 ix=zipindex.probe();ensure(ix["source"]["central_sha256"]=="bd47f03d561c6468d77df80ec8f920a3dd65502987440abf8a25dacaeb16c5b5","ARCHIVE_DRIFT")
 entries={x["name"]:x for x in ix["target_files"]}
 ensure(all(name in entries for name in SHA),"SOURCE_MEMBER_MISSING")
 meta=zipindex._metadata();raw={}
 for name,expected in SHA.items():
  e=entries[name];ensure(e["compression_method"]==8 and 0<e["compressed_bytes"]<=131072 and 0<e["uncompressed_bytes"]<=524288,"MEMBER_SIZE_HOLD")
  raw[name]=members._download_member(meta["download_url"],meta["archive_size"],e,max_compressed=131072,max_uncompressed=524288)
  ensure(sha256(raw[name]).hexdigest()==expected,"SOURCE_SHA_DRIFT")
 video=json.loads(raw["scene01/scene01_video_ocel.json"])
 sensors=json.loads(raw["scene01/scene01_sensors_ocel.json"])
 joined=json.loads(raw["scene01/scene01_ocel.json"])
 c=trace(joined,video,sensors)["counts"]
 ensure(c.get("video_only_exact")==23 and c.get("sensor_only_exact")==17 and c.get("joined_event_not_in_components",0)==0,"C11_LINEAGE_DRIFT")
 result=analyze(video,sensors,raw["scene01/scene01_ui.csv"])
 from solve4x_c13_episode_triage import analyze as triage_episodes
 result["c13_review_episodes"]=triage_episodes(
     video,sensors,raw["scene01/scene01_ui.csv"])
 result["source"]={"article":meta["article_id"],"sha256":SHA,"archive_downloaded":False,"raw_events_published":False}
 return result
def main():
 import argparse
 p=argparse.ArgumentParser();p.add_argument("--out",type=Path,required=True)
 args=p.parse_args()
 ensure(not args.out.exists(),"OUTPUT_EXISTS")
 try:r=probe();success=True
 except (Hold,zipindex.Hold,OSError,ValueError,KeyError,TimeoutError) as ex:
  r={"schema":SCHEMA,"status":"C12_SOURCE_OR_CLOCK_HOLD","reason":str(ex) if isinstance(ex,(Hold,zipindex.Hold)) else "EXTERNAL_SOURCE_OR_FORMAT_ERROR","accepted_tasks":0,"raw_values_exported":False}
  success=False
 args.out.write_text(json.dumps(r,sort_keys=True,indent=2)+"\n",encoding="utf-8")
 print("SOLVE4X_C12",r["status"],r.get("denominators",{}))
 return 0 if success else 2
if __name__=="__main__":sys.exit(main())
