"""Display-only schedule quality scoring for admin-facing summaries."""

from __future__ import annotations

from typing import Any


def affected_session_count(violations: list[Any]) -> int:
    affected: set[int] = set()
    for violation in violations:
        raw_ids = _violation_value(violation, "affected_session_ids")
        if isinstance(raw_ids, str):
            affected.update(int(item) for item in raw_ids.split(",") if item.strip().isdigit())
        elif isinstance(raw_ids, list):
            affected.update(int(item) for item in raw_ids if str(item).isdigit())
    return len(affected)


def schedule_quality_summary(
    *,
    scheduled_count: int,
    hard_issue_count: int,
    soft_warning_count: int,
    raw_soft_score: int,
    affected_session_count: int,
) -> dict:
    scheduled = max(0, int(scheduled_count or 0))
    hard = max(0, int(hard_issue_count or 0))
    soft = max(0, int(soft_warning_count or 0))
    raw_soft = max(0, int(raw_soft_score or 0))
    affected = min(max(0, int(affected_session_count or 0)), scheduled) if scheduled else 0

    if scheduled == 0:
        return {
            "score": 0,
            "label": "No Schedule",
            "tone": "neutral",
            "summary": "No scheduled sessions to evaluate.",
            "hard_issue_count": hard,
            "soft_warning_count": soft,
            "affected_session_count": affected,
            "affected_session_percent": 0,
            "soft_pressure_per_session": 0,
            "raw_soft_score": raw_soft,
            "export_ready": False,
        }

    affected_rate = affected / scheduled
    soft_rate = soft / scheduled
    pressure_per_session = raw_soft / scheduled

    hard_penalty = min(70, hard * 18 + round(affected_rate * 25)) if hard else 0
    soft_penalty = min(35, round(soft_rate * 35))
    spread_penalty = min(20, round(affected_rate * 20))
    pressure_penalty = min(15, round(pressure_per_session / 25))
    score = max(0, min(100, 100 - hard_penalty - soft_penalty - spread_penalty - pressure_penalty))
    if hard:
        score = min(score, 49)

    if hard:
        label = "Blocked"
        tone = "bad"
        summary = f"Fix {hard} hard issue{'s' if hard != 1 else ''} before export."
    elif score >= 90:
        label = "Excellent"
        tone = "good"
        summary = "No hard conflicts and very low soft pressure."
    elif score >= 75:
        label = "Good"
        tone = "good"
        summary = "Export ready with manageable soft warnings."
    elif score >= 60:
        label = "Review"
        tone = "warn"
        summary = "Export ready, but soft warnings should be reviewed."
    else:
        label = "Weak"
        tone = "bad"
        summary = "Export ready, but many soft preferences were missed."

    if not hard and soft == 0:
        summary = "No hard conflicts or soft warnings detected."

    return {
        "score": score,
        "label": label,
        "tone": tone,
        "summary": summary,
        "hard_issue_count": hard,
        "soft_warning_count": soft,
        "affected_session_count": affected,
        "affected_session_percent": round(affected_rate * 100),
        "soft_pressure_per_session": round(pressure_per_session, 1),
        "raw_soft_score": raw_soft,
        "export_ready": hard == 0,
    }


def schedule_quality_from_violations(*, scheduled_count: int, raw_soft_score: int, violations: list[Any]) -> dict:
    hard = sum(1 for item in violations if str(_violation_value(item, "severity") or "").upper() == "HARD")
    soft = sum(1 for item in violations if str(_violation_value(item, "severity") or "").upper() == "SOFT")
    return schedule_quality_summary(
        scheduled_count=scheduled_count,
        hard_issue_count=hard,
        soft_warning_count=soft,
        raw_soft_score=raw_soft_score,
        affected_session_count=affected_session_count(violations),
    )


def _violation_value(violation: Any, key: str) -> Any:
    if isinstance(violation, dict):
        return violation.get(key)
    return getattr(violation, key, None)
