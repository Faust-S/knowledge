package main

import (
    "encoding/json"
    "strings"
    "testing"
)

func outerFixture(protocol string) OuterEndpoint {
    s:=OuterEndpoint{SchemaVersion:"0.3.5", Status:"OBSERVED", Protocol:protocol,
        IPv4:"9.9.9.9", Port:443, Transport:"AWG-UDP", Source:"WFP_UDP",
        PhysicalRoute:true,Signals:2,AgeSeconds:5}
    if protocol==guideVLESS {s.Transport="REALITY-TCP";s.Source="XRAY_TCP"}
    return s
}
func TestOuterEndpointEvidenceMatrix(t *testing.T) {
    cases:=[]struct{name string;protocol string;change func(*OuterEndpoint);ok bool}{
        {"awg",guideAWG,func(*OuterEndpoint){},true},
        {"awg-native-one-fresh-peer",guideAWG,func(s *OuterEndpoint){s.Source="AWG_NATIVE";s.Signals=1},true},
        {"awg-native-no-route",guideAWG,func(s *OuterEndpoint){s.Source="AWG_NATIVE";s.Signals=1;s.PhysicalRoute=false},false},
        {"vless",guideVLESS,func(*OuterEndpoint){},true},
        {"vless-wfp",guideVLESS,func(s *OuterEndpoint){s.Source="WFP_TCP"},true},
        {"private-ip",guideAWG,func(s *OuterEndpoint){s.IPv4="10.0.0.1"},false},
        {"documentation-ip",guideAWG,func(s *OuterEndpoint){s.IPv4="192.0.2.1"},false},
        {"loopback-ip",guideAWG,func(s *OuterEndpoint){s.IPv4="127.0.0.1"},false},
        {"wrong-transport",guideAWG,func(s *OuterEndpoint){s.Transport="REALITY-TCP"},false},
        {"wrong-source",guideAWG,func(s *OuterEndpoint){s.Source="XRAY_TCP"},false},
        {"wrong-protocol",guideAWG,func(s *OuterEndpoint){s.Protocol=guideVLESS},false},
        {"port-0",guideAWG,func(s *OuterEndpoint){s.Port=0},false},
        {"port-overflow",guideAWG,func(s *OuterEndpoint){s.Port=65536},false},
        {"no-physical-route",guideAWG,func(s *OuterEndpoint){s.PhysicalRoute=false},false},
        {"single-observation",guideAWG,func(s *OuterEndpoint){s.Signals=1},false},
        {"too-many-observations",guideAWG,func(s *OuterEndpoint){s.Signals=601},false},
        {"stale-observation",guideAWG,func(s *OuterEndpoint){s.AgeSeconds=91},false},
        {"negative-observation",guideAWG,func(s *OuterEndpoint){s.AgeSeconds=-1},false},
        {"bad-schema",guideAWG,func(s *OuterEndpoint){s.SchemaVersion="0.0.0"},false},
    }
    for _,tc:=range cases {t.Run(tc.name,func(t *testing.T){
        s:=outerFixture(tc.protocol);tc.change(&s); b,_:=json.Marshal(s)
        _,code:=parseOuterEndpointEvidence(b,tc.protocol)
        if (code=="OBSERVED")!=tc.ok {t.Fatalf("outcome %s, expected valid=%t",code,tc.ok)}
    })}
}
func TestOuterEndpointUnknownStates(t *testing.T) {
    for _,status:=range []string{"NO_TRUSTED_PROCESS","NO_OUTER_TRANSPORT","AMBIGUOUS","INSUFFICIENT_SIGNALS","PROBE_ERROR"} {
        s:=outerFixture(guideAWG);s.Status=status;b,_:=json.Marshal(s)
        _,code:=parseOuterEndpointEvidence(b,guideAWG)
        if code!=status {t.Fatalf("state %s -> %s",status,code)}
    }
    for _,bad:=range []string{"", "null", "{}", "[]", "xyz", "{\"status\":\"OBSERVED\",\"secret\":\"key\"}"} {
        _,code:=parseOuterEndpointEvidence([]byte(bad),guideAWG)
        if code=="OBSERVED" {t.Fatal("accepted malformed input")}
    }
}
func TestOuterEndpointNotInGuideReport(t *testing.T) {
    s:=outerFixture(guideAWG)
    r:=GuideReport{State:"IN_PROGRESS",Events:[]GuideEvent{{Code:automaticEndpointCode("OBSERVED")}}}
    b,_:=json.Marshal(r)
    if strings.Contains(string(b),s.IPv4) || strings.Contains(string(b),"endpoint_ipv4") {
        t.Fatal("private endpoint leaked")
    }
}
