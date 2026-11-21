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
from .economic_outlook import OutlookInputError, choose_outlook, parse_outlooks
from .joint_purchasing import PurchasingInputError, evaluate_plan, parse_plans
from .partner_discovery import DiscoveryInputError, parse_discovery, parse_formation_finance, discover
from .general_system import GeneralSystemInputError, parse_general_system, general_system_view
from .org_code_policy import OrgCodeInputError, parse_org_code_policy
from .economic_flow import EconomicInputError, evaluate_economic_claims
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
            )
        if work is not None and self.model.joint_purchasing_plans:
            joint = self.model._joint_purchasing_position(self.party_id, work_id)
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
        observation = assess_principal(
            state, self.model.decision_profiles, self.party_id, work_id,
            modeled_outside_position=prediction,
        )
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
        "request", "offer", "authorize", "resource_status", "change_mode", "exclude", "commit",
        "complete", "reject", "resubmit", "accept", "source_update", "resource_calendar_update",
        "start_operation", "complete_operation", "handoff_dispatch", "handoff_receive", "handoff_quality", "interest_update", "participation_status", "cooperation_change_propose", "cooperation_change_response",
        "economic_outlook_available", "economic_outlook_expired",
        "joint_purchasing_quote_change",
    })

    def __init__(self, scenario: dict[str, Any]) -> None:
        super().__init__(seed=0)
        if not isinstance(scenario, dict):
            raise InputError("INPUT_MUST_BE_OBJECT")
        research_input = dict(scenario)
        raw_profiles = research_input.pop("decision_profiles", [])
        raw_outlooks = research_input.pop("economic_outlooks", [])
        raw_joint_purchasing = research_input.pop("joint_purchasing_proposals", [])
        raw_partner_discovery = research_input.pop("partner_discovery", None)
        raw_general_akis = research_input.pop("general_akis", None)
        requested_horizon = research_input.pop("model_horizon", None)
        if (requested_horizon is not None and
                (type(requested_horizon) is not int or
                 not 0 <= requested_horizon <= 10000)):
            raise InputError("MODEL_HORIZON_MUST_BE_NONNEGATIVE_INTEGER")
        self.economic_claims = research_input.pop("economic_claims", None)
        self.adaptation_enabled = "adaptation_requests" in research_input
        raw_reviews = research_input.pop("adaptation_requests", [])
        self.qualitative = QualitativeAKIS(research_input)
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
            self.economic_outlooks = parse_outlooks(
                raw_outlooks, self.qualitative.subjects, self.qualitative.cooperation_links,
                known_works=set(known_works),
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
            self.general_design = parse_general_system(
                raw_general_akis, self.qualitative.subjects, known_works
            ) if self.general_akis_enabled else None
            if (self.general_akis_enabled and self.general_design.enforce_model_org_code
                    and self.general_design.configuration != "operator"):
                # All six author forms are research projections; only the
                # original SME/operator event model supports this policy path.
                raise OrgCodeInputError("OC_ENFORCEMENT_ONLY_ORIGINAL_OPERATOR_MODEL")
            self.model_org_policy = (
                parse_org_code_policy(
                    self.general_design.declarations["organizational_code"],
                    self.qualitative.subjects, self.qualitative.institution,
                    actions=set(ACTIONS),
                ) if self.general_akis_enabled and
                     self.general_design.enforce_model_org_code else None
            )
            # The existing original event handler consults only this optional
            # restricting predicate; no second governance state or event log.
            self.qualitative.model_org_policy = self.model_org_policy
        except (OutlookInputError, PurchasingInputError, DiscoveryInputError,
                GeneralSystemInputError, OrgCodeInputError) as exc:
            raise InputError(str(exc)) from exc
        self.parties = [EconomicSubject(self, key, party.kind) for key, party in self.qualitative.subjects.items()]
        self._by_id = {subject.party_id: subject for subject in self.parties}
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
            self.adaptation_enabled or self.economic_claims is not None or bool(self.economic_outlooks) or bool(self.joint_purchasing_plans)
            or self.qualitative.context_basis is not None
            or self.qualitative.portfolio_review_enabled
            or self.qualitative.handoff_strict
            or self._interest_events_present
            or self._future_participation_events_present
            or self._cooperation_change_events_present
            or self.partner_discovery_enabled
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

    def _capture_general_system(self) -> None:
        view = general_system_view(
            self.general_design, self.qualitative, at=float(self.time))
        # Record only causal changes, not a new event/Result journal.
        signature = json.dumps(
            {"components": view["components"],
             "phases": view["formation_phases"],
             "org": view["organizational_code"],
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

    def _reassess_economic_outlook(self, work_id: str, trigger: str) -> None:
        self._outlook_epoch += 1
        self._schedule_responses({"action": trigger, "work": work_id})

    def _apply_event(self, event: dict[str, Any]) -> None:
        outcome = self.qualitative.apply(event, int(self.time))
        if (self.decision_profiles or self.economic_outlooks or self.joint_purchasing_plans or
                event["action"] in {"interest_update", "participation_status",
                                    "cooperation_change_propose", "cooperation_change_response"}
                ) and outcome["outcome"] == "APPLIED":
            self._schedule_responses(event)
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
        elif action in {"resource_status", "resource_calendar_update"}:
            impacted = [work.key for work in state.works.values() if any(
                need.resource == event["resource"] for need in work.resource_requirements)]
        elif action == "source_update":
            impacted = state.context_basis.affected_works(event["source"]) if state.context_basis else []
        elif action == "change_mode":
            impacted = [work.key for work in state.works.values() if work.obligation == "NOT_ACCEPTED"]
        elif action in {"participation_status", "cooperation_change_propose", "cooperation_change_response"}:
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
        if original_work is not None and self.qualitative.cooperation_links:
            # Read the state NOW, not the final end-of-run state. This adds a
            # view to an existing observation, not another scheduler or event log.
            observation["cooperation_model_review"] = cooperative_model_readiness(
                self.qualitative.cooperation_links, self.qualitative.works,
                self.qualitative.resources, self.qualitative.institution,
                self.decision_observations, work_id=work_id,
            )

    def execute(self) -> dict[str, Any]:
        if self.qualitative.events or self.economic_outlooks or self.joint_purchasing_plans or self.partner_discovery_enabled or self.general_akis_enabled:
            # Inclusive integer horizon; flush same-time reactions without
            # executing the next period at model_horizon + 1.
            self.run_until(float(self._model_end_at) + 0.5)
        output = self.qualitative.snapshot()
        if self.decision_profiles or self.economic_outlooks or self.joint_purchasing_plans or self.partner_discovery_enabled or self._interest_events_present or self._future_participation_events_present or self._cooperation_change_events_present:
            output["decision_observations"] = list(self.decision_observations)
            output["decision_observations_truncated"] = self.assessment_truncated
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
            # Work IDs may be created during the run, so check references against
            # the *final* portfolio without interpreting cash movements as Result.
            try:
                output["economics"] = evaluate_economic_claims(
                    self.economic_claims, self.qualitative.subjects, self.qualitative.works,
                    self.qualitative.cooperation_links, self.qualitative.trace,
                )
            except EconomicInputError as exc:
                raise InputError(str(exc)) from exc
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
        return output


def simulate(scenario: dict[str, Any]) -> dict[str, Any]:
    """Purely MODEL_ONLY research output. Never promote modeled profit or consent."""
    return OperatorAKISModel(scenario).execute()


def run_file(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as handle:
        return simulate(json.load(handle))
