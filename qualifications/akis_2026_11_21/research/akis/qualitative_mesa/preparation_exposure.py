"""Exact preparation exposure over the ORIGINAL Mesa clock, without full snapshots.

This observer only indexes applied original trace rows. It cannot authorize a
Work, create a Result, grant a source right, or add an economic entry. A
checkpoint schedule for general AKIS projections does not sample these three
time integrals.
"""
from __future__ import annotations

from typing import Any, Mapping, Iterator

from .process_preparation import (
    _accepted_pattern_predecessor,
    original_preparation_oc_current,
    original_preparation_pattern_current,
    original_delegation_authority_observation,
)

PATTERN_FIELDS = (
    "distinct_accepted_pattern_versions",
    "accepted_versions_with_current_source_and_oc",
    "distinct_versions_returned_to_accepted_work",
)
PACKET_FIELDS = (
    "without_current_mandate",
    "current_unused_mandate",
    "current_consumed_awaiting_customer_review",
    "current_consumed_packet_not_ready",
    "current_consumed_phase_six_ready",
)
# Only actions whose effects on the preparation predicates are Work-local.
# All other applied transitions (including source/OC/owner/role/capability
# changes) conservatively requalify every outstanding scope.
LOCAL_ACTIONS = frozenset({
    "request", "offer", "authorize", "consent", "commit", "start",
    "complete", "accept", "reject", "resubmit", "formation_confirm",
    "function_delegate", "function_prepare", "function_review",
})


def _version(row: Mapping[str, Any]) -> tuple:
    p = row["model_preparation_pattern"]
    return row["actor"], p["pattern_id"], p["source_fingerprint"], p["shape_fingerprint"]


