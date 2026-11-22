"""P0 AKIS model-only application of the author's *existing* 13-part OC.

This is a constraining predicate over original QualitativeAKIS transitions, not
an IAM system, legal signature, new decision engine, journal or agent runtime.
The selected optional policy can only REFUSE an original action, never grant one.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping
import hashlib
import json

FIELDS = ("С", "ИД", "Рол", "Пр", "Запр", "Ист", "Событ", "Прав", "Авт",
          "Эск", "Отв", "Журн", "Пересм")
# Only prospective original Work actions; existing obligations and Results
# are always handled by original rules, regardless of future policy changes.
NEW_WORK_ACTIONS = frozenset({"request", "offer", "authorize", "consent",
                              "commit", "interest_update"})
VALID_ROLES = frozenset({"OPERATOR", "COUNCIL", "CUSTOMER", "RESOURCE_OWNER", "ENTERPRISE"})
FUNCTION_LEVELS = ("RECOMMEND", "CHECK", "PREPARE", "REQUEST_APPROVAL", "EXECUTE")
MAX_ROWS = 256


class OrgCodeInputError(ValueError):
    """An original-source model claim is malformed or conflicting."""


class OrgCodeBlocked(Exception):
    def __init__(self, reason: str, reviewer: str | None = None):
        self.reason, self.reviewer = reason, reviewer
        super().__init__(reason)


def _keys(row: Any, required: set[str], label: str) -> None:
    if not isinstance(row, dict) or set(row) != required:
        raise OrgCodeInputError("OC_CONTROL_INVALID_" + label)


def _identifiers(value: Any, label: str, *, allow_empty: bool = False) -> tuple[str, ...]:
    if (not isinstance(value, list) or len(value) > MAX_ROWS or
            (not value and not allow_empty) or
            any(not isinstance(v, str) or not v or len(v) > 128 for v in value) or
            len(set(value)) != len(value)):
        raise OrgCodeInputError("OC_CONTROL_INVALID_" + label)
    return tuple(value)


def _table(rows: Any, label: str, *, subjects: set[str],
           actions: set[str] | None = None) -> dict[str, tuple[str, ...]]:
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise OrgCodeInputError("OC_CONTROL_INVALID_" + label)
    result: dict[str, tuple[str, ...]] = {}
    for row in rows:
        _keys(row, {"subject", "items"}, label)
        subject = row["subject"]
        if not isinstance(subject, str) or subject not in subjects or subject in result:
            raise OrgCodeInputError("OC_CONTROL_UNKNOWN_OR_DUPLICATE_SUBJECT")
        allowed = _identifiers(row["items"], label)
        if actions is not None and not set(allowed) <= actions:
            raise OrgCodeInputError("OC_CONTROL_UNKNOWN_ACTION")
        result[subject] = allowed
    return result


@dataclass(frozen=True)
class ModelOrgCodePolicy:
    """Source declarations may *narrow* the original owner's actual rules."""
    records: Mapping[str, Mapping[str, Any]]
    controlled_subjects: frozenset[str]
    asserted_identity: frozenset[str]
    roles: Mapping[str, tuple[str, ...]]
    permits: Mapping[str, tuple[str, ...]]
    denies: Mapping[str, tuple[str, ...]]
    scoped_context_actions: frozenset[str]
    allowed_events: frozenset[str]
    require_admitted_for: frozenset[str]
    agent_limit: str
    reviewer_by_action: Mapping[str, str]
    responsible_by_action: Mapping[str, tuple[str, ...]]
    revision: str
    original_trace_required: bool

    def active(self, original_state: Any, at: int) -> bool:
        return all(row["revision"] == original_state.institution.revision and
                   row["available_at"] <= at < row["expires_at"]
                   for row in self.records.values())

    def inspect(self, original_state: Any, event: Mapping[str, Any], at: int) -> dict[str, Any]:
        """Only constrain NEW work, never old commitments or accepted Results."""
        action = event["action"]
        if action not in NEW_WORK_ACTIONS:
            return {"status": "ORIGINAL_ACTION_OUTSIDE_NEW_WORK_MODEL_POLICY",
                    "original_authority_unmodified": True}
        actor = event["actor"]
        reviewer = self.reviewer_by_action.get(action)
        if not self.active(original_state, at) or self.revision != original_state.institution.revision:
            raise OrgCodeBlocked("OC_SOURCE_STALE_OR_EXPIRED", reviewer)
        if actor not in self.controlled_subjects or actor not in self.asserted_identity:
            raise OrgCodeBlocked("OC_ORIGINAL_SUBJECT_OR_IDENTITY_CLAIM_MISSING", reviewer)
        actor_roles = self.roles.get(actor, ())
        if not actor_roles:
            raise OrgCodeBlocked("OC_ROLE_UNDECLARED", reviewer)
        if action not in self.allowed_events:
            raise OrgCodeBlocked("OC_EVENT_OUTSIDE_DECLARED_SCOPE", reviewer)
        if any(action in self.denies.get(role, ()) for role in actor_roles):
            raise OrgCodeBlocked("OC_EXPLICIT_PROHIBITION", reviewer)
        if not any(action in self.permits.get(role, ()) for role in actor_roles):
            raise OrgCodeBlocked("OC_POSITIVE_RIGHT_NOT_DECLARED", reviewer)
        key = event.get("work")
        if action == "request":
            spec = event.get("work_spec")
            key = spec.get("id") if isinstance(spec, dict) else None
            original_work = None  # request is not an already authorized Work
        else:
            original_work = original_state.works.get(key)
        if action in self.require_admitted_for and (
                original_work is None or not original_work.admitted):
            raise OrgCodeBlocked("OC_ORIGINAL_AUTHORIZATION_NOT_REACHED", reviewer)
        if action in self.scoped_context_actions:
            basis = getattr(original_state, "context_basis", None)
            rule = basis.requirements.get((key, action)) if basis is not None else None
            if rule is None or rule.scope is None:
                raise OrgCodeBlocked("OC_SCOPED_ORIGINAL_CONTEXT_REQUIRED", reviewer)
            # Existing ContextBasis still performs the source's own checks.
            basis.assert_allowed(key, action, actor, at)
        responsible = self.responsible_by_action.get(action, ())
        if responsible:
            if original_work is not None:
                principals = {original_work.customer}
                ledger = getattr(original_state, "capacity_ledger", None)
                if ledger is not None:
                    principals.update(ledger.original_owners(original_work.resource_requirements))
            elif action == "request" and isinstance(event.get("work_spec"), dict):
                spec = event["work_spec"]
                principals = {spec.get("customer")}
                resources = getattr(original_state, "resources", {})
                needs = spec.get("resource_requirements") or []
                ids = [row.get("resource") for row in needs if isinstance(row, dict)]
                if not ids:
                    ids = [spec.get("resource")]
                principals.update(resources.get(key) for key in ids)
            else:
                principals = set()
            if not set(responsible) <= principals:
                raise OrgCodeBlocked("OC_RESPONSIBILITY_NOT_ORIGINAL_PRINCIPAL", reviewer)
        return {"status": "MODEL_CODE_CHECKED_ORIGINAL_DECISION_STILL_REQUIRED",
                "source_revision": self.revision,
                "accountable_original_subjects": list(responsible),
                "reviewer": reviewer, "model_identity_not_authenticated": True,
                "original_authority_unmodified": True}

    def agent_decision(self, function_name: str) -> str:
        """Restrict an intended agent function; NEVER authorize execution."""
        if function_name not in FUNCTION_LEVELS:
            return "OC_AGENT_FUNCTION_UNKNOWN"
        if function_name == "EXECUTE":
            return "OC_AGENT_EXECUTE_REQUIRES_ORIGINAL_HUMAN_MANDATE"
        if FUNCTION_LEVELS.index(function_name) > FUNCTION_LEVELS.index(self.agent_limit):
            return "OC_AGENT_AUTONOMY_LIMIT_EXCEEDED"
        return "OC_MODEL_PREPARATION_CANDIDATE_NOT_AUTHORIZED"


