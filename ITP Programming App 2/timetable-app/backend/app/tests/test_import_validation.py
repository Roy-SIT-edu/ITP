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

    ImportService().import_input_template(db_session, path)
    validation = ValidationService().validate_latest(db_session)

    assert validation["is_valid"] is False
    assert any(error["field"] == "Programme" for error in validation["errors"])


def test_invalid_class_size_produces_validation_error(db_session, tmp_path):
    path = write_template(tmp_path / "input.xlsx", [valid_row(**{"Exact Class Size": "large"})])

    ImportService().import_input_template(db_session, path)
    validation = ValidationService().validate_latest(db_session)

    assert validation["is_valid"] is False
    assert any("Exact Class Size must be numeric" in error["message"] for error in validation["errors"])
