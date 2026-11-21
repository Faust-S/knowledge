"""Source-bounded modeled responses of independently interested AKIS principals.

The function never grants consent, alters rights, or makes claims of actual profit.
Policy statements are hypotheses supplied in MODEL_ONLY research input.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .portfolio import readiness
from .context_basis import ContextBlocked
from .capacity import CapacityBlocked
from .cooperation import latest_owner_interest_claim, latest_future_participation


WILLINGNESS = frozenset({"WILLING", "DECLINES", "UNKNOWN"})
OUTSIDE_OPTIONS = frozenset({"COOPERATION_PREFERRED", "OUTSIDE_PREFERRED", "UNKNOWN"})
MAX_PROFILES = 512  # technical input guard, not an AKIS organizational parameter


class ProfileInputError(ValueError):
    """Invalid qualitative research assumption; not a participant's decision."""


@dataclass(frozen=True)
class DecisionProfile:
    subject: str
    work: str
    source_revision: str
    org_revision: str
    willingness: str
    outside_option: str


def _identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ProfileInputError(f"INVALID_{field.upper()}")
    return value


def parse_profiles(data: Any, known_subjects: Mapping[str, Any]) -> dict[tuple[str, str], DecisionProfile]:
    """Validate explicit assumptions without interpreting them as signed consent."""
    if not isinstance(data, list) or len(data) > MAX_PROFILES:
        raise ProfileInputError("INVALID_DECISION_PROFILE_COUNT")
    result: dict[tuple[str, str], DecisionProfile] = {}
    expected = {"subject", "work", "source_revision", "org_revision", "willingness", "outside_option"}
    for item in data:
        if not isinstance(item, dict) or item.keys() != expected:
            raise ProfileInputError("INVALID_DECISION_PROFILE_FIELDS")
        subject = _identifier(item["subject"], "subject")
        work = _identifier(item["work"], "work")
        src = _identifier(item["source_revision"], "source_revision")
        org = _identifier(item["org_revision"], "org_revision")
        if subject not in known_subjects:
            raise ProfileInputError("UNKNOWN_DECISION_SUBJECT")
        willingness, outside = item["willingness"], item["outside_option"]
        if not isinstance(willingness, str) or willingness not in WILLINGNESS:
            raise ProfileInputError("INVALID_WILLINGNESS")
        if not isinstance(outside, str) or outside not in OUTSIDE_OPTIONS:
            raise ProfileInputError("INVALID_OUTSIDE_OPTION")
        key = (subject, work)
        if key in result:
            raise ProfileInputError("DUPLICATE_DECISION_PROFILE")
        result[key] = DecisionProfile(subject, work, src, org, willingness, outside)
    return result


