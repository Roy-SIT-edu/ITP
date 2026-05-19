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
