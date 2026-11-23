"""Mesa 3.5.2 adapter for one qualitative AKIS research model.

All economic responses are non-binding MODEL_ONLY assessments, never consent.
Uses Mesa's sole scheduler, with causal reactions at the triggering model time.
"""

from __future__ import annotations

import json
from functools import partial
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import mesa
from mesa.time import Priority

from .adaptation_review import (
    AdaptationInputError, inquiry_from_applied_event,
    parse_review_requests, review_adaptation,
)
from .participant_response import DecisionProfile, ProfileInputError, assess_principal, parse_profiles
from .subject_dynamics import choose_model_action, cooperative_choice_state
from .subject_goals import GoalInputError, parse_subject_goals, evaluate_subject_goals
from .future_needs import FutureNeedInputError, parse_future_needs, future_need_projection
from .modern_economic_evidence import modern_economic_review
from .owner_economic_feedback import (
    OwnerFinanceInputError, parse_owner_finance, private_owner_financial_review,
)
from .owner_forecast_revisions import (
    ForecastRevisionInputError, parse_forecast_revisions, private_forecast_override,
)
from .economic_outlook import OutlookInputError, choose_outlook, parse_outlooks
from .joint_purchasing import (
    PurchasingInputError, evaluate_plan, parse_plans,
    review_original_joint_purchase_cash,
    review_original_joint_purchase_ancillary,
)
from .partner_discovery import DiscoveryInputError, parse_discovery, parse_formation_finance, discover
from .general_system import (
    GeneralSystemInputError, ModelFormationPolicy, parse_general_system, general_system_view,
    original_nine_component_cycle_evidence,
)
from .org_code_policy import OrgCodeInputError, parse_org_code_policy
from .economic_flow import EconomicInputError, evaluate_economic_claims
from .strict_economic_source_review import (
    StrictEconomicSourceBlocked, review_original_strict_economic_sources,
    original_owner_economic_core,
)
from .competence_reuse import ReuseInputError, evaluate_competence_reuse
from .competence_transfer import CompetencePermissionInputError, review_permissions
from .work_counterfactual import WorkCounterfactualInputError, review_work_counterfactuals
from .causal_contract import CausalContractInputError, assess_author_causal_edges
from .competence_measurement import MeasurementProtocolInputError, review_measurement_protocols
from .capability_dynamics import CapabilityAdoptionPolicy, CapabilityInputError
from .cooperation import (
    cooperation_system_view, cooperative_model_readiness,
    cooperative_readiness_evolution, latest_owner_interest_claim, latest_future_participation,
)
from .rules import InputError, QualitativeAKIS, ACTIONS


class EconomicSubject(mesa.Agent):
    """Independent modeled economic principal; not an IWXA software agent."""

    def __init__(self, model: mesa.Model, party_id: str, kind: str) -> None:
        super().__init__(model)
        self.party_id = party_id
        self.kind = kind
        # Each Mesa principal keeps ONLY its own, non-binding research choices.
        self.modeled_choices: dict[str, dict[str, Any]] = {}
        # Transient private evidence, never in shared Mesa observations.
        self._financial_review_required = False

    def choose(self, work_id: str, observation: dict[str, Any],
               trace_position: int, outlook_epoch: int) -> dict[str, Any]:
        """Make and remember an endogenous choice, never legal consent."""
        state = self.model.qualitative
        work = state.works[work_id]
        configuration = (
            self.model.general_design.configuration
            if self.model.general_design is not None else "operator"
        )
        choice = choose_model_action(
            {**observation,
             "_private_owner_cash_review_required": self._financial_review_required},
            configuration=configuration,
        )
        previous = self.modeled_choices.get(work_id)
        transition = (
            "INITIAL" if previous is None else "UNCHANGED"
            if (previous["action"], previous["assessment_reason"],
                previous["source_revision"], previous["org_revision"],
                previous.get("goal_comparison"))
            == (choice["action"], choice["assessment_reason"],
                work.source_revision, state.institution.revision,
                observation.get("goal_comparison"))
            else "CHANGED"
        )
        self.modeled_choices[work_id] = {
            **choice,
            "at": float(self.model.time),
            "source_trace_position": trace_position,
            "outlook_epoch": outlook_epoch,
            "source_revision": work.source_revision,
            "org_revision": state.institution.revision,
            "goal_comparison": observation.get("goal_comparison"),
        }
        return {
            **choice,
            "transition": transition,
            "prior_action": previous["action"] if previous else None,
            "source_trace_position": trace_position,
            "org_revision": state.institution.revision,
        }

    def assess(self, work_id: str) -> dict[str, Any]:
        state = self.model.qualitative
        work = state.works.get(work_id)
        outlook = None
        joint = None
        if work is not None and self.model.economic_outlooks:
            outlook = choose_outlook(
                self.model.economic_outlooks, owner=self.party_id, work=work,
                org_revision=state.institution.revision,
                links=state.cooperation_links, at=float(self.model.time),
                works=state.works,
                context_basis=state.context_basis,
                owner_core=original_owner_economic_core(self.kind),
                capacity_ledger=state.capacity_ledger,
                resource_owners=state.resources,
                resource_availability=state.resource_availability,
                original_trace=state.trace,
                subjects=state.subjects,
            )
        if work is not None and self.model.joint_purchasing_plans:
            joint = self.model._joint_purchasing_position(self.party_id, work_id)
        goals = None
        if work is not None and self.model.subject_goals:
            principals = (state.capacity_ledger.original_owners(work.resource_requirements)
                          | {work.customer})
            goals = evaluate_subject_goals(
                self.model.subject_goals, owner=self.party_id, work=work,
                org_revision=state.institution.revision, at=float(self.model.time),
                works=state.works, context_basis=state.context_basis,
                original_owners=principals,
            )
        self._financial_review_required = bool(
            work is not None and self.model.owner_financial_claims
            and private_owner_financial_review(
                self.model.owner_financial_claims, owner=self.party_id,
                work=work, state=state, at=float(self.model.time),
                economics=self.model._private_cash_economics(
                    owner=self.party_id, work_id=work_id,
                ),
            )
        )
        # Original independent willingness and original owner preference
        # remain authoritative *within the simulated research state*.
        # A modeled quotation can only refine UNKNOWN, never sign consent.
        prediction = None
        if outlook and outlook["position"] in {
                "COOPERATION_PREFERRED", "OUTSIDE_PREFERRED"}:
            prediction = outlook["position"]
        elif ((outlook is None or outlook["reason"] == "NO_CURRENT_OWNER_OUTLOOK")
              and joint and joint["position"] == "COOPERATION_PREFERRED"):
            prediction = joint["position"]
        goal_preference = goals["position"] if goals is not None else "UNKNOWN"
        goal_conflict = bool(
            prediction is not None and goal_preference != "UNKNOWN"
            and prediction != goal_preference
        )
        if prediction is None and goal_preference in {
            "COOPERATION_PREFERRED", "OUTSIDE_PREFERRED",
        }:
            prediction = goal_preference
        observation = assess_principal(
            state, self.model.decision_profiles, self.party_id, work_id,
            modeled_outside_position=prediction,
        )
        if goals is not None:
            observation.update({
                "goal_comparison": goals["comparison"],
                "goal_reason": goals["reason"],
                "goal_source_conflict": goal_conflict,
                "goal_evidence": "OWNER_SCOPED_MODEL_ONLY_NOT_REALIZED",
                "goal_private_objectives": "NOT_REDISCLOSED",
                "goal_can_grant_consent": False,
            })
        if outlook is not None:
            observation.update({
                "economic_position": outlook["position"],
                "economic_reason": outlook["reason"],
                "economic_relation": outlook.get("relation"),
                "economic_available_at": outlook.get("available_at"),
                "economic_evidence": "OWNER_SCOPED_MODEL_ONLY_NOT_REALIZED",
                "economic_values": "NOT_REDISCLOSED",
            })
        if joint is not None:
            observation.update({
                "joint_purchasing_position": joint["position"],
                "joint_purchasing_reason": joint["reason"],
                "joint_purchasing_group_status": joint["group_status"],
                "joint_purchasing_evidence": "MODEL_ONLY_NOT_CONSENTED",
                "joint_purchasing_private_quotes": "NOT_REDISCLOSED",
            })
        return observation

