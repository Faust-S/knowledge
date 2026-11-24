"""Source-bound execution of non-binding process functions inside the ONE AKIS model.

A=F(P,OC,KPB) has only a limited PREPARATION/CHECK research realization here.
This is not an alternate agent, event scheduler, ContextBasis, ToolRuntime or IAM.
It operates on the original Work snapshot, after the source/OC verdict has been
computed by general_system_view, and cannot write to the original model.
"""
from __future__ import annotations

from typing import Any, Mapping
from decimal import Decimal
import hashlib
import json
import re

MODEL_READY = 'MODEL_SOURCE_SCOPED_PREPARATION_ONLY'
FUNCTION_TYPES = frozenset({'CHECK', 'PREPARE', 'RECOMMEND', 'REQUEST_APPROVAL', 'EXECUTE'})


def perform_bounded_process_step(
    function: Mapping[str, Any],
    source_verdict: str,
    work_scope: Mapping[str, Any] | None,
    original_state: Any,
    *,
    at: float,
) -> dict[str, Any]:
    """Perform a deterministic, evidence-limited process computation.

    No original event, consent, resource reservation, external act or Result is
    created. The output is ephemeral, replayable, and inherits the original
    source and Work revision: a later revocation cannot retroactively rewrite
    the original execution history.
    """
    action = function.get('action')
    if action not in FUNCTION_TYPES:
        raise ValueError('AGENT_UNKNOWN_MODEL_FUNCTION')
    function_id = function.get('id')
    work_id = function.get('work')
    for key, value in [('id', function_id), ('work', work_id)]:
        if not isinstance(value, str) or not value or len(value) > 160:
            raise ValueError('AGENT_INVALID_' + key.upper())
    base = {
        'schema': 'AKIS_BOUNDED_PROCESS_STEP/0.1',
        'at': at,
        'function': function_id,
        'work': work_id,
        'model_function': action,
        'declaration_owner': function.get('owner'),
        'source_ref': function.get('source_ref'),
        'source_revision': function.get('revision'),
        'original_work_revision': function.get('work_revision'),
        'original_context_source': function.get('basis_source'),
        'basis_revision': function.get('basis_revision'),
        'source_verdict': source_verdict,
        'original_trace_position': len(getattr(original_state, 'trace', ())),
        'original_event_created': False,
        'original_work_changed': False,
        'original_result_created': False,
        'external_action_executed': False,
        'human_decision_recorded': False,
        'observed_cost_or_time_saving': 'NOT_IDENTIFIABLE',
    }
    if action == 'EXECUTE':
        return {**base, 'status': 'HUMAN_AUTHORIZATION_REQUIRED',
                'reason': 'ORIGINAL_PROGRAM_EXECUTION_NOT_DELEGATED',
                'artifact': None}
    if source_verdict != MODEL_READY:
        return {**base, 'status': 'HELD_FOR_ORIGINAL_REVIEW',
                'reason': source_verdict, 'artifact': None}
    work = getattr(original_state, 'works', {}).get(work_id)
    if work is None or getattr(work, 'source_revision', None) != function.get('work_revision'):
        return {**base, 'status': 'HELD_FOR_ORIGINAL_REVIEW',
                'reason': 'ORIGINAL_WORK_REVISION_MISMATCH', 'artifact': None}
    if work_scope is None or work_scope.get('work') != work_id:
        return {**base, 'status': 'HELD_FOR_ORIGINAL_REVIEW',
                'reason': 'ORIGINAL_PROCESS_SCOPE_MISSING', 'artifact': None}
    # This is the existing morphology module's original-principal analysis,
    # not a second calculation of owners/Work acceptance.
    principals = work_scope.get('original_principals')
    missing = work_scope.get('unresolved_original_consultation')
    if (not isinstance(principals, list) or not principals or
            not isinstance(missing, list) or
            any(not isinstance(p, str) or not p for p in principals + missing) or
            len(set(principals)) != len(principals) or
            len(set(missing)) != len(missing) or
            not set(missing) <= set(principals)):
        return {**base, 'status': 'HELD_FOR_ORIGINAL_REVIEW',
                'reason': 'ORIGINAL_PRINCIPAL_PROJECTION_INCOMPLETE', 'artifact': None}
    customer = getattr(work, 'customer', None)
    if customer not in principals:
        return {**base, 'status': 'HELD_FOR_ORIGINAL_REVIEW',
                'reason': 'ORIGINAL_CUSTOMER_NOT_QUALIFIED', 'artifact': None}
    status = ('HUMAN_REVIEW_PACKET_COMPUTED' if action == 'REQUEST_APPROVAL'
              else 'NONBINDING_PROCESS_COMPUTATION_PERFORMED')
    common = {
        'work': work_id,
        'original_customer': customer,
        'original_principals': list(principals),
        'missing_original_consents': list(missing),
        'original_work_state': {
            'proposal': getattr(work, 'proposal', 'UNKNOWN'),
            'authorized': bool(getattr(work, 'admitted', False)),
            'obligation': getattr(work, 'obligation', 'UNKNOWN'),
            'execution': getattr(work, 'execution', 'UNKNOWN'),
            'result': getattr(work, 'result', 'UNKNOWN'),
        },
        'research_next_step': work_scope.get('research_next_step', 'UNQUALIFIED'),
        'independent_original_review_required': True,
        'source_values_or_private_documents_republished': False,
    }
    # Functions are actual computations on state, not asserted capabilities.
    # The output remains strictly a metadata-only research artifact.
    if action == 'CHECK':
        common['computed_checks'] = {
            'original_customer_in_principals': True,
            'original_authorization_recorded': bool(getattr(work, 'admitted', False)),
            'independent_consents_currently_present': len(missing) == 0,
            'original_accepted_obligation': getattr(work, 'obligation', None)
                in {'ACCEPTED_BY_ORIGINAL_PRINCIPALS', 'FULFILLED'},
            'accepted_original_result': getattr(work, 'result', None)
                == 'ACCEPTED_BY_ORIGINAL_RECIPIENT',
        }
        kind = 'SOURCE_BOUND_PROCESS_CHECK'
    elif action == 'PREPARE':
        common['preparation_items'] = [
            'VERIFY_CURRENT_ORIGINAL_WORK_AND_CONTEXT',
            'CHECK_ORIGINAL_DECISION_AUTHORITY_AND_CONSENTS',
            'REVIEW_RESOURCE_TECHNOLOGY_AND_OUTSIDE_ALTERNATIVE',
            'SUBMIT_ANY_BINDING_CHANGES_TO_ORIGINAL_PRINCIPALS',
        ]
        kind = 'SOURCE_BOUND_PREPARATION_PACKET'
    elif action == 'RECOMMEND':
        common['model_recommendation'] = work_scope.get('research_next_step', 'UNQUALIFIED')
        common['recommendation_is_not_an_original_decision'] = True
        kind = 'NONBINDING_RESEARCH_RECOMMENDATION'
    else:
        # Requesting approval here prepares a packet; never messages a person,
        # creates a Task, fabricates an approval, or schedules an original event.
        common['proposed_original_reviewers'] = sorted(set(missing or [customer]))
        common['review_request_sent'] = False
        kind = 'HUMAN_REVIEW_PACKET_NOT_SENT'
    return {**base, 'status': status, 'reason': 'SOURCE_AND_OC_MODEL_CHECKS_PASSED',
            'artifact': {'kind': kind, **common}}

