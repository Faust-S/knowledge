"""Run the actual public Rust4PM release on isolated modelled event logs."""
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import sys
import r4pm
from r4pm import bindings

assert version("r4pm") == "0.6.2"
def run(operation):
    if operation == "discover_dfg":
        with TemporaryDirectory() as root:
            path=Path(root)/"log.xes"
            path.write_text("""<?xml version="1.0" encoding="UTF-8"?>
<log xes.version="1.0" xes.features="nested-attributes" xmlns="http://www.xes-standard.org/">
<trace><string key="concept:name" value="case-1"/><event><string key="concept:name" value="prepare"/></event><event><string key="concept:name" value="check"/></event><event><string key="concept:name" value="finish"/></event></trace>
<trace><string key="concept:name" value="case-2"/><event><string key="concept:name" value="prepare"/></event><event><string key="concept:name" value="check"/></event><event><string key="concept:name" value="check"/></event><event><string key="concept:name" value="finish"/></event></trace>
</log>""",encoding="utf-8")
            data=bindings.discover_dfg(r4pm.import_item("EventLog",str(path)))
    else:
        objects=[{"id":f"o{i}","type":"order","attributes":[]} for i in (1,2)]
        objects.append({"id":"p1","type":"part","attributes":[]})
        if operation=="discover_ocel_variants":
            objects.append({"id":"o3","type":"order","attributes":[]})
        events=[]
        for i,sequence in ((1,["prepare","check","finish"]),(2,["prepare","check","check","finish"])):
            for j,kind in enumerate(sequence):
                rel=[{"objectId":f"o{i}","qualifier":"case"}]
                if i==2 and kind=="check":
                    rel.append({"objectId":"p1","qualifier":"checked"})
                events.append({"id":f"e{i}-{j}","type":kind,"time":f"2026-01-0{i}T12:0{j}:00Z","attributes":[],"relationships":rel})
        source={"eventTypes":[{"name":k,"attributes":[]} for k in ("prepare","check","finish")],
                "objectTypes":[{"name":k,"attributes":[]} for k in ("order","part")],
                "objects":objects,"events":events}
        with TemporaryDirectory() as root:
            path=Path(root)/"log.json"
            path.write_text(json.dumps(source),encoding="utf-8")
            linked=bindings.slim_link_ocel(ocel=r4pm.import_item("OCEL",str(path)))
            data=bindings.num_events(ocel=linked) if operation=="count_ocel" else bindings.discover_dfg_from_ocel(linked)
            if operation=="discover_ocel_variants":
                data={**data,"object_type_to_variants":{name:bindings.get_variants_of_object_type(linked,name) for name in data["object_type_to_dfg"]}}
    return {"engine":"Rust4PM","version":version("r4pm"),"operation":operation,"data":data}
if __name__=="__main__":
    assert sys.argv[1] in {"count_ocel","discover_ocdfg","discover_dfg","discover_ocel_variants"}
    print(json.dumps(run(sys.argv[1]),ensure_ascii=False,allow_nan=False,separators=(",",":")))
