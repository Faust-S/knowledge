"""Owner-asserted stage handoffs inside the existing AKIS technology DAG.

A logical MODEL_ONLY custody claim; no observed transportation, delivery time,
material balance, title transfer, or authenticated goods receipt is implied.
Opt-in material quantity and quality assertions live in material.py, on the same work.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .technology import Operation


class HandoffInputError(ValueError):
    """An opt-in transfer plan is not fully source-declared."""


@dataclass(frozen=True)
class Handoff:
    upstream: str
    downstream: str
    sender: str
    receiver: str
    source_site: str
    destination_site: str

    @property
    def edge(self) -> tuple[str, str]:
        return (self.upstream, self.downstream)


def declare_handoffs(
    operations: Sequence[Operation], resource_owners: Mapping[str, str],
    resource_specs: Mapping[str, Any], *, strict: bool,
) -> tuple[Handoff, ...]:
    """Require explicit sites on every dependence in the opt-in strict mode.

    Cross-owner transfer requires mutual acknowledgement even when two
    enterprises share a physical site. Same-owner same-site precedence has no
    additional handoff. Undeclared sites never count as same-site evidence.
    """
    if not strict:
        return ()
    by_id = {op.key: op for op in operations}
    result: list[Handoff] = []
    for downstream in operations:
        for predecessor in downstream.requires_completed:
            upstream = by_id[predecessor]
            sender = resource_owners[upstream.primary_resource]
            receiver = resource_owners[downstream.primary_resource]
            source = resource_specs[upstream.primary_resource].site
            destination = resource_specs[downstream.primary_resource].site
            if source is None or destination is None:
                raise HandoffInputError("HANDOFF_SITE_UNDECLARED")
            if sender != receiver or source != destination:
                result.append(Handoff(predecessor, downstream.key, sender,
                                      receiver, source, destination))
    return tuple(sorted(result, key=lambda h: h.edge))


def handoffs_view(
    requirements: Sequence[Handoff], states: Mapping[tuple[str, str], str],
    evidence: Mapping[tuple[str, str], Mapping[str, str]],
) -> dict[str, Any]:
    return {
        "evidence": "MODEL_ONLY",
        "transfer_claim_authentication": "DECLARED_UNVERIFIED",
        "physical_delivery": "NOT_OBSERVED",
        "transport_duration": "NOT_IDENTIFIABLE",
        "transport_cost": "NOT_IDENTIFIABLE",
        "risk_or_title_transfer": "NOT_INFERRED",
        "required_edges": [
            {"from_operation": h.upstream, "to_operation": h.downstream,
             "sender": h.sender, "receiver": h.receiver,
             "source_site": h.source_site, "destination_site": h.destination_site,
             "state": states[h.edge],
             "dispatch_ref": evidence.get(h.edge, {}).get("dispatch"),
             "receipt_ref": evidence.get(h.edge, {}).get("receipt")}
            for h in requirements
        ],
    }