# Dissertation S0/S1/S2: a controlled preparation sub-process, not three
# different organizations. The same original qualified audit packet and
# independent decision gates remain in force in all three methods.
PREPARATION_MODES = ("S0", "S1", "S2")
PREPARATION_ACTIVITY_UNITS = (
    "human_entry", "program_fill", "human_validation", "packet_overhead",
)
PREPARATION_PATTERN_UNITS = ("pattern_build", "pattern_reuse")


def model_preparation_activity(state: Any, work: Any, mode: str,
                               pattern_operation: str | None = None) -> dict[str, Any]:
    """Count the field operations of preparing the same current Work packet.

    S0: manual transcription; S1: fixed document template fills header only;
    S2: source-bound bounded computation fills current values as well.
    Every field remains subject to modeled human verification, and the
    original customer's subsequent independent review is NOT replaced.
    These are structural work units, not measured seconds or LLM tokens.
    """
    if mode not in PREPARATION_MODES:
        raise ValueError("PREPARATION_MODE_INVALID")
    from .configuration_behavior import _original_principals

    # Build the SAME task set from the current original Work, rather than
    # assigning a percentage of time saving to a mode.
    header = ("work", "work_revision", "org_revision", "function")
    state_fields = ("proposal", "authorized", "obligation", "execution", "result")
    principals = _original_principals(state, work)
    current = state_fields + tuple(
        field for principal in principals
        for field in (("principal", principal), ("consent_status", principal))
    )
    fields = len(header) + len(current)
    program = {"S0": 0, "S1": len(header), "S2": fields}[mode]
    if pattern_operation is not None and (
            pattern_operation not in ("BUILD", "REUSE") or mode not in ("S1", "S2")):
        raise ValueError("PREPARATION_PATTERN_OPERATION_INVALID")
    return {
        "mode": mode,
        "original_header_field_count": len(header),
        "original_current_field_count": len(current),
        "original_principal_count": len(principals),
        "units": {
            "human_entry": fields - program,
            "program_fill": program,
            "human_validation": fields,
            "packet_overhead": 1,
            **({"pattern_build": int(pattern_operation == "BUILD"),
                "pattern_reuse": int(pattern_operation == "REUSE")}
               if pattern_operation is not None else {}),
        },
        "basis": "MODEL_FIELD_OPERATIONS_ON_ORIGINAL_QUALIFIED_PACKET",
        "independent_customer_review_remains_required": True,
        "actual_labor_time_or_software_runtime_measured": False,
    }