def assess_principal(
    state: Any,
    profiles: Mapping[tuple[str, str], DecisionProfile],
    subject: str,
    work_id: str,
    *, modeled_outside_position: str | None = None,
) -> dict[str, str]:
    """Derive a non-binding response from *current* research state and assumptions.

    This is a state-dependent modeled reaction, not a consent or executable order.
    The outside option and individual choice cannot be inferred from an operator's
    assertion or resource availability. Missing evidence remains UNKNOWN.
    """
    work = state.works.get(work_id)
    owner_claim = None
    if work is None:
        code = "WORK_UNKNOWN"
    elif subject not in ({work.customer} | {
        state.resources[need.resource] for need in getattr(work, "resource_requirements", ())
    } if getattr(work, "resource_requirements", ()) else {
        state.resources[work.resource], work.customer
    }):
        code = "NOT_ORIGINAL_PRINCIPAL"
    elif not state.subjects[subject].active:
        code = "PARTICIPANT_INACTIVE"
    elif work.obligation != "NOT_ACCEPTED":
        code = "OBLIGATION_ALREADY_COMMITTED"
    elif work.proposal != "OFFERED":
        code = "NO_CURRENT_OFFER"
    else:
        profile = profiles.get((subject, work_id))
        owner_claim = latest_owner_interest_claim(
            getattr(state, "trace", ()), subject, work_id,
            work.source_revision, state.institution.revision,
        )
        if owner_claim is not None:
            profile = DecisionProfile(subject, work_id, work.source_revision,
                                      state.institution.revision, *owner_claim)
        # A sourced current quote can refine an UNKNOWN alternative only for
        # an explicitly WILLING original principal. Owner-declared preference
        # or refusal always takes precedence; this creates NO actual consent.
        if (profile is not None and profile.willingness == "WILLING"
                and profile.outside_option == "UNKNOWN"
                and profile.source_revision == work.source_revision
                and profile.org_revision == state.institution.revision
                and modeled_outside_position in {
                    "COOPERATION_PREFERRED", "OUTSIDE_PREFERRED",
                }):
            profile = DecisionProfile(
                profile.subject, profile.work, profile.source_revision,
                profile.org_revision, profile.willingness, modeled_outside_position,
            )
        paused_in_relation = any(
            work_id in link.works and subject in link.participants and
            latest_future_participation(
                getattr(state, "trace", ()), link.key, subject,
                link.source_revision, state.institution.revision
            ) == "PAUSED_NEW_WORK"
            for link in getattr(state, "cooperation_links", ())
        )
        if paused_in_relation:
            code = "COOPERATION_FUTURE_PARTICIPATION_PAUSED"
        elif profile is None:
            code = "INTEREST_UNKNOWN"
        elif profile.source_revision != work.source_revision or profile.org_revision != state.institution.revision:
            code = "PROFILE_REVISION_STALE"
        elif profile.willingness == "DECLINES":
            code = "INDEPENDENT_DECLINE"
        elif profile.outside_option == "OUTSIDE_PREFERRED":
            code = "PREFERS_OUTSIDE_OPTION"
        elif profile.willingness == "UNKNOWN":
            code = "INTEREST_UNKNOWN"
        elif profile.outside_option == "UNKNOWN":
            code = "OUTSIDE_OPTION_UNKNOWN"
        elif state.institution.mode == "UNSELECTED":
            code = "MODE_NOT_SELECTED"
        elif not work.admitted or work.authorization_org_revision != state.institution.revision:
            code = "CURRENT_AUTHORIZATION_MISSING"
        elif any(state.resource_availability_origin.get(need.resource) == "LEGACY_FIXTURE_DEFAULT"
                 for need in getattr(work, "resource_requirements", ()) or (work,)):
            code = "RESOURCE_READINESS_UNSUPPORTED"
        elif any(state.resource_availability[need.resource] == "UNKNOWN"
                 for need in getattr(work, "resource_requirements", ()) or (work,)):
            code = "RESOURCE_READINESS_UNKNOWN"
        elif any(state.resource_availability[need.resource] == "UNAVAILABLE"
                 for need in getattr(work, "resource_requirements", ()) or (work,)):
            code = "RESOURCE_NOT_AVAILABLE"
        elif (getattr(state, "capacity_strict", False)
              and getattr(state, "capacity_ledger", None) is not None
              and any(state.capacity_ledger.specs[need.resource].basis == "LEGACY_FIXTURE_DEFAULT"
                      for need in getattr(work, "resource_requirements", ()) or (work,))):
            code = "RESOURCE_CAPACITY_UNSUPPORTED"
        elif (getattr(state, "calendar_strict", False) and
              any(state.capacity_ledger.specs[need.resource].calendar is None
                  for need in work.resource_requirements)):
            code = "RESOURCE_CALENDAR_UNSUPPORTED"
        else:
            code = "REVIEWABLE_NOT_CONSENTED"
            context = getattr(state, "context_basis", None)
            if context is not None:
                try:
                    last_at = state.trace[-1]["at"] if getattr(state, "trace", []) else 0
                    context.assert_allowed(work_id, "consent", subject, int(last_at))
                except ContextBlocked as exc:
                    code = exc.reason
            if code == "REVIEWABLE_NOT_CONSENTED" and getattr(state, "capacity_ledger", None) is not None:
                if any(state.capacity_ledger.specs[need.resource].calendar is not None
                       for need in work.resource_requirements):
                    try:
                        state.capacity_ledger.preview(
                            work.key, work.resource_requirements, work.slot_start, work.slot_end)
                    except CapacityBlocked as exc:
                        code = exc.reason
    response = {
        "subject": subject,
        "work": work_id,
        "assessment": code,
        "evidence": "MODEL_ONLY",
        "effect": "NO_AUTOMATIC_CONSENT",
    }
    if owner_claim is not None:
        response["interest_basis"] = "ORIGINAL_OWNER_MODEL_ONLY_EVENT_NOT_CONSENT"
    if (work is not None and getattr(work, "obligation", None) == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
            and getattr(state, "capacity_ledger", None) is not None):
        outstanding = ({key for key, item in state.works.items()
                        if item.obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"}
                       if getattr(state, "works", None) else None)
        risk = state.capacity_ledger.is_work_at_risk(work.key, outstanding=outstanding)
        if risk is not None:
            response["resource_gate"] = "RESOURCE_CALENDAR_CHANGED_AFTER_COMMIT"
            response["blocking_resource"] = risk
    if work is not None and getattr(work, "requires_accepted", ()):
        # This gate applies even after commitment: consent and execution differ.
        response["execution_gate"] = readiness(state.works, work_id)["reason"]
    return response
