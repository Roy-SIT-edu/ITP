"""Tests for strict requirements import validation and rollback behavior."""

from app.models.module import Module
from app.models.session import Session
from app.models.session_staff import SessionStaff
from app.models.student_group import StudentGroup
from app.services.import_service import ImportService
from app.services.validation_service import ValidationService
from app.tests.conftest import new_template_row, valid_row, write_template, write_two_tab_template


def test_valid_template_imports_successfully(db_session, tmp_path):
    path = write_template(tmp_path / "input.xlsx", [valid_row()])

    summary = ImportService().import_input_template(db_session, path)
    validation = ValidationService().validate_latest(db_session)

    assert summary["rows_read"] == 1
    assert summary["rows_imported"] == 1
    assert summary["rows_failed"] == 0
    assert db_session.query(Session).count() == 1
    assert validation["is_valid"] is True


def test_online_synchronous_delivery_mode_imports_as_online(db_session, tmp_path):
    path = write_template(
        tmp_path / "input.xlsx",
        [valid_row(**{"Delivery Mode": "Online Synchronous", "Campus Mode": "Online", "Venue Type Required": "Virtual Room"})],
    )

    ImportService().import_input_template(db_session, path)
    session = db_session.query(Session).filter_by(requirement_id="REQ-TEST-001").one()
    validation = ValidationService().validate_latest(db_session)

    assert session.delivery_mode == "Online"
    assert validation["is_valid"] is True


def test_online_is_rejected_as_a_class_type(db_session, tmp_path):
    path = write_template(
        tmp_path / "input.xlsx",
        [
            valid_row(
                **{
                    "Class Type": "Online",
                    "Delivery Mode": "Online",
                    "Campus Mode": "Online",
                    "Venue Type Required": "Virtual Room",
                }
            )
        ],
    )

    summary = ImportService().import_input_template(db_session, path)

    assert summary["rows_imported"] == 0
    assert any(
        error["field"] == "Class Type" and "cannot be Online" in error["message"]
        for error in summary["errors"]
    )


def test_blank_source_row_no_falls_back_to_excel_row(db_session, tmp_path):
    path = write_template(tmp_path / "input.xlsx", [valid_row(**{"Source Row No": None})])

    summary = ImportService().import_input_template(db_session, path)
    session = db_session.query(Session).filter_by(requirement_id="REQ-TEST-001").one()

    assert summary["rows_imported"] == 1
    assert session.source_row_no == 2


def test_source_row_one_falls_back_to_excel_row(db_session, tmp_path):
    path = write_template(tmp_path / "input.xlsx", [valid_row(**{"Source Row No": 1})])

    ImportService().import_input_template(db_session, path)
    session = db_session.query(Session).filter_by(requirement_id="REQ-TEST-001").one()

    assert session.source_row_no == 2


def test_missing_required_field_produces_validation_error(db_session, tmp_path):
    path = write_template(tmp_path / "input.xlsx", [valid_row(Programme="")])

    before_count = db_session.query(Session).count()
    summary = ImportService().import_input_template(db_session, path)

    assert summary["rows_imported"] == 0
    assert summary["rows_failed"] >= 1
    assert db_session.query(Session).count() == before_count
    assert any(error["field"] == "Programme" for error in summary["errors"])


def test_invalid_class_size_produces_validation_error(db_session, tmp_path):
    path = write_template(tmp_path / "input.xlsx", [valid_row(**{"Exact Class Size": "large"})])

    before_count = db_session.query(Session).count()
    summary = ImportService().import_input_template(db_session, path)

    assert summary["rows_imported"] == 0
    assert db_session.query(Session).count() == before_count
    assert any("Exact Class Size must be numeric" in error["message"] for error in summary["errors"])


def test_upload_with_one_bad_row_saves_nothing(db_session, tmp_path):
    path = write_template(
        tmp_path / "input.xlsx",
        [
            valid_row(**{"Requirement ID": "REQ-GOOD-001"}),
            valid_row(**{"Requirement ID": "REQ-BAD-001", "Staff 1 ID": "UNKNOWN-STAFF"}),
        ],
    )

    before_count = db_session.query(Session).count()
    summary = ImportService().import_input_template(db_session, path)

    assert summary["rows_imported"] == 0
    assert summary["rows_failed"] >= 1
    assert db_session.query(Session).count() == before_count
    assert db_session.query(Session).filter_by(requirement_id="REQ-GOOD-001").first() is None


def test_two_tab_template_imports_with_defaults_and_generated_group(db_session, tmp_path):
    path = write_two_tab_template(tmp_path / "two-tab.xlsx", [new_template_row(**{"Module Code": "NEW1001"})])

    summary = ImportService().import_input_template(db_session, path)
    session = db_session.query(Session).filter_by(requirement_id="REQ-NEW-001").one()

    assert summary["rows_imported"] == 1
    assert session.module.module_code == "NEW1001"
    assert db_session.query(Module).filter_by(module_code="NEW1001").one()
    assert session.student_group.group_code == "DSC Y2 P1"
    assert session.scheduling_type == "Flexible"
    assert session.week_pattern == "Weekly"
    assert session.start_week == 1
    assert session.end_week == 13
    assert session.campus_mode == "Physical"
    assert session.staff.staff_id == "S001"


def test_two_tab_template_derives_class_size_from_short_group_code(db_session, tmp_path):
    group = db_session.query(StudentGroup).filter_by(group_code="DSC Y2 P1").one()
    group.size = 47
    db_session.commit()
    row = new_template_row(**{"Student Group Code": "P1"})
    row.pop("Session Count")
    row.pop("Exact Class Size")
    row.pop("Campus Mode", None)
    path = write_two_tab_template(tmp_path / "new-shape.xlsx", [row])

    summary = ImportService().import_input_template(db_session, path)
    session = db_session.query(Session).filter_by(requirement_id="REQ-NEW-001").one()

    assert summary["rows_imported"] == 1
    assert summary["rows_failed"] == 0
    assert session.student_group.group_code == "DSC Y2 P1"
    assert session.exact_class_size == 47
    assert session.campus_mode == "Physical"


