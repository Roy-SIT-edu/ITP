from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_db_and_seed
from app.routes import data_routes, export_routes, schedule_routes, upload_routes, validation_routes

app = FastAPI(title="Timetable Scheduling API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload_routes.router)
app.include_router(validation_routes.router)
app.include_router(data_routes.router)
app.include_router(schedule_routes.router)
app.include_router(export_routes.router)


@app.on_event("startup")
def startup() -> None:
    create_db_and_seed()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
