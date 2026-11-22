"""AKIS R1-U2: two existing coalition links compete for one original capacity."""
from copy import deepcopy

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.cooperation import _active_coalition_document
from .test_rules import fixture


def _work(name, customer, start, end):
    return {"id": name, "customer": customer, "resource": "ra",
            "source_revision": f"src-{name}", "slot_start": start,
            "slot_end": end}


def _event(at, action, actor, work=None, **kwargs):
    return {"at": at, "action": action, "actor": actor,
            **({"work": work} if work else {}), **kwargs}


def _accept(events, time, name, customer):
    rev = f"src-{name}"
    events.extend([
        _event(time, "offer", "op", name),
        _event(time + 1, "authorize", "op", name),
        _event(time + 2, "consent", "a", name, source_revision=rev,
               org_revision="oc-1"),
        _event(time + 3, "consent", customer, name, source_revision=rev,
               org_revision="oc-1"),
        _event(time + 4, "commit", "op", name),
        _event(time + 5, "start", "a", name),
        _event(time + 6, "complete", "a", name,
               result_ref=f"model://a/accepted-{name}"),
        _event(time + 7, "accept", customer, name),
    ])


def original_parallel_case(*, selected="l1", low_cash=False,
                           missing_owner=None, outside=False):
    d = fixture()
    d["subjects"].append({"id": "c", "kind": "SME"})
    d["resources"] = [{"id": "ra", "owner": "a",
                       "availability": "AVAILABLE", "capacity_units": 1,
                       "capacity_unit": "machine", "site": "plant-a"}]
    d["works"] = [
        _work("old-b", "b", 10, 20),
        _work("old-c", "c", 20, 30),
        _work("next-b", "b", 40, 50),
        _work("next-c", "c", 40, 50),
    ]
    d["cooperation_links"] = [
        {"id": "l1", "purpose": "first-customer-production",
         "coordinator": "op", "participants": ["a", "b", "op"],
         "works": ["old-b", "next-b"], "mechanisms": ["PRODUCTION"],
         "source_ref": "model://b/active-first", "source_revision": "rel-b"},
        {"id": "l2", "purpose": "second-customer-production",
         "coordinator": "op", "participants": ["a", "c", "op"],
         "works": ["old-c", "next-c"], "mechanisms": ["PRODUCTION"],
         "source_ref": "model://c/active-second", "source_revision": "rel-c"},
    ]
    events = []
    _accept(events, 1, "old-b", "b")
    _accept(events, 9, "old-c", "c")
    for i, w in enumerate(("next-b", "next-c")):
        events.extend([
            _event(17 + 2 * i, "offer", "op", w),
            _event(18 + 2 * i, "authorize", "op", w),
        ])
    state = QualitativeAKIS(deepcopy(d))
    for row in events:
        report = state.apply(row, row["at"])
        assert report["outcome"] == "APPLIED", report
    digest, conflicts, principals, shared = _active_coalition_document(
        state, ["l1", "l2"], ["next-b", "next-c"]
    )
    assert conflicts and shared == ["a"]
    assert principals == {"l1": ["a", "b"], "l2": ["a", "c"]}
    events.append(_event(
        21, "active_coalition_portfolio_propose", "a",
        org_revision="oc-1", coalition_portfolio_id="portfolio-1",
        coalition_portfolio_links=["l1", "l2"],
        coalition_portfolio_works=["next-b", "next-c"],
        coalition_portfolio_fingerprint=digest,
        coalition_portfolio_source_ref="model://a/portfolio-supply",
        coalition_portfolio_valid_until=90,
    ))
    for i, owner in enumerate(("a", "b", "c")):
        if owner == missing_owner:
            continue
        eligible = ["l1", "l2"] if owner == "a" else (
            ["l1"] if owner == "b" else ["l2"]
        )
        preferred = selected if owner == "a" else eligible[0]
        cash_needs = {key: "20.00" for key in eligible}
        cash_needs["OUTSIDE_ALL"] = "10.00"
        events.append(_event(
            22 + i, "active_coalition_portfolio_assess", owner,
            org_revision="oc-1", coalition_portfolio_id="portfolio-1",
            coalition_portfolio_fingerprint=digest,
            coalition_portfolio_preferred_link=preferred,
            coalition_portfolio_willingness="WILLING",
            coalition_portfolio_outside_position=(
                "OUTSIDE_PREFERRED" if outside and owner == "a"
                else "COOPERATION_PREFERRED"
            ),
            coalition_portfolio_owner_source_ref=f"model://{owner}/choice-1",
            coalition_portfolio_cash_available=(
                "15.00" if low_cash and owner == "a" else "100.00"
            ),
            coalition_portfolio_cash_floor="10.00",
            coalition_portfolio_peak_cash_needs=cash_needs,
        ))
    for i, (w, customer) in enumerate((("next-b", "b"), ("next-c", "c"))):
        events.extend([
            _event(26 + 2 * i, "consent", "a", w,
                   source_revision=f"src-{w}", org_revision="oc-1"),
            _event(27 + 2 * i, "consent", customer, w,
                   source_revision=f"src-{w}", org_revision="oc-1"),
        ])
    events.extend([
        _event(30, "commit", "op", "next-b"),
        _event(31, "commit", "op", "next-c"),
        _event(32, "start", "a", "next-b"),
        _event(33, "complete", "a", "next-b",
               result_ref="model://a/next-b-delivered"),
        _event(34, "accept", "b", "next-b"),
    ])
    d["events"] = sorted(events, key=lambda e: e["at"])
    d["model_horizon"] = 38
    return d


