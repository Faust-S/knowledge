//go:build windows

package main

import (
	"context"
	"time"
)

// Three minutes is enough for a manual Amnezia switch, but is bounded.
// The only way to continue is an explicit click in the main window.
const guideUserActionTimeout = 3 * time.Minute

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
	ui.mu.Unlock()
	post(ui.hwnd, wmAppGuidePrompt)
	outcome := waitGuideResponse(ctx, response, guideUserActionTimeout)
	ui.mu.Lock()
	if ui.guidePrompt == response {
		ui.guidePrompt = nil
	}
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
	step := ui.guideStep
	ui.mu.Unlock()
	visibility := uintptr(0)
	if pending && ui.guiding && !ui.closing {
		visibility = 5
	}
	procShow.Call(ui.guideConfirm, visibility)
	procShow.Call(ui.guideSkip, visibility)
	if visibility != 0 {
		winSetText(ui.guideLine, "Сделайте действие в Amnezia по инструкции в журнале, затем нажмите «Готово».")
		ui.setStatus("Ожидаю подтверждения в этом окне (не более 3 минут). «Остановить» доступно.")
	} else {
		winSetText(ui.guideLine, step)
		if ui.guiding && ui.running && !ui.closing {
			ui.setStatus("Мастер выполняет проверки. Остановить можно в любой момент.")
		}
	}
}
