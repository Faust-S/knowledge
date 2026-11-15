//go:build windows

package main

import (
	"errors"
	"os"
	"strings"
	"syscall"
	"unsafe"
)

var (
	shell32       = syscall.NewLazyDLL("shell32.dll")
	isUserAnAdmin = shell32.NewProc("IsUserAnAdmin")
	shellExecuteW = shell32.NewProc("ShellExecuteW")
)

// Windows-only elevation: one explicit Windows UAC confirmation, never disable UAC.
func maybeRelaunchElevated() (bool, error) {
	elevated, _, _ := isUserAnAdmin.Call()
	if elevated != 0 {
		return false, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return false, err
	}
	var params []string
	for _, arg := range os.Args[1:] {
		params = append(params, syscall.EscapeArg(arg))
	}
	verb, _ := syscall.UTF16PtrFromString("runas")
	target, _ := syscall.UTF16PtrFromString(exe)
	args, _ := syscall.UTF16PtrFromString(strings.Join(params, " "))
	rc, _, _ := shellExecuteW.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)), uintptr(unsafe.Pointer(args)), 0, 1)
	if rc <= 32 {
		return false, errors.New("не удалось получить повышение через Windows UAC; действия с WinDivert не запускались")
	}
	return true, nil
}
