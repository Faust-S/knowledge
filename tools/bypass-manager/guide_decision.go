package main

// A video benchmark and VPN identity are separate claims. In particular, an
// unchanged public IPv4 or absent adapter traffic must not be "repaired" by
// blindly cycling packet filters when ordinary HTTPS already works.
func guideOutcome(baselineKnown, egressChanged, adapterFlow bool, q VideoAssessment) string {
	usable := q.Grade == "HD_1080P_CANDIDATE" || q.Grade == "HD_720P_CANDIDATE"
	if usable {
		if !adapterFlow {
			return "WEB_USABLE_VPN_UNVERIFIED"
		}
		if baselineKnown && !egressChanged {
			return "VIDEO_USABLE_EGRESS_UNCHANGED"
		}
		if !baselineKnown {
			return "VIDEO_CANDIDATE_EGRESS_UNVERIFIED"
		}
		return "VIDEO_CANDIDATE_VPN_PATH_OBSERVED"
	}
	switch q.Grade {
	case "INCOMPLETE", "NOT_VERIFIED":
		return "MEASUREMENT_INCOMPLETE"
	case "SLOW_FOR_VIDEO":
		return "SPEED_BELOW_TARGET"
	default:
		return "NETWORK_INCONCLUSIVE"
	}
}
