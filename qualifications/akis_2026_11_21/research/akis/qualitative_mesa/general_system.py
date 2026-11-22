"""Nine-component AKIS scientific projection over the ONE original research state.

Author's morphology, 6 configurations, 13 organizational code elements, and
8 phases are loaded from the already curated doctoral concept map. Source
claims are not permissions, authentic identities, legal approvals or Results.
No separate scheduler, storage, agreement, organization or agent is created.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Mapping

from .configuration_behavior import configuration_dynamics
from .scope_policy import source_link_status, OPERATIONS as CONTEXT_OPERATIONS
from .process_preparation import perform_bounded_process_step


class GeneralSystemInputError(ValueError):
    """Invalid scientific assertion, not a real organizational outcome."""


CATALOG_PATH = (Path(__file__).resolve().parents[3] /
                "architecture/tiers/IWXA_AKIS_AUTHOR_CONCEPT_MAP_2026_11_19.json")
COMPONENTS = ("Ц", "У", "А", "П", "КПБ", "ОК", "КЖ", "Э", "ЖЦ")
CORES = ("personal", "corporate", "operator", "institutional")
OBJECTIVES = frozenset({"COST", "REVENUE", "TRANSACTION_COST", "QUALITY", "TIME", "RISK",
                        "RESILIENCE", "COMPETENCE", "AUTONOMY", "MARKET_ACCESS"})
OPERATIONS = frozenset({"READ", "DERIVE", "SHARE", "PUBLISH", "ACCEPT", "EXECUTE"})
AGENT_FUNCTIONS = frozenset({"RECOMMEND", "PREPARE", "CHECK", "REQUEST_APPROVAL", "EXECUTE"})
SOURCE_FIELDS = frozenset({"owner", "source_ref", "revision", "available_at", "expires_at"})
MAX_DECLARATIONS = 512  # total across all five groups
# Explicitly scoped source use is a scientific MODEL_ONLY claim, not IAM.
FUNCTION_SCOPE_OPERATIONS = {
    'RECOMMEND': 'DERIVE', 'PREPARE': 'DERIVE',
    'CHECK': 'READ', 'REQUEST_APPROVAL': 'SHARE', 'EXECUTE': 'EXECUTE',
}


def author_catalog() -> Mapping[str, Any]:
    with CATALOG_PATH.open(encoding="utf-8") as handle:
        catalog = json.load(handle)
    if catalog.get("schema") != "IWXA_AKIS_AUTHOR_CONCEPT_MAP/0.1":
        raise GeneralSystemInputError("AUTHOR_CONCEPT_MAP_NOT_QUALIFIED")
    return catalog


def _s(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 160:
        raise GeneralSystemInputError("INVALID_GENERAL_" + field)
    return value


def _set(raw: Any, expected: set[str], field: str) -> None:
    if not isinstance(raw, dict) or set(raw) != expected:
        raise GeneralSystemInputError("INVALID_GENERAL_" + field + "_FIELDS")


def _owner_source(record: Mapping[str, Any], subjects: Mapping[str, Any]) -> None:
    owner = _s(record["owner"], "OWNER")
    if owner not in subjects:
        raise GeneralSystemInputError("GENERAL_OWNER_UNKNOWN")
    source = _s(record["source_ref"], "SOURCE")
    if not source.startswith(f"model://{owner}/") or len(source) <= len(f"model://{owner}/"):
        raise GeneralSystemInputError("GENERAL_SOURCE_OWNER_MISMATCH")
    _s(record["revision"], "REVISION")
    start, end = record["available_at"], record["expires_at"]
    if (type(start) is not int or type(end) is not int or
            start < 0 or end <= start or end > 10000):
        raise GeneralSystemInputError("GENERAL_SOURCE_TIME_INVALID")


@dataclass(frozen=True)
class GeneralSystemDesign:
    configuration: str
    morphology: Mapping[str, str]
    declarations: Mapping[str, tuple[Mapping[str, Any], ...]]
    catalog: Mapping[str, Any]
    enforce_model_org_code: bool = False
    enforce_model_formation_phases: bool = False

    @property
    def source_times(self) -> tuple[int, ...]:
        return tuple(sorted({t for rows in self.declarations.values() for row in rows
                             for t in (row["available_at"], row["expires_at"])}))



class ModelFormationPolicy:
    """R1-I: opt-in phase 1-3 prerequisite gates, using ONLY original trace.

    Original principals must source and confirm each step. No phase assertion
    is a legal signature, new governance engine, or completion of all 8 phases.
    """

    def __init__(self, design: GeneralSystemDesign):
        self.design = design

    def _source_active(self, phase: int, owner: str, ref: str,
                       revision: str, at: int) -> bool:
        return any(
            row["phase"] == phase and row["owner"] == owner and
            row["source_ref"] == ref and row["revision"] == revision and
            row["available_at"] <= at < row["expires_at"]
            for row in self.design.declarations["formation_phases"]
        )

    @staticmethod
    def _resource_owners(state: Any, work: Any) -> set[str]:
        return set(state.capacity_ledger.original_owners(work.resource_requirements))

    def _ack_status(self, state: Any, work: Any, phase: int, owner: str,
                    at: int) -> str:
        history = [
            event for event in state.trace
            if event.get("outcome") == "APPLIED" and
            event.get("action") == "formation_confirm" and
            event.get("work") == work.key and event.get("phase") == phase and
            event.get("actor") == owner and
            event.get("org_revision") == state.institution.revision and
            event.get("work_source_revision") == work.source_revision and
            type(event.get("at")) is int and event["at"] < at
        ]
        if not history:
            return "FORMATION_PRIOR_OWNER_PHASE_CONFIRMATION_MISSING"
        if not any(
            self._source_active(phase, owner, row.get("formation_source_ref"),
                                state.institution.revision, at)
            for row in history
        ):
            return "FORMATION_ORIGINAL_PHASE_SOURCE_STALE_OR_EXPIRED"
        return "NONE"

    def _resources_ready(self, state: Any, work: Any) -> bool:
        return bool(work.resource_requirements) and all(
            getattr(state.capacity_ledger.specs.get(need.resource),
                    "basis", None) == "MODEL_DECLARED" and
            state.resource_availability_origin.get(need.resource) == "MODEL_INPUT" and
            state.resource_availability.get(need.resource) == "AVAILABLE"
            for need in work.resource_requirements
        )

    def confirm(self, state: Any, event: Mapping[str, Any], at: int) -> str:
        phase, key, actor = event.get("phase"), event.get("work"), event.get("actor")
        if type(phase) is not int or phase not in (1, 2, 3):
            return "FORMATION_ONLY_FIRST_THREE_PHASES_EXECUTABLE"
        work = state.works.get(key)
        if work is None:
            return "FORMATION_ORIGINAL_WORK_REQUIRED"
        if work.obligation != "NOT_ACCEPTED":
            return "FORMATION_CANNOT_REWRITE_ACCEPTED_OBLIGATION"
        if event.get("org_revision") != state.institution.revision:
            return "FORMATION_ORIGINAL_ORG_REVISION_MISMATCH"
        if actor not in state.subjects or not state.subjects[actor].active:
            return "FORMATION_ORIGINAL_ACTIVE_PRINCIPAL_REQUIRED"
        expected = {work.customer} if phase in (1, 2) else self._resource_owners(state, work)
        if actor not in expected:
            return "FORMATION_WRONG_ORIGINAL_PHASE_OWNER"
        if not self._source_active(phase, actor, event.get("formation_source_ref"),
                                   state.institution.revision, at):
            return "FORMATION_ORIGINAL_OWNER_PHASE_SOURCE_MISSING"
        if self._ack_status(state, work, phase, actor, at) == "NONE":
            return "FORMATION_DUPLICATE_LIVE_PHASE_CONFIRMATION"
        if phase == 1:
            requests = [
                row for row in state.trace
                if row.get("action") == "request" and
                row.get("outcome") == "APPLIED" and
                row.get("work") == key and
                row.get("actor") == work.customer and
                type(row.get("at")) is int and row["at"] < at
            ]
            if not any(
                goal["owner"] == work.customer and goal["work"] == key and
                goal["work_revision"] == work.source_revision and
                goal["revision"] == request.get("org_revision") and
                goal["available_at"] <= request["at"] < goal["expires_at"]
                for request in requests
                for goal in self.design.declarations["goals"]
            ):
                return "FORMATION_GOAL_AND_ORIGINAL_CUSTOMER_REQUEST_NOT_LINKED"
        if phase == 2:
            if self._ack_status(state, work, 1, work.customer, at) != "NONE":
                return "FORMATION_FIRST_PHASE_NOT_QUALIFIED"
            if not work.resource_requirements:
                return "FORMATION_ORIGINAL_WORK_PROCESS_NOT_SELECTED"
        if phase == 3:
            if self._ack_status(state, work, 2, work.customer, at) != "NONE":
                return "FORMATION_SECOND_PHASE_NOT_QUALIFIED"
            if not self._resources_ready(state, work):
                return "FORMATION_ORIGINAL_RESOURCE_CAPACITY_NOT_DECLARED_READY"
        return "NONE"

    def before_commit(self, state: Any, work: Any, at: int) -> str:
        for phase, owners in (
            (1, {work.customer}), (2, {work.customer}),
            (3, self._resource_owners(state, work))
        ):
            for owner in sorted(owners):
                reason = self._ack_status(state, work, phase, owner, at)
                if reason != "NONE":
                    return reason
        if not self._resources_ready(state, work):
            return "FORMATION_ORIGINAL_RESOURCE_CAPACITY_NOT_DECLARED_READY"
        return "NONE"


def parse_general_system(raw: Any, subjects: Mapping[str, Any],
                         known_works: Mapping[str, Any],
                         *, catalog: Mapping[str, Any] | None = None) -> GeneralSystemDesign:
    """Bind source-declared theoretical parameters to original subject/work keys."""
    cat = author_catalog() if catalog is None else catalog
    required = {"configuration", "morphology", "goals", "organizational_code",
                "formation_phases", "context_cores", "agent_functions"}
    if (not isinstance(raw, dict) or not required <= set(raw) or
            set(raw) - required - {"enforce_model_org_code", "enforce_model_formation_phases"}):
        raise GeneralSystemInputError("INVALID_GENERAL_DESIGN_FIELDS")
    enforce_model_code = raw.get("enforce_model_org_code", False)
    if type(enforce_model_code) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_OC_ENFORCEMENT_MUST_BE_BOOLEAN")
    enforce_formation = raw.get("enforce_model_formation_phases", False)
    if type(enforce_formation) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_FORMATION_ENFORCEMENT_MUST_BE_BOOLEAN")
    configurations = {x["id"] for x in cat["taxonomy"]["subject_configurations"]}
    config = _s(raw["configuration"], "CONFIGURATION")
    if config not in configurations:
        raise GeneralSystemInputError("GENERAL_CONFIGURATION_NOT_AUTHOR_DEFINED")
    axes = {x["key"]: set(x["values"]) for x in cat["taxonomy"]["morphological_axes"]}
    morphology = raw["morphology"]
    if not isinstance(morphology, dict) or set(morphology) != set(axes):
        raise GeneralSystemInputError("GENERAL_AUTHOR_MORPHOLOGY_NINE_AXES_REQUIRED")
    if any(value not in axes[key] for key, value in morphology.items()):
        raise GeneralSystemInputError("GENERAL_UNKNOWN_AUTHOR_MORPHOLOGY_VALUE")
    codes = set(cat["taxonomy"]["organizational_code_components"])
    phases = {row["phase"] for row in cat["taxonomy"]["formation_phases"]}
    autonomies = axes["autonomy"]
    schema = {
        "goals": SOURCE_FIELDS | {"work", "work_revision", "objective", "priority"},
        "organizational_code": SOURCE_FIELDS | {"field"},
        "formation_phases": SOURCE_FIELDS | {"phase"},
        "context_cores": SOURCE_FIELDS | {"core", "recipient", "purpose", "operation"},
        "agent_functions": SOURCE_FIELDS | {"id", "work", "work_revision", "autonomy", "action"},
    }
    parsed: dict[str, tuple[Mapping[str, Any], ...]] = {}
    logical_claims: set[tuple[str, str, str, int]] = set()
    total = 0
    for group, fields in schema.items():
        data = raw[group]
        if not isinstance(data, list) or len(data) > MAX_DECLARATIONS:
            raise GeneralSystemInputError("GENERAL_INVALID_" + group.upper() + "_COUNT")
        total += len(data)
        if total > MAX_DECLARATIONS:
            raise GeneralSystemInputError("GENERAL_TOTAL_DECLARATIONS_LIMIT")
        rows = []
        for entry in data:
            optional = (
                {'basis_source', 'basis_revision'} if group == 'context_cores'
                else {'basis_source', 'basis_revision', 'purpose', 'operation'}
                if group == 'agent_functions' else {'control'}
                if group == 'organizational_code' else set()
            )
            if (not isinstance(entry, dict) or fields - set(entry) or
                    set(entry) - fields - optional):
                raise GeneralSystemInputError('INVALID_GENERAL_' + group.upper() + '_FIELDS')
            provided = set(entry) & optional
            if provided and provided != optional:
                raise GeneralSystemInputError('GENERAL_PARTIAL_ORIGINAL_SCOPE_BINDING')
            _owner_source(entry, subjects)
            # One source document may prove several *distinct* concepts. Reject
            # conflicting claims to the same original concept at the same time,
            # not legitimate reuse of the document across different fields.
            locator_field = {"goals": "objective", "organizational_code": "field",
                             "formation_phases": "phase", "context_cores": "core",
                             "agent_functions": "id"}[group]
            locator = str(entry[locator_field])
            if group in {"goals", "agent_functions"}:
                locator += ":" + str(entry["work"])
            logical_key = (group, entry["owner"], locator, entry["available_at"])
            if logical_key in logical_claims:
                raise GeneralSystemInputError("GENERAL_DUPLICATE_LOGICAL_CLAIM")
            logical_claims.add(logical_key)
            row = dict(entry)
            if group in {"goals", "agent_functions"}:
                key = _s(row["work"], "WORK")
                work = known_works.get(key)
                if work is None or row["work_revision"] != work.source_revision:
                    raise GeneralSystemInputError("GENERAL_WORK_SOURCE_MISMATCH")
            if group == "goals":
                if row["objective"] not in OBJECTIVES:
                    raise GeneralSystemInputError("GENERAL_GOAL_TYPE_UNKNOWN")
                if type(row["priority"]) is not int or not 1 <= row["priority"] <= 10:
                    raise GeneralSystemInputError("GENERAL_GOAL_PRIORITY_INVALID")
                if row["owner"] != known_works[row["work"]].customer:
                    raise GeneralSystemInputError("GENERAL_GOAL_ORIGINAL_CUSTOMER_REQUIRED")
            elif group == "organizational_code":
                if row["field"] not in codes:
                    raise GeneralSystemInputError("GENERAL_NOT_AUTHOR_CODE_FIELD")
                if (enforce_model_code and 'control' not in row or
                        not enforce_model_code and 'control' in row):
                    raise GeneralSystemInputError("GENERAL_MODEL_OC_CONTROL_OPT_IN_REQUIRED")
            elif group == "formation_phases":
                if type(row["phase"]) is not int or row["phase"] not in phases:
                    raise GeneralSystemInputError("GENERAL_NOT_AUTHOR_PHASE")
            elif group == "context_cores":
                if row["core"] not in CORES or row["operation"] not in OPERATIONS:
                    raise GeneralSystemInputError("GENERAL_CORE_OR_OPERATION_INVALID")
                if row["recipient"] not in subjects:
                    raise GeneralSystemInputError("GENERAL_RECIPIENT_UNKNOWN")
                _s(row["purpose"], "PURPOSE")
                if 'basis_source' in row:
                    _s(row['basis_source'], 'BASIS_SOURCE')
                    _s(row['basis_revision'], 'BASIS_REVISION')
            else:
                _s(row["id"], "FUNCTION_ID")
                if row["autonomy"] not in autonomies or row["action"] not in AGENT_FUNCTIONS:
                    raise GeneralSystemInputError("GENERAL_AGENT_FUNCTION_INVALID")
                if 'basis_source' in row:
                    _s(row['basis_source'], 'BASIS_SOURCE')
                    _s(row['basis_revision'], 'BASIS_REVISION')
                    _s(row['purpose'], 'PURPOSE')
                    if (row['operation'] not in CONTEXT_OPERATIONS or
                            row['operation'] != FUNCTION_SCOPE_OPERATIONS[row['action']]):
                        raise GeneralSystemInputError('GENERAL_AGENT_ACTION_SCOPE_MISMATCH')
            rows.append(row)
        parsed[group] = tuple(sorted(rows, key=lambda x: (x["available_at"],
                                                                x["owner"], x["source_ref"])))
    return GeneralSystemDesign(config, dict(morphology), parsed, cat,
                               enforce_model_code, enforce_formation)


def general_system_view(design: GeneralSystemDesign, state: Any, *, at: float,
                        economic_status: str = "NOT_IDENTIFIABLE") -> dict[str, Any]:
    """Per-model-time diagnostic of the author's entire form; no rights or effects."""
    valid = {}
    for category, claims in design.declarations.items():
        valid[category] = [row for row in claims
                           if row["available_at"] <= at < row["expires_at"]
                           and row["revision"] == state.institution.revision
                           and (category not in {"goals", "agent_functions"}
                                or (row["work"] in state.works and
                                    state.works[row["work"]].source_revision == row["work_revision"]))]
    model_code = getattr(state, "model_org_policy", None)
    model_code_active = bool(model_code is not None and model_code.active(state, at))
    code_fields = {x["field"] for x in valid["organizational_code"]}
    code_field_owners: dict[str, set[str]] = {}
    for source in valid["organizational_code"]:
        code_field_owners.setdefault(source["field"], set()).add(source["owner"])
    ambiguous_code_fields = sorted(
        field for field, owners in code_field_owners.items() if len(owners) > 1)
    phases = {x["phase"] for x in valid["formation_phases"]}
    formation_attempts = [
        row for row in state.trace if row.get("action") == "formation_confirm"
    ]
    formation_applied = [
        row for row in formation_attempts if row.get("outcome") == "APPLIED"
    ]
    contexts = {x["core"] for x in valid["context_cores"]}
    author_codes = set(design.catalog["taxonomy"]["organizational_code_components"])
    source_counts = {key: len(value) for key, value in valid.items()}
    original_basis = getattr(state, 'context_basis', None)
    # A claimed contextual core must map to one ORIGINAL owner-scoped source
    # in the existing ContextBasis, or remain epistemically unqualified.
    scoped_core_rows = []
    for row in valid['context_cores']:
        status = source_link_status(
            original_basis, source_id=row.get('basis_source'),
            expected_revision=row.get('basis_revision'), original_owner=row['owner'],
            recipient=row['recipient'], core=row['core'], purpose=row['purpose'],
            operation=row['operation'], at=at,
        )
        scoped_core_rows.append((row, status))
    scoped_cores = {
        row['core'] for row, status in scoped_core_rows
        if status == 'MODEL_SOURCE_SCOPE_CONSISTENT'
    }
    # An agent function is still just a source-declared proposal. To qualify
    # even a preparation proposal, both original source and the matching
    # four-core context declaration must be present at this SAME time.
    agent_review = []
    for fn in valid['agent_functions']:
        bound = 'basis_source' in fn
        matches = [
            row for row, status in scoped_core_rows
            if status == 'MODEL_SOURCE_SCOPE_CONSISTENT'
            and row.get('basis_source') == fn.get('basis_source')
            and row.get('basis_revision') == fn.get('basis_revision')
            and row['recipient'] == fn['owner']
            and row['purpose'] == fn.get('purpose')
            and row['operation'] == fn.get('operation')
        ] if bound else []
        if not bound:
            status = 'DECLARED_FUNCTION_WITHOUT_CONTEXT_SOURCE'
        elif not matches:
            status = 'NO_CURRENT_ORIGINAL_CORE_SCOPE_FOR_FUNCTION'
        elif len(matches) > 1:
            status = 'AMBIGUOUS_ORIGINAL_CORE_FOR_FUNCTION'
        elif len(code_fields) != len(author_codes) or ambiguous_code_fields:
            status = 'ORIGINAL_ORGANIZATIONAL_CODE_INCOMPLETE'
        elif fn['action'] == 'EXECUTE':
            status = 'PROGRAM_EXECUTION_REQUIRES_ORIGINAL_AUTHORIZATION'
        else:
            status = 'MODEL_SOURCE_SCOPED_PREPARATION_ONLY'
            if model_code_active:
                model_result = model_code.agent_decision(fn['action'])
                if model_result != 'OC_MODEL_PREPARATION_CANDIDATE_NOT_AUTHORIZED':
                    status = model_result
        agent_review.append({
            'function_id': fn['id'], 'work': fn['work'], 'action': fn['action'],
            'research_review': status, 'real_agent_action_authorized': False,
        })
    proposals = len(state.works)
    applied = [row for row in state.trace if row.get("outcome") == "APPLIED"]
    # Observable transaction *events*, not invented monetary savings.
    oc_attempts = [row for row in state.trace if "model_org_code_review" in row]
    oc_blocked = [row for row in oc_attempts if row.get("outcome") == "BLOCKED"]
    accepted = sum(work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                   for work in state.works.values())
    # Read the SAME original Work requirements and capacity basis rather than
    # treating one well-described resource as sufficient for the entire AKIS.
    required_resources = set()
    for work in state.works.values():
        needs = getattr(work, "resource_requirements", ())
        if needs:
            required_resources.update(need.resource for need in needs)
        elif getattr(work, "resource", None) is not None:
            required_resources.add(work.resource)
    resource_origin = getattr(state, "resource_availability_origin", {})
    capacity_qualified = {key for key in required_resources
                          if key in state.resource_specs
                          and state.resource_specs[key].basis == "MODEL_DECLARED"
                          and resource_origin.get(key) != "LEGACY_FIXTURE_DEFAULT"}
    explicit_capacity = sum(spec.basis == "MODEL_DECLARED"
                            for spec in state.resource_specs.values())
    all_current_resources_qualified = bool(required_resources) and (
        capacity_qualified == required_resources)
    declared_cores = len(contexts)
    # Assessment gates are proposed SCIENTIFIC diagnostics, not legal phase
    # transitions or a modification of the author's original eight phases.
    gates = {
        1: bool(valid["goals"]),
        2: proposals > 0,
        3: all_current_resources_qualified,
        4: original_basis is not None and scoped_cores == set(CORES),
        5: code_fields == author_codes and not ambiguous_code_fields,
        6: any(row['research_review'] == 'MODEL_SOURCE_SCOPED_PREPARATION_ONLY'
               for row in agent_review),
        7: bool(applied),
        8: economic_status == "DECLARED_CONSOLIDATED_ARITHMETIC_ONLY" and accepted > 0,
    }
    phase_rows = []
    prior = True
    for source in design.catalog["taxonomy"]["formation_phases"]:
        phase = source["phase"]
        has_source = phase in phases
        diagnostic = has_source and gates[phase] and prior
        phase_rows.append({"phase": phase, "name": source["name"],
                           "source_declared": has_source,
                           "conditional_diagnostic": "MODEL_SOURCE_CHECK_ONLY" if diagnostic
                           else "NOT_YET_EVIDENCED",
                           "actual_formation_phase_completed": False,
                           "original_model_formation_confirmations": sum(
                               row.get("phase") == phase for row in formation_applied
                           )})
        prior = diagnostic
    missing_code = sorted(author_codes - code_fields)
    missing_cores = sorted(set(CORES) - contexts)
    components = {
        "Ц": {"current_independent_goal_claims": len(valid["goals"]),
              "goal_outcomes_qualified": False},
        "У": {"current_original_subjects": len(state.subjects),
              "active_for_new_work": sum(p.active for p in state.subjects.values()),
              "original_owner_decisions_preserved": True},
        "А": {"declared_agent_functions": len(valid["agent_functions"]),
              "model_source_scoped_preparations": sum(
                  row['research_review'] == 'MODEL_SOURCE_SCOPED_PREPARATION_ONLY'
                  for row in agent_review),
              "autonomous_execution_qualified": False},
        "П": {"original_works": proposals, "accepted_results": accepted,
              "operations_actual_validation": "MODEL_ONLY"},
        "КПБ": {"model_context_cores_declared": declared_cores,
                "missing_cores": missing_cores,
                "model_source_scoped_cores": len(scoped_cores),
                "original_scope_links_current": sum(
                    status == 'MODEL_SOURCE_SCOPE_CONSISTENT'
                    for _, status in scoped_core_rows),
                "authenticated_source_grants": False},
        "ОК": {"org_revision": state.institution.revision,
               "author_fields_current": len(code_fields), "missing_author_fields": missing_code,
               "ambiguous_owner_sources": ambiguous_code_fields,
               "source_claims_not_verified_authorities": True,
               "model_13_control_predicates_active": model_code_active,
               "full_real_organizational_authority": False},
        "КЖ": {"original_applied_events": len(applied),
                "model_org_code_events_observed": len(oc_attempts),
                "model_org_code_new_work_blocked": len(oc_blocked),
                "qualified_real_event_chain": False},
        "Э": {"external_economic_status": economic_status,
              "observed_model_governance_checks": len(oc_attempts),
              "observed_model_governance_blocks": len(oc_blocked),
              "transaction_cost_cash_effect": "NOT_IDENTIFIABLE_NO_TIMED_COST_SOURCE",
              "network_profit_or_causal_effect": "NOT_IDENTIFIABLE"},
        "ЖЦ": {"author_phases_source_declared": len(phases),
                "actual_formational_transitions": "NOT_PROVEN"},
    }
    assert tuple(components) == COMPONENTS
    # Doctoral chapter 3.1 enumerates seven *constitutive* signs. Recorded
    # model intentions are insufficient to qualify a legal/empirical AKIS.
    distinct_principals = False
    for work in state.works.values():
        owners = {work.customer}
        needs = getattr(work, "resource_requirements", ())
        ledger = getattr(state, "capacity_ledger", None)
        if ledger is not None and needs:
            owners.update(ledger.original_owners(needs))
        elif hasattr(work, "resource"):
            resources = getattr(state, "resources", {})
            if work.resource in resources:
                owners.add(resources[work.resource])
        if len(owners) >= 2:
            distinct_principals = True
            break
    constitutive_signs = {
        "inter_subject_cooperative_process": (
            "MODEL_POSSIBLE" if distinct_principals else "NOT_ESTABLISHED"),
        "delegated_program_process_function": "NOT_IMPLEMENTED",
        "context_conditioned_action": (
            "PARTIAL_MODEL_SOURCE_GATE" if state.context_basis is not None
            else "NOT_QUALIFIED"),
        "organizational_admissibility": "PARTIAL_ORIGINAL_GOVERNANCE_ONLY",
        "verifiable_original_result": (
            "MODEL_ONLY_ACCEPTANCE_TRACE" if accepted else "NOT_ESTABLISHED"),
        "economic_observability": (
            "DECLARED_ALTERNATIVES_NO_CAUSAL_PROOF" if economic_status != "NOT_IDENTIFIABLE"
            else "NOT_ESTABLISHED"),
        "retained_original_responsibility": "MODEL_INVARIANT_ONLY",
    }
    operating = configuration_dynamics(
        design, state, at=at, current=valid, economic_status=economic_status
    )
    # The program actually performs source-qualified, bounded computations on
    # the existing original Work state. It does NOT emit original business
    # events, call external tools, or turn a simulated scope into an authority.
    work_scope = {row['work']: row for row in operating['original_work_scope']}
    bounded_steps = [
        perform_bounded_process_step(
            function, assessment['research_review'],
            work_scope.get(function['work']), state, at=at,
        )
        for function, assessment in zip(
            valid['agent_functions'], agent_review, strict=True
        )
    ]
    computed_steps = sum(
        result['status'] in {
            'NONBINDING_PROCESS_COMPUTATION_PERFORMED',
            'HUMAN_REVIEW_PACKET_COMPUTED',
        } for result in bounded_steps
    )
    components['А']['bounded_process_computations'] = computed_steps
    components['А']['held_process_functions'] = len(bounded_steps) - computed_steps
    components['КЖ']['source_bound_computations_observed'] = computed_steps
    components['Э']['measured_cash_saving_from_agent_preparation'] = 'NOT_IDENTIFIABLE'
    if computed_steps:
        constitutive_signs['delegated_program_process_function'] = (
            'PARTIAL_NONBINDING_SOURCE_BOUND_PROCESS_COMPUTATION_ONLY'
        )
    return {
        "schema": "AKIS_GENERAL_NINE_COMPONENT_MODEL/0.1",
        "at": at,
        "evidence": "MODEL_ONLY_SOURCE_DECLARATIONS",
        "configuration": design.configuration,
        "configuration_coverage": (
            "PARTIAL_OPERATOR_RESEARCH_ONLY" if design.configuration == "operator"
            else "NOT_EXECUTABLE_IN_CURRENT_PARTY_TYPES"),
        "configuration_fully_implemented": False,
        "configuration_dynamics": operating,
        "morphology": {"source": "doctorate.chapter3.section3.4.table3.5",
                       "selected": dict(design.morphology), "axes_declared": 9,
                       "behavioral_effects_across_all_forms": "NOT_IMPLEMENTED",
                       "original_work_behavioral_consequences": "PARTIAL_SOURCE_BOUND_RESEARCH"},
        "source_claim_counts_current": source_counts,
        "components": components,
        "seven_constitutive_signs": constitutive_signs,
        "doctoral_business_classification": "NOT_QUALIFIED_SEVEN_SIGNS_NOT_ALL_MET",
        "author_operator_reproducibility": {
            "onboarding_total_from_nine_cost_channels": "UNKNOWN_WITHOUT_ORIGINAL_COST_SOURCE",
            "repeatability_ratio": "UNKNOWN_WITHOUT_REUSED_ELEMENTS_AND_TOTAL",
            "experience_return_ratio": "UNKNOWN_WITHOUT_APPROVED_AND_REUSED_EXPERIENCE",
            "zero_denominator_must_not_be_filled": True,
        },
        "organizational_code": {"author_fields": 13, "current_fields": sorted(code_fields),
                                "missing_fields": missing_code,
                                "ambiguous_owner_fields": ambiguous_code_fields,
                                "actual_identity_and_mandates": "NOT_VERIFIED"},
        "context_cores": {"declared": sorted(contexts), "missing": missing_cores,
                          "purpose_scoped_claims": len(valid["context_cores"]),
                          "model_source_scoped_cores": sorted(scoped_cores),
                          "model_source_scope_status_counts": {
                              reason: sum(status == reason for _, status in scoped_core_rows)
                              for reason in sorted({status for _, status in scoped_core_rows})
                          },
                          "actual_source_use_rights": "NOT_VERIFIED"},
        "agent_function_scope_review": agent_review,
        "bounded_process_function_outputs": bounded_steps,
        "model_organizational_code_review": {
            "opted_in": design.enforce_model_org_code,
            "all_thirteen_model_controls_active": model_code_active,
            "real_identity_and_legal_authority": "NOT_VERIFIED",
            "no_new_original_action_by_policy": True,
        },
        "formation_phases": phase_rows,
        "first_three_formation_model_gate": {
            "opted_in": design.enforce_model_formation_phases,
            "original_model_event_confirmations": len(formation_applied),
            "original_model_blocked_attempts": (
                len(formation_attempts) - len(formation_applied)),
            "only_first_three_phases_have_original_model_commit_guards": True,
            "full_eight_author_formation_phases_completed": False,
            "real_identity_or_legal_formation_approved": False,
            "does_not_create_second_engine_or_original_work": True,
        },
        "capability": {"capacity_sources_declared": explicit_capacity,
                       "qualified_required_resources": len(capacity_qualified),
                       "total_required_resources": len(required_resources),
                       "original_resource_rights": "UNALTERED"},
        "readiness": "PARTIAL_GENERAL_SCIENTIFIC_SCAFFOLD_NOT_FULL_AKIS",
        "legal_consent_created": False,
        "new_original_result_created": False,
        "common_cash_ledger_created": False,
        "new_agent_runtime_created": False,
    }

