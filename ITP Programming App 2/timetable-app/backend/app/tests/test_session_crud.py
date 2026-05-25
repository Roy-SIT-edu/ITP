from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.module import Module
from app.models.programme import Programme
from app.models.session import Session
from app.models.staff import Staff
from app.models.student_group import StudentGroup


def _route_db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'route-test.db'}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    return db

def _client_for(db) -> TestClient:
    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    return TestClient(app)


def test_create_session(tmp_path):
    db = _route_db(tmp_path)
    client = _client_for(db)
    
    try:
        response = client.post(
            "/api/sessions",
            json={
                "requirement_id": "REQ-0001",
                "programme": "DSC",
                "module_code": "DSC1234",
                "module_title": "Test Data Science",
                "student_group_code": "DSC-Y1-G1",
                "exact_class_size": 40,
                "staff_name": "Dr. Test",
                "class_type": "Lecture",
                "delivery_mode": "Face-to-face",
                "duration_minutes": 120
            }
        )
    finally:
        app.dependency_overrides.clear()
        
    assert response.status_code == 200
    data = response.json()
    assert data["requirement_id"] == "REQ-0001"
    assert data["programme"] == "DSC"
    assert data["module_code"] == "DSC1234"
    assert data["student_group_code"] == "DSC-Y1-G1"
    assert data["staff_name"] == "Dr. Test"
    assert data["class_type"] == "Lecture"
    assert data["duration_minutes"] == 120
    
    # Verify dependencies were created
    assert db.query(Programme).filter_by(code="DSC").first() is not None
    assert db.query(Module).filter_by(module_code="DSC1234").first() is not None
    assert db.query(StudentGroup).filter_by(group_code="DSC-Y1-G1").first() is not None
    assert db.query(Staff).filter_by(staff_name="Dr. Test").first() is not None
    db.close()


def test_update_session(tmp_path):
    db = _route_db(tmp_path)
    
    # Create an initial session via API
    client = _client_for(db)
    create_resp = client.post(
        "/api/sessions",
        json={"requirement_id": "REQ-0002", "programme": "ASE", "duration_minutes": 60, "staff_name": "Dr Update"}
    )
    session_id = create_resp.json()["id"]
    
    try:
        response = client.put(
            f"/api/sessions/{session_id}",
            json={
                "requirement_id": "REQ-0002-MOD",
                "programme": "ASE",
                "duration_minutes": 180,
                "class_type": "Tutorial",
                "staff_name": "Dr Update"
            }
        )
    finally:
        app.dependency_overrides.clear()
        
    assert response.status_code == 200
    data = response.json()
    assert data["requirement_id"] == "REQ-0002-MOD"
    assert data["duration_minutes"] == 180
    assert data["class_type"] == "Tutorial"
    db.close()


def test_delete_session(tmp_path):
    db = _route_db(tmp_path)
    client = _client_for(db)
    
    create_resp = client.post("/api/sessions", json={"requirement_id": "REQ-DEL", "programme": "MDME", "staff_name": "Dr Delete"})
    session_id = create_resp.json()["id"]
    
    try:
        response = client.delete(f"/api/sessions/{session_id}")
    finally:
        app.dependency_overrides.clear()
        
    assert response.status_code == 200
    assert response.json()["message"] == "Session deleted successfully"
    assert db.query(Session).filter_by(id=session_id).first() is None
    db.close()
