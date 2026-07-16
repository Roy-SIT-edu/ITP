import sys, os, time, traceback
sys.path.append(os.getcwd() + '/backend')
from app.database import SessionLocal
from app.services.schedule_service import ScheduleService
from app.models.schedule_run import ScheduleRun

db = SessionLocal()
run = db.query(ScheduleRun).order_by(ScheduleRun.id.desc()).first()
print("Latest run: id=%d, conflicts=%d, status=%s" % (run.id, run.hard_violation_count or 0, run.status))

service = ScheduleService()
print("Running auto_deconflict on run %d..." % run.id)
try:
    t0 = time.perf_counter()
    result = service.auto_deconflict(db, run.id)
    t1 = time.perf_counter()
    print("Done in %.1f seconds" % (t1 - t0))
    print("New run: %d" % result["schedule_run_id"])
    print("Status: %s" % result["solver_status"])
    print("Hard violations: %d" % result["hard_violation_count"])
    print("Message: %s" % result["message"])
    
    # Verify in DB
    new_run = db.query(ScheduleRun).filter_by(id=result["schedule_run_id"]).first()
    print("\nDB verification: run %d, status=%s, conflicts=%d" % (new_run.id, new_run.status, new_run.hard_violation_count or 0))
except Exception as e:
    traceback.print_exc()
    print("ERROR: %s" % str(e))
