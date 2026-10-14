# ==============================================================================
# EcoPulse — Production Dockerfile
# Multi-platform container configuration for Flask ML Backend & Static Dashboard
# Compatible with Fly.io, Railway, Render, AWS ECS, GCP Cloud Run, and Docker Compose
# ==============================================================================

FROM python:3.12-slim

# Prevent Python from writing .pyc files to disk and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=5000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/app/data/ecopulse.db

# Set working directory
WORKDIR /app

# Install system dependencies (curl for health checks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create data directory for persistent SQLite database
RUN mkdir -p /app/data

# Copy application source code and pre-trained ML model
COPY . .

# Ensure data directory has proper permissions
VOLUME ["/app/data"]

# Expose service port
EXPOSE 5000

# Container health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT}/healthz || exit 1

# Launch production WSGI application with Gunicorn
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers 2 --threads 4 --timeout 60 server:app"]
