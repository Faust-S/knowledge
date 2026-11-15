//go:build !windows

package main

func maybeRelaunchElevated() (bool, error) { return false, nil }
