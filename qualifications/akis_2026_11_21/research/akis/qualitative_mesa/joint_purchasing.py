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


# R2.7B2B2: do not create a second purchasing or monetary ledger.
# Every ancillary payment is ONLY a reference to the same economic_claims.
_BUYER_ANCILLARY = (
    "outside_transaction_cash", "outside_marketing_cash",
    "outside_logistics_cash", "cooperation_transaction_cash",
    "cooperation_marketing_cash", "cooperation_logistics_cash",
    "switching_cash",
)
_SHARED_ANCILLARY = ("transaction_cash", "marketing_cash", "logistics_cash")
_ANCILLARY_ROW = frozenset({
    "owner", "work", "work_source_revision", "category_bindings",
    "shared_reimbursement",
})
_ANCILLARY_PLAN = frozenset({
    "plan", "buyer_ancillary", "operator_shared_costs",
})
_ANCILLARY_OPERATOR = frozenset({
    "owner", "category_bindings",
})
_ANCILLARY_POSITIVE = frozenset({"original_transfer_id", "original_resource_use_id"})
_ANCILLARY_ZERO = frozenset({"declared_zero_source_ref"})
_ANCILLARY_REIMBURSEMENT = frozenset({"original_transfer_id"})


def review_original_joint_purchase_ancillary(
    raw: Any, *, plans: Sequence[PurchasingPlan],
    price_review: Mapping[str, Any], economic_claims: Mapping[str, Any],
    works: Mapping[str, Any], links: Sequence[Any],
    economic_view: Mapping[str, Any],
) -> dict[str, Any]:
    """Reconcile buyer direct costs, operator external costs and internal fees.

    One original transfer for each positive cost (and an existing noncash
    reference) is required; an explicit owner-only model zero is required for
    each declared absent cost. Missing is UNKNOWN. This arithmetic never
    authenticates a supplier receipt, payment, invoice, interest or legality.
    """
    if not isinstance(raw, list) or len(raw) > _MAX_PLANS:
        raise PurchasingInputError("PURCHASE_ANCILLARY_BINDING_COUNT_INVALID")
    price_by_plan = {row["plan"]: row for row in price_review["plans"]}
    plans_by_id = {plan.key: plan for plan in plans}
    links_by_id = {link.key: link for link in links}
    transfers = {row["id"]: row for row in economic_claims["transfers"]}
    resources = {row["id"]: row for row in economic_claims["resource_uses"]}
    sources = {row["id"]: row for row in economic_claims["sources"]}
    used_transfer: set[str] = set()
    used_resource: set[str] = set()
    used_proof: set[str] = set()
    for price_record in economic_claims["joint_purchasing_original_cash_bindings"]:
        for row in price_record["buyer_bindings"]:
            for name in ("cooperation_external_transfer_id", "outside_external_transfer_id"):
                used_transfer.add(row[name])
            for name in ("cooperation_resource_use_id", "outside_resource_use_id"):
                used_resource.add(row[name])
            used_proof.add(row["owner_reconciliation_ref"])
    original_source_refs = {source["reference"] for source in sources.values()}

    def original_source_owner(source_id: Any, owner: str) -> bool:
        return sources.get(source_id, {}).get("owner") == owner

    def zero_proof(value: Any, owner: str) -> None:
        if not isinstance(value, dict) or set(value) != _ANCILLARY_ZERO:
            raise PurchasingInputError("PURCHASE_ANCILLARY_EXPLICIT_OWNER_ZERO_REQUIRED")
        proof = value["declared_zero_source_ref"]
        prefix = f"model://{owner}/"
        if (not isinstance(proof, str) or len(proof) <= len(prefix)
                or len(proof) > 180 or not proof.startswith(prefix)
                or proof in used_proof or proof in original_source_refs):
            raise PurchasingInputError("PURCHASE_ANCILLARY_OWNER_ZERO_SOURCE_INVALID")
        used_proof.add(proof)

    def original_payment(value: Any, *, owner: str, scenario: str,
                         work: str | None, payee: str, bucket: str,
                         expected: Decimal, resource_required: bool) -> None:
        required = (_ANCILLARY_POSITIVE if resource_required
                    else _ANCILLARY_REIMBURSEMENT)
        if not isinstance(value, dict) or set(value) != required:
            raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_PAYMENT_FIELDS_INVALID")
        payment_id = _identifier(value["original_transfer_id"], "ANCILLARY_TRANSFER")
        if payment_id in used_transfer:
            raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_TRANSFER_REUSED")
        used_transfer.add(payment_id)
        payment = transfers.get(payment_id)
        if payment is None:
            raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_TRANSFER_MISSING")
        if (payment["scenario"] != scenario or payment["payer"] != owner
                or payment["payee"] != payee or payment["work"] != work):
            raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_CASH_SCOPE_MISMATCH")
        if not original_source_owner(payment["source"], owner):
            raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_CASH_OWNER_SOURCE_INVALID")
        if _money(payment["amount"]) != expected:
            raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_CASH_AMOUNT_MISMATCH")
        if resource_required:
            resource_id = _identifier(value["original_resource_use_id"],
                                      "ANCILLARY_RESOURCE")
            if resource_id in used_resource:
                raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_RESOURCE_REUSED")
            used_resource.add(resource_id)
            res = resources.get(resource_id)
            if res is None:
                raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_RESOURCE_MISSING")
            if (res["scenario"] != scenario or res["owner"] != owner
                    or res["work"] != work or res["bucket"] != bucket):
                raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_RESOURCE_SCOPE_MISMATCH")
            if not original_source_owner(res["source"], owner):
                raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_RESOURCE_OWNER_SOURCE_INVALID")

    review: list[dict[str, Any]] = []
    seen_plans: set[str] = set()
    for record in raw:
        if not isinstance(record, dict) or set(record) != _ANCILLARY_PLAN:
            raise PurchasingInputError("PURCHASE_ANCILLARY_PLAN_FIELDS_INVALID")
        key = _identifier(record["plan"], "ANCILLARY_PLAN")
        if key in seen_plans or key not in plans_by_id or key not in price_by_plan:
            raise PurchasingInputError("PURCHASE_ANCILLARY_PLAN_MISSING_OR_DUPLICATE")
        seen_plans.add(key)
        plan = plans_by_id[key]
        price = price_by_plan[key]
        if (price["status"] !=
                "ORIGINAL_SUPPLIER_PRICE_AND_OWNER_CASH_ROWS_SOURCE_MATCHED_MODEL_ONLY"):
            review.append({
                "plan": key, "status": "PURCHASE_ANCILLARY_PRICE_SCOPE_INCOMPLETE",
                "network_original_sourced_cash_difference": None,
                "operator_internal_fee_contribution_model_only": None,
                "owner_net_comparison_qualified_count": 0,
                "underlying_purchase_price_qualified": False,
                "original_duty_payment_or_goods_receipt_authenticated": False,
                "real_causal_savings_or_profit": "NOT_ESTABLISHED",
            })
            continue
        link = links_by_id.get(plan.relation)
        if link is None or link.source_revision != plan.relation_revision:
            raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_RELATION_INVALID")
        buyers = {buyer.owner: buyer for buyer in plan.buyers}
        allocated = _shared_cents(plan, plan.buyers)
        rows = record["buyer_ancillary"]
        if not isinstance(rows, list) or len(rows) > len(buyers):
            raise PurchasingInputError("PURCHASE_ANCILLARY_BUYER_COUNT_INVALID")
        buyer_views: dict[str, Any] = {}
        buyer_model_diff = Decimal("0")
        outside_direct_total = Decimal("0")
        coop_direct_total = Decimal("0")
        internal_receipts = Decimal("0")
        missing_buyer = False
        for row in rows:
            if not isinstance(row, dict) or set(row) != _ANCILLARY_ROW:
                raise PurchasingInputError("PURCHASE_ANCILLARY_BUYER_FIELDS_INVALID")
            owner = _identifier(row["owner"], "ANCILLARY_OWNER")
            buyer = buyers.get(owner)
            if buyer is None or owner in buyer_views:
                raise PurchasingInputError("PURCHASE_ANCILLARY_BUYER_MISSING_OR_DUPLICATE")
            work_obj = works.get(buyer.work)
            if (row["work"] != buyer.work
                    or row["work_source_revision"] != buyer.work_revision
                    or work_obj is None or getattr(work_obj, "customer", None) != owner
                    or buyer.work not in link.works):
                raise PurchasingInputError("PURCHASE_ANCILLARY_ORIGINAL_WORK_OWNER_MISMATCH")
            categories = row["category_bindings"]
            if not isinstance(categories, dict) or not set(categories) <= set(_BUYER_ANCILLARY):
                raise PurchasingInputError("PURCHASE_ANCILLARY_BUYER_CATEGORIES_INVALID")
            unknown = sorted(set(_BUYER_ANCILLARY) - set(categories))
            outside_direct = Decimal("0")
            coop_direct = Decimal("0")
            for category, cell in sorted(categories.items()):
                expected = buyer.amounts[category]
                scenario = ("INDEPENDENT_ALTERNATIVE" if category.startswith("outside_")
                            else "COOPERATION")
                bucket = ("EXIT" if category == "switching_cash"
                          else "DELIVERY" if category.endswith("_logistics_cash")
                          else "COORDINATION")
                if expected == 0:
                    zero_proof(cell, owner)
                else:
                    original_payment(
                        cell, owner=owner, scenario=scenario, work=buyer.work,
                        payee="EXTERNAL", bucket=bucket, expected=expected,
                        resource_required=True,
                    )
                if scenario == "COOPERATION":
                    coop_direct += expected
                else:
                    outside_direct += expected
            reimburse = Decimal(allocated[owner]) / 100
            pay = row["shared_reimbursement"]
            if pay is None:
                unknown.append("shared_reimbursement")
            elif reimburse == 0:
                zero_proof(pay, owner)
            else:
                original_payment(
                    pay, owner=owner, scenario="COOPERATION",
                    work=buyer.work, payee=link.coordinator,
                    bucket="COORDINATION", expected=reimburse,
                    resource_required=False,
                )
            complete_owner = not unknown
            original_price_owner = price["original_buyer_private_model_views"][owner]
            buyer_delta = (
                Decimal(original_price_owner[
                    "independent_minus_cooperation_purchase_price_only"
                ]) + outside_direct - coop_direct - reimburse
                if complete_owner else None
            )
            buyer_views[owner] = {
                "original_work": buyer.work,
                "missing_ancillary_source_categories": unknown,
                "owner_all_ancillary_cash_sources_declared": complete_owner,
                "model_original_ancillary_outside_direct_cash": (
                    f"{outside_direct:.2f}" if complete_owner else None
                ),
                "model_original_ancillary_cooperation_direct_cash": (
                    f"{coop_direct:.2f}" if complete_owner else None
                ),
                "model_internal_operator_reimbursement": (
                    f"{reimburse:.2f}" if complete_owner else None
                ),
                "model_independent_minus_cooperation_buyer_cash_scope": (
                    f"{buyer_delta:.2f}" if buyer_delta is not None else None
                ),
                "liquidity_reserve_and_due_eligibility_not_inferred": True,
                "actual_payment_legal_purchase_or_profit_unverified": True,
            }
            if complete_owner:
                buyer_model_diff += buyer_delta
                outside_direct_total += outside_direct
                coop_direct_total += coop_direct
                internal_receipts += reimburse
            else:
                missing_buyer = True
        op = record["operator_shared_costs"]
        op_missing: list[str] = []
        op_paid = Decimal("0")
        if op is None:
            op_missing = list(_SHARED_ANCILLARY)
        else:
            if not isinstance(op, dict) or set(op) != _ANCILLARY_OPERATOR:
                raise PurchasingInputError("PURCHASE_ANCILLARY_OPERATOR_FIELDS_INVALID")
            operator = link.coordinator
            if (op["owner"] != operator or operator not in link.participants):
                raise PurchasingInputError("PURCHASE_ANCILLARY_OPERATOR_NOT_ORIGINAL_COORDINATOR")
            categories = op["category_bindings"]
            if not isinstance(categories, dict) or not set(categories) <= set(_SHARED_ANCILLARY):
                raise PurchasingInputError("PURCHASE_ANCILLARY_OPERATOR_CATEGORIES_INVALID")
            op_missing = sorted(set(_SHARED_ANCILLARY) - set(categories))
            for cat, cell in sorted(categories.items()):
                amount = plan.shared_costs[cat]
                if amount == 0:
                    zero_proof(cell, operator)
                else:
                    original_payment(
                        cell, owner=operator, scenario="COOPERATION",
                        work=None, payee="EXTERNAL",
                        bucket=("DELIVERY" if cat == "logistics_cash"
                                else "COORDINATION"),
                        expected=amount, resource_required=True,
                    )
                op_paid += amount
        missing = sorted(set(buyers) - set(buyer_views))
        complete = not missing and not missing_buyer and not op_missing
        operator_scope = internal_receipts - op_paid if complete else None
        network_scope = None
        if complete:
            coop_purchase = Decimal(price["group_original_supplier_external_cash_cooperation"])
            alt_purchase = Decimal(price["group_original_supplier_external_cash_independent"])
            network_scope = (alt_purchase + outside_direct_total -
                             coop_purchase - coop_direct_total - op_paid)
            if network_scope != buyer_model_diff + operator_scope:
                raise PurchasingInputError("PURCHASE_ANCILLARY_NETWORK_CASH_CONSERVATION_FAILED")
        related_works = {b.work for b in plan.buyers}
        # An original transfer that touches a buyer's Work or the
        # coordinator's unallocated shared scope but has no verified source
        # annotation prevents treating even the modelled subset as complete.
        candidate = {
            x["id"] for x in economic_claims["transfers"]
            if x["work"] in related_works or
            (x["work"] is None and
             (x["payer"] == link.coordinator or x["payee"] == link.coordinator))
        }
        unmapped_original = len(candidate - used_transfer)
        if unmapped_original:
            complete = False
            network_scope = None
            operator_scope = None
        status = (
            "MODEL_ORIGINAL_PURCHASE_ANCILLARY_AND_OPERATOR_CASH_SCOPE_RECONCILED"
            if complete else "PURCHASE_ANCILLARY_ORIGINAL_CASH_SCOPE_INCOMPLETE"
        )
        review.append({
            "plan": key, "status": status,
            "buyer_count_with_owner_cash_sources": sum(
                x["owner_all_ancillary_cash_sources_declared"]
                for x in buyer_views.values()
            ),
            "missing_original_buyer_count": len(missing),
            "missing_operator_source_categories": op_missing,
            "unmapped_original_purchase_scope_transfer_count": unmapped_original,
            "original_buyer_private_model_views": dict(sorted(buyer_views.items())),
            "original_network_outside_minus_cooperation_external_cash_model_scope": (
                f"{network_scope:.2f}" if network_scope is not None else None
            ),
            "original_buyer_outside_minus_cooperation_net_cash_model_scope": (
                f"{buyer_model_diff:.2f}" if complete else None
            ),
            "operator_internal_fee_contribution_model_only": (
                f"{operator_scope:.2f}" if operator_scope is not None else None
            ),
            "operator_fee_is_internal_network_not_external_value": True,
            "full_original_purchase_ancillary_cash_source_scope_reconciled": complete,
            "actual_operator_profit_or_liquidity_proven": False,
            "original_due_dates_and_same_tick_cash_order_not_inferred": True,
            "physical_supplier_receipt_and_quality_not_authenticated": True,
            "legal_consent_and_actual_purchasing_contract_not_created": True,
            "model_cash_source_arithmetic_not_real_caused_savings": True,
        })
    return {
        "evidence": "ONE_ORIGINAL_ECONOMIC_CLAIMS_CASH_AND_RESOURCE_LEDGER_MODEL_ONLY",
        "model_source_reconciled_complete_plan_count": sum(
            p["status"] == "MODEL_ORIGINAL_PURCHASE_ANCILLARY_AND_OPERATOR_CASH_SCOPE_RECONCILED"
            for p in review
        ),
        "model_source_incomplete_plan_count": len(review) - sum(
            p["status"] == "MODEL_ORIGINAL_PURCHASE_ANCILLARY_AND_OPERATOR_CASH_SCOPE_RECONCILED"
            for p in review
        ),
        "source_qualified_ancillary_original_transfer_reference_count": (
            len(used_transfer)
        ),
        "source_qualified_ancillary_original_resource_reference_count": (
            len(used_resource)
        ),
        "all_original_money_and_resource_use_amounts_unchanged": True,
        "bank_settlement_actual_delivery_causal_profit_not_established": True,
        "plans": sorted(review, key=lambda p: p["plan"]),
    }
