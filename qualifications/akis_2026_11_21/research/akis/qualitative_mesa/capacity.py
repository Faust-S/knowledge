"""Declared resource capacity and calendars in one AKIS research state.

A calendar and its owner are MODEL_ONLY claims, not observed machine output,
verified property, a corporate permission, or a second scheduling engine.
The decision clock (`events.at`) and planned slot axis are deliberately distinct.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Mapping, Sequence

MAX_UNITS = 1_000_000  # parser bound, not an economic coefficient
MAX_NEEDS = 32
MAX_CALENDAR_WINDOWS = 128  # parser bound, not a scientific limit


class CapacityInputError(ValueError):
    """Malformed source-declared research input."""


class CapacityBlocked(Exception):
    """A proposed work cannot use the source-declared resource state."""

    def __init__(self, reason: str, resource: str | None = None):
        self.reason = reason
        self.resource = resource
        super().__init__(reason)


@dataclass(frozen=True)
class CalendarWindow:
    start: int
    end: int
    units: int


@dataclass(frozen=True)
class ResourceCalendar:
    revision: str
    source: str
    windows: tuple[CalendarWindow, ...]

    def available_at(self, slot: int) -> int:
        for w in self.windows:
            if w.start <= slot < w.end:
                return w.units
            if w.start > slot:
                break
        return 0  # A declared closed window is distinct from unreported availability.


@dataclass(frozen=True)
class ResourceCapacity:
    key: str
    owner: str
    units: int
    unit: str
    site: str | None
    basis: str
    calendar: ResourceCalendar | None = None


@dataclass(frozen=True)
class ResourceNeed:
    resource: str
    units: int


@dataclass(frozen=True)
class Reservation:
    resource: str
    work: str
    start: int
    end: int
    units: int


@dataclass(frozen=True)
class FutureCapacityClaim:
    """Owner-declared future planning envelope, never measured machine output."""
    adoption: str
    resource: str
    source_id: str
    source_revision: str
    start: int
    end: int
    units: int
    allowed_works: tuple[str, ...]
    active: bool = True


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise CapacityInputError(f"INVALID_{label.upper()}")
    return value


def _units(value: Any, label: str, *, permit_zero: bool = False) -> int:
    lower = 0 if permit_zero else 1
    if type(value) is not int or not lower <= value <= MAX_UNITS:
        raise CapacityInputError(f"INVALID_{label.upper()}")
    return value


def parse_resource_calendar(raw: Any, maximum: int) -> ResourceCalendar:
    if not isinstance(raw, dict) or set(raw) != {"revision", "source", "windows"}:
        raise CapacityInputError("INVALID_RESOURCE_CALENDAR_FIELDS")
    revision = _identifier(raw["revision"], "calendar_revision")
    source = _identifier(raw["source"], "calendar_source")
    if not source.startswith("model://"):
        raise CapacityInputError("CALENDAR_SOURCE_MUST_BE_MODEL_ONLY")
    windows = raw["windows"]
    if not isinstance(windows, list) or not 1 <= len(windows) <= MAX_CALENDAR_WINDOWS:
        raise CapacityInputError("INVALID_CALENDAR_WINDOW_COUNT")
    parsed: list[CalendarWindow] = []
    last_end = -1
    for obj in windows:
        if not isinstance(obj, dict) or set(obj) != {"start", "end", "units"}:
            raise CapacityInputError("INVALID_CALENDAR_WINDOW_FIELDS")
        a, b = obj["start"], obj["end"]
        if type(a) is not int or type(b) is not int or a < 0 or a >= b:
            raise CapacityInputError("INVALID_CALENDAR_WINDOW_TIME")
        qty = _units(obj["units"], "calendar_window_units", permit_zero=True)
        if qty > maximum:
            raise CapacityInputError("CALENDAR_EXCEEDS_RESOURCE_CAPACITY")
        if a < last_end:
            raise CapacityInputError("CALENDAR_WINDOWS_OVERLAP_OR_UNSORTED")
        parsed.append(CalendarWindow(a, b, qty))
        last_end = b
    return ResourceCalendar(revision, source, tuple(parsed))


def parse_resource_capacity(obj: Mapping[str, Any]) -> ResourceCapacity:
    """Static ceiling, source-declared planned calendar, owner, and site."""
    if not isinstance(obj, dict):
        raise CapacityInputError("RESOURCE_MUST_BE_OBJECT")
    key = _identifier(obj.get("id"), "resource_id")
    owner = _identifier(obj.get("owner"), "resource_owner")
    has_units = "capacity_units" in obj
    has_unit = "capacity_unit" in obj
    if has_units != has_unit:
        raise CapacityInputError("CAPACITY_UNITS_AND_UNIT_REQUIRED_TOGETHER")
    if has_units:
        units = _units(obj["capacity_units"], "capacity_units")
        unit = _identifier(obj["capacity_unit"], "capacity_unit")
        basis = "MODEL_DECLARED"
    else:
        units, unit, basis = 1, "UNSPECIFIED", "LEGACY_FIXTURE_DEFAULT"
    site = obj.get("site")
    if site is not None:
        site = _identifier(site, "resource_site")
    if "calendar" in obj and basis != "MODEL_DECLARED":
        raise CapacityInputError("CALENDAR_REQUIRES_EXPLICIT_CAPACITY")
    calendar = parse_resource_calendar(obj["calendar"], units) if "calendar" in obj else None
    return ResourceCapacity(key, owner, units, unit, site, basis, calendar)


def parse_resource_needs(
    obj: Mapping[str, Any], primary_resource: str, resources: Mapping[str, Any]
) -> tuple[ResourceNeed, ...]:
    """All original resource owners remain independent original principals."""
    _identifier(primary_resource, "primary_resource")
    if "resource_requirements" not in obj:
        return (ResourceNeed(primary_resource, 1),)
    raw = obj["resource_requirements"]
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_NEEDS:
        raise CapacityInputError("INVALID_RESOURCE_REQUIREMENT_LIST")
    result = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict) or set(item) != {"resource", "units"}:
            raise CapacityInputError("INVALID_RESOURCE_REQUIREMENT_FIELDS")
        key = _identifier(item["resource"], "required_resource")
        qty = _units(item["units"], "required_resource_units")
        if key in seen:
            raise CapacityInputError("DUPLICATE_RESOURCE_REQUIREMENT")
        if key not in resources:
            raise CapacityInputError("REQUIRED_RESOURCE_UNKNOWN")
        seen.add(key)
        result.append(ResourceNeed(key, qty))
    if primary_resource not in seen:
        raise CapacityInputError("PRIMARY_RESOURCE_REQUIREMENT_MISSING")
    return tuple(sorted(result, key=lambda n: n.resource))


class CapacityLedger:
    """One original obligation ledger with source-declared planned intervals.

    All the resources in a new work are checked before recording any reservation.
    A later owner update may reveal danger to accepted obligations but cannot
    erase, re-sign, or move them. The calendar does not advance Mesa time.
    """

    def __init__(self, specs: Mapping[str, ResourceCapacity]):
        self.specs = dict(specs)
        self.reservations: list[Reservation] = []
        # Part of this same reservation ledger, not a separate resource engine.
        self.future_capacity_claims: dict[str, list[FutureCapacityClaim]] = {}

    def original_owners(self, needs: Sequence[ResourceNeed]) -> set[str]:
        return {self.specs[n.resource].owner for n in needs}

    def _boundaries(self, key: str, reservations: Sequence[Reservation]) -> list[int]:
        points = {point for r in reservations if r.resource == key
                  for point in (r.start, r.end)}
        calendar = self.specs[key].calendar
        if calendar is not None:
            points.update(point for w in calendar.windows for point in (w.start, w.end))
        points.update(point for claim in self.future_capacity_claims.get(key, ())
                      for point in (claim.start, claim.end))
        return sorted(points)

    def _capacity_at(self, key: str, t: int) -> int:
        spec = self.specs[key]
        for claim in self.future_capacity_claims.get(key, ()):
            if claim.active and claim.start <= t < claim.end:
                return claim.units
        return spec.calendar.available_at(t) if spec.calendar is not None else spec.units

    def declare_future_capacity(self, claim: FutureCapacityClaim) -> None:
        """Apply only to unreserved future slots, preserving original obligations.

        Event-time and planned slots are different axes: this conservative
        restriction prevents a later owner declaration from revising any
        already-reserved interval, irrespective of when that reservation starts.
        """
        key = claim.resource
        spec = self.specs.get(key)
        if spec is None or spec.basis != "MODEL_DECLARED":
            raise CapacityBlocked("CAPABILITY_NEEDS_EXPLICIT_ORIGINAL_RESOURCE", key)
        if spec.calendar is not None:
            raise CapacityBlocked("CAPABILITY_CALENDAR_INTERACTION_NOT_QUALIFIED", key)
        if type(claim.start) is not int or type(claim.end) is not int or not 0 <= claim.start < claim.end:
            raise CapacityBlocked("CAPABILITY_INVALID_PLANNED_INTERVAL", key)
        if type(claim.units) is not int or not 1 <= claim.units <= MAX_UNITS:
            raise CapacityBlocked("CAPABILITY_INVALID_DECLARED_UNITS", key)
        if any(max(r.start, claim.start) < min(r.end, claim.end)
               for r in self.reservations if r.resource == key):
            raise CapacityBlocked("CAPABILITY_CANNOT_RETROACTIVELY_CHANGE_RESERVED_WORK", key)
        if any(max(old.start, claim.start) < min(old.end, claim.end)
               for old in self.future_capacity_claims.get(key, ())):
            raise CapacityBlocked("CAPABILITY_OVERLAPPING_OWNER_REVISIONS", key)
        self.future_capacity_claims.setdefault(key, []).append(claim)

    def set_future_capability_active(self, adoption: str, active: bool) -> None:
        """Change evidence eligibility, not the historical original promise."""
        for key, claims in self.future_capacity_claims.items():
            for index, claim in enumerate(claims):
                if claim.adoption == adoption and claim.active != active:
                    claims[index] = replace(claim, active=active)

    def _violations(
        self, key: str, reservations: Sequence[Reservation], *,
        proposals: Sequence[Reservation] | None = None,
    ) -> list[dict[str, Any]]:
        """Intervals with insufficient declared capacity; end is exclusive.

        New commitments only check slots touched by the proposed bundle.
        An earlier owner's reduced capacity can make some *old* commitments at
        risk without globally preventing unrelated new work on another slot.
        """
        points = self._boundaries(key, reservations)
        found = []
        for index in range(len(points) - 1):
            start, end = points[index], points[index + 1]
            if proposals is not None and not any(p.resource == key and
                    p.start <= start < p.end for p in proposals):
                continue
            active = [r for r in reservations if r.resource == key and
                      r.start <= start < r.end]
            if not active:
                continue
            available = self._capacity_at(key, start)
            used = sum(r.units for r in active)
            if used > available:
                found.append({
                    "resource": key, "start": start, "end": end,
                    "used_units": used, "available_units": available,
                    "works": sorted({r.work for r in active}),
                })
        return found

    def preview_plan(self, work: str, plan: Sequence[Reservation]) -> None:
        """Validate ALL proposed operation intervals without changing any booking."""
        if not plan or len(plan) > 1024:
            raise CapacityInputError("INVALID_OPERATION_RESERVATIONS")
        if any(r.work == work for r in self.reservations):
            raise CapacityBlocked("WORK_ALREADY_RESERVED")
        if any(r.work != work or r.resource not in self.specs or
               type(r.units) is not int or not 1 <= r.units <= MAX_UNITS or
               type(r.start) is not int or type(r.end) is not int or
               r.start < 0 or r.start >= r.end for r in plan):
            raise CapacityInputError("INVALID_OPERATION_RESERVATIONS")
        proposals = list(plan)
        combined = self.reservations + proposals
        for key in sorted({p.resource for p in proposals}):
            # When a claim raises the resource ceiling, every work sharing
            # the additional units must be in the owner's explicit scope.
            # A third party cannot silently piggyback on another Work's grant.
            for claim in self.future_capacity_claims.get(key, ()):
                if not claim.active or claim.units <= self.specs[key].units:
                    continue
                boundaries = self._boundaries(key, combined)
                for index in range(len(boundaries) - 1):
                    t = boundaries[index]
                    if not claim.start <= t < claim.end or not any(
                        p.resource == key and p.start <= t < p.end for p in proposals
                    ):
                        continue
                    active_rows = [r for r in combined if r.resource == key
                                   and r.start <= t < r.end]
                    # The original baseline is still available to unrelated
                    # Work. Only consumption ABOVE that baseline is scoped
                    # to the owner's named future Works. A blanket rejection
                    # of any unrelated Work incorrectly blocks lawful baseline
                    # use after capacity adoption.
                    outside_scope_units = sum(
                        r.units for r in active_rows
                        if r.work not in claim.allowed_works
                    )
                    if outside_scope_units > self.specs[key].units:
                        raise CapacityBlocked("CAPABILITY_FUTURE_WORK_NOT_OWNER_AUTHORIZED", key)
            if self._violations(key, combined, proposals=proposals):
                reason = ("RESOURCE_CALENDAR_CAPACITY_EXCEEDED"
                          if self.specs[key].calendar is not None
                          else "RESOURCE_CAPACITY_EXCEEDED")
                raise CapacityBlocked(reason, key)

    def explain_named_competing_reservation(
        self, work: str, plan: Sequence[Reservation], competing_work: str,
        resource: str,
    ) -> dict[str, Any]:
        """Read-only cause witness at the ORIGINAL failed commitment.

        No reservation is released or rewritten. The same interval sweep
        verifies that removing ONLY the named earlier work resolves all
        capacity violations in the proposed plan at this instant. Capacity
        alone is not a contract or a future execution guarantee.
        """
        proposals = list(plan)
        combined = [*self.reservations, *proposals]
        keys = sorted({p.resource for p in proposals})
        violations = [v for key in keys
                      for v in self._violations(key, combined, proposals=proposals)]
        without = [r for r in combined if r.work != competing_work]
        remaining = [v for key in keys
                     for v in self._violations(key, without, proposals=proposals)]
        # Check the unchanged owner-scoped adoption rules as well as the
        # numerical sweep, by calling the original preview on a local view.
        from copy import copy
        alternate = copy(self)
        alternate.reservations = [r for r in self.reservations if r.work != competing_work]
        feasible_without = False
        if work != competing_work and not remaining:
            try:
                alternate.preview_plan(work, proposals)
                feasible_without = True
            except (CapacityBlocked, CapacityInputError):
                pass
        relevant = [v for v in violations if v["resource"] == resource
                    and work in v["works"] and competing_work in v["works"]]
        return {
            "resource": resource, "competing_work": competing_work,
            "original_violating_interval_count": len(violations),
            "original_named_competition_interval_count": len(relevant),
            "capacity_violation_removed_by_named_work_absence": bool(relevant) and feasible_without,
            "original_reservations_unchanged": True,
        }

    def preview_options(
        self, option_plans: Mapping[str, Sequence[Reservation]]
    ) -> list[dict[str, Any]]:
        """Compare independent potential works WITHOUT reserving any resource.

        All candidate plans must be individually valid against accepted
        reservations. Simultaneous prospective use is then compared to
        calendar-declared capacity by the ORIGINAL interval-sweep evaluator.
        Multiple possible works remain alternatives, not accepted obligations.
        """
        if not isinstance(option_plans, Mapping) or len(option_plans) > 256:
            raise CapacityInputError("INVALID_OPTION_PORTFOLIO")
        candidates: list[Reservation] = []
        for work, plan in sorted(option_plans.items()):
            self.preview_plan(work, plan)
            candidates.extend(plan)
        if not candidates:
            return []
        combined = [*self.reservations, *candidates]
        result: list[dict[str, Any]] = []
        for resource in sorted({entry.resource for entry in candidates}):
            result.extend(self._violations(resource, combined, proposals=candidates))
        return result

    def reserve_plan(self, work: str, plan: Sequence[Reservation]) -> None:
        self.preview_plan(work, plan)
        # All resources, all operation windows: one atomic commitment.
        self.reservations.extend(plan)

    def preview(self, work: str, needs: Sequence[ResourceNeed], start: int, end: int) -> None:
        """Backward-compatible whole-work reservations, without double booking."""
        if type(start) is not int or type(end) is not int or start < 0 or end <= start:
            raise CapacityInputError("INVALID_RESERVATION_WINDOW")
        if not needs or len({n.resource for n in needs}) != len(needs):
            raise CapacityInputError("INVALID_RESOURCE_REQUIREMENTS")
        if any(n.resource not in self.specs or type(n.units) is not int
               or not 1 <= n.units <= MAX_UNITS for n in needs):
            raise CapacityInputError("INVALID_RESOURCE_REQUIREMENTS")
        self.preview_plan(work, [Reservation(n.resource, work, start, end, n.units)
                                 for n in needs])

    def reserve(self, work: str, needs: Sequence[ResourceNeed], start: int, end: int) -> None:
        self.preview(work, needs, start, end)
        self.reservations.extend(Reservation(n.resource, work, start, end, n.units)
                                 for n in needs)

    def planned_window_risk(self, needs: Sequence[ResourceNeed], start: int,
                            end: int, *, outstanding: set[str] | None = None) -> str | None:
        """Capacity risk for this operation, excluding already accepted results."""
        relevant = [r for r in self.reservations if outstanding is None or r.work in outstanding]
        for key in sorted({n.resource for n in needs}):
            for item in self._violations(key, relevant):
                if max(start, item["start"]) < min(end, item["end"]):
                    return key
        return None

    def update_calendar(self, key: str, calendar: ResourceCalendar) -> list[dict[str, Any]]:
        """Apply owner's MODEL_ONLY future planning declaration, preserving all promises."""
        if key not in self.specs:
            raise CapacityInputError("REQUIRED_RESOURCE_UNKNOWN")
        if self.future_capacity_claims.get(key):
            raise CapacityBlocked("CAPABILITY_CALENDAR_INTERACTION_NOT_QUALIFIED", key)
        self.specs[key] = replace(self.specs[key], calendar=calendar)
        return self.reservation_risks(resources={key})

    def reservation_risks(
        self, *, resources: set[str] | None = None, outstanding: set[str] | None = None
    ) -> list[dict[str, Any]]:
        """Conflicts for accepted modeled obligations, not evidence of breach."""
        risks = []
        for key in sorted(resources if resources is not None else self.specs):
            relevant = [r for r in self.reservations if r.resource == key and
                        (outstanding is None or r.work in outstanding)]
            risks.extend(self._violations(key, relevant))
        return risks

    def is_work_at_risk(self, work: str, *, outstanding: set[str] | None = None) -> str | None:
        for item in self.reservation_risks(outstanding=outstanding):
            if work in item["works"]:
                return item["resource"]
        return None

    def snapshot(self, *, outstanding: set[str] | None = None) -> dict[str, Any]:
        resources: dict[str, dict[str, Any]] = {}
        for key, spec in sorted(self.specs.items()):
            value: dict[str, Any] = {
                "owner": spec.owner, "capacity_units": spec.units,
                "capacity_unit": spec.unit, "site": spec.site,
                "capacity_basis": spec.basis,
            }
            if spec.calendar is not None:
                value["calendar"] = {
                    "revision": spec.calendar.revision,
                    "source": spec.calendar.source,
                    "source_authenticity": "DECLARED_UNVERIFIED",
                    "outside_windows": "ZERO_DECLARED_AVAILABILITY",
                    "windows": [vars(w) for w in spec.calendar.windows],
                }
            if self.future_capacity_claims.get(key):
                value["future_owner_capability_projections"] = [
                    {"adoption": c.adoption, "source_id": c.source_id,
                     "source_revision": c.source_revision, "start": c.start,
                     "end": c.end, "declared_capacity_units": c.units,
                     "original_works_authorized_for_future_use": list(c.allowed_works),
                     "source_currently_usable": c.active,
                     "real_capacity_change_independently_verified": False}
                    for c in self.future_capacity_claims[key]
                ]
            resources[key] = value
        result = {
            "evidence": "MODEL_ONLY",
            "resources": resources,
            "reservations": [vars(r) for r in self.reservations],
            "physical_transport_and_critical_path": "NOT_MODELED",
            "economic_productivity": "NOT_IDENTIFIABLE",
        }
        if any(spec.calendar is not None for spec in self.specs.values()) or self.future_capacity_claims:
            result["reservation_risks"] = self.reservation_risks(outstanding=outstanding)
            result["planned_slot_axis"] = "SEPARATE_FROM_EVENT_DECISION_CLOCK"
        return result


