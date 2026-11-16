//go:build !windows

package main

import "os/exec"

func hideChildConsole(_ *exec.Cmd) {}
