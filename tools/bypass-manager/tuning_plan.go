package main

// A prioritized hypothesis and reversible trial plan based on actual evidence.
// Network and security settings are NOT silently altered in alpha. Windows
// settings that can strand the user offline require a crash-safe rollback
// mechanism before any automatic apply action can be enabled.
type TuningSuggestion struct {
	Code        string `json:"code"`
	Confidence  string `json:"confidence"`
	Why         string `json:"why"`
	Trial       string `json:"trial"`
	Compare     string `json:"compare"`
	Rollback    string `json:"rollback"`
	AutoApplied bool   `json:"auto_applied"`
}

func tuningSuggestions(s SupportReport) []TuningSuggestion {
	found := map[string]bool{}
	out := make([]TuningSuggestion, 0, 8)
	add := func(key, confidence, reason, trial, compare, rollback string) {
		if found[key] {
			return
		}
		found[key] = true
		out = append(out, TuningSuggestion{Code: key, Confidence: confidence, Why: reason, Trial: trial, Compare: compare, Rollback: rollback})
	}
	if s.Network != nil {
		n := s.Network.Snapshot
		if n.Medium == "WIFI" && n.WiFiSignalPct >= 0 && n.WiFiSignalPct < 55 {
			add("WIFI_ETHERNET_AB", "POTENTIAL", "Low Wi-Fi signal", "Compare the same test through Ethernet or improved Wi-Fi placement", "Compare HTTPS speed, gateway latency and received discards", "Return to previous Wi-Fi link")
		}
		if n.LinkMbps > 0 && n.LinkMbps < 50 {
			add("LINK_SPEED_AB", "POTENTIAL", "Negotiated local link capacity is low", "Inspect cable, port or Wi-Fi band without changing VPN settings", "Re-measure the negotiated link speed and data transfer", "Restore original cable/port or Wi-Fi band")
		}
		if n.VPNActive > 1 {
			add("CONCURRENT_TUNNEL_REVIEW", "POTENTIAL", "Multiple virtual tunnel interfaces are active", "Review which VPN app owns each route", "Compare full route and egress before/after an authorized app switch", "Restore the original VPN app selection")
		}
		if n.VPNActive == 1 && !n.VPNFullRoute {
			add("SPLIT_ROUTE_REVIEW", "UNKNOWN", "VPN default route was not observed", "Check whether split tunneling was intentionally enabled in Amnezia", "Compare program egress and browser egress; do not assume either is tunneled", "Return to the original split-tunnel policy")
		}
		if n.ProxyEnabled {
			add("PROXY_REVIEW", "INFO", "System proxy or PAC configuration is present", "Check per-app proxy routing without clearing proxy settings automatically", "Compare program and browser public egress", "Restore original proxy settings")
		}
		if n.PhysicalIPv4MTU > 0 && n.VPNIPv4MTU > n.PhysicalIPv4MTU {
			add("MTU_REVIEW_ONLY", "POTENTIAL", "VPN interface MTU exceeds the observed physical IPv4 MTU", "Run DF/PMTU diagnostics before any MTU change; packet drops alone do not prove an MTU fault", "Compare complete HTTPS transfers and stalls on the same route", "Restore the exact saved original MTU")
		}
		for _, f := range s.Network.Findings {
			if f.Code == "PHYSICAL_PACKET_ERRORS_INCREASED" || f.Code == "PHYSICAL_PACKET_DISCARDS_INCREASED" {
				add("PHYSICAL_PACKET_COUNTERS", "POTENTIAL", "Physical interface counters increased during transfer", "Compare a direct Ethernet link and inspect adapter/driver condition", "Compare counter deltas under identical load", "Return to original link or driver configuration")
			}
		}
	}
	if s.Path != nil {
		p := s.Path.Path
		if p.Gateway.Replied > 0 && p.Gateway.JitterMs >= 30 {
			add("LOCAL_LATENCY_AB", "POTENTIAL", "Gateway ICMP latency variation is high", "Compare wired and wireless links under a similar load", "Observe p95 latency, jitter and video interruptions", "Restore the original access link")
		}
		if p.Remote.Replied == 0 {
			add("REMOTE_ICMP_UNKNOWN", "UNKNOWN", "Remote echo requests did not return", "Use HTTPS/TLS timings instead of treating ICMP silence as a blockage", "Compare DNS/TCP/TLS/TTFB by provider", "No network change")
		}
	}
	if s.Live != nil {
		if s.Live.EgressConsensus && s.Live.BaselineState == "IP_UNCHANGED_POSSIBLE_DIRECT_EGRESS" {
			add("POSSIBLE_DIRECT_EGRESS", "HIGH_RISK", "Program public IP matches the fresh VPN-off baseline", "Check full VPN route and per-application proxy/split tunnel", "Require a changed external IP before claiming IP masking", "Restore original VPN routing after any authorized trial")
		}
		if s.Live.SpeedGrade == "SLOW_FOR_VIDEO" {
			add("SLOW_EXTERNAL_BANDWIDTH", "OBSERVED", "Independent complete HTTP downloads were below the video target", "Compare a separate CDN and the two supported Amnezia protocols, without a random IP pool", "Measure minimum and median speeds and 15-minute playback", "Restore the previous protocol if performance worsens")
		}
	}
	return out
}