def original_resource_restoration_anchor(event: Mapping[str, Any], work: str, owner: str) -> bool:
    """A real transition in the original modeled resource state, not a new cost."""
    transition = event.get("original_active_execution_resource_transition", {})
    return (
        event.get("action") == "resource_status"
        and event.get("outcome") == "APPLIED"
        and event.get("actor") == owner
        and transition.get("before") in {"UNAVAILABLE", "UNKNOWN"}
        and transition.get("after") == "AVAILABLE"
        and any(row["work"] == work for row in transition.get("affected", ()))
    )


def original_execution_readiness_view(trace: Sequence[Mapping[str, Any]], work: str,
                                      horizon: int) -> dict[str, Any] | None:
    """Union of original active-execution readiness intervals on event clock.

    Overlap across required resources is counted once for Work exposure.
    UNKNOWN is not asserted to be physical unavailability. Open intervals
    remain open at the observation cutoff. No new clock or reservation.
    """
    active: dict[str, tuple[int, str]] = {}
    intervals: list[tuple[str, int, int, str]] = []
    changes = []
    for event in trace:
        transition = event.get("original_active_execution_resource_transition")
        tick = event.get("at")
        if (not transition or event.get("outcome") != "APPLIED"
                or tick > horizon or not any(
                    row["work"] == work for row in transition["affected"])):
            continue
        resource = event["resource"]
        old, new = transition["before"], transition["after"]
        changes.append((resource, old, new))
        if resource in active:
            begin, status = active.pop(resource)
            intervals.append((resource, begin, tick, status))
        if new in {"UNAVAILABLE", "UNKNOWN"}:
            active[resource] = (tick, new)
    if not changes:
        return None
    for resource, (begin, status) in active.items():
        intervals.append((resource, begin, horizon, status))

    def union(rows):
        end = total = 0
        for start, stop in sorted((a, b) for _, a, b, _ in rows):
            total += max(0, stop-max(start, end))
            end = max(end, stop)
        return total

    resources = {}
    for resource in sorted({row[0] for row in intervals}):
        own = [r for r in intervals if r[0] == resource]
        resources[resource] = {
            "declared_unavailable_ticks": union([r for r in own if r[3] == "UNAVAILABLE"]),
            "unknown_readiness_ticks": union([r for r in own if r[3] == "UNKNOWN"]),
            "still_not_ready_at_observation_cutoff": resource in active,
        }
    return {
        "original_active_execution_readiness_change_count": len(changes),
        "any_required_resource_not_ready_model_ticks": union(intervals),
        "any_required_resource_declared_unavailable_model_ticks": union(
            [r for r in intervals if r[3] == "UNAVAILABLE"]),
        "any_required_resource_unknown_readiness_model_ticks": union(
            [r for r in intervals if r[3] == "UNKNOWN"]),
        "per_original_resource": resources,
        "all_observed_readiness_interruptions_closed": not active,
        "observation_cutoff_model_tick": horizon,
        "elapsed_exposure_not_measured_physical_downtime": True,
        "parallel_resource_intervals_not_added_to_work_elapsed_time": True,
        "does_not_infer_scrap_rework_lost_output_or_cost": True,
    }
