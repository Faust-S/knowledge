//go:build windows

package main

import "strconv"

func formatMbps(v float64) string { return strconv.FormatFloat(v, 'f', 1, 64) }
func formatInt(v int) string      { return strconv.Itoa(v) }
