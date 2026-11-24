"""Public, generated interoperability fixture. No private source or data.
Run the same upstream pinned functions as the existing Agent worker.
"""
from importlib.metadata import version
from pathlib import Path
import json
import sys
import r4pm
from r4pm import bindings

assert version("r4pm") == "0.6.2"
root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
traces = [["cut", "inspect"], ["cut", "rework", "inspect"]]
objects = [{"id": "order1", "type": "order", "attributes": [], "relationships": []},
           {"id": "order2", "type": "order", "attributes": [], "relationships": []},
           {"id": "material1", "type": "material", "attributes": [], "relationships": []}]
events = []
xes = ['<?xml version="1.0" encoding="UTF-8"?>',
       '<log xes.version="1.0" xmlns="http://www.xes-standard.org/">']
seq = 0
for i, trace in enumerate(traces, 1):
    xes.append('<trace><string key="concept:name" value="order%d"/>' % i)
    for name in trace:
        seq += 1
        when = "2026-11-24T08:%02d:00Z" % seq
        rels = [{"objectId": "order%d" % i, "qualifier": "order"}]
        if name == "cut":
            rels.append({"objectId": "material1", "qualifier": "material"})
        events.append({"id": "e%d" % seq, "type": name, "time": when,
                       "attributes": [], "relationships": rels})
        xes.append('<event><string key="concept:name" value="%s"/><date key="time:timestamp" value="%s"/></event>' % (name, when))
    xes.append("</trace>")
xes.append("</log>")
ocel = {"eventTypes": [{"name": n, "attributes": []} for n in ("cut", "inspect", "rework")],
        "objectTypes": [{"name": n, "attributes": []} for n in ("order", "material")],
        "objects": objects, "events": events}
(root/"input.json").write_text(json.dumps(ocel), encoding="utf-8")
(root/"input.xes").write_text("".join(xes), encoding="utf-8")
def save(op, data):
    (root/(op+".json")).write_text(json.dumps(
        {"engine": "Rust4PM", "version": version("r4pm"), "operation": op, "data": data},
        ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
item = r4pm.import_item("OCEL", str(root/"input.json"))
linked = bindings.slim_link_ocel(ocel=item)
save("count_ocel", bindings.num_events(ocel=linked))
save("discover_ocdfg", bindings.discover_dfg_from_ocel(linked))
log = r4pm.import_item("EventLog", str(root/"input.xes"))
save("discover_dfg", bindings.discover_dfg(log))
print("ACTIVITY_R4PM_0_6_2_REAL_OUTPUTS_WRITTEN")

# Independent baseline with the same two orders, without the rework event.
# This is a modelled input, processed by the pinned actual upstream functions.
baseline = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<log xes.version="1.0" xmlns="http://www.xes-standard.org/">']
for i in (1, 2):
    baseline.append('<trace><string key="concept:name" value="order%d"/>' % i)
    for j, name in enumerate(("cut", "inspect")):
        when = "2026-11-24T07:%02d:00Z" % (i * 2 + j)
        baseline.append('<event><string key="concept:name" value="%s"/><date key="time:timestamp" value="%s"/></event>' % (name, when))
    baseline.append("</trace>")
baseline.append("</log>")
(root/"baseline.xes").write_text("".join(baseline), encoding="utf-8")
base_log = r4pm.import_item("EventLog", str(root/"baseline.xes"))
(root/"baseline_dfg.json").write_text(json.dumps({
    "engine": "Rust4PM", "version": version("r4pm"), "operation": "discover_dfg",
    "data": bindings.discover_dfg(base_log)}, ensure_ascii=False, allow_nan=False), encoding="utf-8")
print("ACTIVITY_R4PM_0_6_2_REAL_COMPARISON_PAIR_WRITTEN")