def preparation_source_fingerprint(value: Any) -> str:
    """Fingerprint a modeled source document, not a signature or permission."""
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")).hexdigest()


def evaluate_preparation_diagnostic(profile: Any, activity: Mapping[str, Any]) -> dict[str, Any]:
    """Doctorate eq. 4.1-4.4, 5.4: expected, not realized, resource cost.

    Source rates, scores, error probabilities, thresholds and losses are
    declared model inputs, NOT universal constants. The S2 error equation
    is the author's sensitivity relationship; S0/S1 have separate declared
    error probabilities. The risk score is dimensionless, not a cash loss.
    """
    fields = {"source_ref", "source_revision", "maturity_scores", "context_scores",
              "debt_observations", "frequency", "connectivity", "error_price_norm",
              "complexity", "error_loss", "thresholds", "critical_prohibition",
              "unit_rates_by_mode", "mode_risk"}
    if not isinstance(profile, dict) or set(profile) != fields:
        raise ValueError("PREPARATION_DIAGNOSTIC_FIELDS_INVALID")
    if (not all(isinstance(profile[key], str) and 0 < len(profile[key]) <= 160
                for key in ("source_ref", "source_revision"))
            or type(profile["critical_prohibition"]) is not bool):
        raise ValueError("PREPARATION_DIAGNOSTIC_SOURCE_INVALID")

    def number(value, maximum, decimals=4):
        if (not isinstance(value, str)
                or re.fullmatch(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1," + str(decimals) + r"})?", value) is None):
            raise ValueError("PREPARATION_DIAGNOSTIC_EXACT_NUMBER_REQUIRED")
        result = Decimal(value)
        if not Decimal(0) <= result <= Decimal(maximum):
            raise ValueError("PREPARATION_DIAGNOSTIC_NUMBER_OUT_OF_RANGE")
        return result

    def weighted(records, debt=False):
        expected = {"weight", "formal", "observed"} if debt else {"weight", "score"}
        if not isinstance(records, list) or not 1 <= len(records) <= 64:
            raise ValueError("PREPARATION_DIAGNOSTIC_CRITERIA_REQUIRED")
        weights, scores = [], []
        for row in records:
            if not isinstance(row, dict) or set(row) != expected:
                raise ValueError("PREPARATION_DIAGNOSTIC_CRITERION_FIELDS_INVALID")
            weights.append(number(row["weight"], 1))
            scores.append(abs(number(row["formal"], 1) - number(row["observed"], 1))
                          if debt else number(row["score"], 5) / 5)
        if sum(weights) != 1:
            raise ValueError("PREPARATION_DIAGNOSTIC_WEIGHTS_MUST_SUM_TO_ONE")
        return sum((weight * score for weight, score in zip(weights, scores)), Decimal(0))

    maturity = weighted(profile["maturity_scores"])
    context = weighted(profile["context_scores"])
    debt = weighted(profile["debt_observations"], debt=True)
    frequency = number(profile["frequency"], 1)
    connectivity = number(profile["connectivity"], 1)
    price_norm = number(profile["error_price_norm"], 1)
    complexity = number(profile["complexity"], 10)
    if complexity == 0:
        raise ValueError("PREPARATION_DIAGNOSTIC_POSITIVE_COMPLEXITY_REQUIRED")
    loss = number(profile["error_loss"], 999999999999, decimals=2)
    thresholds = profile["thresholds"]
    if not isinstance(thresholds, dict) or set(thresholds) != {
        "maturity_min", "context_min", "debt_max", "risk_max",
    }:
        raise ValueError("PREPARATION_DIAGNOSTIC_THRESHOLDS_REQUIRED")
    thresholds = {key: number(value, 1) for key, value in thresholds.items()}
    rates, mode_risk = profile["unit_rates_by_mode"], profile["mode_risk"]
    if (not isinstance(rates, dict) or set(rates) != set(PREPARATION_MODES)
            or not isinstance(mode_risk, dict) or set(mode_risk) != set(PREPARATION_MODES)):
        raise ValueError("PREPARATION_DIAGNOSTIC_THREE_MATCHED_MODES_REQUIRED")
    header = activity["original_header_field_count"]
    count = header + activity["original_current_field_count"]
    rows = {}
    for mode in PREPARATION_MODES:
        card, risk = rates[mode], mode_risk[mode]
        if not isinstance(card, dict) or set(card) != set(PREPARATION_ACTIVITY_UNITS):
            raise ValueError("PREPARATION_DIAGNOSTIC_RATE_CARD_INVALID")
        card = {key: number(value, 999999999999, decimals=2) for key, value in card.items()}
        filled = {"S0": 0, "S1": header, "S2": count}[mode]
        units = {"human_entry": count - filled, "program_fill": filled,
                 "human_validation": count, "packet_overhead": 1}
        cost = sum((card[key] * units[key] for key in PREPARATION_ACTIVITY_UNITS), Decimal(0))
        reasons = []
        rpd = Decimal(0)
        if mode == "S2":
            if not isinstance(risk, dict) or set(risk) != {
                "base_error_probability", "autonomy_factor", "autonomy",
            }:
                raise ValueError("PREPARATION_DIAGNOSTIC_AGENT_RISK_FIELDS_INVALID")
            autonomy = number(risk["autonomy"], 1)
            raw_probability = (number(risk["base_error_probability"], 1)
                               * (1 - context) * (1 + debt) * complexity
                               * number(risk["autonomy_factor"], 10))
            # A sensitivity relationship is not a probability beyond 1.
            probability = min(Decimal(1), raw_probability)
            rpd = debt * autonomy * frequency * connectivity * price_norm
            for condition, reason in (
                (maturity < thresholds["maturity_min"], "MATURITY_BELOW_OWNER_THRESHOLD"),
                (context < thresholds["context_min"], "CONTEXT_BELOW_OWNER_THRESHOLD"),
                (debt > thresholds["debt_max"], "PROCESS_DEBT_ABOVE_OWNER_THRESHOLD"),
                (rpd > thresholds["risk_max"], "DIGITAL_AMPLIFICATION_ABOVE_OWNER_THRESHOLD"),
                (profile["critical_prohibition"], "ORIGINAL_DECLARED_CRITICAL_PROHIBITION"),
            ):
                if condition:
                    reasons.append(reason)
        else:
            if not isinstance(risk, dict) or set(risk) != {"declared_error_probability"}:
                raise ValueError("PREPARATION_DIAGNOSTIC_BASELINE_RISK_FIELDS_INVALID")
            probability = number(risk["declared_error_probability"], 1)
            raw_probability = probability
        expected_loss = probability * loss
        rows[mode] = {
            "admissible_for_modeled_preparation": not reasons,
            "ineligibility_reasons": reasons,
            "declared_resource_cost": cost,
            "modeled_error_probability": probability,
            "probability_saturated_at_one": raw_probability > 1,
            "digital_amplification_score": rpd,
            "expected_error_loss": expected_loss,
            "risk_adjusted_expected_cost": cost + expected_loss,
        }
    # The simpler procedure wins a tie; no pressure to adopt the agent.
    recommended = min(
        (mode for mode in PREPARATION_MODES if rows[mode]["admissible_for_modeled_preparation"]),
        key=lambda mode: (rows[mode]["risk_adjusted_expected_cost"], PREPARATION_MODES.index(mode)),
    )
    return {
        "maturity": maturity, "context_readiness": context, "process_debt": debt,
        "recommended_mode": recommended, "modes": rows,
        "not_realized_cost_or_profit": True,
    }


