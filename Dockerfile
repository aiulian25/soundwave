# Build stage - only for compiling dependencies
FROM python:3.11-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade setuptools and wheel to address CVEs in vendored copies bundled with setuptools:
# - CVE-2026-24049: wheel privilege escalation (fixed in wheel 0.46.2)
# - CVE-2026-23949: jaraco.context path traversal (fixed in setuptools >=80.0.0 vendored deps)
# Pinned (CNT-03); both are build-only and removed from the runtime image below.
RUN pip install --no-cache-dir --upgrade "setuptools==82.0.1" "wheel==0.47.0"

# Install Python dependencies globally. yt-dlp is pinned in requirements.txt
# (CNT-02) — do NOT re-install it unpinned here, which would defeat the pin.
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Final stage - runtime only
FROM python:3.11-slim

# Create a non-root user and group
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup -d /app -s /sbin/nologin -c "Docker image user" appuser

# Install only runtime dependencies (no build-essential).
# --no-install-recommends keeps the image minimal; apt-get upgrade applies the latest
# OS security patches.
# CNT-04: ffmpeg pulls the mesa/GL stack (libavdevice's OpenGL/KMS *output devices*),
# which audio-only conversion never uses and which carries unfixable CRITICALs
# (CVE-2026-40393). The mesa DRI/GLX/gallium drivers are dlopen'd only for actual GL
# rendering, so we force-remove them. NB: libgbm1 (libgbm.so.1) is DT_NEEDED by
# libavdevice — removing it breaks the ffmpeg binary — so it is intentionally kept.
# The runtime never runs apt again, so the residual dep state is inert.
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends curl ffmpeg \
    && for pkg in libgl1-mesa-dri libglx-mesa0 mesa-libgallium; do \
         dpkg --purge --force-depends "$pkg" 2>/dev/null || true; \
       done \
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

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -sf http://localhost:8888/api/ping/ || exit 1

CMD ["/app/docker_assets/run.sh"]
