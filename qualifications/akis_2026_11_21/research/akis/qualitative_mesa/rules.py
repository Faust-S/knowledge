"""Qualitative IWXA AKIS decision rules. No costs, pseudo-profits, or legal effects.

These rules process MODEL_ONLY claims supplied by the research input. They neither
produce original Result objects nor infer contracts, signatures, or legal consent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .context_basis import ContextBasis, ContextBlocked, ContextInputError
from .org_code_policy import OrgCodeBlocked, NEW_WORK_ACTIONS
from .capacity import (
    CapacityBlocked, CapacityInputError, CapacityLedger, ResourceNeed,
    parse_resource_calendar, parse_resource_capacity, parse_resource_needs,
)
from .technology import (
    Operation, TechnologyInputError, parse_operations, owners_summary,
    operation_reservations, technology_view,
)
from .handoff import Handoff, HandoffInputError, declare_handoffs, handoffs_view
from .material import (MaterialBatch, MaterialState, MaterialInputError, MaterialBlocked,
    parse_batches, quantities, amount, event_report, assert_reported_order,
    assert_inbound_ready, material_view)
from .portfolio import (
    PortfolioInputError, parse_dependencies, validate_dependency_graph,
    readiness, portfolio_view,
)
from .capability_dynamics import CapabilityBlocked
from .work_assurance import (
    QualityCriterion, AssuranceInputError, AssuranceBlocked,
    parse_criteria, assess_result_quality, acceptance_gate, assurance_view,
)
from .cooperation import (
    CooperationInputError, parse_cooperation_links, cooperation_view, attach_requested_work,
    latest_future_participation, propose_cooperation_change,
    respond_to_cooperation_change, original_cooperation_consultees,
    qualify_cooperation_change_reference, apply_cooperation_membership_revision,
    assess_cooperation_entry,
)

SCHEMA = "IWXA_AKIS_QUALITATIVE_INPUT/0.1"
SELECTED_MODES = frozenset({"SOLE", "COLLEGIAL", "MIXED"})
# UNSELECTED explicitly describes missing qualification, not tacit SOLE.
MODES = SELECTED_MODES | {"UNSELECTED"}
AVAILABILITY = frozenset({"AVAILABLE", "UNAVAILABLE", "UNKNOWN"})
ACTIONS = frozenset({"request", "offer", "authorize", "consent", "commit", "start", "complete", "accept", "reject", "resubmit", "exclude", "change_mode", "resource_status", "resource_calendar_update", "source_update", "start_operation", "complete_operation", "handoff_dispatch", "handoff_receive", "handoff_quality", "assess_result_quality", "interest_update", "participation_status", "cooperation_change_propose", "cooperation_change_response", "cooperation_entry_assess", "cooperation_membership_apply", "adopt_capability", "formation_confirm", "function_prepare", "function_review", "need_emerge"})
GOVERNED = frozenset({"authorize", "exclude"})


class InputError(ValueError):
    """An invalid research fixture (not a negative outcome of a valid decision)."""


class BlockedDecision(Exception):
    """A legitimate modeled action is blocked by a documented prerequisite."""

    def __init__(self, reason: str, resource: str | None = None):
        self.reason = reason
        self.resource = resource
        super().__init__(reason)


def _id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise InputError(f"INVALID_{label.upper()}")
    return value


def _keys_exact(value: dict, required: set[str], optional: set[str], label: str) -> None:
    if not isinstance(value, dict):
        raise InputError(f"{label}_MUST_BE_OBJECT")
    if missing := required - value.keys():
        raise InputError(f"{label}_MISSING_{sorted(missing)[0]}")
    if unexpected := value.keys() - required - optional:
        raise InputError(f"{label}_UNKNOWN_{sorted(unexpected)[0]}")


@dataclass
class Work:
    key: str
    customer: str
    resource: str
    source_revision: str
    slot_start: int
    slot_end: int
    proposal: str = "DRAFT"
    admitted: bool = False
    obligation: str = "NOT_ACCEPTED"
    execution: str = "NOT_STARTED"
    result: str = "NOT_SUBMITTED"
    commitment_org_revision: str | None = None
    result_ref: str | None = None
    consents: dict[str, tuple[str, str]] = field(default_factory=dict)
    authorization_org_revision: str | None = None
    requester: str | None = None
    request_at: int | None = None
    requires_accepted: tuple[str, ...] = ()
    result_history: list[dict[str, Any]] = field(default_factory=list)
    resource_requirements: tuple[ResourceNeed, ...] = ()
    operations: tuple[Operation, ...] = ()
    operation_states: dict[str, str] = field(default_factory=dict)
    operation_evidence: dict[str, str] = field(default_factory=dict)
    handoffs: tuple[Handoff, ...] = ()
    handoff_states: dict[tuple[str, str], str] = field(default_factory=dict)
    handoff_evidence: dict[tuple[str, str], dict[str, str]] = field(default_factory=dict)
    material_batches: tuple[MaterialBatch, ...] = ()
    material_states: dict[str, MaterialState] = field(default_factory=dict)
    assurance_criteria: tuple[QualityCriterion, ...] = ()
    assurance_reviews: dict[str, dict[str, str]] = field(default_factory=dict)
    assurance_refs: set[str] = field(default_factory=set)


@dataclass
class Party:
    key: str
    kind: str
    active: bool = True


@dataclass
class Institution:
    operator: str
    founders: tuple[str, ...]
    mode: str
    revision: str
    council_members: tuple[str, ...]
    council_quorum: int
    council_rule: str
    operator_mandate: frozenset[str]
    mixed_reserved: frozenset[str]


class QualitativeAKIS:
    """Research-only state and event handler, independent of simulation clock."""

    def __init__(self, scenario: dict[str, Any]):
        _keys_exact(
            scenario,
            {"schema", "evidence", "institution", "subjects", "resources", "works", "events"},
            {"portfolio_review", "context_evidence", "capacity_strict", "calendar_strict", "handoff_strict", "material_strict", "cooperation_links"}, "INPUT",
        )
        self.portfolio_review_enabled = scenario.get("portfolio_review", False)
        if type(self.portfolio_review_enabled) is not bool:
            raise InputError("PORTFOLIO_REVIEW_MUST_BE_BOOLEAN")
        self.capacity_strict = scenario.get("capacity_strict", False)
        if type(self.capacity_strict) is not bool:
            raise InputError("CAPACITY_STRICT_MUST_BE_BOOLEAN")
        self.calendar_strict = scenario.get("calendar_strict", False)
        if type(self.calendar_strict) is not bool:
            raise InputError("CALENDAR_STRICT_MUST_BE_BOOLEAN")
        self.handoff_strict = scenario.get("handoff_strict", False)
        if type(self.handoff_strict) is not bool:
            raise InputError("HANDOFF_STRICT_MUST_BE_BOOLEAN")
        self.material_strict = scenario.get("material_strict", False)
        if type(self.material_strict) is not bool:
            raise InputError("MATERIAL_STRICT_MUST_BE_BOOLEAN")
        if self.material_strict and not self.handoff_strict:
            raise InputError("MATERIAL_REQUIRES_HANDOFF_STRICT")
        if scenario["schema"] != SCHEMA or scenario["evidence"] != "MODEL_ONLY":
            raise InputError("ONLY_MODEL_ONLY_SCHEMA_SUPPORTED")
        ins = scenario["institution"]
        _keys_exact(ins, {"operator", "founders", "mode", "revision", "council_members", "council_quorum", "council_rule", "operator_mandate", "mixed_reserved"}, set(), "INSTITUTION")
        if not isinstance(ins["mode"], str) or ins["mode"] not in MODES or not isinstance(ins["council_rule"], str) or ins["council_rule"] not in {"UNANIMOUS", "MAJORITY"}:
            raise InputError("INVALID_GOVERNANCE")
        if not isinstance(ins["founders"], list) or not ins["founders"] or not isinstance(ins["council_members"], list):
            raise InputError("INVALID_GOVERNANCE_PARTIES")
        if not isinstance(ins["operator_mandate"], list) or not set(ins["operator_mandate"]).issubset(GOVERNED):
            raise InputError("INVALID_OPERATOR_MANDATE")
        if not isinstance(ins["mixed_reserved"], list) or not set(ins["mixed_reserved"]).issubset(GOVERNED):
            raise InputError("INVALID_RESERVED_ACTIONS")
        if type(ins["council_quorum"]) is not int or not 0 <= ins["council_quorum"] <= len(ins["council_members"]):
            raise InputError("INVALID_QUORUM")
        if ins["mode"] == "MIXED" and not ins["mixed_reserved"]:
            raise InputError("MIXED_REQUIRES_EXPLICIT_RESERVED_SCOPE")
        if ins["mode"] in {"COLLEGIAL", "MIXED"} and ins["council_quorum"] == 0:
            raise InputError("ZERO_COUNCIL_QUORUM")
        if not isinstance(scenario["subjects"], list) or not scenario["subjects"] or len(scenario["subjects"]) > 128:
            raise InputError("INVALID_SUBJECTS")
        self.subjects: dict[str, Party] = {}
        for obj in scenario["subjects"]:
            _keys_exact(obj, {"id", "kind"}, set(), "SUBJECT")
            key = _id(obj["id"], "subject")
            if obj["kind"] not in {"SME", "OPERATOR"} or key in self.subjects:
                raise InputError("INVALID_OR_DUPLICATE_SUBJECT")
            self.subjects[key] = Party(key, obj["kind"])
        op = _id(ins["operator"], "operator")
        if op not in self.subjects or self.subjects[op].kind != "OPERATOR":
            raise InputError("MISSING_OR_INVALID_OPERATOR")
        founders = tuple(ins["founders"])
        council = tuple(ins["council_members"])
        if len(founders) != len(set(founders)) or len(council) != len(set(council)) or not set(founders + council).issubset(self.subjects):
            raise InputError("INVALID_GOVERNANCE_OWNERS")
        self.institution = Institution(
            operator=op, founders=founders, mode=ins["mode"], revision=_id(ins["revision"], "revision"),
            council_members=council, council_quorum=ins["council_quorum"], council_rule=ins["council_rule"],
            operator_mandate=frozenset(ins["operator_mandate"]), mixed_reserved=frozenset(ins["mixed_reserved"]),
        )
        if not isinstance(scenario["resources"], list) or len(scenario["resources"]) > 256:
            raise InputError("INVALID_RESOURCES")
        self.resources: dict[str, str] = {}
        self.resource_availability: dict[str, str] = {}
        self.resource_availability_origin: dict[str, str] = {}
        self.resource_specs = {}
        for obj in scenario["resources"]:
            _keys_exact(obj, {"id", "owner"}, {"availability", "capacity_units", "capacity_unit", "site", "calendar"}, "RESOURCE")
            key, owner = _id(obj["id"], "resource"), _id(obj["owner"], "owner")
            if key in self.resources or owner not in self.subjects:
                raise InputError("INVALID_OR_DUPLICATE_RESOURCE")
            status = obj.get("availability", "AVAILABLE")
            if not isinstance(status, str) or status not in AVAILABILITY:
                raise InputError("INVALID_RESOURCE_AVAILABILITY")
            try:
                self.resource_specs[key] = parse_resource_capacity(obj)
            except CapacityInputError as exc:
                raise InputError(str(exc)) from exc
            self.resources[key] = owner
            self.resource_availability[key] = status
            # Compatibility defaults are research assumptions, never measured capacity.
            self.resource_availability_origin[key] = "MODEL_INPUT" if "availability" in obj else "LEGACY_FIXTURE_DEFAULT"
        self.capacity_ledger = CapacityLedger(self.resource_specs)
        self._calendar_revisions_seen: dict[str, set[str]] = {
            key: ({spec.calendar.revision} if spec.calendar is not None else set())
            for key, spec in self.resource_specs.items()
        }
        if not isinstance(scenario["works"], list) or len(scenario["works"]) > 256:
            raise InputError("INVALID_WORKS")
        self.works: dict[str, Work] = {}
        for obj in scenario["works"]:
            work = self._parse_work(obj)
            if work.key in self.works:
                raise InputError("INVALID_OR_DUPLICATE_WORK")
            self.works[work.key] = work
        try:
            validate_dependency_graph(self.works)
        except PortfolioInputError as exc:
            raise InputError(str(exc)) from exc
        # A cooperation relation is only a source-declared view of original
        # principals and their existing works, never a super-contract.
        try:
            self.cooperation_links = parse_cooperation_links(
                scenario.get("cooperation_links"), self.subjects, self.works,
                self.resources, self.institution.operator
            )
        except CooperationInputError as exc:
            raise InputError(str(exc)) from exc
        events = scenario["events"]
        if not isinstance(events, list) or len(events) > 500:
            raise InputError("INVALID_EVENT_COUNT")
        last = -1
        for ev in events:
            _keys_exact(ev, {"at", "action", "actor"}, {"work", "accepted_by", "votes", "subject", "authorized_by", "new_mode", "new_revision", "expected_revision", "new_reserved", "result_ref", "source_revision", "org_revision", "work_spec", "resource", "availability", "source", "status", "usable_by", "calendar", "expected_calendar_revision", "operation", "from_operation", "to_operation", "dispatch_ref", "material_quantities", "quality_quantities", "receipt_ref", "reported_actual_at", "reported_external_ref", "cooperation_link", "cooperation_source_revision", "economic_channel", "new_willingness", "new_outside_option", "interest_evidence_ref", "new_participation", "participation_evidence_ref", "change_id", "change_kind", "change_source_ref", "change_decision", "proposed_subject",
             "criterion", "quality_verdict", "quality_evidence_ref", "capability", "expected_capacity_revision", "phase", "formation_source_ref", "formation_core", "formation_basis_source", "function_id", "function_source_ref", "function_phase_source_ref", "prepared_at", "human_decision", "review_source_ref", "pilot_work", "evaluated_work", "evaluated_work_revision", "evaluated_result_ref", "evaluated_decision_at", "evaluation_verdict", "formation_phase_source_ref", "work_source_revision", "goal_source_ref", "goal_expires_at", "goal_objective", "goal_priority", "pilot_result_ref", "pilot_decision_at", "emergent_goal_source_ref", "interest_valid_until",
             "new_link_id", "new_link_revision", "new_link_source_ref", "entry_goal_source_ref", "entry_alternative_source_ref", "entry_assessment_source_ref", "entry_willingness", "entry_outside_option", "entry_valid_until", "entry_change_id", "entry_assessment_source_ref"}, "EVENT")
            if type(ev["at"]) is not int or ev["at"] <= last or not isinstance(ev["action"], str) or ev["action"] not in ACTIONS:
                raise InputError("EVENTS_MUST_HAVE_STRICTLY_INCREASING_INTEGER_TIMES_AND_KNOWN_ACTIONS")
            last = ev["at"]
            _id(ev["actor"], "actor")
            if ev["action"] == "request":
                self._parse_work(ev.get("work_spec"))
        self.context_basis: ContextBasis | None = None
        self.model_org_policy = None  # Optional MODEL_ONLY constraint on original new-Work actions.
        self.formation_policy = None  # Optional source/owner phase gates, original trace only.
        self.capability_policy = None  # Optional owner gate, never an autonomous upgrade.
        if "context_evidence" in scenario:
            raw_context = scenario["context_evidence"]
            known_works = set(self.works)
            known_works.update(ev["work_spec"]["id"] for ev in events if ev["action"] == "request")
            try:
                self.context_basis = ContextBasis(raw_context, self.subjects, known_works)
            except ContextInputError as exc:
                raise InputError(str(exc)) from exc
        self.events = [dict(ev) for ev in events]
        self.allocations: list[tuple[str, str, int, int]] = []  # resource, work, start, end
        self.trace: list[dict[str, Any]] = []

    def _parse_work(self, obj: Any) -> Work:
        _keys_exact(obj, {"id", "customer", "resource", "source_revision", "slot_start", "slot_end"},
                    {"requires_accepted", "resource_requirements", "operations", "material_batches",
                     "assurance_criteria"}, "WORK")
        key, customer, resource = (_id(obj[k], k) for k in ("id", "customer", "resource"))
        if customer not in self.subjects or resource not in self.resources:
            raise InputError("INVALID_OR_DUPLICATE_WORK")
        a, b = obj["slot_start"], obj["slot_end"]
        if type(a) is not int or type(b) is not int or a < 0 or a >= b:
            raise InputError("INVALID_TIME_WINDOW")
        try:
            dependencies = parse_dependencies(obj.get("requires_accepted", []), key)
            if "operations" in obj:
                ops = parse_operations(obj["operations"], work_primary=resource,
                                       work_start=a, work_end=b, resources=self.resources)
                resource_needs = owners_summary(ops)
                if "resource_requirements" in obj:
                    declared = parse_resource_needs(obj, resource, self.resources)
                    if declared != resource_needs:
                        raise TechnologyInputError("TECHNOLOGY_RESOURCE_SUMMARY_MISMATCH")
            else:
                ops = ()
                resource_needs = parse_resource_needs(obj, resource, self.resources)
        except (PortfolioInputError, CapacityInputError, TechnologyInputError) as exc:
            raise InputError(str(exc)) from exc
        try:
            handoffs = declare_handoffs(ops, self.resources, self.resource_specs,
                                        strict=self.handoff_strict)
        except HandoffInputError as exc:
            raise InputError(str(exc)) from exc
        material_batches: tuple[MaterialBatch, ...] = ()
        if self.material_strict or "material_batches" in obj:
            try:
                principals = self.capacity_ledger.original_owners(resource_needs) | {customer}
                material_batches = parse_batches(obj.get("material_batches"), handoffs,
                                                 self.subjects, principals,
                                                 strict=self.material_strict)
            except MaterialInputError as exc:
                raise InputError(str(exc)) from exc
        try:
            assurance = parse_criteria(
                obj.get("assurance_criteria"), customer=customer,
                primary_resource=resource,
                work_revision=obj["source_revision"],
                operations=ops, resource_owners=self.resources,
            )
        except AssuranceInputError as exc:
            raise InputError(str(exc)) from exc
        return Work(key, customer, resource, _id(obj["source_revision"], "source_revision"), a, b,
                    requires_accepted=dependencies, resource_requirements=resource_needs,
                    operations=ops, operation_states={op.key: "NOT_STARTED" for op in ops},
                    handoffs=handoffs, handoff_states={h.edge: "NOT_DISPATCHED" for h in handoffs},
                    material_batches=material_batches,
                    material_states={batch.key: MaterialState() for batch in material_batches},
                    assurance_criteria=assurance)

    def _authority(self, ev: dict, action: str) -> None:
        ins = self.institution
        actor = ev["actor"]
        if ins.mode == "UNSELECTED":
            raise BlockedDecision("MODE_NOT_SELECTED")
        if ins.mode == "SOLE" or (ins.mode == "MIXED" and action not in ins.mixed_reserved):
            if action not in ins.operator_mandate:
                raise BlockedDecision("EXPLICIT_OPERATOR_MANDATE_MISSING")
            if actor != ins.operator:
                raise BlockedDecision("OPERATOR_MANDATE_REQUIRED")
            return
        if actor != "COUNCIL":
            raise BlockedDecision("COUNCIL_DECISION_REQUIRED")
        votes = ev.get("votes", {})
        if not isinstance(votes, dict) or any(k not in ins.council_members or v not in {"YES", "NO", "ABSTAIN"} for k, v in votes.items()):
            raise BlockedDecision("INVALID_COUNCIL_VOTES")
        present = len(votes)
        yes = list(votes.values()).count("YES")
        if present < ins.council_quorum:
            raise BlockedDecision("QUORUM_NOT_MET")
        if ins.council_rule == "UNANIMOUS" and yes != present:
            raise BlockedDecision("COUNCIL_NOT_UNANIMOUS")
        if ins.council_rule == "MAJORITY" and yes * 2 <= present:
            raise BlockedDecision("COUNCIL_MAJORITY_NOT_MET")

    def apply(self, ev: dict[str, Any], at: int) -> dict[str, Any]:
        action = ev["action"]
        previous_revision = self.institution.revision
        work_ref = ev.get("work")
        if action == "request" and isinstance(ev.get("work_spec"), dict):
            work_ref = ev["work_spec"].get("id")
        blocked_resource = None
        calendar_risks = None
        model_org_review = None
        linked_change_evidence = None
        membership_evidence = None
        if self.capability_policy is not None:
            # Time- and owner-source eligibility is refreshed before future
            # commitments; historical reservations and Results are untouched.
            self.capability_policy.refresh(self, at)
        org_code_model_escalation_target = (
            self.model_org_policy.reviewer_by_action.get(action)
            if self.model_org_policy is not None else None
        )
        try:
            if self.model_org_policy is not None:
                model_org_review = self.model_org_policy.inspect(self, ev, at)
            if action == "change_mode":
                self._change_mode(ev)
            elif action == "request":
                linked_change_evidence = self._request_work(ev, at)
            elif action == "resource_status":
                self._set_resource_availability(ev)
            elif action == "resource_calendar_update":
                calendar_risks = self._set_resource_calendar(ev)
            elif action == "source_update":
                if self.context_basis is None:
                    raise BlockedDecision("CONTEXT_BASIS_NOT_CONFIGURED")
                self.context_basis.owner_update(ev)
                if self.capability_policy is not None:
                    self.capability_policy.refresh(self, at)
            elif action == "formation_confirm":
                if self.formation_policy is None:
                    raise BlockedDecision("FORMATION_MODEL_POLICY_NOT_CONFIGURED")
                issue = self.formation_policy.confirm(self, ev, at)
                if issue != "NONE":
                    raise BlockedDecision(issue)
            elif action == "need_emerge":
                if self.formation_policy is None:
                    raise BlockedDecision("FORMATION_EMERGENT_NEED_POLICY_NOT_CONFIGURED")
                issue = self.formation_policy.owner_emerge_need(self, ev, at)
                if issue != "NONE":
                    raise BlockedDecision(issue)
            elif action in {"function_prepare", "function_review"}:
                if self.formation_policy is None:
                    raise BlockedDecision("FORMATION_AGENT_GATE_NOT_CONFIGURED")
                issue = self.formation_policy.process_function_action(self, ev, at)
                if issue != "NONE":
                    raise BlockedDecision(issue)
            elif action == "adopt_capability":
                if self.capability_policy is None:
                    raise BlockedDecision("CAPABILITY_POLICY_NOT_CONFIGURED")
                self.capability_policy.apply(self, ev, at)
            elif action == "participation_status":
                self._set_participation_status(ev)
            elif action in {"cooperation_change_propose", "cooperation_change_response"}:
                # SOURCE-DECLARED consultation, not a legal amendment. In strict
                # KPB mode a relation-wide permission has not yet been qualified.
                if self.context_basis is not None and self.context_basis.strict:
                    raise BlockedDecision("COOPERATION_CHANGE_SOURCE_RIGHTS_NOT_QUALIFIED")
                if ev.get("org_revision") != self.institution.revision:
                    raise BlockedDecision("STALE_ORGANIZATIONAL_CODE")
                try:
                    if action == "cooperation_change_propose":
                        propose_cooperation_change(ev, self.cooperation_links,
                                                   self.subjects, self.trace)
                        if self.formation_policy is not None:
                            issue = self.formation_policy.review_reconfiguration_proposal(
                                self, ev, at
                            )
                            if issue != "NONE":
                                raise BlockedDecision(issue)
                    else:
                        respond_to_cooperation_change(ev, self.cooperation_links,
                                                      self.subjects, self.trace)
                except CooperationInputError as exc:
                    raise BlockedDecision(str(exc)) from exc
            elif action == "cooperation_entry_assess":
                # A NEW participant has no first-hand evaluation of a prior
                # Result. The event is its own prospective, sourced judgment.
                if ev.get("org_revision") != self.institution.revision:
                    raise BlockedDecision("STALE_ORGANIZATIONAL_CODE")
                try:
                    assess_cooperation_entry(
                        ev, self.cooperation_links, self.subjects, self.trace
                    )
                except CooperationInputError as exc:
                    raise BlockedDecision(str(exc)) from exc
            elif action == "cooperation_membership_apply":
                # Source-ground original model relation revision only. It
                # creates no legal membership, access right, Resource or Work.
                if self.context_basis is not None and self.context_basis.strict:
                    raise BlockedDecision("COOPERATION_MEMBERSHIP_SOURCE_RIGHTS_NOT_QUALIFIED")
                if ev.get("org_revision") != self.institution.revision:
                    raise BlockedDecision("STALE_ORGANIZATIONAL_CODE")
                try:
                    revised, membership_evidence = apply_cooperation_membership_revision(
                        ev, self.cooperation_links, self.subjects, self.works,
                        self.trace, org_revision=self.institution.revision, at=at,
                        require_entry_assessment=bool(
                            self.formation_policy is not None
                            and self.formation_policy.design.enforce_model_result_conditioned_interests
                        ),
                    )
                except CooperationInputError as exc:
                    raise BlockedDecision(str(exc)) from exc
                self.cooperation_links = revised
            elif action == "exclude":
                target = _id(ev.get("subject"), "excluded_subject")
                if target not in self.subjects or target == self.institution.operator:
                    raise BlockedDecision("EXCLUSION_SUBJECT_INVALID")
                self._authority(ev, action)
                self.subjects[target].active = False  # future work only
            else:
                key = _id(ev.get("work"), "work")
                if key not in self.works:
                    raise BlockedDecision("UNKNOWN_WORK")
                work = self.works[key]
                self._work_action(work, ev, at)
            report = {"at": at, "action": action, "outcome": "APPLIED", "reason": "NONE", "org_revision": self.institution.revision}
        except (BlockedDecision, ContextBlocked, MaterialBlocked, AssuranceBlocked, OrgCodeBlocked, CapabilityBlocked) as exc:
            blocked_resource = getattr(exc, "resource", None)
            if isinstance(exc, OrgCodeBlocked):
                org_code_model_escalation_target = exc.reviewer
            report = {"at": at, "action": action, "outcome": "BLOCKED", "reason": exc.reason, "org_revision": self.institution.revision}
        # Input claims, not authenticated decisions or independent observations.
        report.update({
            "actor": ev["actor"], "work": work_ref, "resource": ev.get("resource"),
            "subject": ev.get("subject"), "prior_org_revision": previous_revision,
        })
        if self.model_org_policy is not None and action in NEW_WORK_ACTIONS:
            report["model_org_code_review"] = (
                model_org_review["status"] if model_org_review is not None
                else "BLOCKED_BY_ORIGINAL_OR_MODEL_SOURCE_RULE"
            )
            report["org_code_model_escalation_target"] = org_code_model_escalation_target
            report["org_code_model_accountable_original_subjects"] = (
                model_org_review.get("accountable_original_subjects", [])
                if model_org_review is not None else []
            )
            report["org_code_model_source_revision"] = self.model_org_policy.revision
            report["org_code_escalation_is_inquiry_only"] = True
            report["org_code_real_identity_authenticated"] = False
        if action in {"start_operation", "complete_operation"}:
            report["operation"] = ev.get("operation")
        if action == "assess_result_quality" and report["outcome"] == "APPLIED":
            report["criterion"] = ev.get("criterion")
            report["quality_verdict"] = ev.get("quality_verdict")
            report["assessed_result_ref"] = ev.get("result_ref")
            report["quality_evidence_ref"] = ev.get("quality_evidence_ref")
            report["source_authentication"] = "MODEL_ONLY_UNVERIFIED"
            report["quality_assessment_is_not_result_acceptance"] = True
        if action in {"handoff_dispatch", "handoff_receive", "handoff_quality"}:
            report["from_operation"] = ev.get("from_operation")
            report["to_operation"] = ev.get("to_operation")
            report["handoff_ref"] = ev.get("result_ref")
            if "material_quantities" in ev:
                report["material_quantities"] = ev["material_quantities"]
            if "quality_quantities" in ev:
                report["quality_quantities"] = ev["quality_quantities"]
            if "reported_actual_at" in ev:
                report["reported_actual_at"] = ev["reported_actual_at"]
                report["reported_actual_source"] = "EXTERNAL_CLAIM_UNVERIFIED"
        if action in {"cooperation_change_propose", "cooperation_change_response"} and report["outcome"] == "APPLIED":
            # The existing trace alone owns the proposal and the consultations.
            report["cooperation_link"] = ev.get("cooperation_link")
            report["cooperation_source_revision"] = ev.get("cooperation_source_revision")
            report["change_id"] = ev.get("change_id")
            report["change_source_ref"] = ev.get("change_source_ref")
            if action == "cooperation_change_propose":
                report["change_kind"] = ev.get("change_kind")
                report["proposed_subject"] = ev.get("proposed_subject")
                report["economic_channel"] = ev.get("economic_channel")
                if (self.formation_policy is not None and
                        self.formation_policy.design.enforce_model_result_conditioned_reconfiguration):
                    report["pilot_work"] = ev.get("pilot_work")
                    report["pilot_result_ref"] = ev.get("pilot_result_ref")
                    report["pilot_decision_at"] = ev.get("pilot_decision_at")
                    report["model_proposal_not_automatic_change"] = True
                # Capture who had to be consulted AT PROPOSAL TIME in the
                # SAME original trace. Future coalition changes cannot
                # rewrite the historical electorate or remove objections.
                report["original_consultees"] = list(
                    original_cooperation_consultees(ev, self.cooperation_links)
                )
                report["original_relation_participants"] = sorted(
                    next(link.participants for link in self.cooperation_links
                         if link.key == ev["cooperation_link"])
                )
            else:
                report["change_decision"] = ev.get("change_decision")
            report["source_authentication"] = "MODEL_ONLY_DECLARED_UNVERIFIED"
        if action == "cooperation_entry_assess" and report["outcome"] == "APPLIED":
            for name in ("cooperation_link", "cooperation_source_revision",
                         "change_id", "entry_goal_source_ref",
                         "entry_alternative_source_ref", "entry_assessment_source_ref",
                         "entry_willingness", "entry_outside_option", "entry_valid_until"):
                report[name] = ev.get(name)
            report["prospective_own_assessment_not_prior_result_experience"] = True
            report["outside_option_not_verified_economic_benefit"] = True
            report["source_authentication"] = "MODEL_ONLY_DECLARED_UNVERIFIED"
        if action == "cooperation_membership_apply" and report["outcome"] == "APPLIED":
            report.update(membership_evidence)
            report["source_authentication"] = "MODEL_ONLY_DECLARED_UNVERIFIED"
            report["new_original_works_require_fresh_independent_consents"] = True
        if action == "participation_status" and report["outcome"] == "APPLIED":
            if (self.formation_policy is not None and
                    self.formation_policy.design.enforce_model_formation_lifecycle):
                report["evaluated_work"] = ev.get("evaluated_work")
                report["evaluated_work_revision"] = ev.get("evaluated_work_revision")
                report["evaluated_result_ref"] = ev.get("evaluated_result_ref")
                report["evaluated_decision_at"] = ev.get("evaluated_decision_at")
                report["evaluation_verdict"] = ev.get("evaluation_verdict")
                report["formation_phase_source_ref"] = ev.get("formation_phase_source_ref")
                report["evaluation_is_owner_judgment_not_measured_impact"] = True
            report["participation_link"] = ev.get("cooperation_link")
            report["participation_relation_revision"] = ev.get("cooperation_source_revision")
            report["participation_value"] = ev.get("new_participation")
            report["participation_source_ref"] = ev.get("participation_evidence_ref")
            report["participation_cost_channel"] = ev.get("economic_channel")
            report["source_authentication"] = "MODEL_ONLY_DECLARED_UNVERIFIED"
        if action == "interest_update" and report["outcome"] == "APPLIED":
            if (self.formation_policy is not None and
                    self.formation_policy.design.enforce_model_result_conditioned_interests):
                report["interest_relation_revision"] = ev.get("cooperation_source_revision")
                report["interest_pilot_work"] = ev.get("pilot_work")
                report["interest_pilot_result_ref"] = ev.get("pilot_result_ref")
                report["interest_pilot_decision_at"] = ev.get("pilot_decision_at")
                report["interest_entry_change_id"] = ev.get("entry_change_id")
                report["interest_entry_assessment_source_ref"] = ev.get("entry_assessment_source_ref")
                report["interest_valid_until"] = ev.get("interest_valid_until")
                report["interest_remains_individual_unverified_claim"] = True
            report["interest_source_revision"] = ev.get("source_revision")
            report["interest_willingness"] = ev.get("new_willingness")
            report["interest_outside_option"] = ev.get("new_outside_option")
            report["interest_evidence_ref"] = ev.get("interest_evidence_ref")
            report["economic_channel"] = ev.get("economic_channel")
            report["interest_relation"] = ev.get("cooperation_link")
            report["source_authentication"] = "MODEL_ONLY_DECLARED_UNVERIFIED"
        if action == "source_update":
            report["source"] = ev.get("source")
            if "expected_revision" in ev:
                report["expected_source_revision"] = ev["expected_revision"]
                report["source_update_compare_and_set"] = True
            else:
                report["source_update_compare_and_set"] = False
        if action == "formation_confirm":
            report["phase"] = ev.get("phase")
            if report["outcome"] == "APPLIED":
                report["formation_source_ref"] = ev.get("formation_source_ref")
                report["work_source_revision"] = self.works[work_ref].source_revision
                if ev.get("phase") == 4:
                    report["formation_core"] = ev.get("formation_core")
                    report["formation_basis_source"] = ev.get("formation_basis_source")
                report["formation_is_model_only_not_original_legal_authority"] = True
        if action in {"function_prepare", "function_review"}:
            report["function_id"] = ev.get("function_id")
            if report["outcome"] == "APPLIED":
                report["work_source_revision"] = self.works[work_ref].source_revision
                report["original_human_or_program_source_authentication"] = "MODEL_ONLY"
                report["program_cannot_create_original_work_or_result"] = True
                if action == "function_prepare":
                    report["function_source_ref"] = ev.get("function_source_ref")
                    report["function_phase_source_ref"] = ev.get("function_phase_source_ref")
                    report["program_packet"] = "HUMAN_REVIEW_PACKET_COMPUTED"
                else:
                    report["prepared_at"] = ev.get("prepared_at")
                    report["human_decision"] = ev.get("human_decision")
                    report["review_source_ref"] = ev.get("review_source_ref")
                    report["human_review_is_not_original_work_consent"] = True
        if action == "adopt_capability":
            report["capability"] = ev.get("capability")
            report["expected_capacity_revision"] = ev.get("expected_capacity_revision")
            report["original_owner_capability_source_only"] = True
            report["real_productivity_gain_or_IP_right_verified"] = False
        if action == "resource_calendar_update" and calendar_risks is not None:
            report["reservation_risks"] = calendar_risks
            report["calendar_revision"] = self.resource_specs[ev["resource"]].calendar.revision
            report["calendar_source"] = self.resource_specs[ev["resource"]].calendar.source
        if blocked_resource is not None:
            report["blocking_resource"] = blocked_resource
        if self.cooperation_links and isinstance(work_ref, str):
            relation_ids = sorted(link.key for link in self.cooperation_links
                                  if work_ref in link.works)
            if relation_ids:
                report["cooperation_relations"] = relation_ids
                report["cooperation_relation_source"] = "MODEL_ONLY_DECLARED"
        if action == "request" and ev.get("cooperation_link") is not None:
            report["requested_cooperation_link"] = ev.get("cooperation_link")
            report["requested_cooperation_source_revision"] = ev.get(
                "cooperation_source_revision"
            )
        if action == "request" and ev.get("pilot_work") is not None:
            report["pilot_work"] = ev.get("pilot_work")
            report["pilot_source"] = "ORIGINAL_ACCEPTED_RESULT_AND_OWNER_EVALUATIONS_ONLY"
        if action == "need_emerge" and report["outcome"] == "APPLIED":
            report.update({
                "work_source_revision": ev["work_source_revision"],
                "goal_source_ref": ev["goal_source_ref"],
                "goal_expires_at": ev["goal_expires_at"],
                "goal_objective": ev["goal_objective"],
                "goal_priority": ev["goal_priority"],
                "pilot_work": ev["pilot_work"],
                "pilot_result_ref": ev["pilot_result_ref"],
                "pilot_decision_at": ev["pilot_decision_at"],
                "cooperation_link": ev["cooperation_link"],
                "cooperation_source_revision": ev["cooperation_source_revision"],
                "model_only_owner_need_not_original_work": True,
                "no_autonomous_demand_or_price_created": True,
            })
        if action == "request" and report["outcome"] == "APPLIED" and (
                self.formation_policy is not None and
                self.formation_policy.design.enforce_model_result_conditioned_goals
                and ev.get("emergent_goal_source_ref") is not None):
            report["emergent_goal_source_ref"] = ev["emergent_goal_source_ref"]
            report["need_source_belongs_to_prior_original_result"] = True
        if action == "request" and report["outcome"] == "APPLIED" and linked_change_evidence:
            report.update(linked_change_evidence)
        self.trace.append(report)
        return report

    def _request_work(self, ev: dict[str, Any], at: int) -> dict[str, Any] | None:
        work = self._parse_work(ev.get("work_spec"))
        if work.key in self.works:
            raise BlockedDecision("WORK_ALREADY_EXISTS")
        if len(self.works) >= 256:
            raise BlockedDecision("WORK_LIMIT_REACHED")
        if ev["actor"] != work.customer:
            raise BlockedDecision("ORIGINAL_CUSTOMER_REQUEST_REQUIRED")
        if not self.subjects[work.customer].active:
            raise BlockedDecision("REQUESTER_NOT_AVAILABLE")
        if any(dep not in self.works for dep in work.requires_accepted):
            raise BlockedDecision("DEPENDENCY_WORK_UNKNOWN")
        if self.formation_policy is not None:
            reason = self.formation_policy.before_followup_request(
                self, ev, work, at
            )
            if reason != "NONE":
                raise BlockedDecision(reason)
        linked_change_evidence = None
        try:
            if "change_id" in ev:
                linked_change_evidence = qualify_cooperation_change_reference(
                    change_id=ev["change_id"],
                    requested_link=ev.get("cooperation_link"),
                    expected_revision=ev.get("cooperation_source_revision"),
                    requester=ev["actor"], work=work,
                    links=self.cooperation_links,
                    resource_owners=self.resources,
                    institution=self.institution, subjects=self.subjects,
                    trace=self.trace, at=at,
                )
            next_links = attach_requested_work(
                self.cooperation_links, work, self.resources,
                link_id=ev.get("cooperation_link"),
                expected_revision=ev.get("cooperation_source_revision"),
                trace=self.trace, org_revision=self.institution.revision,
            )
        except CooperationInputError as exc:
            raise BlockedDecision(str(exc)) from exc
        work.proposal = "REQUESTED"
        work.requester = work.customer
        work.request_at = at
        self.works[work.key] = work  # a need is neither an operator offer nor an obligation
        self.cooperation_links = next_links  # research association only; no contractual consent
        return linked_change_evidence

    def _set_participation_status(self, ev: dict[str, Any]) -> None:
        # An original principal controls only the availability of its OWN
        # future participation. This cannot terminate prior obligations.
        actor = ev["actor"]
        if actor not in self.subjects or not self.subjects[actor].active:
            raise BlockedDecision("PARTICIPATION_SUBJECT_NOT_ACTIVE")
        link = next((entry for entry in self.cooperation_links
                     if entry.key == ev.get("cooperation_link")), None)
        if link is None or actor not in link.participants:
            raise BlockedDecision("PARTICIPATION_ORIGINAL_MEMBER_REQUIRED")
        if self.subjects[actor].kind != "SME":
            raise BlockedDecision("PARTICIPATION_ORIGINAL_ENTERPRISE_REQUIRED")
        if ev.get("cooperation_source_revision") != link.source_revision:
            raise BlockedDecision("COOPERATION_SOURCE_REVISION_STALE")
        if ev.get("org_revision") != self.institution.revision:
            raise BlockedDecision("STALE_ORGANIZATIONAL_CODE")
        if (not isinstance(ev.get("new_participation"), str) or
                ev["new_participation"] not in {"OPEN_TO_NEW_WORK", "PAUSED_NEW_WORK"}):
            raise BlockedDecision("PARTICIPATION_STATUS_INVALID")
        channel = ev.get("economic_channel")
        if not isinstance(channel, str) or channel not in link.mechanisms:
            raise BlockedDecision("COOPERATION_INTEREST_CHANNEL_NOT_DECLARED")
        ref = ev.get("participation_evidence_ref")
        if (not isinstance(ref, str) or len(ref) <= 8 or len(ref) > 180
                or not ref.startswith("model://")):
            raise BlockedDecision("PARTICIPATION_MODEL_SOURCE_REQUIRED")
        if self.formation_policy is not None:
            reason = self.formation_policy.post_result_owner_evaluation(
                self, ev, ev["at"]
            )
            if reason != "NONE":
                raise BlockedDecision(reason)
        # If applied, the ONLY model status is in the one original trace.

    def _assert_future_cooperation_available(self, w: Work,
                                              principals: set[str]) -> None:
        for link in self.cooperation_links:
            if w.key not in link.works:
                continue
            if any(latest_future_participation(
                self.trace, link.key, principal, link.source_revision,
                self.institution.revision
            ) == "PAUSED_NEW_WORK" for principal in principals):
                raise BlockedDecision("COOPERATION_ORIGINAL_PARTY_PAUSED_NEW_WORK")

    def _set_resource_availability(self, ev: dict[str, Any]) -> None:
        key = _id(ev.get("resource"), "resource")
        if key not in self.resources:
            raise BlockedDecision("UNKNOWN_RESOURCE")
        if ev["actor"] != self.resources[key]:
            raise BlockedDecision("RESOURCE_OWNER_REQUIRED")
        status = ev.get("availability")
        if not isinstance(status, str) or status not in AVAILABILITY:
            raise BlockedDecision("INVALID_RESOURCE_STATUS")
        self.resource_availability[key] = status
        self.resource_availability_origin[key] = "MODEL_EVENT"

    def _outstanding_work_ids(self) -> set[str]:
        return {key for key, work in self.works.items()
                if work.obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
                and work.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"}

    def _set_resource_calendar(self, ev: dict[str, Any]) -> list[dict[str, Any]]:
        key = ev.get("resource")
        if not isinstance(key, str) or key not in self.resources:
            raise BlockedDecision("UNKNOWN_RESOURCE")
        if ev["actor"] != self.resources[key]:
            raise BlockedDecision("RESOURCE_OWNER_REQUIRED", key)
        old = self.resource_specs[key]
        if old.basis == "LEGACY_FIXTURE_DEFAULT":
            raise BlockedDecision("RESOURCE_CAPACITY_UNSUPPORTED", key)
        if self.capacity_ledger.future_capacity_claims.get(key):
            raise BlockedDecision("CAPABILITY_CALENDAR_INTERACTION_NOT_QUALIFIED", key)
        expected = old.calendar.revision if old.calendar else "NONE"
        if ev.get("expected_calendar_revision") != expected:
            raise BlockedDecision("STALE_RESOURCE_CALENDAR_REVISION", key)
        try:
            new_calendar = parse_resource_calendar(ev.get("calendar"), old.units)
        except CapacityInputError as exc:
            raise BlockedDecision(str(exc), key) from exc
        if new_calendar.revision == expected:
            raise BlockedDecision("RESOURCE_CALENDAR_REVISION_UNCHANGED", key)
        if new_calendar.revision in self._calendar_revisions_seen[key]:
            raise BlockedDecision("RESOURCE_CALENDAR_REVISION_REUSED", key)
        # Owner's later planning declaration may make accepted work *at risk*.
        # It never deletes a reservation or changes anyone's obligation.
        self.capacity_ledger.update_calendar(key, new_calendar)
        self.resource_specs[key] = self.capacity_ledger.specs[key]
        self._calendar_revisions_seen[key].add(new_calendar.revision)
        return self.capacity_ledger.reservation_risks(
            resources={key}, outstanding=self._outstanding_work_ids())

    def _require_resource_available(self, key: str) -> None:
        if ((self.context_basis is not None and self.context_basis.strict) or self.capacity_strict or self.calendar_strict) and (
            self.resource_availability_origin[key] == "LEGACY_FIXTURE_DEFAULT"
        ):
            raise BlockedDecision("RESOURCE_READINESS_UNSUPPORTED", key)
        if (self.capacity_strict or self.calendar_strict) and self.resource_specs[key].basis == "LEGACY_FIXTURE_DEFAULT":
            raise BlockedDecision("RESOURCE_CAPACITY_UNSUPPORTED", key)
        if self.calendar_strict and self.resource_specs[key].calendar is None:
            raise BlockedDecision("RESOURCE_CALENDAR_UNSUPPORTED", key)
        status = self.resource_availability[key]
        if status == "UNKNOWN":
            raise BlockedDecision("RESOURCE_READINESS_UNKNOWN", key)
        if status == "UNAVAILABLE":
            raise BlockedDecision("RESOURCE_NOT_AVAILABLE", key)

    def _change_mode(self, ev: dict[str, Any]) -> None:
        ins = self.institution
        if ev["actor"] != "FOUNDERS":
            raise BlockedDecision("FOUNDERS_ACTION_REQUIRED")
        by = ev.get("authorized_by", [])
        if not isinstance(by, list) or set(by) != set(ins.founders) or len(by) != len(ins.founders):
            raise BlockedDecision("ORIGINAL_CODE_OWNERS_CONSENT_REQUIRED")
        if ev.get("expected_revision") != ins.revision:
            raise BlockedDecision("STALE_ORGANIZATIONAL_CODE")
        mode, new_rev = ev.get("new_mode"), ev.get("new_revision")
        if not isinstance(mode, str) or mode not in SELECTED_MODES or not isinstance(new_rev, str) or not new_rev or new_rev == ins.revision:
            raise BlockedDecision("INVALID_NEW_CODE")
        new_reserved = ev.get("new_reserved", [])
        if not isinstance(new_reserved, list) or not set(new_reserved).issubset(GOVERNED):
            raise BlockedDecision("INVALID_RESERVED_SCOPE")
        if mode == "MIXED" and not new_reserved:
            raise BlockedDecision("MIXED_REQUIRES_EXPLICIT_RESERVED_SCOPE")
        ins.revision = new_rev
        ins.mode = mode
        ins.mixed_reserved = frozenset(new_reserved)
        for work in self.works.values():
            if work.obligation == "NOT_ACCEPTED":
                work.consents.clear()
                work.admitted = False
                work.authorization_org_revision = None  # old OK cannot authorize a future commitment

    def _work_action(self, w: Work, ev: dict[str, Any], at: int) -> None:
        a = ev["action"]
        actor = ev["actor"]
        if self.context_basis is not None:
            self.context_basis.assert_allowed(w.key, a, actor, at)
        if a == "offer":
            if actor != self.institution.operator or w.proposal not in {"DRAFT", "REQUESTED"}:
                raise BlockedDecision("PROPOSAL_NOT_AVAILABLE")
            w.proposal = "OFFERED"
        elif a == "authorize":
            if w.proposal != "OFFERED" or w.admitted:
                raise BlockedDecision("NO_OPEN_PROPOSAL")
            self._authority(ev, a)
            w.admitted = True
            w.authorization_org_revision = self.institution.revision
        elif a == "consent":
            if not w.admitted or w.obligation != "NOT_ACCEPTED" or w.authorization_org_revision != self.institution.revision:
                raise BlockedDecision("CONSENT_REQUIRES_AUTHORIZED_PROPOSAL")
            owners = self.capacity_ledger.original_owners(w.resource_requirements)
            if actor not in (owners | {w.customer}):
                raise BlockedDecision("NOT_AN_ORIGINAL_OBLIGATION_OWNER")
            if not self.subjects[actor].active:
                raise BlockedDecision("PARTICIPANT_NOT_AVAILABLE_FOR_NEW_WORK")
            if ev.get("source_revision") != w.source_revision or ev.get("org_revision") != self.institution.revision:
                raise BlockedDecision("STALE_CONSENT_SOURCE_OR_ORG_CODE")
            self._assert_future_cooperation_available(w, {actor})
            w.consents[actor] = (w.source_revision, self.institution.revision)
        elif a == "interest_update":
            # A MODEL_ONLY original owner's declared interest. The only state
            # change is an entry in the existing event trace, not a second
            # contract or an auto-revised consent.
            owners = self.capacity_ledger.original_owners(w.resource_requirements)
            if actor not in owners | {w.customer}:
                raise BlockedDecision("NOT_AN_ORIGINAL_OBLIGATION_OWNER")
            if not self.subjects[actor].active:
                raise BlockedDecision("PARTICIPANT_NOT_AVAILABLE_FOR_NEW_WORK")
            if w.obligation != "NOT_ACCEPTED":
                raise BlockedDecision("INTEREST_UPDATE_CANNOT_REWRITE_ACCEPTED_OBLIGATION")
            if (ev.get("source_revision") != w.source_revision or
                    ev.get("org_revision") != self.institution.revision):
                raise BlockedDecision("STALE_CONSENT_SOURCE_OR_ORG_CODE")
            relation = next((link for link in self.cooperation_links
                             if link.key == ev.get("cooperation_link") and w.key in link.works), None)
            if relation is None:
                raise BlockedDecision("COOPERATION_INTEREST_LINK_REQUIRED")
            if ev.get("cooperation_source_revision") != relation.source_revision:
                raise BlockedDecision("COOPERATION_SOURCE_REVISION_STALE")
            channel = ev.get("economic_channel")
            if not isinstance(channel, str) or channel not in relation.mechanisms:
                raise BlockedDecision("COOPERATION_INTEREST_CHANNEL_NOT_DECLARED")
            willingness = ev.get("new_willingness")
            outside = ev.get("new_outside_option")
            if not isinstance(willingness, str) or willingness not in {"WILLING", "DECLINES", "UNKNOWN"}:
                raise BlockedDecision("COOPERATION_INTEREST_WILLINGNESS_INVALID")
            if not isinstance(outside, str) or outside not in {
                    "COOPERATION_PREFERRED", "OUTSIDE_PREFERRED", "UNKNOWN"}:
                raise BlockedDecision("COOPERATION_INTEREST_OUTSIDE_OPTION_INVALID")
            reference = ev.get("interest_evidence_ref")
            if (not isinstance(reference, str) or
                    not reference.startswith("model://") or len(reference) <= 8 or len(reference) > 180):
                raise BlockedDecision("COOPERATION_INTEREST_MODEL_SOURCE_REQUIRED")
            if self.formation_policy is not None:
                issue = self.formation_policy.review_original_interest_event(
                    self, ev, at
                )
                if issue != "NONE":
                    raise BlockedDecision(issue)
        elif a == "commit":
            if actor != self.institution.operator:
                raise BlockedDecision("OPERATOR_RECORDING_MANDATE_REQUIRED")
            if not w.admitted or w.obligation != "NOT_ACCEPTED" or w.authorization_org_revision != self.institution.revision:
                raise BlockedDecision("NO_AUTHORIZED_UNCOMMITTED_PROPOSAL")
            original_owners = self.capacity_ledger.original_owners(w.resource_requirements)
            required = original_owners | {w.customer}
            if any(not self.subjects[principal].active for principal in required):
                raise BlockedDecision("PARTICIPANT_NOT_AVAILABLE_FOR_NEW_WORK")
            if set(w.consents) != required or any(w.consents[principal] != (w.source_revision, self.institution.revision) for principal in required):
                raise BlockedDecision("INDEPENDENT_ACCEPTANCE_MISSING")
            self._assert_future_cooperation_available(w, required)
            if self.formation_policy is not None:
                issue = self.formation_policy.before_commit(self, w, at)
                if issue != "NONE":
                    raise BlockedDecision(issue)
            for need in w.resource_requirements:
                self._require_resource_available(need.resource)
            try:
                if w.operations:
                    self.capacity_ledger.reserve_plan(w.key, operation_reservations(w.key, w.operations))
                else:
                    self.capacity_ledger.reserve(w.key, w.resource_requirements, w.slot_start, w.slot_end)
            except CapacityBlocked as exc:
                reason = exc.reason
                if exc.resource is not None and self.resource_specs[exc.resource].basis == "LEGACY_FIXTURE_DEFAULT":
                    reason = "RESOURCE_ALREADY_COMMITTED"
                raise BlockedDecision(reason, exc.resource) from exc
            w.obligation = "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
            w.commitment_org_revision = self.institution.revision
            if w.operations:
                for res in operation_reservations(w.key, w.operations):
                    self.allocations.append((res.resource, w.key, res.start, res.end))
            else:
                for need in w.resource_requirements:
                    self.allocations.append((need.resource, w.key, w.slot_start, w.slot_end))
        elif a == "start":
            if w.operations:
                raise BlockedDecision("OPERATION_START_REQUIRED")
            if actor != self.resources[w.resource] or w.obligation != "ACCEPTED_BY_ORIGINAL_PRINCIPALS" or w.execution != "NOT_STARTED":
                raise BlockedDecision("EXECUTION_OWNER_OR_OBLIGATION_MISSING")
            prerequisite = readiness(self.works, w.key)
            if prerequisite["reason"] != "NONE":
                raise BlockedDecision(prerequisite["reason"])
            for need in w.resource_requirements:
                self._require_resource_available(need.resource)
            if (at_risk_resource := self.capacity_ledger.is_work_at_risk(
                    w.key, outstanding=self._outstanding_work_ids())) is not None:
                raise BlockedDecision("RESOURCE_CALENDAR_CHANGED_AFTER_COMMIT", at_risk_resource)
            w.execution = "IN_PROGRESS"
        elif a in {"handoff_dispatch", "handoff_receive", "handoff_quality"}:
            self._handoff_action(w, ev)
        elif a in {"start_operation", "complete_operation"}:
            if not w.operations:
                raise BlockedDecision("TECHNOLOGY_NOT_DECLARED")
            identifier = ev.get("operation")
            op = next((item for item in w.operations if item.key == identifier), None)
            if op is None:
                raise BlockedDecision("UNKNOWN_OPERATION")
            if actor != self.resources[op.primary_resource]:
                raise BlockedDecision("ORIGINAL_OPERATION_PERFORMER_REQUIRED")
            if a == "start_operation":
                if (w.obligation != "ACCEPTED_BY_ORIGINAL_PRINCIPALS" or
                        w.execution not in {"NOT_STARTED", "IN_PROGRESS"} or
                        w.operation_states[op.key] != "NOT_STARTED"):
                    raise BlockedDecision("OPERATION_START_STATE_INVALID")
                prerequisite = readiness(self.works, w.key)
                if prerequisite["reason"] != "NONE":
                    raise BlockedDecision(prerequisite["reason"])
                if any(w.operation_states[pred] != "COMPLETED" for pred in op.requires_completed):
                    raise BlockedDecision("OPERATION_PREDECESSOR_INCOMPLETE")
                if any(w.handoff_states[h.edge] != "RECEIVED" for h in w.handoffs
                       if h.downstream == op.key):
                    raise BlockedDecision("HANDOFF_RECEIPT_NOT_DECLARED")
                if self.material_strict:
                    assert_inbound_ready(w.material_batches, w.material_states, op.key)
                for need in op.resource_requirements:
                    self._require_resource_available(need.resource)
                if (risky := self.capacity_ledger.planned_window_risk(
                        op.resource_requirements, op.slot_start, op.slot_end,
                        outstanding=self._outstanding_work_ids())) is not None:
                    raise BlockedDecision("RESOURCE_CALENDAR_CHANGED_AFTER_COMMIT", risky)
                w.execution = "IN_PROGRESS"
                w.operation_states[op.key] = "IN_PROGRESS"
            else:
                if w.execution != "IN_PROGRESS" or w.operation_states[op.key] != "IN_PROGRESS":
                    raise BlockedDecision("OPERATION_NOT_IN_PROGRESS")
                ref = ev.get("result_ref")
                if (not isinstance(ref, str) or not ref.startswith("model://") or
                        len(ref) > 180 or ref in w.operation_evidence.values() or
                        ref in self._handoff_references(w) or ref == w.result_ref):
                    raise BlockedDecision("NEW_MODEL_ONLY_OPERATION_EVIDENCE_REQUIRED")
                w.operation_states[op.key] = "COMPLETED"
                w.operation_evidence[op.key] = ref
        elif a == "assess_result_quality":
            # The customer alone can record an independent modeled inspection
            # of the current submitted Result. This is neither acceptance
            # nor an external factual certification or legal liability.
            assess_result_quality(w, ev)
        elif a == "complete":
            if actor != self.resources[w.resource] or w.execution != "IN_PROGRESS":
                raise BlockedDecision("EXECUTION_OWNER_OR_ACTIVE_WORK_MISSING")
            if w.operations and any(status != "COMPLETED" for status in w.operation_states.values()):
                raise BlockedDecision("TECHNOLOGY_OPERATIONS_INCOMPLETE")
            ref = ev.get("result_ref")
            if not isinstance(ref, str) or not ref.startswith("model://") or len(ref) > 180:
                raise BlockedDecision("MODEL_ONLY_EVIDENCE_REQUIRED")
            if ref in w.operation_evidence.values() or ref in self._handoff_references(w):
                raise BlockedDecision("OPERATION_EVIDENCE_IS_NOT_WORK_RESULT")
            w.execution = "DONE_WITH_EVIDENCE"
            w.result = "SUBMITTED"
            w.result_ref = ref
            w.result_history.append({"transition": "complete", "model_ref": ref})
        elif a == "resubmit":
            if actor != self.resources[w.resource] or w.execution != "DONE_WITH_EVIDENCE" or w.result != "REJECTED":
                raise BlockedDecision("CORRECTION_OWNER_OR_REJECTED_RESULT_REQUIRED")
            ref = ev.get("result_ref")
            if not isinstance(ref, str) or not ref.startswith("model://") or len(ref) > 180 or ref == w.result_ref:
                raise BlockedDecision("NEW_MODEL_ONLY_EVIDENCE_REQUIRED")
            if ref in w.operation_evidence.values() or ref in self._handoff_references(w):
                raise BlockedDecision("OPERATION_EVIDENCE_IS_NOT_WORK_RESULT")
            w.result = "SUBMITTED"
            w.result_ref = ref
            w.result_history.append({"transition": "resubmit", "model_ref": ref})
        elif a in {"accept", "reject"}:
            if actor != w.customer or w.result != "SUBMITTED":
                raise BlockedDecision("ORIGINAL_CUSTOMER_RESULT_DECISION_REQUIRED")
            if a == "accept":
                # A formerly allowed inspection does not remain valid after
                # the ORIGINAL data owner revokes/changes source permissions.
                # Recheck the same existing ContextBasis at acceptance time,
                # without inventing a quality IAM or invalidating old Results.
                if w.assurance_criteria and self.context_basis is not None:
                    self.context_basis.assert_allowed(
                        w.key, "assess_result_quality", actor, at
                    )
                quality_gate = acceptance_gate(w)
                if quality_gate != "NONE":
                    raise BlockedDecision(quality_gate)
            w.result = "ACCEPTED_BY_ORIGINAL_RECIPIENT" if a == "accept" else "REJECTED"
            w.obligation = "FULFILLED" if a == "accept" else "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
            w.result_history.append({"transition": a, "model_ref": w.result_ref})
        else:
            raise BlockedDecision("UNKNOWN_ACTION")

    @staticmethod
    def _handoff_references(w: Work) -> set[str]:
        return ({ref for entry in w.handoff_evidence.values() for ref in entry.values()} |
                {ref for st in w.material_states.values()
                 for ref in (st.dispatch_ref, st.receipt_ref, st.quality_ref) if ref is not None})

    def _handoff_action(self, w: Work, ev: dict[str, Any]) -> None:
        if not self.handoff_strict or not w.operations:
            raise BlockedDecision("HANDOFF_NOT_CONFIGURED")
        edge = (ev.get("from_operation"), ev.get("to_operation"))
        if not all(isinstance(v, str) for v in edge):
            raise BlockedDecision("UNKNOWN_HANDOFF_EDGE")
        handoff = next((h for h in w.handoffs if h.edge == edge), None)
        if handoff is None:
            raise BlockedDecision("UNKNOWN_HANDOFF_EDGE")
        if (w.obligation != "ACCEPTED_BY_ORIGINAL_PRINCIPALS" or
                ev.get("source_revision") != w.source_revision or
                ev.get("org_revision") != w.commitment_org_revision):
            raise BlockedDecision("HANDOFF_ORIGINAL_OBLIGATION_REVISION_REQUIRED")
        action = ev["action"]
        status = w.handoff_states[edge]
        actor = ev["actor"]
        if action == "handoff_quality":
            if not self.material_strict or not w.material_batches:
                raise BlockedDecision("MATERIAL_NOT_CONFIGURED")
            if actor != handoff.receiver:
                raise BlockedDecision("MATERIAL_ORIGINAL_RECEIVER_REQUIRED")
            if status != "RECEIVED":
                raise BlockedDecision("MATERIAL_RECEIPT_REQUIRED")
            if ev.get("receipt_ref") != w.handoff_evidence[edge]["receipt"]:
                raise BlockedDecision("MATERIAL_RECEIPT_REFERENCE_MISMATCH")
        elif action == "handoff_dispatch":
            if actor != handoff.sender:
                raise BlockedDecision("HANDOFF_ORIGINAL_SENDER_REQUIRED")
            if w.operation_states[handoff.upstream] != "COMPLETED":
                raise BlockedDecision("HANDOFF_PREDECESSOR_INCOMPLETE")
            if status != "NOT_DISPATCHED":
                raise BlockedDecision("HANDOFF_DISPATCH_ALREADY_DECLARED")
        else:
            if actor != handoff.receiver:
                raise BlockedDecision("HANDOFF_ORIGINAL_RECEIVER_REQUIRED")
            if status != "DISPATCHED":
                raise BlockedDecision("HANDOFF_DISPATCH_REQUIRED")
            if ev.get("dispatch_ref") != w.handoff_evidence[edge]["dispatch"]:
                raise BlockedDecision("HANDOFF_DISPATCH_REFERENCE_MISMATCH")
        ref = ev.get("result_ref")
        if (not isinstance(ref, str) or not ref.startswith("model://") or
                len(ref) > 180 or ref in w.operation_evidence.values() or
                ref in self._handoff_references(w) or ref == w.result_ref):
            raise BlockedDecision("NEW_MODEL_ONLY_HANDOFF_EVIDENCE_REQUIRED")
        if self.material_strict:
            edge_batches = [batch for batch in w.material_batches if batch.edge == edge]
            if action == "handoff_quality":
                raw = ev.get("quality_quantities")
                if not isinstance(raw, list) or len(raw) != len(edge_batches):
                    raise MaterialBlocked("MATERIAL_QUALITY_QUANTITIES_REQUIRED")
                pending: dict[str, tuple[Any, Any]] = {}
                for entry in raw:
                    if not isinstance(entry, dict) or set(entry) != {"batch", "accepted", "rejected"}:
                        raise MaterialBlocked("INVALID_MATERIAL_QUALITY_CLAIM")
                    key = entry["batch"]
                    batch = next((b for b in edge_batches if b.key == key), None)
                    if batch is None or key in pending:
                        raise MaterialBlocked("MATERIAL_BATCH_MISMATCH")
                    state = w.material_states[key]
                    if state.quality_ref is not None or state.received is None:
                        raise MaterialBlocked("MATERIAL_QUALITY_STATE_INVALID")
                    good = amount(entry["accepted"], reason="INVALID_MATERIAL_QUALITY_QUANTITY", allow_zero=True)
                    bad = amount(entry["rejected"], reason="INVALID_MATERIAL_QUALITY_QUANTITY", allow_zero=True)
                    if good + bad > state.received:
                        raise MaterialBlocked("MATERIAL_QUALITY_EXCEEDS_RECEIPT")
                    pending[key] = (good, bad)
                if len(pending) != len(edge_batches):
                    raise MaterialBlocked("MATERIAL_BATCH_MISMATCH")
                report = event_report(ev)
                for batch in edge_batches:
                    assert_reported_order(w.material_states[batch.key].receipt_report, report)
                for key, (good, bad) in pending.items():
                    state = w.material_states[key]
                    state.accepted, state.rejected = good, bad
                    state.quality_ref, state.quality_report = ref, report
                return
            pending_quantities = quantities(ev.get("material_quantities"),
                                             w.material_batches, edge, w.material_states,
                                             dispatch=action == "handoff_dispatch")
            report = event_report(ev)
            if action == "handoff_receive":
                for key in pending_quantities:
                    assert_reported_order(w.material_states[key].dispatch_report, report)
            for key, value in pending_quantities.items():
                state = w.material_states[key]
                if action == "handoff_dispatch":
                    state.dispatched, state.dispatch_ref, state.dispatch_report = value, ref, report
                else:
                    state.received, state.receipt_ref, state.receipt_report = value, ref, report
        elif any(field in ev for field in ("material_quantities", "quality_quantities",
                                          "reported_actual_at", "reported_external_ref")):
            raise BlockedDecision("MATERIAL_NOT_CONFIGURED")
        if action == "handoff_dispatch":
            w.handoff_states[edge] = "DISPATCHED"
            w.handoff_evidence[edge] = {"dispatch": ref}
        else:
            w.handoff_states[edge] = "RECEIVED"
            w.handoff_evidence[edge]["receipt"] = ref

    def snapshot(self) -> dict[str, Any]:
        output = {
            "schema": "IWXA_AKIS_QUALITATIVE_RESULT/0.1",
            "evidence": "MODEL_ONLY",
            "profit": {"operator": "UNKNOWN", "participants": "UNKNOWN", "system_increment": "UNKNOWN"},
            "institution": {"mode": self.institution.mode, "revision": self.institution.revision, "resource_distribution_is_distinct": True},
            "subjects": {k: {"kind": v.kind, "active_for_new_work": v.active} for k, v in sorted(self.subjects.items())},
            "resources": {k: {"owner": owner, "availability": self.resource_availability[k], "basis": self.resource_availability_origin[k]} for k, owner in sorted(self.resources.items())},
            "works": {k: {"proposal": w.proposal, "requested_by": w.requester, "requested_at": w.request_at, "authorized": w.admitted, "authorization_org_revision": w.authorization_org_revision, "obligation": w.obligation, "execution": w.execution, "result": w.result, "original_customer": w.customer, "resource_owner": self.resources[w.resource], "source_revision": w.source_revision, "commitment_org_revision": w.commitment_org_revision, "result_ref": w.result_ref, "consenting_principals": sorted(w.consents)} for k, w in sorted(self.works.items())},
            "trace": list(self.trace),
            "counts": {"applied": sum(e["outcome"] == "APPLIED" for e in self.trace), "blocked": sum(e["outcome"] == "BLOCKED" for e in self.trace)},
        }
        for key, work in self.works.items():
            if work.assurance_criteria:
                output["works"][key]["assurance"] = assurance_view(work)
            if work.operations:
                output["works"][key]["technology"] = technology_view(
                    work.operations, work.operation_states, work.operation_evidence, self.resources)
                if self.handoff_strict:
                    output["works"][key]["technology"]["handoffs"] = handoffs_view(
                        work.handoffs, work.handoff_states, work.handoff_evidence)
                if self.material_strict:
                    output["works"][key]["technology"]["materials"] = material_view(
                        work.material_batches, work.material_states)
        if (self.portfolio_review_enabled or self.handoff_strict or any(w.requires_accepted for w in self.works.values())
                or any(spec.calendar is not None for spec in self.resource_specs.values())):
            output["portfolio"] = portfolio_view(self.works, self.trace)
            output["result_history"] = {
                key: list(work.result_history) for key, work in sorted(self.works.items())
                if work.result_history
            }
        if self.cooperation_links:
            output["cooperation"] = cooperation_view(
                self.cooperation_links, self.works, self.resources, self.trace)
        if self.context_basis is not None:
            output["context_basis"] = self.context_basis.snapshot()
        if self.capacity_strict or self.calendar_strict or bool(self.capacity_ledger.future_capacity_claims) or any(spec.basis == "MODEL_DECLARED" for spec in self.resource_specs.values()) or any(
            len(w.resource_requirements) > 1 for w in self.works.values()
        ):
            output["capacity"] = self.capacity_ledger.snapshot(outstanding=self._outstanding_work_ids())
            output["capacity"]["strict"] = self.capacity_strict
            if self.calendar_strict:
                output["capacity"]["calendar_strict"] = True
            output["capacity"]["requirements"] = {
                key: [{"resource": need.resource, "units": need.units} for need in work.resource_requirements]
                for key, work in sorted(self.works.items())
            }
        return output