def parse_org_code_policy(claims: Any, subjects: Mapping[str, Any],
                          institution: Any, *, actions: set[str]) -> ModelOrgCodePolicy:
    """Require all thirteen *source-bound* field controls before enforcement.

    An operator claim cannot invent rights of other independent principals.
    Their existing QualitativeAKIS consents and ContextBasis still decide.
    """
    if not isinstance(claims, (list, tuple)) or len(claims) != len(FIELDS):
        raise OrgCodeInputError("OC_ENFORCEMENT_REQUIRES_THIRTEEN_CONTROLS")
    rows = {}
    operator = institution.operator
    for row in claims:
        if (not isinstance(row, dict) or not isinstance(row.get("field"), str) or
                row["field"] not in FIELDS or row["field"] in rows):
            raise OrgCodeInputError("OC_DUPLICATE_OR_UNKNOWN_FIELD")
        if row.get("owner") != operator:
            raise OrgCodeInputError("OC_POLICY_ORIGINAL_OPERATOR_SOURCE_REQUIRED")
        if (row.get("revision") != institution.revision or
                not isinstance(row.get("source_ref"), str) or
                not row["source_ref"].startswith(f"model://{operator}/")):
            raise OrgCodeInputError("OC_POLICY_REVISION_OR_OWNER_SOURCE_INVALID")
        if (type(row.get("available_at")) is not int or
                type(row.get("expires_at")) is not int or
                not 0 <= row["available_at"] < row["expires_at"] <= 10000):
            raise OrgCodeInputError("OC_POLICY_SOURCE_TIME_INVALID")
        rows[row["field"]] = row
    if set(rows) != set(FIELDS):
        raise OrgCodeInputError("OC_ENFORCEMENT_REQUIRES_THIRTEEN_CONTROLS")
    c = {name: row.get("control") for name, row in rows.items()}
    for field in FIELDS:
        if not isinstance(c[field], dict):
            raise OrgCodeInputError("OC_FIELD_CONTROL_MISSING_" + field)
    known = set(subjects) | {"COUNCIL"}
    _keys(c["С"], {"subjects"}, "С")
    controlled = frozenset(_identifiers(c["С"]["subjects"], "SUBJECTS"))
    if not controlled <= known or operator not in controlled:
        raise OrgCodeInputError("OC_CONTROL_INVALID_ORIGINAL_SUBJECTS")
    _keys(c["ИД"], {"model_identified"}, "ИД")
    identified = frozenset(_identifiers(c["ИД"]["model_identified"], "IDENTITIES"))
    if not identified <= controlled:
        raise OrgCodeInputError("OC_IDENTITY_OUTSIDE_DECLARED_SUBJECTS")
    _keys(c["Рол"], {"role_bindings"}, "Рол")
    roles = _table(c["Рол"]["role_bindings"], "ROLES", subjects=set(controlled),
                   actions=set(VALID_ROLES))
    _keys(c["Пр"], {"permitted"}, "Пр")
    _keys(c["Запр"], {"denied"}, "Запр")
    # Do not accept source rules pretending to control already accepted Work.
    prospective = actions & NEW_WORK_ACTIONS
    rights = _table(c["Пр"]["permitted"], "PERMISSIONS", subjects=set(VALID_ROLES), actions=prospective)
    denied = _table(c["Запр"]["denied"], "PROHIBITIONS", subjects=set(VALID_ROLES), actions=prospective)
    _keys(c["Ист"], {"require_scoped_context_for"}, "Ист")
    req_scoped = frozenset(_identifiers(c["Ист"]["require_scoped_context_for"], "SOURCE_ACTIONS", allow_empty=True))
    if not req_scoped <= NEW_WORK_ACTIONS - {"request"}:
        raise OrgCodeInputError("OC_SOURCE_ACTION_NOT_SUPPORTED")
    _keys(c["Событ"], {"new_work_events"}, "Событ")
    allowed_events = frozenset(_identifiers(c["Событ"]["new_work_events"], "EVENTS"))
    if not allowed_events <= NEW_WORK_ACTIONS:
        raise OrgCodeInputError("OC_EVENT_UNKNOWN")
    _keys(c["Прав"], {"require_admitted_for"}, "Прав")
    require_admitted = frozenset(_identifiers(c["Прав"]["require_admitted_for"], "RULES", allow_empty=True))
    if not require_admitted <= NEW_WORK_ACTIONS - {"request"}:
        raise OrgCodeInputError("OC_RULE_ACTION_UNKNOWN")
    _keys(c["Авт"], {"max_agent_function"}, "Авт")
    autonomy = c["Авт"]["max_agent_function"]
    if autonomy not in FUNCTION_LEVELS or autonomy == "EXECUTE":
        raise OrgCodeInputError("OC_UNBOUNDED_MODEL_AGENT_AUTONOMY")
    _keys(c["Эск"], {"reviewers"}, "Эск")
    reviewers = c["Эск"]["reviewers"]
    if not isinstance(reviewers, list):
        raise OrgCodeInputError("OC_ESCALATION_INVALID")
    reviewer_by_action = {}
    for row in reviewers:
        _keys(row, {"action", "subject"}, "ESCALATION")
        if (not isinstance(row["action"], str) or row["action"] not in NEW_WORK_ACTIONS or
                row["action"] in reviewer_by_action or not isinstance(row["subject"], str) or
                row["subject"] not in subjects):
            raise OrgCodeInputError("OC_ESCALATION_INVALID")
        reviewer_by_action[row["action"]] = row["subject"]
    _keys(c["Отв"], {"responsibilities"}, "Отв")
    owners = c["Отв"]["responsibilities"]
    if not isinstance(owners, list):
        raise OrgCodeInputError("OC_RESPONSIBILITY_INVALID")
    responsibility_by_action = {}
    for row in owners:
        _keys(row, {"action", "original_principals"}, "RESPONSIBILITY")
        if (not isinstance(row["action"], str) or row["action"] not in NEW_WORK_ACTIONS or
                row["action"] in responsibility_by_action):
            raise OrgCodeInputError("OC_RESPONSIBILITY_INVALID")
        responsibility_by_action[row["action"]] = _identifiers(row["original_principals"], "RESPONSIBILITY")
        if not set(responsibility_by_action[row["action"]]) <= set(subjects):
            raise OrgCodeInputError("OC_RESPONSIBILITY_OUTSIDE_SUBJECTS")
    _keys(c["Журн"], {"require_original_trace"}, "Журн")
    if c["Журн"]["require_original_trace"] is not True:
        raise OrgCodeInputError("OC_ORIGINAL_JOURNAL_REQUIRED")
    _keys(c["Пересм"], {"expected_revision"}, "Пересм")
    if c["Пересм"]["expected_revision"] != institution.revision:
        raise OrgCodeInputError("OC_REVISION_EXPECTATION_STALE")
    return ModelOrgCodePolicy(rows, controlled, identified, roles, rights, denied,
                              req_scoped, allowed_events, require_admitted,
                              autonomy, reviewer_by_action, responsibility_by_action,
                              institution.revision, True)

