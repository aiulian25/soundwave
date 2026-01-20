# Build stage - only for compiling dependencies
FROM python:3.11-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies globally
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir yt-dlp

# Final stage - runtime only
FROM python:3.11-slim

# Install only runtime dependencies (no build-essential)
# Use --no-install-recommends to skip unnecessary packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

WORKDIR /app

# Copy backend code and fix permissions for user 1000
COPY backend /app/backend
RUN chown -R 1000:1000 /app/backend && chmod -R 755 /app/backend
COPY docker_assets /app/docker_assets

# Copy frontend build
COPY frontend/dist /app/frontend/dist

WORKDIR /app/backend

# Make startup script executable
RUN chmod +x /app/docker_assets/run.sh

EXPOSE 8888

CMD ["/app/docker_assets/run.sh"]
