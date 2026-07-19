"""Database setup for the split SQLite storage model.

The app keeps one SQLAlchemy session, but routes each model to its own SQLite
file through SQLAlchemy binds so services can query related models normally.
"""

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_ROOT / "data"
LEGACY_DATABASE_PATH = BACKEND_ROOT / "timetable.db"

SPLIT_DATABASE_FILES = {
    "rooms": "rooms.db",
    "staff": "staff.db",
    "programmes": "programmes.db",
    "modules": "modules.db",
    "student_groups": "student_groups.db",
    "time_slots": "time_slots.db",
    "calendar": "calendar.db",
    "requirements": "requirements.db",
    "schedule_state": "schedule_state.db",
}

# Maps each table name to the split database file that owns it.
TABLE_DATABASE_NAMES = {
    "rooms": "rooms",
    "staff": "staff",
    "programmes": "programmes",
    "modules": "modules",
    "student_groups": "student_groups",
    "time_slots": "time_slots",
    "academic_weeks": "calendar",
    "public_holidays": "calendar",
    "sessions": "requirements",
    "session_staff": "requirements",
    "lab_requirements": "requirements",
    "schedule_runs": "schedule_state",
    "scheduled_sessions": "schedule_state",
    "constraint_violations": "schedule_state",
    "soft_constraint_priorities": "schedule_state",
    "session_occurrences": "schedule_state",
}

DATABASE_URL = f"sqlite:///{DATA_DIR / SPLIT_DATABASE_FILES['schedule_state']}"
Base = declarative_base()


def _sqlite_engine(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{path}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, connection_record):  # noqa: ARG001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA busy_timeout=30000")
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
        except Exception:
            # Existing dev-server processes may still hold rollback-journal locks.
            # New connections can continue with busy_timeout and WAL will apply
            # once the database is free.
            pass
        cursor.close()

    return engine


def _build_engines(data_dir: Path = DATA_DIR) -> dict[str, object]:
    return {name: _sqlite_engine(data_dir / filename) for name, filename in SPLIT_DATABASE_FILES.items()}


def _model_database_names():
    from app.models.academic_week import AcademicWeek
    from app.models.constraint_violation import ConstraintViolation
    from app.models.lab_requirement import LabRequirement
    from app.models.module import Module
    from app.models.programme import Programme
    from app.models.public_holiday import PublicHoliday
    from app.models.room import Room
    from app.models.schedule_run import ScheduleRun
    from app.models.scheduled_session import ScheduledSession
    from app.models.session import Session as Requirement
    from app.models.session_occurrence import SessionOccurrence
    from app.models.session_staff import SessionStaff
    from app.models.soft_constraint_priority import SoftConstraintPriority
    from app.models.staff import Staff
    from app.models.student_group import StudentGroup
    from app.models.time_slot import TimeSlot

    return {
        Room: "rooms",
        Staff: "staff",
        Programme: "programmes",
        Module: "modules",
        StudentGroup: "student_groups",
        TimeSlot: "time_slots",
        AcademicWeek: "calendar",
        PublicHoliday: "calendar",
        Requirement: "requirements",
        SessionStaff: "requirements",
        LabRequirement: "requirements",
        ScheduleRun: "schedule_state",
        ScheduledSession: "schedule_state",
        ConstraintViolation: "schedule_state",
        SoftConstraintPriority: "schedule_state",
        SessionOccurrence: "schedule_state",
    }


def _routing_session_class(engines: dict[str, object]):
    class RoutingSession(Session):
        def get_bind(self, mapper=None, clause=None, **kwargs):
            # SQLAlchemy calls this for every model operation; returning the
            # matching engine is what makes cross-file access feel like one DB.
            if mapper is not None:
                table_name = mapper.persist_selectable.name
                database_name = TABLE_DATABASE_NAMES.get(table_name)
                if database_name:
                    return engines[database_name]
            return engines["schedule_state"]

    return RoutingSession


_ENGINES = _build_engines()
engine = _ENGINES["schedule_state"]
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=_routing_session_class(_ENGINES),
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _create_split_tables(engines: dict[str, object]) -> None:
    from app import models  # noqa: F401

    for model, database_name in _model_database_names().items():
        model.__table__.create(bind=engines[database_name], checkfirst=True)


def _ensure_programme_years_column(engine) -> None:
    with engine.begin() as connection:
        columns = {row[1] for row in connection.execute(text("PRAGMA table_info(programmes)")).fetchall()}
        if columns and "years" not in columns:
            connection.execute(text("ALTER TABLE programmes ADD COLUMN years INTEGER"))


def _ensure_soft_constraint_active_column(engine) -> None:
    with engine.begin() as connection:
        columns = {row[1] for row in connection.execute(text("PRAGMA table_info(soft_constraint_priorities)")).fetchall()}
        if columns and "is_active" not in columns:
            connection.execute(text("ALTER TABLE soft_constraint_priorities ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1"))


def _ensure_column(engine, table_name: str, column_name: str, definition: str) -> None:
    with engine.begin() as connection:
        columns = {row[1] for row in connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()}
        if columns and column_name not in columns:
            connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"))


