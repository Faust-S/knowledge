"""Source-scoped transaction-cost life cycle on the ONE original cost ledger.

The original economic_flow.resource_uses remain the sole monetary-valued
noncash resource records. This module only classifies their cost origin, can
compare declared scopes, and NEVER promotes any stage label to a new expense,
payment, owner consent, or causally proven saving.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any, Mapping

class LifecycleInputError(ValueError):
    """An attempted cost assignment lacks original owner/source/scope."""

STAGES = (
    "PARTNER_SEARCH", "SOURCE_AND_IDENTITY_VERIFICATION",
    "NEGOTIATION", "CONTRACT_AND_PERMISSIONS", "ONBOARDING_AND_INTEGRATION",
    "PRODUCTION_COORDINATION", "MONITORING_AND_QUALITY",
    "CLAIMS_AND_REWORK", "ADAPTATION_AND_RENEGOTIATION",
    "RENEWAL_EXIT_AND_SWITCHING", "LEARNING_AND_REUSE",
    "SECURITY_DATA_AND_AI_GOVERNANCE", "FINANCING_CARRY_COST",
)
NATURES = (
    "TRANSACTION", "DIRECT_RESOURCE", "FINANCING",
    "DATA_SECURITY_GOVERNANCE", "SHARED_OPERATOR_CAPABILITY",
)
_SCENARIOS = ("COOPERATION", "INDEPENDENT_ALTERNATIVE")

def _identifier(value: Any, error: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 128:
        raise LifecycleInputError(error)
    return value

def _amount(value: Decimal) -> str:
    return f"{value:.2f}"

def classify_lifecycle_costs(
    raw: Any, *, sources: Mapping[str, Any], resource_index: Mapping[str, Any],
    subjects: Mapping[str, Any], outside: Mapping[str, str],
) -> dict[str, Any]:
    """Provide independent scoped owner comparisons but NO new money.

    Nature is separate from stage: not all onboarding/quality/security costs
    are transactions. Only source-declared original non-cash resource records
    can be attributed; missing records are UNKNOWN rather than zero.
    """
    if not isinstance(raw, dict) or set(raw) != {"bindings", "scope_proofs"}:
        raise LifecycleInputError("INVALID_LIFECYCLE_FIELDS")
    bindings = raw["bindings"]
    proofs = raw["scope_proofs"]
    if not isinstance(bindings, list) or len(bindings) > 4096:
        raise LifecycleInputError("INVALID_LIFECYCLE_BINDING_COUNT")
    if not isinstance(proofs, dict) or set(proofs) != set(_SCENARIOS):
        raise LifecycleInputError("INVALID_LIFECYCLE_PROOF_MAP")
    verified: dict[str, dict[str, str]] = {}
    for scenario in _SCENARIOS:
        owners = proofs[scenario]
        if not isinstance(owners, dict) or len(owners) > len(subjects):
            raise LifecycleInputError("INVALID_LIFECYCLE_OWNER_COVERAGE")
        verified[scenario] = {}
        for owner, source in owners.items():
            _identifier(owner, "INVALID_LIFECYCLE_OWNER")
            src = _identifier(source, "INVALID_LIFECYCLE_SOURCE")
            if owner not in subjects or sources.get(src, {}).get("owner") != owner:
                raise LifecycleInputError("LIFECYCLE_SCOPE_SOURCE_NOT_OWNER_QUALIFIED")
            verified[scenario][owner] = src
    classified: dict[str, dict[str, dict[str, list[Decimal]]]] = {
        sc: {owner: defaultdict(list) for owner in sorted(subjects)} for sc in _SCENARIOS
    }
    by_stage: dict[str, dict[str, dict[str, list[Decimal]]]] = {
        sc: {owner: defaultdict(list) for owner in sorted(subjects)} for sc in _SCENARIOS
    }
    seen: set[str] = set()
    for record in bindings:
        if not isinstance(record, dict) or set(record) != {
            "resource_use_id", "owner", "source", "stage", "nature",
        }:
            raise LifecycleInputError("INVALID_LIFECYCLE_COST_BINDING")
        key = _identifier(record["resource_use_id"], "INVALID_LIFECYCLE_RESOURCE")
        owner = _identifier(record["owner"], "INVALID_LIFECYCLE_OWNER")
        source = _identifier(record["source"], "INVALID_LIFECYCLE_SOURCE")
        stage = _identifier(record["stage"], "INVALID_LIFECYCLE_STAGE")
        nature = _identifier(record["nature"], "INVALID_LIFECYCLE_NATURE")
        if stage not in STAGES or nature not in NATURES:
            raise LifecycleInputError("UNKNOWN_LIFECYCLE_STAGE_OR_NATURE")
        if key in seen:
            raise LifecycleInputError("DUPLICATE_LIFECYCLE_ORIGINAL_RESOURCE")
        original = resource_index.get(key)
        if original is None:
            raise LifecycleInputError("LIFECYCLE_REFERENCE_NOT_IN_ORIGINAL_RESOURCE_LEDGER")
        if (owner not in subjects or
            original["owner"] != owner or original["source"] != source or
            sources.get(source, {}).get("owner") != owner):
            raise LifecycleInputError("LIFECYCLE_ORIGINAL_OWNER_SOURCE_MISMATCH")
        seen.add(key)
        scenario = original["scenario"]
        classified[scenario][owner][nature].append(original["decimal_amount"])
        by_stage[scenario][owner][stage].append(original["decimal_amount"])
    result: dict[str, Any] = {}
    count_comparable = 0
    for owner in sorted(subjects):
        scenarios: dict[str, Any] = {}
        for scenario in _SCENARIOS:
            original_ids = {
                key for key, row in resource_index.items()
                if row["owner"] == owner and row["scenario"] == scenario
            }
            bound_ids = {
                key for key, row in resource_index.items()
                if row["owner"] == owner and row["scenario"] == scenario and key in seen
            }
            proof = owner in verified[scenario]
            complete = proof and original_ids == bound_ids
            scenarios[scenario] = {
                "status": (
                    "DECLARED_RESOURCE_SCOPE_MATCHED_UNVERIFIED"
                    if complete else
                    "SOURCE_SCOPE_PROOF_MISSING" if not proof else
                    "UNCLASSIFIED_ORIGINAL_RESOURCE_USES_REMAIN"
                ),
                "classified_count": len(bound_ids),
                "unclassified_original_count": len(original_ids - bound_ids),
                "noncash_use_by_stage": {
                    stage: _amount(sum(values, Decimal("0")))
                    for stage, values in sorted(by_stage[scenario][owner].items())
                },
                "noncash_use_by_nature": {
                    nature: _amount(sum(values, Decimal("0")))
                    for nature, values in sorted(classified[scenario][owner].items())
                },
                "declared_resource_scope_complete_not_audited": complete,
            }
        comparable = (all(scenarios[x]["declared_resource_scope_complete_not_audited"]
                          for x in _SCENARIOS)
                      and outside.get(owner) == "FEASIBLE_DECLARED")
        difference = None
        if comparable:
            total_outside = sum(
                (v for vals in classified["INDEPENDENT_ALTERNATIVE"][owner].values()
                 for v in vals), Decimal("0"))
            total_coop = sum(
                (v for vals in classified["COOPERATION"][owner].values()
                 for v in vals), Decimal("0"))
            difference = _amount(total_outside - total_coop)
            count_comparable += 1
        result[owner] = {
            "status": "DECLARED_RESOURCE_COST_COMPARISON_ONLY"
                      if comparable else "NOT_IDENTIFIABLE_FROM_ORIGINAL_SOURCE_SCOPE",
            "original_owner_nature": getattr(subjects[owner], "kind", "UNKNOWN"),
            "scenarios": scenarios,
            "outside_minus_cooperation_noncash_resource_cost": difference,
            "transaction_saving_causal_effect": "NOT_ESTABLISHED",
            "cash_payments_added_again": False,
            "original_owner_private_costs_not_for_automatic_publication": True,
        }
    return {
        "evidence": "MODEL_ONLY_CLASSIFICATION_OF_ORIGINAL_RESOURCE_USES",
        "stages": list(STAGES),
        "natures": list(NATURES),
        "original_record_count": len(resource_index),
        "classified_original_record_count": len(seen),
        "unclassified_original_record_count": len(resource_index)-len(seen),
        "owners_with_source_declared_scope_comparison": count_comparable,
        "owner_scoped_details": result,
        "unique_original_record_constraint": True,
        "resource_use_is_not_a_cash_transfer": True,
        "same_resource_may_be_tagged_elsewhere_but_not_added_again": True,
        "full_real_transaction_cost_and_causal_gain": "NOT_ESTABLISHED",
        "original_work_consent_organization_unchanged": True,
    }
