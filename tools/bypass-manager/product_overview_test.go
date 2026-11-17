package main
import ("strings";"testing";"time")

func TestDPIShownAsNotAppliedWhenOnlyNone(t *testing.T) {
 now:=time.Date(2026,11,17,15,0,0,0,time.UTC)
 r:=&GuideReport{CompletedUTC:now.Add(-time.Hour).Format(time.RFC3339),State:"DIAGNOSTIC_SERVICES_UNAVAILABLE",Rounds:[]GuideRound{{Protocol:guideAWG,DPIProfile:"NONE",State:"INCONCLUSIVE",CompletedUTC:"completed",Video:VideoAssessment{Grade:"INCOMPLETE"}}}}
 live:=&LiveAudit{CheckedUTC:now.Add(-time.Hour).Format(time.RFC3339),Successful:3,MinMbps:7.35,MedianMbps:11.97,SpeedGrade:"HD_720P_CANDIDATE",BaselineState:"VPN_ROUTE_UNVERIFIED"}
 out:=productOverview(r,live,now)
 if !strings.Contains(out.DPI,"не применялся") || !strings.Contains(out.Effect,"не измерен") {t.Fatal(out)}
 if !strings.Contains(out.Speed,"устарело")||!strings.Contains(out.Speed,"маршрут VPN не подтверждён") {t.Fatal(out)}
 if !strings.Contains(out.Reason,"не доказывает неисправность") {t.Fatal(out)}
}
func TestDPIStartedButNoValidControlDoesNotClaimSuccess(t *testing.T) {
 now:=time.Now().UTC()
 r:=&GuideReport{CompletedUTC:now.Format(time.RFC3339),State:"ALL_PROTOCOLS_UNVERIFIED",Events:[]GuideEvent{{Stage:"FILTER",Code:"CHECKING_LUA_AND_STARTING_OWN_DPI",DPIProfile:"TLS-SPLIT"},{Stage:"FILTER",Code:"OWN_DPI_STARTED",Protocol:guideVLESS,DPIProfile:"TLS-SPLIT"}},Rounds:[]GuideRound{{Protocol:guideVLESS,DPIProfile:"NONE",State:"FAILED",CompletedUTC:"done"},{Protocol:guideVLESS,DPIProfile:"TLS-SPLIT",State:"FAILED",CompletedUTC:"done"}}}
 if got:=assessDPIEffect(r);got.State!="NOT_COMPARABLE" {t.Fatal(got)}
 s:=productOverview(r,nil,now)
 if !strings.Contains(s.DPI,"TLS-SPLIT") || !strings.Contains(s.Effect,"не состоялось") {t.Fatal(s)}
}
func TestDPITraceWithoutStartedDoesNotCount(t *testing.T) {
 r:=&GuideReport{Events:[]GuideEvent{{Stage:"FILTER",Code:"CHECKING_LUA_AND_STARTING_OWN_DPI",DPIProfile:"TLS-SPLIT"}}}
 if e,_,_:=observedDPIEvent(r);e {t.Fatal("preflight is not DPI")}
 if x:=assessDPIEffect(r);x.State!="NOT_TESTED" {t.Fatal(x)}
}
func successfulGuideTransfers(source string, mbps float64) []GuideTransfer {
 return []GuideTransfer{{Source:source,OK:true,ExpectedBytes:2097152,Bytes:2097152,Seconds:1,Mbps:mbps},{Source:source,OK:true,ExpectedBytes:2097152,Bytes:2097152,Seconds:1,Mbps:mbps*1.02}}
}
func TestMatchedDPIComparisonCandidateOnly(t *testing.T) {
 r:=&GuideReport{CompletedUTC:"complete",State:"ALL_PROTOCOLS_UNVERIFIED",Events:[]GuideEvent{{Stage:"FILTER",Code:"OWN_DPI_STARTED",Protocol:guideAWG,DPIProfile:"UDP-FAKE"}},Rounds:[]GuideRound{
  {Protocol:guideAWG,DPIProfile:"NONE",RouteObserved:true,AdapterFlow:true,EgressChanged:true,BaselineKnown:true,CompletedUTC:"done",Transfers:successfulGuideTransfers("TEST_CDN_A",4)},
  {Protocol:guideAWG,DPIProfile:"UDP-FAKE",RouteObserved:true,AdapterFlow:true,EgressChanged:true,BaselineKnown:true,CompletedUTC:"done",Transfers:successfulGuideTransfers("TEST_CDN_A",9)},
 }}
 x:=assessDPIEffect(r)
 if x.State!="POSSIBLE_IMPROVEMENT" || x.MatchedSamples!=2 {t.Fatal(x)}
 r.Rounds[0].EgressChanged=false
 if x=assessDPIEffect(r);x.State!="NOT_COMPARABLE" {t.Fatal("direct egress was incorrectly compared",x)}
 r.Rounds[0].EgressChanged=true
 r.Rounds[1].Transfers=successfulGuideTransfers("TEST_CDN_B",20)
 if x=assessDPIEffect(r);x.State!="NOT_COMPARABLE" {t.Fatal("different CDN was compared",x)}
}
func TestStaleMeasurementAge(t *testing.T) {
 now:=time.Date(2026,11,17,15,0,0,0,time.UTC)
 cases:=[]struct{age time.Duration;stale bool}{{0,false},{5*time.Minute,false},{15*time.Minute,true},{90*time.Minute,true}}
 for _,c:=range cases {_,old:=howOld(now.Add(-c.age).Format(time.RFC3339),now);if old!=c.stale {t.Fatalf("%v: %v",c.age,old)}}
 if _,stale:=howOld("garbled",now);!stale {t.Fatal("accepted unknown time")}
}
