package main

import (
	"regexp"
	"strings"
)

// Operational settings (endpoint and selected adapter) never enter public reports.
// Each report is copied before redaction; the live measurements remain usable
// for comparisons and state transitions.
func redactedReport(in Report) Report {
	out := in
	out.EndpointIPv4 = ""
	out.AdapterName = ""
	out.Caveat = redactText(out.Caveat)
	out.Baseline = redactEgress(in.Baseline)
	if in.BaselineIPv6 != nil {
		base6 := redactEgress(*in.BaselineIPv6)
		out.BaselineIPv6 = &base6
	}
	out.Trials = make([]Trial, len(in.Trials))
	for i, t := range in.Trials {
		out.Trials[i] = t
		if t.Error != "" {
			out.Trials[i].Error = "DETAILS_REDACTED"
		}
		out.Trials[i].Attempts = make([]Probe, len(t.Attempts))
		for j, p := range t.Attempts {
			out.Trials[i].Attempts[j] = redactProbe(p)
		}
	}
	out.Monitoring = make([]Probe, len(in.Monitoring))
	for i, p := range in.Monitoring {
		out.Monitoring[i] = redactProbe(p)
	}
	return out
}
func redactEgress(in EgressResult) EgressResult {
	in.IP = ""
	out := make([]EgressSample, len(in.Samples))
	copy(out, in.Samples)
	for i := range out {
		out[i].IP = ""
	}
	in.Samples = out
	return in
}
func redactProbe(in Probe) Probe {
	in.EndpointRoute = nil
	in.Reason = redactProbeReason(in.Reason)
	in.DNSPrivacyNote = redactText(in.DNSPrivacyNote)
	in.Egress = redactEgress(in.Egress)
	if in.EgressIPv6 != nil {
		ipv6 := redactEgress(*in.EgressIPv6)
		in.EgressIPv6 = &ipv6
	}
	in.AdapterBefore = redactAdapter(in.AdapterBefore)
	in.AdapterAfter = redactAdapter(in.AdapterAfter)
	downloads := make([]DownloadResult, len(in.Downloads))
	copy(downloads, in.Downloads)
	for i := range downloads {
		if downloads[i].Error != "" {
			downloads[i].Error = "NETWORK_ERROR_REDACTED"
		}
	}
	in.Downloads = downloads
	return in
}
func redactAdapter(in *AdapterStats) *AdapterStats {
	if in == nil {
		return nil
	}
	out := *in
	out.Name = ""
	return &out
}

var reportIPv4 = regexp.MustCompile(`\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b`)
var reportEmail = regexp.MustCompile(`(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b`)
var reportWindowsPath = regexp.MustCompile(`(?i)\b[a-z]:\\[^\r\n\t ]+`)
var reportUserPath = regexp.MustCompile(`(?:/home/|/Users/)[^\s]+`)

func redactProbeReason(s string) string {
	// Discovery errors can include user-chosen adapter names and PowerShell
	// diagnostics. Keep the evidence class, not these private free-text details.
	if strings.HasPrefix(s, "нужна точная идентификация адаптера:") {
		return "ADAPTER_DISCOVERY_UNVERIFIED"
	}
	return redactText(s)
}

func redactText(s string) string {
	s = reportWindowsPath.ReplaceAllString(s, "[PATH]")
	s = reportUserPath.ReplaceAllString(s, "[PATH]")
	s = reportEmail.ReplaceAllString(s, "[EMAIL]")
	return reportIPv4.ReplaceAllString(s, "[IP]")
}
