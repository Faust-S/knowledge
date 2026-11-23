"""Read-only nine-component view over ONE original Mesa Work/Result cycle.

No new actor, Work, source registry, money book, state machine or authority is
created here. All causal evidence comes from the already executed original
Mesa trace, original qualified sources and the existing economic projection.
"""
from __future__ import annotations

from typing import Any, Mapping


COMPONENTS = ("Ц", "У", "А", "П", "КПБ", "ОК", "КЖ", "Э", "ЖЦ")
PAYMENT_TRANSFER = "entrant-coop"


class IntegratedCycleError(ValueError):
    """The supplied original trace does not support the claimed observation."""


def original_nine_component_work_view(
    output: Mapping[str, Any], *, pilot_work: str = "w1",
    next_work: str = "w2",
) -> dict[str, Any]:
    """Explain an executed Work trajectory without re-running or changing it.

    This is a source-minimizing public research projection. It deliberately
    excludes owner IDs, cash amounts, balances and original source references.
    A declared settlement remains a statement, not a verified bank event.
    """
    if not isinstance(output, Mapping):
        raise IntegratedCycleError("INTEGRATED_ORIGINAL_OUTPUT_REQUIRED")
    try:
        trace = output["trace"]
        pilot = output["works"][pilot_work]
        next_item = output["works"][next_work]
        shared = output["general_akis_model"]["system_causal_cycle_feedback"]
        partial = shared["nine_component_model_partially_observed"]
        agent = output["general_akis_model"]["agent_function_formation_model_gate"]
        context = output["context_basis"]
        economics = output["economics"]
        strict = economics["original_strict_context_source_qualification"]
        payments = economics["work_payment_causality"]
        work_costs = economics["lifecycle_resource_costs"]["original_work_event_timing"]
        profit = output["profit"]
    except (KeyError, TypeError) as exc:
        raise IntegratedCycleError("INTEGRATED_ORIGINAL_EVIDENCE_MISSING") from exc

    if (not isinstance(trace, list) or not isinstance(partial, Mapping)
            or tuple(partial) != COMPONENTS):
        raise IntegratedCycleError("INTEGRATED_NINE_AUTHOR_COMPONENTS_REQUIRED")
    if (pilot.get("result") != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            or context.get("strict") is not True
            or strict.get("status") != "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED"):
        raise IntegratedCycleError("INTEGRATED_ORIGINAL_PILOT_AND_KPB_REQUIRED")
    if (agent.get("automatic_original_business_action") is not False
            or shared.get("all_nine_component_original_causal_closure_proven") is not False
            or economics.get("economic_value_added") != "NOT_IDENTIFIABLE"
            or profit.get("system_increment") != "UNKNOWN"):
        raise IntegratedCycleError("INTEGRATED_UNSUPPORTED_AUTONOMY_OR_PROFIT_CLAIM")

    def applied(action: str, work: str | None = None) -> list[dict[str, Any]]:
        return [
            row for row in trace
            if row.get("action") == action
            and row.get("outcome") == "APPLIED"
            and (work is None or row.get("work") == work)
        ]

    def blocked(action: str, work: str) -> list[dict[str, Any]]:
        return [
            row for row in trace
            if row.get("action") == action
            and row.get("work") == work
            and row.get("outcome") == "BLOCKED"
        ]

    accepted = next_item.get("result") == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    real_accepts = applied("accept", next_work)
    if bool(real_accepts) != accepted or len(real_accepts) > 1:
        raise IntegratedCycleError("INTEGRATED_ACCEPTANCE_EVENT_NOT_APPLIED")

    registrations = applied("subject_registration_apply")
    memberships = applied("cooperation_membership_apply")
    if not registrations or not memberships:
        raise IntegratedCycleError("INTEGRATED_ORIGINAL_ENTRY_NOT_APPLIED")

    payment_rows = [
        row for row in payments.get("bindings", [])
        if row.get("transfer_id") == PAYMENT_TRANSFER
    ]
    if len(payment_rows) != 1:
        raise IntegratedCycleError("INTEGRATED_ORIGINAL_PAYMENT_BINDING_MISSING")
    bank_verified = payments["settlement_progress"]["actual_bank_payment_verified"]
    if bank_verified is not False or strict.get("payment_witnesses_are_not_bank_settlement") is not True:
        raise IntegratedCycleError("INTEGRATED_BANK_PAYMENT_NOT_AUTHENTICATED")

    commit_blocks = blocked("commit", next_work)
    if accepted:
        reason = "ACCEPTED_ORIGINAL_WORK_AND_RESULT"
    elif commit_blocks:
        blocked_reason = commit_blocks[-1].get("reason")
        reason = {
            "INDEPENDENT_ACCEPTANCE_MISSING": "INDEPENDENT_PRINCIPAL_DID_NOT_CONSENT",
            "RESOURCE_NOT_AVAILABLE": "ORIGINAL_RESOURCE_NOT_AVAILABLE",
        }.get(blocked_reason, "ORIGINAL_COMMIT_BLOCKED")
    elif next_item.get("result") == "SUBMITTED":
        reason = "RECIPIENT_ACCEPTANCE_NOT_RECORDED"
    else:
        reason = "FOLLOWUP_ORIGINAL_WORK_NOT_ACCEPTED"

    component_evidence = {
        "Ц": {
            "partially_observed": bool(partial["Ц"]),
            "new_original_customer_request_applied": bool(applied("request", next_work)),
        },
        "У": {
            "partially_observed": bool(partial["У"]),
            "new_original_subject_registered": bool(registrations),
            "new_cooperation_edition_applied": bool(memberships),
            "original_followup_consents_applied": len(applied("consent", next_work)),
        },
        "А": {
            "partially_observed": bool(partial["А"]),
            "original_agent_function_preparations": len(applied("function_prepare", next_work)),
            "independent_function_reviews": len(applied("function_review", next_work)),
            "automatic_business_action": False,
        },
        "П": {
            "partially_observed": bool(partial["П"]),
            "original_commit_applied": bool(applied("commit", next_work)),
            "original_start_applied": bool(applied("start", next_work)),
            "original_complete_applied": bool(applied("complete", next_work)),
        },
        "КПБ": {
            "partially_observed": bool(partial["КПБ"]),
            "original_strict_source_qualification": strict["status"],
            "historical_event_rights_replayed": bool(
                strict["historical_event_revision_replayed_in_original_KPB"]
            ),
            "current_source_read_checked": bool(
                strict["current_original_read_right_checked_separately"]
            ),
        },
        "ОК": {
            "partially_observed": bool(partial["ОК"]),
            "original_formation_confirmations": len(applied("formation_confirm", next_work)),
            "new_commit_uses_original_institutional_gate": bool(
                applied("commit", next_work) or commit_blocks
            ),
        },
        "КЖ": {
            "partially_observed": bool(partial["КЖ"]),
            "pilot_result_accepted": True,
            "followup_recipient_result_accepted": accepted,
            "original_event_claimed_cost_count": work_costs[
                "original_lifecycle_timed_record_count"
            ],
        },
        "Э": {
            "partially_observed": bool(partial["Э"]),
            "original_payment_source_claim_events": strict[
                "source_scoped_original_payment_event_count"
            ],
            "independent_source_witnesses": strict[
                "source_scoped_independent_payment_owner_witness_count"
            ],
            "original_transfer_payment_claim_status": payment_rows[0][
                "settlement_progress"
            ]["status"],
            "verified_bank_settlement": False,
            "causal_network_value_added": "NOT_IDENTIFIABLE",
        },
        "ЖЦ": {
            "partially_observed": bool(partial["ЖЦ"]),
            "previous_accepted_result_preserved": True,
            "prospective_cooperation_revision_applied": bool(memberships),
            "followup_accepted_result": accepted,
        },
    }
    if tuple(component_evidence) != COMPONENTS:
        raise IntegratedCycleError("INTEGRATED_COMPONENT_ORDER_CHANGED")
    return {
        "schema": "AKIS_ORIGINAL_R1_R2_NINE_COMPONENT_WORK_VIEW/1.0",
        "original_mesa_work_result": next_item["result"],
        "original_mesa_work_obligation": next_item["obligation"],
        "difference_driver": reason,
        "components": component_evidence,
        "source_claims_are_not_bank_payments": True,
        "realized_network_additionality": "NOT_IDENTIFIABLE",
        "all_nine_author_components_causally_closed": False,
        "owner_private_amounts_or_source_identifiers_exposed": False,
    }
