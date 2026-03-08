# Build stage - only for compiling dependencies
FROM python:3.11-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade setuptools and wheel to address CVEs in vendored copies bundled with setuptools:
# - CVE-2026-24049: wheel privilege escalation (fixed in wheel 0.46.2)
# - CVE-2026-23949: jaraco.context path traversal (fixed in setuptools >=80.0.0 vendored deps)
# Upgrade wheel separately too since setuptools vendors its own copy
RUN pip install --no-cache-dir --upgrade setuptools "wheel>=0.46.2"

# Install Python dependencies globally
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir yt-dlp

# Final stage - runtime only
FROM python:3.11-slim

# Create a non-root user and group
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup -d /app -s /sbin/nologin -c "Docker image user" appuser

# Install only runtime dependencies (no build-essential)
# Use --no-install-recommends to skip unnecessary packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Remove build tools not needed at runtime — eliminates pip/setuptools/wheel CVEs
# and reduces image size. The app is a Django server; it never installs packages at runtime.
RUN rm -rf \
    /usr/local/lib/python3.11/site-packages/pip \
    /usr/local/lib/python3.11/site-packages/pip-*.dist-info \
    /usr/local/lib/python3.11/site-packages/setuptools \
    /usr/local/lib/python3.11/site-packages/setuptools-*.dist-info \
    /usr/local/lib/python3.11/site-packages/wheel \
    /usr/local/lib/python3.11/site-packages/wheel-*.dist-info \
    /usr/local/bin/pip \
    /usr/local/bin/pip3 \
    /usr/local/bin/pip3.11 \
    /usr/local/bin/wheel

WORKDIR /app

# Copy backend code
COPY backend /app/backend
# Copy frontend build
COPY frontend/dist /app/frontend/dist
# Copy assets
COPY docker_assets /app/docker_assets

# Set ownership for the app directory
RUN chown -R appuser:appgroup /app && chmod -R 755 /app

WORKDIR /app/backend

# Make startup script executable
RUN chmod +x /app/docker_assets/run.sh

# Switch to the non-root user
USER appuser

EXPOSE 8888

CMD ["/app/docker_assets/run.sh"]
