package main

import (
 "fmt"
 "math"
 "sort"
 "strings"
 "time"
)

// ProductOverview is an interpretation of recorded tests, not proof of a
// native VPN handshake, browser egress or uninterrupted video.
type ProductOverview struct {
 DPI string
 Effect string
 Reason string
 Speed string
 When string
}

type DPIEffect struct {
 State string `json:"state"`
 Protocol string `json:"protocol,omitempty"`
 Profile string `json:"profile,omitempty"`
 ControlMbps float64 `json:"control_mbps,omitempty"`
 ProfileMbps float64 `json:"profile_mbps,omitempty"`
 MatchedSamples int `json:"matched_samples,omitempty"`
}

func observedDPIEvent(report *GuideReport) (bool,string,string) {
 if report==nil {return false,"",""}
 ever:=false
 var protocol,profile string
 for _,e:=range report.Events {
  if e.Stage=="FILTER" && e.Code=="OWN_DPI_STARTED" && e.DPIProfile!="" && e.DPIProfile!="NONE" {
   ever,protocol,profile=true,e.Protocol,e.DPIProfile
  }
 }
 return ever,protocol,profile
}

func guideRoundSpeeds(r GuideRound) map[string][]float64 {
 out:=map[string][]float64{}
 for _,sample:=range r.Transfers {
  if !sample.OK || sample.Bytes!=sample.ExpectedBytes || sample.ExpectedBytes<1024*1024 ||
   sample.Seconds<=0 || sample.Mbps<=0 || math.IsNaN(sample.Mbps) || math.IsInf(sample.Mbps,0) || sample.Source=="" {continue}
  key:=fmt.Sprintf("%s/%d",sample.Source,sample.ExpectedBytes)
  out[key]=append(out[key],sample.Mbps)
 }
 return out
}

