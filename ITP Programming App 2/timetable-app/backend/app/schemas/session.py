from typing import Optional
from pydantic import BaseModel


class SessionInput(BaseModel):
    requirement_id: Optional[str] = None
    programme: Optional[str] = None
    module_code: Optional[str] = None
    module_title: Optional[str] = None
    module_host_key: Optional[str] = None
    student_group_code: Optional[str] = None
    year: Optional[int] = None
    exact_class_size: Optional[int] = None
    staff_name: Optional[str] = None
    staff_id: Optional[str] = None
    class_type: Optional[str] = None
    delivery_mode: Optional[str] = None
    campus_mode: Optional[str] = None
    venue_type_required: Optional[str] = None
    duration_minutes: Optional[int] = None
    sessions_per_week: Optional[int] = None
    start_week: Optional[int] = None
    end_week: Optional[int] = None
    week_pattern: Optional[str] = None
    custom_weeks: Optional[str] = None
    scheduling_type: Optional[str] = None
    fixed_day: Optional[str] = None
    fixed_start_time: Optional[str] = None
    fixed_end_time: Optional[str] = None
    preferred_days: Optional[str] = None
    avoid_days: Optional[str] = None
    priority: Optional[str] = None
    remarks: Optional[str] = None