class OriginalPreparationExposure:
    """Incremental counters, not a second scheduler, authority or ledger.

    Read-only references are kept to accepted effective preparations and
    outstanding Work classifications. Only count change points are retained;
    existing summarizers integrate them on the same integer model clock.
    """

    def __init__(self) -> None:
        self._seen_pattern = False
        self._seen_grant = False
        self._effective: dict[tuple, list] = {}
        self._builds: set[tuple] = set()
        self._reuses: set[tuple] = set()
        self._returned: set[tuple] = set()
        self._current: set[tuple] = set()
        self._pending: dict[str, int] = {}
        self._counts = [0] * len(PACKET_FIELDS)
        self._points: list[tuple] = []
        self._last_at = -1
        self.observation_count = 0

    def _classify(self, state: Any, key: str, at: int) -> None:
        previous = self._pending.pop(key, None)
        if previous is not None:
            self._counts[previous] -= 1
        work = state.works.get(key)
        if work is None or work.obligation != "NOT_ACCEPTED":
            return
        rows = state.original_work_trace(key)
        # Grant identity here is its unique original event tick within this
        # Work. The existing authority evaluator only compares grant IDs.
        grants = {r["at"]: r for r in rows if r["outcome"] == "APPLIED"
                  and r["action"] == "function_delegate"}
        if not grants:
            return
        used: set[int] = set()
        for row in rows:
            packet = row.get("model_original_delegated_preparation")
            if row["outcome"] != "APPLIED" or row["action"] != "function_prepare" or packet is None:
                continue
            tick = packet["delegation_at"]
            grant = grants.get(tick)
            if (grant is not None and tick not in used
                    and grant["function_id"] == row["function_id"]
                    and grant["model_original_preparation_mandate"]["delegate"] == row["actor"]
                    and tick < row["at"]):
                used.add(tick)
        current = original_delegation_authority_observation(state, grants, used, at=at)
        values = tuple(current["packet_readiness"][field] for field in PACKET_FIELDS)
        if sum(values) != 1 or any(v not in (0, 1) for v in values):
            raise ValueError("EXACT_PREPARATION_SINGLE_WORK_CLASSIFICATION_INVALID")
        index = values.index(1)
        self._pending[key] = index
        self._counts[index] += 1

    def _accept(self, state: Any, key: str, at: int) -> None:
        work = state.works.get(key)
        if work is None or work.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT":
            return
        rows = [r for r in state.original_work_trace(key) if r["outcome"] == "APPLIED"]
        for row in rows:
            p = row.get("model_preparation_pattern")
            if row["action"] != "function_prepare" or p is None:
                continue
            try:
                effective = _accepted_pattern_predecessor(
                    state, None, row["actor"], key, row["at"], work.result_ref,
                    at, p["pattern_id"], at + 1, applied_work_rows=rows)
            except ValueError:
                continue
            if effective is not row:
                continue
            version = _version(row)
            self._effective.setdefault(version, []).append(row)
            if p["operation"] == "BUILD":
                self._builds.add(version)
            elif p["operation"] == "REUSE":
                self._reuses.add(version)
            if version in self._builds and version in self._reuses:
                self._returned.add(version)
            if (original_preparation_oc_current(state, row, at)
                    and original_preparation_pattern_current(state, row, at)):
                self._current.add(version)

    def observe(self, state: Any, *, at: int, event: Mapping[str, Any] | None,
                boundary: bool = False) -> None:
        if at <= self._last_at:
            raise ValueError("EXACT_PREPARATION_TICKS_NOT_STRICTLY_INCREASING")
        self._last_at = at
        self.observation_count += 1
        key = event.get("work") if event else None
        action = event.get("action") if event else None
        if action == "function_prepare" and "model_preparation_pattern" in event:
            self._seen_pattern = True
        if action == "function_delegate":
            self._seen_grant = True
        if action == "accept" and isinstance(key, str) and self._seen_pattern:
            self._accept(state, key, at)
        global_refresh = boundary or (event is not None and action not in LOCAL_ACTIONS)
        if global_refresh:
            for work_id in sorted(set(self._pending) | ({key} if action == "function_delegate" else set())):
                self._classify(state, work_id, at)
            self._current = {
                version for version, rows in self._effective.items()
                if any(original_preparation_oc_current(state, row, at)
                       and original_preparation_pattern_current(state, row, at) for row in rows)
            }
        elif isinstance(key, str) and (key in self._pending or action == "function_delegate"):
            self._classify(state, key, at)
        pattern, packets = self.current_counts()
        if pattern is None and packets is None:
            return
        if not self._points or self._points[-1][1:] != (pattern, packets):
            self._points.append((at, pattern, packets))

    def current_counts(self) -> tuple:
        pattern = ((len(self._effective), len(self._current), len(self._returned))
                   if self._seen_pattern else None)
        packets = tuple(self._counts) if self._seen_grant else None
        return pattern, packets

    def projection_points(self) -> Iterator[dict]:
        """Adapt compact counts to the original integration functions."""
        for at, pattern, packets in self._points:
            reproduction = {}
            if pattern is not None:
                reproduction["structural_preparation_scope"] = dict(zip(PATTERN_FIELDS, pattern, strict=True))
            gate = {}
            if packets is not None:
                gate["original_delegation_scope"] = {"current_mandate_scope": {
                    "uncommitted_works_with_original_mandate_history": sum(packets),
                    "uncommitted_works_without_current_mandate": packets[0],
                    "uncommitted_works_with_current_unused_mandate": packets[1],
                    "uncommitted_works_with_current_consumed_mandate": sum(packets[2:]),
                    "packet_readiness": dict(zip(PACKET_FIELDS, packets, strict=True)),
                }}
            yield {"at": at, "projection": {
                "author_operator_reproducibility": reproduction,
                "agent_function_formation_model_gate": gate,
            }}

    def check_final(self, pattern: Mapping | None, delegation: Mapping | None) -> None:
        """Fail closed if the incremental endpoint differs from full history."""
        expected_pattern = (tuple(pattern[k] for k in PATTERN_FIELDS)
                            if pattern is not None else None)
        expected_packets = (tuple(delegation["current_mandate_scope"]["packet_readiness"][k]
                                  for k in PACKET_FIELDS)
                            if delegation is not None else None)
        if self.current_counts() != (expected_pattern, expected_packets):
            raise ValueError("EXACT_PREPARATION_ENDPOINT_DISAGREES_WITH_ORIGINAL_HISTORY")

    @property
    def change_point_count(self) -> int:
        return len(self._points)
