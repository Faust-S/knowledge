//go:build windows

package main

import (
	"context"
	"time"
)

// Three minutes is enough for a manual Amnezia switch, but is bounded.
// The only way to continue is an explicit click in the main window.
const guideUserActionTimeout = 3 * time.Minute

// Both answer buttons select the currently active Amnezia protocol. A user
// choice is not native proof; the program never reads a private VPN profile.
func (ui *managerUI) guideChooseProtocol(ctx context.Context) string {
 ui.guideInstruction("Проверка загрузит данные с внешних HTTPS-сервисов, которые увидят ваш IP. Выберите текущий протокол Amnezia Premium: AmneziaWG или VLESS. Настройки и ключи VPN не читаются.")
 response:=make(chan bool,1)
 ui.mu.Lock()
 if ui.guidePrompt!=nil {ui.mu.Unlock();return ""}
 ui.guidePrompt=response
 ui.guidePromptMode="PROTOCOL"
 ui.mu.Unlock()
 post(ui.hwnd,wmAppGuidePrompt)
 outcome:=waitGuideResponse(ctx,response,guideUserActionTimeout)
 ui.mu.Lock()
 if ui.guidePrompt==response {ui.guidePrompt=nil}
 ui.guidePromptMode=""
 ui.mu.Unlock()
 post(ui.hwnd,wmAppGuidePrompt)
 switch outcome {
 case guidePromptConfirmed:
  ui.guideInstruction("Пользователь выбрал AmneziaWG; протокол не проверен через API.")
  return guideAWG
 case guidePromptDeclined:
  ui.guideInstruction("Пользователь выбрал VLESS; начну с текущего протокола, не переключая AmneziaWG.")
  return guideVLESS
 default:
  ui.guideInstruction("Выбор протокола отменён; испытания не запускались.")
  return ""
 }
}

func (ui *managerUI) guideAsk(ctx context.Context, message string) bool {
	ui.guideInstruction(message)
	response := make(chan bool, 1)
	ui.mu.Lock()
	if ui.guidePrompt != nil {
		ui.mu.Unlock()
		ui.guideInstruction("Другая операция уже ожидает подтверждения. Невозможно начать второй запрос.")
		return false
	}
	ui.guidePrompt = response
	ui.guidePromptMode = "CONFIRM"
	ui.mu.Unlock()
	post(ui.hwnd, wmAppGuidePrompt)
	outcome := waitGuideResponse(ctx, response, guideUserActionTimeout)
	ui.mu.Lock()
	if ui.guidePrompt == response {
		ui.guidePrompt = nil
	}
	ui.guidePromptMode = ""
	ui.mu.Unlock()
	post(ui.hwnd, wmAppGuidePrompt)
	switch outcome {
	case guidePromptConfirmed:
		ui.guideInstruction("Действие подтверждено пользователем; состояние Amnezia ещё будет проверено по сетевым признакам.")
		return true
	case guidePromptTimedOut:
		ui.guideInstruction("Не получено подтверждение в течение 3 минут. Этап прекращён, ожидание завершено.")
	case guidePromptCancelled:
		ui.guideInstruction("Ожидание действия отменено кнопкой «Остановить» или закрытием приложения.")
	default:
		ui.guideInstruction("Пользователь отказался от действия. Не запускаю неподтверждённый DPI.")
	}
	return false
}

// Must be called on the window event-loop thread. An answer is sent at most
// once; a timed-out or cancelled prompt cannot later approve a different step.
func (ui *managerUI) answerGuidePrompt(accept bool) {
	ui.mu.Lock()
	response := ui.guidePrompt
	ui.guidePrompt = nil
	ui.mu.Unlock()
	if response != nil {
		select {
		case response <- accept:
		default:
		}
	}
	post(ui.hwnd, wmAppGuidePrompt)
}

// UI controls are updated only on the window thread. Their presence is the
// visible prompt; the full human instruction stays in the local event log.
func (ui *managerUI) refreshGuidePromptControls() {
	ui.mu.Lock()
	pending := ui.guidePrompt != nil
	mode := ui.guidePromptMode
	step := ui.guideStep
	ui.mu.Unlock()
	visibility := uintptr(0)
	if pending && ui.guiding && !ui.closing {
		visibility = 5
	}
	procShow.Call(ui.guideConfirm, visibility)
	procShow.Call(ui.guideSkip, visibility)
	if visibility != 0 {
        if mode == "PROTOCOL" {
            winSetText(ui.guideConfirm,"AmneziaWG")
            winSetText(ui.guideSkip,"VLESS")
            winSetText(ui.guideLine,"Выберите протокол, который сейчас включён в Amnezia Premium.")
        } else {
            winSetText(ui.guideConfirm,"Готово")
            winSetText(ui.guideSkip,"Нет / пропустить")
            winSetText(ui.guideLine,"Выполните указанное действие в Amnezia, затем подтвердите его здесь.")
        }
		ui.setStatus("Ожидаю подтверждения в этом окне (не более 3 минут). «Остановить» доступно.")
	} else {
        winSetText(ui.guideConfirm,"Готово")
        winSetText(ui.guideSkip,"Нет / пропустить")
		winSetText(ui.guideLine, step)
		if ui.guiding && ui.running && !ui.closing {
			ui.setStatus("Мастер выполняет проверки. Остановить можно в любой момент.")
		}
	}
}
