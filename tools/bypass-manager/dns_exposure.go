package main

// DNSExposure is a read-only inventory of configured Windows DNS resolvers
// and OS-selected routes. It is not a packet capture and cannot establish
// which resolver a browser, app or Windows actually queried.
// No server addresses or network interface names are retained in reports.
type DNSExposure struct {
	Checked          bool `json:"checked"`
	VPNDNSCount      int  `json:"vpn_dns_count"`
	OtherDNSCount    int  `json:"other_dns_count"`
	ThroughVPNRoutes int  `json:"through_vpn_routes"`
	OutsideVPNRoutes int  `json:"outside_vpn_routes"`
	UnknownRoutes    int  `json:"unknown_routes"`
	LocalResolvers   int  `json:"local_resolvers"`
	Truncated        bool `json:"truncated"`
}

func assessDNSExposure(d *DNSExposure) (possibleBypass bool, note string) {
	if d == nil || !d.Checked {
		return false, "DNS_ROUTE_CHECK_UNAVAILABLE"
	}
	if d.OutsideVPNRoutes > 0 {
		return true, "POSSIBLE_DNS_OUTSIDE_VPN: configured DNS has a route outside the VPN; actual queries NOT observed"
	}
	if d.Truncated || d.UnknownRoutes > 0 {
		return false, "DNS_ROUTE_INCOMPLETE: some routes unknown; actual queries NOT observed"
	}
	if d.VPNDNSCount == 0 {
		return false, "NO_VPN_DNS_CONFIGURED: browser DoH and actual queries NOT observed"
	}
	return false, "DNS_ROUTES_OBSERVED: no off-tunnel route found in this snapshot; DNS leaks NOT excluded"
}

func anyDNSExposureSuspected(probes []Probe) bool {
	for _, p := range probes {
		if p.DNSExposureSuspected {
			return true
		}
	}
	return false
}