def _ensure_session_lab_columns(engine) -> None:
    _ensure_column(engine, "sessions", "required_room_codes", "TEXT")
    _ensure_column(engine, "sessions", "required_student_group_codes", "TEXT")
    _ensure_column(engine, "sessions", "is_lab_requirement", "BOOLEAN NOT NULL DEFAULT 0")
    _ensure_column(engine, "sessions", "lab_requirement_id", "INTEGER")


def _normalize_online_class_types(engine) -> None:
    """Move legacy Online activity labels to a real class type.

    Online describes delivery, not the teaching activity. Older sample imports
    used it in both fields, so normalize those rows during startup.
    """
    params = {"replacement": "Lecture", "invalid": "online"}
    with engine.begin() as connection:
        for table_name in ("sessions", "lab_requirements"):
            columns = {
                row[1]
                for row in connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
            }
            if "class_type" not in columns:
                continue
            connection.execute(
                text(
                    f"UPDATE {table_name} "
                    "SET class_type = :replacement "
                    "WHERE lower(trim(class_type)) = :invalid"
                ),
                params,
            )


def _drop_column_if_exists(engine, table_name: str, column_name: str) -> None:
    with engine.begin() as connection:
        columns = {row[1] for row in connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()}
        if column_name in columns:
            connection.execute(text(f"ALTER TABLE {table_name} DROP COLUMN {column_name}"))


def _ensure_split_schema(engines: dict[str, object]) -> None:
    _ensure_programme_years_column(engines["programmes"])
    _ensure_soft_constraint_active_column(engines["schedule_state"])
    _ensure_column(
        engines["schedule_state"],
        "scheduled_sessions",
        "included_in_final",
        "BOOLEAN NOT NULL DEFAULT 1",
    )
    _ensure_column(engines["schedule_state"], "schedule_runs", "academic_year", "TEXT")
    _ensure_column(engines["schedule_state"], "schedule_runs", "trimester", "INTEGER")
    _ensure_session_lab_columns(engines["requirements"])
    _normalize_online_class_types(engines["requirements"])
    _drop_column_if_exists(engines["modules"], "modules", "module_host_key")
    _drop_column_if_exists(engines["staff"], "staff", "staff_host_key")


def _copy_legacy_rows(target_db: Session, legacy_database_path: Path) -> None:
    if not legacy_database_path.exists():
        return

    from app.models.constraint_violation import ConstraintViolation
    from app.models.lab_requirement import LabRequirement
    from app.models.module import Module
    from app.models.programme import Programme
    from app.models.room import Room
    from app.models.schedule_run import ScheduleRun
    from app.models.scheduled_session import ScheduledSession
    from app.models.session import Session as Requirement
    from app.models.session_staff import SessionStaff
    from app.models.soft_constraint_priority import SoftConstraintPriority
    from app.models.staff import Staff
    from app.models.student_group import StudentGroup
    from app.models.time_slot import TimeSlot

    legacy_engine = _sqlite_engine(legacy_database_path)
    _ensure_programme_years_column(legacy_engine)
    LegacySession = sessionmaker(autocommit=False, autoflush=False, bind=legacy_engine)
    source_db = LegacySession()
    ordered_models = [
        Programme,
        Module,
        Staff,
        Room,
        TimeSlot,
        StudentGroup,
        Requirement,
        SessionStaff,
        LabRequirement,
        ScheduleRun,
        ScheduledSession,
        ConstraintViolation,
        SoftConstraintPriority,
    ]
    try:
        for model in ordered_models:
            # Only migrate into empty split tables so current data is preserved.
            if target_db.query(model).count() > 0:
                continue
            try:
                rows = source_db.query(model).order_by(model.id).all()
            except Exception:
                continue
            for row in rows:
                data = {column.name: getattr(row, column.name) for column in model.__table__.columns}
                target_db.add(model(**data))
        target_db.commit()
    finally:
        source_db.close()
        legacy_engine.dispose()


def create_session_factory(data_dir: Path):
    engines = _build_engines(data_dir)
    factory = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engines["schedule_state"],
        class_=_routing_session_class(engines),
    )
    return factory, engines


def dispose_engines(engines: dict[str, object]) -> None:
    for item in engines.values():
        item.dispose()


def create_db_and_seed(
    data_dir: Path | None = None,
    legacy_database_path: Path | None = None,
) -> None:
    from app.services.seed_service import DEFAULT_RAW_DATA_PATH, seed_defaults

    if data_dir is None:
        factory = SessionLocal
        engines = _ENGINES
        legacy_path = legacy_database_path or LEGACY_DATABASE_PATH
        raw_data_path = DEFAULT_RAW_DATA_PATH
        seed_lab_requirements = True
    else:
        factory, engines = create_session_factory(data_dir)
        legacy_path = legacy_database_path or LEGACY_DATABASE_PATH
        raw_data_path = data_dir / DEFAULT_RAW_DATA_PATH.name
        seed_lab_requirements = False

    _create_split_tables(engines)
    _ensure_split_schema(engines)
    db = factory()
    try:
        _copy_legacy_rows(db, legacy_path)
        seed_defaults(db, raw_data_path=raw_data_path, seed_lab_requirements=seed_lab_requirements)
    finally:
        db.close()
        if data_dir is not None:
            dispose_engines(engines)
