"""Qualitative IWXA AKIS decision rules. No costs, pseudo-profits, or legal effects.

These rules process MODEL_ONLY claims supplied by the research input. They neither
produce original Result objects nor infer contracts, signatures, or legal consent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .context_basis import (ContextBasis, ContextBlocked, ContextInputError,
                            DECISION_SOURCE_FIELDS)
from .outside_demand import (
    OutsideDemandBlocked, qualify_original_outside_demand_signal,
    qualify_original_outside_demand_withdrawal,
    qualify_original_outside_supplier_offer,
    qualify_original_outside_buyer_offer_response,
    qualify_original_outside_work_origin,
)
from .org_code_policy import (
    OrgCodeBlocked, NEW_WORK_ACTIONS, qualify_model_code_proposal,
    qualify_model_code_response, qualify_model_code_function_response,
    qualify_model_code_apply,
)
from .capacity import (
    CapacityBlocked, CapacityInputError, CapacityLedger, ResourceNeed,
    parse_resource_calendar, parse_resource_capacity, parse_resource_needs,
)
from .technology import (
    Operation, TechnologyInputError, parse_operations, owners_summary,
    operation_reservations, technology_view,
    TechnologyRouteBlocked, qualify_original_technology_route_proposal,
    qualify_original_technology_route_response,
    qualify_original_technology_route_request, qualify_original_technology_route_commit,
    qualify_original_route_commercial_consent,
)
from .source_registration import (
    RegistrationBlocked, qualify_subject_registration,
    qualify_resource_registration,
)
from .affiliation import AffiliationBlocked, qualify_affiliation_transfer
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
    qualify_coalition_option_proposal, qualify_coalition_owner_comparison,
    qualify_competing_coalition_selection,
    qualify_active_coalition_portfolio_proposal,
    qualify_active_coalition_owner_assessment,
    qualify_active_coalition_original_commit,
    qualify_cooperation_lifecycle_proposal,
    qualify_cooperation_lifecycle_response, apply_cooperation_lifecycle,
    original_cooperation_dissolved_for_future,
)

SCHEMA = "IWXA_AKIS_QUALITATIVE_INPUT/0.1"
SELECTED_MODES = frozenset({"SOLE", "COLLEGIAL", "MIXED"})
# UNSELECTED explicitly describes missing qualification, not tacit SOLE.
MODES = SELECTED_MODES | {"UNSELECTED"}
AVAILABILITY = frozenset({"AVAILABLE", "UNAVAILABLE", "UNKNOWN"})
ACTIONS = frozenset({"request", "offer", "authorize", "consent", "commit", "start", "complete", "accept", "reject", "resubmit", "exclude", "change_mode", "resource_status", "resource_calendar_update", "source_update", "outside_demand_signal", "outside_demand_withdraw", "outside_supplier_offer",
    "outside_buyer_offer_response", "start_operation", "complete_operation", "handoff_dispatch", "handoff_receive", "handoff_quality", "assess_result_quality", "interest_update", "participation_status", "cooperation_change_propose", "cooperation_change_response", "cooperation_entry_assess", "cooperation_membership_apply", "model_code_propose", "model_code_response",
    "model_code_function_response", "model_code_apply",
    "technology_route_propose", "technology_route_response",
    "subject_registration_propose", "subject_registration_attest",
    "subject_registration_review", "subject_registration_apply",
    "resource_registration_propose", "resource_registration_review",
    "resource_registration_apply",
    "coalition_options_propose", "coalition_option_assess",
    "active_coalition_portfolio_propose", "active_coalition_portfolio_assess",
    "cooperation_lifecycle_propose", "cooperation_lifecycle_response",
    "cooperation_lifecycle_apply",
    "adopt_capability", "formation_confirm", "function_prepare", "function_review", "need_emerge",
    "role_state_update",
    "affiliation_transfer_propose", "affiliation_transfer_review",
    "affiliation_transfer_apply"})
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
    affiliation_at_commit: dict[str, str] = field(default_factory=dict)
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
    # R1-V2: original within-enterprise roles, not new company owners.
    # These owner-scoped model references are NOT authenticated credentials.
    organization: str | None = None
    affiliation_source_ref: str | None = None
    self_role_source_ref: str | None = None
    # R1-V2B: same original source assertions qualify sector/public/person
    # role, individually authored mandate or personal context access.
    mandate_source_ref: str | None = None
    context_source_ref: str | None = None
    role_source_revision: str | None = None
    # Owner-controlled R1-V2C1 lifecycle remains in ONE original subjects map.
    role_management_source_ref: str | None = None
    role_revision_history: tuple[str, ...] = ()
    affiliation_history: tuple[tuple[str, str, int], ...] = ()
    affiliation_source_revision: str | None = None


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
            _keys_exact(obj, {"id", "kind"}, {
                "organization", "affiliation_source_ref", "self_role_source_ref",
                "mandate_source_ref", "context_source_ref", "role_source_revision",
                "role_management_source_ref",
            }, "SUBJECT")
            key = _id(obj["id"], "subject")
            kind = obj["kind"]
            if kind not in {
                "SME", "OPERATOR", "DIVISION", "EMPLOYEE",
                "SECTOR_BODY", "PUBLIC_INSTITUTION", "NATURAL_PERSON",
            } or key in self.subjects:
                raise InputError("INVALID_OR_DUPLICATE_SUBJECT")
            if kind in {"DIVISION", "EMPLOYEE"}:
                if set(obj) != {
                    "id", "kind", "organization", "affiliation_source_ref",
                    "self_role_source_ref",
                }:
                    raise InputError("INTRAFIRM_ROLE_REQUIRES_ORIGINAL_SOURCES")
                enterprise = _id(obj["organization"], "organization")
                parent_ref = obj["affiliation_source_ref"]
                own_ref = obj["self_role_source_ref"]
                if (enterprise == key or not isinstance(parent_ref, str)
                        or not parent_ref.startswith(f"model://{enterprise}/")
                        or not isinstance(own_ref, str)
                        or not own_ref.startswith(f"model://{key}/")
                        or any(len(ref) > 180 for ref in (parent_ref, own_ref))):
                    raise InputError("INTRAFIRM_ROLE_OWNER_SOURCE_INVALID")
                self.subjects[key] = Party(
                    key, kind, organization=enterprise,
                    affiliation_source_ref=parent_ref,
                    self_role_source_ref=own_ref,
                )
            elif kind in {"SECTOR_BODY", "PUBLIC_INSTITUTION", "NATURAL_PERSON"}:
                special = ("context_source_ref" if kind == "NATURAL_PERSON"
                           else "mandate_source_ref")
                if set(obj) not in (
                    {"id", "kind", "self_role_source_ref", special,
                     "role_source_revision"},
                    {"id", "kind", "self_role_source_ref", special,
                     "role_source_revision", "role_management_source_ref"},
                ):
                    raise InputError("AUTHOR_ROLE_SOURCE_FIELDS_REQUIRED")
                self_ref, scope_ref = obj["self_role_source_ref"], obj[special]
                management = obj.get("role_management_source_ref")
                refs = (self_ref, scope_ref, management)
                if (not isinstance(self_ref, str)
                        or not isinstance(scope_ref, str)
                        or self_ref == scope_ref
                        or (management is not None and (
                            not isinstance(management, str)
                            or management in {self_ref, scope_ref}
                        ))
                        or any(
                            not isinstance(ref, str) or len(ref) > 128
                            or not ref.startswith(f"model://{key}/")
                            for ref in refs if ref is not None
                        )):
                    raise InputError("AUTHOR_ROLE_INDEPENDENT_SOURCE_OWNER_REQUIRED")
                revision = _id(
                    obj["role_source_revision"], "role_source_revision"
                )
                self.subjects[key] = Party(
                    key, kind, self_role_source_ref=self_ref,
                    mandate_source_ref=scope_ref if special == "mandate_source_ref" else None,
                    context_source_ref=scope_ref if special == "context_source_ref" else None,
                    role_source_revision=revision,
                    role_management_source_ref=management,
                    role_revision_history=(revision,),
                )
            else:
                if set(obj) != {"id", "kind"}:
                    raise InputError("INTRAFIRM_FIELDS_FOR_ENTERPRISE_FORBIDDEN")
                self.subjects[key] = Party(key, kind)
        for party in self.subjects.values():
            if party.kind in {"DIVISION", "EMPLOYEE"} and (
                    party.organization not in self.subjects
                    or self.subjects[party.organization].kind != "SME"):
                raise InputError("INTRAFIRM_ROLE_REQUIRES_REAL_ORIGINAL_SME")
        op = _id(ins["operator"], "operator")
        if op not in self.subjects or self.subjects[op].kind != "OPERATOR":
            raise InputError("MISSING_OR_INVALID_OPERATOR")
        founders = tuple(ins["founders"])
        council = tuple(ins["council_members"])
        if len(founders) != len(set(founders)) or len(council) != len(set(council)) or not set(founders + council).issubset(self.subjects):
            raise InputError("INVALID_GOVERNANCE_OWNERS")
        if any(self.subjects[p].kind not in {"SME", "OPERATOR"}
               for p in founders + council):
            raise InputError("INTRAFIRM_ROLE_CANNOT_ACT_AS_ORIGINAL_FOUNDER")
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
             "criterion", "quality_verdict", "quality_evidence_ref", "capability", "expected_capacity_revision", "phase", "formation_source_ref", "formation_core", "formation_basis_source", "function_id", "function_source_ref", "function_phase_source_ref", "preparation_mode", "preparation_diagnostic", "preparation_pattern", "prepared_at", "human_decision", "review_source_ref", "pilot_work", "evaluated_work", "evaluated_work_revision", "evaluated_result_ref", "evaluated_decision_at", "evaluation_verdict", "evaluation_economic_source_revision", "evaluation_economic_outside_basis", "evaluation_economic_portfolio", "evaluation_economic_recipient_value", "formation_phase_source_ref", "work_source_revision", "goal_source_ref", "goal_expires_at", "goal_objective", "goal_priority", "pilot_result_ref", "pilot_decision_at", "emergent_goal_source_ref", "interest_valid_until",
             "new_link_id", "new_link_revision", "new_link_source_ref", "entry_goal_source_ref", "entry_alternative_source_ref", "entry_assessment_source_ref", "entry_willingness", "entry_outside_option", "entry_valid_until", "entry_change_id", "entry_assessment_source_ref",
             "model_code_change_id", "model_code_source_ref", "model_code_decision",
             "model_code_decision_source_ref", "new_model_edition",
             "expected_model_edition", "proposed_model_role",
             "original_cooperation_change_id", "model_code_records",
             "model_code_fingerprint", "model_code_change_kind",
             "expected_model_roles", "proposed_model_roles",
             "expected_model_commit_responsible",
             "proposed_model_commit_responsible",
             "technology_route_id", "technology_route_work",
             "technology_route_work_spec", "technology_route_fingerprint",
             "technology_route_market_scope",
             "technology_route_commercial_terms", "technology_route_commercial_fingerprint",
             "technology_route_source_ref", "technology_route_valid_until",
             "technology_route_decision", "technology_route_decision_source_ref",
             "technology_route_model_code_change_id",
             "subject_registration_id", "resource_registration_id",
             "new_subject", "new_subject_kind", "new_subject_spec", "registration_fingerprint",
             "registration_source_ref", "registration_self_ref",
             "registration_goal_source_ref", "registration_alternative_source_ref",
             "registration_willingness", "registration_valid_until",
             "registration_decision", "registration_decision_source_ref",
             "resource_spec", "resource_fingerprint",
             "registration_resource_source_ref",
             "coalition_competition_id", "coalition_change_ids",
             "coalition_comparison_fingerprint",
             "coalition_comparison_source_ref", "coalition_comparison_valid_until",
             "coalition_preferred_change_id", "coalition_willingness",
             "coalition_outside_option", "coalition_evaluation_dimension",
             "coalition_owner_source_ref",
             "coalition_portfolio_id", "coalition_portfolio_links",
             "coalition_portfolio_works", "coalition_portfolio_fingerprint",
             "coalition_portfolio_source_ref", "coalition_portfolio_valid_until",
             "coalition_portfolio_preferred_link", "coalition_portfolio_willingness",
             "coalition_portfolio_outside_position",
             "coalition_portfolio_owner_source_ref",
             "coalition_portfolio_cash_available",
             "coalition_portfolio_cash_floor",
             "coalition_portfolio_peak_cash_needs",
             "lifecycle_id", "lifecycle_kind", "lifecycle_fingerprint",
             "lifecycle_source_ref", "lifecycle_response_source_ref",
             "lifecycle_valid_until", "lifecycle_new_participants",
             "lifecycle_decision", "source_rights_ref",
             "role_target", "role_expected_revision", "role_new_revision",
             "role_new_state", "role_management_source_ref",
             "affiliation_transfer_id", "from_enterprise", "to_enterprise",
             "old_affiliation_source_ref", "new_affiliation_source_ref",
             "self_role_source_ref", "transfer_fingerprint",
             "transfer_valid_until", "transfer_source_ref",
             "transfer_decision", "transfer_decision_source_ref",
             "transfer_parent_source_ref",
             "outside_demand_id", "outside_supplier", "outside_relation",
             "outside_relation_revision", "outside_candidate_work", "outside_candidate_operation",
             "outside_work_revision", "outside_resource", "outside_units",
             "outside_slot_start", "outside_slot_end", "outside_deliverable",
             "outside_quality_basis", "outside_currency",
             "outside_price_ceiling", "outside_demand_source_ref",
             "outside_demand_source_revision", "outside_demand_valid_until",
             "outside_withdrawal_source_ref", "outside_withdrawal_source_revision",
             "outside_offer_id", "outside_offer_source_ref",
             "outside_offer_source_revision", "outside_offer_price",
             "outside_offer_currency", "outside_offer_resource",
             "outside_offer_units", "outside_offer_slot_start",
             "outside_offer_slot_end", "outside_offer_deliverable",
             "outside_offer_quality_basis", "outside_offer_valid_until",
             "outside_buyer_response_id", "outside_buyer_response_decision",
             "outside_buyer_response_source_ref",
             "outside_buyer_response_source_revision",
             "outside_buyer_response_valid_until",
             "outside_work_origin"}, "EVENT")
            if type(ev["at"]) is not int or ev["at"] <= last or not isinstance(ev["action"], str) or ev["action"] not in ACTIONS:
                raise InputError("EVENTS_MUST_HAVE_STRICTLY_INCREASING_INTEGER_TIMES_AND_KNOWN_ACTIONS")
            last = ev["at"]
            if "preparation_mode" in ev and (
                    ev["action"] != "function_prepare"
                    or ev["preparation_mode"] not in ("S0", "S1", "S2")):
                raise InputError("PREPARATION_MODE_REQUIRES_ORIGINAL_PREPARE_ACTION")
            if "preparation_diagnostic" in ev and (
                    ev["action"] != "function_prepare" or "preparation_mode" not in ev):
                raise InputError("PREPARATION_DIAGNOSTIC_REQUIRES_ORIGINAL_PREPARATION_MODE")
            if "preparation_pattern" in ev and (
                    ev["action"] != "function_prepare" or ev.get("preparation_mode") not in ("S1", "S2")
                    or "preparation_diagnostic" in ev):
                # Pattern and risk-adaptive studies share the same original
                # mechanism, but a joint counterfactual requires independent
                # pattern availability per alternative (not yet declared).
                raise InputError("PREPARATION_PATTERN_REQUIRES_SEPARATE_EXPLICIT_DIGITAL_MODE")
            if "technology_route_market_scope" in ev and ev["action"] not in {
                    "technology_route_propose", "request", "commit"}:
                raise InputError("MARKET_SCOPE_REQUIRES_ORIGINAL_TECHNOLOGY_DECISION")
            if ("technology_route_commercial_terms" in ev and ev["action"] not in {
                    "technology_route_propose", "request", "commit"}
                    or "technology_route_commercial_fingerprint" in ev and ev["action"] not in {
                    "technology_route_propose", "technology_route_response", "request", "consent", "commit"}):
                raise InputError("COMMERCIAL_TERMS_REQUIRE_ORIGINAL_TECHNOLOGY_DECISION")
            if "evaluation_economic_portfolio" in ev and (
                    ev["action"] != "participation_status"
                    or ev["evaluation_economic_portfolio"] is not True
                    or "evaluation_economic_source_revision" not in ev):
                raise InputError("PORTFOLIO_FORECAST_REQUIRES_ORIGINAL_OWNER_ECONOMIC_REVIEW")
            if "evaluation_economic_recipient_value" in ev and (
                    ev["action"] != "participation_status"
                    or ev["evaluation_economic_recipient_value"] is not True
                    or "evaluation_economic_source_revision" not in ev
                    or "evaluation_economic_outside_basis" in ev):
                raise InputError("RECIPIENT_VALUE_REVIEW_REQUIRES_ORIGINAL_OWNER_PILOT")
            _id(ev["actor"], "actor")
            if ev["action"] == "request":
                # The ORIGINAL request remains source-validated at its own
                # event time. A future enterprise/resource absent at t=0
                # cannot be forced into the original live registries just
                # to parse a prospective Work. Skipping initial resolution is
                # allowed ONLY with a prior declared original registration
                # and prospective APPLY event, not a merely proposed name.
                spec = ev.get("work_spec")
                if not isinstance(spec, dict):
                    self._parse_work(spec)
                else:
                    _keys_exact(spec, {
                        "id", "customer", "resource", "source_revision",
                        "slot_start", "slot_end",
                    }, {
                        "requires_accepted", "resource_requirements",
                        "operations", "material_batches",
                        "assurance_criteria",
                    }, "WORK")
                    if (not isinstance(spec.get("resource_requirements", []), list)
                            or not isinstance(spec.get("operations", []), list)):
                        raise InputError(
                            "FUTURE_ORIGINAL_WORK_MINIMUM_SOURCE_INVALID"
                        )
                    mentioned = {spec.get("resource")}
                    for need in spec.get("resource_requirements", []):
                        if isinstance(need, dict):
                            mentioned.add(need.get("resource"))
                    for op_row in spec.get("operations", []):
                        if isinstance(op_row, dict):
                            mentioned.add(op_row.get("primary_resource"))
                            for need in op_row.get("resource_requirements", []):
                                if isinstance(need, dict):
                                    mentioned.add(need.get("resource"))
                    missing = {x for x in mentioned if x not in self.resources}
                    unknown_customer = spec.get("customer") not in self.subjects
                    if missing or unknown_customer:
                        # A future original applicant is bound to the
                        # earlier accepted-purpose registration PROPOSAL by
                        # its id. The APPLY event cannot invent a different
                        # subject, and the real request is still checked
                        # against self.subjects after the actual apply.
                        subject_applies = {
                            proposal.get("new_subject") for proposal in events
                            if proposal.get("action") == "subject_registration_propose"
                            and any(
                                app.get("action") == "subject_registration_apply"
                                and app.get("subject_registration_id") ==
                                    proposal.get("subject_registration_id")
                                and proposal["at"] < app["at"] < ev["at"]
                                for app in events
                            )
                        }
                        resource_plans = {
                            row.get("resource_spec", {}).get("id")
                            for row in events
                            if row.get("action") == "resource_registration_propose"
                            and isinstance(row.get("resource_spec"), dict)
                            and any(app.get("action") == "resource_registration_apply"
                                    and app.get("resource_registration_id") ==
                                        row.get("resource_registration_id")
                                    and app["at"] < ev["at"]
                                    for app in events)
                        }
                        if (not missing <= resource_plans or
                                (unknown_customer and spec.get("customer")
                                 not in subject_applies)):
                            self._parse_work(spec)
                        elif (not isinstance(spec.get("id"), str)
                              or not isinstance(spec.get("source_revision"), str)
                              or type(spec.get("slot_start")) is not int
                              or type(spec.get("slot_end")) is not int
                              or spec["slot_start"] >= spec["slot_end"]):
                            raise InputError(
                                "FUTURE_ORIGINAL_WORK_MINIMUM_SOURCE_INVALID"
                            )
                    else:
                        self._parse_work(spec)
        self.context_basis: ContextBasis | None = None
        self.model_org_policy = None  # Optional MODEL_ONLY constraint on original new-Work actions.
        self.model_org_code_edition = "BASE"  # Source-edition only, NOT institutional OC revision.
        self.model_org_code_editions = {"BASE"}
        self.formation_policy = None  # Optional source/owner phase gates, original trace only.
        self.capability_policy = None  # Optional owner gate, never an autonomous upgrade.
        if "context_evidence" in scenario:
            raw_context = scenario["context_evidence"]
            known_works = set(self.works)
            known_works.update(ev["work_spec"]["id"] for ev in events if ev["action"] == "request")
            try:
                for proposal_event in events:
                    if (proposal_event["action"] == "subject_registration_propose"
                            and not isinstance(
                                proposal_event.get("new_subject_kind"), str
                            )):
                        raise InputError(
                            "REGISTRATION_NEW_SUBJECT_KIND_MUST_BE_STRING"
                        )
                prospective_kinds = {
                    ev["new_subject"]: ev["new_subject_kind"]
                    for ev in events
                    if ev["action"] == "subject_registration_propose"
                    and ev.get("new_subject_kind") in {
                        "SME", "SECTOR_BODY", "PUBLIC_INSTITUTION",
                        "NATURAL_PERSON",
                    }
                    and isinstance(ev.get("new_subject"), str)
                    and ev["new_subject"] not in self.subjects
                }
                self.context_basis = ContextBasis(
                    raw_context, self.subjects, known_works,
                    prospective_subjects=set(prospective_kinds),
                    prospective_subject_kinds=prospective_kinds,
                    operator=self.institution.operator,
                )
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
        technology_route_evidence = None
        registration_evidence = None
        affiliation_evidence = None
        coalition_competition_evidence = None
        active_coalition_evidence = None
        lifecycle_evidence = None
        active_coalition_commit_evidence = None
        outside_demand_evidence = None
        preparation_economic_choice = None
        preparation_pattern_evidence = None
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
            elif action in {
                "subject_registration_propose", "subject_registration_attest",
                "subject_registration_review", "subject_registration_apply",
            }:
                registration_evidence = qualify_subject_registration(
                    self, ev, at
                )
                if action == "subject_registration_apply":
                    key = registration_evidence["registered_original_subject"]
                    kind = registration_evidence[
                        "registered_original_subject_kind"
                    ]
                    if kind == "SME":
                        self.subjects[key] = Party(key, "SME")
                    else:
                        # The prospective document was fingerprinted at
                        # proposal, independently attested and source-checked
                        # again on APPLY. The original subjects map alone
                        # now receives the actually qualified participant.
                        spec = registration_evidence["new_subject_spec"]
                        self.subjects[key] = Party(
                            key, kind,
                            self_role_source_ref=spec["self_role_source_ref"],
                            mandate_source_ref=spec.get("mandate_source_ref"),
                            context_source_ref=spec.get("context_source_ref"),
                            role_source_revision=spec["role_source_revision"],
                            role_management_source_ref=spec.get(
                                "role_management_source_ref"
                            ),
                            role_revision_history=(
                                spec["role_source_revision"],
                            ),
                        )
            elif action in {
                "resource_registration_propose", "resource_registration_review",
                "resource_registration_apply",
            }:
                registration_evidence = qualify_resource_registration(
                    self, ev, at
                )
                if action == "resource_registration_apply":
                    spec = registration_evidence["resource_spec"]
                    capacity = parse_resource_capacity(spec)
                    key, owner = capacity.key, capacity.owner
                    # One original Resource map, same CapacityLedger: no
                    # second inventory, reservation book or ownership graph.
                    self.resource_specs[key] = capacity
                    self.capacity_ledger.specs[key] = capacity
                    self.resources[key] = owner
                    self.resource_availability[key] = spec["availability"]
                    self.resource_availability_origin[key] = (
                        "OWNER_REGISTERED_MODEL_SOURCE"
                    )
                    self._calendar_revisions_seen[key] = set()
            elif action in {
                "affiliation_transfer_propose", "affiliation_transfer_review",
                "affiliation_transfer_apply",
            }:
                if self.context_basis is None or not self.context_basis.strict:
                    raise BlockedDecision(
                        "AFFILIATION_ORIGINAL_STRICT_KPB_REQUIRED"
                    )
                self.context_basis.assert_original_decision_rights(ev, at)
                if action == "affiliation_transfer_apply":
                    self.context_basis.assert_original_decision_lineage(
                        self.trace, action, ev.get("affiliation_transfer_id"),
                        at,
                    )
                affiliation_evidence = qualify_affiliation_transfer(
                    self, ev, at
                )
                if action == "affiliation_transfer_apply":
                    key = affiliation_evidence["role_target"]
                    party = self.subjects[key]
                    previous = party.organization
                    party.organization = affiliation_evidence[
                        "original_to_enterprise"
                    ]
                    party.affiliation_source_ref = affiliation_evidence[
                        "new_affiliation_source_ref"
                    ]
                    party.affiliation_source_revision = (
                        self.context_basis.sources[
                            party.affiliation_source_ref
                        ].revision
                    )
                    party.affiliation_history += (
                        (previous, party.organization, at),
                    )
                    # A new parent does not inherit prospective old-parent
                    # consent. Previously accepted obligations are untouched.
                    for work in self.works.values():
                        if work.obligation != "NOT_ACCEPTED":
                            continue
                        principals = (
                            self.capacity_ledger.original_owners(
                                work.resource_requirements
                            ) | {work.customer}
                        )
                        if key in principals:
                            work.consents.clear()
                            work.admitted = False
                            work.authorization_org_revision = None
            elif action == "model_code_propose":
                qualify_model_code_proposal(self, ev, at)
            elif action == "model_code_response":
                qualify_model_code_response(self, ev, at)
            elif action == "model_code_function_response":
                qualify_model_code_function_response(self, ev, at)
            elif action == "technology_route_propose":
                technology_route_evidence = qualify_original_technology_route_proposal(
                    self, ev, at
                )
            elif action == "technology_route_response":
                qualify_original_technology_route_response(self, ev, at)
            elif action == "model_code_apply":
                candidate = qualify_model_code_apply(
                    self, ev, at, actions=set(ACTIONS)
                )
                proposal = next(
                    row for row in self.trace
                    if row.get("action") == "model_code_propose"
                    and row.get("outcome") == "APPLIED"
                    and row.get("model_code_change_id") == ev["model_code_change_id"]
                )
                entrant = proposal["proposed_subject"]
                affected = {entrant}
                if proposal.get("model_code_change_kind") == (
                    "REASSIGN_EXISTING_MODEL_FUNCTIONS"
                ):
                    affected.update(proposal["expected_model_commit_responsible"])
                    affected.update(proposal["proposed_model_commit_responsible"])
                # Only uncommitted Work involving changed model responsibilities
                # loses prospective approvals. Accepted and ongoing obligations
                # retain their original binding principal/source history.
                for work in self.works.values():
                    if (work.obligation == "NOT_ACCEPTED"
                            and (work.customer in affected or
                                 any(self.resources[n.resource] in affected
                                     for n in work.resource_requirements))):
                        work.consents.clear()
                        work.admitted = False
                        work.authorization_org_revision = None
                self.model_org_policy = candidate
                self.model_org_code_edition = ev["new_model_edition"]
                self.model_org_code_editions.add(ev["new_model_edition"])
            elif action in {"outside_demand_signal", "outside_demand_withdraw",
                            "outside_supplier_offer", "outside_buyer_offer_response"}:
                try:
                    if action == "outside_demand_signal":
                        outside_demand_evidence = (
                            qualify_original_outside_demand_signal(self, ev, at)
                        )
                    elif action == "outside_supplier_offer":
                        outside_demand_evidence = (
                            qualify_original_outside_supplier_offer(self, ev, at)
                        )
                    elif action == "outside_buyer_offer_response":
                        outside_demand_evidence = (
                            qualify_original_outside_buyer_offer_response(
                                self, ev, at
                            )
                        )
                    else:
                        outside_demand_evidence = (
                            qualify_original_outside_demand_withdrawal(self, ev, at)
                        )
                except OutsideDemandBlocked as exc:
                    raise BlockedDecision(str(exc)) from exc
            elif action == "request":
                linked_change_evidence = self._request_work(ev, at)
            elif action == "resource_status":
                self._set_resource_availability(ev)
            elif action == "resource_calendar_update":
                calendar_risks = self._set_resource_calendar(ev)
            elif action == "source_update":
                if self.context_basis is None:
                    raise BlockedDecision("CONTEXT_BASIS_NOT_CONFIGURED")
                self.context_basis.owner_update(ev, at=at)
                if self.capability_policy is not None:
                    self.capability_policy.refresh(self, at)
            elif action == "role_state_update":
                self._update_original_extended_role(ev, at)
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
                if action == "function_prepare" and "preparation_diagnostic" in ev:
                    from .process_preparation import review_original_preparation_diagnostic
                    try:
                        preparation_economic_choice = review_original_preparation_diagnostic(
                            self, self.works[work_ref], ev["actor"],
                            ev["preparation_mode"], ev["preparation_diagnostic"], at,
                        )
                    except ValueError as exc:
                        raise BlockedDecision(str(exc)) from exc
                if action == "function_prepare" and "preparation_pattern" in ev:
                    from .process_preparation import qualify_original_preparation_pattern
                    try:
                        preparation_pattern_evidence = qualify_original_preparation_pattern(
                            self, self.works[work_ref], ev["actor"], ev["preparation_mode"],
                            ev["preparation_pattern"], at,
                        )
                    except ValueError as exc:
                        raise BlockedDecision(str(exc)) from exc
            elif action == "adopt_capability":
                if self.capability_policy is None:
                    raise BlockedDecision("CAPABILITY_POLICY_NOT_CONFIGURED")
                self.capability_policy.apply(self, ev, at)
            elif action == "participation_status":
                self._set_participation_status(ev)
            elif action in {"coalition_options_propose", "coalition_option_assess"}:
                if self.context_basis is not None and self.context_basis.strict:
                    raise BlockedDecision(
                        "COALITION_COMPETITION_SOURCE_RIGHTS_NOT_QUALIFIED"
                    )
                try:
                    coalition_competition_evidence = (
                        qualify_coalition_option_proposal(self, ev, at)
                        if action == "coalition_options_propose"
                        else qualify_coalition_owner_comparison(self, ev, at)
                    )
                except CooperationInputError as exc:
                    raise BlockedDecision(str(exc)) from exc
            elif action in {
                "active_coalition_portfolio_propose",
                "active_coalition_portfolio_assess",
            }:
                if self.context_basis is not None and self.context_basis.strict:
                    raise BlockedDecision(
                        "ACTIVE_COALITION_SOURCE_RIGHTS_NOT_QUALIFIED"
                    )
                try:
                    active_coalition_evidence = (
                        qualify_active_coalition_portfolio_proposal(self, ev, at)
                        if action == "active_coalition_portfolio_propose"
                        else qualify_active_coalition_owner_assessment(self, ev, at)
                    )
                except CooperationInputError as exc:
                    raise BlockedDecision(str(exc)) from exc
            elif action in {
                "cooperation_lifecycle_propose",
                "cooperation_lifecycle_response",
                "cooperation_lifecycle_apply",
            }:
                if self.context_basis is not None and self.context_basis.strict:
                    if not getattr(self.context_basis, "decision_requirements", None):
                        raise BlockedDecision(
                            "COOPERATION_LIFECYCLE_SOURCE_RIGHTS_NOT_QUALIFIED"
                        )
                    self.context_basis.assert_original_decision_rights(ev, at)
                    if action == "cooperation_lifecycle_apply":
                        self.context_basis.assert_original_decision_lineage(
                            self.trace, action, ev.get("lifecycle_id"), at
                        )
                try:
                    if action == "cooperation_lifecycle_propose":
                        lifecycle_evidence = qualify_cooperation_lifecycle_proposal(
                            self, ev, at
                        )
                    elif action == "cooperation_lifecycle_response":
                        lifecycle_evidence = qualify_cooperation_lifecycle_response(
                            self, ev, at
                        )
                    else:
                        revised, lifecycle_evidence = apply_cooperation_lifecycle(
                            self, ev, at
                        )
                        self.cooperation_links = revised
                except CooperationInputError as exc:
                    raise BlockedDecision(str(exc)) from exc
            elif action in {"cooperation_change_propose", "cooperation_change_response"}:
                # Use the SAME original ContextBasis. A collective revision
                # requires each principal's own scoped decision sources.
                if self.context_basis is not None and self.context_basis.strict:
                    if not self.context_basis.decision_requirements:
                        raise BlockedDecision("COOPERATION_CHANGE_SOURCE_RIGHTS_NOT_QUALIFIED")
                    self.context_basis.assert_original_decision_rights(ev, at)
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
                # Result. Its independent sourced judgment is checked in KPB.
                if self.context_basis is not None and self.context_basis.strict:
                    if not self.context_basis.decision_requirements:
                        raise BlockedDecision("COOPERATION_ENTRY_SOURCE_RIGHTS_NOT_QUALIFIED")
                    self.context_basis.assert_original_decision_rights(ev, at)
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
                    if not self.context_basis.decision_requirements:
                        raise BlockedDecision("COOPERATION_MEMBERSHIP_SOURCE_RIGHTS_NOT_QUALIFIED")
                    self.context_basis.assert_original_decision_rights(ev, at)
                    self.context_basis.assert_original_decision_lineage(
                        self.trace, action, ev.get("change_id"), at
                    )
                if ev.get("org_revision") != self.institution.revision:
                    raise BlockedDecision("STALE_ORGANIZATIONAL_CODE")
                try:
                    competition_selection = qualify_competing_coalition_selection(
                        self, ev, at
                    )
                    revised, membership_evidence = apply_cooperation_membership_revision(
                        ev, self.cooperation_links, self.subjects, self.works,
                        self.trace, org_revision=self.institution.revision, at=at,
                        require_entry_assessment=bool(
                            self.formation_policy is not None
                            and self.formation_policy.design.enforce_model_result_conditioned_interests
                        ),
                    )
                    if competition_selection is not None:
                        membership_evidence.update(competition_selection)
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
                if action == "commit":
                    try:
                        active_coalition_commit_evidence = (
                            qualify_active_coalition_original_commit(self, work, at)
                        )
                    except CooperationInputError as exc:
                        raise BlockedDecision(str(exc)) from exc
                work_evidence = self._work_action(work, ev, at)
                if action == "commit":
                    technology_route_evidence = work_evidence
            report = {"at": at, "action": action, "outcome": "APPLIED", "reason": "NONE", "org_revision": self.institution.revision}
        except (BlockedDecision, ContextBlocked, MaterialBlocked, AssuranceBlocked,
                OrgCodeBlocked, CapabilityBlocked, TechnologyRouteBlocked,
                RegistrationBlocked, AffiliationBlocked) as exc:
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
            report["org_code_model_source_edition"] = self.model_org_code_edition
            report["org_code_escalation_is_inquiry_only"] = True
            report["org_code_real_identity_authenticated"] = False
        if action in {"model_code_propose", "model_code_response",
                      "model_code_function_response", "model_code_apply"}:
            report["model_code_change_id"] = ev.get("model_code_change_id")
            report["model_code_change_kind"] = ev.get("model_code_change_kind")
            report["model_code_fingerprint"] = ev.get("model_code_fingerprint")
            report["new_model_edition"] = ev.get("new_model_edition")
            report["expected_model_edition"] = ev.get("expected_model_edition")
            report["model_code_institution_revision_unchanged"] = (
                self.institution.revision == previous_revision
            )
            report["model_code_legal_rights_authenticated"] = False
            if action == "model_code_propose":
                report["proposed_subject"] = ev.get("proposed_subject")
                report["proposed_model_role"] = ev.get("proposed_model_role")
                report["original_cooperation_change_id"] = ev.get(
                    "original_cooperation_change_id"
                )
                report["model_code_source_ref"] = ev.get("model_code_source_ref")
                for name in ("expected_model_roles", "proposed_model_roles",
                             "expected_model_commit_responsible",
                             "proposed_model_commit_responsible",
                             "cooperation_link", "cooperation_source_revision",
                             "pilot_work", "pilot_result_ref", "pilot_decision_at"):
                    if name in ev:
                        report[name] = ev[name]
            if action in {"model_code_response", "model_code_function_response"}:
                report["model_code_decision"] = ev.get("model_code_decision")
                report["model_code_decision_source_ref"] = ev.get(
                    "model_code_decision_source_ref"
                )
            if action == "model_code_apply" and report["outcome"] == "APPLIED":
                report["model_code_current_source_edition"] = (
                    self.model_org_code_edition
                )
                report["model_code_all_thirteen_source_records_requalified"] = True
                report["model_code_function_change_applied"] = (
                    proposal["model_code_change_kind"]
                    == "REASSIGN_EXISTING_MODEL_FUNCTIONS"
                ) if "model_code_change_kind" in proposal else False
                report["original_resources_and_work_principals_preserved"] = True
                report["historical_accepted_results_and_consents_preserved"] = True
                report["new_entrant_independent_work_consent_still_required"] = True
        if action.startswith(("subject_registration_", "resource_registration_")):
            report["source_rights_ref"] = ev.get("source_rights_ref")
            for name in DECISION_SOURCE_FIELDS.get(action, ()):
                if name in ev:
                    report[name] = ev[name]
            report["subject_registration_id"] = ev.get("subject_registration_id")
            report["resource_registration_id"] = ev.get("resource_registration_id")
            report["registration_fingerprint"] = ev.get("registration_fingerprint")
            report["resource_fingerprint"] = ev.get("resource_fingerprint")
            report["registration_decision"] = ev.get("registration_decision")
            report["registration_model_source_not_authenticated_rights"] = True
            if registration_evidence is not None and report["outcome"] == "APPLIED":
                report.update(registration_evidence)
        if action in {"technology_route_propose", "technology_route_response"}:
            if "source_rights_ref" in ev:
                report["source_rights_ref"] = ev["source_rights_ref"]
            report["technology_route_id"] = ev.get("technology_route_id")
            report["technology_route_fingerprint"] = ev.get(
                "technology_route_fingerprint"
            )
            report["technology_route_source_authentication"] = (
                "MODEL_ONLY_DECLARED_UNVERIFIED"
            )
            report["technology_route_not_work_or_resource_permission"] = True
            if action == "technology_route_propose" and report["outcome"] == "APPLIED":
                report.update(technology_route_evidence)
                report["technology_route_work"] = ev["technology_route_work"]
                report["technology_route_valid_until"] = ev["technology_route_valid_until"]
                report["technology_route_source_ref"] = ev["technology_route_source_ref"]
                report["pilot_work"] = ev["pilot_work"]
                report["pilot_result_ref"] = ev["pilot_result_ref"]
                report["cooperation_link"] = ev["cooperation_link"]
                report["cooperation_source_revision"] = ev["cooperation_source_revision"]
                report["technology_route_model_code_change_id"] = ev[
                    "technology_route_model_code_change_id"
                ]
                report["model_org_edition"] = self.model_org_code_edition
            if action == "technology_route_response" and report["outcome"] == "APPLIED":
                report["technology_route_decision"] = ev["technology_route_decision"]
                report["technology_route_decision_source_ref"] = ev[
                    "technology_route_decision_source_ref"
                ]
                # Associate this original consultation with its SOURCE-SCOPED
                # coalition for observable transaction-coordination exposure.
                # No financial cost or additional cooperative membership.
                route_proposal = next(
                    row for row in self.trace
                    if row.get("action") == "technology_route_propose"
                    and row.get("outcome") == "APPLIED"
                    and row.get("technology_route_id") == ev["technology_route_id"]
                )
                report["cooperation_link"] = route_proposal["cooperation_link"]
                report["cooperation_source_revision"] = route_proposal[
                    "cooperation_source_revision"
                ]
        if (action in {"technology_route_response", "consent"} and report["outcome"] == "APPLIED"
                and "technology_route_commercial_fingerprint" in ev):
            report["technology_route_commercial_fingerprint"] = ev["technology_route_commercial_fingerprint"]
        if action == "commit" and report["outcome"] == "APPLIED" and technology_route_evidence:
            report.update(technology_route_evidence)
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
        if action in {"coalition_options_propose", "coalition_option_assess"}:
            report["coalition_competition_id"] = ev.get("coalition_competition_id")
            report["coalition_comparison_fingerprint"] = ev.get(
                "coalition_comparison_fingerprint"
            )
            report["coalition_model_choice_not_a_contract_or_obligation"] = True
            if report["outcome"] == "APPLIED":
                report.update(coalition_competition_evidence)
        if action in {
            "active_coalition_portfolio_propose",
            "active_coalition_portfolio_assess",
        } and report["outcome"] == "APPLIED":
            report.update(active_coalition_evidence)
            report["active_coalition_evaluation_not_original_consent"] = True
        if (action == "commit" and report["outcome"] == "APPLIED"
                and active_coalition_commit_evidence is not None):
            report.update(active_coalition_commit_evidence)
        if action in {
            "cooperation_lifecycle_propose", "cooperation_lifecycle_response",
            "cooperation_lifecycle_apply",
        }:
            report["source_rights_ref"] = ev.get("source_rights_ref")
            for name in DECISION_SOURCE_FIELDS.get(action, ()):
                if name in ev:
                    report[name] = ev[name]
            if action == "cooperation_lifecycle_apply" and "new_link_source_ref" in ev:
                report["new_link_source_ref"] = ev["new_link_source_ref"]
            report["lifecycle_id"] = ev.get("lifecycle_id")
            report["lifecycle_kind"] = ev.get("lifecycle_kind")
            report["cooperation_link"] = ev.get("cooperation_link")
            report["cooperation_source_revision"] = ev.get(
                "cooperation_source_revision"
            )
            report["lifecycle_fingerprint"] = ev.get(
                "lifecycle_fingerprint"
            )
            if report["outcome"] == "APPLIED":
                report.update(lifecycle_evidence)
                report["lifecycle_model_only_not_legal_dissolution"] = True
        if action in {
            "cooperation_change_propose", "cooperation_change_response",
            "cooperation_entry_assess", "cooperation_membership_apply",
        }:
            # Preserve actual submitted source rights in the original trace,
            # so APPLY can recheck the very same earlier owner decisions.
            report["source_rights_ref"] = ev.get("source_rights_ref")
            report["change_id"] = ev.get("change_id")
            for field in DECISION_SOURCE_FIELDS.get(action, ()):
                report[field] = ev.get(field)
        if action in {
            "affiliation_transfer_propose", "affiliation_transfer_review",
            "affiliation_transfer_apply",
        }:
            report["source_rights_ref"] = ev.get("source_rights_ref")
            report["affiliation_transfer_id"] = ev.get(
                "affiliation_transfer_id"
            )
            report["transfer_fingerprint"] = ev.get(
                "transfer_fingerprint"
            )
            for field in DECISION_SOURCE_FIELDS.get(action, ()):
                report[field] = ev.get(field)
            if affiliation_evidence is not None and report["outcome"] == "APPLIED":
                report.update(affiliation_evidence)
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
                if any(field in ev for field in (
                    "pilot_work", "pilot_result_ref", "pilot_decision_at"
                )):
                    # An old-format optional original pilot witness must
                    # survive in the same trace. Its truth is independently
                    # checked at competition / later membership application;
                    # an operator claim alone never proves the Result.
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
            if ("evaluation_economic_source_revision" in ev
                    or "evaluation_economic_outside_basis" in ev):
                report["evaluation_economic_basis_status"] = "UNKNOWN"
                report["evaluation_economic_basis_kind"] = (
                    "OWN_EXECUTED_OUTSIDE_ALTERNATIVE"
                    if "evaluation_economic_outside_basis" in ev
                    else "OWN_RELATION_PILOT"
                )
                revision = ev.get("evaluation_economic_source_revision")
                if isinstance(revision, str) and 0 < len(revision) <= 128:
                    report["evaluation_economic_source_revision"] = revision
                report["evaluation_financial_basis_not_automatic_owner_decision"] = True
                report["evaluation_financial_basis_is_not_bank_payment"] = True
                report["evaluation_private_financial_values_not_redisclosed"] = True
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
        if action == "role_state_update":
            report["role_target"] = ev.get("role_target")
            report["role_previous_revision"] = ev.get("role_expected_revision")
            report["role_new_revision"] = ev.get("role_new_revision")
            report["role_new_state"] = ev.get("role_new_state")
            report["role_management_source_ref"] = ev.get(
                "role_management_source_ref"
            )
            report["historical_Work_Result_not_rewritten"] = True
            report["role_owner_control_not_operator_delegation"] = True
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
                    if "preparation_mode" in ev:
                        from .process_preparation import model_preparation_activity
                        report["model_preparation_activity"] = model_preparation_activity(
                            self, self.works[work_ref], ev["preparation_mode"],
                            preparation_pattern_evidence["operation"]
                            if preparation_pattern_evidence is not None else None)
                    if preparation_pattern_evidence is not None:
                        report["model_preparation_pattern"] = preparation_pattern_evidence
                    if preparation_economic_choice is not None:
                        report["model_preparation_economic_choice"] = preparation_economic_choice
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
        if action in {"outside_demand_signal", "outside_demand_withdraw",
                       "outside_supplier_offer",
                       "outside_buyer_offer_response"} and (
                report["outcome"] == "APPLIED"):
            report.update(outside_demand_evidence)
            report["original_trace_buyer_or_supplier_model_evidence_only"] = True
            if action in {"outside_demand_signal", "outside_demand_withdraw"}:
                report["original_trace_buyer_model_signal_only"] = True
            report["outside_work_or_money_not_created"] = True
        self.trace.append(report)
        return report

    def _update_original_extended_role(self, ev: dict[str, Any],
                                       at: int) -> None:
        """Owner-initiated fresh role edition, not second IAM or delegation.

        A suspended actor withdraws its own FUTURE availability. Restoration
        and active requalification require the current self-role and mandate
        or context source at the freshly applied edition. The original owner
        alone changes its original role, with compare-and-set source updates.
        """
        name = ev.get("role_target")
        actor = ev.get("actor")
        if not isinstance(name, str) or actor != name or name not in self.subjects:
            raise BlockedDecision("ROLE_UPDATE_INDEPENDENT_ACTOR_REQUIRED")
        subject = self.subjects[name]
        kind = subject.kind
        types = {"SECTOR_BODY", "PUBLIC_INSTITUTION", "NATURAL_PERSON"}
        if kind not in types:
            raise BlockedDecision("ROLE_UPDATE_ORIGINAL_EXTENDED_ACTOR_REQUIRED")
        basis = self.context_basis
        if basis is None or not basis.strict:
            raise BlockedDecision("ROLE_UPDATE_ORIGINAL_STRICT_KPB_REQUIRED")
        old = ev.get("role_expected_revision")
        new = ev.get("role_new_revision")
        if (not isinstance(old, str)
                or old != subject.role_source_revision):
            raise BlockedDecision("ROLE_UPDATE_STALE_ORIGINAL_EDITION")
        if (not isinstance(new, str) or not new.strip() or len(new) > 128
                or new in subject.role_revision_history):
            raise BlockedDecision("ROLE_UPDATE_FRESH_EDITION_REQUIRED")
        state = ev.get("role_new_state")
        if not isinstance(state, str) or state not in {"ACTIVE", "SUSPENDED"}:
            raise BlockedDecision("ROLE_UPDATE_STATE_INVALID")
        if state == "SUSPENDED" and not subject.active:
            raise BlockedDecision("ROLE_UPDATE_ALREADY_SUSPENDED")
        if (ev.get("role_management_source_ref") is None
                or ev["role_management_source_ref"] !=
                    subject.role_management_source_ref):
            raise BlockedDecision("ROLE_UPDATE_OWN_MANAGEMENT_SOURCE_REQUIRED")
        core = ("personal" if kind == "NATURAL_PERSON"
                else "institutional")
        basis.assert_original_form_role_source(
            name, subject.role_management_source_ref, new,
            core=core, purpose="AKIS_ROLE_MANAGEMENT",
            operation="EXECUTE", recipients={name}, at=at,
        )
        if state == "ACTIVE":
            purposes = {
                "SECTOR_BODY": ("AKIS_SECTOR_ROLE", "AKIS_SECTOR_STANDARD"),
                "PUBLIC_INSTITUTION": ("AKIS_PUBLIC_ROLE", "AKIS_PUBLIC_MANDATE"),
                "NATURAL_PERSON": ("AKIS_PERSON_ROLE",
                                   "AKIS_PERSON_CONTEXT_ACCESS"),
            }
            self_purpose, scope_purpose = purposes[kind]
            basis.assert_original_form_role_source(
                name, subject.self_role_source_ref, new,
                core=core, purpose=self_purpose,
                operation="ACCEPT", recipients={name}, at=at,
            )
            scope_ref = (subject.context_source_ref
                         if kind == "NATURAL_PERSON"
                         else subject.mandate_source_ref)
            basis.assert_original_form_role_source(
                name, scope_ref, new, core=core, purpose=scope_purpose,
                operation="SHARE", recipients={name}, at=at,
            )
        # All source and state checks above are complete before mutations.
        subject.active = state == "ACTIVE"
        subject.role_source_revision = new
        subject.role_revision_history += (new,)
        # A role edition change cannot silently carry pending authorization
        # and old consents into a newly requalified future obligation.
        for work in self.works.values():
            if work.obligation != "NOT_ACCEPTED":
                continue
            principals = (
                self.capacity_ledger.original_owners(work.resource_requirements)
                | {work.customer}
            )
            if name in principals:
                work.consents.clear()
                work.admitted = False
                work.authorization_org_revision = None

    def _guard_original_form_role_work(self, work: Work, at: int) -> None:
        """Constrain original new Work, without granting new actor authority.

        Existing intra Work and R1-V2B sector/public/person Work use this ONE
        original gate. Rights of extended actors are checked in the ORIGINAL
        ContextBasis with owner-managed revisions, purpose, recipients and
        validity. Accepted obligations are never re-authorized here.
        """
        principals = (
            self.capacity_ledger.original_owners(work.resource_requirements)
            | {work.customer}
        )
        intra = any(self.subjects[p].kind in {"DIVISION", "EMPLOYEE"}
                    for p in principals)
        special = {
            p for p in principals
            if self.subjects[p].kind in {
                "SECTOR_BODY", "PUBLIC_INSTITUTION", "NATURAL_PERSON",
            }
        }
        if not intra and not special:
            return
        policy = self.formation_policy
        config = (policy.design.configuration
                  if policy is not None and
                  policy.design.enforce_model_author_configuration_work_scope
                  else None)
        if intra and config != "intra":
            raise BlockedDecision(
                "INTRAFIRM_ORIGINAL_ROLE_REQUIRES_SELECTED_FORM_GATE"
            )
        if intra:
            for name in sorted(principals):
                party = self.subjects[name]
                if (party.kind not in {"DIVISION", "EMPLOYEE"}
                        or not party.affiliation_history):
                    continue
                # Work after a transfer must recheck the newly accountable
                # enterprise's ORIGINAL source and revision in the same KPB.
                if self.context_basis is None or not self.context_basis.strict:
                    raise BlockedDecision(
                        "AFFILIATION_FUTURE_WORK_STRICT_KPB_REQUIRED"
                    )
                self.context_basis.assert_original_form_role_source(
                    party.organization,
                    party.affiliation_source_ref,
                    party.affiliation_source_revision,
                    core="corporate",
                    # Transfer approval is not Work permission. The
                    # enterprise must separately permit this role to use the
                    # parent-owned source for a later original Work.
                    purpose="AKIS_INTRA_WORK",
                    operation="SHARE",
                    recipients={name},
                    at=at,
                )
        expected = {
            "SECTOR_BODY": "sector", "PUBLIC_INSTITUTION": "macro",
            "NATURAL_PERSON": "trace",
        }
        if special and (len({expected[self.subjects[p].kind] for p in special}) != 1
                        or config not in {
                            expected[self.subjects[p].kind] for p in special
                        }):
            raise BlockedDecision(
                "AUTHOR_EXTENDED_ROLE_REQUIRES_OWN_SELECTED_FORM"
            )
        if special:
            basis = self.context_basis
            if basis is None or not basis.strict:
                raise BlockedDecision(
                    "AUTHOR_EXTENDED_ROLE_ORIGINAL_STRICT_KPB_REQUIRED"
                )
            for name in sorted(special):
                actor = self.subjects[name]
                root = ("personal" if actor.kind == "NATURAL_PERSON"
                        else "institutional")
                role_purpose = {
                    "SECTOR_BODY": "AKIS_SECTOR_ROLE",
                    "PUBLIC_INSTITUTION": "AKIS_PUBLIC_ROLE",
                    "NATURAL_PERSON": "AKIS_PERSON_ROLE",
                }[actor.kind]
                scope_purpose = {
                    "SECTOR_BODY": "AKIS_SECTOR_STANDARD",
                    "PUBLIC_INSTITUTION": "AKIS_PUBLIC_MANDATE",
                    "NATURAL_PERSON": "AKIS_PERSON_CONTEXT_ACCESS",
                }[actor.kind]
                basis.assert_original_form_role_source(
                    name, actor.self_role_source_ref, actor.role_source_revision,
                    core=root, purpose=role_purpose, operation="ACCEPT",
                    recipients={name}, at=at,
                )
                if actor.role_management_source_ref is not None:
                    basis.assert_original_form_role_source(
                        name, actor.role_management_source_ref,
                        actor.role_source_revision, core=root,
                        purpose="AKIS_ROLE_MANAGEMENT", operation="EXECUTE",
                        recipients={name}, at=at,
                    )
                scope_ref = (actor.context_source_ref
                             if actor.kind == "NATURAL_PERSON"
                             else actor.mandate_source_ref)
                basis.assert_original_form_role_source(
                    name, scope_ref, actor.role_source_revision,
                    core=root, purpose=scope_purpose, operation="SHARE",
                    recipients=principals, at=at,
                )

    def _request_work(self, ev: dict[str, Any], at: int) -> dict[str, Any] | None:
        spec = ev.get("work_spec")
        if isinstance(spec, dict):
            # A source-declared future asset is not an original asset until
            # its independently approved registration actually APPLIES.
            resources = {spec.get("resource")}
            for need in spec.get("resource_requirements", []):
                if isinstance(need, dict):
                    resources.add(need.get("resource"))
            for op in spec.get("operations", []):
                if isinstance(op, dict):
                    resources.add(op.get("primary_resource"))
                    for need in op.get("resource_requirements", []):
                        if isinstance(need, dict):
                            resources.add(need.get("resource"))
            if any(x not in self.resources for x in resources):
                raise BlockedDecision(
                    "ORIGINAL_NEW_RESOURCE_REGISTRATION_MUST_PRECEDE_WORK"
                )
            if spec.get("customer") not in self.subjects:
                raise BlockedDecision(
                    "ORIGINAL_NEW_SUBJECT_REGISTRATION_MUST_PRECEDE_WORK"
                )
        try:
            work = self._parse_work(spec)
        except InputError as exc:
            # Initial validation of a future registered resource was
            # intentionally deferred, never waived. A malformed future
            # original request must be a BLOCKED decision, not a crash
            # after the earlier enterprise/resource registrations.
            raise BlockedDecision(
                "ORIGINAL_FUTURE_WORK_DECLARATION_INVALID:" + str(exc)
            ) from exc
        self._guard_original_form_role_work(work, at)
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
        technology_route_evidence = qualify_original_technology_route_request(
            self, ev, work, at
        )
        outside_work_evidence = None
        if "outside_work_origin" in ev:
            if ev.get("cooperation_link") is not None:
                raise BlockedDecision("OUTSIDE_WORK_NOT_PART_OF_COMPARISON_COOPERATION")
            try:
                origin = qualify_original_outside_work_origin(
                    self, work, ev["outside_work_origin"], at
                )
            except OutsideDemandBlocked as exc:
                raise BlockedDecision(str(exc)) from exc
            outside_work_evidence = {
                "outside_work_origin": origin,
                "outside_origin_does_not_create_legal_consent": True,
            }
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
        return {
            **(linked_change_evidence or {}),
            **(technology_route_evidence or {}),
            **(outside_work_evidence or {}),
        } or None

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
        role_form = {
            "DIVISION": "intra", "EMPLOYEE": "intra",
            "SECTOR_BODY": "sector", "PUBLIC_INSTITUTION": "macro",
            "NATURAL_PERSON": "trace",
        }
        current_form = (
            self.formation_policy.design.configuration
            if self.formation_policy is not None
            and self.formation_policy.design.enforce_model_author_configuration_work_scope
            else None
        )
        role_kind = self.subjects[actor].kind
        if role_kind != "SME" and (
                role_kind not in role_form
                or current_form is None
                or role_form[role_kind] != current_form):
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
            if original_cooperation_dissolved_for_future(self.trace, link):
                raise BlockedDecision("COOPERATION_RELATION_DISSOLVED_FOR_FUTURE_WORK")
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

    def _work_action(self, w: Work, ev: dict[str, Any], at: int) -> dict[str, Any] | None:
        a = ev["action"]
        actor = ev["actor"]
        if a in {"offer", "authorize", "consent", "commit"}:
            self._guard_original_form_role_work(w, at)
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
            qualify_original_route_commercial_consent(self, w, ev, at)
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
            route_market = qualify_original_technology_route_commit(self, w, ev, at)
            # Preserve the original request's lineage and qualify it again
            # before the existing reservation or commitment can take effect.
            origin = next((
                row["outside_work_origin"] for row in self.trace
                if row.get("action") == "request"
                and row.get("outcome") == "APPLIED"
                and row.get("work") == w.key
                and "outside_work_origin" in row
            ), None)
            if origin is not None:
                try:
                    qualify_original_outside_work_origin(self, w, origin, at)
                except OutsideDemandBlocked as exc:
                    raise BlockedDecision(str(exc)) from exc
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
            w.affiliation_at_commit = {
                principal: self.subjects[principal].organization
                for principal in sorted(required)
                if self.subjects[principal].kind in {
                    "DIVISION", "EMPLOYEE",
                }
            }
            w.commitment_org_revision = self.institution.revision
            if w.operations:
                for res in operation_reservations(w.key, w.operations):
                    self.allocations.append((res.resource, w.key, res.start, res.end))
            else:
                for need in w.resource_requirements:
                    self.allocations.append((need.resource, w.key, w.slot_start, w.slot_end))
            return route_market
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
            "subjects": {
                k: {
                    "kind": v.kind,
                    "active_for_new_work": v.active,
                    **({
                        "original_enterprise": v.organization,
                        "affiliation_transition_history": [
                            {"from_enterprise": old, "to_enterprise": new,
                             "applied_at": at}
                            for old, new, at in v.affiliation_history
                        ],
                        **({"current_affiliation_source_revision":
                            v.affiliation_source_revision}
                           if v.affiliation_history else {}),
                        "model_source_scoped_role_declarations": bool(
                            v.affiliation_source_ref and v.self_role_source_ref
                        ),
                        "real_identity_or_employment_verified": False,
                    } if v.kind in {"DIVISION", "EMPLOYEE"} else {}),
                    **({
                        "separate_original_actor_source_declarations": bool(
                            v.self_role_source_ref and (
                                v.mandate_source_ref or v.context_source_ref
                            )
                        ),
                        "real_person_or_institutional_mandate_authenticated": False,
                        "original_role_source_revision": v.role_source_revision,
                        "original_role_edition_history": list(
                            v.role_revision_history
                        ),
                        "self_controllable_role_management_source": bool(
                            v.role_management_source_ref
                        ),
                    } if v.kind in {
                        "SECTOR_BODY", "PUBLIC_INSTITUTION", "NATURAL_PERSON",
                    } else {}),
                }
                for k, v in sorted(self.subjects.items())
            },
            "resources": {k: {"owner": owner, "availability": self.resource_availability[k], "basis": self.resource_availability_origin[k]} for k, owner in sorted(self.resources.items())},
            "works": {k: {"proposal": w.proposal, "requested_by": w.requester, "requested_at": w.request_at, "authorized": w.admitted, "authorization_org_revision": w.authorization_org_revision, "obligation": w.obligation, "execution": w.execution, "result": w.result, "original_customer": w.customer, "resource_owner": self.resources[w.resource], "source_revision": w.source_revision, "commitment_org_revision": w.commitment_org_revision, "result_ref": w.result_ref, "consenting_principals": sorted(w.consents)} for k, w in sorted(self.works.items())},
            "trace": list(self.trace),
            "counts": {"applied": sum(e["outcome"] == "APPLIED" for e in self.trace), "blocked": sum(e["outcome"] == "BLOCKED" for e in self.trace)},
        }
        for key, work in self.works.items():
            if work.affiliation_at_commit:
                output["works"][key]["original_affiliation_at_commit"] = dict(
                    sorted(work.affiliation_at_commit.items())
                )
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