class OperatorAKISModel(mesa.Model):
    """One Mesa clock: source events trigger state-dependent principal responses."""

    RESPONSE_LIMIT = 8192  # technical bound, not an organizational coefficient
    REACTION_TRIGGERS = frozenset({
        "initial_subject_evaluation", "goal_source_available", "goal_source_expired",
        "request", "offer", "authorize", "resource_status", "change_mode", "exclude", "commit",
        "complete", "reject", "resubmit", "accept", "source_update", "role_state_update", "resource_calendar_update",
        "outside_demand_signal", "outside_demand_withdraw",
        "outside_supplier_offer",
        "start_operation", "complete_operation", "handoff_dispatch", "handoff_receive", "handoff_quality", "assess_result_quality", "interest_update", "participation_status", "cooperation_change_propose", "cooperation_change_response", "model_code_propose", "model_code_response", "model_code_function_response", "model_code_apply",
        "technology_route_propose", "technology_route_response",
        "subject_registration_propose", "subject_registration_attest",
        "subject_registration_review", "subject_registration_apply",
        "resource_registration_propose", "resource_registration_review",
        "resource_registration_apply", "coalition_options_propose",
        "coalition_option_assess", "active_coalition_portfolio_propose",
        "active_coalition_portfolio_assess",
        "cooperation_lifecycle_propose", "cooperation_lifecycle_response",
        "cooperation_lifecycle_apply", "adopt_capability",
        "economic_outlook_available", "economic_outlook_expired",
        "joint_purchasing_quote_change",
        "owner_finance_source_available", "owner_finance_source_expired",
    })

    def __init__(self, scenario: dict[str, Any]) -> None:
        super().__init__(rng=0)
        if not isinstance(scenario, dict):
            raise InputError("INPUT_MUST_BE_OBJECT")
        research_input = dict(scenario)
        raw_profiles = research_input.pop("decision_profiles", [])
        raw_subject_goals = research_input.pop("subject_goals", [])
        raw_future_needs = research_input.pop("future_need_signals", [])
        raw_owner_finance = research_input.pop("owner_financial_reviews", [])
        raw_owner_forecast = research_input.pop("owner_payment_forecast_revisions", [])
        self.modern_economy_review_enabled = research_input.pop("modern_economy_review", False)
        if type(self.modern_economy_review_enabled) is not bool:
            raise InputError("MODERN_ECONOMY_REVIEW_MUST_BE_BOOLEAN")
        self.endogenous_subjects_enabled = research_input.pop("endogenous_subjects", False)
        if type(self.endogenous_subjects_enabled) is not bool:
            raise InputError("ENDOGENOUS_SUBJECTS_MUST_BE_BOOLEAN")
        if raw_subject_goals and not self.endogenous_subjects_enabled:
            raise InputError("SUBJECT_GOALS_REQUIRE_ENDOGENOUS_SUBJECTS")
        if raw_owner_finance and not self.endogenous_subjects_enabled:
            raise InputError("OWNER_FINANCE_REVIEW_REQUIRES_ENDOGENOUS_SUBJECTS")
        if raw_owner_forecast and not raw_owner_finance:
            raise InputError("OWNER_FORECAST_REVISIONS_REQUIRE_ORIGINAL_FINANCIAL_REVIEW")
        raw_outlooks = research_input.pop("economic_outlooks", [])
        raw_joint_purchasing = research_input.pop("joint_purchasing_proposals", [])
        raw_partner_discovery = research_input.pop("partner_discovery", None)
        raw_general_akis = research_input.pop("general_akis", None)
        requested_horizon = research_input.pop("model_horizon", None)
        if (requested_horizon is not None and
                (type(requested_horizon) is not int or
                 not 0 <= requested_horizon <= 10000)):
            raise InputError("MODEL_HORIZON_MUST_BE_NONNEGATIVE_INTEGER")
        raw_capability_adoptions = research_input.pop("capability_adoptions", None)
        self.capability_enabled = raw_capability_adoptions is not None
        self.competence_reuse_raw = research_input.pop("competence_reuse_evidence", None)
        self.competence_permissions_raw = research_input.pop("competence_reuse_permissions", None)
        self.competence_measurement_raw = research_input.pop("competence_measurement_protocols", None)
        if self.competence_measurement_raw is not None and self.competence_reuse_raw is None:
            raise InputError("MEASUREMENT_PROTOCOL_REQUIRES_ORIGINAL_REUSE_EVIDENCE")
        if self.competence_permissions_raw is not None and self.competence_reuse_raw is None:
            raise InputError("REUSE_PERMISSION_REQUIRES_ORIGINAL_EVIDENCE")
        self.economic_claims = research_input.pop("economic_claims", None)
        # Optional stronger research qualification: original owner-held
        # economic source rights checked by the SAME strict ContextBasis.
        self.strict_economic_source_work = research_input.pop(
            "strict_economic_source_work", None
        )
        if self.strict_economic_source_work is not None:
            if (not isinstance(self.strict_economic_source_work, str)
                    or not self.strict_economic_source_work.strip()
                    or self.economic_claims is None):
                raise InputError("ORIGINAL_STRICT_ECONOMIC_WORK_AND_LEDGER_REQUIRED")
            # Fail before the first Mesa event: without the original strict
            # ContextBasis a future subject cannot be source-qualified. A
            # later UNKNOWN_SOURCE_OWNER is not an adequate diagnosis.
            original_basis = research_input.get("context_evidence")
            if (not isinstance(original_basis, dict)
                    or original_basis.get("strict") is not True):
                raise InputError("ORIGINAL_ECONOMIC_STRICT_CONTEXT_REQUIRED")
        self.work_counterfactual_raw = research_input.pop("work_counterfactuals", None)
        if self.work_counterfactual_raw is not None and self.economic_claims is None:
            raise InputError("COUNTERFACTUAL_REQUIRES_ORIGINAL_ECONOMIC_CLAIMS")
        self.adaptation_enabled = "adaptation_requests" in research_input
        raw_reviews = research_input.pop("adaptation_requests", [])
        self.qualitative = QualitativeAKIS(research_input)
        if self.capability_enabled:
            try:
                self.qualitative.capability_policy = CapabilityAdoptionPolicy(
                    raw_capability_adoptions, self.qualitative,
                    reuse_raw=self.competence_reuse_raw,
                    permissions_raw=self.competence_permissions_raw,
                    measurement_raw=self.competence_measurement_raw,
                )
            except CapabilityInputError as exc:
                raise InputError(str(exc)) from exc
        self.capability_evolution: list[dict[str, Any]] = []
        self._capability_last_signature: str | None = None
        try:
            self.owner_financial_claims = parse_owner_finance(
                raw_owner_finance, state=self.qualitative,
                original_money=self.economic_claims,
            )
        except OwnerFinanceInputError as exc:
            raise InputError(str(exc)) from exc
        try:
            self.owner_forecast_revisions = parse_forecast_revisions(
                raw_owner_forecast, state=self.qualitative,
                original_money=self.economic_claims,
                owner_claims=self.owner_financial_claims,
            )
        except ForecastRevisionInputError as exc:
            raise InputError(str(exc)) from exc
        self._owner_cash_economic_cache: dict[str, Any] | None = None
        try:
            self.future_needs = parse_future_needs(raw_future_needs, self.qualitative)
        except FutureNeedInputError as exc:
            raise InputError(str(exc)) from exc
        self.future_need_evolution: list[dict[str, Any]] = []
        self._future_need_last_signature: str | None = None
        try:
            self.adaptation_requests = parse_review_requests(
                raw_reviews, self.qualitative.subjects
            ) if self.adaptation_enabled else []
        except AdaptationInputError as exc:
            raise InputError(str(exc)) from exc
        try:
            self.decision_profiles = parse_profiles(raw_profiles, self.qualitative.subjects)
        except ProfileInputError as exc:
            raise InputError(str(exc)) from exc
        try:
            known_works = dict(self.qualitative.works)
            for event in self.qualitative.events:
                if event["action"] == "request":
                    spec = event["work_spec"]
                    known_works.setdefault(
                        spec["id"], SimpleNamespace(
                            customer=spec["customer"],
                            source_revision=spec["source_revision"],
                        ),
                    )
            self.subject_goals = parse_subject_goals(
                raw_subject_goals, self.qualitative.subjects, known_works,
            )
            self.economic_outlooks = parse_outlooks(
                raw_outlooks, self.qualitative.subjects, self.qualitative.cooperation_links,
                known_works=set(known_works),
                future_membership_events=self.qualitative.events,
            )
            self.joint_purchasing_plans = parse_plans(
                raw_joint_purchasing, self.qualitative.subjects,
                self.qualitative.cooperation_links, known_works,
            )
            self.partner_discovery_enabled = raw_partner_discovery is not None
            if self.partner_discovery_enabled:
                self.discovery_demands, self.discovery_offers = parse_discovery(
                    raw_partner_discovery, self.qualitative.subjects,
                    known_works, self.qualitative.resources,
                )
                self.discovery_finance_enabled = "formation_finance" in raw_partner_discovery
                self.discovery_finance = parse_formation_finance(
                    raw_partner_discovery.get("formation_finance", []),
                    self.discovery_demands, self.discovery_offers,
                )
            else:
                self.discovery_demands, self.discovery_offers = (), ()
                self.discovery_finance_enabled = False
                self.discovery_finance = ()
            self.general_akis_enabled = raw_general_akis is not None
            # Research source declarations can describe a future owner
            # without prematurely adding that owner to the LIVE Mesa
            # subjects. The original event handler alone can register an
            # actual SME after its own assent and all founder reviews.
            prospective: dict[str, int] = {}
            prospective_kinds: dict[str, str] = {}
            for reg in self.qualitative.events:
                if reg["action"] != "subject_registration_apply":
                    continue
                proposal = next((
                    row for row in self.qualitative.events
                    if row["action"] == "subject_registration_propose"
                    and row.get("subject_registration_id") ==
                        reg.get("subject_registration_id")
                    and row["at"] < reg["at"]
                ), None)
                if proposal is not None:
                    key = proposal["new_subject"]
                    # Replayed/late APPLY events are negative decisions, not
                    # a redefinition of when the original source first
                    # allowed a future owner. Preserve the earliest time.
                    prospective[key] = min(
                        reg["at"], prospective.get(key, reg["at"])
                    )
                    prospective_kinds[key] = proposal.get(
                        "new_subject_kind", "SME"
                    )
            preflight_subjects = dict(self.qualitative.subjects)
            preflight_subjects.update({
                key: SimpleNamespace(
                    kind=prospective_kinds.get(key, "SME"), active=False
                )
                for key in prospective if key not in preflight_subjects
            })
            if self.general_akis_enabled:
                for rows in (
                    raw_general_akis["goals"],
                    raw_general_akis["formation_phases"],
                    raw_general_akis["context_cores"],
                    raw_general_akis["agent_functions"],
                    raw_general_akis["organizational_code"],
                ):
                    for row in rows:
                        if (isinstance(row, dict)
                                and row.get("owner") in prospective
                                and type(row.get("available_at")) is int
                                and row["available_at"] <
                                    prospective[row["owner"]]):
                            raise InputError(
                                "FUTURE_ORIGINAL_SME_CANNOT_CLAIM_PAST_SOURCE"
                            )
            self.general_design = parse_general_system(
                raw_general_akis, preflight_subjects, known_works
            ) if self.general_akis_enabled else None
            if (self.general_akis_enabled and
                    (self.general_design.enforce_model_org_code or
                     self.general_design.enforce_model_formation_phases)):
                # R1-V1 allows scoped INTER-firm Work with independent SMEs,
                # but ONLY under the opt-in original form gate. The existing
                # operator remains a procedural coordinator and cannot replace
                # original owners' consent. Other author forms require subject
                # classes not present in this original model and fail closed.
                allowed = (
                    {"operator", "inter", "intra", "sector", "macro", "trace"}
                    if self.general_design.enforce_model_author_configuration_work_scope
                    else {"operator"}
                )
                if self.general_design.configuration not in allowed:
                    raise OrgCodeInputError(
                        "OC_ENFORCEMENT_ONLY_ORIGINAL_OPERATOR_MODEL"
                        if not self.general_design.enforce_model_author_configuration_work_scope
                        else "AUTHOR_FORM_ORIGINAL_SUBJECT_CLASSES_NOT_IMPLEMENTED"
                    )
            self.model_org_policy = (
                parse_org_code_policy(
                    self.general_design.declarations["organizational_code"],
                    # A future role may be SOURCE-DECLARED in the thirteen
                    # controls, but remains inactive until original APPLY.
                    # Preflight never adds it to QualitativeAKIS.subjects.
                    preflight_subjects, self.qualitative.institution,
                    actions=set(ACTIONS),
                ) if self.general_akis_enabled and
                     self.general_design.enforce_model_org_code else None
            )
            # The existing original event handler consults only this optional
            # restricting predicate; no second governance state or event log.
            self.qualitative.model_org_policy = self.model_org_policy
            self.formation_policy = (
                ModelFormationPolicy(self.general_design)
                if self.general_akis_enabled and
                self.general_design.enforce_model_formation_phases else None
            )
            self.qualitative.formation_policy = self.formation_policy
        except (OutlookInputError, PurchasingInputError, DiscoveryInputError,
                GeneralSystemInputError, OrgCodeInputError, GoalInputError) as exc:
            raise InputError(str(exc)) from exc
        self.parties = [EconomicSubject(self, key, party.kind) for key, party in self.qualitative.subjects.items()]
        self._by_id = {subject.party_id: subject for subject in self.parties}
        self.endogenous_choice_evolution: list[dict[str, Any]] = []
        self._endogenous_last_signature: dict[str, tuple[Any, ...]] = {}
        self.decision_observations: list[dict[str, Any]] = []
        # Derived snapshots, never a second journal or an original event stream.
        self.general_views: list[dict[str, Any]] = []
        self._general_last_signature: str | None = None
        self.assessment_truncated = False
        self._scheduled_reactions = 0
        self._outlook_epoch = 0
        self.review_inquiries: list[dict[str, Any]] = []
        self._interest_events_present = any(
            event["action"] == "interest_update" for event in self.qualitative.events
        )
        self._future_participation_events_present = any(
            event["action"] == "participation_status" for event in self.qualitative.events
        )
        self._cooperation_change_events_present = any(
            event["action"] in {"cooperation_change_propose", "cooperation_change_response"}
            for event in self.qualitative.events
        )
        self._review_active = (
            bool(self.future_needs) or bool(self.owner_financial_claims) or self.adaptation_enabled or self.economic_claims is not None or bool(self.economic_outlooks) or bool(self.joint_purchasing_plans)
            or self.qualitative.context_basis is not None
            or self.qualitative.portfolio_review_enabled
            or self.qualitative.handoff_strict
            or self._interest_events_present
            or self._future_participation_events_present
            or self._cooperation_change_events_present
            or self.partner_discovery_enabled
            or self.capability_enabled
            or any(spec.calendar is not None for spec in self.qualitative.resource_specs.values())
            or any(ev["action"] == "resource_calendar_update" for ev in self.qualitative.events)
            or any(work.requires_accepted for work in self.qualitative.works.values())
        )
        # Mesa may hold callbacks weakly: keep references for the lifetime of the simulation.
        self._callbacks: list[Any] = []
        for event in self.qualitative.events:
            callback = partial(self._apply_event, event)
            self._callbacks.append(callback)
            self.schedule_event(callback, at=float(event["at"]), priority=Priority.HIGH)
        # Forecast activation and expiration reuse the SAME Mesa scheduler.
        # Neither is appended as an ORIGINAL economic event or accepted Result.
        last_original_at = max((event["at"] for event in self.qualitative.events), default=0)
        if requested_horizon is not None and requested_horizon < last_original_at:
            raise InputError("MODEL_HORIZON_PRECEDES_ORIGINAL_EVENTS")
        self._model_end_at = (
            requested_horizon if requested_horizon is not None else max(
                last_original_at,
                max((row.available_at for row in self.economic_outlooks), default=0),
                max((row.available_at for row in self.subject_goals), default=0),
                max((row.expires_at for row in self.owner_financial_claims), default=0),
                max((row.expires_at for row in self.future_needs), default=0),
                max((plan.supplier_start for plan in self.joint_purchasing_plans), default=0),
                max((buyer.available_at for plan in self.joint_purchasing_plans
                     for buyer in plan.buyers), default=0),
                max((row.available_at for row in self.discovery_demands), default=0),
                max((row.available_at for row in self.discovery_offers), default=0),
                max((row.available_at for row in self.discovery_finance), default=0),
                max(self.general_design.source_times, default=0)
                if self.general_design is not None else 0,
            )
        )
        outlook_changes = {
            (row.available_at, "economic_outlook_available", row.work)
            for row in self.economic_outlooks
        } | {
            (row.expires_at, "economic_outlook_expired", row.work)
            for row in self.economic_outlooks if row.expires_at <= self._model_end_at
        }
        for at, trigger, work_id in sorted(outlook_changes):
            callback = partial(self._reassess_economic_outlook, work_id, trigger)
            self._callbacks.append(callback)
            self.schedule_event(callback, at=float(at), priority=Priority.DEFAULT)
        # Goals are private research claims; their availability changes use the
        # same Mesa scheduler and never enter the original legal/event trace.
        goal_changes = {
            (row.available_at, "goal_source_available", row.work)
            for row in self.subject_goals if row.available_at <= self._model_end_at
        } | {
            (row.expires_at, "goal_source_expired", row.work)
            for row in self.subject_goals if row.expires_at <= self._model_end_at
        }
        for at, trigger, work_id in sorted(goal_changes):
            callback = partial(self._reassess_economic_outlook, work_id, trigger)
            self._callbacks.append(callback)
            self.schedule_event(callback, at=float(at), priority=Priority.DEFAULT)
        owner_finance_changes = {
            (row.available_at, "owner_finance_source_available", row.work)
            for row in self.owner_financial_claims
            if row.available_at <= self._model_end_at
        } | {
            (row.expires_at, "owner_finance_source_expired", row.work)
            for row in self.owner_financial_claims
            if row.expires_at <= self._model_end_at
        }
        for at, trigger, work_id in sorted(owner_finance_changes):
            callback = partial(self._reassess_economic_outlook, work_id, trigger)
            self._callbacks.append(callback)
            self.schedule_event(callback, at=float(at), priority=Priority.DEFAULT)
        if self.future_needs:
            # The model's ONE scheduler observes owner-preexisting demand
            # sources. Neither availability nor expiration creates Work.
            instants = {0, self._model_end_at}
            for claim in self.future_needs:
                instants.update({claim.available_at, claim.expires_at})
            for at in sorted(t for t in instants if t <= self._model_end_at):
                callback = self._capture_future_need_state
                self._callbacks.append(callback)
                self.schedule_event(callback, at=float(at), priority=Priority.LOW)
        procurement_changes = set()
        for plan in self.joint_purchasing_plans:
            for at in (plan.supplier_start, plan.supplier_end):
                if at <= self._model_end_at:
                    procurement_changes.add((at, plan.key))
            for buyer in plan.buyers:
                for at in (buyer.available_at, buyer.expires_at):
                    if at <= self._model_end_at:
                        procurement_changes.add((at, plan.key))
        for at, plan_key in sorted(procurement_changes):
            callback = partial(self._reassess_joint_purchasing, plan_key)
            self._callbacks.append(callback)
            self.schedule_event(callback, at=float(at), priority=Priority.DEFAULT)
        if self.partner_discovery_enabled:
            # The original event trace and source validity changes share ONE
            # Mesa clock. Capture once per instant, AFTER original actions,
            # with no extra organization journal or new relationship object.
            instants = {ev["at"] for ev in self.qualitative.events}
            for claim in (*self.discovery_demands, *self.discovery_offers, *self.discovery_finance):
                instants.update((claim.available_at, claim.expires_at))
            for at in sorted(t for t in instants if t <= self._model_end_at):
                callback = self._capture_partner_discovery
                self._callbacks.append(callback)
                self.schedule_event(callback, at=float(at), priority=Priority.LOW)
        if self.capability_enabled:
            # Existing Mesa scheduler, after original high-priority actions.
            # One immutable observation per changed source/owner status.
            for at in sorted({0, self._model_end_at} |
                             {ev["at"] for ev in self.qualitative.events}):
                callback = self._capture_capability_state
                self._callbacks.append(callback)
                self.schedule_event(callback, at=float(at), priority=Priority.LOW)
        if self.general_akis_enabled:
            # One original model clock; take read-only assessments after every
            # original transition and every current-source change.
            instants = {0, self._model_end_at}
            instants.update(ev["at"] for ev in self.qualitative.events)
            instants.update(self.general_design.source_times)
            for at in sorted(t for t in instants if t <= self._model_end_at):
                callback = self._capture_general_system
                self._callbacks.append(callback)
                self.schedule_event(callback, at=float(at), priority=Priority.LOW)
        if self.endogenous_subjects_enabled:
            # One Mesa clock. Initial choices at t=0 need no invented source
            # event and can never enter the original QualitativeAKIS trace.
            for work_id in sorted(self.qualitative.works):
                self._schedule_responses({
                    "action": "initial_subject_evaluation", "work": work_id,
                })

    def _private_cash_economics(
        self, *, owner: str | None = None, work_id: str | None = None,
    ) -> dict[str, Any]:
        """Read original economic claims only, never create a second money book.

        The subset excludes independent optional audit mechanisms so owner
        review does not prematurely require a later accepted Result. Cash is
        explicitly prospective, not evidence of real settlement.
        """
        if self._owner_cash_economic_cache is None:
            if not isinstance(self.economic_claims, dict):
                raise InputError("OWNER_FINANCE_REQUIRES_ORIGINAL_CASH_TIMING")
            original = self.economic_claims
            required = (
                "period", "currency", "sources", "transfers",
                "resource_uses", "coverage", "outside_feasibility", "cash_timing",
            )
            try:
                self._owner_cash_economic_cache = evaluate_economic_claims(
                    {k: original[k] for k in required},
                    self.qualitative.subjects, self.qualitative.works,
                    self.qualitative.cooperation_links, self.qualitative.trace,
                )
            except (EconomicInputError, KeyError) as exc:
                raise InputError("OWNER_FINANCE_ORIGINAL_CASH_PROJECTION_INVALID") from exc
        if owner is not None and work_id is not None and self.owner_forecast_revisions:
            updated = private_forecast_override(
                self.owner_forecast_revisions, owner=owner, work=work_id,
                at=float(self.time), original_money=self.economic_claims,
                state=self.qualitative,
            )
            if updated is not None:
                original = self.economic_claims
                # This is only a read-only owner-private reinterpretation.
                # Other principals never see updated transfer timing.
                keys = (
                    "period", "currency", "sources", "transfers",
                    "resource_uses", "coverage", "outside_feasibility",
                )
                try:
                    return evaluate_economic_claims(
                        {**{key: original[key] for key in keys},
                         "cash_timing": updated},
                        self.qualitative.subjects, self.qualitative.works,
                        self.qualitative.cooperation_links, self.qualitative.trace,
                    )
                except (EconomicInputError, KeyError) as exc:
                    raise InputError("OWNER_FORECAST_PRIVATE_PROJECTION_INVALID") from exc
        return self._owner_cash_economic_cache

    def _capture_general_system(self) -> None:
        view = general_system_view(
            self.general_design, self.qualitative, at=float(self.time))
        # Record only causal changes, not a new event/Result journal.
        signature = json.dumps(
            {"components": view["components"],
             "phases": view["formation_phases"],
             "org": view["organizational_code"],
             "org_model_edition": view["model_organizational_code_review"],
             "contexts": view["context_cores"],
             "configuration_dynamics": view["configuration_dynamics"],
             "bounded_agent_process": view["bounded_process_function_outputs"]},
            sort_keys=True, ensure_ascii=False)
        if signature != self._general_last_signature:
            self.general_views.append({
                "at": float(self.time),
                "original_trace_position": len(self.qualitative.trace),
                "projection": view,
            })
            self._general_last_signature = signature

    def _capture_partner_discovery(self) -> None:
        view = discover(
            self.discovery_demands, self.discovery_offers, self.qualitative,
            at=float(self.time),
            formation_finance=(self.discovery_finance if self.discovery_finance_enabled
                               else None),
        )
        self.decision_observations.append({
            "at": self.time,
            "source_trace_position": len(self.qualitative.trace),
            "observation_kind": "SIMULATED_FORMATION_OPPORTUNITY",
            "evidence": "MODEL_ONLY",
            "work_proposals": view["candidates"],
            "current_opportunity_count": view["current_opportunity_count"],
            "contested_opportunity_count": view["contested_opportunity_count"],
            **({"economically_reviewable_count": view["economically_reviewable_count"]}
               if self.discovery_finance_enabled else {}),
            "effect": "NO_AUTOMATIC_MEMBERSHIP_OR_RESOURCE_REASSIGNMENT",
        })

    def _reassess_joint_purchasing(self, plan_key: str) -> None:
        self._outlook_epoch += 1
        plan = next(plan for plan in self.joint_purchasing_plans
                    if plan.key == plan_key)
        for buyer in plan.buyers:
            self._schedule_responses({
                "action": "joint_purchasing_quote_change",
                "work": buyer.work,
            })

    def _willing_joint_buyers(self, plan: Any) -> set[str]:
        state = self.qualitative
        eligible = set()
        for buyer in plan.buyers:
            work = state.works.get(buyer.work)
            if work is None or work.source_revision != buyer.work_revision:
                continue
            if any(link.key == plan.relation and buyer.work in link.works
                   and latest_future_participation(
                       state.trace, link.key, buyer.owner,
                       link.source_revision, state.institution.revision,
                   ) == "PAUSED_NEW_WORK"
                   for link in state.cooperation_links):
                continue
            claim = latest_owner_interest_claim(
                state.trace, buyer.owner, buyer.work,
                work.source_revision, state.institution.revision,
            )
            if claim is None:
                profile = self.decision_profiles.get((buyer.owner, buyer.work))
                if (profile is None or profile.source_revision != work.source_revision
                        or profile.org_revision != state.institution.revision):
                    continue
                claim = (profile.willingness, profile.outside_option)
            if claim[0] == "WILLING" and claim[1] != "OUTSIDE_PREFERRED":
                eligible.add(buyer.owner)
        return eligible

    def _joint_purchasing_view(self, plan: Any) -> dict[str, Any]:
        state = self.qualitative
        return evaluate_plan(
            plan, at=float(self.time), org_revision=state.institution.revision,
            links=state.cooperation_links, subjects=state.subjects,
            works=state.works, willing_owners=self._willing_joint_buyers(plan),
        )

    def _joint_purchasing_position(self, owner: str, work_id: str) -> dict[str, str] | None:
        candidates = [
            plan for plan in self.joint_purchasing_plans
            if any(row.owner == owner and row.work == work_id
                   for row in plan.buyers)
        ]
        if not candidates:
            return None
        # One economic buyer's Work can belong to several relations. Only
        # that buyer (not unrelated original resource owners) needs a choice.
        if sum(work_id in link.works for link in self.qualitative.cooperation_links) > 1:
            return {"position": "UNKNOWN", "reason": "MULTIPLE_RELATIONS_REQUIRE_OWNER_CHOICE",
                    "group_status": "AMBIGUOUS"}
        if len(candidates) > 1:
            return {"position": "UNKNOWN", "reason": "MULTIPLE_PURCHASE_PLANS_OWNER_CHOICE_REQUIRED",
                    "group_status": "AMBIGUOUS"}
        result = self._joint_purchasing_view(candidates[0])
        position = result["positions"].get(owner, {})
        return {
            "position": position.get("position", "UNKNOWN"),
            "reason": position.get("reason", result["status"]),
            "group_status": result["status"],
        }

    def _capture_capability_state(self) -> None:
        if not self.capability_enabled:
            return
        policy = self.qualitative.capability_policy
        policy.refresh(self.qualitative, int(self.time))
        current = policy.snapshot(self.qualitative, int(self.time))
        signature = json.dumps(current["declarations"], sort_keys=True, ensure_ascii=False)
        if signature == self._capability_last_signature:
            return
        self._capability_last_signature = signature
        self.capability_evolution.append({
            "at": float(self.time),
            "original_event_trace_position": len(self.qualitative.trace),
            "original_owner_capability_declarations": current["declarations"],
            "new_original_work_created": False,
        })

    def _capture_future_need_state(self) -> None:
        if not self.future_needs:
            return
        now = float(self.time)
        choices = {subject: agent.modeled_choices for subject, agent in self._by_id.items()}
        projection = future_need_projection(
            self.qualitative, self.future_needs, at=now, actor_choices=choices,
        )
        signature = json.dumps({
            "needs": [(row["need"], row["status"], row["resource_competition"],
                       row["original_work_request_confirmed"])
                      for row in projection["needs"]],
            "competed": projection["capacity_contested_count"],
        }, sort_keys=True)
        if signature != self._future_need_last_signature:
            self._future_need_last_signature = signature
            self.future_need_evolution.append({
                "at": now,
                "original_trace_position": len(self.qualitative.trace),
                "projection": projection,
                "source_kind": "OWNER_MODEL_ONLY_FUTURE_NEED_NOT_ORIGINAL_WORK",
            })

    def _schedule_future_need_refresh(self) -> None:
        if self.future_needs:
            callback = self._capture_future_need_state
            self._callbacks.append(callback)
            self.schedule_event(callback, after=0.0, priority=Priority.LOW)

    def _reassess_economic_outlook(self, work_id: str, trigger: str) -> None:
        self._outlook_epoch += 1
        self._schedule_responses({"action": trigger, "work": work_id})
        self._schedule_future_need_refresh()

    def _apply_event(self, event: dict[str, Any]) -> None:
        outcome = self.qualitative.apply(event, int(self.time))
        if (event["action"] == "subject_registration_apply"
                and outcome["outcome"] == "APPLIED"):
            key = outcome["registered_original_subject"]
            # Native EconomicSubject is created in the SAME Mesa model only
            # after its original independent registration has succeeded.
            agent = EconomicSubject(self, key, self.qualitative.subjects[key].kind)
            self.parties.append(agent)
            self._by_id[key] = agent
        if (self.decision_profiles or self.endogenous_subjects_enabled or
                self.economic_outlooks or self.joint_purchasing_plans or
                event["action"] in {"interest_update", "participation_status",
                                    "cooperation_change_propose", "cooperation_change_response",
                                    "cooperation_lifecycle_propose", "cooperation_lifecycle_response",
                                    "cooperation_lifecycle_apply",
                                    "role_state_update"}
                ) and outcome["outcome"] == "APPLIED":
            self._schedule_responses(event)
        if outcome["outcome"] == "APPLIED":
            self._schedule_future_need_refresh()
        if self._review_active or any(
            work.requires_accepted for work in self.qualitative.works.values()
        ):
            inquiry = inquiry_from_applied_event(outcome)
            if inquiry is not None:
                callback = partial(self._capture_inquiry, inquiry)
                self._callbacks.append(callback)
                self.schedule_event(callback, after=0.0)

    def _capture_inquiry(self, inquiry: dict[str, Any]) -> None:
        self.review_inquiries.append({
            **inquiry,
            "at": self.time,
            "observation_kind": "SIMULATED_ADAPTATION_INQUIRY",
        })

    def _schedule_responses(self, event: dict[str, Any]) -> None:
        action = event["action"]
        if action not in self.REACTION_TRIGGERS:
            return
        state = self.qualitative
        if action == "request":
            impacted = [event["work_spec"]["id"]]
        elif action in {"resource_status", "resource_calendar_update", "adopt_capability"}:
            impacted = [work.key for work in state.works.values() if any(
                need.resource == event["resource"] for need in work.resource_requirements)]
        elif action == "source_update":
            impacted = state.context_basis.affected_works(event["source"]) if state.context_basis else []
        elif action in {"outside_demand_signal", "outside_demand_withdraw",
                       "outside_supplier_offer"}:
            # Only the affected owner's existing model outlook is revisited.
            # This does not create a Work, book capacity or provide consent.
            demand_id = event["outside_demand_id"]
            impacted = [
                outlook.work for outlook in self.economic_outlooks
                if outlook.outside_demand_claim is not None
                and outlook.outside_demand_claim[0] == demand_id
            ]
        elif action == "role_state_update":
            # Re-evaluate only prospective original obligations involving
            # this owner. No new clock, no re-opening accepted Result.
            role = event["role_target"]
            impacted = [
                w.key for w in state.works.values()
                if w.obligation == "NOT_ACCEPTED"
                and (w.customer == role or role in
                     state.capacity_ledger.original_owners(w.resource_requirements))
            ]
        elif action in {"change_mode", "model_code_apply"}:
            impacted = [work.key for work in state.works.values() if work.obligation == "NOT_ACCEPTED"]
        elif action in {"model_code_propose", "model_code_response",
                         "model_code_function_response",
                         "technology_route_propose", "technology_route_response",
                         "subject_registration_propose",
                         "subject_registration_attest",
                         "subject_registration_review",
                         "subject_registration_apply",
                         "resource_registration_propose",
                         "resource_registration_review",
                         "resource_registration_apply",
                         "coalition_options_propose",
                         "coalition_option_assess",
                         "active_coalition_portfolio_propose",
                         "active_coalition_portfolio_assess"}:
            # Registrations and comparisons do not book resources or create Work.
            impacted = []
        elif action in {"participation_status", "cooperation_change_propose", "cooperation_change_response",
                         "cooperation_lifecycle_propose", "cooperation_lifecycle_response",
                         "cooperation_lifecycle_apply"}:
            link = next((link for link in state.cooperation_links
                         if link.key == event["cooperation_link"]), None)
            impacted = list(link.works) if link is not None else []
        elif action == "exclude":
            affected = event["subject"]
            impacted = [work.key for work in state.works.values()
                        if work.customer == affected or any(
                    state.resources[need.resource] == affected for need in work.resource_requirements)]
        elif action in {"complete", "reject", "resubmit", "accept"}:
            source_work = event["work"]
            impacted = [source_work] + [work.key for work in state.works.values()
                                       if source_work in getattr(work, "requires_accepted", ())]
            impacted.extend(
                outlook.work for outlook in self.economic_outlooks
                if any(prior_work == source_work
                       for prior_work, _ in outlook.requires_accepted_results)
            )
            impacted.extend(
                goal.work for goal in self.subject_goals
                if any(prior_work == source_work
                       for prior_work, _ in goal.requires_accepted_results)
            )
        else:
            impacted = [event["work"]]
        if self.joint_purchasing_plans:
            expanded = set(impacted)
            for plan in self.joint_purchasing_plans:
                buyer_works = {buyer.work for buyer in plan.buyers}
                if (buyer_works & expanded
                    or action in {"change_mode", "exclude", "participation_status"}
                    or any(prior_work in expanded for buyer in plan.buyers
                           for prior_work, _ in buyer.prerequisites)):
                    expanded.update(buyer_works)
            impacted = list(expanded)
        for key in sorted(set(impacted)):
            if key not in state.works:
                continue  # Forecast can be available before a work is requested.
            work = state.works[key]
            for subject in sorted({work.customer} | {
                state.resources[need.resource] for need in work.resource_requirements}):
                if self._scheduled_reactions >= self.RESPONSE_LIMIT:
                    self.assessment_truncated = True
                    return
                callback = partial(self._capture_response, subject, key, action,
                                   len(state.trace), self._outlook_epoch)
                self._callbacks.append(callback)
                self.schedule_event(callback, after=0.0, priority=Priority.LOW)
                self._scheduled_reactions += 1

    def _capture_response(self, subject: str, work_id: str, trigger: str,
                          triggering_trace_position: int, triggering_outlook_epoch: int) -> None:
        observation: dict[str, Any] = self._by_id[subject].assess(work_id)
        original_work = self.qualitative.works.get(work_id)
        observation.update({
            "at": self.time,
            "trigger": trigger,
            "org_revision": self.qualitative.institution.revision,
            "work_source_revision": (
                original_work.source_revision if original_work is not None else None
            ),
            "source_trace_position": triggering_trace_position,
            "source_event_state_is_current": (
                triggering_trace_position == len(self.qualitative.trace)
                and triggering_outlook_epoch == self._outlook_epoch
            ),
            "observation_kind": "SIMULATED_SUBJECT_RESPONSE",
        })
        self.decision_observations.append(observation)
        if self.endogenous_subjects_enabled and original_work is not None:
            observation["endogenous_choice"] = self._by_id[subject].choose(
                work_id, observation, triggering_trace_position,
                triggering_outlook_epoch,
            )
            choices = {key: agent.modeled_choices
                       for key, agent in self._by_id.items()}
            group = cooperative_choice_state(
                self.qualitative, choices, work_id, at=float(self.time),
                trace_position=triggering_trace_position,
                outlook_epoch=triggering_outlook_epoch,
            )
            if group["status"] != "WAIT_FOR_ALL_CURRENT_INDEPENDENT_CHOICES":
                current_choices = tuple(
                    (principal,
                     choices.get(principal, {}).get(work_id, {}).get("action"),
                     choices.get(principal, {}).get(work_id, {}).get("goal_comparison"))
                    for principal in group["original_principals"]
                )
                signature = (
                    group["status"], group["original_obligation"],
                    group["original_result"], tuple(group["original_principals"]),
                    current_choices,
                )
                # Python lists are not hashable, but tuples in signature are
                # compared by value (not hashed) to avoid duplicate snapshots.
                if self._endogenous_last_signature.get(work_id) != signature:
                    self._endogenous_last_signature[work_id] = signature
                    self.endogenous_choice_evolution.append({
                        **group, "trigger": trigger,
                        "original_trace_position": triggering_trace_position,
                        "outlook_epoch": triggering_outlook_epoch,
                        "causality": "DERIVED_FROM_INDEPENDENT_MESA_AGENT_CHOICES",
                    })
        if original_work is not None and self.qualitative.cooperation_links:
            # Read the state NOW, not the final end-of-run state. This adds a
            # view to an existing observation, not another scheduler or event log.
            observation["cooperation_model_review"] = cooperative_model_readiness(
                self.qualitative.cooperation_links, self.qualitative.works,
                self.qualitative.resources, self.qualitative.institution,
                self.decision_observations, work_id=work_id,
            )

    def execute(self) -> dict[str, Any]:
        if self.qualitative.events or self.future_needs or self.endogenous_subjects_enabled or self.economic_outlooks or self.joint_purchasing_plans or self.partner_discovery_enabled or self.general_akis_enabled:
            # Inclusive integer horizon; flush same-time reactions without
            # executing the next period at model_horizon + 1.
            self.run_until(float(self._model_end_at) + 0.5)
        output = self.qualitative.snapshot()
        if (self.economic_claims is not None or self.owner_financial_claims or
                self.qualitative.context_basis is not None
                or self.general_akis_enabled):
            # This executable research payload includes original owner-scoped
            # sources and may include other principals' cash values. A safe
            # nine-component projection is not a permission to disclose the
            # complete JSON to every member. Role-aware filtering belongs to
            # the already existing IWXA authority/ToolProvider boundary.
            output["research_export_boundary"] = {
                "entire_raw_result_safe_for_cross_enterprise_distribution": False,
                "role_filtered_real_export_implemented_here": False,
                "original_owner_financial_and_source_values_may_be_present": True,
                "private_original_work_future_need_and_capability_evidence_may_be_present": (
                    self.general_akis_enabled
                ),
                "requires_existing_external_owner_authorization_and_redaction": True,
                "model_only_not_a_corporate_IAM_decision": True,
            }
        if self.capability_enabled:
            projection = self.qualitative.capability_policy.snapshot(
                self.qualitative, int(self.time))
            output["capability_dynamics"] = {
                **projection,
                "read_only_evolution": list(self.capability_evolution),
                "current_planned_capacity_is_model_declared_not_physical": True,
                "original_economic_ledger_still_required_for_net_value": True,
                "single_existing_mesa_scheduler": True,
            }
        if self.decision_profiles or self.endogenous_subjects_enabled or self.economic_outlooks or self.joint_purchasing_plans or self.partner_discovery_enabled or self._interest_events_present or self._future_participation_events_present or self._cooperation_change_events_present:
            output["decision_observations"] = list(self.decision_observations)
            output["decision_observations_truncated"] = self.assessment_truncated
        if self.future_needs:
            current = future_need_projection(
                self.qualitative, self.future_needs, at=float(self.time),
                actor_choices={subject: agent.modeled_choices
                               for subject, agent in self._by_id.items()},
            )
            output["future_need_dynamics"] = {
                "current": current,
                "read_only_evolution": list(self.future_need_evolution),
                "pre_order_owner_need_is_not_original_work": True,
                "accepted_original_result_can_activate_future_need": True,
                "no_automatic_original_request_or_contract": True,
                "no_automatic_resource_reservation": True,
                "single_existing_mesa_scheduler": True,
                "single_existing_original_capacity_ledger": True,
            }
        if self.endogenous_subjects_enabled:
            # Read-only adaptation of actor decisions within the SAME Mesa model.
            # No source evidence, original event or legal result is synthesized.
            last_by_work = {
                row["work"]: row for row in self.endogenous_choice_evolution
            }
            output["endogenous_subjects"] = {
                "evidence": "MODEL_ONLY_SIMULATED_CHOICES_NOT_OWNER_STATEMENTS",
                "last_jointly_observed": [last_by_work[k] for k in sorted(last_by_work)],
                "read_only_evolution": list(self.endogenous_choice_evolution),
                "unobserved_work_ids": sorted(set(self.qualitative.works) - set(last_by_work)),
                "new_original_events_created": False,
                "original_work_result_and_consent_unchanged": True,
                "independent_original_principals": True,
                "single_mesa_scheduler": True,
            }
            if self.owner_financial_claims:
                # Deliberately do not disclose owner, balance, risk or which
                # particular economic condition caused the generic review.
                output["endogenous_subjects"]["private_financial_evidence_boundary"] = {
                    "scope": "ORIGINAL_OWNER_PRIVATE_RESEARCH_SOURCE",
                    "shared_observation_contains_original_CASH_VALUES": False,
                    "source_time_review_uses_existing_mesa_clock": True,
                    "actual_owner_consent_or_payment_created": False,
                    "forecast_revision_requires_applied_original_source_update": bool(
                        self.owner_forecast_revisions
                    ),
                    "forecast_revision_changes_shared_cash_ledger": False,
                }
        if self.partner_discovery_enabled:
            current = discover(
                self.discovery_demands, self.discovery_offers, self.qualitative,
                at=float(self.time),
                formation_finance=(self.discovery_finance if self.discovery_finance_enabled
                                   else None),
            )
            evolution = []
            previous_signature = None
            for observation in self.decision_observations:
                if observation.get("observation_kind") != "SIMULATED_FORMATION_OPPORTUNITY":
                    continue
                signature = tuple(
                    (row["id"], row["status"], row["candidate_count"],
                     row.get("economic_status"), row.get("economically_possible_count"))
                    for row in observation["work_proposals"]
                )
                if signature == previous_signature:
                    continue
                previous_signature = signature
                evolution.append({
                    "at": observation["at"],
                    "source_trace_position": observation["source_trace_position"],
                    "current_opportunity_count": observation["current_opportunity_count"],
                    "contested_opportunity_count": observation["contested_opportunity_count"],
                    **({"economically_reviewable_count": observation["economically_reviewable_count"]}
                       if self.discovery_finance_enabled else {}),
                    "work_proposals": observation["work_proposals"],
                })
            output["formation_opportunities"] = {
                **current,
                "evolution": evolution,
                "economic_choice": ("SOURCE_DECLARED_BILATERAL_INTERVAL_ONLY"
                                    if self.discovery_finance_enabled else
                                    "NOT_IDENTIFIABLE_WITHOUT_INDEPENDENT_ALTERNATIVES"),
                "original_principals_and_customer_must_revise_before_substitution": True,
                "new_cooperation_relation_created": False,
                "same_mesa_scheduler": True,
            }
        if self.economic_claims is not None:
            # When strict source-use is requested, assert the original KPB
            # BEFORE evaluating any owner's economic records. A revoked
            # source must not leak through intermediate financial projections.
            # This gate never mutates a completed original Work/Result.
            original_economic_rights = None
            if self.strict_economic_source_work is not None:
                try:
                    original_economic_rights = (
                        review_original_strict_economic_sources(
                            state=self.qualitative,
                            original_claims=self.economic_claims,
                            work_id=self.strict_economic_source_work,
                            at=int(self.time),
                        )
                    )
                except StrictEconomicSourceBlocked as exc:
                    raise InputError(str(exc)) from exc
            # Work IDs may be created during the run, so check references against
            # the *final* portfolio without interpreting cash movements as Result.
            try:
                output["economics"] = evaluate_economic_claims(
                    self.economic_claims, self.qualitative.subjects, self.qualitative.works,
                    self.qualitative.cooperation_links, self.qualitative.trace,
                )
            except EconomicInputError as exc:
                raise InputError(str(exc)) from exc
            if original_economic_rights is not None:
                output["economics"][
                    "original_strict_context_source_qualification"
                ] = original_economic_rights
            if ("joint_purchasing_ancillary_original_bindings" in self.economic_claims
                    and "joint_purchasing_original_cash_bindings" not in self.economic_claims):
                raise InputError("PURCHASE_ANCILLARY_REQUIRES_ORIGINAL_PURCHASE_PRICE_REFERENCES")
            if "joint_purchasing_original_cash_bindings" in self.economic_claims:
                try:
                    original_purchasing = review_original_joint_purchase_cash(
                        self.economic_claims["joint_purchasing_original_cash_bindings"],
                        plans=self.joint_purchasing_plans,
                        economic_claims=self.economic_claims,
                        works=self.qualitative.works,
                        links=self.qualitative.cooperation_links,
                        org_revision=self.qualitative.institution.revision,
                    )
                    output["economics"]["joint_purchasing_original_cash_linkage"] = (
                        original_purchasing
                    )
                except PurchasingInputError as exc:
                    raise InputError(str(exc)) from exc
            if "joint_purchasing_ancillary_original_bindings" in self.economic_claims:
                try:
                    original_ancillary = review_original_joint_purchase_ancillary(
                        self.economic_claims["joint_purchasing_ancillary_original_bindings"],
                        plans=self.joint_purchasing_plans,
                        price_review=output["economics"]["joint_purchasing_original_cash_linkage"],
                        economic_claims=self.economic_claims,
                        works=self.qualitative.works,
                        links=self.qualitative.cooperation_links,
                        economic_view=output["economics"],
                    )
                    output["economics"]["joint_purchasing_ancillary_original_cash"] = (
                        original_ancillary
                    )
                except PurchasingInputError as exc:
                    raise InputError(str(exc)) from exc
        if self.competence_reuse_raw is not None:
            try:
                permissions = (review_permissions(
                    self.competence_permissions_raw, self.qualitative,
                    self.competence_reuse_raw,
                ) if self.competence_permissions_raw is not None else None)
                output["competence_reuse_dynamics"] = evaluate_competence_reuse(
                    self.competence_reuse_raw, self.qualitative,
                    economics=output.get("economics"),
                    permission_reviews=permissions,
                )
                if permissions is not None:
                    output["competence_reuse_dynamics"]["permission_evidence"] = {
                        "cross_enterprise_model_permission_count": sum(
                            row["status"] == "MODEL_SOURCE_SCOPED_OWNER_TRANSFER"
                            for row in permissions.values()),
                        "verified_legal_licence": False,
                        "original_contracts_and_consents_unchanged": True,
                    }
            except (ReuseInputError, CompetencePermissionInputError) as exc:
                raise InputError(str(exc)) from exc
        if self.competence_measurement_raw is not None:
            try:
                output["competence_reuse_dynamics"]["declared_measurement_protocols"] = (
                    review_measurement_protocols(
                        self.competence_measurement_raw, self.qualitative,
                        self.competence_reuse_raw, output["competence_reuse_dynamics"],
                    )
                )
            except MeasurementProtocolInputError as exc:
                raise InputError(str(exc)) from exc
        if self.work_counterfactual_raw is not None:
            try:
                output["work_counterfactual_dynamics"] = review_work_counterfactuals(
                    self.work_counterfactual_raw, state=self.qualitative,
                    economic_claims=self.economic_claims,
                    economic_view=output.get("economics"),
                    reuse_view=output.get("competence_reuse_dynamics"),
                )
            except WorkCounterfactualInputError as exc:
                raise InputError(str(exc)) from exc
        if self.capability_enabled:
            # Economic readiness is a strict read of the SAME original ledger.
            # A new capability never manufactures new work-level money or value.
            comparisons = {
                item["work"]: item for item in
                output.get("work_counterfactual_dynamics", {}).get("works", [])
            }
            future_work_economics = []
            for declaration in output["capability_dynamics"]["declarations"]:
                for work_id in declaration["authorized_follow_on_work_ids"]:
                    comparison = comparisons.get(work_id)
                    future_work_economics.append({
                        "capability": declaration["id"], "work": work_id,
                        "work_economy": (
                            "MODEL_DECLARED_COMPARABLE_CASH_AND_RESOURCE_ONLY"
                            if comparison is not None and comparison["status"] ==
                               "DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"
                            else "WORK_SPECIFIC_ECONOMIC_SCOPE_NOT_QUALIFIED"
                        ),
                        "source_declared_net_value_or_learning_causality": False,
                    })
            output["capability_dynamics"]["future_original_work_economics"] = {
                "read_only_original_economic_claims": True,
                "source_qualification": future_work_economics,
                "private_owner_cash_amounts_redisclosed": False,
                "independent_owner_liquidity_not_imputed": True,
                "operator_and_network_new_profit": "NOT_IDENTIFIABLE",
                "new_cash_or_noncash_ledger_records_created": 0,
            }
        if self.general_akis_enabled:
            current = general_system_view(
                self.general_design, self.qualitative, at=float(self.time),
                economic_status=(
                    "DECLARED_CONSOLIDATED_ARITHMETIC_ONLY"
                    if output.get("economics", {}).get("consolidated_comparable_declared")
                    else "INCOMPLETE_SOURCE_SCOPE"
                    if "economics" in output else "NOT_IDENTIFIABLE"
                ),
            )
            output["general_akis_model"] = {
                **current,
                "read_only_evolution": list(self.general_views),
                "single_original_scheduler": True,
                "original_results_and_org_code_unmodified": True,
            }
            if "capability_dynamics" in output:
                cap = output["capability_dynamics"]
                output["general_akis_model"]["capability_reproduction_feedback"] = {
                    "original_owner_source_declarations": cap["declared_count"],
                    "model_owner_adopted_count": cap["original_owner_adopted_count"],
                    "original_owner_capability_evolution_count": len(cap["read_only_evolution"]),
                    "original_work_and_capacity_ledger_preserved": True,
                    "real_physical_capacity_and_causal_profit_verified": False,
                    "no_automatic_new_work_consent_or_payment": True,
                }
            if "competence_reuse_dynamics" in output:
                reuse = output["competence_reuse_dynamics"]
                output["general_akis_model"]["competence_reproduction_feedback"] = {
                    "model_claim_count": reuse["claimed_count"],
                    "model_comparable_sequences": reuse["comparable_sequence_count"],
                    "original_results_and_owner_rights_preserved": True,
                    "causal_economic_gain": reuse["causal_competence_effect"],
                    "individual_liquidity_and_operator_costs_are_not_imputed": True,
                    "original_cash_and_cost_records_added": 0,
                }
                if "declared_measurement_protocols" in reuse:
                    output["general_akis_model"]["competence_reproduction_feedback"][
                        "model_protocol_count"
                    ] = len(reuse["declared_measurement_protocols"]["protocols"])
                    output["general_akis_model"]["competence_reproduction_feedback"][
                        "field_verified_measurement"
                    ] = False
            if "work_counterfactual_dynamics" in output:
                counterfactual = output["work_counterfactual_dynamics"]
                output["general_akis_model"]["work_counterfactual_feedback"] = {
                    "source_scoped_work_count": len(counterfactual["works"]),
                    "declared_arithmetic_eligible_work_count": counterfactual[
                        "declared_comparable_work_count"],
                    "source_declared_nine_onboarding_comparable_work_count": counterfactual[
                        "model_declared_nine_onboarding_comparable_work_count"],
                    "original_work_timed_rework_cost_work_count": counterfactual[
                        "original_event_timed_rework_cost_work_count"],
                    "private_source_declared_stage_timestamps_redisclosed": False,
                    "nine_author_categories_derived_from_original_cost_rows": True,
                    "nine_category_evidence_not_realized_savings": True,
                    "owner_private_nine_costs_and_zero_sources_redisclosed": False,
                    "owner_operator_and_network_views_distinct": True,
                    "original_cash_and_cost_records_added": 0,
                    "realized_gain": "NOT_IDENTIFIABLE",
                    "owner_private_liquidity_amounts_redisclosed": False,
                }
            # Read the original recipient's Work/Result quality state only.
            # Shared view contains counts, never source documents or cash.
            quality_rows = [
                (key, item["assurance"])
                for key, item in output["works"].items()
                if "assurance" in item
            ]
            if quality_rows:
                output["general_akis_model"]["work_quality_feedback"] = {
                    "model_only_original_work_count": len(quality_rows),
                    "declared_criteria_count": sum(row["required_count"]
                                                    for _, row in quality_rows),
                    "model_recipient_attested_met_count": sum(
                        row["model_reported_met_count"] for _, row in quality_rows
                    ),
                    "model_accepted_results_with_qualified_criteria": sum(
                        output["works"][key]["result"] ==
                            "ACCEPTED_BY_ORIGINAL_RECIPIENT" and
                        row["current_result_quality_gate"] == "NONE"
                        for key, row in quality_rows
                    ),
                    "one_original_work_and_result_trace": True,
                    "independently_verified_field_quality": False,
                    "accepted_quality_proves_reusable_competence": False,
                    "causal_transaction_cost_reduction": "NOT_IDENTIFIABLE",
                    "new_program_agent_or_authentication_grant": False,
                }
            if self.future_needs:
                output["general_akis_model"]["pre_order_need_feedback"] = {
                    "source": "MODEL_ONLY_INDEPENDENT_CUSTOMER_NEED",
                    "count": output["future_need_dynamics"]["current"]["count"],
                    "active_research_needs": output["future_need_dynamics"]["current"]["reviewable_count"],
                    "contested_capacity_count": output["future_need_dynamics"]["current"]["capacity_contested_count"],
                    "original_work_created": False,
                    "organizational_code_legal_status": "UNMODIFIED",
                    "economic_gain": "NOT_IDENTIFIABLE",
                }
            if self.endogenous_subjects_enabled:
                output["general_akis_model"]["subject_choice_feedback"] = {
                    "basis": "MODEL_ONLY_DERIVED_FROM_ORIGINAL_NINE_COMPONENT_STATE",
                    "latest_independent_choice_by_work": output["endogenous_subjects"]["last_jointly_observed"],
                    "not_an_original_authorized_transition": True,
                }
        if self.general_akis_enabled:
            # R1: validate the author's ORIGINAL six cross-component causal
            # edges against the SAME source event stream and ledger. This is
            # diagnostic, not an active grant or economic causal claim.
            try:
                output["general_akis_model"]["author_causal_dependency_diagnostics"] = (
                    assess_author_causal_edges(
                        self.general_design, self.qualitative,
                        output["general_akis_model"],
                        economics=output.get("economics"),
                        work_counterfactual=output.get("work_counterfactual_dynamics"),
                        at=float(self.time),
                    )
                )
            except CausalContractInputError as exc:
                raise InputError(str(exc)) from exc
        if self.general_akis_enabled and "economics" in output:
            # One read-only connection from the existing economic ledger to
            # the NINE-component general AKIS view, after original Result and
            # economic claims have both been evaluated. No new decision,
            # private cash amount, money, grant or original event is emitted.
            cash = output["economics"].get("cash_timing", {})
            lifecycle = output["economics"].get("lifecycle_resource_costs", {})
            payment_causality = output["economics"].get("work_payment_causality", {})
            network_timing = cash.get("joint_network_settlement", {})
            network_scenarios = network_timing.get("scenarios", {})
            source_qualified_network_clock = bool(network_scenarios) and all(
                item.get("status") == "SOURCE_DECLARED_JOINT_SETTLEMENT_ARITHMETIC_ONLY"
                for item in network_scenarios.values()
            )
            if cash or lifecycle:
                counts = cash.get("cross_owner_nonfinancial_status_counts", {})
                lifecycle_timing = lifecycle.get("original_work_event_timing", {})
                output["general_akis_model"]["economic_time_and_cost_feedback"] = {
                    "research_status": "CURRENT_END_OF_RUN_DECLARED_ECONOMIC_PROJECTION",
                    "original_ledger": "ONE_ECONOMIC_CLAIMS_TRANSFER_AND_RESOURCE_USE_SET",
                    "cash_risk_owner_count": counts.get("known_gap_in_either_scenario", 0),
                    "cash_timing_incomplete_owner_count": counts.get(
                        "incomplete_time_or_initial_balance", 0
                    ),
                    "cash_same_tick_unresolved_owner_count": counts.get(
                        "same_tick_order_unresolved", 0
                    ),
                    "full_lifecycle_stages_in_model": len(lifecycle.get("stages", [])),
                    "original_work_source_declared_timed_cost_link_count": lifecycle_timing.get(
                        "original_lifecycle_timed_record_count", 0
                    ),
                    "original_work_quality_rework_signal_count": lifecycle_timing.get(
                        "original_applied_quality_rework_signal_count", 0
                    ),
                    "original_work_timed_rework_source_cost_link_count": lifecycle_timing.get(
                        "source_declared_quality_rework_cost_record_count", 0
                    ),
                    "original_work_future_pause_exit_cost_context_count": lifecycle_timing.get(
                        "model_future_pause_exit_switching_cost_context_count", 0
                    ),
                    "future_pause_cannot_certify_legal_withdrawal_or_old_work_discharge": True,
                    "source_declared_lifecycle_timestamps_are_not_real_incurrence": True,
                    "lifecycle_private_cost_sources_and_event_dates_redisclosed": False,
                    "original_cost_records_classified": lifecycle.get(
                        "classified_original_record_count", 0
                    ),
                    "cost_source_scope_comparable_owner_count": lifecycle.get(
                        "owners_with_source_declared_scope_comparison", 0
                    ),
                    "independent_owner_financial_decision": "NOT_AUTHENTICATED",
                    "empirically_realized_cooperative_saving": "NOT_ESTABLISHED",
                    "private_owner_cash_and_cost_values": "NOT_REDISCLOSED",
                    "network_original_interparty_cash_time_reconciled": source_qualified_network_clock,
                    "network_internal_transfers_create_no_money": bool(
                        network_timing.get("same_original_internal_transfer_only_one_joint_date")
                    ),
                    "joint_posting_is_not_contractual_payment_deferral": bool(
                        network_timing.get("joint_posting_does_not_reschedule_original_legal_due_dates")
                    ),
                    "no_private_network_member_cash_paths_redisclosed": True,
                    "owner_cooperation_vs_outside_cash_risk_separately_modelled": bool(
                        cash.get("per_original_owner_private_research_projection")
                    ),
                    "owner_private_scenario_comparison_amounts_and_identifiers_redisclosed": False,
                    "liquidity_stress_uses_original_outflow_due_dates": bool(
                        cash.get("adverse_receipts_late_obligations_due_in_owner_private_stress")
                    ),
                    "all_original_work_results_and_org_code_preserved": True,
                    "financial_risk_does_not_infer_owner_consent_or_new_contract": True,
                }
                if payment_causality:
                    shared = output["general_akis_model"]["economic_time_and_cost_feedback"]
                    shared.update({
                        "work_payment_condition_bound_count": payment_causality[
                            "bound_original_transfer_count"],
                        "work_payment_condition_consistent_count": payment_causality[
                            "source_declared_consistent_count"],
                        "work_payment_missing_terms_count": payment_causality[
                            "original_work_transfer_without_terms_count"],
                        "work_payment_unobserved_trigger_count": payment_causality[
                            "unobserved_trigger_count"],
                        "work_payment_time_conflict_count": payment_causality[
                            "contradictory_or_missing_timing_count"],
                        "work_payment_original_due_dates_redisclosed": False,
                        "work_payment_reported_as_bank_settlement": False,
                        "accepted_result_does_not_mean_paid": True,
                    })
                    progress = payment_causality.get("settlement_progress")
                    if progress:
                        shared.update({
                            "payment_model_partially_matched_transfer_count": progress[
                                "source_claimed_partial_transfer_count"],
                            "payment_model_fully_matched_transfer_count": progress[
                                "source_claimed_full_transfer_count"],
                            "payment_model_claim_event_count": progress[
                                "source_claim_event_count"],
                            "payment_causal_conflict_transfer_count": progress[
                                "causal_conflict_transfer_count"],
                            "payment_original_due_amendment_declared_count": progress[
                                "source_declared_amendment_count"],
                            "payment_retroactive_or_invalid_amendment_count": progress[
                                "retroactive_or_inconsistent_amendment_count"],
                            "payment_real_bank_execution_authenticated": False,
                            "payment_due_revisions_legally_authenticated": False,
                            "private_payment_dates_amounts_and_source_ids_redisclosed": False,
                        })
                if self.owner_financial_claims:
                    output["general_akis_model"]["economic_time_and_cost_feedback"][
                        "private_owner_research_reevaluation"
                    ] = "SOURCE_TIMED_GENERIC_REVIEW_ONLY_NO_FINANCIAL_DISCLOSURE"
        if self.adaptation_enabled or "portfolio" in output or "economics" in output or "context_basis" in output or (
                "capacity" in output and any(spec.calendar is not None for spec in self.qualitative.resource_specs.values())):
            try:
                output["adaptation"] = review_adaptation(
                    self.qualitative, self.adaptation_requests,
                    portfolio=output.get("portfolio"), economics=output.get("economics"),
                )
                output["adaptation"]["event_inquiries"] = list(self.review_inquiries)
            except AdaptationInputError as exc:
                raise InputError(str(exc)) from exc
        if self.qualitative.cooperation_links:
            if self.joint_purchasing_plans:
                output["cooperation"]["joint_purchasing_model"] = {
                    "evidence": "MODEL_ONLY_CURRENT_SOURCE",
                    "original_rights": "UNALTERED",
                    "cash_ledger": "UNCHANGED",
                    "prospective_only": True,
                    "proposals": [
                        {key: value for key, value in self._joint_purchasing_view(plan).items()
                         if key != "positions"}
                        for plan in self.joint_purchasing_plans
                    ],
                }
            if self.decision_observations:
                output["cooperation"]["model_decision_evolution"] = (
                    cooperative_readiness_evolution(self.decision_observations)
                )
            # A single read-only causal view over ORIGINAL work, context,
            # economy and adaptation. No extra scheduler or group Result.
            output["cooperation"]["system_projection"] = cooperation_system_view(
                self.qualitative.cooperation_links, self.qualitative.works,
                self.qualitative.resources, self.qualitative.subjects,
                self.qualitative.institution, self.qualitative.trace,
                economics=output.get("economics"),
                adaptation=output.get("adaptation"),
                context_basis=self.qualitative.context_basis,
            )
        if self.modern_economy_review_enabled:
            output["modern_economic_review"] = modern_economic_review(
                self.qualitative.subjects, economic_view=output.get("economics"),
                joint_purchasing=output.get("cooperation", {}).get("joint_purchasing_model"),
                formation=output.get("formation_opportunities"),
            )
            if self.general_akis_enabled:
                output["general_akis_model"]["modern_economic_status"] = {
                    "ten_2011_motives_automatically_realized": 0,
                    "nine_onboarding_cost_categories_preserved": 9,
                    "real_world_validation": "NOT_ESTABLISHED",
                    "additional_2026_cost_and_governance_exposures": 9,
                    "economic_change_is_originally_authorized": False,
                }
        if (self.general_akis_enabled and
                "joint_purchasing_original_cash_linkage" in output.get("economics", {})):
            original_purchasing = output["economics"]["joint_purchasing_original_cash_linkage"]
            output["general_akis_model"]["joint_purchasing_original_price_feedback"] = {
                "model_only_source_matched_original_plan_count": original_purchasing[
                    "original_matched_plan_count"
                ],
                "incomplete_original_plan_count": original_purchasing[
                    "original_incomplete_plan_count"
                ],
                "original_existing_transfer_reference_count": original_purchasing[
                    "source_declared_existing_original_transfer_count"
                ],
                "original_existing_resource_reference_count": original_purchasing[
                    "source_declared_existing_original_resource_use_count"
                ],
                "private_owner_quantities_prices_sources_and_supplier_quotes_redisclosed": False,
                "actual_purchasing_savings_or_cash_settlement_proven": False,
                "original_work_rights_results_and_money_unchanged": True,
            }
        if (self.general_akis_enabled and
                "joint_purchasing_ancillary_original_cash" in output.get("economics", {})):
            ancillary = output["economics"]["joint_purchasing_ancillary_original_cash"]
            output["general_akis_model"]["joint_purchasing_original_ancillary_feedback"] = {
                "source_declared_complete_ancillary_plan_count": ancillary[
                    "model_source_reconciled_complete_plan_count"
                ],
                "source_declared_incomplete_ancillary_plan_count": ancillary[
                    "model_source_incomplete_plan_count"
                ],
                "original_existing_cash_reference_count": ancillary[
                    "source_qualified_ancillary_original_transfer_reference_count"
                ],
                "original_existing_resource_reference_count": ancillary[
                    "source_qualified_ancillary_original_resource_reference_count"
                ],
                "private_costs_owner_prices_cash_and_sources_redisclosed": False,
                "internal_operator_reimbursements_cannot_create_network_value": True,
                "real_profit_or_liquidity_authenticated": False,
            }
        if self.general_akis_enabled:
            # Joint diagnosis of ALL NINE original author components from the
            # already-completed ONE Mesa trace, quality Result, owner-owned
            # future needs, and original accepted competence/capability routes.
            # It never writes a Work, original consent, event, cash or source.
            cycle = original_nine_component_cycle_evidence(
                self.general_design, self.qualitative, output,
                future_needs=self.future_needs,
            )
            output["general_akis_model"]["system_causal_cycle_feedback"] = cycle[
                "shared_summary"
            ]
            # Work/owner-source details remain on the PRIVATE research output
            # and must not be copied into the nine-component shared projection.
            output["general_akis_private_cycle_evidence"] = cycle[
                "private_research_witnesses"
            ]
        return output


def simulate(scenario: dict[str, Any]) -> dict[str, Any]:
    """Purely MODEL_ONLY research output. Never promote modeled profit or consent."""
    return OperatorAKISModel(scenario).execute()


def run_file(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as handle:
        return simulate(json.load(handle))