def original_nine_component_cycle_evidence(
    design: GeneralSystemDesign, original: Any,
    final_output: Mapping[str, Any], *, future_needs: tuple[Any, ...],
) -> dict[str, Any]:
    """Evaluate ONE original Work->Result->next-need/capability sequence.

    A scientific witness only: all sources, ownership, time, actions, and
    subsequent Work must already exist in the original Mesa. This projection
    cannot create an agent, permission, contract, Work, future demand or cash.
    Report individual Work identifiers only in the private research section.
    """
    general = final_output["general_akis_model"]
    if tuple(general["components"]) != COMPONENTS:
        raise GeneralSystemInputError("AKIS_NINE_AUTHOR_COMPONENTS_CHANGED")
    events = [event for event in original.trace if event.get("outcome") == "APPLIED"]
    accepted_at: dict[str, int] = {}
    requested_at: dict[str, int] = {}
    original_committed_at: dict[str, int] = {}
    for event in events:
        work_id = event.get("work")
        if work_id not in original.works:
            continue
        work = original.works[work_id]
        action = event.get("action")
        at = event.get("at")
        if type(at) is not int:
            continue
        if action == "request" and event.get("actor") == work.customer:
            requested_at.setdefault(work_id, at)
        if action == "commit":
            original_committed_at.setdefault(work_id, at)
        if (action == "accept" and event.get("actor") == work.customer
                and work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"):
            accepted_at[work_id] = at

    # The source record alone is not a later need: it must have an explicit,
    # unchanged original Work, a later original CUSTOMER request and a
    # time-qualified SOURCE_ACTIVE projection from the same Mesa scheduler.
    # Source expiry after the request cannot rewrite the historical trace.
    need_history = final_output.get("future_need_dynamics", {}).get(
        "read_only_evolution", []
    )
    need_current = {
        row["need"]: row for row in final_output.get(
            "future_need_dynamics", {}
        ).get("current", {}).get("needs", [])
    }
    need_witnesses = []
    for need in future_needs:
        if not need.prerequisite_results:
            continue
        later = original.works.get(need.work.key)
        req_at = requested_at.get(need.work.key)
        source_in_window = (
            req_at is not None and need.available_at <= req_at < need.expires_at
        )
        same_original_work = (
            later is not None and later.customer == need.owner
            and later.source_revision == need.work.source_revision
            and later.resource_requirements == need.work.resource_requirements
            and later.slot_start == need.work.slot_start
            and later.slot_end == need.work.slot_end
            and later.operations == need.work.operations
        )
        prerequisites_valid = all(
            predecessor in accepted_at and
            original.works[predecessor].source_revision == revision and
            (req_at is not None and accepted_at[predecessor] < req_at)
            for predecessor, revision in need.prerequisite_results
        )
        source_active_at_original_request = any(
            point["at"] == float(req_at) and
            any(
                row["need"] == need.key
                and row["status"] == "SOURCE_ACTIVE_FOR_RESEARCH"
                and row["original_work_request_confirmed"]
                for row in point["projection"]["needs"]
            )
            for point in need_history
        ) if req_at is not None else False
        qualified = bool(
            source_in_window and same_original_work and prerequisites_valid
            and source_active_at_original_request
        )
        need_witnesses.append({
            "declared_future_need": need.key,
            "original_customer": need.owner,
            "later_original_work": need.work.key,
            "original_customer_request_at": req_at,
            "original_prerequisite_work_ids": [
                pred for pred, _ in need.prerequisite_results
            ],
            "source_active_at_request": source_active_at_original_request,
            "source_revision_and_scope_preserved": bool(same_original_work),
            "all_prior_results_accepted_before_request": prerequisites_valid,
            "research_causal_sequence": (
                "MODEL_SOURCE_DECLARED_RESULT_TO_LATER_ORIGINAL_CUSTOMER_REQUEST"
                if qualified else
                "NO_QUALIFIED_RESULT_TO_REQUEST_LINK"
            ),
            "later_original_work_accepted": (
                qualified and need.work.key in accepted_at
            ),
            "need_is_independent_owner_declaration_not_endogenously_created": True,
            "original_request_is_not_automatically_generated_by_need": True,
            "currently_reviewable_after_history": (
                need_current.get(need.key, {}).get("status")
                == "SOURCE_ACTIVE_FOR_RESEARCH"
            ),
        })

    # Learning/reproduction requires both an original comparable reuse
    # sequence and a later ORIGINAL owner adoption event; a measured-looking
    # claim or declaration alone cannot change the ability of an enterprise.
    reusable = {
        row["id"]: row
        for row in final_output.get("competence_reuse_dynamics", {}).get("links", [])
        if row["model_claim_status"] == "MODEL_REPORTED_COMPARABLE_REUSE_SEQUENCE"
    }
    capability_witnesses = []
    for cap in final_output.get("capability_dynamics", {}).get("declarations", []):
        reuse = reusable.get(cap["reuse_claim"])
        at = cap["original_owner_event_applied_at"]
        adopted_with_prior_result = bool(
            reuse is not None and at is not None
            and reuse["prior_work"] in accepted_at
            and accepted_at[reuse["prior_work"]] < at
            and reuse["later_work"] in accepted_at
            and accepted_at[reuse["later_work"]] < at
        )
        follow_on = sorted(
            work_id for work_id in cap["authorized_follow_on_work_ids"]
            if work_id in original_committed_at
            and original_committed_at[work_id] > at
            and work_id in accepted_at
            and accepted_at[work_id] > original_committed_at[work_id]
        ) if adopted_with_prior_result else []
        capability_witnesses.append({
            "original_resource_owner": cap["original_owner"],
            "model_capability_declaration": cap["id"],
            "original_owner_adopted_at": at,
            "matched_source_declared_comparable_reuse": bool(reuse),
            "adoption_after_prior_accepted_results": adopted_with_prior_result,
            "later_original_accepted_work_ids": follow_on,
            "model_reproduction_sequence": (
                "ORIGINAL_ACCEPTED_RESULT_REUSE_OWNER_ADOPTION_AND_LATER_ACCEPTED_WORK"
                if follow_on and cap["available_for_new_original_work"]
                else "NO_QUALIFIED_CURRENT_CAPABILITY_TO_ACCEPTED_WORK_SEQUENCE"
            ),
            "owner_declared_capacity_not_field_verified": True,
            "no_new_original_work_or_permission_created": True,
        })

    accepted_results = len(accepted_at)
    requested_count = len(requested_at)
    committed_count = len(original_committed_at)
    linked_needs = sum(
        row["research_causal_sequence"]
        == "MODEL_SOURCE_DECLARED_RESULT_TO_LATER_ORIGINAL_CUSTOMER_REQUEST"
        for row in need_witnesses
    )
    accepted_follow_on = sum(
        row["later_original_work_accepted"] for row in need_witnesses
    )
    current_capacity_sequences = sum(
        row["model_reproduction_sequence"]
        == "ORIGINAL_ACCEPTED_RESULT_REUSE_OWNER_ADOPTION_AND_LATER_ACCEPTED_WORK"
        for row in capability_witnesses
    )
    components = general["components"]
    # All nine remain distinct. This is a *component coverage diagnosis*, not
    # a substitute for the author's full A=F(P,OC,KPB) or eight executable
    # formation phases. Any positive fragment still fails scientific closure.
    current_partial_observation = {
        "Ц": bool(components["Ц"]["current_independent_goal_claims"]
                  or future_needs),
        "У": bool(components["У"]["current_original_subjects"]),
        "А": bool(components["А"]["bounded_process_computations"]),
        "П": bool(requested_count or committed_count),
        "КПБ": bool(components["КПБ"]["model_source_scoped_cores"]),
        "ОК": bool(components["ОК"]["model_13_control_predicates_active"]),
        "КЖ": bool(accepted_results),
        "Э": bool(final_output.get("economics")),
        "ЖЦ": bool(linked_needs or current_capacity_sequences),
    }
    assert tuple(current_partial_observation) == COMPONENTS
    return {
        "private_research_witnesses": {
            "source_declared_follow_on_need_links": need_witnesses,
            "owner_adopted_capability_reuse_links": capability_witnesses,
            "contains_owner_work_and_model_source_identifiers": True,
            "safe_for_cross_enterprise_publication": False,
        },
        "shared_summary": {
            "schema": "AKIS_NINE_COMPONENT_ORIGINAL_CYCLE_EVIDENCE/0.1",
            "component_order": list(COMPONENTS),
            "nine_component_model_partially_observed": {
                key: bool(value) for key, value in current_partial_observation.items()
            },
            "original_customer_request_event_count": requested_count,
            "original_accepted_work_commit_event_count": committed_count,
            "original_recipient_accepted_result_event_count": accepted_results,
            "owner_declared_result_dependent_future_need_count": len(need_witnesses),
            "historical_result_to_owner_new_request_model_link_count": linked_needs,
            "accepted_follow_on_original_work_link_count": accepted_follow_on,
            "owner_adopted_result_to_future_accepted_work_model_link_count": (
                current_capacity_sequences
            ),
            "seven_constitutive_signs_fully_qualified": False,
            "all_eight_formation_phases_executable": False,
            "author_agent_A_F_P_OC_KPB_executable": False,
            "all_nine_component_original_causal_closure_proven": False,
            "full_real_lifecycle_or_causal_value_added_proven": False,
            "source_declared_need_is_not_generated_demand": True,
            "accepted_result_is_not_automatic_payment": True,
            "independent_original_principal_decisions_preserved": True,
            "original_cost_and_cash_ledgers_unchanged": True,
            "owner_work_source_capability_and_timestamps_redisclosed": False,
            "readiness": "PARTIAL_ORIGINAL_SYSTEM_CAUSAL_FRAGMENTS_NOT_WHOLE_AKIS",
        },
    }
