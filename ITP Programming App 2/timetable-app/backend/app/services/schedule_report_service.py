"""Administrative schedule-run reporting and PDF rendering."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from app.models.constraint_violation import ConstraintViolation
from app.models.schedule_change_log import ScheduleChangeLog
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session as RequirementSession
from app.services.compatibility import time_to_minutes
from app.services.lab_overlap_service import LabOverlapService
from app.services.schedule_change_service import changed_placement_fields, placement_snapshot
from app.services.schedule_quality_service import schedule_quality_from_violations
from app.services.scheduling_rules import effective_scheduling_type
from app.services.serializers import (
    schedule_run_to_dict,
    session_staff_items,
    violation_to_dict,
)
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session as DbSession

DAY_ORDER = {
    "Monday": 0,
    "Tuesday": 1,
    "Wednesday": 2,
    "Thursday": 3,
    "Friday": 4,
    "Saturday": 5,
    "Sunday": 6,
}

INK = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#64748b")
BORDER = colors.HexColor("#cbd5e1")
PANEL = colors.HexColor("#f8fafc")
TEAL = colors.HexColor("#0f766e")
TEAL_SOFT = colors.HexColor("#ccfbf1")
BLUE_SOFT = colors.HexColor("#dbeafe")
ORANGE_SOFT = colors.HexColor("#ffedd5")
RED_SOFT = colors.HexColor("#fee2e2")


class ScheduleReportService:
    def build(self, db: DbSession, schedule_run_id: int) -> dict:
        run = db.query(ScheduleRun).filter_by(id=schedule_run_id).first()
        if not run:
            raise ValueError("Schedule run not found")

        all_scheduled = (
            db.query(ScheduledSession)
            .filter_by(schedule_run_id=schedule_run_id)
            .order_by(ScheduledSession.day, ScheduledSession.start_time)
            .all()
        )
        scheduled = [item for item in all_scheduled if item.included_in_final]
        lab_overlap_resolution = LabOverlapService().report_run(db, schedule_run_id)
        violations = db.query(ConstraintViolation).filter_by(schedule_run_id=schedule_run_id).all()
        quality = schedule_quality_from_violations(
            scheduled_count=len(scheduled),
            raw_soft_score=run.soft_score or 0,
            violations=violations,
        )

        issue_by_session: dict[int, list[dict]] = defaultdict(list)
        serialized_violations = [violation_to_dict(item) for item in violations]
        for violation in serialized_violations:
            for session_id in violation["affected_session_ids"]:
                issue_by_session[session_id].append(violation)

        session_rows = [self._session_row(item, issue_by_session.get(item.session_id, [])) for item in scheduled]
        session_rows.sort(key=self._session_sort_key)
        session_by_id = {item["session_id"]: item for item in session_rows}
        changes = self._report_changes(db, run, session_by_id)

        conflicts = []
        conflict_groups: dict[tuple[str, str], int] = defaultdict(int)
        for violation in sorted(
            serialized_violations,
            key=lambda item: (0 if item["severity"] == "HARD" else 1, item["constraint_code"], item["id"]),
        ):
            conflict_groups[(violation["severity"], violation["constraint_code"])] += 1
            conflicts.append(
                {
                    **violation,
                    "affected_sessions": [
                        self._affected_session_summary(session_by_id[session_id])
                        for session_id in violation["affected_session_ids"]
                        if session_id in session_by_id
                    ],
                }
            )

        total_minutes = sum(item["duration_minutes"] for item in session_rows)
        lab_count = sum(1 for item in session_rows if item["is_lab_requirement"])
        staff_labels = {staff for item in session_rows for staff in item["staff_names"] if staff}
        summary = {
            "scheduled_count": len(session_rows),
            "uploaded_session_count": len(session_rows) - lab_count,
            "lab_session_count": lab_count,
            "original_lab_session_count": sum(1 for item in all_scheduled if item.session.is_lab_requirement),
            "excluded_lab_session_count": lab_overlap_resolution["excluded_session_count"],
            "lab_overlap_pair_count": lab_overlap_resolution["detected_pair_count"],
            "programme_count": self._unique_count(session_rows, "programme"),
            "module_count": self._unique_count(session_rows, "module_code"),
            "student_group_count": self._unique_count(session_rows, "student_group_code"),
            "staff_count": len(staff_labels),
            "room_count": self._unique_count(session_rows, "room"),
            "total_scheduled_hours": round(total_minutes / 60, 1),
            "hard_conflict_count": quality["hard_issue_count"],
            "soft_warning_count": quality["soft_warning_count"],
            "affected_session_count": quality["affected_session_count"],
        }

        return {
            "report_generated_at": datetime.now(UTC).isoformat(),
            "run": schedule_run_to_dict(run),
            "quality": quality,
            "quality_breakdown": self._quality_breakdown(quality, len(session_rows)),
            "summary": summary,
            "changes": changes,
            "breakdowns": {
                "by_source": self._breakdown(
                    "Lab requirements" if item["is_lab_requirement"] else "Uploaded requirements" for item in session_rows
                ),
                "by_programme": self._breakdown(item["programme"] or "Not specified" for item in session_rows),
                "by_class_type": self._breakdown(item["class_type"] or "Not specified" for item in session_rows),
                "by_day": self._breakdown(
                    (item["day"] or "Not specified" for item in session_rows),
                    order=DAY_ORDER,
                ),
                "by_delivery_mode": self._breakdown(item["delivery_mode"] or "Not specified" for item in session_rows),
                "room_workload": self._workload(session_rows, "room"),
                "staff_workload": self._staff_workload(session_rows),
            },
            "conflicts": {
                "hard_count": quality["hard_issue_count"],
                "soft_count": quality["soft_warning_count"],
                "affected_session_count": quality["affected_session_count"],
                "by_constraint": [
                    {"severity": severity, "constraint_code": code, "count": count}
                    for (severity, code), count in sorted(
                        conflict_groups.items(),
                        key=lambda item: (0 if item[0][0] == "HARD" else 1, -item[1], item[0][1]),
                    )
                ],
                "items": conflicts,
            },
            "lab_overlap_resolution": lab_overlap_resolution,
            "sessions": session_rows,
        }

    def pdf_buffer(self, report: dict) -> BytesIO:
        self._register_fonts()
        buffer = BytesIO()
        document = SimpleDocTemplate(
            buffer,
            pagesize=landscape(A4),
            leftMargin=12 * mm,
            rightMargin=12 * mm,
            topMargin=15 * mm,
            bottomMargin=14 * mm,
            title=f"Timetable Run {report['run']['id']} Administration Report",
            author="Timetable Scheduler",
        )
        styles = self._pdf_styles()
        story = []

        story.append(Paragraph("TIMETABLE SCHEDULER", styles["eyebrow"]))
        story.append(Paragraph(f"Administration Report - Run {report['run']['id']}", styles["title"]))
        created = self._format_datetime(report["run"].get("created_at"))
        generated = self._format_datetime(report["report_generated_at"])
        story.append(Paragraph(f"Run created {escape(created)} | Report generated {escape(generated)}", styles["muted"]))
        story.append(Spacer(1, 5 * mm))

        metrics = [
            (report["summary"]["scheduled_count"], "Scheduled sessions"),
            (f"{report['quality']['score']}/100", "Optimised score"),
            (report["summary"]["hard_conflict_count"], "Hard conflicts"),
            (report["summary"]["soft_warning_count"], "Soft warnings"),
            (report["summary"]["lab_session_count"], "Lab requirements"),
            (report["summary"]["total_scheduled_hours"], "Scheduled hours"),
        ]
        metric_cells = [self._metric_cell(value, label, styles) for value, label in metrics]
        metric_table = Table([metric_cells], colWidths=[43 * mm] * 6)
        metric_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), PANEL),
                    ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                    ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 9),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ]
            )
        )
        story.append(metric_table)
        story.append(Spacer(1, 6 * mm))

        story.extend(self._run_overview(report, styles))
        story.extend(self._changes_applied(report, styles))
        story.extend(self._scheduling_breakdown(report, styles))
        story.append(PageBreak())
        story.extend(self._conflict_report(report, styles))
        story.append(PageBreak())
        story.extend(self._lab_overlap_report(report, styles))
        story.append(PageBreak())
        story.extend(self._detailed_schedule(report, styles))

        def page_footer(canvas, doc):
            canvas.saveState()
            canvas.setFont("Vera", 7)
            canvas.setFillColor(MUTED)
            canvas.drawString(doc.leftMargin, 7 * mm, f"Timetable Run {report['run']['id']} - Administration Report")
            canvas.drawRightString(landscape(A4)[0] - doc.rightMargin, 7 * mm, f"Page {doc.page}")
            canvas.restoreState()

        document.build(story, onFirstPage=page_footer, onLaterPages=page_footer)
        buffer.seek(0)
        return buffer

    def _session_row(self, item: ScheduledSession, issues: list[dict]) -> dict:
        session = item.session
        staff = [
            staff_item["staff_name"] or staff_item["staff_id"]
            for staff_item in session_staff_items(session)
            if staff_item["staff_name"] or staff_item["staff_id"]
        ]
        duration = session.duration_minutes or max(
            0,
            (time_to_minutes(item.end_time) or 0) - (time_to_minutes(item.start_time) or 0),
        )
        hard_count = sum(1 for issue in issues if issue["severity"] == "HARD")
        soft_count = sum(1 for issue in issues if issue["severity"] == "SOFT")
        return {
            "scheduled_session_id": item.id,
            "session_id": session.id,
            "requirement_id": session.requirement_id,
            "programme": session.programme.code if session.programme else None,
            "module_code": session.module.module_code if session.module else None,
            "class_type": session.class_type,
            "student_group_code": session.student_group.group_code if session.student_group else None,
            "staff_names": staff,
            "room": item.room.room_code if item.room else None,
            "day": item.day,
            "start_time": item.start_time,
            "end_time": item.end_time,
            "duration_minutes": int(duration or 0),
            "week_pattern": item.week_pattern,
            "custom_weeks": session.custom_weeks,
            "start_week": session.start_week,
            "end_week": session.end_week,
            "delivery_mode": session.delivery_mode,
            "campus_mode": session.campus_mode,
            "scheduling_type": effective_scheduling_type(session),
            "exact_class_size": session.exact_class_size,
            "source_file": session.source_file,
            "is_lab_requirement": bool(session.is_lab_requirement),
            "lab_requirement_id": session.lab_requirement_id,
            "hard_issue_count": hard_count,
            "soft_issue_count": soft_count,
            "issue_count": hard_count + soft_count,
            "issue_codes": sorted({issue["constraint_code"] for issue in issues}),
        }

    def _quality_breakdown(self, quality: dict, scheduled_count: int) -> dict:
        scheduled = max(0, int(scheduled_count or 0))
        hard = quality["hard_issue_count"]
        soft = quality["soft_warning_count"]
        affected = quality["affected_session_count"]
        raw_soft_score = quality["raw_soft_score"]
        affected_rate = affected / scheduled if scheduled else 0
        pressure_per_session = raw_soft_score / scheduled if scheduled else 0
        hard_deduction = min(70, hard * 18 + round(affected_rate * 25)) if scheduled and hard else 0
        soft_deduction = min(35, round((soft / scheduled) * 35)) if scheduled else 0
        affected_deduction = min(20, round(affected_rate * 20)) if scheduled else 0
        pressure_deduction = min(15, round(pressure_per_session / 25)) if scheduled else 0
        factor_deduction_total = hard_deduction + soft_deduction + affected_deduction + pressure_deduction
        score_before_cap = max(0, min(100, 100 - factor_deduction_total))
        hard_cap_applied = scheduled > 0 and hard > 0
        hard_cap_deduction = max(0, score_before_cap - quality["score"]) if hard_cap_applied else 0

        if scheduled:
            hard_observed = (
                f"{hard} hard conflict{'s' if hard != 1 else ''}; "
                f"{affected} of {scheduled} sessions affected ({round(affected_rate * 100, 1)}%)"
            )
            hard_calculation = (
                f"{hard} x 18 + round(({affected} / {scheduled}) x 25), capped at 70" if hard else "No hard conflicts, so no deduction"
            )
            soft_observed = (
                f"{soft} soft warning{'s' if soft != 1 else ''} across {scheduled} scheduled sessions "
                f"({round((soft / scheduled) * 100, 1)} per 100 sessions)"
            )
            soft_calculation = f"round(({soft} / {scheduled}) x 35), capped at 35"
            affected_observed = f"{affected} of {scheduled} sessions carry at least one issue ({round(affected_rate * 100, 1)}%)"
            affected_calculation = f"round(({affected} / {scheduled}) x 20), capped at 20"
            pressure_observed = f"Raw preference pressure {raw_soft_score}; {round(pressure_per_session, 1)} per scheduled session"
            pressure_calculation = f"round(({round(pressure_per_session, 1)} / 25)), capped at 15"
        else:
            hard_observed = f"{hard} hard conflict{'s' if hard != 1 else ''}; no scheduled sessions"
            soft_observed = f"{soft} soft warning{'s' if soft != 1 else ''}; no scheduled sessions"
            affected_observed = "No scheduled sessions to assess"
            pressure_observed = f"Raw preference pressure {raw_soft_score}; no scheduled sessions"
            hard_calculation = soft_calculation = affected_calculation = pressure_calculation = (
                "No deduction is calculated without scheduled sessions"
            )

        return {
            "starting_score": 100,
            "hard_conflict_deduction": hard_deduction,
            "soft_warning_deduction": soft_deduction,
            "affected_session_deduction": affected_deduction,
            "preference_pressure_deduction": pressure_deduction,
            "factor_deduction_total": factor_deduction_total,
            "score_before_cap": score_before_cap,
            "hard_conflict_cap_applied": hard_cap_applied,
            "hard_conflict_cap_deduction": hard_cap_deduction,
            "factors": [
                {
                    "key": "hard_conflicts",
                    "label": "Hard conflicts",
                    "observed": hard_observed,
                    "calculation": hard_calculation,
                    "deduction": hard_deduction,
                    "maximum_deduction": 70,
                },
                {
                    "key": "soft_warnings",
                    "label": "Soft warnings",
                    "observed": soft_observed,
                    "calculation": soft_calculation,
                    "deduction": soft_deduction,
                    "maximum_deduction": 35,
                },
                {
                    "key": "affected_sessions",
                    "label": "Affected sessions",
                    "observed": affected_observed,
                    "calculation": affected_calculation,
                    "deduction": affected_deduction,
                    "maximum_deduction": 20,
                },
                {
                    "key": "preference_pressure",
                    "label": "Preference pressure",
                    "observed": pressure_observed,
                    "calculation": pressure_calculation,
                    "deduction": pressure_deduction,
                    "maximum_deduction": 15,
                },
            ],
        }

    def _breakdown(self, labels, order: dict[str, int] | None = None) -> list[dict]:
        counts: dict[str, int] = defaultdict(int)
        for label in labels:
            counts[str(label)] += 1
        total = sum(counts.values())
        if order:
            sorted_items = sorted(counts.items(), key=lambda item: (order.get(item[0], len(order)), item[0]))
        else:
            sorted_items = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        return [
            {"label": label, "count": count, "percent": round((count / total) * 100, 1) if total else 0} for label, count in sorted_items
        ]

    def _workload(self, sessions: list[dict], key: str) -> list[dict]:
        buckets: dict[str, dict] = {}
        for item in sessions:
            label = item.get(key) or "Not specified"
            bucket = buckets.setdefault(label, {"label": label, "session_count": 0, "minutes": 0})
            bucket["session_count"] += 1
            bucket["minutes"] += item["duration_minutes"]
        return [
            {"label": item["label"], "session_count": item["session_count"], "hours": round(item["minutes"] / 60, 1)}
            for item in sorted(buckets.values(), key=lambda value: (-value["session_count"], value["label"]))
        ]

    def _staff_workload(self, sessions: list[dict]) -> list[dict]:
        buckets: dict[str, dict] = {}
        for item in sessions:
            for label in item["staff_names"] or ["Unassigned"]:
                bucket = buckets.setdefault(label, {"label": label, "session_count": 0, "minutes": 0})
                bucket["session_count"] += 1
                bucket["minutes"] += item["duration_minutes"]
        return [
            {"label": item["label"], "session_count": item["session_count"], "hours": round(item["minutes"] / 60, 1)}
            for item in sorted(buckets.values(), key=lambda value: (-value["session_count"], value["label"]))
        ]

    def _report_changes(self, db: DbSession, run: ScheduleRun, session_by_id: dict[int, dict]) -> dict:
        logs = (
            db.query(ScheduleChangeLog)
            .filter_by(schedule_run_id=run.id)
            .order_by(ScheduleChangeLog.created_at, ScheduleChangeLog.id)
            .all()
        )
        session_ids = {log.session_id for log in logs}
        requirements = (
            {
                item.id: item
                for item in db.query(RequirementSession)
                .filter(RequirementSession.id.in_(session_ids))
                .all()
            }
            if session_ids
            else {}
        )
        items = [
            self._change_item(
                log=log,
                session_row=session_by_id.get(log.session_id),
                requirement=requirements.get(log.session_id),
            )
            for log in logs
        ]

        # Runs created before the audit table existed can still be compared with
        # their source run. Mark these rows clearly because no event timestamp
        # or intermediate moves were historically retained.
        if not items:
            items = self._inferred_auto_deconflict_changes(db, run, session_by_id)

        return {
            "count": len(items),
            "auto_deconflict_count": sum(1 for item in items if item["change_source"] == "AUTO_DECONFLICT"),
            "quick_fix_count": sum(1 for item in items if item["change_source"] == "QUICK_FIX"),
            "manual_change_count": sum(1 for item in items if item["change_source"] == "MANUAL_CHANGE"),
            "items": items,
        }

    def _change_item(
        self,
        *,
        log: ScheduleChangeLog,
        session_row: dict | None,
        requirement: RequirementSession | None,
    ) -> dict:
        before = {
            "day": log.before_day,
            "start_time": log.before_start_time,
            "end_time": log.before_end_time,
            "room_code": log.before_room_code,
            "week_pattern": log.before_week_pattern,
        }
        after = {
            "day": log.after_day,
            "start_time": log.after_start_time,
            "end_time": log.after_end_time,
            "room_code": log.after_room_code,
            "week_pattern": log.after_week_pattern,
        }
        module_code, requirement_id = self._change_session_identity(session_row, requirement)
        return {
            "id": log.id,
            "change_source": log.change_source,
            "source_label": self._change_source_label(log.change_source),
            "source_schedule_run_id": log.source_schedule_run_id,
            "created_at": log.created_at.isoformat() if log.created_at else None,
            "session_id": log.session_id,
            "module_code": module_code,
            "requirement_id": requirement_id,
            "before": before,
            "after": after,
            "changed_fields": changed_placement_fields(before, after),
            "is_inferred": False,
        }

    def _inferred_auto_deconflict_changes(
        self,
        db: DbSession,
        run: ScheduleRun,
        session_by_id: dict[int, dict],
    ) -> list[dict]:
        match = re.search(r"Auto-deconflict (?:started )?from run #(\d+)", run.message or "")
        if not match:
            return []
        source_run_id = int(match.group(1))
        source_items = {
            item.session_id: item
            for item in db.query(ScheduledSession)
            .filter_by(schedule_run_id=source_run_id)
            .order_by(ScheduledSession.session_id, ScheduledSession.id)
            .all()
        }
        current_items = (
            db.query(ScheduledSession)
            .filter_by(schedule_run_id=run.id)
            .order_by(ScheduledSession.session_id, ScheduledSession.id)
            .all()
        )
        moved = []
        for current in current_items:
            source = source_items.get(current.session_id)
            if source is None:
                continue
            before = placement_snapshot(source)
            after = placement_snapshot(current)
            fields = changed_placement_fields(before, after)
            if not fields:
                continue
            session_row = session_by_id.get(current.session_id)
            requirement = current.session
            module_code, requirement_id = self._change_session_identity(session_row, requirement)
            moved.append(
                {
                    "id": None,
                    "change_source": "AUTO_DECONFLICT",
                    "source_label": "Auto-deconflict",
                    "source_schedule_run_id": source_run_id,
                    "created_at": run.created_at.isoformat() if run.created_at else None,
                    "session_id": current.session_id,
                    "module_code": module_code,
                    "requirement_id": requirement_id,
                    "before": before,
                    "after": after,
                    "changed_fields": fields,
                    "is_inferred": True,
                }
            )
        return moved

    @staticmethod
    def _change_session_identity(
        session_row: dict | None,
        requirement: RequirementSession | None,
    ) -> tuple[str | None, str | None]:
        if session_row:
            return session_row.get("module_code"), session_row.get("requirement_id")
        return (
            requirement.module.module_code if requirement and requirement.module else None,
            requirement.requirement_id if requirement else None,
        )

    @staticmethod
    def _change_source_label(change_source: str) -> str:
        return {
            "AUTO_DECONFLICT": "Auto-deconflict",
            "QUICK_FIX": "Quick Fix",
            "MANUAL_CHANGE": "Manual change",
        }.get(change_source, change_source.replace("_", " ").title())

    def _run_overview(self, report: dict, styles: dict) -> list:
        run = report["run"]
        quality = report["quality"]
        deductions = report["quality_breakdown"]
        elements = [Paragraph("Run overview", styles["heading"])]
        details = [
            [
                "Solver status",
                run.get("solver_status") or run.get("status") or "Not available",
                "Run status",
                run.get("status") or "Not available",
            ],
            ["Created", self._format_datetime(run.get("created_at")), "Export ready", "Yes" if quality["export_ready"] else "No"],
            ["Programmes", report["summary"]["programme_count"], "Modules", report["summary"]["module_count"]],
            ["Rooms used", report["summary"]["room_count"], "Staff assigned", report["summary"]["staff_count"]],
            [
                "Original lab bookings",
                report["summary"]["original_lab_session_count"],
                "Excluded from final timetable",
                report["summary"]["excluded_lab_session_count"],
            ],
        ]
        elements.append(self._key_value_table(details, styles))
        elements.append(Spacer(1, 4 * mm))
        elements.append(Paragraph("Optimised score calculation", styles["subheading"]))
        score_rows = [
            ["Starting score", "Hard conflicts", "Soft warnings", "Affected sessions", "Preference pressure", "Final score"],
            [
                deductions["starting_score"],
                f"-{deductions['hard_conflict_deduction']}",
                f"-{deductions['soft_warning_deduction']}",
                f"-{deductions['affected_session_deduction']}",
                f"-{deductions['preference_pressure_deduction']}",
                f"{quality['score']}/100 {quality['label']}",
            ],
        ]
        score_table = Table(score_rows, colWidths=[43 * mm] * 6)
        score_table.setStyle(self._table_style(header=True, center=True))
        elements.append(score_table)
        elements.append(Spacer(1, 3 * mm))
        elements.append(Paragraph("Score factor detail", styles["subheading"]))
        factor_rows = [["Factor", "Observed input", "Calculation rule", "Deduction", "Maximum"]]
        factor_rows.extend(
            [
                self._cell(factor["label"], styles),
                self._cell(factor["observed"], styles),
                self._cell(factor["calculation"], styles),
                f"-{factor['deduction']}",
                factor["maximum_deduction"],
            ]
            for factor in deductions["factors"]
        )
        factor_table = LongTable(factor_rows, colWidths=[38 * mm, 63 * mm, 91 * mm, 30 * mm, 30 * mm], repeatRows=1)
        factor_table.setStyle(self._table_style(header=True, alternating=True))
        elements.append(factor_table)

        if report["summary"]["scheduled_count"] <= 0:
            equation = "No scheduled sessions were available to score, so the final result is 0/100."
        else:
            cap_part = (
                f" - {deductions['hard_conflict_cap_deduction']} hard-conflict cap adjustment"
                if deductions["hard_conflict_cap_deduction"]
                else ""
            )
            equation = (
                f"{deductions['starting_score']} starting points - {deductions['factor_deduction_total']} "
                f"factor deductions{cap_part} = {quality['score']}/100."
            )
        cap_note = " Hard conflicts limit the final result to at most 49." if deductions["hard_conflict_cap_applied"] else ""
        elements.append(Paragraph(escape(f"{equation} {quality['summary']}{cap_note}"), styles["muted"]))
        elements.append(Spacer(1, 5 * mm))
        return elements

    def _changes_applied(self, report: dict, styles: dict) -> list:
        changes = report["changes"]
        elements = [Paragraph("Changes applied", styles["heading"])]
        if not changes["items"]:
            elements.append(Paragraph("N.A.", styles["body"]))
            elements.append(Spacer(1, 5 * mm))
            return elements

        elements.append(
            Paragraph(
                f"{changes['count']} placement change(s): "
                f"{changes['auto_deconflict_count']} auto-deconflict, "
                f"{changes['quick_fix_count']} Quick Fix, and "
                f"{changes['manual_change_count']} manual.",
                styles["body"],
            )
        )
        elements.append(Spacer(1, 3 * mm))
        rows = [["Source", "Session", "Before", "After", "Changed"]]
        for item in changes["items"]:
            source = item["source_label"]
            if item["is_inferred"]:
                source += "\nReconstructed from source run"
            session = item["module_code"] or item["requirement_id"] or f"Session {item['session_id']}"
            if item["module_code"] and item["requirement_id"]:
                session = f"{item['module_code']}\n{item['requirement_id']}"
            rows.append(
                [
                    self._cell(source, styles),
                    self._cell(session, styles),
                    self._cell(self._change_placement_label(item["before"]), styles),
                    self._cell(self._change_placement_label(item["after"]), styles),
                    self._cell(", ".join(item["changed_fields"]), styles),
                ]
            )
        table = LongTable(rows, colWidths=[44 * mm, 43 * mm, 59 * mm, 59 * mm, 53 * mm], repeatRows=1)
        table.setStyle(self._table_style(header=True, alternating=True))
        elements.extend([table, Spacer(1, 5 * mm)])
        return elements

    @staticmethod
    def _change_placement_label(placement: dict) -> str:
        return (
            f"{placement['day']}\n"
            f"{placement['start_time']}-{placement['end_time']}\n"
            f"{placement['room_code']} | {placement['week_pattern']}"
        )

    def _scheduling_breakdown(self, report: dict, styles: dict) -> list:
        elements = [Paragraph("Scheduling breakdown", styles["heading"])]
        groups = [
            ("Sessions by source", report["breakdowns"]["by_source"]),
            ("Sessions by day", report["breakdowns"]["by_day"]),
            ("Sessions by class type", report["breakdowns"]["by_class_type"]),
            ("Sessions by delivery mode", report["breakdowns"]["by_delivery_mode"]),
            ("Sessions by programme", report["breakdowns"]["by_programme"]),
            ("Busiest rooms", report["breakdowns"]["room_workload"][:15]),
            ("Highest staff workloads", report["breakdowns"]["staff_workload"][:15]),
        ]
        for title, items in groups:
            elements.extend([self._breakdown_table(title, items, styles), Spacer(1, 4 * mm)])
        return elements

    def _conflict_report(self, report: dict, styles: dict) -> list:
        conflicts = report["conflicts"]
        elements = [Paragraph("Conflict report", styles["heading"])]
        elements.append(
            Paragraph(
                f"{conflicts['hard_count']} hard conflicts, {conflicts['soft_count']} soft warnings, and "
                f"{conflicts['affected_session_count']} affected sessions.",
                styles["body"],
            )
        )
        elements.append(Spacer(1, 3 * mm))
        if conflicts["by_constraint"]:
            summary_rows = [["Severity", "Constraint", "Count"]]
            summary_rows.extend(
                [[item["severity"], self._label(item["constraint_code"]), item["count"]] for item in conflicts["by_constraint"]]
            )
            summary_table = LongTable(summary_rows, colWidths=[35 * mm, 110 * mm, 25 * mm], repeatRows=1)
            summary_table.setStyle(self._table_style(header=True))
            elements.extend([summary_table, Spacer(1, 5 * mm)])

            detail_rows = [["Severity", "Constraint", "Message", "Affected sessions"]]
            for item in conflicts["items"]:
                affected = (
                    ", ".join(
                        session["module_code"] or session["requirement_id"] or f"Session {session['session_id']}"
                        for session in item["affected_sessions"]
                    )
                    or "None recorded"
                )
                detail_rows.append(
                    [
                        self._cell(item["severity"], styles),
                        self._cell(self._label(item["constraint_code"]), styles),
                        self._cell(item["message"], styles),
                        self._cell(affected, styles),
                    ]
                )
            detail_table = LongTable(detail_rows, colWidths=[27 * mm, 56 * mm, 119 * mm, 56 * mm], repeatRows=1)
            detail_table.setStyle(self._table_style(header=True, alternating=True))
            elements.append(detail_table)
        else:
            elements.append(Paragraph("No hard conflicts or soft warnings were recorded for this run.", styles["body"]))
        return elements

    def _lab_overlap_report(self, report: dict, styles: dict) -> list:
        resolution = report["lab_overlap_resolution"]
        elements = [Paragraph("Fixed lab overlap resolution", styles["heading"])]
        elements.append(
            Paragraph(
                f"Detected {resolution['detected_pair_count']} fixed lab overlap pair(s). "
                f"The minimum exclusion plan removes {resolution['excluded_session_count']} lab session(s) "
                "from the final timetable and exports while retaining their source requirements and run assignments.",
                styles["body"],
            )
        )
        elements.append(Spacer(1, 3 * mm))

        if not resolution["overlaps"]:
            elements.append(Paragraph("No fixed lab-to-lab resource overlaps were detected for this run.", styles["body"]))
            return elements

        rows = [["Placement", "Shared resources", "First lab", "Second lab", "Excluded from final"]]
        for overlap in resolution["overlaps"]:
            left = overlap["left"]
            right = overlap["right"]
            resources = overlap["resources"]
            resource_parts = []
            for label, values in (
                ("Room", resources["rooms"]),
                ("Staff", resources["staff"]),
                ("Student group", resources["student_groups"]),
            ):
                if values:
                    resource_parts.append(f"{label}: {', '.join(values)}")
            excluded_labels = []
            for side in (left, right):
                if side["session_id"] in overlap["excluded_session_ids"]:
                    excluded_labels.append(side["requirement_id"] or side["module_code"] or f"Session {side['session_id']}")
            rows.append(
                [
                    self._cell(f"{left['day']}\n{left['start_time']}-{left['end_time']}\n{left['week_pattern']}", styles),
                    self._cell("\n".join(resource_parts), styles),
                    self._cell(self._lab_overlap_session_label(left), styles),
                    self._cell(self._lab_overlap_session_label(right), styles),
                    self._cell(", ".join(excluded_labels) or "Not resolved in final", styles),
                ]
            )
        table = LongTable(rows, colWidths=[42 * mm, 64 * mm, 54 * mm, 54 * mm, 44 * mm], repeatRows=1)
        table.setStyle(self._table_style(header=True, alternating=True))
        elements.append(table)
        return elements

    @staticmethod
    def _lab_overlap_session_label(item: dict) -> str:
        identity = item["requirement_id"] or item["module_code"] or f"Session {item['session_id']}"
        context = " / ".join(value for value in (item["programme"], item["student_group_code"], item["room"]) if value)
        return f"{identity}\n{context}" if context else identity

    def _detailed_schedule(self, report: dict, styles: dict) -> list:
        elements = [Paragraph("Detailed schedule", styles["heading"])]
        elements.append(Paragraph(f"All {len(report['sessions'])} scheduled sessions are included below.", styles["body"]))
        elements.append(Spacer(1, 3 * mm))
        rows = [["Day / time", "Module / requirement", "Type / source", "Programme / group", "Staff", "Room", "Teaching weeks", "Issues"]]
        for item in report["sessions"]:
            weeks = item["custom_weeks"] or (
                f"{item['start_week'] or 1}-{item['end_week'] or item['start_week'] or 1} {item['week_pattern'] or ''}".strip()
            )
            issue_text = "Clean" if item["issue_count"] == 0 else f"{item['hard_issue_count']}H / {item['soft_issue_count']}S"
            rows.append(
                [
                    self._cell(f"{item['day']}\n{item['start_time']}-{item['end_time']}", styles),
                    self._cell(f"{item['module_code'] or '-'}\n{item['requirement_id'] or '-'}", styles),
                    self._cell(f"{item['class_type'] or '-'}\n{'Lab requirement' if item['is_lab_requirement'] else 'Uploaded'}", styles),
                    self._cell(f"{item['programme'] or '-'}\n{item['student_group_code'] or '-'}", styles),
                    self._cell(", ".join(item["staff_names"]) or "Unassigned", styles),
                    self._cell(item["room"] or "-", styles),
                    self._cell(weeks, styles),
                    self._cell(issue_text, styles),
                ]
            )
        schedule_table = LongTable(
            rows,
            colWidths=[28 * mm, 39 * mm, 35 * mm, 39 * mm, 57 * mm, 25 * mm, 35 * mm, 20 * mm],
            repeatRows=1,
        )
        schedule_table.setStyle(self._table_style(header=True, alternating=True))
        elements.append(schedule_table)
        return elements

    def _breakdown_table(self, title: str, items: list[dict], styles: dict) -> LongTable:
        rows = [[Paragraph(escape(title), styles["subheading"]), "", ""]]
        rows.append(["Category", "Sessions", "Share / hours"])
        for item in items:
            value = item.get("count", item.get("session_count", 0))
            detail = f"{item['percent']}%" if "percent" in item else f"{item.get('hours', 0)} hrs"
            rows.append([self._cell(item["label"], styles), value, detail])
        table = LongTable(rows, colWidths=[196 * mm, 29 * mm, 33 * mm], repeatRows=2)
        table.setStyle(
            TableStyle(
                [
                    ("SPAN", (0, 0), (-1, 0)),
                    ("BACKGROUND", (0, 0), (-1, 0), TEAL_SOFT),
                    ("BACKGROUND", (0, 1), (-1, 1), PANEL),
                    ("TEXTCOLOR", (0, 1), (-1, 1), INK),
                    ("FONTNAME", (0, 1), (-1, 1), "VeraBd"),
                    ("FONTNAME", (0, 2), (-1, -1), "Vera"),
                    ("FONTSIZE", (0, 1), (-1, -1), 7.2),
                    ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
                    ("INNERGRID", (0, 1), (-1, -1), 0.35, BORDER),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        return table

    def _key_value_table(self, rows: list[list], styles: dict) -> Table:
        content = []
        for row in rows:
            content.append(
                [
                    Paragraph(f"<b>{escape(str(row[0]))}</b>", styles["body"]),
                    self._cell(row[1], styles),
                    Paragraph(f"<b>{escape(str(row[2]))}</b>", styles["body"]),
                    self._cell(row[3], styles),
                ]
            )
        table = Table(content, colWidths=[35 * mm, 94 * mm, 35 * mm, 94 * mm])
        table.setStyle(self._table_style(alternating=True))
        return table

    def _table_style(self, header: bool = False, alternating: bool = False, center: bool = False) -> TableStyle:
        commands = [
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
            ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER),
            ("FONTNAME", (0, 0), (-1, -1), "Vera"),
            ("FONTSIZE", (0, 0), (-1, -1), 7.2),
            ("TEXTCOLOR", (0, 0), (-1, -1), INK),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
        if header:
            commands.extend(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), INK),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "VeraBd"),
                    ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
                ]
            )
        if alternating:
            commands.append(("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, PANEL]))
        if center:
            commands.append(("ALIGN", (0, 0), (-1, -1), "CENTER"))
        return TableStyle(commands)

    def _pdf_styles(self) -> dict:
        sample = getSampleStyleSheet()
        return {
            "title": ParagraphStyle(
                "ReportTitle",
                parent=sample["Title"],
                fontName="VeraBd",
                fontSize=22,
                leading=26,
                textColor=INK,
                alignment=TA_LEFT,
                spaceAfter=3,
            ),
            "eyebrow": ParagraphStyle(
                "ReportEyebrow", parent=sample["Normal"], fontName="VeraBd", fontSize=8, leading=10, textColor=TEAL, spaceAfter=3
            ),
            "heading": ParagraphStyle(
                "ReportHeading",
                parent=sample["Heading1"],
                fontName="VeraBd",
                fontSize=13,
                leading=16,
                textColor=INK,
                spaceBefore=4,
                spaceAfter=7,
            ),
            "subheading": ParagraphStyle(
                "ReportSubheading", parent=sample["Heading2"], fontName="VeraBd", fontSize=9, leading=11, textColor=INK, spaceAfter=3
            ),
            "body": ParagraphStyle("ReportBody", parent=sample["BodyText"], fontName="Vera", fontSize=8, leading=10.5, textColor=INK),
            "muted": ParagraphStyle(
                "ReportMuted", parent=sample["BodyText"], fontName="Vera", fontSize=7.5, leading=10, textColor=MUTED, spaceBefore=3
            ),
            "metric": ParagraphStyle(
                "ReportMetric", parent=sample["Normal"], fontName="VeraBd", fontSize=15, leading=17, textColor=INK, alignment=TA_CENTER
            ),
            "metric_label": ParagraphStyle(
                "ReportMetricLabel", parent=sample["Normal"], fontName="Vera", fontSize=7, leading=9, textColor=MUTED, alignment=TA_CENTER
            ),
            "cell": ParagraphStyle("ReportCell", parent=sample["Normal"], fontName="Vera", fontSize=6.8, leading=8.6, textColor=INK),
        }

    def _metric_cell(self, value, label: str, styles: dict):
        return Paragraph(
            f'<font name="VeraBd" size="15" color="#0f172a">{escape(str(value))}</font>'
            f'<br/><font name="Vera" size="7" color="#64748b">{escape(label)}</font>',
            styles["metric_label"],
        )

    def _cell(self, value, styles: dict) -> Paragraph:
        text = "" if value is None else str(value)
        return Paragraph(escape(text).replace("\n", "<br/>"), styles["cell"])

    def _register_fonts(self) -> None:
        if "Vera" in pdfmetrics.getRegisteredFontNames():
            return
        fonts = Path(reportlab.__file__).resolve().parent / "fonts"
        pdfmetrics.registerFont(TTFont("Vera", str(fonts / "Vera.ttf")))
        pdfmetrics.registerFont(TTFont("VeraBd", str(fonts / "VeraBd.ttf")))

    def _session_sort_key(self, item: dict) -> tuple:
        return (
            DAY_ORDER.get(item["day"], len(DAY_ORDER)),
            time_to_minutes(item["start_time"]) or 0,
            item["module_code"] or "",
            item["student_group_code"] or "",
        )

    def _affected_session_summary(self, item: dict) -> dict:
        return {
            "session_id": item["session_id"],
            "requirement_id": item["requirement_id"],
            "module_code": item["module_code"],
            "student_group_code": item["student_group_code"],
            "placement": f"{item['day']} {item['start_time']}-{item['end_time']} in {item['room']}",
        }

    def _unique_count(self, items: list[dict], key: str) -> int:
        return len({item[key] for item in items if item.get(key)})

    def _label(self, value: str) -> str:
        return value.replace("_", " ").title()

    def _format_datetime(self, value: str | None) -> str:
        if not value:
            return "Not available"
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.strftime("%d %b %Y, %H:%M UTC")
        except ValueError:
            return value
