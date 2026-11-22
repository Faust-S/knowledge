"""Conditional source-declared joint purchasing inside ONE operator AKIS.

No actual purchase, membership, assent, causal savings, system profit, or
cash flow is created. This is a *feasible prospective coalition* calculation.
The buyer's opt-in interest must be provided independently by the caller.
All cash values are owner- or supplier-declared MODEL_ONLY hypotheses.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from itertools import combinations
import re
from typing import Any, Mapping, Sequence


class PurchasingInputError(ValueError):
    """A malformed research hypothesis; not an adverse real-world outcome."""


_AMOUNT = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?\Z")
_CURRENCY = re.compile(r"[A-Z]{3}\Z")
_SHARED = frozenset({"transaction_cash", "marketing_cash", "logistics_cash", "operator_fee_cash"})
_BUYER_AMOUNTS = frozenset({
    "outside_unit_cash", "outside_transaction_cash", "outside_marketing_cash",
    "outside_logistics_cash", "cooperation_transaction_cash",
    "cooperation_marketing_cash", "cooperation_logistics_cash",
    "switching_cash", "minimum_net_gain_cash",
})
_PLAN_FIELDS = frozenset({
    "id", "relation", "relation_source_revision", "org_revision", "product", "unit",
    "period", "currency", "supplier_source_ref", "supplier_valid_from",
    "supplier_valid_until", "capacity_units", "price_tiers", "shared_costs", "buyers",
})
_BUYER_FIELDS = frozenset({
    "owner", "work", "work_source_revision", "source_ref", "available_at",
    "expires_at", "quantity_units", "requires_accepted_results",
}) | _BUYER_AMOUNTS
_MAX_BUYERS = 12  # exhaustive subset research guard, not an organizational cap
_MAX_PLANS = 32
_MAX_QUANTITY = 10**8


def _identifier(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise PurchasingInputError(f"PURCHASING_INVALID_{name}")
    return value


def _model_source(value: Any, prefix: str) -> str:
    source = _identifier(value, "SOURCE_REF")
    if not source.startswith(prefix) or len(source) == len(prefix):
        raise PurchasingInputError("PURCHASING_OWNER_OR_SUPPLIER_SOURCE_REQUIRED")
    return source


def _money(value: Any) -> Decimal:
    if not isinstance(value, str) or not _AMOUNT.fullmatch(value):
        raise PurchasingInputError("PURCHASING_INVALID_CASH_AMOUNT")
    return Decimal(value)


def _int(value: Any, label: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum or value > _MAX_QUANTITY:
        raise PurchasingInputError(f"PURCHASING_INVALID_{label}")
    return value


def _period(start: Any, end: Any) -> tuple[int, int]:
    a, b = _int(start, "START"), _int(end, "END")
    if b <= a:
        raise PurchasingInputError("PURCHASING_INVALID_VALIDITY_INTERVAL")
    return a, b


def _cents(amount: Decimal) -> int:
    return int(amount * 100)


@dataclass(frozen=True)
class Buyer:
    owner: str
    work: str
    work_revision: str
    source: str
    available_at: int
    expires_at: int
    quantity: int
    amounts: Mapping[str, Decimal]
    prerequisites: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class PurchasingPlan:
    key: str
    relation: str
    relation_revision: str
    org_revision: str
    product: str
    unit: str
    period: str
    currency: str
    supplier_source: str
    supplier_start: int
    supplier_end: int
    capacity: int
    tiers: tuple[tuple[int, Decimal], ...]
    shared_costs: Mapping[str, Decimal]
    buyers: tuple[Buyer, ...]


def parse_plans(raw: Any, subjects: Mapping[str, Any], links: Sequence[Any],
                known_works: Mapping[str, Any]) -> tuple[PurchasingPlan, ...]:
    """Validate research declarations before they can influence Mesa responses."""
    if not isinstance(raw, list) or len(raw) > _MAX_PLANS:
        raise PurchasingInputError("PURCHASING_INVALID_PLAN_COUNT")
    relation_map = {link.key: link for link in links}
    plans = []
    seen = set()
    for obj in raw:
        if not isinstance(obj, dict) or set(obj) != _PLAN_FIELDS:
            raise PurchasingInputError("PURCHASING_INVALID_PLAN_FIELDS")
        key = _identifier(obj["id"], "ID")
        if key in seen:
            raise PurchasingInputError("PURCHASING_DUPLICATE_PLAN")
        seen.add(key)
        relation = _identifier(obj["relation"], "RELATION")
        link = relation_map.get(relation)
        if link is None or link.source_revision != obj["relation_source_revision"]:
            raise PurchasingInputError("PURCHASING_RELATION_REVISION_MISMATCH")
        revision = _identifier(obj["org_revision"], "ORG_REVISION")
        currency = obj["currency"]
        if not isinstance(currency, str) or not _CURRENCY.fullmatch(currency):
            raise PurchasingInputError("PURCHASING_INVALID_CURRENCY")
        supplier_source = _model_source(obj["supplier_source_ref"], "model://supplier/")
        supplier_start, supplier_end = _period(obj["supplier_valid_from"], obj["supplier_valid_until"])
        capacity = _int(obj["capacity_units"], "CAPACITY", minimum=1)
        raw_tiers = obj["price_tiers"]
        if not isinstance(raw_tiers, list) or not 1 <= len(raw_tiers) <= 64:
            raise PurchasingInputError("PURCHASING_INVALID_TIER_COUNT")
        tiers = []
        previous = 0
        for tier in raw_tiers:
            if not isinstance(tier, dict) or set(tier) != {"minimum_units", "unit_cash"}:
                raise PurchasingInputError("PURCHASING_INVALID_TIER_FIELDS")
            threshold = _int(tier["minimum_units"], "TIER_THRESHOLD", minimum=1)
            if threshold <= previous or threshold > capacity:
                raise PurchasingInputError("PURCHASING_TIER_ORDER_OR_CAPACITY_INVALID")
            tiers.append((threshold, _money(tier["unit_cash"])))
            previous = threshold
        shared = obj["shared_costs"]
        if not isinstance(shared, dict) or set(shared) != _SHARED:
            raise PurchasingInputError("PURCHASING_INVALID_SHARED_COSTS")
        shared_costs = {name: _money(value) for name, value in shared.items()}
        rows = obj["buyers"]
        if not isinstance(rows, list) or not 2 <= len(rows) <= _MAX_BUYERS:
            raise PurchasingInputError("PURCHASING_INVALID_BUYER_COUNT")
        buyers = []
        buyer_ids = set()
        buyer_works = set()
        for row in rows:
            if not isinstance(row, dict) or set(row) != _BUYER_FIELDS:
                raise PurchasingInputError("PURCHASING_INVALID_BUYER_FIELDS")
            owner = _identifier(row["owner"], "OWNER")
            work_id = _identifier(row["work"], "WORK")
            work = known_works.get(work_id)
            if getattr(subjects.get(owner), "kind", None) != "SME":
                raise PurchasingInputError("PURCHASING_BUYER_NOT_ENTERPRISE")
            if owner not in link.participants or work is None:
                raise PurchasingInputError("PURCHASING_OWNER_WORK_UNKNOWN")
            source_revision = _identifier(row["work_source_revision"], "WORK_REVISION")
            if (getattr(work, "customer", None) != owner or
                    getattr(work, "source_revision", None) != source_revision):
                raise PurchasingInputError("PURCHASING_ORIGINAL_BUYER_WORK_REQUIRED")
            # An original work can later join a declared relation by original
            # request. It must actually be linked at evaluation time.
            if owner in buyer_ids or work_id in buyer_works:
                raise PurchasingInputError("PURCHASING_DUPLICATE_BUYER_OR_WORK")
            buyer_ids.add(owner)
            buyer_works.add(work_id)
            source = _model_source(row["source_ref"], f"model://{owner}/")
            start, end = _period(row["available_at"], row["expires_at"])
            quantity = _int(row["quantity_units"], "QUANTITY", minimum=1)
            prerequisites = row["requires_accepted_results"]
            if not isinstance(prerequisites, list) or len(prerequisites) > 64:
                raise PurchasingInputError("PURCHASING_INVALID_PREREQUISITES")
            seen_deps = set()
            deps = []
            for dep in prerequisites:
                if not isinstance(dep, dict) or set(dep) != {"work", "source_revision"}:
                    raise PurchasingInputError("PURCHASING_INVALID_PREREQUISITE_FIELDS")
                preceding = _identifier(dep["work"], "PRIOR_WORK")
                revision_dep = _identifier(dep["source_revision"], "PRIOR_REVISION")
                if preceding == work_id or preceding not in known_works or preceding in seen_deps:
                    raise PurchasingInputError("PURCHASING_INVALID_PRIOR_WORK")
                seen_deps.add(preceding)
                deps.append((preceding, revision_dep))
            amounts = {name: _money(row[name]) for name in _BUYER_AMOUNTS}
            buyers.append(Buyer(owner, work_id, source_revision, source,
                                start, end, quantity, amounts, tuple(deps)))
        plans.append(PurchasingPlan(
            key, relation, link.source_revision, revision,
            _identifier(obj["product"], "PRODUCT"), _identifier(obj["unit"], "UNIT"),
            _identifier(obj["period"], "PERIOD"), currency, supplier_source,
            supplier_start, supplier_end, capacity, tuple(tiers), shared_costs,
            tuple(sorted(buyers, key=lambda buyer: buyer.owner)),
        ))
    return tuple(sorted(plans, key=lambda plan: plan.key))


def _shared_cents(plan: PurchasingPlan, owners: Sequence[Buyer]) -> dict[str, int]:
    """Exact cents, quantity-prorata; deterministic largest-remainder allocation."""
    total_qty = sum(b.quantity for b in owners)
    total_cash = sum((_cents(v) for v in plan.shared_costs.values()), 0)
    raw = {b.owner: total_cash * b.quantity for b in owners}
    allocated = {owner: value // total_qty for owner, value in raw.items()}
    residual = total_cash - sum(allocated.values())
    order = sorted(owners, key=lambda b: (-(raw[b.owner] % total_qty), b.owner))
    for buyer in order[:residual]:
        allocated[buyer.owner] += 1
    assert sum(allocated.values()) == total_cash
    return allocated


def _quote(plan: PurchasingPlan, group: Sequence[Buyer]) -> dict[str, Any] | None:
    units = sum(b.quantity for b in group)
    if units > plan.capacity:
        return None
    applicable = [tier for tier in plan.tiers if tier[0] <= units]
    if not applicable:
        return None
    threshold, unit_price = applicable[-1]
    allocated = _shared_cents(plan, group)
    deltas = {}
    for buyer in group:
        a = buyer.amounts
        outside = buyer.quantity * a["outside_unit_cash"] + sum(
            (a[name] for name in ("outside_transaction_cash", "outside_marketing_cash", "outside_logistics_cash")),
            Decimal(0),
        )
        cooperative = buyer.quantity * unit_price + sum(
            (a[name] for name in ("cooperation_transaction_cash", "cooperation_marketing_cash",
                                 "cooperation_logistics_cash", "switching_cash")), Decimal(0),
        ) + Decimal(allocated[buyer.owner]) / 100
        deltas[buyer.owner] = outside - cooperative
    return {"threshold": threshold, "units": units, "deltas": deltas,
            "all_above_reserve": all(
                deltas[b.owner] > b.amounts["minimum_net_gain_cash"] for b in group
            )}


def evaluate_plan(plan: PurchasingPlan, *, at: float, org_revision: str,
                  links: Sequence[Any], subjects: Mapping[str, Any],
                  works: Mapping[str, Any], willing_owners: set[str]) -> dict[str, Any]:
    """Enumerate *possible* individually beneficial groups, never actual coalition.

    Eligibility requires a separately stated current WILLING model preference.
    Total gain is a prospective buyer cash comparison, NOT system profit.
    Model output intentionally excludes private buyer prices and membership.
    """
    base = {"id": plan.key, "relation": plan.relation, "evidence": "MODEL_ONLY",
            "legal_effect": "NONE", "new_original_results": 0,
            "system_profit": "NOT_IDENTIFIABLE", "actual_coalition_created": False,
            "shared_cost_allocation": "QUANTITY_PRORATA_EXACT_CENTS",
            "cash_and_resource_uses_added": False}
    link = next((link for link in links if link.key == plan.relation), None)
    if (link is None or link.source_revision != plan.relation_revision or
            org_revision != plan.org_revision or
            not (plan.supplier_start <= at < plan.supplier_end)):
        return {**base, "status": "SOURCE_NOT_CURRENT", "eligible_buyer_count": 0,
                "feasible_group_count": 0, "positions": {}}
    eligible = []
    for buyer in plan.buyers:
        work = works.get(buyer.work)
        if (buyer.owner not in willing_owners or
                buyer.owner not in subjects or not subjects[buyer.owner].active or
                work is None or work.source_revision != buyer.work_revision or
                buyer.work not in link.works or
                not buyer.available_at <= at < buyer.expires_at):
            continue
        if any((prior := works.get(pid)) is None or
               prior.source_revision != revision or
               prior.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for pid, revision in buyer.prerequisites):
            continue
        eligible.append(buyer)
    possible = []
    for count in range(2, len(eligible) + 1):
        for subset in combinations(eligible, count):
            quote = _quote(plan, subset)
            if quote is not None and quote["all_above_reserve"]:
                possible.append((subset, quote))
    positions = {buyer.owner: {"position": "UNKNOWN",
                               "reason": "NO_UNIQUE_VOLUNTARY_GROUP", "model_only": True}
                 for buyer in plan.buyers}
    if not possible:
        return {**base, "status": "NO_VOLUNTARILY_VIABLE_GROUP",
                "eligible_buyer_count": len(eligible), "feasible_group_count": 0,
                "positions": positions}
    largest = max(len(subset) for subset, _ in possible)
    maximal = [(group, quote) for group, quote in possible if len(group) == largest]
    if len(maximal) > 1:
        return {**base, "status": "MULTIPLE_POSSIBLE_GROUPS_OWNER_CHOICE_REQUIRED",
                "eligible_buyer_count": len(eligible),
                "feasible_group_count": len(possible), "positions": positions}
    group, quote = maximal[0]
    if len(group) < len(eligible):
        # Largest group is a computational ranking, NOT an independent
        # exclusion/participation decision of the original enterprises.
        return {**base, "status": "PARTIAL_GROUP_REQUIRES_INDEPENDENT_MEMBERSHIP_SELECTION",
                "eligible_buyer_count": len(eligible),
                "feasible_group_count": len(possible), "positions": positions}
    for buyer in group:
        positions[buyer.owner] = {
            "position": "COOPERATION_PREFERRED",
            "reason": "UNIQUE_LARGEST_VOLUNTARILY_VIABLE_GROUP_MODEL_ONLY",
            "model_only": True,
        }
    return {**base, "status": "UNIQUE_PROSPECTIVE_GROUP_NOT_CONSENTED",
            "eligible_buyer_count": len(eligible), "feasible_group_count": len(possible),
            "prospective_buyer_count": len(group),
            "prospective_quantity_units": quote["units"],
            "tier_minimum_units": quote["threshold"],
            "positions": positions}

# R2.7B2B1: read-only references to pre-existing original money and
# noncash resources. These annotations are NOT new transfers, settlement,
# supplier delivery, owner consent, causal savings, or a second purchasing
# calculation. Joint group quotations remain prospective until originals
# establish independent execution, delivery, cash and legal sources.
_ORIGINAL_PURCHASE_PLAN_FIELDS = frozenset({
    "plan", "supplier_source_ref", "quote_at", "buyer_bindings",
})
_ORIGINAL_PURCHASE_BUYER_FIELDS = frozenset({
    "owner", "work", "work_source_revision", "owner_reconciliation_ref",
    "cooperation_external_transfer_id", "outside_external_transfer_id",
    "cooperation_resource_use_id", "outside_resource_use_id",
})


def review_original_joint_purchase_cash(
    raw: Any, *, plans: Sequence[PurchasingPlan],
    economic_claims: Mapping[str, Any], works: Mapping[str, Any],
    links: Sequence[Any], org_revision: str,
) -> dict[str, Any]:
    """Match original price *claims* to the one economic_claims ledger.

    Does not validate cash settlement or goods receipt. In particular, the
    supplier quote is a separate model-only claim, not an authenticated offer.
    Buyer ancillary costs (marketing, freight, operator fees, switching and
    transaction costs) are outside the price-only reconciliation. Full net
    benefit and actual network savings always remain unknown.
    """
    if not isinstance(raw, list) or len(raw) > _MAX_PLANS:
        raise PurchasingInputError("PURCHASE_ORIGINAL_LINK_COUNT_INVALID")
    if not isinstance(economic_claims, dict):
        raise PurchasingInputError("PURCHASE_REQUIRES_ORIGINAL_ECONOMIC_CLAIMS")
    if not isinstance(org_revision, str):
        raise PurchasingInputError("PURCHASE_ORIGINAL_ORG_REVISION_UNKNOWN")
    plan_by_id = {plan.key: plan for plan in plans}
    link_by_id = {link.key: link for link in links}
    transfers = {row["id"]: row for row in economic_claims["transfers"]}
    resources = {row["id"]: row for row in economic_claims["resource_uses"]}
    sources = {row["id"]: row for row in economic_claims["sources"]}
    coverage = economic_claims["coverage"]
    feasible = economic_claims["outside_feasibility"]
    used_cash: set[str] = set()
    used_resources: set[str] = set()
    used_model_proofs: set[str] = set()
    seen_plans: set[str] = set()
    results: list[dict[str, Any]] = []
    for record in raw:
        if not isinstance(record, dict) or set(record) != _ORIGINAL_PURCHASE_PLAN_FIELDS:
            raise PurchasingInputError("PURCHASE_ORIGINAL_LINK_FIELDS_INVALID")
        key = _identifier(record["plan"], "ORIGINAL_PLAN_ID")
        plan = plan_by_id.get(key)
        if plan is None or key in seen_plans:
            raise PurchasingInputError("PURCHASE_ORIGINAL_PLAN_MISSING_OR_DUPLICATE")
        seen_plans.add(key)
        link = link_by_id.get(plan.relation)
        if (link is None or link.source_revision != plan.relation_revision
                or org_revision != plan.org_revision):
            raise PurchasingInputError("PURCHASE_ORIGINAL_RELATION_OR_CODE_STALE")
        if (economic_claims["period"] != plan.period
                or economic_claims["currency"] != plan.currency):
            raise PurchasingInputError("PURCHASE_ORIGINAL_PERIOD_CURRENCY_MISMATCH")
        if record["supplier_source_ref"] != plan.supplier_source:
            raise PurchasingInputError("PURCHASE_ORIGINAL_SUPPLIER_QUOTE_SOURCE_MISMATCH")
        at = record["quote_at"]
        if (type(at) is not int or
                not plan.supplier_start <= at < plan.supplier_end):
            raise PurchasingInputError("PURCHASE_ORIGINAL_SUPPLIER_QUOTE_EXPIRED")
        declared_units = sum(b.quantity for b in plan.buyers)
        if declared_units > plan.capacity:
            raise PurchasingInputError("PURCHASE_ORIGINAL_GROUP_CAPACITY_EXCEEDED")
        tiers = [(threshold, price) for threshold, price in plan.tiers
                 if threshold <= declared_units]
        if not tiers:
            raise PurchasingInputError("PURCHASE_ORIGINAL_PRICE_TIER_UNAVAILABLE")
        threshold, price = tiers[-1]
        rows = record["buyer_bindings"]
        if not isinstance(rows, list) or len(rows) > len(plan.buyers):
            raise PurchasingInputError("PURCHASE_ORIGINAL_BUYER_BINDING_COUNT_INVALID")
        plan_buyers = {b.owner: b for b in plan.buyers}
        seen_buyers: set[str] = set()
        owner_views: dict[str, dict[str, Any]] = {}
        coop_gross = Decimal("0")
        outside_gross = Decimal("0")
        for row in rows:
            if not isinstance(row, dict) or set(row) != _ORIGINAL_PURCHASE_BUYER_FIELDS:
                raise PurchasingInputError("PURCHASE_ORIGINAL_BUYER_FIELDS_INVALID")
            owner = _identifier(row["owner"], "ORIGINAL_BUYER_OWNER")
            buyer = plan_buyers.get(owner)
            if buyer is None or owner in seen_buyers:
                raise PurchasingInputError("PURCHASE_ORIGINAL_BUYER_NOT_IN_PLAN_OR_DUPLICATE")
            seen_buyers.add(owner)
            work = works.get(buyer.work)
            if (row["work"] != buyer.work or
                    row["work_source_revision"] != buyer.work_revision or
                    work is None or getattr(work, "customer", None) != owner or
                    getattr(work, "source_revision", None) != buyer.work_revision or
                    buyer.work not in link.works):
                raise PurchasingInputError("PURCHASE_ORIGINAL_BUYER_WORK_SCOPE_MISMATCH")
            if not buyer.available_at <= at < buyer.expires_at:
                raise PurchasingInputError("PURCHASE_ORIGINAL_BUYER_NEED_OUTSIDE_QUOTE")
            proof = row["owner_reconciliation_ref"]
            if (not isinstance(proof, str) or not proof.startswith(f"model://{owner}/")
                    or proof in used_model_proofs
                    or proof in (buyer.source, plan.supplier_source)
                    or len(proof) > 180 or len(proof) <= len(f"model://{owner}/")):
                raise PurchasingInputError("PURCHASE_ORIGINAL_INDEPENDENT_OWNER_PROOF_REQUIRED")
            used_model_proofs.add(proof)
            expected = {
                "COOPERATION": buyer.quantity * price,
                "INDEPENDENT_ALTERNATIVE": (
                    buyer.quantity * buyer.amounts["outside_unit_cash"]
                ),
            }
            observed: dict[str, Decimal] = {}
            for scenario, transfer_field, resource_field in (
                ("COOPERATION", "cooperation_external_transfer_id",
                 "cooperation_resource_use_id"),
                ("INDEPENDENT_ALTERNATIVE", "outside_external_transfer_id",
                 "outside_resource_use_id"),
            ):
                cash_id = _identifier(row[transfer_field], "ORIGINAL_TRANSFER_ID")
                resource_id = _identifier(row[resource_field], "ORIGINAL_RESOURCE_USE_ID")
                if cash_id in used_cash or resource_id in used_resources:
                    raise PurchasingInputError("PURCHASE_ORIGINAL_CASH_OR_RESOURCE_REUSED")
                used_cash.add(cash_id)
                used_resources.add(resource_id)
                transfer = transfers.get(cash_id)
                resource = resources.get(resource_id)
                if transfer is None or resource is None:
                    raise PurchasingInputError("PURCHASE_ORIGINAL_CASH_AND_RESOURCE_REQUIRED")
                if (transfer["scenario"] != scenario or
                        transfer["payer"] != owner or transfer["payee"] != "EXTERNAL"
                        or transfer["work"] != buyer.work):
                    raise PurchasingInputError("PURCHASE_ORIGINAL_EXTERNAL_BUYER_PAYMENT_SCOPE")
                if (resource["scenario"] != scenario or resource["owner"] != owner
                        or resource["work"] != buyer.work or resource["bucket"] != "DELIVERY"):
                    raise PurchasingInputError("PURCHASE_ORIGINAL_BUYER_RESOURCE_SCOPE")
                if (sources.get(transfer["source"], {}).get("owner") != owner
                        or sources.get(resource["source"], {}).get("owner") != owner):
                    raise PurchasingInputError("PURCHASE_ORIGINAL_OWNER_SOURCE_MISMATCH")
                declared_amount = _money(transfer["amount"])
                if declared_amount != expected[scenario]:
                    raise PurchasingInputError("PURCHASE_ORIGINAL_UNIT_PRICE_CASH_MISMATCH")
                observed[scenario] = declared_amount
            is_originally_covered = all(
                owner in coverage[sc] for sc in
                ("COOPERATION", "INDEPENDENT_ALTERNATIVE")
            )
            is_outside_feasible = (
                feasible.get(owner, {}).get("state") == "FEASIBLE_DECLARED"
            )
            source_complete = is_originally_covered and is_outside_feasible
            owner_views[owner] = {
                "original_work": buyer.work,
                "original_buyer_source_ref": proof,
                "declared_purchase_quantity_units": buyer.quantity,
                "cooperation_original_supplier_cash": f"{observed['COOPERATION']:.2f}",
                "independent_original_supplier_cash": (
                    f"{observed['INDEPENDENT_ALTERNATIVE']:.2f}"
                ),
                "independent_minus_cooperation_purchase_price_only": (
                    f"{observed['INDEPENDENT_ALTERNATIVE']-observed['COOPERATION']:.2f}"
                    if source_complete else None
                ),
                "owner_outside_feasibility_and_cash_coverage_declared": source_complete,
                "real_purchase_delivery_payment_or_discount_authenticated": False,
                "price_alone_does_not_include_operator_logistics_advertising_or_risk": True,
            }
            coop_gross += observed["COOPERATION"]
            outside_gross += observed["INDEPENDENT_ALTERNATIVE"]
        missing = sorted(set(plan_buyers) - seen_buyers)
        complete = not missing and all(
            row["owner_outside_feasibility_and_cash_coverage_declared"]
            for row in owner_views.values()
        )
        results.append({
            "plan": key,
            "status": ("ORIGINAL_SUPPLIER_PRICE_AND_OWNER_CASH_ROWS_SOURCE_MATCHED_MODEL_ONLY"
                       if complete else "PURCHASE_ORIGINAL_OWNER_PRICE_SCOPE_INCOMPLETE"),
            "declared_model_tier_minimum_quantity": threshold,
            "declared_model_group_quantity_units": declared_units,
            "source_matched_original_owner_count": len(owner_views),
            "missing_original_buyer_count": len(missing),
            "original_owner_outside_or_coverage_unknown_count": sum(
                not row["owner_outside_feasibility_and_cash_coverage_declared"]
                for row in owner_views.values()
            ),
            "original_buyer_private_model_views": dict(sorted(owner_views.items())),
            "group_original_supplier_external_cash_cooperation": (
                f"{coop_gross:.2f}" if complete else None
            ),
            "group_original_supplier_external_cash_independent": (
                f"{outside_gross:.2f}" if complete else None
            ),
            "group_independent_minus_cooperation_supplier_price_claim_only": (
                f"{outside_gross-coop_gross:.2f}" if complete else None
            ),
            "full_ancillary_and_operator_purchase_costs_reconciled": False,
            "original_work_results_or_supplier_delivery_accepted_proven": False,
            "actual_external_bank_settlement_proven": False,
            "full_network_economic_gain_or_profits_proven": False,
            "original_transfer_and_resource_amounts_unchanged": True,
            "supplier_quote_source_not_authenticated": True,
            "group_consent_or_new_contract_created": False,
        })
    return {
        "evidence": "SOURCE_DECLARED_ORIGINAL_LEDGER_REFERENCES_MODEL_ONLY",
        "original_matched_plan_count": sum(
            row["status"] ==
            "ORIGINAL_SUPPLIER_PRICE_AND_OWNER_CASH_ROWS_SOURCE_MATCHED_MODEL_ONLY"
            for row in results
        ),
        "original_incomplete_plan_count": len(results) - sum(
            row["status"] ==
            "ORIGINAL_SUPPLIER_PRICE_AND_OWNER_CASH_ROWS_SOURCE_MATCHED_MODEL_ONLY"
            for row in results
        ),
        "source_declared_existing_original_transfer_count": len(used_cash),
        "source_declared_existing_original_resource_use_count": len(used_resources),
        "unreviewed_purchasing_plan_count": len(plans) - len(results),
        "original_network_cash_and_resource_ledgers_unchanged": True,
        "true_savings_real_payment_delivery_and_group_rights_not_established": True,
        "plans": sorted(results, key=lambda row: row["plan"]),
    }
