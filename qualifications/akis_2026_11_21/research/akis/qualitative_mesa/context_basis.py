"""Source-bounded KPB conditions for the *existing* qualitative AKIS state.

The source statuses and grants are MODEL_ONLY assertions, never authenticated
corporate documents, real IAM, or a new kernel. Unknown is not permission.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .scope_policy import (
    ScopeInputError, SourceScope, SCOPE_FIELDS, parse_scope,
    validate_requirement_scope, check_scope, action_scope_reason,
)

STATUS = frozenset({"CONFIRMED", "DISPROVED", "UNKNOWN"})
QUALIFIED_ACTIONS = frozenset({"authorize", "consent", "commit", "start", "complete", "accept", "resubmit", "start_operation", "complete_operation", "handoff_dispatch", "handoff_receive", "handoff_quality", "interest_update", "assess_result_quality"})
MAX_SOURCES = 256
MAX_REQUIREMENTS = 512


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


class ContextBasis:
    """Pure evaluator; status changes occur only on original-owner MODEL_ONLY events."""

    def __init__(self, data: Any, subjects: dict[str, Any], known_works: set[str]):
        _fields(data, {"strict", "sources", "requirements"}, set(), "INVALID_CONTEXT_BASIS")
        if type(data["strict"]) is not bool:
            raise ContextInputError("INVALID_CONTEXT_STRICT")
        self.strict = data["strict"]
        self.subjects = subjects
        sources, requirements = data["sources"], data["requirements"]
        if not isinstance(sources, list) or len(sources) > MAX_SOURCES:
            raise ContextInputError("INVALID_CONTEXT_SOURCE_COUNT")
        if not isinstance(requirements, list) or len(requirements) > MAX_REQUIREMENTS:
            raise ContextInputError("INVALID_CONTEXT_REQUIREMENT_COUNT")
        self.sources: dict[str, SourceAssertion] = {}
        self.requirements: dict[tuple[str, str], RequiredContext] = {}
        for item in sources:
            _fields(item, {"id", "owner", "revision", "status", "usable_by"}, {"valid_until"} | set(SCOPE_FIELDS), "INVALID_CONTEXT_SOURCE")
            key = _identifier(item["id"], "INVALID_CONTEXT_SOURCE_ID")
            owner = _identifier(item["owner"], "INVALID_CONTEXT_OWNER")
            revision = _identifier(item["revision"], "INVALID_CONTEXT_REVISION")
            if key in self.sources or owner not in subjects:
                raise ContextInputError("INVALID_CONTEXT_OWNER_OR_DUPLICATE_SOURCE")
            status = item["status"]
            if not isinstance(status, str) or status not in STATUS:
                raise ContextInputError("INVALID_CONTEXT_STATUS")
            usable_by = _identifiers(item["usable_by"], code="INVALID_CONTEXT_RECIPIENTS")
            if any(p not in subjects and p != "COUNCIL" for p in usable_by):
                raise ContextInputError("UNKNOWN_CONTEXT_RECIPIENT")
            until = item.get("valid_until")
            if until is not None and (type(until) is not int or until < 0):
                raise ContextInputError("INVALID_CONTEXT_VALID_UNTIL")
            try:
                scope = parse_scope(item)
            except ScopeInputError as exc:
                raise ContextInputError(str(exc)) from exc
            self.sources[key] = SourceAssertion(key, owner, revision, status, usable_by, until, scope)
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

    def owner_update(self, event: dict[str, Any]) -> None:
        sid = event.get("source")
        if not isinstance(sid, str) or sid not in self.sources:
            raise ContextBlocked("CONTEXT_SOURCE_UNKNOWN")
        item = self.sources[sid]
        if event.get("actor") != item.owner:
            raise ContextBlocked("CONTEXT_SOURCE_OWNER_REQUIRED")
        # Optional compare-and-set for independently arriving original-owner
        # events. Legacy research inputs without this key keep their prior
        # semantics, but cannot claim lost-update protection.
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
            if any(p not in self.subjects and p != "COUNCIL" for p in validated):
                raise ContextBlocked("UNKNOWN_CONTEXT_RECIPIENT")
        else:
            validated = item.usable_by
        # Apply simultaneously, after all checks. No retroactive change to obligations.
        item.status = status
        item.revision = revision
        item.usable_by = validated

    def affected_works(self, source: str) -> list[str]:
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
            "requirements": [
                {"work": w, "action": action, "source_ids": list(req.sources),
                 **({"core": req.scope[0], "purpose": req.scope[1],
                     "operation": req.scope[2]}
                    if req.scope is not None else {})}
                for (w, action), req in sorted(self.requirements.items())
            ],
        }
