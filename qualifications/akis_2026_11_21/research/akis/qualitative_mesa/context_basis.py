"""Source-bounded KPB conditions for the *existing* qualitative AKIS state.

The source statuses and grants are MODEL_ONLY assertions, never authenticated
corporate documents, real IAM, or a new kernel. Unknown is not permission.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from bisect import bisect_left
from typing import Any

from .scope_policy import (
    ScopeInputError, SourceScope, SCOPE_FIELDS, parse_scope,
    validate_requirement_scope, check_scope, action_scope_reason,
)

STATUS = frozenset({"CONFIRMED", "DISPROVED", "UNKNOWN"})
QUALIFIED_ACTIONS = frozenset({"authorize", "consent", "commit", "start", "complete", "accept", "resubmit", "start_operation", "complete_operation", "handoff_dispatch", "handoff_receive", "handoff_quality", "interest_update", "assess_result_quality"})
MAX_SOURCES = 256
MAX_REQUIREMENTS = 512

# R1-U4 reuses the same ORIGINAL ContextBasis sources, revisions, statuses,
# owner updates and scope predicates for non-Work institutional decisions.
# The proposal/approval cannot manufacture a grant: every action needs its
# own actor-held source AND all original actor-authored evidence references.
DECISION_SOURCE_FIELDS = {
    "subject_registration_propose": ("registration_source_ref",),
    "subject_registration_attest": (
        "registration_self_ref", "registration_goal_source_ref",
        "registration_alternative_source_ref",
    ),
    "subject_registration_review": ("registration_decision_source_ref",),
    "subject_registration_apply": (),
    "resource_registration_propose": ("registration_resource_source_ref",),
    "resource_registration_review": ("registration_decision_source_ref",),
    "resource_registration_apply": (),
    "cooperation_lifecycle_propose": ("lifecycle_source_ref",),
    "cooperation_lifecycle_response": ("lifecycle_response_source_ref",),
    "cooperation_lifecycle_apply": (),
    # A successor coalition must keep all original independent source rights.
    # These are existing cooperation decisions, not a second membership IAM.
    "cooperation_change_propose": ("change_source_ref",),
    "cooperation_change_response": ("change_source_ref",),
    "cooperation_entry_assess": (
        "entry_goal_source_ref", "entry_alternative_source_ref",
        "entry_assessment_source_ref",
    ),
    "cooperation_membership_apply": ("new_link_source_ref",),
    "affiliation_transfer_propose": (
        "transfer_source_ref", "self_role_source_ref",
    ),
    "affiliation_transfer_review": (
        "transfer_decision_source_ref", "transfer_parent_source_ref",
    ),
    "affiliation_transfer_apply": (),
    "technology_route_propose": ("technology_route_source_ref",),
    "technology_route_response": ("technology_route_decision_source_ref",),
}
DECISION_OPERATIONS = {
    action: ("EXECUTE" if action.endswith("_apply") else
             "ACCEPT" if action.endswith(("_review", "_response", "_assess")) else
             "SHARE")
    for action in DECISION_SOURCE_FIELDS
}
DECISION_PURPOSES = {
    action: ("AKIS_SUBJECT_REGISTRATION" if action.startswith("subject_") else
             "AKIS_RESOURCE_REGISTRATION" if action.startswith("resource_") else
             "AKIS_COOPERATION_LIFECYCLE" if action.startswith("cooperation_lifecycle_")
             else "AKIS_INTRA_AFFILIATION_TRANSFER"
             if action.startswith("affiliation_transfer_")
             else "AKIS_TECHNOLOGY_ROUTE" if action.startswith("technology_route_")
             else "AKIS_COOPERATION_MEMBERSHIP")
    for action in DECISION_SOURCE_FIELDS
}
DECISION_TARGET_FIELDS = {
    action: ("subject_registration_id" if action.startswith("subject_") else
             "resource_registration_id" if action.startswith("resource_") else
             "lifecycle_id" if action.startswith("cooperation_lifecycle_")
             else "affiliation_transfer_id"
             if action.startswith("affiliation_transfer_")
             else "technology_route_id" if action.startswith("technology_route_")
             else "change_id")
    for action in DECISION_SOURCE_FIELDS
}


class ContextInputError(ValueError):
    """Input structure lacks an unambiguous MODEL_ONLY meaning."""


class ContextBlocked(Exception):
    """A modeled action has no suitable declared epistemic and usage basis."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def _fields(value: Any, required: set[str], optional: set[str], code: str) -> None:
    if not isinstance(value, dict) or set(value) - required - optional or required - set(value):
        raise ContextInputError(code)


