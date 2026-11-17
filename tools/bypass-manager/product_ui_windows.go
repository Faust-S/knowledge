//go:build windows
package main

import ("path/filepath";"time";"unsafe")

var productGetDlgItem=userDLL.NewProc("GetDlgItem")
func (ui *managerUI) productDialogControl(id int) uintptr {
 handle,_,_:=productGetDlgItem.Call(ui.hwnd,uintptr(id))
 return handle
}
func (ui *managerUI) productDetailControls() []uintptr {
 return []uintptr{ui.refreshButton,ui.internetButton,ui.recoverButton,
  ui.productDialogControl(idReport),ui.prepareButton,ui.dnsButton,
  ui.networkButton,ui.pathButton,ui.appsButton,ui.mtuButton,ui.stabilityButton}
}
func (ui *managerUI) initProductUI() {
 ui.productEffect=ctrl(ui.hwnd,"STATIC","Эффект DPI: не измерен",0,idProductEffect,20,170,820,27)
 ui.productReason=ctrl(ui.hwnd,"STATIC","Ожидаю проверки",0,idProductReason,20,202,820,28)
 ui.productAge=ctrl(ui.hwnd,"STATIC","Последнее испытание: нет",0,idProductAge,20,233,820,24)
 ui.productManual=ctrl(ui.hwnd,"BUTTON","Ручные параметры",wsTabStop,idProductManual,20,500,200,33)
 winSetText(ui.guideButton,"Проверить и улучшить")
 winSetText(ui.liveButton,"Измерить скорость")
 winSetText(ui.recoverButton,"Выключить собственный DPI")
 winSetText(ui.dpiLine,"DPI сейчас: свой процесс не зарегистрирован")
 winSetText(ui.guideLine,"Нажмите «Проверить и улучшить». Amnezia управляется отдельно.")
 procEnable.Call(ui.stopButton,0);procShow.Call(ui.stopButton,0)
 ui.applyProductDetails()
}
func (ui *managerUI) applyProductDetails() {
 if ui.hwnd==0 || ui.productManual==0 {return}
 visible:=uintptr(0)
 if ui.details && !ui.advanced {visible=5}
 for _,c:=range ui.productDetailControls() {if c!=0 {procShow.Call(c,visible)}}
 for _,c:=range ui.advancedControls {
  vis:=uintptr(0)
  if ui.details && ui.advanced {vis=5}
  procShow.Call(c,vis)
 }
 if ui.details {procShow.Call(ui.productManual,5)}else{procShow.Call(ui.productManual,0)}
 if ui.details && !ui.advanced {procShow.Call(ui.logs,5)}else{procShow.Call(ui.logs,0)}
 if ui.details {winSetText(ui.advancedButton,"Скрыть подробности")}else{winSetText(ui.advancedButton,"Подробности")}
 if ui.advanced {winSetText(ui.productManual,"Вернуться к журналу")}else{winSetText(ui.productManual,"Ручные параметры")}
 ui.layout()
}
func (ui *managerUI) layoutProduct() {
 if ui.productEffect==0 {return}
 var rc winRect
 procClientRect.Call(ui.hwnd,uintptr(unsafe.Pointer(&rc)))
 w,h:=rc.R-rc.L,rc.B-rc.T
 if w<730 || h<560 {return}
 full:=uintptr(w-40)
 for i,c:=range []uintptr{ui.vpnLine,ui.netLine,ui.dpiLine} {procMove.Call(c,20,uintptr(80+27*i),full,24,1)}
 for i,c:=range []uintptr{ui.productEffect,ui.productReason,ui.productAge,ui.publicLine,ui.geoLine,ui.speedLine,ui.riskLine} {
  y:=[]int32{172,204,235,267,293,319,345}[i]
  procMove.Call(c,20,uintptr(y),full,26,1)
 }
 procMove.Call(ui.guideLine,20,375,uintptr(w-235),35,1)
 procMove.Call(ui.guideConfirm,uintptr(w-222),375,95,32,1)
 procMove.Call(ui.guideSkip,uintptr(w-120),375,100,32,1)
 span:=w-40
 widths:=[]int32{span*38/100,span*25/100,span*20/100}
 remaining:=span-widths[0]-widths[1]-widths[2]-24
 x:=int32(20)
 for i,c:=range []uintptr{ui.guideButton,ui.liveButton,ui.advancedButton,ui.stopButton} {
  width:=remaining
  if i<3 {width=widths[i]}
  procMove.Call(c,uintptr(x),418,uintptr(width),44,1)
  x+=width+8
 }
 procMove.Call(ui.status,20,474,full,24,1)
 procMove.Call(ui.productManual,20,500,200,32,1)
 // Compact the third diagnostics row before positioning the journal.
 // At 1040x744 the old log lift to h-90 obscured these native buttons.
 diagTop,diagStep:=int32(540),int32(40)
 if h<820 {diagTop,diagStep=525,34}
 for i,c:=range ui.productDetailControls() {
  if c==0 {continue}
  y:=diagTop+diagStep*int32(i/4)
  col:=int32(i%4)
  width:=(span-24)/4
  procMove.Call(c,uintptr(20+col*(width+8)),uintptr(y),uintptr(width),30,1)
 }
 if ui.details && ui.advanced {
  for i,c:=range ui.advancedControls {
   if c==0 {continue}
   originalY:=[]int32{523,517,523,517,523,517,562,557,562,557,605,598,635,635}[i]
   newY:=originalY+24
   oldX:=[]int32{20,160,422,494,606,703,20,160,430,533,20,160,20,272}[i]
   oldW:=[]int32{130,235,60,92,90,132,135,245,95,290,135,655,240,195}[i]
   oldH:=[]int32{22,26,22,26,22,320,22,27,22,250,22,27,35,35}[i]
   if i==11 {oldW=w-200}
   procMove.Call(c,uintptr(oldX),uintptr(newY),uintptr(oldW),uintptr(oldH),1)
  }
  return
 }
 // Never move the journal upward across diagnostic actions.
 top:=int32(668)
 if h<820 {top=638}
 if h-top-22 < 32 {
  procShow.Call(ui.logs,0)
  return
 }
 procMove.Call(ui.logs,20,uintptr(top),full,uintptr(h-top-22),1)
 if ui.details && !ui.advanced {procShow.Call(ui.logs,5)}
}
func (ui *managerUI) updateProductSummary() {
 var guide GuideReport;var speed LiveAudit
 var gp *GuideReport;var sp *LiveAudit
 if readStrictJSON(filepath.Join(ui.home,"results","latest-guide.json"),&guide)==nil {gp=&guide}
 if readStrictJSON(filepath.Join(ui.home,"results","latest-speed.json"),&speed)==nil {sp=&speed}
 summary:=productOverview(gp,sp,time.Now())
 winSetText(ui.productEffect,summary.DPI+". "+summary.Effect)
 winSetText(ui.productReason,summary.Reason)
 winSetText(ui.productAge,summary.When)
 if sp!=nil {winSetText(ui.speedLine,summary.Speed)}
 
}

func (ui *managerUI) invalidateOldPublicView(vpn VPNState) {
 ui.mu.Lock()
 view,audit:=ui.liveView,ui.liveAudit
 ui.mu.Unlock()
 if publicViewOutdated(view,audit,vpn,time.Now()) {
  winSetText(ui.publicLine,"Публичный IPv4: прежняя проба устарела или изменился VPN-маршрут. Повторите замер.")
  winSetText(ui.geoLine,"Регион IP: прежние сведения не относятся к подтверждённому текущему маршруту.")
  winSetText(ui.riskLine,"Выход через VPN требуется перепроверить после изменения маршрута.")
 }
}
