package main

// Reports from cancelled or declined manual steps must never remain in
// IN_PROGRESS after runGuide returned. Keep previous observations but mark
// any open round as inconclusive, not as a successful VPN/HTTPS result.
func finalizeGuideReport(r *GuideReport, cancelled bool, at string) {
	if r.State == "IN_PROGRESS" {
		if cancelled {
			r.State = "CANCELLED"
			r.AdviceCode = "USER_CANCELLED"
		} else {
			r.State = "GUIDE_INCOMPLETE"
			r.AdviceCode = "GUIDE_INTERRUPTED_BEFORE_RESULT"
		}
	}
	for i := range r.Rounds {
		round := &r.Rounds[i]
		if round.CompletedUTC != "" {
			continue
		}
		round.CompletedUTC = at
		if round.State == "NOT_VERIFIED" {
			if cancelled {
				round.State = "CANCELLED"
				round.FailureCode = "USER_CANCELLED"
			} else {
				round.State = "INCONCLUSIVE"
				round.FailureCode = "INTERRUPTED_BEFORE_RESULT"
			}
		}
	}
	r.CompletedUTC = at
}
