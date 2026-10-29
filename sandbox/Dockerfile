# This image is NOT started automatically by Docker Compose.
# It is a draft isolated runtime for future security-reviewed execution.
FROM python:3.12-slim
RUN pip install --no-cache-dir pytest==8.3.5 coverage==7.8.0 mutmut==3.3.1
RUN useradd --uid 65534 --no-create-home --shell /usr/sbin/nologin sandbox || true
WORKDIR /workspace
COPY sandbox/runner /opt/runner
USER 65534:65534
ENTRYPOINT ["python", "/opt/runner/main.py"]
