from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401
from app.database import Base
from app.database import get_db
from app.main import app
from app.services.seed_service import seed_reference_data, seed_sample_sessions
from app.tests.conftest import valid_row, write_template


def _client_for(db) -> TestClient:
    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    return TestClient(app)


def _route_db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'route-test.db'}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    seed_reference_data(db)
    seed_sample_sessions(db)
    db.commit()
    return db


def test_upload_route_imports_valid_workbook(tmp_path):
    db = _route_db(tmp_path)
    path = write_template(tmp_path / "input.xlsx", [valid_row()])
    client = _client_for(db)
    try:
        response = client.post(
            "/api/upload/input-template",
            files={
                "file": (
                    "input.xlsx",
                    path.read_bytes(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    finally:
        app.dependency_overrides.clear()
        db.close()

    assert response.status_code == 200
    assert response.json()["rows_imported"] == 1


def test_upload_route_returns_400_for_unreadable_workbook(tmp_path):
    db = _route_db(tmp_path)
    client = _client_for(db)
    try:
        response = client.post(
            "/api/upload/input-template",
            files={"file": ("broken.xlsx", b"not a workbook", "application/octet-stream")},
        )
    finally:
        app.dependency_overrides.clear()
        db.close()

    assert response.status_code == 400
    assert "Could not read timetable workbook" in response.json()["detail"]
