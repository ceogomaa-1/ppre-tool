import asyncio
import hmac
import logging
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, status

from .config import Settings, get_settings
from .pipeline import EnrichmentPipeline
from .supabase_rest import SupabaseRest

running_jobs: set[str] = set()
jobs_lock = asyncio.Lock()
logger = logging.getLogger(__name__)


def require_worker_secret(
    x_worker_secret: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    expected = settings.worker_shared_secret.get_secret_value()
    if not x_worker_secret or not hmac.compare_digest(x_worker_secret, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid worker credential")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.database = SupabaseRest(settings)
    app.state.pipeline = EnrichmentPipeline(settings, app.state.database)
    yield
    await app.state.database.close()


app = FastAPI(
    title="Acreline enrichment worker",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    try:
        await app.state.database.select("enrichment_jobs", {"select": "id", "limit": "1"})
    except Exception as error:
        logger.exception("Worker readiness check failed")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable") from error
    return {"status": "ok", "engine": "scrapling-static", "database": "connected"}


async def run_and_release(job: dict[str, object]) -> None:
    job_id = str(job["id"])
    try:
        await app.state.pipeline.run_claimed(job)
    except Exception:
        logger.exception("Enrichment job %s failed", job_id)
    finally:
        async with jobs_lock:
            running_jobs.discard(job_id)


@app.post("/v1/jobs/{job_id}/run", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_worker_secret)])
async def run_job(job_id: str, background: BackgroundTasks) -> dict[str, str]:
    async with jobs_lock:
        if job_id in running_jobs:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job is already running")
        running_jobs.add(job_id)
    try:
        job = await app.state.pipeline.claim(job_id)
    except ValueError as error:
        async with jobs_lock:
            running_jobs.discard(job_id)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except Exception as error:
        async with jobs_lock:
            running_jobs.discard(job_id)
        logger.exception("Could not claim enrichment job %s", job_id)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Worker database access failed") from error
    background.add_task(run_and_release, job)
    return {"status": "running", "job_id": job_id}
