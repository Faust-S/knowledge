"""Check source attribution of a meeting-action draft; no model, task or external effect."""
from __future__ import annotations


def verify(transcript, draft):
    errors = []
    if not isinstance(transcript, str) or not transcript.strip():
        return {"passed": False, "errors": ["TRANSCRIPT_REQUIRED"], "accepted": []}
    if not isinstance(draft, dict) or not isinstance(draft.get("action_items"), list):
        return {"passed": False, "errors": ["INVALID_DRAFT"], "accepted": []}
    if not isinstance(draft.get("open_questions"), list):
        return {"passed": False, "errors": ["QUESTIONS_REQUIRED"], "accepted": []}
    accepted = []
    if not draft["action_items"] and not draft["open_questions"]:
        errors.append("NO_ACTIONS_REQUIRES_QUESTION")
    spans = set()
    for index, item in enumerate(draft["action_items"]):
        prefix = f"ITEM_{index}_"
        if not isinstance(item, dict):
            errors.append(prefix + "INVALID")
            continue
        quote, start, end = item.get("quote"), item.get("start"), item.get("end")
        quote_ok = isinstance(quote, str) and bool(quote.strip())
        claimed_span = (
            quote_ok
            and isinstance(start, int) and not isinstance(start, bool)
            and isinstance(end, int) and not isinstance(end, bool)
            and 0 <= start < end <= len(transcript)
            and transcript[start:end] == quote
        )
        if not claimed_span and quote_ok:
            first = transcript.find(quote)
            if first >= 0 and transcript.find(quote, first + 1) < 0:
                start, end = first, first + len(quote)
                claimed_span = True
        if not claimed_span:
            errors.append(prefix + "SOURCE_SPAN_MISMATCH")
            continue
        action = item.get("action")
        if not isinstance(action, str) or not action.strip():
            errors.append(prefix + "ACTION_REQUIRED")
            continue
        if not all(isinstance(item.get(key), str) and item[key].strip()
                   for key in ("assignee", "due_date")):
            errors.append(prefix + "OWNER_OR_DEADLINE_UNKNOWN_MUST_BE_EXPLICIT")
            continue
        if item["assignee"] != "UNKNOWN" and item["assignee"] not in quote:
            errors.append(prefix + "OWNER_UNSUPPORTED")
            continue
        if item["due_date"] != "UNKNOWN" and item["due_date"] not in quote:
            errors.append(prefix + "DEADLINE_UNSUPPORTED")
            continue
        # One sentence may assign two distinct tasks; reject only identical duplicates.
        assignment = (start, end, item.get("action"), item.get("assignee"), item.get("due_date"))
        if assignment in spans:
            errors.append(prefix + "DUPLICATE_ASSIGNMENT")
            continue
        spans.add(assignment)
        accepted.append({**item, "start": start, "end": end})
    if any(not isinstance(q, str) for q in draft["open_questions"]):
        errors.append("INVALID_QUESTIONS")
    return {"passed": not errors, "errors": errors, "accepted": accepted}
