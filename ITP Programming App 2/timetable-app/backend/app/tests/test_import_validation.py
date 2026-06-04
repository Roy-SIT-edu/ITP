"""Tests for strict requirements import validation and rollback behavior."""

from app.models.session import Session
from app.services.import_service import ImportService
from app.services.validation_service import ValidationService
from app.tests.conftest import valid_row, write_template


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
    path = write_template(tmp_path / "input.xlsx", [valid_row(**{"Delivery Mode": "Online Synchronous", "Campus Mode": "Online", "Venue Type Required": "Virtual Room"})])

    ImportService().import_input_template(db_session, path)
    session = db_session.query(Session).filter_by(requirement_id="REQ-TEST-001").one()
    validation = ValidationService().validate_latest(db_session)

    assert session.delivery_mode == "Online"
    assert validation["is_valid"] is True


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
            valid_row(**{"Requirement ID": "REQ-BAD-001", "Module Code": "UNKNOWN999"}),
        ],
    )

    before_count = db_session.query(Session).count()
    summary = ImportService().import_input_template(db_session, path)

    assert summary["rows_imported"] == 0
    assert summary["rows_failed"] >= 1
    assert db_session.query(Session).count() == before_count
    assert db_session.query(Session).filter_by(requirement_id="REQ-GOOD-001").first() is None


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
