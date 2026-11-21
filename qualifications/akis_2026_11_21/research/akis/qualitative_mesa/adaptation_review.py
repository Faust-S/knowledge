"""Source-bounded organizational learning proposals within the ONE operator AKIS.

Nothing here executes a governance change, settles a contract or proves an
observed effect. A simulated problem is not a causal explanation. The function
combines *existing* portfolio and economic projections; it is not a second core.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Mapping

from .portfolio import review_cues


class AdaptationInputError(ValueError):
    """Invalid research proposal, never an unlawful business transaction."""


# These are the operational changes in section 14.2 of the unified AKIS model.
# They are not new doctoral classes or an automatic optimization policy.
SCOPES = frozenset({
    "LOCAL_CORRECTION", "SERVICE_ADAPTATION", "INSTITUTIONAL_TRANSFORMATION",
    "SCOPE_REDUCTION",
})
MAX_REQUESTS = 128  # computational bound, not an AKIS morphology restriction


@dataclass(frozen=True)
class ReviewRequest:
    key: str
    proposed_by: str
    scope: str
    work: str | None
    basis_at: int
    org_revision: str
    hypothesis: str
    alternative_explanation: str | None
    affected_principals: tuple[str, ...]
    source_ids: tuple[str, ...]


def _id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 256:
        raise AdaptationInputError(f"INVALID_{field}")
    return value


def parse_review_requests(raw: Any, subjects: Mapping[str, Any]) -> list[ReviewRequest]:
    """Parse declared intents without claiming that a signature was verified."""
    if not isinstance(raw, list) or len(raw) > MAX_REQUESTS:
        raise AdaptationInputError("INVALID_REVIEW_COUNT")
    mandatory = {
        "id", "proposed_by", "scope", "work", "basis_at", "org_revision",
        "hypothesis", "alternative_explanation", "affected_principals", "source_ids",
    }
    seen: set[str] = set()
    out: list[ReviewRequest] = []
    for item in raw:
        if not isinstance(item, dict) or set(item) != mandatory:
            raise AdaptationInputError("INVALID_REVIEW_FIELDS")
        key = _id(item["id"], "REVIEW_ID")
        if key in seen:
            raise AdaptationInputError("DUPLICATE_REVIEW_ID")
        seen.add(key)
        subject = _id(item["proposed_by"], "PROPOSER")
        if subject not in subjects:
            raise AdaptationInputError("UNKNOWN_REVIEW_PROPOSER")
        scope = item["scope"]
        if not isinstance(scope, str) or scope not in SCOPES:
            raise AdaptationInputError("UNKNOWN_REVIEW_SCOPE")
        work = None if item["work"] is None else _id(item["work"], "REVIEW_WORK")
        at = item["basis_at"]
        if type(at) is not int or at < 0:
            raise AdaptationInputError("INVALID_BASIS_TIME")
        revision = _id(item["org_revision"], "ORG_REVISION")
        hypothesis = _id(item["hypothesis"], "HYPOTHESIS")
        alternative = (None if item["alternative_explanation"] is None
                       else _id(item["alternative_explanation"], "ALTERNATIVE_EXPLANATION"))
        affected = item["affected_principals"]
        if not isinstance(affected, list) or len(affected) > 128 or any(
            not isinstance(x, str) or not x.strip() or len(x) > 128 for x in affected
        ):
            raise AdaptationInputError("INVALID_AFFECTED_PRINCIPALS")
        if len(affected) != len(set(affected)) or not set(affected).issubset(subjects):
            raise AdaptationInputError("INVALID_AFFECTED_PRINCIPALS")
        sources = item["source_ids"]
        if not isinstance(sources, list) or len(sources) > 32 or any(
            not isinstance(x, str) or not x.strip() or len(x) > 128 for x in sources
        ):
            raise AdaptationInputError("INVALID_REVIEW_SOURCES")
        if len(sources) != len(set(sources)):
            raise AdaptationInputError("DUPLICATE_REVIEW_SOURCE")
        out.append(ReviewRequest(
            key, subject, scope, work, at, revision, hypothesis, alternative,
            tuple(affected), tuple(sources),
        ))
    return out


def _decision_route(scope: str, institution: Any, affected: set[str], work: Any | None,
                    resources: Mapping[str, str]) -> dict[str, Any]:
    """Return required parties/procedure, *not* proof of any right or approval."""
    if scope == "LOCAL_CORRECTION":
        if work is None:
            return {"route": "WORK_REQUIRED", "required_roles": [], "status": "UNDETERMINED"}
        return {
            "route": "ORIGINAL_EXECUTOR_THEN_RECIPIENT",
            "required_roles": sorted({work.customer} | {
                resources[need.resource] for need in getattr(work, "resource_requirements", ())
            } if getattr(work, "resource_requirements", ()) else {
                resources[work.resource], work.customer
            }),
            "status": "AUTHORITY_NOT_VERIFIED",
        }
    if scope == "INSTITUTIONAL_TRANSFORMATION":
        return {
            "route": "EXISTING_ORGANIZATIONAL_CODE_CHANGE_PROCEDURE",
            "required_roles": sorted(set(institution.founders)),
            "existing_transition": "change_mode",
            "current_revision": institution.revision,
            "status": "AUTHORITY_NOT_VERIFIED",
        }
    if scope == "SERVICE_ADAPTATION":
        return {
            "route": "OPERATOR_AND_AFFECTED_ORIGINAL_PRINCIPALS",
            "required_roles": sorted(affected | {institution.operator}),
            "status": "AUTHORITY_NOT_VERIFIED",
        }
    return {
        "route": "ORIGINAL_RIGHTS_AND_EXISTING_OBLIGATIONS_REVIEW",
        "required_roles": sorted(affected),
        "status": "AUTHORITY_NOT_VERIFIED",
    }


def inquiry_from_applied_event(event: Mapping[str, Any]) -> dict[str, Any] | None:
    """Create one non-binding review inquiry from an actual modeled event.

    The model records this via its *existing* Mesa event queue at the triggering
    time. A cue is not a causal finding, proposal or right to execute changes.
    """
    cues = review_cues([dict(event)])
    if not cues:
        return None
    cue = cues[0]
    return {
        "basis_at": cue["at"],
        "signal": cue["signal"],
        "work": cue["work"],
        "resource": cue["resource"],
        "org_revision": cue["org_revision"],
        "basis": cue["basis"],
        "causal_attribution": "NOT_IDENTIFIABLE",
        "evidence": "MODEL_ONLY",
        "decision": "INQUIRY_ONLY_NOT_PROPOSAL",
    }


def _negative_declared_cash_signals(economics: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    """Identify comparisons deserving investigation, not losses or bad actors."""
    if economics is None:
        return []
    signals = []
    for party, record in sorted(economics["per_subject"].items()):
        if record["cash_comparison"] != "DECLARED_SCOPE_ARITHMETIC_ONLY":
            continue
        raw = record["cash_difference_cooperation_minus_outside"]
        if raw is None:
            continue
        if Decimal(raw) < 0:
            signals.append({
                "kind": "NEGATIVE_DECLARED_CASH_DIFFERENCE",
                "subject": party,
                "scope": "INDIVIDUAL_CASH_ONLY",
                "basis": "DECLARED_UNVERIFIED",
                "no_inference": ["NOT_PROFIT", "NOT_CAUSAL", "NOT_INDIVIDUAL_CONSENT"],
            })
    return signals


def _cooperation_cost_signals(economics: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    """Make declared cooperative cost differences visible for review only.

    Neither a negative resource-cost delta nor a positive cash outlay change
    by itself proves a good or bad organization. No extra decision is issued.
    """
    if not economics:
        return []
    channels = economics.get("cooperation_cost_channels")
    if not isinstance(channels, dict):
        return []
    signals: list[dict[str, Any]] = []
    for entry in channels.get("claimed_channels", []):
        if entry["comparison"] != "DECLARED_SCOPE_ARITHMETIC_ONLY":
            sign = "COMPARABILITY_NOT_ESTABLISHED"
        else:
            resource = Decimal(entry["resource_cost_reduction_claim"])
            cash = Decimal(entry["buyer_cash_outlay_reduction_claim"])
            if resource < 0 or cash < 0:
                sign = "DECLARED_POSSIBLE_COOPERATION_COST_DISADVANTAGE"
            elif resource > 0 or cash > 0:
                sign = "DECLARED_POSSIBLE_COOPERATION_COST_ADVANTAGE"
            else:
                sign = "DECLARED_NO_DIFFERENCE_IN_REFERENCED_COST_ROWS"
        signals.append({
            "link": entry["link"], "subject": entry["owner"],
            "channel": entry["channel"], "signal": sign,
            "basis": "SOURCE_DECLARED_COST_ROWS_NOT_AUTHENTICATED",
            "causal_attribution": "NOT_IDENTIFIABLE",
            "automatic_change": False,
            "right_to_change_others": False,
        })
    return signals


def review_adaptation(
    state: Any,
    requests: list[ReviewRequest],
    *,
    portfolio: Mapping[str, Any] | None = None,
    economics: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Join existing mechanisms into a non-binding evidence-to-authority review.

    An event cue and a document claim remain MODEL_ONLY even when a proposal
    references them. Changes happen only through ordinary rights-checked work
    events, not by writing this projection or running it again.
    """
    trace = state.trace
    by_time = {r["at"]: r for r in trace}
    cues = [] if portfolio is None else portfolio.get("review_cues", [])
    cue_times = {x["at"] for x in cues}
    source_index = {} if economics is None else economics["declared_source_index"]
    proposals = []
    for request in requests:
        if any(key not in source_index for key in request.source_ids):
            raise AdaptationInputError("UNDECLARED_REVIEW_SOURCE")
        work = state.works.get(request.work) if request.work else None
        event = by_time.get(request.basis_at)
        flags = []
        if event is None:
            flags.append("BASIS_EVENT_UNKNOWN")
        elif request.work is not None and event.get("work") != request.work:
            flags.append("BASIS_WRONG_WORK")
        if event is not None and request.basis_at not in cue_times:
            flags.append("NO_MATCHING_REVIEW_CUE")
        if request.org_revision != state.institution.revision:
            flags.append("STALE_ORGANIZATIONAL_CODE")
        if work is None and request.work is not None:
            flags.append("UNKNOWN_REVIEW_WORK")
        if not state.subjects[request.proposed_by].active:
            flags.append("PROPOSER_INACTIVE_FOR_NEW_WORK")
        affected = set(request.affected_principals)
        if not affected:
            flags.append("AFFECTED_PRINCIPALS_NOT_DECLARED")
        if request.scope == "INSTITUTIONAL_TRANSFORMATION" and not set(state.institution.founders).issubset(affected):
            flags.append("CODE_OWNERS_NOT_LISTED")
        if work is not None:
            needs = getattr(work, "resource_requirements", ())
            needed = {work.customer} | ({state.resources[need.resource] for need in needs}
                                        if needs else {state.resources[work.resource]})
            if not needed.issubset(affected):
                flags.append("ORIGINAL_PRINCIPALS_NOT_LISTED")
        for source in request.source_ids:
            owner = source_index[source]["owner"]
            if owner not in affected and owner != request.proposed_by:
                flags.append("SOURCE_OWNER_OUTSIDE_DECLARED_SCOPE")
                break
        if request.alternative_explanation is None:
            flags.append("ALTERNATIVE_EXPLANATION_MISSING")
        route = _decision_route(request.scope, state.institution, affected, work, state.resources)
        proposals.append({
            "id": request.key,
            "submitted_by_claim": request.proposed_by,
            "scope": request.scope,
            "work": request.work,
            "basis_event_at": request.basis_at,
            "basis_event_outcome": None if event is None else event["outcome"],
            "basis_event_reason": None if event is None else event["reason"],
            "hypothesis": request.hypothesis,
            "alternative_explanation": request.alternative_explanation,
            "declared_source_ids": list(request.source_ids),
            "affected_principals": list(request.affected_principals),
            "assessment": "REVIEWABLE_AS_HYPOTHESIS" if not flags else "EVIDENCE_OR_RIGHTS_GAPS",
            "unresolved_flags": sorted(set(flags)),
            "decision_route": route,
            "authorized_change": False,
            "causal_attribution": "NOT_IDENTIFIABLE",
            "economic_effect": "NOT_IDENTIFIABLE",
            "evidence": "MODEL_ONLY",
        })
    return {
        "evidence": "MODEL_ONLY",
        "source_authority": "DECLARED_UNVERIFIED",
        "review_opportunities": [{
            "at": cue["at"], "signal": cue["signal"],
            "work": cue.get("work"), "resource": cue.get("resource"),
            "causal_attribution": "NOT_IDENTIFIABLE",
            "status": "INQUIRY_ONLY_NOT_PROPOSAL",
        } for cue in cues],
        "individual_cash_signals": _negative_declared_cash_signals(economics),
        "cooperation_cost_review_signals": _cooperation_cost_signals(economics),
        "operator_reproduction": "NOT_IDENTIFIABLE",
        "system_additionality": "NOT_IDENTIFIABLE",
        "proposals": proposals,
        "decision": "NO_AUTOMATIC_ORGANIZATIONAL_CHANGE",
        "governance_revision": state.institution.revision,
    }