def _rows(out, action):
    return [r for r in out["trace"] if r["action"] == action]


def test_two_existing_coalitions_first_customer_wins_and_second_preserves_old_result():
    out = simulate(original_parallel_case())
    assert all(r["outcome"] == "APPLIED" for r in _rows(out, "accept"))
    assert _rows(out, "commit")[-2]["outcome"] == "APPLIED"
    assert _rows(out, "commit")[-2]["active_coalition_selected_link"] == "l1"
    assert _rows(out, "commit")[-1]["reason"] == (
        "ACTIVE_COALITION_OWNER_PREFERS_OTHER_OR_OUTSIDE"
    )
    assert out["works"]["old-b"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["old-c"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["next-b"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["next-c"]["result"] == "NOT_SUBMITTED"
    summary = out["cooperation"]["parallel_active_coalitions"]
    assert summary["accepted_competitive_work_count"] == 1
    assert summary["comparisons"][0]["original_work_accepted_results"] == ["next-b"]


def test_shared_owner_can_select_the_other_active_coalition():
    d = original_parallel_case(selected="l2")
    d["events"] = [r for r in d["events"] if r["at"] < 32]
    d["events"].extend([
        _event(32, "start", "a", "next-c"),
        _event(33, "complete", "a", "next-c",
               result_ref="model://a/next-c-delivered"),
        _event(34, "accept", "c", "next-c"),
    ])
    out = simulate(d)
    assert _rows(out, "commit")[-2]["reason"] == (
        "ACTIVE_COALITION_OWNER_PREFERS_OTHER_OR_OUTSIDE"
    )
    assert _rows(out, "commit")[-1]["outcome"] == "APPLIED"
    assert out["works"]["next-c"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["next-b"]["result"] == "NOT_SUBMITTED"


def test_missing_independent_owner_never_becomes_operator_consent():
    out = simulate(original_parallel_case(missing_owner="a"))
    assert _rows(out, "commit")[-2]["reason"] == (
        "ACTIVE_COALITION_ORIGINAL_OWNER_CHOICES_MISSING"
    )
    assert _rows(out, "commit")[-1]["reason"] == (
        "ACTIVE_COALITION_ORIGINAL_OWNER_CHOICES_MISSING"
    )
    assert out["works"]["old-b"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_low_owner_liquidity_vetoes_new_work_but_not_old_results():
    out = simulate(original_parallel_case(low_cash=True))
    assert _rows(out, "commit")[-2]["reason"] == (
        "ACTIVE_COALITION_OWNER_LIQUIDITY_SHORTFALL"
    )
    assert out["works"]["old-c"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["next-b"]["obligation"] == "NOT_ACCEPTED"


def test_outside_option_can_veto_both_prospective_obligations():
    out = simulate(original_parallel_case(outside=True))
    assert all(r["outcome"] == "BLOCKED" for r in _rows(out, "commit")[-2:])
    assert all(out["works"][w]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("old-b", "old-c"))


def test_comparison_does_not_reserve_capacity_or_produce_result():
    d = original_parallel_case()
    d["events"] = [r for r in d["events"] if r["at"] <= 24]
    out = simulate(d)
    assert out["cooperation"]["parallel_active_coalitions"][
        "accepted_competitive_work_count"
    ] == 0
    assert out["works"]["next-b"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["next-c"]["obligation"] == "NOT_ACCEPTED"
    assert out["capacity"]["reservations"] is not None


def test_original_capacity_still_rejects_second_work_even_if_owner_reassesses():
    d = original_parallel_case()
    first_choice = next(
        row for row in d["events"]
        if row["action"] == "active_coalition_portfolio_assess"
        and row["actor"] == "a"
    )
    later_choice = deepcopy(first_choice)
    later_choice["at"] = 31
    later_choice["coalition_portfolio_preferred_link"] = "l2"
    later_choice["coalition_portfolio_owner_source_ref"] = (
        "model://a/changed-selection-after-first-commit"
    )
    d["events"] = [row for row in d["events"] if row["at"] <= 30]
    d["events"].extend([
        later_choice,
        _event(32, "commit", "op", "next-c"),
    ])
    out = simulate(d)
    assert _rows(out, "commit")[-2]["outcome"] == "APPLIED"
    assert _rows(out, "active_coalition_portfolio_assess")[-1]["outcome"] == "APPLIED"
    assert _rows(out, "commit")[-1]["reason"] == "RESOURCE_CAPACITY_EXCEEDED"
    assert out["works"]["next-b"]["obligation"] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert out["works"]["next-c"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["old-b"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["old-c"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert sorted(r["work"] for r in out["capacity"]["reservations"]) == [
        "next-b", "old-b", "old-c"
    ]


def test_strict_kpb_requires_individually_qualified_source_rights():
    d = original_parallel_case()
    state = QualitativeAKIS({k: v for k, v in d.items() if k != "model_horizon"})
    from types import SimpleNamespace
    state.context_basis = SimpleNamespace(strict=True)
    row = next(e for e in d["events"]
               if e["action"] == "active_coalition_portfolio_propose")
    assert state.apply(row, row["at"])["reason"] == (
        "ACTIVE_COALITION_SOURCE_RIGHTS_NOT_QUALIFIED"
    )
