package main

import "regexp"

// Operational settings (endpoint and selected adapter) never enter public reports.
// Each report is copied before redaction; the live measurements remain usable
// for comparisons and state transitions.
func redactedReport(in Report) Report {
	out := in
	out.EndpointIPv4 = ""
	out.AdapterName = ""
	out.Caveat = redactText(out.Caveat)
	out.Baseline = redactEgress(in.Baseline)
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
	in.Reason = redactText(in.Reason)
	in.Egress = redactEgress(in.Egress)
	in.AdapterBefore = redactAdapter(in.AdapterBefore)
	in.AdapterAfter = redactAdapter(in.AdapterAfter)
	downloads := make([]DownloadResult, len(in.Downloads))
	copy(downloads, in.Downloads)
	for i := range downloads {
		downloads[i].Error = redactText(downloads[i].Error)
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

func redactText(s string) string { return reportIPv4.ReplaceAllString(s, "[IP]") }