def _identifier(value: Any, code: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ContextInputError(code)
    return value


def _identifiers(value: Any, *, code: str, allow_empty: bool = False, limit: int = 128, unique: bool = True) -> tuple[str, ...]:
    if not isinstance(value, list) or len(value) > limit or (not allow_empty and not value):
        raise ContextInputError(code)
    for item in value:
        _identifier(item, code)
    if unique and len(set(value)) != len(value):
        raise ContextInputError(code)
    return tuple(value)


@dataclass
class SourceAssertion:
    key: str
    owner: str
    revision: str
    status: str
    usable_by: tuple[str, ...]
    valid_until: int | None
    scope: SourceScope | None = None


@dataclass(frozen=True)
class RequiredContext:
    work: str
    action: str
    sources: tuple[str, ...]
    expected_revisions: tuple[str, ...]
    scope: tuple[str, str, str] | None = None


@dataclass(frozen=True)
class OriginalDecisionRights:
    target: str
    action: str
    actor: str
    sources: tuple[str, ...]
    expected_revisions: tuple[str, ...]
    scope: tuple[str, str, str]


class ContextBasis:
    """Pure evaluator; status changes occur only on original-owner MODEL_ONLY events."""

    def __init__(self, data: Any, subjects: dict[str, Any], known_works: set[str],
                 *, prospective_subjects: set[str] | None = None,
                 prospective_subject_kinds: dict[str, str] | None = None,
                 operator: str | None = None,
                 network_scale: bool = False):
        _fields(data, {"strict", "sources", "requirements"},
                {"decision_requirements"}, "INVALID_CONTEXT_BASIS")
        if type(data["strict"]) is not bool:
            raise ContextInputError("INVALID_CONTEXT_STRICT")
        if type(network_scale) is not bool:
            raise ContextInputError("INVALID_CONTEXT_NETWORK_SCALE")
        self.strict = data["strict"]
        self.network_scale = network_scale
        self.max_time = 3_000_001 if network_scale else 10000
        source_limit = 2_000_000 if network_scale else MAX_SOURCES
        requirement_limit = 3_000_000 if network_scale else MAX_REQUIREMENTS
        self.subjects = subjects
        self.prospective_subjects = prospective_subjects or set()
        self.prospective_subject_kinds = prospective_subject_kinds or {}
        self.operator = operator
        sources, requirements = data["sources"], data["requirements"]
        if not isinstance(sources, list) or len(sources) > source_limit:
            raise ContextInputError("INVALID_CONTEXT_SOURCE_COUNT")
        if not isinstance(requirements, list) or len(requirements) > requirement_limit:
            raise ContextInputError("INVALID_CONTEXT_REQUIREMENT_COUNT")
        self.sources: dict[str, SourceAssertion] = {}
        # Retain immutable revisions of the SAME original sources; this
        # historical projection is not a new grants registry, permission or
        # independent economic event store. An un-timed legacy update makes
        # the corresponding historical proof unknowable, never positive.
        self._source_versions: dict[str, list[tuple[int, SourceAssertion]]] = {}
        self._historical_time_unknown: set[str] = set()
        self.requirements: dict[tuple[str, str], RequiredContext] = {}
        self._affected_work_index: dict[str, set[str]] = {}
        self._decision_source_ids: set[str] = set()
        for item in sources:
            _fields(item, {"id", "owner", "revision", "status", "usable_by"}, {"valid_until"} | set(SCOPE_FIELDS), "INVALID_CONTEXT_SOURCE")
            key = _identifier(item["id"], "INVALID_CONTEXT_SOURCE_ID")
            owner = _identifier(item["owner"], "INVALID_CONTEXT_OWNER")
            revision = _identifier(item["revision"], "INVALID_CONTEXT_REVISION")
            if key in self.sources or (owner not in subjects
                                       and owner not in self.prospective_subjects):
                raise ContextInputError("INVALID_CONTEXT_OWNER_OR_DUPLICATE_SOURCE")
            status = item["status"]
            if not isinstance(status, str) or status not in STATUS:
                raise ContextInputError("INVALID_CONTEXT_STATUS")
            usable_by = _identifiers(item["usable_by"], code="INVALID_CONTEXT_RECIPIENTS")
            if any(p not in subjects and p not in self.prospective_subjects
                   and p != "COUNCIL" for p in usable_by):
                raise ContextInputError("UNKNOWN_CONTEXT_RECIPIENT")
            until = item.get("valid_until")
            if until is not None and (type(until) is not int or until < 0):
                raise ContextInputError("INVALID_CONTEXT_VALID_UNTIL")
            try:
                scope = parse_scope(item, max_time=self.max_time)
            except ScopeInputError as exc:
                raise ContextInputError(str(exc)) from exc
            self.sources[key] = SourceAssertion(key, owner, revision, status, usable_by, until, scope)
            self._source_versions[key] = [(-1, replace(self.sources[key]))]
        for item in requirements:
            _fields(item, {"work", "action", "sources", "expected_revisions"}, {"core", "purpose", "operation"}, "INVALID_CONTEXT_REQUIREMENT")
            work = _identifier(item["work"], "INVALID_CONTEXT_WORK")
            action = item["action"]
            if work not in known_works or not isinstance(action, str) or action not in QUALIFIED_ACTIONS:
                raise ContextInputError("UNKNOWN_CONTEXT_WORK_OR_ACTION")
            refs = _identifiers(item["sources"], code="INVALID_CONTEXT_REFERENCE")
            revs = _identifiers(item["expected_revisions"], code="INVALID_CONTEXT_EXPECTED_REVISION", unique=False)
            if len(refs) != len(revs) or any(s not in self.sources for s in refs):
                raise ContextInputError("INVALID_CONTEXT_REFERENCE")
            try:
                scope = validate_requirement_scope(item)
            except ScopeInputError as exc:
                raise ContextInputError(str(exc)) from exc
            if scope is not None:
                matching = action_scope_reason(action, scope[2])
                if matching != "MODEL_ACTION_OPERATION_COMPATIBLE":
                    raise ContextInputError(matching)
            key = (work, action)
            if key in self.requirements:
                raise ContextInputError("DUPLICATE_CONTEXT_REQUIREMENT")
            self.requirements[key] = RequiredContext(work, action, refs, revs, scope)
            if self.network_scale:
                for ref in refs:
                    self._affected_work_index.setdefault(ref, set()).add(work)
        raw_decisions = data.get("decision_requirements", [])
        if (not isinstance(raw_decisions, list)
                or len(raw_decisions) > requirement_limit):
            raise ContextInputError("INVALID_CONTEXT_DECISION_REQUIREMENT_COUNT")
        self.decision_requirements: dict[
            tuple[str, str, str], OriginalDecisionRights
        ] = {}
        for row in raw_decisions:
            _fields(row, {
                "target", "action", "actor", "sources", "expected_revisions",
                "core", "purpose", "operation",
            }, set(), "INVALID_CONTEXT_DECISION_REQUIREMENT")
            action = row["action"]
            if action not in DECISION_SOURCE_FIELDS:
                raise ContextInputError("UNKNOWN_CONTEXT_DECISION_ACTION")
            target = _identifier(row["target"], "INVALID_CONTEXT_DECISION_TARGET")
            actor = _identifier(row["actor"], "INVALID_CONTEXT_DECISION_ACTOR")
            if actor not in subjects and actor not in self.prospective_subjects:
                raise ContextInputError("UNKNOWN_CONTEXT_DECISION_ACTOR")
            refs = _identifiers(row["sources"], code="INVALID_CONTEXT_DECISION_SOURCES")
            revs = _identifiers(row["expected_revisions"],
                                code="INVALID_CONTEXT_DECISION_REVISIONS", unique=False)
            if len(refs) != len(revs) or any(x not in self.sources for x in refs):
                raise ContextInputError("INVALID_CONTEXT_DECISION_SOURCE_REFERENCE")
            try:
                scope = validate_requirement_scope(row)
            except ScopeInputError as exc:
                raise ContextInputError(str(exc)) from exc
            current = subjects.get(actor)
            kind = (current.kind if current is not None
                    else self.prospective_subject_kinds.get(actor, "SME"))
            expected_core = (
                "operator" if actor == self.operator else
                "personal" if kind == "NATURAL_PERSON" else
                "institutional" if kind in {
                    "SECTOR_BODY", "PUBLIC_INSTITUTION"
                } else "corporate"
            )
            if scope != (expected_core, DECISION_PURPOSES[action],
                         DECISION_OPERATIONS[action]):
                raise ContextInputError("CONTEXT_DECISION_ACTION_SCOPE_MISMATCH")
            key = (action, target, actor)
            if key in self.decision_requirements:
                raise ContextInputError("DUPLICATE_CONTEXT_DECISION_REQUIREMENT")
            self.decision_requirements[key] = OriginalDecisionRights(
                target, action, actor, refs, revs, scope
            )
            if self.network_scale:
                self._decision_source_ids.update(refs)

    def assert_original_decision_rights(self, event: dict[str, Any], at: int) -> None:
        """Re-evaluate the ORIGINAL owners' source assertions at decision time.

        This is a permission check over this same ContextBasis. An older
        original decision is rechecked against CURRENT owner-controlled
        revisions before applying a new subject, asset or relation.
        """
        action = event.get("action")
        if action not in DECISION_SOURCE_FIELDS:
            raise ContextBlocked("CONTEXT_ORIGINAL_DECISION_ACTION_UNKNOWN")
        actor = event.get("actor")
        target = event.get(DECISION_TARGET_FIELDS[action])
        rule = self.decision_requirements.get((action, target, actor))
        if rule is None:
            raise ContextBlocked("CONTEXT_DECISION_RIGHTS_REQUIREMENT_MISSING")
        own_ref = event.get("source_rights_ref")
        if (not isinstance(own_ref, str)
                or not own_ref.startswith(f"model://{actor}/")
                or own_ref not in rule.sources or
                self.sources[own_ref].owner != actor):
            raise ContextBlocked("CONTEXT_DECISION_INDEPENDENT_OWNER_RIGHT_MISSING")
        original_refs = [event.get(key)
                         for key in DECISION_SOURCE_FIELDS[action]]
        if action == "cooperation_lifecycle_apply" and event.get(
                "lifecycle_kind") == "RECONSTITUTE":
            original_refs.append(event.get("new_link_source_ref"))
        if any(not isinstance(ref, str) or ref not in rule.sources
               or not ref.startswith(f"model://{actor}/")
               or self.sources[ref].owner != actor
               for ref in original_refs):
            raise ContextBlocked("CONTEXT_DECISION_ORIGINAL_OWNER_SOURCE_UNQUALIFIED")
        for sid, revision in zip(rule.sources, rule.expected_revisions, strict=True):
            source = self.sources[sid]
            if actor not in source.usable_by:
                raise ContextBlocked("CONTEXT_USE_NOT_PERMITTED")
            if source.revision != revision:
                raise ContextBlocked("CONTEXT_REVISION_STALE")
            if source.valid_until is not None and at > source.valid_until:
                raise ContextBlocked("CONTEXT_SOURCE_EXPIRED")
            if source.status == "DISPROVED":
                raise ContextBlocked("CONTEXT_SOURCE_DISPROVED")
            if source.status != "CONFIRMED":
                raise ContextBlocked("CONTEXT_SOURCE_UNKNOWN")
            reason = check_scope(source.scope, core=rule.scope[0],
                                 purpose=rule.scope[1],
                                 operation=rule.scope[2], at=at)
            if reason != "MODEL_SOURCE_SCOPE_CONSISTENT":
                raise ContextBlocked(reason)

    def assert_original_decision_lineage(self, trace: list[dict[str, Any]],
                                         action: str, target: str, at: int) -> None:
        """Recheck only APPROVED earlier decisions from the one original trace."""
        if action == "affiliation_transfer_apply":
            previous = {
                "affiliation_transfer_propose", "affiliation_transfer_review",
            }
        elif action == "cooperation_membership_apply":
            # One immutable original consultation: revalidate proposer, every
            # independent respondent and entrant's OWN assessment at apply.
            previous = {
                "cooperation_change_propose", "cooperation_change_response",
                "cooperation_entry_assess",
            }
        elif action.startswith("cooperation_change_"):
            previous = {"cooperation_change_propose", "cooperation_change_response"}
        else:
            prefix = ("subject_registration_" if action.startswith("subject_")
                      else "resource_registration_" if action.startswith("resource_")
                      else "cooperation_lifecycle_")
            previous = {row.get("action") for row in trace
                        if isinstance(row.get("action"), str)
                        and row["action"].startswith(prefix)}
        target_field = DECISION_TARGET_FIELDS[action]
        for row in trace:
            if (row.get("outcome") == "APPLIED"
                    and row.get("action") in previous
                    and row.get(target_field) == target
                    and type(row.get("at")) is int and row["at"] < at):
                self.assert_original_decision_rights(row, at)

    def _assert_owner_source_state(
            self, source: SourceAssertion | None,
            actor: str, reference: str | None,
            expected_revision: str | None, *, core: str, purpose: str,
            operation: str, recipients: set[str], at: int,
            require_global_strict: bool = True) -> None:
        """One original source-scope predicate for current/as-of owner evidence.

        Global strict mode remains mandatory for original role authorities.
        A revision-pinned nonbinding research forecast can request the SAME
        predicate without implying all historical Work transitions were strict.
        """
        if require_global_strict and not self.strict:
            raise ContextBlocked("AUTHOR_ROLE_STRICT_CONTEXT_REQUIRED")
        if (not isinstance(reference, str)
                or not reference.startswith(f"model://{actor}/")):
            raise ContextBlocked("AUTHOR_ROLE_ORIGINAL_SOURCE_OWNER_REQUIRED")
        if source is None or source.owner != actor:
            raise ContextBlocked("AUTHOR_ROLE_ORIGINAL_SOURCE_OWNER_REQUIRED")
        if (not isinstance(expected_revision, str)
                or source.revision != expected_revision):
            raise ContextBlocked("CONTEXT_REVISION_STALE")
        if source.status == "DISPROVED":
            raise ContextBlocked("CONTEXT_SOURCE_DISPROVED")
        if source.status != "CONFIRMED":
            raise ContextBlocked("CONTEXT_SOURCE_UNKNOWN")
        if source.valid_until is not None and at > source.valid_until:
            raise ContextBlocked("CONTEXT_SOURCE_EXPIRED")
        if not recipients or not recipients.issubset(set(source.usable_by)):
            raise ContextBlocked("CONTEXT_USE_NOT_PERMITTED")
        reason = check_scope(
            source.scope, core=core, purpose=purpose,
            operation=operation, at=at,
        )
        if reason != "MODEL_SOURCE_SCOPE_CONSISTENT":
            raise ContextBlocked(reason)

    def assert_original_form_role_source(
            self, actor: str, reference: str | None,
            expected_revision: str | None, *, core: str, purpose: str,
            operation: str, recipients: set[str], at: int) -> None:
        """Evaluate the CURRENT original ContextBasis source and revision."""
        self._assert_owner_source_state(
            self.sources.get(reference) if isinstance(reference, str) else None,
            actor, reference, expected_revision,
            core=core, purpose=purpose, operation=operation,
            recipients=recipients, at=at,
        )

    def assert_original_pinned_owner_economic_source(
            self, actor: str, reference: str | None,
            expected_revision: str | None, *, core: str, purpose: str,
            operation: str, recipients: set[str], at: int) -> None:
        """Qualify one pinned private owner forecast, not a global Work grant.

        Uses the ORIGINAL ContextBasis assertions and identical scope checks
        even where the source scenario predates globally strict Work gates.
        Only an economic research READ may call this public owner-only check.
        It does not create permission, legal action or resource ownership.
        """
        if (purpose != "AKIS_ECONOMIC_WORK_EVIDENCE"
                or operation != "READ" or recipients != {actor}):
            raise ContextBlocked(
                "ORIGINAL_PINNED_OWNER_ECONOMIC_READ_ONLY"
            )
        self._assert_owner_source_state(
            self.sources.get(reference) if isinstance(reference, str) else None,
            actor, reference, expected_revision,
            core=core, purpose=purpose, operation=operation,
            recipients=recipients, at=at, require_global_strict=False,
        )

    def assert_original_independent_outside_demand_source(
            self, buyer: str, reference: str | None,
            expected_revision: str | None, *, core: str,
            recipient: str, at: int) -> None:
        """Check the ORIGINAL buyer-owned source readable by ONE supplier.

        This grants no rights. It checks an independently scoped MODEL_ONLY
        request used for prospective economic advice, even in legacy cases
        where all Work actions were not globally strict. No source owner may
        authorize its own outside demand as an independent buyer.
        """
        if (not isinstance(buyer, str) or not isinstance(recipient, str)
                or not buyer or not recipient or buyer == recipient
                or type(at) is not int or not 0 <= at <= self.max_time):
            raise ContextBlocked("OUTSIDE_DEMAND_INDEPENDENT_READER_REQUIRED")
        self._assert_owner_source_state(
            self.sources.get(reference) if isinstance(reference, str) else None,
            buyer, reference, expected_revision,
            core=core, purpose="AKIS_EXTERNAL_DEMAND_EVIDENCE",
            operation="READ", recipients={recipient}, at=at,
            require_global_strict=False,
        )

    def assert_original_independent_supplier_offer_source(
            self, supplier: str, reference: str | None,
            expected_revision: str | None, *, core: str,
            buyer: str, at: int) -> None:
        """Qualify one SUPPLIER-owned pre-contract offer source for the buyer.

        Same original ContextBasis, source scopes and owner-revision checks as
        the buyer statement. This is an evidence READ, not a commercial
        acceptance, legal authority, Work, Resource, or money transfer.
        """
        if (not isinstance(supplier, str) or not isinstance(buyer, str)
                or not supplier or not buyer or supplier == buyer
                or type(at) is not int or not 0 <= at <= self.max_time):
            raise ContextBlocked("OUTSIDE_OFFER_INDEPENDENT_READER_REQUIRED")
        self._assert_owner_source_state(
            self.sources.get(reference) if isinstance(reference, str) else None,
            supplier, reference, expected_revision,
            core=core, purpose="AKIS_EXTERNAL_DEMAND_EVIDENCE",
            operation="READ", recipients={buyer}, at=at,
            require_global_strict=False,
        )

    def assert_original_historical_form_role_source(
            self, actor: str, reference: str | None,
            expected_revision: str | None, *, core: str, purpose: str,
            operation: str, recipients: set[str], at: int) -> None:
        """Verify an ORIGINAL source at an earlier event, not present-day READ.

        Replay only already APPLIED owner updates of the SAME source, starting
        from its original declaration. Never infer permission from future
        restoration, revert an already accepted Work, or grant current use.
        An update on the same tick is an unordered case and fails closed.
        """
        if type(at) is not int or at < 0 or at > self.max_time:
            raise ContextBlocked("CONTEXT_HISTORICAL_EVENT_TIME_INVALID")
        if not isinstance(reference, str):
            raise ContextBlocked("AUTHOR_ROLE_ORIGINAL_SOURCE_OWNER_REQUIRED")
        history = self._source_versions.get(reference)
        if history is None:
            raise ContextBlocked("AUTHOR_ROLE_ORIGINAL_SOURCE_OWNER_REQUIRED")
        if reference in self._historical_time_unknown:
            raise ContextBlocked("CONTEXT_HISTORICAL_SOURCE_ORDER_UNKNOWN")
        # The original owner_update path enforces strictly increasing ticks.
        # Binary search reads the very same immutable history, not a new store.
        index = bisect_left(history, at, key=lambda item: item[0])
        if index < len(history) and history[index][0] == at:
            raise ContextBlocked(
                "CONTEXT_HISTORICAL_SAME_TICK_SOURCE_UPDATE_UNQUALIFIED"
            )
        version = history[index-1][1]
        self._assert_owner_source_state(
            version, actor, reference, expected_revision,
            core=core, purpose=purpose, operation=operation,
            recipients=recipients, at=at,
        )

    def assert_allowed(self, work: str, action: str, actor: str, at: int) -> None:
        if action not in QUALIFIED_ACTIONS:
            return
        rule = self.requirements.get((work, action))
        if rule is None:
            if self.strict:
                raise ContextBlocked("CONTEXT_REQUIREMENT_MISSING")
            return
        assertions: list[str] = []
        for sid, version in zip(rule.sources, rule.expected_revisions, strict=True):
            s = self.sources[sid]
            if actor not in s.usable_by:
                raise ContextBlocked("CONTEXT_USE_NOT_PERMITTED")
            if s.revision != version:
                raise ContextBlocked("CONTEXT_REVISION_STALE")
            if s.valid_until is not None and at > s.valid_until:
                raise ContextBlocked("CONTEXT_SOURCE_EXPIRED")
            assertions.append(s.status)
        states = set(assertions)
        if "CONFIRMED" in states and "DISPROVED" in states:
            raise ContextBlocked("CONTEXT_CONTRADICTORY_ORIGINALS")
        if "DISPROVED" in states:
            raise ContextBlocked("CONTEXT_SOURCE_DISPROVED")
        if "UNKNOWN" in states:
            raise ContextBlocked("CONTEXT_SOURCE_UNKNOWN")
        for sid in rule.sources:
            source = self.sources[sid]
            if rule.scope is None:
                if source.scope is not None:
                    raise ContextBlocked("CONTEXT_REQUIREMENT_SCOPE_MISSING")
            else:
                reason = check_scope(
                    source.scope, core=rule.scope[0], purpose=rule.scope[1],
                    operation=rule.scope[2], at=at,
                )
                if reason != "MODEL_SOURCE_SCOPE_CONSISTENT":
                    raise ContextBlocked(reason)

    def owner_update(self, event: dict[str, Any], *, at: int | None = None) -> None:
        sid = event.get("source")
        if not isinstance(sid, str) or sid not in self.sources:
            raise ContextBlocked("CONTEXT_SOURCE_UNKNOWN")
        item = self.sources[sid]
        if event.get("actor") != item.owner:
            raise ContextBlocked("CONTEXT_SOURCE_OWNER_REQUIRED")
        # R1-U4: protected owner-right sources must change by explicit
        # compare-and-set and acquire a NEW revision. Otherwise a legacy
        # same-revision revoke/re-grant could silently reactivate already
        # accepted independent decisions. Non-rights legacy research inputs
        # retain their original optional CAS behavior.
        protected_rights = self.strict and (
            (sid in self._decision_source_ids if self.network_scale else
             any(sid in rule.sources for rule in self.decision_requirements.values()))
            or any(
                sid in {
                    getattr(p, "self_role_source_ref", None),
                    getattr(p, "mandate_source_ref", None),
                    getattr(p, "context_source_ref", None),
                    getattr(p, "role_management_source_ref", None),
                }
                for p in self.subjects.values()
            )
        )
        if protected_rights and "expected_revision" not in event:
            raise ContextBlocked("CONTEXT_OWNER_RIGHTS_COMPARE_AND_SET_REQUIRED")
        if protected_rights and (
                not isinstance(event.get("new_revision"), str)
                or event["new_revision"] == item.revision):
            raise ContextBlocked("CONTEXT_OWNER_RIGHTS_FRESH_REVISION_REQUIRED")
        # Optional compare-and-set for independently arriving original-owner
        # events that do not control R1-U4 decision sources.
        if "expected_revision" in event:
            expected = event["expected_revision"]
            if not isinstance(expected, str) or not expected.strip():
                raise ContextBlocked("INVALID_CONTEXT_EXPECTED_REVISION")
            if expected != item.revision:
                raise ContextBlocked("CONTEXT_STALE_SOURCE_UPDATE_REVISION")
        status = event.get("status")
        if not isinstance(status, str) or status not in STATUS:
            raise ContextBlocked("INVALID_CONTEXT_STATUS")
        revision = event.get("new_revision", item.revision)
        if not isinstance(revision, str) or not revision.strip() or len(revision) > 128:
            raise ContextBlocked("INVALID_CONTEXT_REVISION")
        recipients = event.get("usable_by")
        if recipients is not None:
            try:
                validated = _identifiers(recipients, code="INVALID_CONTEXT_RECIPIENTS")
            except ContextInputError as exc:
                raise ContextBlocked(str(exc)) from exc
            if any(p not in self.subjects and p not in self.prospective_subjects
                   and p != "COUNCIL" for p in validated):
                raise ContextBlocked("UNKNOWN_CONTEXT_RECIPIENT")
        else:
            validated = item.usable_by
        # An original event has an explicit Mesa time. A direct legacy
        # untimed update is still supported, but it disqualifies historical
        # replay for this source. Never guess its position in time.
        if at is not None:
            if type(at) is not int or not 0 <= at <= self.max_time:
                raise ContextBlocked("CONTEXT_HISTORICAL_UPDATE_TIME_INVALID")
            last_at = self._source_versions[sid][-1][0]
            if at <= last_at:
                raise ContextBlocked("CONTEXT_HISTORICAL_UPDATE_ORDER_INVALID")
        # Apply simultaneously, after all checks. No retroactive change to obligations.
        item.status = status
        item.revision = revision
        item.usable_by = validated
        if at is None:
            self._historical_time_unknown.add(sid)
        else:
            self._source_versions[sid].append((at, replace(item)))

    def affected_works(self, source: str) -> list[str]:
        if self.network_scale:
            return sorted(self._affected_work_index.get(source, ()))
        return sorted({r.work for r in self.requirements.values() if source in r.sources})

    def snapshot(self) -> dict[str, Any]:
        return {
            "evidence": "MODEL_ONLY",
            "strict": self.strict,
            "authenticated_documents": False,
            "sources": {sid: {
                "owner": s.owner, "revision": s.revision, "status": s.status,
                "usable_by": list(s.usable_by), "valid_until": s.valid_until,
                **({"core": s.scope.core,
                    "purposes": list(s.scope.purposes),
                    "operations": list(s.scope.operations),
                    "valid_from": s.scope.valid_from}
                   if s.scope is not None else {}),
            } for sid, s in sorted(self.sources.items())},
            "original_decision_source_rights": [
                {
                    "action": rule.action, "target": rule.target,
                    "actor": rule.actor, "source_ids": list(rule.sources),
                    "core": rule.scope[0], "purpose": rule.scope[1],
                    "operation": rule.scope[2],
                    "real_identity_or_document_right_authenticated": False,
                }
                for rule in (self.decision_requirements[k]
                             for k in sorted(self.decision_requirements))
            ],
            "requirements": [
                {"work": w, "action": action, "source_ids": list(req.sources),
                 **({"core": req.scope[0], "purpose": req.scope[1],
                     "operation": req.scope[2]}
                    if req.scope is not None else {})}
                for (w, action), req in sorted(self.requirements.items())
            ],
        }
