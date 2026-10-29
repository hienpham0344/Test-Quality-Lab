FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app /app/app
RUN groupadd --gid 10001 worker && useradd --uid 10001 --gid 10001 --no-create-home worker && mkdir -p /app/artifacts && chown -R worker:worker /app
USER worker
CMD ["celery", "-A", "app.infrastructure.queue.celery_app:celery_app", "worker", "--loglevel=info", "--concurrency=1"]
