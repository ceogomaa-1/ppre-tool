FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --requirement requirements.txt \
    && useradd --create-home --uid 10001 acreline

COPY acreline_worker ./acreline_worker
USER acreline
EXPOSE 8080
CMD ["uvicorn", "acreline_worker.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-server-header"]
