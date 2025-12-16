# Build stage - only for compiling dependencies
FROM python:3.11-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt
RUN pip install --no-cache-dir --user yt-dlp

# Final stage - runtime only
FROM python:3.11-slim

# Install only runtime dependencies (no build-essential)
# Use --no-install-recommends to skip unnecessary packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

WORKDIR /app

# Copy backend code
COPY backend /app/backend
COPY docker_assets /app/docker_assets

# Copy frontend build
COPY frontend/dist /app/frontend/dist

WORKDIR /app/backend

# Make startup script executable
RUN chmod +x /app/docker_assets/run.sh

EXPOSE 8888

CMD ["/app/docker_assets/run.sh"]
