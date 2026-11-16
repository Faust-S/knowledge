//go:build windows

package main

import (
	"os/exec"
	"testing"
)

func TestPowershellChildConsoleIsHidden(t *testing.T) {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "exit 0")
	hideChildConsole(cmd)
	attr := cmd.SysProcAttr
	if attr == nil || !attr.HideWindow || attr.CreationFlags&createNoWindow == 0 {
		t.Fatal("PowerShell child console window would be visible")
	}
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("hidden PowerShell execution failed: %v, output=%s", err, output)
	}
}