def evaluate_selected_pattern_preparation_diagnostic(profile: Any, activity: Mapping[str, Any]) -> dict[str, Any]:
    """Risk and complete direct costs of the owner's ACTUAL selected procedure.

    Reusing one structure does not establish the availability or cost of
    another mode's pattern, and does not imply a lower error probability.
    The original author diagnostic is retained for the selected mode only;
    no alternative-mode ranking or recommendation is made in this experiment.
    """
    mode = activity.get("mode")
    units = activity.get("units")
    if (mode not in ("S1", "S2") or not isinstance(units, Mapping)
            or set(units) != set(PREPARATION_ACTIVITY_UNITS + PREPARATION_PATTERN_UNITS)
            or any(type(units[k]) is not int or units[k] not in (0, 1)
                   for k in PREPARATION_PATTERN_UNITS)
            or sum(units[k] for k in PREPARATION_PATTERN_UNITS) != 1):
        raise ValueError("PREPARATION_DIAGNOSTIC_SELECTED_PATTERN_ACTIVITY_REQUIRED")
    rates = profile.get("unit_rates_by_mode") if isinstance(profile, dict) else None
    if not isinstance(rates, dict) or set(rates) != set(PREPARATION_MODES):
        raise ValueError("PREPARATION_DIAGNOSTIC_THREE_MATCHED_MODES_REQUIRED")
    base_rates = {}
    for candidate, card in rates.items():
        if (not isinstance(card, dict)
                or set(card) != set(PREPARATION_ACTIVITY_UNITS + PREPARATION_PATTERN_UNITS)
                or any(not isinstance(card[k], str)
                       or re.fullmatch(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?", card[k]) is None
                       or Decimal(card[k]) > Decimal("999999999999")
                       for k in PREPARATION_PATTERN_UNITS)):
            raise ValueError("PREPARATION_DIAGNOSTIC_FULL_PATTERN_RATE_CARD_REQUIRED")
        base_rates[candidate] = {k: card[k] for k in PREPARATION_ACTIVITY_UNITS}
    # Only reuse the original risk equations. Do not use the legacy
    # recommendation, because alternative pattern availability is unknown.
    base = evaluate_preparation_diagnostic({**profile, "unit_rates_by_mode": base_rates}, activity)
    selected = dict(base["modes"][mode])
    direct = sum((Decimal(rates[mode][k]) * units[k] for k in units), Decimal(0))
    pattern_cost = sum((Decimal(rates[mode][k]) * units[k]
                        for k in PREPARATION_PATTERN_UNITS), Decimal(0))
    if selected["declared_resource_cost"] + pattern_cost != direct:
        raise ValueError("PREPARATION_DIAGNOSTIC_PATTERN_ACTIVITY_COST_MISMATCH")
    selected["declared_resource_cost"] = direct
    selected["risk_adjusted_expected_cost"] = direct + selected["expected_error_loss"]
    return {
        "selected_mode": mode,
        "selected": selected,
        "pattern_direct_resource_cost": pattern_cost,
        "S2_admissible": base["modes"]["S2"]["admissible_for_modeled_preparation"],
        "S2_ineligibility_reasons": base["modes"]["S2"]["ineligibility_reasons"],
        "pattern_does_not_assume_lower_error_probability": True,
        "expected_error_loss_not_posted_to_original_cost_ledger": True,
        "no_mode_ranking_or_automatic_decision": True,
    }


def review_original_preparation_diagnostic(state: Any, work: Any, actor: str,
                                           mode: str, profile: Any, at: int, *,
                                           pattern_operation: str | None = None) -> dict[str, Any]:
    """Check owner's present economic source before recommending a method.

    This cannot execute a legal act or bypass the original preparation,
    institutional, customer-review or separate consent gates.
    """
    from .context_basis import ContextBlocked
    from .strict_economic_source_review import original_owner_economic_core

    activity = model_preparation_activity(state, work, mode, pattern_operation)
    selected_pattern = (evaluate_selected_pattern_preparation_diagnostic(profile, activity)
                        if pattern_operation is not None else None)
    assessment = (evaluate_preparation_diagnostic(profile, activity)
                  if selected_pattern is None else None)
    owner = state.subjects.get(actor)
    basis = getattr(state, "context_basis", None)
    core = original_owner_economic_core(owner.kind) if owner is not None else None
    if (basis is None or not basis.strict or owner is None or not owner.active or core is None
            or not profile["source_ref"].startswith(f"model://{actor}/")):
        raise ValueError("PREPARATION_DIAGNOSTIC_ORIGINAL_OWNER_SOURCE_REQUIRED")
    try:
        basis.assert_original_form_role_source(
            actor, profile["source_ref"], profile["source_revision"], core=core,
            purpose="AKIS_ECONOMIC_WORK_EVIDENCE", operation="READ",
            recipients={actor}, at=at,
        )
    except ContextBlocked as exc:
        raise ValueError("PREPARATION_DIAGNOSTIC_ORIGINAL_SOURCE_NOT_QUALIFIED") from exc
    if selected_pattern is not None:
        if not selected_pattern["selected"]["admissible_for_modeled_preparation"]:
            raise ValueError("PREPARATION_DIAGNOSTIC_SELECTED_MODE_NOT_ADMISSIBLE")
        return {
            "status": "MODEL_ORIGINAL_SELECTED_PREPARATION_AND_PATTERN_RISK_REVIEW",
            "source_document_fingerprint": preparation_source_fingerprint(profile),
            "rate_source_fingerprint": preparation_source_fingerprint({
                "reference": profile["source_ref"], "revision": profile["source_revision"],
                "unit_rates_by_mode": profile["unit_rates_by_mode"],
            }),
            "selected_mode": mode,
            "S2_admissible": selected_pattern["S2_admissible"],
            "S2_ineligibility_reasons": selected_pattern["S2_ineligibility_reasons"],
            "original_owner_choice_is_independent": True,
            "selected_pattern_full_rate_card_qualified": True,
            "pattern_does_not_assume_lower_error_probability": True,
            "no_mode_ranking_or_automatic_decision": True,
            "no_private_amounts_in_original_trace": True,
            "no_automatic_original_consent": True,
        }
    if not assessment["modes"][mode]["admissible_for_modeled_preparation"]:
        raise ValueError("PREPARATION_DIAGNOSTIC_SELECTED_MODE_NOT_ADMISSIBLE")
    recommendation = assessment["recommended_mode"]
    return {
        "status": "MODEL_ORIGINAL_OWNER_RISK_ADJUSTED_PREPARATION_REVIEW",
        "source_document_fingerprint": preparation_source_fingerprint(profile),
        "rate_source_fingerprint": preparation_source_fingerprint({
            "reference": profile["source_ref"], "revision": profile["source_revision"],
            "unit_rates_by_mode": profile["unit_rates_by_mode"],
        }),
        "recommended_mode": recommendation,
        "selected_mode": mode,
        "selection_minimizes_declared_expected_cost": mode == recommendation,
        "S2_admissible": assessment["modes"]["S2"]["admissible_for_modeled_preparation"],
        "S2_ineligibility_reasons": assessment["modes"]["S2"]["ineligibility_reasons"],
        "original_owner_choice_is_independent": True,
        "no_private_amounts_in_original_trace": True,
        "no_automatic_original_consent": True,
    }


def original_preparation_pattern_current(state: Any, prepared: Mapping[str, Any],
                                         at: int) -> bool:
    """Recheck the exact structure source used by an applied original packet.

    A source fingerprint is not a permission. Resolve it only against the
    existing owner's current ContextBasis, and reject intervening updates
    even if a legacy update later restores the same revision. Historic
    accepted obligations are never requalified by this prospective check.
    """
    pattern = prepared.get("model_preparation_pattern")
    if pattern is None:
        return True
    from .context_basis import ContextBlocked
    from .strict_economic_source_review import original_owner_economic_core

    actor = prepared.get("actor")
    owner = state.subjects.get(actor)
    basis = state.context_basis
    core = original_owner_economic_core(owner.kind) if owner is not None else None
    if (basis is None or not basis.strict or owner is None or not owner.active
            or core is None or type(prepared.get("at")) is not int
            or prepared["at"] >= at):
        return False
    matches = [
        (ref, item) for ref, item in basis.sources.items()
        if item.owner == actor and preparation_source_fingerprint({
            "owner": actor, "reference": ref, "revision": item.revision,
        }) == pattern.get("source_fingerprint")
    ]
    if len(matches) != 1:
        return False
    ref, item = matches[0]
    try:
        basis.assert_original_form_role_source(
            actor, ref, item.revision, core=core, purpose="competence-reuse",
            operation="DERIVE", recipients={actor}, at=at,
        )
    except ContextBlocked:
        return False
    return not any(
        row.get("action") == "source_update" and row.get("outcome") == "APPLIED"
        and row.get("source") == ref and prepared["at"] < row["at"] < at
        for row in state.trace
    )


def _accepted_pattern_predecessor(state: Any, work: Any, actor: str,
                                  prior_work: str, prepare_at: int,
                                  result_ref: str, accept_at: int,
                                  pattern_id: str, at: int) -> Mapping[str, Any]:
    """Return the effective prepared packet of an independently accepted Work.

    A merely approved but superseded packet is not organizational experience
    used in the accepted Work. Require the original applied commitment after
    the review, the effective packet at that commitment and the recipient's
    subsequent acceptance. Historical provenance grants no present use right.
    """
    prior = state.works.get(prior_work)
    if (prior is None or prior.key == work.key
            or prior.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            or prior.result_ref != result_ref
            or type(prepare_at) is not int or type(accept_at) is not int
            or not 0 <= prepare_at < accept_at < at):
        raise ValueError("PREPARATION_PATTERN_PRIOR_ACCEPTED_RESULT_REQUIRED")
    rows = [r for r in state.trace if r.get("work") == prior.key
            and r.get("outcome") == "APPLIED" and r["at"] < at]
    matching = [
        r for r in rows if r.get("action") == "function_prepare"
        and r.get("actor") == actor and r["at"] == prepare_at
        and r.get("model_preparation_pattern", {}).get("pattern_id") == pattern_id
    ]
    accepts = [
        r for r in rows if r.get("action") == "accept"
        and r.get("actor") == prior.customer and r["at"] == accept_at
    ]
    commits = [r for r in rows if r.get("action") == "commit"
               and prepare_at < r["at"] < accept_at]
    error = "PREPARATION_PATTERN_ORIGINAL_REUSE_CHAIN_NOT_QUALIFIED"
    if len(matching) != 1 or len(accepts) != 1 or len(commits) != 1:
        raise ValueError(error)
    prepared, committed = matching[0], commits[0]
    reviews = [
        r for r in rows if r.get("action") == "function_review"
        and r.get("human_decision") == "APPROVE"
        and r.get("actor") == prior.customer and r.get("prepared_at") == prepare_at
        and r.get("function_id") == prepared.get("function_id")
        and r.get("org_revision") == committed.get("org_revision")
        and r.get("work_source_revision") == prepared.get("work_source_revision")
        and prepare_at < r["at"] < committed["at"]
    ]
    if (len(reviews) != 1
            or prepared.get("org_revision") != committed.get("org_revision")):
        raise ValueError(error)
    # Resolve the active original function at the historical commitment,
    # just as ModelFormationPolicy._phase_six_ready does prospectively.
    policy = state.formation_policy
    functions = [] if policy is None else [
        fn for fn in policy.design.declarations["agent_functions"]
        if fn["work"] == prior.key and fn["work_revision"] == prepared.get("work_source_revision")
        and fn["action"] == "REQUEST_APPROVAL"
        and fn["revision"] == committed.get("org_revision")
        and fn["available_at"] <= committed["at"] < fn["expires_at"]
    ]
    if len(functions) != 1 or functions[0]["id"] != prepared.get("function_id"):
        raise ValueError(error)
    effective = [
        r for r in rows if r.get("action") == "function_prepare"
        and r.get("function_id") == prepared.get("function_id")
        and r.get("org_revision") == committed.get("org_revision")
        and r.get("work_source_revision") == prepared.get("work_source_revision")
        and r["at"] < committed["at"]
    ]
    if not effective or max(effective, key=lambda r: r["at"])["at"] != prepare_at:
        raise ValueError(error)
    return prepared


def qualify_original_preparation_pattern(state: Any, work: Any, actor: str, mode: str,
                                         claim: Any, at: int) -> dict[str, Any]:
    """Reuse or explicitly rebuild an owner's structural pattern on original Work.

    A qualified prior preparation must actually have contributed to an
    accepted original Work. An explicit revision is a fresh BUILD with
    full build cost, current owner source and a lineage to the historical
    effective packet. It inherits no old values, consent or use right.
    """
    from .context_basis import ContextBlocked
    from .strict_economic_source_review import original_owner_economic_core

    if not isinstance(claim, dict) or claim.get("operation") not in ("BUILD", "REUSE"):
        raise ValueError("PREPARATION_PATTERN_OPERATION_INVALID")
    operation = claim["operation"]
    expected = {"operation", "pattern_id", "source_ref", "source_revision"}
    prior_fields = {"prior_work", "prior_prepare_at", "prior_result_ref", "prior_accepted_at"}
    if operation == "REUSE":
        expected |= prior_fields
    revises = claim.get("revises")
    if operation == "BUILD" and "revises" in claim:
        expected.add("revises")
        if (not isinstance(revises, dict)
                or set(revises) != prior_fields | {"pattern_id", "source_revision"}
                or not all(isinstance(revises[k], str) and 0 < len(revises[k]) <= 160
                           for k in set(revises) - {"prior_prepare_at", "prior_accepted_at"})):
            raise ValueError("PREPARATION_PATTERN_REVISION_FIELDS_INVALID")
    if (set(claim) != expected or mode not in ("S1", "S2")
            or not all(isinstance(claim[key], str) and 0 < len(claim[key]) <= 160
                       for key in expected - {"prior_prepare_at", "prior_accepted_at", "revises"})):
        raise ValueError("PREPARATION_PATTERN_FIELDS_INVALID")
    basis = getattr(state, "context_basis", None)
    owner = state.subjects.get(actor)
    core = original_owner_economic_core(owner.kind) if owner is not None else None
    if (basis is None or not basis.strict or owner is None or not owner.active
            or core is None or not claim["source_ref"].startswith(f"model://{actor}/")):
        raise ValueError("PREPARATION_PATTERN_OWN_SOURCE_REQUIRED")
    try:
        basis.assert_original_form_role_source(
            actor, claim["source_ref"], claim["source_revision"], core=core,
            purpose="competence-reuse", operation="DERIVE", recipients={actor}, at=at,
        )
    except ContextBlocked as exc:
        raise ValueError("PREPARATION_PATTERN_CURRENT_SOURCE_NOT_QUALIFIED") from exc
    activity = model_preparation_activity(state, work, mode)
    shape = preparation_source_fingerprint({
        key: activity[key] for key in (
            "mode", "original_header_field_count", "original_current_field_count",
            "original_principal_count",
        )
    })
    source = preparation_source_fingerprint({
        "owner": actor, "reference": claim["source_ref"], "revision": claim["source_revision"],
    })
    applied = [
        row for row in state.trace
        if row.get("action") == "function_prepare" and row.get("outcome") == "APPLIED"
        and row.get("actor") == actor
        and row.get("model_preparation_pattern", {}).get("pattern_id") == claim["pattern_id"]
    ]
    revision_evidence = None
    if operation == "BUILD":
        if applied:
            raise ValueError("PREPARATION_PATTERN_BUILD_ID_ALREADY_USED")
        if revises is not None:
            if revises["pattern_id"] == claim["pattern_id"]:
                raise ValueError("PREPARATION_PATTERN_REVISION_REQUIRES_NEW_ID")
            predecessor = _accepted_pattern_predecessor(
                state, work, actor, revises["prior_work"], revises["prior_prepare_at"],
                revises["prior_result_ref"], revises["prior_accepted_at"],
                revises["pattern_id"], at,
            )
            old = predecessor["model_preparation_pattern"]
            old_source = preparation_source_fingerprint({
                "owner": actor, "reference": claim["source_ref"],
                "revision": revises["source_revision"],
            })
            if old["source_fingerprint"] != old_source:
                raise ValueError("PREPARATION_PATTERN_REVISION_SOURCE_LINEAGE_MISMATCH")
            changes = []
            if old_source != source:
                changes.append("SOURCE_REVISION")
            if predecessor["org_revision"] != state.institution.revision:
                changes.append("ORGANIZATIONAL_CODE")
            if old["shape_fingerprint"] != shape:
                changes.append("STRUCTURE")
            if any(row.get("action") == "source_update" and row.get("outcome") == "APPLIED"
                   and row.get("source") == claim["source_ref"]
                   and predecessor["at"] < row["at"] < at for row in state.trace):
                changes.append("SOURCE_UPDATE")
            if not changes:
                raise ValueError("PREPARATION_PATTERN_REVISION_REQUIRES_OBSERVED_CHANGE")
            revision_evidence = {
                "prior_pattern_id": revises["pattern_id"],
                "prior_work": revises["prior_work"],
                "prior_prepared_at": revises["prior_prepare_at"],
                "prior_accepted_at": revises["prior_accepted_at"],
                "prior_source_fingerprint": old_source,
                "observed_changes": changes,
                "fresh_build_cost_required": True,
                "historical_lineage_is_not_current_permission": True,
            }
    else:
        predecessor = _accepted_pattern_predecessor(
            state, work, actor, claim["prior_work"], claim["prior_prepare_at"],
            claim["prior_result_ref"], claim["prior_accepted_at"],
            claim["pattern_id"], at,
        )
        previous = predecessor["model_preparation_pattern"]
        if (predecessor.get("org_revision") != state.institution.revision
                or previous["source_fingerprint"] != source
                or previous["shape_fingerprint"] != shape
                or any(row.get("action") == "source_update" and row.get("outcome") == "APPLIED"
                       and row.get("source") == claim["source_ref"]
                       and predecessor["at"] < row["at"] < at for row in state.trace)):
            raise ValueError("PREPARATION_PATTERN_ORIGINAL_REUSE_CHAIN_NOT_QUALIFIED")
    return {
        "operation": operation, "pattern_id": claim["pattern_id"],
        "source_fingerprint": source, "shape_fingerprint": shape,
        "original_prior_work": claim.get("prior_work"),
        "original_prior_prepared_at": claim.get("prior_prepare_at"),
        "original_prior_accepted_at": claim.get("prior_accepted_at"),
        "reuses_structural_pattern_not_customer_values": True,
        "all_current_source_checks_and_customer_review_remain": True,
        "new_original_consent_created": False,
        **({"original_pattern_revision": revision_evidence} if revision_evidence else {}),
    }
