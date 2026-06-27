import sys
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.routes.schedule_routes import auto_assign_schedule

def test():
    db = SessionLocal()
    try:
        result = auto_assign_schedule(db)
        print("Success:", result)
    except Exception as e:
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    test()
