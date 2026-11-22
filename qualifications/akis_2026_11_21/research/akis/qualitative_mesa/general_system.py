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
from .cooperation import original_membership_predecessor


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
    enforce_model_formation_context_code: bool = False
    enforce_model_formation_agent_review: bool = False
    enforce_model_formation_lifecycle: bool = False
    enforce_model_result_conditioned_goals: bool = False
    enforce_model_result_conditioned_interests: bool = False
    enforce_model_result_conditioned_reconfiguration: bool = False
    enforce_model_result_conditioned_capability_cooperation: bool = False

    @property
    def source_times(self) -> tuple[int, ...]:
        return tuple(sorted({t for rows in self.declarations.values() for row in rows
                             for t in (row["available_at"], row["expires_at"])}))



class ModelFormationPolicy:
    """One original Work/trace: opt-in formation constraints, NOT a new engine.

    R1-I: stages 1-3 (need, process, own resource readiness).
    R1-J: optional stages 4-5 (four ORIGINAL context scopes and original
    code/founder acknowledgements). These model-only checks can ONLY REFUSE
    original commits. They never authorize business decisions or legal acts.
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
            # Initial declared evidence and later APPLIED original owner's
            # resource_status are both model-scoped. A blocked/foreign event
            # cannot set MODEL_EVENT in the original rule handler.
            state.resource_availability_origin.get(need.resource) in {
                "MODEL_INPUT", "MODEL_EVENT"
            } and
            state.resource_availability.get(need.resource) == "AVAILABLE"
            for need in work.resource_requirements
        )

    def _original_core_scope(self, state: Any, event: Mapping[str, Any],
                             at: int) -> str:
        """Recheck existing ContextBasis, not a copied or inferred permission."""
        core, basis_source = (
            event.get("formation_core"), event.get("formation_basis_source")
        )
        if core not in CORES:
            return "FORMATION_KPB_AUTHOR_CORE_UNKNOWN"
        if not isinstance(basis_source, str) or not basis_source:
            return "FORMATION_KPB_ORIGINAL_BASIS_REFERENCE_REQUIRED"
        actor = event.get("actor")
        rows = [
            row for row in self.design.declarations["context_cores"]
            if row["core"] == core and row["owner"] == actor and
            row.get("basis_source") == basis_source and
            row["revision"] == state.institution.revision and
            row["available_at"] <= at < row["expires_at"]
        ]
        if len(rows) != 1:
            return "FORMATION_KPB_EXACT_ORIGINAL_CORE_CLAIM_REQUIRED"
        row = rows[0]
        reason = source_link_status(
            state.context_basis, source_id=basis_source,
            expected_revision=row.get("basis_revision"),
            original_owner=actor, recipient=row["recipient"],
            core=core, purpose=row["purpose"], operation=row["operation"],
            at=at,
        )
        return ("NONE" if reason == "MODEL_SOURCE_SCOPE_CONSISTENT"
                else "FORMATION_KPB_" + reason)

    def _core_status(self, state: Any, work: Any, core: str, at: int) -> str:
        history = [
            event for event in state.trace
            if event.get("outcome") == "APPLIED" and
            event.get("action") == "formation_confirm" and
            event.get("phase") == 4 and
            event.get("formation_core") == core and
            event.get("work") == work.key and
            event.get("org_revision") == state.institution.revision and
            event.get("work_source_revision") == work.source_revision and
            type(event.get("at")) is int and event["at"] < at
        ]
        if not history:
            return "FORMATION_KPB_ORIGINAL_CORE_CONFIRMATION_MISSING"
        for event in history:
            party = state.subjects.get(event["actor"])
            if (party is not None and party.active and self._source_active(
                    4, event["actor"], event.get("formation_source_ref"),
                    state.institution.revision, at)
                    and self._original_core_scope(state, event, at) == "NONE"):
                return "NONE"
        return "FORMATION_KPB_CORE_SOURCE_STALE_OR_REVOKED"

    def _all_cores_ready(self, state: Any, work: Any, at: int) -> str:
        for core in sorted(CORES):
            reason = self._core_status(state, work, core, at)
            if reason != "NONE":
                return reason
        return "NONE"

    def _org_code_active(self, state: Any, at: int) -> bool:
        policy = getattr(state, "model_org_policy", None)
        names = set(self.design.catalog["taxonomy"]["organizational_code_components"])
        return (policy is not None and set(policy.records) == names and
                policy.active(state, at))

    def confirm(self, state: Any, event: Mapping[str, Any], at: int) -> str:
        phase, key, actor = event.get("phase"), event.get("work"), event.get("actor")
        institutional = self.design.enforce_model_formation_context_code
        if type(phase) is not int or phase not in (
                (1, 2, 3, 4, 5) if institutional else (1, 2, 3)):
            return ("FORMATION_ONLY_FIRST_FIVE_PHASES_EXECUTABLE" if institutional
                    else "FORMATION_ONLY_FIRST_THREE_PHASES_EXECUTABLE")
        work = state.works.get(key)
        if work is None:
            return "FORMATION_ORIGINAL_WORK_REQUIRED"
        if work.obligation != "NOT_ACCEPTED":
            return "FORMATION_CANNOT_REWRITE_ACCEPTED_OBLIGATION"
        if event.get("org_revision") != state.institution.revision:
            return "FORMATION_ORIGINAL_ORG_REVISION_MISMATCH"
        if actor not in state.subjects or not state.subjects[actor].active:
            return "FORMATION_ORIGINAL_ACTIVE_PRINCIPAL_REQUIRED"
        if phase in (1, 2):
            expected = {work.customer}
        elif phase == 3:
            expected = self._resource_owners(state, work)
        elif phase == 4:
            core = event.get("formation_core")
            if core not in CORES:
                return "FORMATION_KPB_AUTHOR_CORE_UNKNOWN"
            expected = {row["owner"] for row in
                        self.design.declarations["context_cores"]
                        if row["core"] == core}
        else:
            expected = set(state.institution.founders)
        if actor not in expected:
            return ("FORMATION_KPB_ORIGINAL_SOURCE_OWNER_REQUIRED"
                    if phase == 4 else
                    "FORMATION_OC_ORIGINAL_FOUNDER_REQUIRED"
                    if phase == 5 else "FORMATION_WRONG_ORIGINAL_PHASE_OWNER")
        if not self._source_active(
                phase, actor, event.get("formation_source_ref"),
                state.institution.revision, at):
            return "FORMATION_ORIGINAL_OWNER_PHASE_SOURCE_MISSING"
        if phase != 4 and self._ack_status(state, work, phase, actor, at) == "NONE":
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
            has_static_goal = any(
                goal["owner"] == work.customer and goal["work"] == key and
                goal["work_revision"] == work.source_revision and
                goal["revision"] == request.get("org_revision") and
                goal["available_at"] <= request["at"] < goal["expires_at"]
                for request in requests
                for goal in self.design.declarations["goals"]
            )
            if (self.design.enforce_model_result_conditioned_goals and
                    work.requires_accepted):
                dynamic_goal = any(
                    self._result_conditioned_goal(
                        state, request, work, request["at"]
                    ) == "NONE"
                    for request in requests
                )
                if not dynamic_goal:
                    return "FORMATION_EMERGENT_GOAL_NOT_FROM_ORIGINAL_RESULT"
            elif not has_static_goal:
                return "FORMATION_GOAL_AND_ORIGINAL_CUSTOMER_REQUEST_NOT_LINKED"
        elif phase == 2:
            if self._ack_status(state, work, 1, work.customer, at) != "NONE":
                return "FORMATION_FIRST_PHASE_NOT_QUALIFIED"
            if not work.resource_requirements:
                return "FORMATION_ORIGINAL_WORK_PROCESS_NOT_SELECTED"
        elif phase == 3:
            if self._ack_status(state, work, 2, work.customer, at) != "NONE":
                return "FORMATION_SECOND_PHASE_NOT_QUALIFIED"
            if not self._resources_ready(state, work):
                return "FORMATION_ORIGINAL_RESOURCE_CAPACITY_NOT_DECLARED_READY"
        elif phase == 4:
            for owner in sorted(self._resource_owners(state, work)):
                if self._ack_status(state, work, 3, owner, at) != "NONE":
                    return "FORMATION_THIRD_PHASE_OWNERS_NOT_QUALIFIED"
            if not self._resources_ready(state, work):
                return "FORMATION_ORIGINAL_RESOURCE_CAPACITY_NOT_DECLARED_READY"
            if self._core_status(
                    state, work, event.get("formation_core"), at) == "NONE":
                return "FORMATION_KPB_DUPLICATE_LIVE_CORE_CONFIRMATION"
            return self._original_core_scope(state, event, at)
        else:
            reason = self._all_cores_ready(state, work, at)
            if reason != "NONE":
                return reason
            if not self._org_code_active(state, at):
                return "FORMATION_OC_THIRTEEN_ORIGINAL_CODE_CONTROLS_NOT_ACTIVE"
        return "NONE"


    def _agent_packet(self, state: Any, work: Any,
                      fn_id: str, at: int) -> tuple[str, Any]:
        options = [
            fn for fn in self.design.declarations["agent_functions"]
            if fn["id"] == fn_id and fn["work"] == work.key
            and fn["work_revision"] == work.source_revision
            and fn["revision"] == state.institution.revision
            and fn["available_at"] <= at < fn["expires_at"]
        ]
        if len(options) != 1:
            return "FORMATION_AGENT_ORIGINAL_FUNCTION_NOT_CURRENT", None
        fn = options[0]
        if fn["action"] != "REQUEST_APPROVAL":
            return "FORMATION_AGENT_REVIEW_PACKET_FUNCTION_REQUIRED", None
        policy = state.model_org_policy
        if (policy is None or not policy.active(state, at) or
                policy.agent_decision("REQUEST_APPROVAL")
                    != "OC_MODEL_PREPARATION_CANDIDATE_NOT_AUTHORIZED"):
            return "FORMATION_AGENT_ORIGINAL_OC_FUNCTION_NOT_PERMITTED", None
        # Reuse the ONE model's source-qualified process computation.
        view = general_system_view(self.design, state, at=float(at))
        packets = [
            row for row in view["bounded_process_function_outputs"]
            if row["function"] == fn_id and row["work"] == work.key
        ]
        if len(packets) != 1 or packets[0]["status"] != "HUMAN_REVIEW_PACKET_COMPUTED":
            return "FORMATION_AGENT_ORIGINAL_PROCESS_KPB_PACKET_NOT_CURRENT", None
        return "NONE", fn

    def _latest_agent_preparation(self, state: Any, work: Any,
                                  fn_id: str, at: int) -> dict[str, Any] | None:
        candidates = [
            row for row in state.trace
            if row.get("action") == "function_prepare"
            and row.get("outcome") == "APPLIED"
            and row.get("work") == work.key and row.get("function_id") == fn_id
            and row.get("work_source_revision") == work.source_revision
            and row.get("org_revision") == state.institution.revision
            and type(row.get("at")) is int and row["at"] < at
        ]
        return candidates[-1] if candidates else None

    def _phase_six_ready(self, state: Any, work: Any, at: int) -> str:
        functions = [
            fn for fn in self.design.declarations["agent_functions"]
            if fn["work"] == work.key and fn["work_revision"] == work.source_revision
            and fn["action"] == "REQUEST_APPROVAL"
            and fn["revision"] == state.institution.revision
            and fn["available_at"] <= at < fn["expires_at"]
        ]
        if len(functions) != 1:
            return "FORMATION_AGENT_ONE_ORIGINAL_REVIEW_FUNCTION_REQUIRED"
        fn = functions[0]
        prep = self._latest_agent_preparation(state, work, fn["id"], at)
        if prep is None:
            return "FORMATION_AGENT_PREPARATION_NOT_IN_ORIGINAL_TRACE"
        if (prep.get("actor") != fn["owner"] or
                prep.get("function_source_ref") != fn["source_ref"] or
                not self._source_active(
                    6, fn["owner"], prep.get("function_phase_source_ref"),
                    state.institution.revision, at)):
            return "FORMATION_AGENT_ORIGINAL_PREPARATION_SOURCE_STALE"
        reason, _ = self._agent_packet(state, work, fn["id"], at)
        if reason != "NONE":
            return reason
        # Even a subsequently restored source must not silently reactivate a
        # packet computed against an older context epoch. The original trace,
        # not a secondary version store, establishes the intervening change.
        packet_sources = {
            row.get("basis_source")
            for row in self.design.declarations["context_cores"]
            if row["revision"] == state.institution.revision
            and row.get("basis_source")
        }
        packet_sources.add(fn.get("basis_source"))
        if any(
            row.get("action") == "source_update"
            and row.get("outcome") == "APPLIED"
            and row.get("source") in packet_sources
            and type(row.get("at")) is int
            and prep["at"] < row["at"] < at
            for row in state.trace
        ):
            return "FORMATION_AGENT_ORIGINAL_KPB_CHANGED_AFTER_PACKET"
        reviews = [
            row for row in state.trace
            if row.get("action") == "function_review"
            and row.get("outcome") == "APPLIED"
            and row.get("work") == work.key and row.get("function_id") == fn["id"]
            and row.get("prepared_at") == prep["at"]
            and row.get("actor") == work.customer
            and row.get("org_revision") == state.institution.revision
            and row.get("work_source_revision") == work.source_revision
            and type(row.get("at")) is int and row["at"] < at
        ]
        if not reviews:
            return "FORMATION_AGENT_ORIGINAL_CUSTOMER_APPROVAL_REQUIRED"
        if reviews[-1].get("human_decision") != "APPROVE":
            return "FORMATION_AGENT_ORIGINAL_CUSTOMER_REJECTED"
        return "NONE"

    def process_function_action(self, state: Any, ev: Mapping[str, Any],
                                at: int) -> str:
        if not self.design.enforce_model_formation_agent_review:
            return "FORMATION_AGENT_GATE_NOT_CONFIGURED"
        work = state.works.get(ev.get("work"))
        if work is None:
            return "FORMATION_AGENT_ORIGINAL_WORK_REQUIRED"
        if work.obligation != "NOT_ACCEPTED":
            return "FORMATION_AGENT_CANNOT_REWRITE_ACCEPTED_WORK"
        if ev.get("org_revision") != state.institution.revision:
            return "FORMATION_AGENT_ORIGINAL_OC_REVISION_MISMATCH"
        fn_id, actor = ev.get("function_id"), ev.get("actor")
        if not isinstance(fn_id, str) or not fn_id:
            return "FORMATION_AGENT_FUNCTION_REFERENCE_REQUIRED"
        if actor not in state.subjects or not state.subjects[actor].active:
            return "FORMATION_AGENT_ORIGINAL_ACTIVE_SUBJECT_REQUIRED"
        if ev["action"] == "function_prepare":
            reason = self.before_commit(state, work, at, include_agent=False)
            if reason != "NONE":
                return reason
            reason, fn = self._agent_packet(state, work, fn_id, at)
            if reason != "NONE":
                return reason
            if actor != fn["owner"]:
                return "FORMATION_AGENT_ORIGINAL_FUNCTION_OWNER_REQUIRED"
            if ev.get("function_source_ref") != fn["source_ref"]:
                return "FORMATION_AGENT_FUNCTION_SOURCE_MISMATCH"
            if not self._source_active(
                6, actor, ev.get("function_phase_source_ref"),
                state.institution.revision, at
            ):
                return "FORMATION_AGENT_PHASE_SIX_SOURCE_REQUIRED"
            return "NONE"
        if ev["action"] != "function_review":
            return "FORMATION_AGENT_UNSUPPORTED_ACTION"
        if actor != work.customer:
            return "FORMATION_AGENT_INDEPENDENT_CUSTOMER_REQUIRED"
        decision = ev.get("human_decision")
        if decision not in {"APPROVE", "REJECT"}:
            return "FORMATION_AGENT_HUMAN_DECISION_REQUIRED"
        proof = ev.get("review_source_ref")
        if (not isinstance(proof, str) or
                not proof.startswith("model://" + actor + "/") or
                len(proof) > 160):
            return "FORMATION_AGENT_ORIGINAL_CUSTOMER_SOURCE_REQUIRED"
        prep = self._latest_agent_preparation(state, work, fn_id, at)
        if prep is None or ev.get("prepared_at") != prep["at"]:
            return "FORMATION_AGENT_CURRENT_PREPARATION_REQUIRED"
        if any(
            row.get("action") == "function_review"
            and row.get("outcome") == "APPLIED"
            and row.get("work") == work.key
            and row.get("function_id") == fn_id
            and row.get("prepared_at") == prep["at"]
            for row in state.trace
        ):
            return "FORMATION_AGENT_PREPARATION_ALREADY_REVIEWED"
        if decision == "APPROVE":
            reason, fn = self._agent_packet(state, work, fn_id, at)
            if reason != "NONE":
                return reason
            if (prep.get("actor") != fn["owner"] or
                    prep.get("function_source_ref") != fn["source_ref"] or
                    not self._source_active(
                        6, fn["owner"], prep.get("function_phase_source_ref"),
                        state.institution.revision, at)):
                return "FORMATION_AGENT_PREPARATION_SOURCE_STALE"
        # A rejection is an original independent negative decision, not
        # execution, acceptance of Work, or a grant to a program agent.
        return "NONE"

    def _original_result_decision(self, state: Any, work: Any,
                                  at: int) -> tuple[str, Any]:
        """Only the existing recipient decision, never a result declaration."""
        choices = [
            row for row in state.trace
            if row.get("action") in {"accept", "reject"}
            and row.get("outcome") == "APPLIED"
            and row.get("work") == work.key
            and row.get("actor") == work.customer
            and type(row.get("at")) is int and row["at"] < at
        ]
        if not choices:
            return "FORMATION_PILOT_ORIGINAL_RECIPIENT_DECISION_REQUIRED", None
        decision = choices[-1]
        expected = ("ACCEPTED_BY_ORIGINAL_RECIPIENT"
                    if decision["action"] == "accept" else "REJECTED")
        if (work.result != expected or
                not work.result_ref or
                not work.result_history or
                work.result_history[-1].get("transition") != decision["action"] or
                work.result_history[-1].get("model_ref") != work.result_ref):
            return "FORMATION_PILOT_CURRENT_RESULT_REVISION_MISMATCH", None
        if not any(
            row["phase"] == 7 and row["owner"] == work.customer
            and row["revision"] == decision.get("org_revision")
            and row["available_at"] <= decision["at"] < row["expires_at"]
            for row in self.design.declarations["formation_phases"]
        ):
            return "FORMATION_PILOT_SEVENTH_PHASE_CUSTOMER_SOURCE_REQUIRED", None
        # A rejected result is authentic *negative* model evidence. It cannot
        # satisfy an accepted-result dependency of a follow-up Work.
        return "NONE", decision

    def post_result_owner_evaluation(self, state: Any,
                                     event: Mapping[str, Any], at: int) -> str:
        """Restrict the ORIGINAL participation_status to a real pilot Result."""
        if not self.design.enforce_model_formation_lifecycle:
            return "NONE"
        key = event.get("evaluated_work")
        work = state.works.get(key)
        if work is None:
            return "FORMATION_EVALUATION_ORIGINAL_PILOT_WORK_REQUIRED"
        link = next((l for l in state.cooperation_links
                     if l.key == event.get("cooperation_link")), None)
        if link is None:
            return "FORMATION_EVALUATION_PILOT_COOPERATION_RELATION_REQUIRED"
        if key not in link.works and original_membership_predecessor(
            state.cooperation_links, state.trace,
            successor_id=link.key, successor_revision=link.source_revision,
            pilot=work, at=at, org_revision=state.institution.revision,
        ) is None:
            return "FORMATION_EVALUATION_PILOT_COOPERATION_RELATION_REQUIRED"
        actor = event.get("actor")
        owners = self._resource_owners(state, work) | {work.customer}
        if actor not in owners:
            return "FORMATION_EVALUATION_ORIGINAL_WORK_PRINCIPAL_REQUIRED"
        if event.get("evaluated_work_revision") != work.source_revision:
            return "FORMATION_EVALUATION_PILOT_WORK_REVISION_STALE"
        if event.get("evaluated_result_ref") != work.result_ref:
            return "FORMATION_EVALUATION_PILOT_RESULT_REFERENCE_MISMATCH"
        reason, decision = self._original_result_decision(state, work, at)
        if reason != "NONE":
            return reason
        if event.get("evaluated_decision_at") != decision["at"]:
            return "FORMATION_EVALUATION_ORIGINAL_DECISION_TIME_MISMATCH"
        if event.get("evaluation_verdict") not in {
                "FAVOURABLE_DECLARED", "ADVERSE_DECLARED", "UNKNOWN_DECLARED"}:
            return "FORMATION_EVALUATION_OWNER_ECONOMIC_VERDICT_REQUIRED"
        source = event.get("formation_phase_source_ref")
        if not self._source_active(
                8, actor, source, state.institution.revision, at):
            return "FORMATION_EVALUATION_OWNER_EIGHTH_PHASE_SOURCE_REQUIRED"
        owner_source = event.get("participation_evidence_ref")
        if (not isinstance(owner_source, str)
                or not owner_source.startswith("model://" + actor + "/")):
            return "FORMATION_EVALUATION_ORIGINAL_OWNER_SOURCE_REQUIRED"
        # Model-only economic judgment is not a quantified or proven benefit.
        # Participation_status itself already controls future engagement.
        return "NONE"

    def owner_emerge_need(self, state: Any, event: Mapping[str, Any],
                        at: int) -> str:
        """Original principal explicitly originates a goal *after* a Result.

        This is a source-bound observation, NOT an automatically created Work,
        consent, resource, capability, price or contract.
        """
        if not self.design.enforce_model_result_conditioned_goals:
            return "FORMATION_EMERGENT_NEED_POLICY_NOT_CONFIGURED"
        actor = event.get("actor")
        if (actor not in state.subjects or not state.subjects[actor].active
                or state.subjects[actor].kind != "SME"):
            return "FORMATION_EMERGENT_ORIGINAL_ACTIVE_CUSTOMER_REQUIRED"
        if event.get("org_revision") != state.institution.revision:
            return "FORMATION_EMERGENT_ORG_REVISION_STALE"
        target, revision = event.get("work"), event.get("work_source_revision")
        if (not isinstance(target, str) or not target or len(target) > 128
                or not isinstance(revision, str) or not revision or len(revision) > 128
                or target in state.works):
            return "FORMATION_EMERGENT_NEW_WORK_SOURCE_REQUIRED"
        ref = event.get("goal_source_ref")
        if (not isinstance(ref, str) or len(ref) > 180 or
                not ref.startswith("model://" + actor + "/") or
                len(ref) <= len("model://" + actor + "/")):
            return "FORMATION_EMERGENT_OWNER_GOAL_SOURCE_REQUIRED"
        expiry = event.get("goal_expires_at")
        if type(expiry) is not int or not at < expiry <= 10000:
            return "FORMATION_EMERGENT_OWNER_GOAL_TIME_REQUIRED"
        if event.get("goal_objective") not in OBJECTIVES:
            return "FORMATION_EMERGENT_GOAL_OBJECTIVE_UNKNOWN"
        prio = event.get("goal_priority")
        if type(prio) is not int or not 1 <= prio <= 10:
            return "FORMATION_EMERGENT_GOAL_PRIORITY_INVALID"
        if any(
            row.get("action") == "need_emerge" and
            row.get("outcome") == "APPLIED" and row.get("work") == target
            for row in state.trace
        ):
            return "FORMATION_EMERGENT_TARGET_ALREADY_CLAIMED"
        link = next((
            l for l in state.cooperation_links
            if l.key == event.get("cooperation_link") and
               l.source_revision == event.get("cooperation_source_revision")
        ), None)
        if link is None or actor not in link.participants:
            return "FORMATION_EMERGENT_ORIGINAL_RELATION_REQUIRED"
        pilot = state.works.get(event.get("pilot_work"))
        if (pilot is None or pilot.customer != actor or
                pilot.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"):
            return "FORMATION_EMERGENT_CUSTOMER_ACCEPTED_PILOT_REQUIRED"
        if pilot.key not in link.works and original_membership_predecessor(
            state.cooperation_links, state.trace,
            successor_id=link.key, successor_revision=link.source_revision,
            pilot=pilot, at=at, org_revision=state.institution.revision,
        ) is None:
            return "FORMATION_EMERGENT_CUSTOMER_ACCEPTED_PILOT_REQUIRED"
        if event.get("pilot_result_ref") != pilot.result_ref:
            return "FORMATION_EMERGENT_PILOT_RESULT_REVISION_MISMATCH"
        reason, decision = self._original_result_decision(state, pilot, at)
        if reason != "NONE":
            return reason
        if (decision.get("action") != "accept" or
                decision["at"] != event.get("pilot_decision_at")):
            return "FORMATION_EMERGENT_PILOT_ACCEPTANCE_TIME_MISMATCH"
        # The goal may originate only after this actor's ORIGINAL phase-8
        # participation/economic assessment, not from an ex-ante declaration.
        assessment = next((
            row for row in reversed(state.trace)
            if row.get("action") == "participation_status" and
               row.get("outcome") == "APPLIED" and row.get("actor") == actor
               and row.get("participation_link") == link.key and
               row.get("participation_relation_revision") == link.source_revision
        ), None)
        if (assessment is None or assessment.get("evaluated_work") != pilot.key
                or assessment.get("evaluated_result_ref") != pilot.result_ref
                or assessment.get("evaluated_decision_at") != decision["at"]
                or assessment.get("org_revision") != state.institution.revision
                or assessment.get("participation_value") != "OPEN_TO_NEW_WORK"
                or type(assessment.get("at")) is not int or
                assessment["at"] >= at):
            return "FORMATION_EMERGENT_OWN_POST_RESULT_DECISION_REQUIRED"
        if not self._source_active(
            8, actor, assessment.get("formation_phase_source_ref"),
            state.institution.revision, at
        ):
            return "FORMATION_EMERGENT_OWN_EVALUATION_SOURCE_EXPIRED"
        return "NONE"

    def _result_conditioned_goal(self, state: Any,
                                 event: Mapping[str, Any],
                                 work: Any, at: int) -> str:
        """Requalify owner goal from ONE historical accepted need_emerge."""
        source = event.get("emergent_goal_source_ref")
        rows = [
            row for row in state.trace
            if row.get("action") == "need_emerge" and
               row.get("outcome") == "APPLIED" and
               row.get("work") == work.key and
               row.get("work_source_revision") == work.source_revision and
               row.get("actor") == work.customer and
               row.get("goal_source_ref") == source and
               row.get("org_revision") == state.institution.revision and
               row.get("pilot_work") == event.get("pilot_work") and
               type(row.get("at")) is int and row["at"] < at
        ]
        if len(rows) != 1:
            return "FORMATION_EMERGENT_ORIGINAL_OWNER_GOAL_EVENT_REQUIRED"
        goal = rows[0]
        if type(goal.get("goal_expires_at")) is not int or at >= goal["goal_expires_at"]:
            return "FORMATION_EMERGENT_ORIGINAL_GOAL_EXPIRED"
        # An incoming customer event names cooperation_link. The SAME
        # APPLIED request in original trace owns requested_cooperation_link.
        # Both refer to the source-declared relation, not different links.
        link_id = (event.get("cooperation_link") or
                   event.get("requested_cooperation_link"))
        if goal.get("cooperation_link") != link_id:
            return "FORMATION_EMERGENT_ORIGINAL_RELATION_MISMATCH"
        # A changed owner assessment makes the old owner goal out-of-date:
        # a new Work/source must then be independently proposed.
        last = next((
            row for row in reversed(state.trace)
            if row.get("action") == "participation_status" and
               row.get("outcome") == "APPLIED" and
               row.get("actor") == work.customer and
               row.get("participation_link") == link_id
        ), None)
        if (last is None or last.get("evaluated_work") != goal["pilot_work"]
                or type(last.get("at")) is not int or last["at"] >= goal["at"]
                or last.get("participation_value") != "OPEN_TO_NEW_WORK"):
            return "FORMATION_EMERGENT_OWNER_POSITION_CHANGED_AFTER_GOAL"
        return "NONE"

    def review_reconfiguration_proposal(self, state: Any,
                                        event: Mapping[str, Any],
                                        at: int) -> str:
        """An original consultation may respond to, but not edit, a Result.

        Proposal and all independent responses remain original cooperation
        events. No new relation, capacity, consent or economic result is made.
        """
        if not self.design.enforce_model_result_conditioned_reconfiguration:
            return "NONE"
        link = next((l for l in state.cooperation_links
                     if l.key == event.get("cooperation_link") and
                     l.source_revision == event.get("cooperation_source_revision")), None)
        if link is None:
            return "FORMATION_RECONFIGURATION_ORIGINAL_RELATION_REQUIRED"
        pilot = state.works.get(event.get("pilot_work"))
        if (pilot is None or pilot.key not in link.works or
                pilot.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"):
            return "FORMATION_RECONFIGURATION_ACCEPTED_PILOT_REQUIRED"
        if event.get("pilot_result_ref") != pilot.result_ref:
            return "FORMATION_RECONFIGURATION_PILOT_RESULT_REFERENCE_MISMATCH"
        reason, decision = self._original_result_decision(state, pilot, at)
        if reason != "NONE":
            return reason
        if (decision["action"] != "accept" or
                decision["at"] != event.get("pilot_decision_at")):
            return "FORMATION_RECONFIGURATION_PILOT_DECISION_TIME_MISMATCH"
        actor = event.get("actor")
        principals = self._resource_owners(state, pilot) | {pilot.customer}
        if actor not in principals:
            return "FORMATION_RECONFIGURATION_ORIGINAL_PILOT_PRINCIPAL_REQUIRED"
        source = event.get("change_source_ref")
        if (not isinstance(source, str) or
                not source.startswith("model://" + actor + "/")):
            return "FORMATION_RECONFIGURATION_ORIGINAL_PROPOSER_SOURCE_REQUIRED"
        for owner in sorted(principals):
            assessment = next((
                row for row in reversed(state.trace)
                if row.get("action") == "participation_status"
                and row.get("outcome") == "APPLIED"
                and row.get("actor") == owner
                and row.get("participation_link") == link.key
                and row.get("participation_relation_revision") == link.source_revision
            ), None)
            if (assessment is None or
                    assessment.get("evaluated_work") != pilot.key or
                    assessment.get("evaluated_result_ref") != pilot.result_ref or
                    assessment.get("evaluated_decision_at") != decision["at"] or
                    assessment.get("org_revision") != state.institution.revision or
                    type(assessment.get("at")) is not int or
                    not decision["at"] < assessment["at"] < at):
                return "FORMATION_RECONFIGURATION_EACH_ORIGINAL_OWNER_EVALUATION_REQUIRED"
            if not self._source_active(
                8, owner, assessment.get("formation_phase_source_ref"),
                state.institution.revision, at
            ):
                return "FORMATION_RECONFIGURATION_ORIGINAL_EVALUATION_SOURCE_EXPIRED"
        return "NONE"

    def _reconfiguration_proposal(self, state: Any, request: Mapping[str, Any],
                                   pilot: Any, at: int) -> tuple[str, Any]:
        """Read the one existing original proposal, not another governance ledger."""
        change_id = request.get("change_id")
        if not isinstance(change_id, str) or not change_id:
            return "FORMATION_RECONFIGURATION_ORIGINAL_CONSULTATION_REQUIRED", None
        matches = [
            row for row in state.trace
            if row.get("action") == "cooperation_change_propose"
            and row.get("outcome") == "APPLIED"
            and row.get("change_id") == change_id
            and type(row.get("at")) is int and row["at"] < at
        ]
        if len(matches) != 1:
            return "FORMATION_RECONFIGURATION_POST_RESULT_PROPOSAL_REQUIRED", None
        proposal = matches[0]
        requested_link = (request.get("cooperation_link")
                          or request.get("requested_cooperation_link"))
        requested_revision = (request.get("cooperation_source_revision")
                              or request.get("requested_cooperation_source_revision"))
        if (proposal.get("pilot_work") != pilot.key or
                proposal.get("pilot_result_ref") != pilot.result_ref or
                proposal.get("org_revision") != state.institution.revision):
            return "FORMATION_RECONFIGURATION_ORIGINAL_PROPOSAL_SCOPE_MISMATCH", None
        if (proposal.get("cooperation_link") != requested_link or
                proposal.get("cooperation_source_revision") != requested_revision):
            # A revised relationship legitimately has a DIFFERENT source
            # from its historical accepted pilot and original consultation.
            lineage = original_membership_predecessor(
                state.cooperation_links, state.trace,
                successor_id=requested_link, successor_revision=requested_revision,
                pilot=pilot, at=at, org_revision=state.institution.revision,
            )
            if (lineage is None
                    or lineage.get("change_id") != change_id
                    or lineage.get("cooperation_link") != proposal.get("cooperation_link")
                    or lineage.get("cooperation_source_revision") !=
                        proposal.get("cooperation_source_revision")):
                return "FORMATION_RECONFIGURATION_ORIGINAL_PROPOSAL_SCOPE_MISMATCH", None
        return "NONE", proposal

    def _source_qualified_capability_reconfiguration(
            self, state: Any, work: Any, pilot: Any,
            proposal: Mapping[str, Any], at: int) -> str:
        """Joint R1-P witness: adopted owner capability BEFORE consultation.

        Only Work requiring more than its ORIGINAL declared resource capacity
        uses this additional gate. All physical planning and authorizations
        remain in the existing CapacityLedger and original Work handlers.
        """
        if not self.design.enforce_model_result_conditioned_capability_cooperation:
            return "NONE"
        reason, decision = self._original_result_decision(state, pilot, at)
        if reason != "NONE":
            return reason
        if decision["action"] != "accept":
            return "FORMATION_CAPABILITY_ACCEPTED_ORIGINAL_PILOT_REQUIRED"
        pilot_at = decision["at"]
        proposal_at = proposal.get("at")
        if type(proposal_at) is not int or not pilot_at < proposal_at < at:
            return "FORMATION_CAPABILITY_PROPOSAL_AFTER_PILOT_REQUIRED"
        for need in work.resource_requirements:
            spec = state.capacity_ledger.specs[need.resource]
            if need.units <= spec.units:
                continue
            owner_policy = state.capability_policy
            if owner_policy is None:
                return "FORMATION_CAPABILITY_ORIGINAL_OWNER_ADOPTION_REQUIRED"
            matching = [
                (cap, owner_policy.applied[cap.key])
                for cap in owner_policy.declared.values()
                if (cap.resource == need.resource
                    and cap.owner == spec.owner
                    and work.key in cap.authorized_future_works
                    and cap.declared_units >= need.units
                    and cap.from_slot <= work.slot_start
                    and cap.to_slot >= work.slot_end
                    and cap.key in owner_policy.applied)
            ]
            if not matching:
                return "FORMATION_CAPABILITY_ORIGINAL_OWNER_ADOPTION_REQUIRED"
            eligible = [
                cap for cap, adopted_at in matching
                if pilot_at < adopted_at < proposal_at
            ]
            if not eligible:
                return "FORMATION_CAPABILITY_OWNER_ADOPTION_BEFORE_REVIEW_REQUIRED"
            if not any(
                owner_policy._original_source_status(state, cap, at) == "NONE"
                for cap in eligible
            ):
                return "FORMATION_CAPABILITY_OWNER_SOURCE_NO_LONGER_CURRENT"
        return "NONE"

    def recheck_reconfiguration_for_commit(self, state: Any, work: Any,
                                            at: int) -> str:
        if (not self.design.enforce_model_result_conditioned_reconfiguration
                or not work.requires_accepted):
            return "NONE"
        from .cooperation import cooperation_change_reviews
        requests = [
            row for row in state.trace
            if row.get("action") == "request"
            and row.get("outcome") == "APPLIED"
            and row.get("work") == work.key
            and type(row.get("at")) is int and row["at"] < at
        ]
        if len(requests) != 1:
            return "FORMATION_RECONFIGURATION_ORIGINAL_REQUEST_REQUIRED"
        request = requests[0]
        if not request.get("request_linked_change_id"):
            return "FORMATION_RECONFIGURATION_REVIEW_NOT_LINKED_TO_WORK"
        pilot = state.works.get(request.get("pilot_work"))
        if pilot is None:
            return "FORMATION_RECONFIGURATION_ACCEPTED_PILOT_REQUIRED"
        reason, proposal = self._reconfiguration_proposal(
            state, request | {"change_id": request["request_linked_change_id"]},
            pilot, at
        )
        if reason != "NONE":
            return reason
        reason = self._source_qualified_capability_reconfiguration(
            state, work, pilot, proposal, at
        )
        if reason != "NONE":
            return reason
        reviews = cooperation_change_reviews(
            state.cooperation_links, state.trace,
            current_org_revision=state.institution.revision,
            subjects=state.subjects,
        )
        row = next((
            item for item in reviews
            if item["change_id"] == proposal["change_id"]
            and item["link"] == proposal["cooperation_link"]
        ), None)
        if (row is None or row["review_status"] !=
                "MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION"):
            return "FORMATION_RECONFIGURATION_INDEPENDENT_REVIEW_NO_LONGER_CURRENT"
        # A new original review response AFTER the customer's request changes
        # the evidence against which old Work consents were given. Even if an
        # objection is later withdrawn, fresh principal consents must follow
        # the latest response; the old consent is never silently re-used.
        post_request = [
            event for event in state.trace
            if event.get("action") == "cooperation_change_response"
            and event.get("outcome") == "APPLIED"
            and event.get("change_id") == proposal["change_id"]
            and event.get("cooperation_link") == proposal["cooperation_link"]
            and type(event.get("at")) is int
            and request["at"] < event["at"] < at
        ]
        if post_request:
            review_epoch = max(event["at"] for event in post_request)
            for owner in sorted(self._resource_owners(state, work) | {work.customer}):
                if not any(
                    event.get("action") == "consent"
                    and event.get("outcome") == "APPLIED"
                    and event.get("actor") == owner
                    and event.get("work") == work.key
                    and event.get("org_revision") == state.institution.revision
                    and type(event.get("at")) is int
                    and review_epoch < event["at"] < at
                    for event in state.trace
                ):
                    return "FORMATION_RECONFIGURATION_FRESH_CONSENT_AFTER_REVIEW_REQUIRED"
        return "NONE"

    def before_followup_request(self, state: Any, request: Mapping[str, Any],
                                new_work: Any, at: int) -> str:
        """Require original separate evaluations before another linked Work.

        No automatic request, revision, Result, or governance act is created.
        This is checked *before* the caller mutates Work or relation membership.
        """
        if not self.design.enforce_model_formation_lifecycle:
            return "NONE"
        link_id = request.get("cooperation_link")
        if link_id is None:
            return ("FORMATION_FOLLOWUP_PILOT_WITHOUT_RELATION"
                    if request.get("pilot_work") is not None else "NONE")
        link = next((l for l in state.cooperation_links if l.key == link_id), None)
        if link is None:
            return "FORMATION_FOLLOWUP_COOPERATION_RELATION_UNKNOWN"
        completed = [
            (row, state.works[row["work"]])
            for row in state.trace
            if row.get("outcome") == "APPLIED"
            and row.get("action") == "accept"
            and row.get("work") in link.works
            and state.works[row["work"]].result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            and type(row.get("at")) is int and row["at"] < at
        ]
        lineage = None
        if not completed:
            # The first Work of a successor L1 has NO accepted Work within
            # L1. The causal pilot belongs to immutable L0: never bypass all
            # strict gates merely because the successor is initially empty.
            pilot = state.works.get(request.get("pilot_work"))
            if pilot is not None:
                lineage = original_membership_predecessor(
                    state.cooperation_links, state.trace,
                    successor_id=link.key, successor_revision=link.source_revision,
                    pilot=pilot, at=at, org_revision=state.institution.revision,
                )
            if lineage is not None:
                decisions = [
                    row for row in state.trace
                    if row.get("action") == "accept"
                    and row.get("outcome") == "APPLIED"
                    and row.get("work") == pilot.key
                    and row.get("at") == lineage["pilot_decision_at"]
                    and type(row.get("at")) is int and row["at"] < at
                ]
                if len(decisions) == 1:
                    completed = [(decisions[0], pilot)]
            if not completed:
                is_successor = any(
                    row.get("action") == "cooperation_membership_apply"
                    and row.get("outcome") == "APPLIED"
                    and row.get("successor_link") == link.key
                    for row in state.trace
                )
                if is_successor or request.get("pilot_work") is not None:
                    return "FORMATION_FOLLOWUP_ACCEPTED_PILOT_RESULT_REQUIRED"
                return "NONE"
        decision, pilot = completed[-1]
        if request.get("pilot_work") != pilot.key:
            return "FORMATION_FOLLOWUP_LATEST_ACCEPTED_PILOT_REFERENCE_REQUIRED"
        if pilot.key not in new_work.requires_accepted:
            return "FORMATION_FOLLOWUP_ACCEPTED_RESULT_DEPENDENCY_REQUIRED"
        if self.design.enforce_model_result_conditioned_goals:
            reason = self._result_conditioned_goal(state, request, new_work, at)
            if reason != "NONE":
                return reason
        reason, current_decision = self._original_result_decision(state, pilot, at)
        if reason != "NONE":
            return reason
        if current_decision["at"] != decision["at"]:
            return "FORMATION_FOLLOWUP_PILOT_RESULT_EVENT_STALE"
        original_owners = self._resource_owners(state, pilot) | {pilot.customer}
        for actor in sorted(original_owners):
            # Former members may still evaluate their OWN accepted history,
            # but do not acquire membership or consent in the successor.
            review_link_id = (link.key if actor in link.participants or lineage is None
                              else lineage["cooperation_link"])
            review_revision = (link.source_revision
                               if review_link_id == link.key
                               else lineage["cooperation_source_revision"])
            current = next((
                row for row in reversed(state.trace)
                if row.get("action") == "participation_status"
                and row.get("outcome") == "APPLIED"
                and row.get("actor") == actor
                and row.get("participation_link") == review_link_id
                and row.get("participation_relation_revision") == review_revision
            ), None)
            if current is None or current.get("evaluated_work") != pilot.key:
                return "FORMATION_FOLLOWUP_EACH_ORIGINAL_OWNER_EVALUATION_REQUIRED"
            if (current.get("evaluated_result_ref") != pilot.result_ref
                    or current.get("evaluated_decision_at") != decision["at"]
                    or current.get("evaluated_work_revision") != pilot.source_revision
                    or current.get("org_revision") != state.institution.revision
                    or type(current.get("at")) is not int
                    or current["at"] <= decision["at"] or current["at"] >= at):
                return "FORMATION_FOLLOWUP_OWNER_EVALUATION_STALE"
            if not self._source_active(
                    8, actor, current.get("formation_phase_source_ref"),
                    state.institution.revision, at):
                return "FORMATION_FOLLOWUP_OWNER_EVALUATION_SOURCE_EXPIRED"
        if self.design.enforce_model_result_conditioned_reconfiguration:
            reason, proposal = self._reconfiguration_proposal(
                state, request, pilot, at
            )
            if reason != "NONE":
                return reason
            reason = self._source_qualified_capability_reconfiguration(
                state, new_work, pilot, proposal, at
            )
            if reason != "NONE":
                return reason
        # Existing attach_requested_work / original consent guards still
        # enforce any owner's own PAUSED_NEW_WORK decision.
        return "NONE"

    def _interest_pilot(self, state: Any, work: Any, at: int):
        """Resolve ORIGINAL accepted pilot from the second Work's request."""
        requests = [
            row for row in state.trace
            if row.get("action") == "request"
            and row.get("outcome") == "APPLIED" and row.get("work") == work.key
            and type(row.get("at")) is int and row["at"] < at
        ]
        if len(requests) != 1:
            return "FORMATION_INTEREST_ORIGINAL_FOLLOWUP_REQUEST_REQUIRED", None, None
        request = requests[0]
        pilot = state.works.get(request.get("pilot_work"))
        if (pilot is None or pilot.key not in work.requires_accepted
                or pilot.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"):
            return "FORMATION_INTEREST_ACCEPTED_PILOT_REQUIRED", None, None
        link_id = request.get("requested_cooperation_link")
        link = next((link for link in state.cooperation_links
                     if link.key == link_id and work.key in link.works), None)
        if link is None or (
            pilot.key not in link.works
            and original_membership_predecessor(
                state.cooperation_links, state.trace,
                successor_id=link.key, successor_revision=link.source_revision,
                pilot=pilot, at=at, org_revision=state.institution.revision,
            ) is None
        ):
            return "FORMATION_INTEREST_ORIGINAL_LINK_REQUIRED", None, None
        reason, decision = self._original_result_decision(state, pilot, at)
        if reason != "NONE":
            return reason, None, None
        if decision["action"] != "accept":
            return "FORMATION_INTEREST_ACCEPTED_PILOT_REQUIRED", None, None
        return "NONE", (pilot, decision), request

    def _original_owner_interest(self, state: Any, work: Any,
                                 actor: str, at: int, *,
                                 current_event: Mapping[str, Any] | None = None) -> str:
        """An independent principal's interest may REFUSE a new obligation.

        Model economic preference does not establish actual outside profit.
        An old consent cannot bypass a later independent change of position.
        """
        reason, context, request = self._interest_pilot(state, work, at)
        if reason != "NONE":
            return reason
        pilot, decision = context
        relation = request["requested_cooperation_link"]
        principals = self._resource_owners(state, pilot) | {pilot.customer}
        entrant_assessment = None
        lineage = None
        if actor not in principals:
            lineage = original_membership_predecessor(
                state.cooperation_links, state.trace,
                successor_id=relation,
                successor_revision=request["requested_cooperation_source_revision"],
                pilot=pilot, at=at, org_revision=state.institution.revision,
            )
            if (lineage is None or
                    lineage.get("newly_admitted_model_party") != actor or
                    not lineage.get("new_entrant_independently_assessed_model_only")):
                return "FORMATION_INTEREST_NEW_PARTY_NEEDS_SEPARATE_PILOT_REVIEW"
            assessments_entrant = [
                row for row in state.trace
                if row.get("action") == "cooperation_entry_assess"
                and row.get("outcome") == "APPLIED"
                and row.get("actor") == actor
                and row.get("change_id") == lineage["change_id"]
                and row.get("cooperation_link") == lineage["cooperation_link"]
                and row.get("cooperation_source_revision") ==
                    lineage["cooperation_source_revision"]
                and row.get("org_revision") == state.institution.revision
                and type(row.get("at")) is int
                and row["at"] < lineage["at"] < at
            ]
            if not assessments_entrant:
                return "FORMATION_INTEREST_ENTRANT_OWN_ASSESSMENT_REQUIRED"
            entrant_assessment = assessments_entrant[-1]
            if (entrant_assessment.get("entry_willingness") != "WILLING"
                    or type(entrant_assessment.get("entry_valid_until")) is not int
                    or at >= entrant_assessment["entry_valid_until"]):
                return "FORMATION_INTEREST_ENTRANT_ASSESSMENT_NO_LONGER_CURRENT"
        assessments = [
            row for row in state.trace
            if row.get("action") == "participation_status"
            and row.get("outcome") == "APPLIED" and row.get("actor") == actor
            and row.get("participation_link") == relation
            and row.get("evaluated_work") == pilot.key
            and row.get("evaluated_result_ref") == pilot.result_ref
            and row.get("evaluated_decision_at") == decision["at"]
            and row.get("org_revision") == state.institution.revision
            and type(row.get("at")) is int and row["at"] < at
        ]
        if entrant_assessment is None:
            if not assessments:
                return "FORMATION_INTEREST_INDEPENDENT_RESULT_EVALUATION_REQUIRED"
            latest_assessment = assessments[-1]
            if (latest_assessment.get("participation_value") != "OPEN_TO_NEW_WORK"
                    or not self._source_active(
                        8, actor, latest_assessment.get("formation_phase_source_ref"),
                        state.institution.revision, at)):
                return "FORMATION_INTEREST_OWNER_EVALUATION_NO_LONGER_CURRENT"
        if current_event is not None:
            ev = current_event
            if entrant_assessment is None:
                if (ev.get("pilot_work") != pilot.key
                        or ev.get("pilot_result_ref") != pilot.result_ref
                        or ev.get("pilot_decision_at") != decision["at"]):
                    return "FORMATION_INTEREST_ORIGINAL_RESULT_BINDING_REQUIRED"
            elif (ev.get("pilot_work") is not None
                    or ev.get("pilot_result_ref") is not None
                    or ev.get("pilot_decision_at") is not None
                    or ev.get("entry_change_id") != lineage["change_id"]
                    or ev.get("entry_assessment_source_ref") !=
                        entrant_assessment["entry_assessment_source_ref"]):
                return "FORMATION_INTEREST_ENTRANT_OWN_SOURCE_BINDING_REQUIRED"
            source = ev.get("interest_evidence_ref")
            if (not isinstance(source, str) or
                    not source.startswith("model://" + actor + "/") or
                    len(source) <= len("model://" + actor + "/")):
                return "FORMATION_INTEREST_OWNER_SOURCE_REQUIRED"
            expiry = ev.get("interest_valid_until")
            if type(expiry) is not int or not at < expiry <= 10000:
                return "FORMATION_INTEREST_SOURCE_EXPIRY_REQUIRED"
            return "NONE"
        claims = [
            row for row in state.trace
            if row.get("action") == "interest_update"
            and row.get("outcome") == "APPLIED"
            and row.get("work") == work.key and row.get("actor") == actor
            and row.get("interest_source_revision") == work.source_revision
            and row.get("org_revision") == state.institution.revision
            and row.get("interest_relation") == relation
            and row.get("interest_relation_revision") ==
                request.get("requested_cooperation_source_revision")
            and (
                (entrant_assessment is None
                 and row.get("interest_pilot_work") == pilot.key
                 and row.get("interest_pilot_result_ref") == pilot.result_ref
                 and row.get("interest_pilot_decision_at") == decision["at"])
                or
                (entrant_assessment is not None
                 and row.get("interest_entry_change_id") == lineage["change_id"]
                 and row.get("interest_entry_assessment_source_ref") ==
                    entrant_assessment["entry_assessment_source_ref"])
            )
            and type(row.get("at")) is int and row["at"] < at
        ]
        if not claims:
            return "FORMATION_INTEREST_INDEPENDENT_OWNER_POSITION_REQUIRED"
        latest = claims[-1]
        if (type(latest.get("interest_valid_until")) is not int or
                at >= latest["interest_valid_until"]):
            return "FORMATION_INTEREST_OWNER_SOURCE_EXPIRED"
        if latest.get("interest_willingness") != "WILLING":
            return ("FORMATION_INTEREST_ORIGINAL_OWNER_DECLINES"
                    if latest.get("interest_willingness") == "DECLINES"
                    else "FORMATION_INTEREST_ORIGINAL_OWNER_UNDECIDED")
        if any(
            row.get("action") == "participation_status"
            and row.get("outcome") == "APPLIED" and row.get("actor") == actor
            and row.get("participation_link") == relation
            and type(row.get("at")) is int and latest["at"] < row["at"] < at
            for row in state.trace
        ):
            return "FORMATION_INTEREST_OWNER_RECONSIDERED_AFTER_POSITION"
        # The consent is still the ORIGINAL independent legal/model action,
        # not an economic assertion. Require a NEW consent after the owner's
        # latest preference to prevent laundering earlier consent.
        if not any(
            row.get("action") == "consent" and row.get("outcome") == "APPLIED"
            and row.get("work") == work.key and row.get("actor") == actor
            and row.get("org_revision") == state.institution.revision
            and type(row.get("at")) is int and latest["at"] < row["at"] < at
            for row in state.trace
        ):
            return "FORMATION_INTEREST_CONSENT_MUST_FOLLOW_LATEST_OWNER_POSITION"
        return "NONE"

    def review_original_interest_event(self, state: Any,
                                      event: Mapping[str, Any], at: int) -> str:
        if not self.design.enforce_model_result_conditioned_interests:
            return "NONE"
        work = state.works.get(event.get("work"))
        if work is None or not work.requires_accepted:
            return "NONE"
        return self._original_owner_interest(
            state, work, event["actor"], at, current_event=event
        )

    def _all_original_interests_ready(self, state: Any,
                                      work: Any, at: int) -> str:
        if (not self.design.enforce_model_result_conditioned_interests or
                not work.requires_accepted):
            return "NONE"
        for actor in sorted(self._resource_owners(state, work) | {work.customer}):
            reason = self._original_owner_interest(state, work, actor, at)
            if reason != "NONE":
                return reason
        return "NONE"

    def before_commit(self, state: Any, work: Any, at: int,
                      *, include_agent: bool = True) -> str:
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
        if self.design.enforce_model_formation_context_code:
            reason = self._all_cores_ready(state, work, at)
            if reason != "NONE":
                return reason
            if not self._org_code_active(state, at):
                return "FORMATION_OC_THIRTEEN_ORIGINAL_CODE_CONTROLS_NOT_ACTIVE"
            for founder in sorted(state.institution.founders):
                if not state.subjects[founder].active:
                    return "FORMATION_OC_ORIGINAL_FOUNDER_NOT_ACTIVE"
                reason = self._ack_status(state, work, 5, founder, at)
                if reason != "NONE":
                    return reason
        if include_agent and self.design.enforce_model_formation_agent_review:
            reason = self._phase_six_ready(state, work, at)
            if reason != "NONE":
                return reason
        if include_agent:
            reason = self._all_original_interests_ready(state, work, at)
            if reason != "NONE":
                return reason
            return self.recheck_reconfiguration_for_commit(state, work, at)
        return "NONE"



def parse_general_system(raw: Any, subjects: Mapping[str, Any],
                         known_works: Mapping[str, Any],
                         *, catalog: Mapping[str, Any] | None = None) -> GeneralSystemDesign:
    """Bind source-declared theoretical parameters to original subject/work keys."""
    cat = author_catalog() if catalog is None else catalog
    required = {"configuration", "morphology", "goals", "organizational_code",
                "formation_phases", "context_cores", "agent_functions"}
    if (not isinstance(raw, dict) or not required <= set(raw) or
            set(raw) - required - {"enforce_model_org_code", "enforce_model_formation_phases",
                                   "enforce_model_formation_context_code",
                                   "enforce_model_formation_agent_review",
                                   "enforce_model_formation_lifecycle",
                                   "enforce_model_result_conditioned_goals",
                                   "enforce_model_result_conditioned_interests",
                                   "enforce_model_result_conditioned_reconfiguration",
                                   "enforce_model_result_conditioned_capability_cooperation"}):
        raise GeneralSystemInputError("INVALID_GENERAL_DESIGN_FIELDS")
    enforce_model_code = raw.get("enforce_model_org_code", False)
    if type(enforce_model_code) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_OC_ENFORCEMENT_MUST_BE_BOOLEAN")
    enforce_formation = raw.get("enforce_model_formation_phases", False)
    if type(enforce_formation) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_FORMATION_ENFORCEMENT_MUST_BE_BOOLEAN")
    enforce_institutional = raw.get("enforce_model_formation_context_code", False)
    if type(enforce_institutional) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_CONTEXT_CODE_ENFORCEMENT_MUST_BE_BOOLEAN")
    if enforce_institutional and not (enforce_formation and enforce_model_code):
        raise GeneralSystemInputError("FORMATION_CONTEXT_CODE_REQUIRES_PHASE_AND_OC_GATES")
    enforce_agent = raw.get("enforce_model_formation_agent_review", False)
    if type(enforce_agent) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_AGENT_REVIEW_GATE_MUST_BE_BOOLEAN")
    if enforce_agent and not enforce_institutional:
        raise GeneralSystemInputError("FORMATION_AGENT_REVIEW_REQUIRES_KPB_OC_GATES")
    enforce_lifecycle = raw.get("enforce_model_formation_lifecycle", False)
    if type(enforce_lifecycle) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_LIFECYCLE_GATE_MUST_BE_BOOLEAN")
    if enforce_lifecycle and not enforce_agent:
        raise GeneralSystemInputError("FORMATION_LIFECYCLE_REQUIRES_ORIGINAL_AGENT_REVIEW")
    enforce_emergent = raw.get("enforce_model_result_conditioned_goals", False)
    if type(enforce_emergent) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_RESULT_GOAL_GATE_MUST_BE_BOOLEAN")
    if enforce_emergent and not enforce_lifecycle:
        raise GeneralSystemInputError("FORMATION_EMERGENT_NEED_REQUIRES_RESULT_LIFECYCLE")
    enforce_interests = raw.get("enforce_model_result_conditioned_interests", False)
    if type(enforce_interests) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_RESULT_INTEREST_GATE_MUST_BE_BOOLEAN")
    if enforce_interests and not enforce_emergent:
        raise GeneralSystemInputError("FORMATION_INTEREST_REQUIRES_RESULT_CONDITIONED_GOALS")
    enforce_reconfiguration = raw.get(
        "enforce_model_result_conditioned_reconfiguration", False
    )
    if type(enforce_reconfiguration) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_RECONFIGURATION_GATE_MUST_BE_BOOLEAN")
    if enforce_reconfiguration and not enforce_interests:
        raise GeneralSystemInputError("FORMATION_RECONFIGURATION_REQUIRES_INDIVIDUAL_INTERESTS")
    enforce_capability_cooperation = raw.get(
        "enforce_model_result_conditioned_capability_cooperation", False
    )
    if type(enforce_capability_cooperation) is not bool:
        raise GeneralSystemInputError("GENERAL_MODEL_CAPABILITY_COOPERATION_GATE_MUST_BE_BOOLEAN")
    if enforce_capability_cooperation and not enforce_reconfiguration:
        raise GeneralSystemInputError("FORMATION_CAPABILITY_COOPERATION_REQUIRES_RESULT_RECONFIGURATION")
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
                               enforce_model_code, enforce_formation,
                               enforce_institutional, enforce_agent,
                               enforce_lifecycle, enforce_emergent,
                               enforce_interests, enforce_reconfiguration,
                               enforce_capability_cooperation)


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
    # R1-T: the current prospective thirteen-field edition is not the
    # historical baseline declaration. A LIVE projection reads exactly the
    # original model's currently installed source edition; older archived
    # original read_only_evolution snapshots still keep their old evidence.
    if model_code is not None and getattr(
        state, "model_org_code_edition", "BASE"
    ) != "BASE":
        valid["organizational_code"] = [
            row for row in model_code.records.values()
            if row["revision"] == state.institution.revision
            and row["available_at"] <= at < row["expires_at"]
        ]
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
            "original_model_source_edition": getattr(
                state, "model_org_code_edition", "BASE"
            ),
            "accepted_prospective_model_editions": sum(
                row.get("action") == "model_code_apply"
                and row.get("outcome") == "APPLIED"
                for row in state.trace
            ),
            "source_qualified_founder_model_responses": sum(
                row.get("action") == "model_code_response"
                and row.get("outcome") == "APPLIED"
                for row in state.trace
            ),
            "historical_institutional_revision_unmodified_by_model_editions": True,
            "newcomer_role_legal_authority": "NOT_VERIFIED",
        },
        "formation_phases": phase_rows,
        "result_capability_cooperation_gate": {
            "opted_in": design.enforce_model_result_conditioned_capability_cooperation,
            "original_owner_capability_actions": sum(
                row.get("action") == "adopt_capability"
                and row.get("outcome") == "APPLIED"
                for row in state.trace
            ),
            "additional_resource_rights_created": False,
            "original_owner_capacity_ledger_reused": True,
            "measured_real_productivity_gain_established": False,
            "complete_six_organizational_configurations": False,
        },
        "post_result_cooperation_reconfiguration": {
            "opted_in": design.enforce_model_result_conditioned_reconfiguration,
            "original_result_conditioned_proposals": sum(
                row.get("action") == "cooperation_change_propose" and
                row.get("outcome") == "APPLIED" and
                row.get("pilot_work") is not None
                for row in state.trace
            ),
            "work_requests_citing_prior_original_review": sum(
                row.get("action") == "request" and
                row.get("outcome") == "APPLIED" and
                row.get("request_linked_change_id") is not None
                for row in state.trace
            ),
            "new_membership_or_legal_rights_created_by_consultation": False,
            "original_prior_results_modified": False,
            "real_transaction_savings_established": False,
            "six_organizational_forms_implemented": False,
            "full_coalition_transformation_complete": False,
        },
        "result_conditioned_owner_interests": {
            "opted_in": design.enforce_model_result_conditioned_interests,
            "original_individual_interest_claims": sum(
                row.get("action") == "interest_update" and
                row.get("outcome") == "APPLIED" and
                row.get("interest_pilot_work") is not None
                for row in state.trace
            ),
            "result_conditioned_owner_declines": sum(
                row.get("action") == "interest_update" and
                row.get("outcome") == "APPLIED" and
                row.get("interest_pilot_work") is not None and
                row.get("interest_willingness") == "DECLINES"
                for row in state.trace
            ),
            "outside_option_preferences_not_verified_profit": True,
            "real_market_price_or_owner_profit_proven": False,
            "old_accepted_obligations_immutable": True,
            "all_organizational_forms_executable": False,
            "general_interest_learning_dynamics_complete": False,
        },
        "result_conditioned_owner_goals": {
            "opted_in": design.enforce_model_result_conditioned_goals,
            "owner_origination_events": sum(
                row.get("action") == "need_emerge" and
                row.get("outcome") == "APPLIED" for row in state.trace
            ),
            "new_original_works_created_by_goal_event": False,
            "owner_source_authenticated_externally": False,
            "automatic_actor_need_or_demand_generation": False,
            "whole_system_endogenous_need_dynamics_complete": False,
        },
        "post_result_lifecycle_model_gate": {
            "opted_in": design.enforce_model_formation_lifecycle,
            "original_customer_result_acceptances": sum(
                row.get("action") == "accept" and
                row.get("outcome") == "APPLIED" for row in state.trace
            ),
            "original_customer_result_rejections": sum(
                row.get("action") == "reject" and
                row.get("outcome") == "APPLIED" for row in state.trace
            ),
            "independent_owner_post_result_evaluations": sum(
                row.get("action") == "participation_status" and
                row.get("outcome") == "APPLIED" and
                "evaluated_work" in row for row in state.trace
            ),
            "adverse_owner_economic_judgments": sum(
                row.get("action") == "participation_status" and
                row.get("outcome") == "APPLIED" and
                row.get("evaluation_verdict") == "ADVERSE_DECLARED"
                for row in state.trace
            ),
            "accepted_followup_work_requests": sum(
                row.get("action") == "request" and
                row.get("outcome") == "APPLIED" and
                row.get("pilot_work") is not None for row in state.trace
            ),
            "real_economic_effect_established": False,
            "original_results_modified_by_evaluation": False,
            "all_eight_author_phases_executable": False,
        },
        "agent_function_formation_model_gate": {
            "opted_in": design.enforce_model_formation_agent_review,
            "original_bounded_preparations": sum(
                row.get("action") == "function_prepare"
                and row.get("outcome") == "APPLIED" for row in state.trace
            ),
            "independent_original_customer_approvals": sum(
                row.get("action") == "function_review"
                and row.get("outcome") == "APPLIED"
                and row.get("human_decision") == "APPROVE" for row in state.trace
            ),
            "independent_original_customer_rejections": sum(
                row.get("action") == "function_review"
                and row.get("outcome") == "APPLIED"
                and row.get("human_decision") == "REJECT" for row in state.trace
            ),
            "full_author_A_F_P_OC_KPB_implemented": False,
            "automatic_original_business_action": False,
            "authenticated_human_decision": False,
            "all_eight_author_phases_executable": False,
        },
        "context_and_code_formation_model_gate": {
            "opted_in": design.enforce_model_formation_context_code,
            "four_original_context_core_confirmations": sum(
                row.get("phase") == 4 for row in formation_applied
            ),
            "original_founder_code_confirmations": sum(
                row.get("phase") == 5 for row in formation_applied
            ),
            "all_four_context_cores_and_thirteen_code_fields_legal": False,
            "real_original_scope_authentication": False,
            "all_eight_author_phases_executable": False,
            "new_principal_or_legal_power_created": False,
        },
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
                # A later source revocation changes FUTURE eligibility, not
                # whether the already-accepted original Work used the
                # owner-adopted capacity when it was qualified.
                if follow_on
                else "NO_QUALIFIED_HISTORICAL_CAPABILITY_TO_ACCEPTED_WORK_SEQUENCE"
            ),
            "owner_declared_capacity_not_field_verified": True,
            "future_owner_source_still_current_at_horizon": bool(
                cap["available_for_new_original_work"]
            ),
            "no_new_original_work_or_permission_created": True,
        })

    # R1-O: a COMPLETE institutional reproduction witness must be a single,
    # chronologically coherent ORIGINAL history. Independent model declarations
    # and separate positive outcomes are not enough. This read-only projection
    # does not modify the old coalition, Work, Result, owner interest or money.
    institutional_witnesses = []
    for req in events:
        if (req.get("action") != "request" or
                not req.get("pilot_work") or
                not req.get("request_linked_change_id")):
            continue
        new_key, pilot_key = req["work"], req["pilot_work"]
        new_work = original.works.get(new_key)
        pilot = original.works.get(pilot_key)
        t_req = req["at"]
        t_pilot = accepted_at.get(pilot_key)
        t_commit = original_committed_at.get(new_key)
        if t_commit is None:
            # Keep the failed original attempt as an INCOMPLETE witness. A
            # denied Work is evidence of system rejection, not a completed
            # reproduction cycle and not an accepted original obligation.
            blocked_attempts = [
                row for row in original.trace
                if row.get("action") == "commit"
                and row.get("work") == new_key
                and row.get("outcome") == "BLOCKED"
                and type(row.get("at")) is int
                and row["at"] > t_req
            ]
            if blocked_attempts:
                t_commit = blocked_attempts[-1]["at"]
        if (pilot is None or new_work is None or
                t_pilot is None or t_commit is None):
            continue
        originals = original.capacity_ledger.original_owners(
            pilot.resource_requirements
        ) | {pilot.customer}
        next_owners = original.capacity_ledger.original_owners(
            new_work.resource_requirements
        ) | {new_work.customer}
        change = req["request_linked_change_id"]
        proposals = [
            row for row in events
            if row.get("action") == "cooperation_change_propose"
            and row.get("change_id") == change
            and row.get("cooperation_link") ==
                req.get("requested_cooperation_link")
            and row.get("cooperation_source_revision") ==
                req.get("requested_cooperation_source_revision")
            and row.get("pilot_work") == pilot_key
            and row.get("pilot_result_ref") == pilot.result_ref
            and row.get("pilot_decision_at") == t_pilot
            and row.get("actor") in originals
            and t_pilot < row["at"] < t_req
        ]
        proposal = proposals[0] if len(proposals) == 1 else None
        t_proposal = proposal["at"] if proposal else None
        original_reviews = bool(proposal) and all(
            any(
                row.get("action") == "participation_status"
                and row.get("actor") == owner
                and row.get("participation_link") ==
                    proposal["cooperation_link"]
                and row.get("evaluated_work") == pilot_key
                and row.get("evaluated_result_ref") == pilot.result_ref
                and row.get("evaluated_decision_at") == t_pilot
                and t_pilot < row["at"] < t_proposal
                for row in events
            ) for owner in originals
        )
        consultation_before_request = False
        current_consultation_at_commit = False
        last_post_request_response = None
        if proposal is not None:
            required = set(proposal.get("original_consultees") or ())
            frozen_parties = set(
                proposal.get("original_relation_participants") or ()
            )
            link = next((
                item for item in original.cooperation_links
                if item.key == proposal["cooperation_link"]
            ), None)
            last_at_request = {}
            last_at_commit = {}
            if required and link is not None and frozen_parties == set(
                    link.participants):
                for row in events:
                    if (row.get("action") == "cooperation_change_response"
                            and row.get("change_id") == change
                            and row.get("cooperation_link") == link.key
                            and row.get("actor") in required
                            and t_proposal < row["at"] < t_req):
                        last_at_request[row["actor"]] = row
                    if (row.get("action") == "cooperation_change_response"
                            and row.get("change_id") == change
                            and row.get("cooperation_link") == link.key
                            and row.get("actor") in required
                            and t_proposal < row["at"] < t_commit):
                        last_at_commit[row["actor"]] = row
                        if t_req < row["at"]:
                            last_post_request_response = row["at"]
                consultation_before_request = (
                    set(last_at_request) == required and all(
                        row["change_decision"] == "SUPPORT_MODEL_PROPOSAL"
                        for row in last_at_request.values()
                    )
                )
                current_consultation_at_commit = (
                    set(last_at_commit) == required and all(
                        row["change_decision"] == "SUPPORT_MODEL_PROPOSAL"
                        for row in last_at_commit.values()
                    )
                )
        owner_goal = any(
            row.get("action") == "need_emerge"
            and row.get("actor") == new_work.customer
            and row.get("work") == new_key
            and row.get("work_source_revision") == new_work.source_revision
            and row.get("pilot_work") == pilot_key
            and row.get("pilot_result_ref") == pilot.result_ref
            and row.get("goal_source_ref") == req.get("emergent_goal_source_ref")
            and type(row.get("goal_expires_at")) is int
            and row["goal_expires_at"] > t_req
            and t_pilot < row["at"] < t_req
            for row in events
        )
        owner_interests_and_consents = True
        for owner in sorted(next_owners):
            interest = next((
                row for row in reversed(events)
                if row.get("action") == "interest_update"
                and row.get("actor") == owner and row.get("work") == new_key
                and row.get("interest_relation") ==
                    req.get("requested_cooperation_link")
                and row.get("interest_pilot_work") == pilot_key
                and row.get("interest_pilot_result_ref") == pilot.result_ref
                and row.get("interest_pilot_decision_at") == t_pilot
                and row.get("interest_source_revision") ==
                    new_work.source_revision
                and row.get("interest_willingness") == "WILLING"
                and type(row.get("interest_valid_until")) is int
                and t_req < row["at"] < t_commit
                and row["interest_valid_until"] > t_commit
            ), None)
            if not interest:
                owner_interests_and_consents = False
                break
            min_consent_time = max(
                interest["at"], last_post_request_response or -1
            )
            if not any(
                row.get("action") == "consent"
                and row.get("actor") == owner and row.get("work") == new_key
                and row.get("org_revision") ==
                    original.institution.revision
                and min_consent_time < row["at"] < t_commit
                for row in events
            ):
                owner_interests_and_consents = False
                break
        second_result_accepted = bool(
            new_work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            and new_key in accepted_at
            and t_pilot < t_req < t_commit < accepted_at[new_key]
            and pilot_key in new_work.requires_accepted
        )
        qualified = bool(
            proposal and original_reviews and consultation_before_request
            and current_consultation_at_commit and owner_goal
            and owner_interests_and_consents and second_result_accepted
        )
        institutional_witnesses.append({
            "original_pilot_work": pilot_key,
            "following_original_work": new_key,
            "original_cooperation_change_id": change,
            "all_original_pilot_principals_evaluated_before_change": bool(
                original_reviews
            ),
            "original_consultation_complete_before_request": bool(
                consultation_before_request
            ),
            "independent_review_still_current_at_commit": bool(
                current_consultation_at_commit
            ),
            "owner_goal_created_after_original_result": bool(owner_goal),
            "individual_interests_and_fresh_consents_confirmed": bool(
                owner_interests_and_consents
            ),
            "second_original_result_accepted_after_new_commit": bool(
                second_result_accepted
            ),
            "model_institutional_reproduction_witness": (
                "ORIGINAL_ACCEPTED_RESULT_TO_OWNER_EVALUATIONS_COOPERATION_REVIEW"
                "_TO_NEW_GOAL_INTEREST_CONSENT_AND_ACCEPTED_RESULT"
                if qualified else "NOT_CAUSALLY_QUALIFIED"
            ),
            "actual_membership_change_or_profit_verified": False,
        })

    # Join two PREEXISTING source-bound witnesses in the SAME ORIGINAL trace.
    # A separate success in capacity or consultation is never enough: the
    # adopted capacity must make that exact next original Work feasible AFTER
    # its preceding Result and BEFORE independent change deliberation.
    joined_capability_institutional = []
    capability_by_id = {
        row["id"]: row
        for row in final_output.get("capability_dynamics", {}).get(
            "declarations", []
        )
    }
    for institutional in institutional_witnesses:
        if (institutional["model_institutional_reproduction_witness"] ==
                "NOT_CAUSALLY_QUALIFIED"):
            continue
        preceding = institutional["original_pilot_work"]
        following = institutional["following_original_work"]
        work = original.works[following]
        proposal_times = [
            row["at"] for row in events
            if row.get("action") == "cooperation_change_propose"
            and row.get("change_id") ==
                institutional["original_cooperation_change_id"]
            and row.get("pilot_work") == preceding
            and row.get("pilot_result_ref") ==
                original.works[preceding].result_ref
        ]
        if len(proposal_times) != 1:
            continue
        t_proposal = proposal_times[0]
        for cap in capability_witnesses:
            declaration = capability_by_id.get(
                cap["model_capability_declaration"]
            )
            if (not declaration or
                    cap["model_reproduction_sequence"] !=
                    "ORIGINAL_ACCEPTED_RESULT_REUSE_OWNER_ADOPTION_AND_LATER_ACCEPTED_WORK"
                    or following not in cap["later_original_accepted_work_ids"]):
                continue
            t_adoption = cap["original_owner_adopted_at"]
            source_resource = declaration["resource"]
            requested_increase = any(
                need.resource == source_resource
                and need.units > original.capacity_ledger.specs[
                    source_resource
                ].units
                and need.units <= declaration[
                    "prospective_units_if_owner_adopted"
                ]
                for need in work.resource_requirements
            )
            if (not requested_increase or
                    t_adoption is None or
                    not accepted_at[preceding] < t_adoption < t_proposal):
                continue
            joined_capability_institutional.append({
                "preceding_original_result": preceding,
                "following_original_accepted_work": following,
                "original_owner": cap["original_resource_owner"],
                "original_owner_capability_declaration": cap[
                    "model_capability_declaration"
                ],
                "original_cooperation_change_id": institutional[
                    "original_cooperation_change_id"
                ],
                "actual_capacity_or_economic_effect_verified": False,
                "future_owner_source_still_current_at_horizon": bool(
                    declaration["available_for_new_original_work"]
                ),
                "original_shared_capacity_ledger_reused": True,
                "owner_control_and_consent_preserved": True,
            })

    # R1-Q: a prospective membership change is an APPLIED original event
    # creating a distinct successor in the EXISTING cooperation_links tuple.
    # Only a later independently requested and accepted Work on that successor
    # demonstrates model reproduction, not the membership revision alone.
    original_coalition_successions = []
    relation_index = {link.key: link for link in original.cooperation_links}
    for revision in events:
        if revision.get("action") != "cooperation_membership_apply":
            continue
        parent = relation_index.get(revision.get("cooperation_link"))
        successor = relation_index.get(revision.get("successor_link"))
        pilot_id = revision.get("pilot_work")
        pilot = original.works.get(pilot_id)
        t_change = revision.get("at")
        prior_pilot = (
            parent is not None and successor is not None and
            pilot is not None and pilot_id in parent.works and
            pilot_id in accepted_at and accepted_at[pilot_id] < t_change and
            pilot.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT" and
            pilot.result_ref == revision.get("pilot_result_ref") and
            revision.get("pilot_decision_at") == accepted_at[pilot_id]
        )
        frozen = bool(
            parent is not None and successor is not None
            and set(revision.get("previous_participants") or ()) ==
                set(parent.participants)
            and set(revision.get("successor_participants") or ()) ==
                set(successor.participants)
            and successor.source_revision == revision.get("successor_revision")
            and not any(work in parent.works for work in successor.works)
        )
        new_accepted = []
        if prior_pilot and frozen:
            for work_id in successor.works:
                work = original.works[work_id]
                request = [
                    row for row in events
                    if row.get("action") == "request"
                    and row.get("work") == work_id
                    and row.get("actor") == work.customer
                    and row.get("requested_cooperation_link") == successor.key
                    and row.get("requested_cooperation_source_revision") ==
                        successor.source_revision
                    and t_change < row["at"]
                ]
                t_request = request[0]["at"] if len(request) == 1 else None
                t_commit = original_committed_at.get(work_id)
                t_accept = accepted_at.get(work_id)
                owners = original.capacity_ledger.original_owners(
                    work.resource_requirements
                ) | {work.customer}
                if (t_request is not None and t_commit is not None
                        and t_accept is not None
                        and t_change < t_request < t_commit < t_accept
                        and pilot_id in work.requires_accepted
                        and work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                        and set(work.consents) == owners
                        and owners.issubset(successor.participants)):
                    new_accepted.append(work_id)
        qualified = bool(prior_pilot and frozen and new_accepted)
        original_coalition_successions.append({
            "original_cooperation_link": revision.get("cooperation_link"),
            "prospective_successor_link": revision.get("successor_link"),
            "original_accepted_pilot_work": pilot_id,
            "change_kind": revision.get("change_kind"),
            "successor_membership_frozen_in_original_event": frozen,
            "accepted_pilot_precedes_original_membership_revision": bool(
                prior_pilot
            ),
            "new_original_accepted_work_ids": sorted(new_accepted),
            "source_scoped_model_membership_reproduction": (
                "ORIGINAL_RESULT_CONSULTATION_NEW_MEMBER_REVISION_FRESH_WORK_ACCEPTED"
                if qualified else "NO_QUALIFIED_SUCCESSOR_WORK"
            ),
            "original_prior_Work_Result_consent_preserved": True,
            "new_legal_membership_or_original_asset_rights_verified": False,
            "real_coalition_transaction_savings_verified": False,
        })

    # R1-S: a stricter, read-only witness. Counting accepted successor Work
    # alone (R1-Q) is insufficient: the SAME source-bound trace must also
    # show the goal, prior owners' judgments, adopted productive capacity,
    # original consultation, newcomer-owned input and own Work consent.
    # This is MODEL_ONLY and never upgrades all nine to completed status.
    strict_successor_links: list[dict[str, Any]] = []
    all_strict_gates = all((
        design.enforce_model_formation_lifecycle,
        design.enforce_model_result_conditioned_goals,
        design.enforce_model_result_conditioned_interests,
        design.enforce_model_result_conditioned_reconfiguration,
        design.enforce_model_result_conditioned_capability_cooperation,
    ))
    if all_strict_gates:
        for revision in events:
            if (revision.get("action") != "cooperation_membership_apply"
                    or revision.get("change_kind") != "ADD_FUTURE_PARTICIPANT"
                    or not revision.get("new_entrant_independently_assessed_model_only")):
                continue
            parent = relation_index.get(revision.get("cooperation_link"))
            successor = relation_index.get(revision.get("successor_link"))
            pilot_id = revision.get("pilot_work")
            pilot = original.works.get(pilot_id)
            entrant = revision.get("newly_admitted_model_party")
            if parent is None or successor is None or pilot is None:
                continue
            t_change = revision["at"]
            t_pilot = accepted_at.get(pilot_id)
            if t_pilot is None or not t_pilot < t_change:
                continue
            proposal = [
                row for row in events
                if row.get("action") == "cooperation_change_propose"
                and row.get("change_id") == revision["change_id"]
                and row.get("cooperation_link") == parent.key
                and row.get("pilot_work") == pilot_id
                and t_pilot < row["at"] < t_change
            ]
            if len(proposal) != 1:
                continue
            earlier_owners = original.capacity_ledger.original_owners(
                pilot.resource_requirements
            ) | {pilot.customer}
            for work_id in successor.works:
                work = original.works[work_id]
                owners = original.capacity_ledger.original_owners(
                    work.resource_requirements
                ) | {work.customer}
                if (work_id not in accepted_at or entrant not in owners
                        or entrant not in successor.participants
                        or pilot_id not in work.requires_accepted
                        or set(work.consents) != owners):
                    continue
                matching_requests = [
                    row for row in events
                    if row.get("action") == "request"
                    and row.get("work") == work_id
                    and row.get("request_linked_change_id") == revision["change_id"]
                    and row.get("request_original_predecessor_link") == parent.key
                    and row.get("requested_cooperation_link") == successor.key
                    and row.get("requested_cooperation_source_revision") ==
                        successor.source_revision
                    and t_change < row["at"] < accepted_at[work_id]
                ]
                if len(matching_requests) != 1:
                    continue
                request = matching_requests[0]
                t_request = request["at"]
                t_commit = original_committed_at.get(work_id)
                if t_commit is None or not t_request < t_commit < accepted_at[work_id]:
                    continue
                needs = [
                    row for row in events
                    if row.get("action") == "need_emerge"
                    and row.get("actor") == work.customer
                    and row.get("work") == work_id
                    and row.get("cooperation_link") == successor.key
                    and row.get("cooperation_source_revision") ==
                        successor.source_revision
                    and row.get("pilot_work") == pilot_id
                    and row.get("pilot_result_ref") == pilot.result_ref
                    and row.get("goal_source_ref") ==
                        request.get("emergent_goal_source_ref")
                    and t_change < row["at"] < t_request
                ]
                if len(needs) != 1:
                    continue
                if not all(any(
                    row.get("action") == "participation_status"
                    and row.get("actor") == owner
                    and row.get("evaluated_work") == pilot_id
                    and row.get("evaluated_result_ref") == pilot.result_ref
                    and row.get("participation_link") == (
                        successor.key if owner in successor.participants else parent.key
                    )
                    and row.get("participation_value") == "OPEN_TO_NEW_WORK"
                    and t_pilot < row["at"] < t_request
                    for row in events
                ) for owner in earlier_owners):
                    continue
                adopted = [
                    row for row in events
                    if row.get("action") == "adopt_capability"
                    and t_pilot < row["at"] < proposal[0]["at"]
                    and any(
                        need.resource == row.get("resource")
                        and need.units >
                            original.capacity_ledger.specs[need.resource].units
                        for need in work.resource_requirements
                    )
                ]
                if not adopted:
                    continue
                entry_interests = [
                    row for row in events
                    if row.get("action") == "interest_update"
                    and row.get("work") == work_id
                    and row.get("actor") == entrant
                    and row.get("interest_willingness") == "WILLING"
                    and row.get("interest_entry_change_id") == revision["change_id"]
                    and row.get("interest_relation") == successor.key
                    and t_request < row["at"] < t_commit
                ]
                if not entry_interests or not any(
                    row.get("action") == "consent"
                    and row.get("work") == work_id
                    and row.get("actor") == entrant
                    and entry_interests[-1]["at"] < row["at"] < t_commit
                    for row in events
                ):
                    continue
                strict_successor_links.append({
                    "original_parent_relation": parent.key,
                    "original_successor_relation": successor.key,
                    "accepted_parent_pilot_work": pilot_id,
                    "accepted_successor_work": work_id,
                    "entrant_resource_principal": entrant,
                    "entrant_interest_is_own_not_borrowed_result": True,
                    "original_accepted_work_distinct_and_consented": True,
                    "owner_adopted_capability_before_change": True,
                    "all_r1_m_to_r1_p_strict_original_gates_enabled": True,
                    "real_legal_rights_or_measured_economic_gain_verified": False,
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
    original_institutional_sequences = sum(
        row["model_institutional_reproduction_witness"]
        != "NOT_CAUSALLY_QUALIFIED"
        for row in institutional_witnesses
    )
    original_membership_successions = sum(
        row["source_scoped_model_membership_reproduction"]
        != "NO_QUALIFIED_SUCCESSOR_WORK"
        for row in original_coalition_successions
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
        "ЖЦ": bool(
            linked_needs or current_capacity_sequences
            or original_institutional_sequences or original_membership_successions
        ),
    }
    assert tuple(current_partial_observation) == COMPONENTS
    return {
        "private_research_witnesses": {
            "source_declared_follow_on_need_links": need_witnesses,
            "owner_adopted_capability_reuse_links": capability_witnesses,
            "original_post_result_institutional_reproduction_links": (
                institutional_witnesses
            ),
            "owner_capability_and_institutional_reproduction_links": (
                joined_capability_institutional
            ),
            "original_coalition_membership_successions": (
                original_coalition_successions
            ),
            "strict_original_entrant_resource_successor_links": (
                strict_successor_links
            ),
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
            "original_post_result_institutional_reproduction_link_count": (
                original_institutional_sequences
            ),
            "source_scoped_original_coalition_successions_with_accepted_work": (
                original_membership_successions
            ),
            "source_scoped_original_coalition_successions_without_accepted_work": (
                len(original_coalition_successions) - original_membership_successions
            ),
            "strict_original_entry_to_accepted_resource_work_link_count": (
                len(strict_successor_links)
            ),
            "strict_original_entry_individual_interests_and_consent_checked": (
                len(strict_successor_links) > 0
            ),
            "source_scoped_membership_successors_are_not_legal_membership": True,
            "all_nine_components_partially_observed_in_one_institutional_cycle": (
                original_institutional_sequences > 0
                and all(current_partial_observation.values())
            ),
            "same_original_causal_chain_includes_capability_and_institutional_change": (
                len(joined_capability_institutional) > 0
            ),
            "owner_capability_and_institutional_reproduction_link_count": (
                len(joined_capability_institutional)
            ),
            "six_author_organizational_forms_executable": False,
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