def test_two_tab_optional_fields_create_fixed_custom_session(db_session, tmp_path):
    path = write_two_tab_template(
        tmp_path / "two-tab-fixed.xlsx",
        [new_template_row(**{"Requirement ID": "REQ-FIXED-001"})],
        [
            {
                "Requirement ID": "REQ-FIXED-001",
                "Specific Week": 3,
                "Specific Day": "Monday",
                "Start Time": "09:00",
                "End Time": "11:00",
                "Venue Request": "Project room",
                "Cleanup Notes": "One-off teaching week.",
            }
        ],
    )

    summary = ImportService().import_input_template(db_session, path)
    session = db_session.query(Session).filter_by(requirement_id="REQ-FIXED-001").one()

    assert summary["rows_failed"] == 0
    assert session.scheduling_type == "Fixed"
    assert session.week_pattern == "Custom"
    assert session.custom_weeks == "3"
    assert session.start_week == 3
    assert session.end_week == 3
    assert session.fixed_day == "Monday"
    assert session.fixed_start_time == "09:00"
    assert session.fixed_end_time == "11:00"
    assert session.hard_constraint_notes == "Project room"
    assert session.remarks == "One-off teaching week."


def test_two_tab_template_rejects_optional_rows_without_matching_requirement(db_session, tmp_path):
    path = write_two_tab_template(
        tmp_path / "two-tab-bad-optional.xlsx",
        [new_template_row(**{"Requirement ID": "REQ-ONLY-001"})],
        [{"Requirement ID": "REQ-MISSING-001", "Specific Day": "Monday"}],
    )

    before_count = db_session.query(Session).count()
    summary = ImportService().import_input_template(db_session, path)

    assert summary["rows_imported"] == 0
    assert db_session.query(Session).count() == before_count
    assert any("unknown Requirement ID" in error["message"] for error in summary["errors"])


def test_two_tab_template_rejects_missing_and_duplicate_staff(db_session, tmp_path):
    path = write_two_tab_template(
        tmp_path / "two-tab-bad-staff.xlsx",
        [
            new_template_row(
                **{
                    "Requirement ID": "REQ-BAD-STAFF-001",
                    "Staff 1 ID": "",
                    "Staff 2 Name": "Co Teacher",
                    "Staff 2 ID": "",
                }
            ),
            new_template_row(
                **{
                    "Requirement ID": "REQ-BAD-STAFF-002",
                    "Staff 2 Name": "Duplicate",
                    "Staff 2 ID": "S001",
                }
            ),
        ],
    )

    summary = ImportService().import_input_template(db_session, path)

    assert summary["rows_imported"] == 0
    assert any(error["field"] == "Staff 1 ID" for error in summary["errors"])
    assert any("required when Staff 2 Name is filled" in error["message"] for error in summary["errors"])
    assert any("Duplicate staff ID" in error["message"] for error in summary["errors"])


def test_two_tab_template_stores_co_teachers_and_validation_detects_clash(db_session, tmp_path):
    path = write_two_tab_template(
        tmp_path / "two-tab-coteachers.xlsx",
        [
            new_template_row(**{"Requirement ID": "REQ-CO-001", "Staff 2 ID": "S002", "Staff 2 Name": "Prof Lim"}),
            new_template_row(
                **{
                    "Requirement ID": "REQ-CO-002",
                    "Staff 1 ID": "S003",
                    "Staff 1 Name": "Ms Wong",
                    "Staff 2 ID": "S002",
                    "Staff 2 Name": "Prof Lim",
                }
            ),
        ],
        [
            {"Requirement ID": "REQ-CO-001", "Specific Day": "Monday", "Start Time": "09:00", "End Time": "11:00"},
            {"Requirement ID": "REQ-CO-002", "Specific Day": "Monday", "Start Time": "09:00", "End Time": "11:00"},
        ],
    )

    summary = ImportService().import_input_template(db_session, path)
    validation = ValidationService().validate_latest(db_session)

    assert summary["rows_failed"] == 0
    assert db_session.query(SessionStaff).count() == 4
    assert any("STAFF_DOUBLE_BOOKING" in error.get("message", "") or error["field"] == "Fixed Time" for error in validation["errors"])


def test_fixed_session_requires_matching_time_slot(db_session, tmp_path):
    path = write_template(
        tmp_path / "input.xlsx",
        [
            valid_row(
                **{
                    "Scheduling Type": "Fixed",
                    "Fixed Day": "Monday",
                    "Fixed Start Time": "08:00",
                    "Fixed End Time": "09:00",
                }
            )
        ],
    )

    before_count = db_session.query(Session).count()
    summary = ImportService().import_input_template(db_session, path)

    assert summary["rows_imported"] == 0
    assert db_session.query(Session).count() == before_count
    assert any("No time slot matches" in error["message"] for error in summary["errors"])


def test_venue_feasibility_requires_matching_room_capacity(db_session, tmp_path):
    path = write_template(tmp_path / "input.xlsx", [valid_row(**{"Exact Class Size": 1000})])

    before_count = db_session.query(Session).count()
    summary = ImportService().import_input_template(db_session, path)

    assert summary["rows_imported"] == 0
    assert db_session.query(Session).count() == before_count
    assert any(error["field"] == "Venue Type Required" for error in summary["errors"])
