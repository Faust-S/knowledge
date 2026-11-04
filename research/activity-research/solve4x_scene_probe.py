#!/usr/bin/env python3
"""Solve4X scene01 published author annotations; research only, not independent video truth."""
import argparse
from collections import Counter
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

SCENE_URL="https://x2log.pages.fraunhofer.de/solve4x/dataset/scenes/scene01/"
FIGSHARE_URL="https://api.figshare.com/v2/articles/25246291"
EXPECTED={"ID001":8,"ID002":7,"ID003":8}
VERSION="IWXA_SOLVE4X_SCENE01_SCOPED/0.1"
class Hold(ValueError):pass
def check(ok,msg):
    if not ok:raise Hold(msg)

class TableReader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.case=None;self.heading=False;self.cell=False;self.row=False
        self.hparts=[];self.cparts=[];self.cells=[];self.rows={}
        self.headers=[];self.active=False;self.finished=False
    def handle_starttag(self,tag,attrs):
        if self.finished:return
        if tag in ("h2","h3","h4","h5","h6"):self.heading=True;self.hparts=[]
        if tag=="tr":self.row=True;self.cells=[]
        if tag in ("td","th") and self.row:self.cell=True;self.cparts=[]
    def handle_data(self,data):
        if self.heading:self.hparts.append(data)
        if self.cell:self.cparts.append(data)
    def handle_endtag(self,tag):
        if self.finished:return
        if self.heading and tag in ("h2","h3","h4","h5","h6"):
            s=" ".join("".join(self.hparts).split())
            if re.fullmatch(r"ID\d{3}(?:\s*#)?",s):
                self.case=s[:5];self.rows.setdefault(self.case,[]);self.active=False
            elif "Download Scene Files" in s:self.finished=True
            self.heading=False
        if self.cell and tag in ("td","th"):
            self.cells.append(" ".join("".join(self.cparts).split()));self.cell=False
        if self.row and tag=="tr":
            self.row=False
            if self.case not in EXPECTED:return
            if self.cells[:4]==["Step","Begin","End","Activity"]:
                self.headers=self.cells;self.active=True
            elif self.active and len(self.cells)>=7 and self.cells[0].isdigit():
                self.rows[self.case].append(dict(zip(self.headers,self.cells)))

def seconds(x):
    check(bool(re.fullmatch(r"\d\d:\d\d:\d\d\.\d{3}",x)),"TIME_FORMAT_INVALID")
    h,m,s=x.split(":");check(int(h)<24 and int(m)<60 and float(s)<60,"TIME_INVALID")
    return 3600*int(h)+60*int(m)+float(s)

def inspect_scene(raw):
    check(isinstance(raw,bytes) and 0<len(raw)<=3*1024*1024,"SOURCE_BYTES_INVALID")
    try:page=raw.decode("utf-8")
    except UnicodeError:raise Hold("UTF8_INVALID") from None
    p=TableReader();p.feed(page);p.close()
    check({c:len(v) for c,v in p.rows.items()}==EXPECTED,"SCENE_LAYOUT_CHANGED_OR_INCOMPLETE")
    classes=Counter()
    for case,events in p.rows.items():
        for pos,e in enumerate(events,1):
            check(int(e["Step"])==pos,"STEP_ORDER_INVALID")
            check(seconds(e["Begin"])<=seconds(e["End"]),"INTERVAL_INVALID")
            classes["author_annotated_video_segment"]+=1
            if e["Activity"]=="Check-Out asset to user":classes["system_facing_video_label"]+=1
    return {"instances":len(p.rows),"segments":sum(len(x) for x in p.rows.values()),
            "category_counts":dict(classes),"html_sha256":sha256(raw).hexdigest()}

def fetch(url,cap):
    check(url in (SCENE_URL,FIGSHARE_URL),"UNEXPECTED_URL")
    with urlopen(Request(url,headers={"User-Agent":"IWXA-research-probe/0.1"}),timeout=18) as r:
        raw=r.read(cap+1)
    check(0<len(raw)<=cap,"DOWNLOAD_SIZE_HOLD")
    return raw

def analyze(scene,metadata=None):
    x=inspect_scene(scene)
    meta={"status":"NOT_FETCHED"}
    if metadata is not None:
        j=json.loads(metadata)
        check(j.get("id")==25246291 and isinstance(j.get("files"),list),"FIGSHARE_ID_HOLD")
        meta={"article_id":25246291,"file_count":len(j["files"]),
              "metadata_sha256":sha256(metadata).hexdigest(),"raw_media_downloaded":False}
    return {"schema":VERSION,"status":"PUBLISHED_AUTHOR_ANNOTATIONS_SCOPED",
            "source":{"url":SCENE_URL,"doi":"10.6084/m9.figshare.25246291",
                      "license_claim":"CC_BY_NC_4_0","html_sha256":x["html_sha256"],
                      "video_downloaded":False,"raw_annotations_redistributed":False},
            "observed_in_author_annotation":{"cases":x["instances"],
                "segments":x["segments"],"counts":x["category_counts"]},
            "repository_metadata":meta,
            "independence":{"annotations_derived_from_video":True,
               "separate_ITAM_transaction_log_loaded":False,
               "same_case_two_channel_comparison":"NOT_MEASURED",
               "video_independently_reviewed":False},
            "qualification":{"actual_work_truth":"NOT_MEASURED",
               "task_discovery":"NOT_MEASURED","false_confident_rate":"NOT_MEASURED",
               "task_to_result":"NOT_RUN"}}
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--scene-file",type=Path)
    p.add_argument("--out",type=Path,required=True)
    p.add_argument("--probe-figshare",action="store_true")
    a=p.parse_args()
    try:
        check(not a.out.exists() and a.out!=a.scene_file,"OUTPUT_OVERWRITE_HOLD")
        scene=a.scene_file.read_bytes() if a.scene_file else fetch(SCENE_URL,3*1024*1024)
        meta=None;metadata_hold=False
        if a.probe_figshare:
            try:meta=fetch(FIGSHARE_URL,2*1024*1024)
            except (URLError,HTTPError,Hold):metadata_hold=True
        r=analyze(scene,meta)
        if metadata_hold:r["repository_metadata"]={"status":"SOURCE_ACCESS_HOLD"}
        a.out.write_text(json.dumps(r,indent=2,sort_keys=True)+"\n")
        print("SOLVE4X_SCOPE",r["observed_in_author_annotation"]["cases"],"cases",
            r["observed_in_author_annotation"]["segments"],"segments",
            "two_channel",r["independence"]["same_case_two_channel_comparison"])
        return 0
    except (Hold,URLError,HTTPError,OSError,ValueError,KeyError) as e:
        print("SOLVE4X_SOURCE_HOLD",str(e)[:120],file=sys.stderr);return 2
if __name__=="__main__":raise SystemExit(main())
