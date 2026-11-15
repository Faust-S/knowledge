//go:build !windows

package main

// Windows desktop UI is not available in the Linux test host.
func guiMain() int { return 2 }
