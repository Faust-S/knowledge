"""M4: an original resource owner may declare a bounded *future* capability.

This is an optional part of ONE original QualitativeAKIS state, not a new task,
agreement, right, agent, resource engine, material evidence or economic ledger.
Measured-looking M3.3 claims do not automatically change any resource unit.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .capacity import CapacityBlocked, FutureCapacityClaim, MAX_UNITS
from .competence_reuse import evaluate_competence_reuse, ReuseInputError
from .competence_transfer import review_permissions, CompetencePermissionInputError
from .competence_measurement import review_measurement_protocols, MeasurementProtocolInputError
from .scope_policy import check_scope


class CapabilityInputError(ValueError):
    """Malformed MODEL_ONLY owner declaration, never a valid refusal."""


class CapabilityBlocked(Exception):
    """A valid owner action fails a prerequisite of the original capability."""
    def __init__(self, reason: str, resource: str | None = None) -> None:
        self.reason = reason
        self.resource = resource
        super().__init__(reason)


@dataclass(frozen=True)
class Adoption:
    key: str
    resource: str
    owner: str
    reuse_claim: str
    source_id: str
    source_revision: str
    source_ref: str
    declared_units: int
    initial_units: int
    resource_unit: str
    from_slot: int
    to_slot: int
    authorized_future_works: tuple[str, ...]
    future_use_source_id: str | None
    future_use_source_revision: str | None


FIELDS = frozenset({
    "id", "resource", "owner", "reuse_claim", "source_id",
    "source_revision", "source_ref", "declared_units",
    "initial_units", "resource_unit", "from_slot", "to_slot",
    "authorized_future_works", "future_use_source_id", "future_use_source_revision",
})


def _name(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 180:
        raise CapabilityInputError("CAPABILITY_INVALID_" + label)
    return value


class CapabilityAdoptionPolicy:
    """Conditioned owner event -> future envelope in ORIGINAL capacity ledger."""

    def __init__(self, raw: Any, state: Any, *, reuse_raw: Any,
                 permissions_raw: Any, measurement_raw: Any) -> None:
        if not isinstance(raw, list) or not 1 <= len(raw) <= 128:
            raise CapabilityInputError("CAPABILITY_ADOPTIONS_NONEMPTY_LIST_REQUIRED")
        if not isinstance(reuse_raw, list) or not isinstance(measurement_raw, list):
            raise CapabilityInputError("CAPABILITY_REQUIRES_REUSE_AND_MEASUREMENT_SOURCE")
        self.reuse_raw = reuse_raw
        self.permissions_raw = permissions_raw
        self.measurement_raw = measurement_raw
        self.reuse_by_id = {claim.get("id"): claim for claim in reuse_raw
                            if isinstance(claim, dict)}
        reuse_ids = set(self.reuse_by_id)
        measured_ids = {row.get("claim_id") for row in measurement_raw if isinstance(row, dict)}
        self.declared: dict[str, Adoption] = {}
        self.applied: dict[str, int] = {}
        self.latest_resource_revision: dict[str, str] = {}
        for obj in raw:
            if not isinstance(obj, dict) or set(obj) != FIELDS:
                raise CapabilityInputError("CAPABILITY_DECLARATION_FIELDS_INVALID")
            key = _name(obj["id"], "ID")
            resource = _name(obj["resource"], "RESOURCE")
            owner = _name(obj["owner"], "OWNER")
            claim = _name(obj["reuse_claim"], "REUSE_CLAIM")
            source_id = _name(obj["source_id"], "SOURCE_ID")
            revision = _name(obj["source_revision"], "SOURCE_REVISION")
            source_ref = _name(obj["source_ref"], "SOURCE_REF")
            unit = _name(obj["resource_unit"], "UNIT")
            if key in self.declared:
                raise CapabilityInputError("CAPABILITY_DECLARATION_DUPLICATE")
            spec = state.capacity_ledger.specs.get(resource)
            if spec is None or spec.owner != owner:
                raise CapabilityInputError("CAPABILITY_ORIGINAL_RESOURCE_OWNER_MISMATCH")
            if spec.basis != "MODEL_DECLARED" or spec.calendar is not None:
                raise CapabilityInputError("CAPABILITY_REQUIRES_EXPLICIT_NONCALENDAR_CAPACITY")
            if unit != spec.unit:
                raise CapabilityInputError("CAPABILITY_UNIT_MISMATCH")
            proposed, initial = obj["declared_units"], obj["initial_units"]
            if (type(proposed) is not int or type(initial) is not int or
                    not 1 <= proposed <= MAX_UNITS or initial != spec.units or
                    proposed == initial):
                raise CapabilityInputError("CAPABILITY_EXPLICIT_UNIT_CHANGE_REQUIRED")
            a, b = obj["from_slot"], obj["to_slot"]
            if type(a) is not int or type(b) is not int or not 0 <= a < b:
                raise CapabilityInputError("CAPABILITY_PLANNED_INTERVAL_INVALID")
            if claim not in reuse_ids or claim not in measured_ids:
                raise CapabilityInputError("CAPABILITY_REQUIRES_EXISTING_MEASURED_REUSE")
            if not source_ref.startswith(f"model://{owner}/"):
                raise CapabilityInputError("CAPABILITY_OWNER_SOURCE_REF_REQUIRED")
            works = obj["authorized_future_works"]
            known_work_ids = set(state.works) | {
                ev["work_spec"]["id"] for ev in state.events
                if ev["action"] == "request" and isinstance(ev.get("work_spec"), dict)
            }
            if (not isinstance(works, list) or not 1 <= len(works) <= 64 or
                len(set(works)) != len(works) or
                any(not isinstance(w, str) or w not in known_work_ids for w in works)):
                raise CapabilityInputError("CAPABILITY_FUTURE_ORIGINAL_WORK_SCOPE_REQUIRED")
            original_holder = self.reuse_by_id[claim].get("actor")
            follow_id = obj["future_use_source_id"]
            follow_revision = obj["future_use_source_revision"]
            if original_holder != owner:
                if not isinstance(original_holder, str) or not isinstance(follow_id, str) or not isinstance(follow_revision, str):
                    raise CapabilityInputError("CAPABILITY_INTERFIRM_FOLLOW_ON_OWNER_GRANT_REQUIRED")
                if not follow_id or not follow_revision:
                    raise CapabilityInputError("CAPABILITY_INTERFIRM_FOLLOW_ON_OWNER_GRANT_REQUIRED")
            elif follow_id is not None or follow_revision is not None:
                raise CapabilityInputError("CAPABILITY_SELF_USE_MUST_NOT_CLAIM_FOREIGN_GRANT")
            if state.context_basis is None or source_id not in state.context_basis.sources:
                raise CapabilityInputError("CAPABILITY_REQUIRES_EXPLICIT_CONTEXT_SOURCE")
            self.declared[key] = Adoption(
                key, resource, owner, claim, source_id, revision, source_ref,
                proposed, initial, unit, a, b,
                tuple(works), follow_id, follow_revision,
            )

    def _original_source_status(self, state: Any, item: Adoption, at: int) -> str:
        if state.context_basis is None:
            return "CAPABILITY_CONTEXT_BASIS_MISSING"
        source = state.context_basis.sources.get(item.source_id)
        if source is None or source.owner != item.owner:
            return "CAPABILITY_SOURCE_OWNER_MISMATCH"
        if source.revision != item.source_revision:
            return "CAPABILITY_OWNER_SOURCE_REVISION_STALE"
        if source.status != "CONFIRMED" or item.owner not in source.usable_by:
            return "CAPABILITY_SOURCE_NOT_USABLE"
        if source.valid_until is not None and at > source.valid_until:
            return "CAPABILITY_SOURCE_EXPIRED"
        if source.scope is not None and check_scope(
            source.scope, core=source.scope.core,
            purpose="capability-adoption", operation="DERIVE", at=at
        ) != "MODEL_SOURCE_SCOPE_CONSISTENT":
            return "CAPABILITY_SOURCE_SCOPE_NOT_QUALIFIED"
        # The earlier one-Work permission does not license future use by a
        # different firm. This separate owner declaration is only research
        # evidence and is still not a legal IP licence.
        holder = self.reuse_by_id[item.reuse_claim]["actor"]
        if holder != item.owner:
            follow = state.context_basis.sources.get(item.future_use_source_id)
            if follow is None or follow.owner != holder:
                return "CAPABILITY_FOLLOW_ON_ORIGINAL_HOLDER_SOURCE_MISSING"
            if follow.revision != item.future_use_source_revision:
                return "CAPABILITY_FOLLOW_ON_HOLDER_REVISION_STALE"
            if follow.status != "CONFIRMED" or not {holder, item.owner} <= set(follow.usable_by):
                return "CAPABILITY_FOLLOW_ON_OWNER_SOURCE_NOT_SHARED"
            if follow.valid_until is not None and at > follow.valid_until:
                return "CAPABILITY_FOLLOW_ON_OWNER_SOURCE_EXPIRED"
            if follow.scope is not None and check_scope(
                follow.scope, core=follow.scope.core,
                purpose="follow-on-capability", operation="SHARE", at=at
            ) != "MODEL_SOURCE_SCOPE_CONSISTENT":
                return "CAPABILITY_FOLLOW_ON_SOURCE_SCOPE_UNQUALIFIED"
        return "NONE"

    def refresh(self, state: Any, at: int) -> None:
        """Source change affects FUTURE readiness; never deletes accepted promises."""
        for key in self.applied:
            item = self.declared[key]
            state.capacity_ledger.set_future_capability_active(
                key, self._original_source_status(state, item, at) == "NONE"
            )

    def apply(self, state: Any, event: Mapping[str, Any], at: int) -> Adoption:
        key = event.get("capability")
        if not isinstance(key, str) or key not in self.declared:
            raise CapabilityBlocked("CAPABILITY_DECLARATION_UNKNOWN")
        item = self.declared[key]
        if key in self.applied:
            raise CapabilityBlocked("CAPABILITY_OWNER_REVISION_ALREADY_APPLIED", item.resource)
        if event.get("resource") != item.resource or event.get("actor") != item.owner:
            raise CapabilityBlocked("CAPABILITY_ORIGINAL_RESOURCE_OWNER_REQUIRED", item.resource)
        if not state.subjects[item.owner].active:
            raise CapabilityBlocked("CAPABILITY_OWNER_NO_LONGER_ACTIVE", item.resource)
        if event.get("org_revision") != state.institution.revision:
            raise CapabilityBlocked("CAPABILITY_ORIGINAL_ORG_REVISION_REQUIRED", item.resource)
        if event.get("source_revision") != item.source_revision:
            raise CapabilityBlocked("CAPABILITY_SOURCE_REVISION_MISMATCH", item.resource)
        previous = self.latest_resource_revision.get(item.resource, "BASE")
        if event.get("expected_capacity_revision") != previous:
            raise CapabilityBlocked("CAPABILITY_STALE_EXPECTED_REVISION", item.resource)
        source_reason = self._original_source_status(state, item, at)
        if source_reason != "NONE":
            raise CapabilityBlocked(source_reason, item.resource)
        try:
            permissions = (review_permissions(self.permissions_raw, state, self.reuse_raw)
                           if self.permissions_raw is not None else None)
            reuse = evaluate_competence_reuse(
                self.reuse_raw, state, permission_reviews=permissions
            )
            measurement = review_measurement_protocols(
                self.measurement_raw, state, self.reuse_raw, reuse
            )
        except (ReuseInputError, CompetencePermissionInputError,
                MeasurementProtocolInputError) as exc:
            raise CapabilityBlocked("CAPABILITY_PREREQUISITE_SOURCE_INVALID", item.resource) from exc
        evidence = next((row for row in reuse["links"] if row["id"] == item.reuse_claim), None)
        if evidence is None or evidence["model_claim_status"] != "MODEL_REPORTED_COMPARABLE_REUSE_SEQUENCE":
            raise CapabilityBlocked("CAPABILITY_REUSE_SEQUENCE_UNQUALIFIED", item.resource)
        if evidence["original_competence_owner"] != item.owner and evidence.get("model_recipient_of_knowledge") != item.owner:
            raise CapabilityBlocked("CAPABILITY_NOT_ORIGINAL_KNOWLEDGE_RECIPIENT", item.resource)
        measured = next((row for row in measurement["protocols"]
                         if row["claim_id"] == item.reuse_claim), None)
        if measured is None or measured["model_status"] != "MODEL_DECLARED_DIFFERENCE_ABOVE_SUMMED_UNCERTAINTY":
            raise CapabilityBlocked("CAPABILITY_MEASUREMENT_NOT_SEPARATED_FROM_UNCERTAINTY", item.resource)
        if measured["model_scope_reasons"] or measured["assessor_original_customer"] not in state.subjects:
            raise CapabilityBlocked("CAPABILITY_INDEPENDENT_ORIGINAL_QUALITY_SOURCE_REQUIRED", item.resource)
        if at <= max(evidence["later_accepted_at"], next(
            p["assessment_at"] for p in self.measurement_raw
            if p["claim_id"] == item.reuse_claim
        )):
            raise CapabilityBlocked("CAPABILITY_REVISION_BEFORE_RESULT_OR_MEASUREMENT", item.resource)
        try:
            state.capacity_ledger.declare_future_capacity(FutureCapacityClaim(
                adoption=item.key, resource=item.resource, source_id=item.source_id,
                source_revision=item.source_revision,
                start=item.from_slot, end=item.to_slot, units=item.declared_units,
                allowed_works=item.authorized_future_works,
            ))
        except CapacityBlocked as exc:
            raise CapabilityBlocked(exc.reason, exc.resource) from exc
        self.applied[key] = at
        self.latest_resource_revision[item.resource] = key
        return item

    def snapshot(self, state: Any, at: int) -> dict[str, Any]:
        rows = []
        for item in self.declared.values():
            source_status = self._original_source_status(state, item, at)
            rows.append({
                "id": item.key, "resource": item.resource, "original_owner": item.owner,
                "reuse_claim": item.reuse_claim, "source_revision": item.source_revision,
                "original_resource_units": item.initial_units,
                "original_resource_unit": item.resource_unit,
                "prospective_units_if_owner_adopted": item.declared_units,
                "planned_slot_from": item.from_slot, "planned_slot_to": item.to_slot,
                "authorized_follow_on_work_ids": list(item.authorized_future_works),
                "follow_on_prior_holder_source": item.future_use_source_id,
                "original_owner_event_applied_at": self.applied.get(item.key),
                "future_capacity_source_status": source_status,
                "available_for_new_original_work": (
                    item.key in self.applied and source_status == "NONE"),
                "actual_resource_capacity_or_causal_learning_verified": False,
            })
        return {
            "evidence": "MODEL_ONLY_ORIGINAL_OWNER_EVENT_NOT_FIELD_MEASURED",
            "declarations": rows,
            "declared_count": len(rows),
            "original_owner_adopted_count": len(self.applied),
            "new_original_work_or_consent_created": False,
            "original_capacity_ledger_reused": True,
            "original_obligations_and_results_preserved": True,
            "real_economic_productivity_gain": "NOT_IDENTIFIABLE",
            "decision_time_distinct_from_planned_slot_time": True,
        }