# R1-T: qualification of a prospective MODEL-ONLY edition of the same
# original thirteen-field code. No second policy engine, IAM, signature or
# new organizational regime. Every source event stays in QualitativeAKIS.trace.
def original_model_code_fingerprint(claims: Any) -> str:
    """Canonical source-document binding of 13 model-only records.

    Does NOT prove authenticity of their sources or sign for principals.
    """
    try:
        serialized = json.dumps(
            claims, sort_keys=True, ensure_ascii=False,
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise OrgCodeBlocked("OC_MODEL_EDITION_SOURCE_DOCUMENT_INVALID") from exc
    return hashlib.sha256(serialized).hexdigest()


def _valid_original_model_code_fingerprint(value: Any) -> bool:
    return (isinstance(value, str) and len(value) == 64
            and all(char in "0123456789abcdef" for char in value))


def _original_model_edition_proposal(trace: Any, change: Any):
    if not isinstance(change, str) or not change or len(change) > 128:
        raise OrgCodeBlocked("OC_MODEL_EDITION_CHANGE_ID_REQUIRED")
    rows = [r for r in trace
            if r.get("action") == "model_code_propose"
            and r.get("outcome") == "APPLIED"
            and r.get("model_code_change_id") == change]
    if len(rows) != 1:
        raise OrgCodeBlocked("OC_MODEL_EDITION_ORIGINAL_PROPOSAL_REQUIRED")
    return rows[0]


def _edition_source(value: Any, original: str) -> None:
    prefix = "model://" + original + "/"
    if not isinstance(value, str) or not value.startswith(prefix) or not (
            len(prefix) < len(value) <= 180):
        raise OrgCodeBlocked("OC_MODEL_EDITION_OWNER_SOURCE_REQUIRED")


def qualify_model_code_proposal(state: Any, event: Mapping[str, Any],
                                at: int) -> None:
    """Propose only a model role for a NEW original participant, no rights."""
    old = state.model_org_policy
    if old is None or not old.active(state, at):
        raise OrgCodeBlocked("OC_MODEL_EDITION_ACTIVE_ORIGINAL_CODE_REQUIRED")
    operator = state.institution.operator
    if event.get("actor") != operator:
        raise OrgCodeBlocked("OC_MODEL_EDITION_ORIGINAL_OPERATOR_REQUIRED")
    if event.get("org_revision") != state.institution.revision:
        raise OrgCodeBlocked("OC_MODEL_EDITION_INSTITUTION_REVISION_STALE")
    if event.get("expected_model_edition") != state.model_org_code_edition:
        raise OrgCodeBlocked("OC_MODEL_EDITION_EXPECTED_REVISION_STALE")
    edition = event.get("new_model_edition")
    if (not isinstance(edition, str) or not edition or len(edition) > 128
            or edition in state.model_org_code_editions):
        raise OrgCodeBlocked("OC_MODEL_EDITION_REUSE_FORBIDDEN")
    change = event.get("model_code_change_id")
    if (not isinstance(change, str) or not change or len(change) > 128 or
            any(row.get("model_code_change_id") == change
                and row.get("action") == "model_code_propose"
                and row.get("outcome") == "APPLIED" for row in state.trace)):
        raise OrgCodeBlocked("OC_MODEL_EDITION_DUPLICATE_PROPOSAL")
    _edition_source(event.get("model_code_source_ref"), operator)
    if not _valid_original_model_code_fingerprint(
        event.get("model_code_fingerprint")
    ):
        raise OrgCodeBlocked("OC_MODEL_EDITION_SOURCE_FINGERPRINT_REQUIRED")
    applicant = event.get("proposed_subject")
    if (applicant not in state.subjects
            or not state.subjects[applicant].active
            or state.subjects[applicant].kind != "SME"
            or applicant in old.controlled_subjects
            or event.get("proposed_model_role") != "RESOURCE_OWNER"
            or not any(owner == applicant for owner in state.resources.values())):
        raise OrgCodeBlocked("OC_MODEL_EDITION_NEW_ORIGINAL_RESOURCE_OWNER_REQUIRED")
    membership = [
        row for row in state.trace
        if row.get("action") == "cooperation_membership_apply"
        and row.get("outcome") == "APPLIED"
        and row.get("change_id") == event.get("original_cooperation_change_id")
        and row.get("newly_admitted_model_party") == applicant
        and row.get("new_entrant_independently_assessed_model_only") is True
        and type(row.get("at")) is int and row["at"] < at
    ]
    if len(membership) != 1:
        raise OrgCodeBlocked("OC_MODEL_EDITION_INDEPENDENT_ENTRANT_MEMBERSHIP_REQUIRED")


def qualify_model_code_response(state: Any, event: Mapping[str, Any],
                                at: int) -> None:
    proposal = _original_model_edition_proposal(
        state.trace, event.get("model_code_change_id")
    )
    actor = event.get("actor")
    if actor not in state.institution.founders:
        raise OrgCodeBlocked("OC_MODEL_EDITION_ORIGINAL_FOUNDER_REQUIRED")
    if (event.get("org_revision") != state.institution.revision
            or proposal.get("org_revision") != state.institution.revision
            or proposal.get("expected_model_edition") != state.model_org_code_edition
            or event.get("new_model_edition") != proposal.get("new_model_edition")):
        raise OrgCodeBlocked("OC_MODEL_EDITION_RESPONSE_STALE")
    if type(proposal.get("at")) is not int or at <= proposal["at"]:
        raise OrgCodeBlocked("OC_MODEL_EDITION_RESPONSE_TIME_INVALID")
    if event.get("model_code_fingerprint") != proposal.get(
        "model_code_fingerprint"
    ):
        raise OrgCodeBlocked("OC_MODEL_EDITION_FOUNDERS_MUST_REVIEW_EXACT_CONTENT")
    if event.get("model_code_decision") not in {
            "SUPPORT_MODEL_REVISION", "OBJECT_MODEL_REVISION"}:
        raise OrgCodeBlocked("OC_MODEL_EDITION_FOUNDER_POSITION_REQUIRED")
    _edition_source(event.get("model_code_decision_source_ref"), actor)


def qualify_model_code_apply(state: Any, event: Mapping[str, Any],
                             at: int, *, actions: set[str]) -> ModelOrgCodePolicy:
    """Validate complete replacement controls BEFORE one atomic policy swap.

    The institution revision and every Work/Result remain original. Only the
    opt-in, model-scoped predicate gains a prospective role after the entrant's
    historical membership and distinct founder source responses.
    """
    old = state.model_org_policy
    if old is None or not old.active(state, at):
        raise OrgCodeBlocked("OC_MODEL_EDITION_ACTIVE_ORIGINAL_CODE_REQUIRED")
    operator = state.institution.operator
    if event.get("actor") != operator:
        raise OrgCodeBlocked("OC_MODEL_EDITION_ORIGINAL_OPERATOR_REQUIRED")
    proposal = _original_model_edition_proposal(
        state.trace, event.get("model_code_change_id")
    )
    if (event.get("org_revision") != state.institution.revision
            or proposal.get("org_revision") != state.institution.revision
            or proposal.get("expected_model_edition") != state.model_org_code_edition
            or event.get("expected_model_edition") != state.model_org_code_edition
            or event.get("new_model_edition") != proposal.get("new_model_edition")
            or type(proposal.get("at")) is not int or proposal["at"] >= at):
        raise OrgCodeBlocked("OC_MODEL_EDITION_APPLY_STALE")
    if event.get("new_model_edition") in state.model_org_code_editions:
        raise OrgCodeBlocked("OC_MODEL_EDITION_REUSE_FORBIDDEN")
    if event.get("model_code_fingerprint") != proposal.get(
        "model_code_fingerprint"
    ):
        raise OrgCodeBlocked("OC_MODEL_EDITION_APPLIED_SOURCE_FINGERPRINT_STALE")
    applicant = proposal.get("proposed_subject")
    if (applicant not in state.subjects
            or not state.subjects[applicant].active
            or not any(owner == applicant for owner in state.resources.values())
            or applicant in old.controlled_subjects):
        raise OrgCodeBlocked("OC_MODEL_EDITION_NEW_ORIGINAL_RESOURCE_OWNER_REQUIRED")
    # Independently recheck still-applicable membership, not just the
    # operator's earlier proposed change.
    if not any(
        row.get("action") == "cooperation_membership_apply"
        and row.get("outcome") == "APPLIED"
        and row.get("change_id") == proposal.get("original_cooperation_change_id")
        and row.get("newly_admitted_model_party") == applicant
        and row.get("new_entrant_independently_assessed_model_only") is True
        and row.get("at", at) < at
        for row in state.trace
    ):
        raise OrgCodeBlocked("OC_MODEL_EDITION_INDEPENDENT_ENTRANT_MEMBERSHIP_REQUIRED")
    latest = {}
    for row in state.trace:
        if (row.get("action") == "model_code_response"
                and row.get("outcome") == "APPLIED"
                and row.get("model_code_change_id") == proposal["model_code_change_id"]
                and row.get("new_model_edition") == proposal["new_model_edition"]
                and row.get("org_revision") == state.institution.revision
                and row.get("actor") in state.institution.founders
                and type(row.get("at")) is int
                and proposal["at"] < row["at"] < at):
            latest[row["actor"]] = row["model_code_decision"]
    if set(latest) != set(state.institution.founders):
        raise OrgCodeBlocked("OC_MODEL_EDITION_ALL_FOUNDERS_RESPONSE_REQUIRED")
    if any(value != "SUPPORT_MODEL_REVISION" for value in latest.values()):
        raise OrgCodeBlocked("OC_MODEL_EDITION_FOUNDER_OBJECTION")
    claims = event.get("model_code_records")
    if not isinstance(claims, list) or len(claims) != len(FIELDS):
        raise OrgCodeBlocked("OC_MODEL_EDITION_ALL_THIRTEEN_RECORDS_REQUIRED")
    if original_model_code_fingerprint(claims) != proposal[
        "model_code_fingerprint"
    ]:
        raise OrgCodeBlocked("OC_MODEL_EDITION_CONTENT_CHANGED_AFTER_REVIEW")
    for row in claims:
        if (not isinstance(row, dict) or row.get("owner") != operator
                or row.get("revision") != state.institution.revision
                or type(row.get("available_at")) is not int
                or row.get("available_at") != at
                or type(row.get("expires_at")) is not int
                or row["expires_at"] <= at):
            raise OrgCodeBlocked("OC_MODEL_EDITION_CURRENT_SOURCE_TIME_REQUIRED")
        _edition_source(row.get("source_ref"), operator)
        if (row.get("field") not in old.records
                or row.get("source_ref") == old.records[row["field"]]["source_ref"]):
            raise OrgCodeBlocked("OC_MODEL_EDITION_FRESH_THIRTEEN_SOURCES_REQUIRED")
    try:
        candidate = parse_org_code_policy(
            claims, state.subjects, state.institution, actions=actions
        )
    except OrgCodeInputError as exc:
        raise OrgCodeBlocked("OC_MODEL_EDITION_INVALID_ORIGINAL_THIRTEEN_CONTROLS:" +
                             str(exc)) from exc
    # This first prospective stage adds exactly one entrant-owned role.
    # Role reassignment and changes to the other ten fields need a separate
    # independent owner and liability review; never silently broaden scope.
    if (set(candidate.controlled_subjects) - set(old.controlled_subjects) != {applicant}
            or set(old.controlled_subjects) - set(candidate.controlled_subjects)
            or set(candidate.asserted_identity) - set(old.asserted_identity) != {applicant}
            or set(old.asserted_identity) - set(candidate.asserted_identity)
            or candidate.roles.get(applicant) != (proposal["proposed_model_role"],)
            or any(candidate.roles.get(name) != roles
                   for name, roles in old.roles.items())):
        raise OrgCodeBlocked("OC_MODEL_EDITION_ONLY_INDEPENDENT_NEW_ENTRANT_ALLOWED")
    if any(
        candidate.records[field]["control"] != old.records[field]["control"]
        for field in FIELDS if field not in {"С", "ИД", "Рол"}
    ):
        raise OrgCodeBlocked("OC_MODEL_EDITION_OTHER_RIGHTS_OR_FUNCTIONS_UNREVIEWED")
    if not candidate.active(state, at):
        raise OrgCodeBlocked("OC_MODEL_EDITION_NEW_SOURCE_NOT_ACTIVE")
    return candidate