// A valid comparison requires the same protocol, source and byte count,
// a confirmed direct baseline, two full matched downloads on each side and
// observations of actual adapter traffic. Any gain is only a candidate.
func assessDPIEffect(r *GuideReport) DPIEffect {
 result:=DPIEffect{State:"NOT_TESTED"}
 ever,_,_:=observedDPIEvent(r)
 if !ever {return result}
 result.State="NOT_COMPARABLE"
 if r==nil || r.CompletedUTC=="" || r.State=="IN_PROGRESS" {return result}
 for _,filtered:=range r.Rounds {
  if filtered.DPIProfile=="NONE" || filtered.CompletedUTC=="" ||
   !filtered.RouteObserved || !filtered.AdapterFlow || !filtered.EgressChanged || !filtered.BaselineKnown {continue}
  started:=false
  for _,e:=range r.Events {
   if e.Stage=="FILTER" && e.Code=="OWN_DPI_STARTED" && e.Protocol==filtered.Protocol && e.DPIProfile==filtered.DPIProfile {started=true;break}
  }
  if !started {continue}
  for _,control:=range r.Rounds {
   if control.Protocol!=filtered.Protocol || control.DPIProfile!="NONE" || control.CompletedUTC=="" ||
    !control.RouteObserved || !control.AdapterFlow || !control.EgressChanged || !control.BaselineKnown {continue}
   a,b:=guideRoundSpeeds(control),guideRoundSpeeds(filtered)
   for key,base:=range a {
    changed:=b[key]
    matches:=len(base)
    if len(changed)<matches {matches=len(changed)}
    if matches<2 {continue}
    x,y:=append([]float64{},base[:matches]...),append([]float64{},changed[:matches]...)
    sort.Float64s(x);sort.Float64s(y)
    xVal,yVal:=x[matches/2],y[matches/2]
    if xVal<=0 || yVal<=0 {continue}
    result=DPIEffect{State:"NO_CLEAR_GAIN",Protocol:filtered.Protocol,Profile:filtered.DPIProfile,
     ControlMbps:xVal,ProfileMbps:yVal,MatchedSamples:matches}
    if yVal>=xVal*1.2 {result.State="POSSIBLE_IMPROVEMENT"}
    if yVal<=xVal*0.8 {result.State="POSSIBLE_REGRESSION"}
    return result
   }
  }
 }
 return result
}
func howOld(s string,now time.Time) (string,bool) {
 t,err:=time.Parse(time.RFC3339Nano,s)
 if err!=nil || t.After(now.Add(time.Minute)) {return "время неизвестно",true}
 elapsed:=now.Sub(t)
 if elapsed<0 {elapsed=0}
 if elapsed<time.Minute {return "только что",false}
 if elapsed<15*time.Minute {return fmt.Sprintf("%d мин назад",int(elapsed.Minutes())),false}
 if elapsed<24*time.Hour {return fmt.Sprintf("%d мин назад, устарело",int(elapsed.Minutes())),true}
 return fmt.Sprintf("%d дн назад, устарело",int(elapsed.Hours()/24)),true
}
func productOverview(guide *GuideReport,live *LiveAudit,now time.Time) ProductOverview {
 out:=ProductOverview{DPI:"DPI: не применялся в последнем испытании",Effect:"Эффект DPI: не измерен",
  Reason:"Начните с проверки соединения. Amnezia управляется отдельно.",
  Speed:"Скорость: нет свежего измерения",When:"Испытаний ещё нет"}
 if guide!=nil {
  stamp:=guide.CompletedUTC
  if stamp=="" {stamp=guide.StartedUTC}
  age,stale:=howOld(stamp,now)
  out.When="Последнее испытание: "+age
  started,protocol,profile:=observedDPIEvent(guide)
  if started {out.DPI="DPI: профиль "+profile+" ("+protocol+") проверялся; текущий статус отдельно"}
  effect:=assessDPIEffect(guide)
  switch effect.State {
  case "POSSIBLE_IMPROVEMENT":out.Effect=fmt.Sprintf("Эффект DPI: возможно лучше %.1f → %.1f Мбит/с",effect.ControlMbps,effect.ProfileMbps)
  case "POSSIBLE_REGRESSION":out.Effect=fmt.Sprintf("Эффект DPI: возможно хуже %.1f → %.1f Мбит/с",effect.ControlMbps,effect.ProfileMbps)
  case "NO_CLEAR_GAIN":out.Effect="Эффект DPI: заметное улучшение не подтверждено"
  case "NOT_COMPARABLE":out.Effect="Эффект DPI: сравнение до/после не состоялось"
  default:out.Effect="Эффект DPI: не измерен (испытаний с DPI не было)"
  }
  switch guide.State {
  case "DIAGNOSTIC_SERVICES_UNAVAILABLE":out.Reason="HTTPS-тесты в мастере не завершились. Это не доказывает неисправность Amnezia."
  case "CANCELLED","GUIDE_INCOMPLETE":out.Reason="Испытание прервано, результат не подтверждён."
  case "DPI_STOP_ERROR","OWN_FILTER_RECOVERY_REQUIRED":out.Reason="Требуется проверить остановку собственного DPI-процесса."
  case "VIDEO_CANDIDATE_EGRESS_UNVERIFIED","WEB_USABLE_VPN_UNVERIFIED":out.Reason="HTTPS-загрузка работает, но выход именно через VPN не подтверждён."
  default:
   if len(guide.Rounds)>0 && strings.EqualFold(guide.Rounds[0].DPIProfile,"NONE") && !started {
    out.Reason="Мастер проверял подключение без DPI. Об улучшении судить нельзя."
   }
  }
  if stale {out.Reason="Это прошлое испытание; состояние сети могло измениться. "+out.Reason}
 }
 if live!=nil {
  age,stale:=howOld(live.CheckedUTC,now)
  if live.Successful>=2 && live.MinMbps>0 && live.SpeedGrade!="SPEED_NOT_VERIFIED" {
   out.Speed=fmt.Sprintf("HTTPS: %.1f–%.1f Мбит/с (%s)",live.MinMbps,live.MedianMbps,age)
   if !live.VPNRouteObserved || live.BaselineState=="VPN_ROUTE_UNVERIFIED" {
    out.Speed+="; маршрут VPN не подтверждён"
   }
  }else{out.Speed="Скорость: не подтверждена ("+age+")"}
  if stale {out.Speed+=". Нужна новая проверка"}
 }
 return out
}
