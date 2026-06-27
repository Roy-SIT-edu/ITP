"""Pydantic request schema for manual requirement create/update calls."""

from pydantic import BaseModel


class SessionInput(BaseModel):
    requirement_id: str | None = None
    programme: str | None = None
    module_code: str | None = None
    module_title: str | None = None
    module_host_key: str | None = None
    student_group_code: str | None = None
    year: int | None = None
    exact_class_size: int | None = None
    staff_name: str | None = None
    staff_id: str | None = None
    class_type: str | None = None
    delivery_mode: str | None = None
    campus_mode: str | None = None
    venue_type_required: str | None = None
    duration_minutes: int | None = None
    sessions_per_week: int | None = None
    start_week: int | None = None
    end_week: int | None = None
    week_pattern: str | None = None
    custom_weeks: str | None = None
    scheduling_type: str | None = None
    fixed_day: str | None = None
    fixed_start_time: str | None = None
    fixed_end_time: str | None = None
    preferred_days: str | None = None
    avoid_days: str | None = None
    priority: str | None = None
    remarks: str | None = None
