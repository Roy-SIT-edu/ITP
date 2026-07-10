"""Administrative schedule-run reporting and PDF rendering."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from app.models.constraint_violation import ConstraintViolation
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.services.compatibility import time_to_minutes
from app.services.schedule_quality_service import schedule_quality_from_violations
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

        scheduled = (
            db.query(ScheduledSession)
            .filter_by(schedule_run_id=schedule_run_id)
            .order_by(ScheduledSession.day, ScheduledSession.start_time)
            .all()
        )
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
        story.extend(self._scheduling_breakdown(report, styles))
        story.append(PageBreak())
        story.extend(self._conflict_report(report, styles))
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
            "scheduling_type": session.scheduling_type,
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
        if scheduled_count <= 0:
            return {
                "starting_score": 100,
                "hard_conflict_deduction": 0,
                "soft_warning_deduction": 0,
                "affected_session_deduction": 0,
                "preference_pressure_deduction": 0,
                "hard_conflict_cap_applied": False,
            }
        hard = quality["hard_issue_count"]
        soft = quality["soft_warning_count"]
        affected_rate = quality["affected_session_count"] / scheduled_count
        pressure_per_session = quality["raw_soft_score"] / scheduled_count
        return {
            "starting_score": 100,
            "hard_conflict_deduction": min(70, hard * 18 + round(affected_rate * 25)) if hard else 0,
            "soft_warning_deduction": min(35, round((soft / scheduled_count) * 35)),
            "affected_session_deduction": min(20, round(affected_rate * 20)),
            "preference_pressure_deduction": min(15, round(pressure_per_session / 25)),
            "hard_conflict_cap_applied": hard > 0,
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
        cap_note = " Hard conflicts cap the final result at 49." if deductions["hard_conflict_cap_applied"] else ""
        elements.append(Paragraph(escape(quality["summary"] + cap_note), styles["muted"]))
        elements.append(Spacer(1, 5 * mm))
        return elements

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
