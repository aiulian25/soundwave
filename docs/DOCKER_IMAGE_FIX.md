# 🐛 Docker Image Pull Issue - Fixed

## Problem Identified

The deployment was failing on new machines because:

1. ❌ **No image published** - The Docker image `aiulian25/soundwave:latest` was never pushed to Docker Hub
2. ❌ **No CI/CD pipeline** - No automated builds to GitHub Container Registry
3. ❌ **No fallback option** - Users couldn't build locally if pull failed

## Solutions Implemented

### 1. GitHub Actions Workflow (Automated)

Created [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml):
- ✅ Automatically builds Docker image on push to main/master
- ✅ Publishes to GitHub Container Registry (ghcr.io)
- ✅ Supports multi-platform (amd64, arm64)
- ✅ Creates versioned tags for releases
- ✅ Uses GitHub Actions cache for faster builds

### 2. Updated docker-compose.yml

Changed image source from Docker Hub to GitHub Container Registry:
```yaml
image: ghcr.io/aiulian25/soundwave:latest
```

Added commented build option as fallback:
```yaml
# build:
#   context: .
#   dockerfile: Dockerfile
```

## 🚀 How to Use

### For End Users (After First Push)

**Option 1: Pull Pre-built Image** (Recommended)
```bash
# Clone repository
git clone https://github.com/aiulian25/soundwave.git
cd soundwave

# Start services (will pull from ghcr.io)
docker compose up -d
```

**Option 2: Build Locally** (If pull fails or for development)
```bash
# Clone repository
git clone https://github.com/aiulian25/soundwave.git
cd soundwave

# Build frontend first
cd frontend
npm install
npm run build
cd ..

# Build and start with Docker
docker compose up -d --build
```

### For Repository Owner (First Time Setup)

1. **Push to GitHub** - Push this repository to GitHub
2. **Enable Package Publishing**:
   - Go to repository Settings → Actions → General
   - Under "Workflow permissions", select "Read and write permissions"
   - Check "Allow GitHub Actions to create and approve pull requests"
3. **Trigger First Build**:
   - Push to main branch, or
   - Go to Actions → "Build and Publish Docker Image" → Run workflow

The image will be published to: `ghcr.io/yourusername/soundwave:latest`

### Making the Image Public

By default, GitHub Container Registry images are private. To make it public:

1. Go to your GitHub profile → Packages
2. Click on `soundwave` package
3. Click "Package settings"
4. Scroll to "Danger Zone"
5. Click "Change visibility" → "Public"

## 📝 Deployment Files Updated

1. ✅ [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) - CI/CD pipeline
2. ✅ [`docker-compose.yml`](docker-compose.yml) - Updated image reference
3. ✅ This troubleshooting guide

## 🔄 Updating the Image

After pushing code changes:
1. GitHub Actions automatically builds new image
2. Users pull latest with: `docker compose pull && docker compose up -d`

## 🛠️ Alternative: Docker Hub

If you prefer Docker Hub over GitHub Container Registry:

1. **Login to Docker Hub**:
   ```bash
   docker login
   ```

2. **Build and push**:
   ```bash
   cd frontend && npm install && npm run build && cd ..
   docker build -t aiulian25/soundwave:latest .
   docker push aiulian25/soundwave:latest
   ```

3. **Update docker-compose.yml**:
   ```yaml
   image: aiulian25/soundwave:latest
   ```

4. **Add to GitHub Secrets** (for automation):
   - Repository Settings → Secrets → Actions
   - Add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
   - Update workflow to use Docker Hub

## 📋 Quick Reference

**Current Image Location**: `ghcr.io/aiulian25/soundwave:latest`  
**Build Context**: Root directory (includes frontend/dist)  
**Platforms Supported**: linux/amd64, linux/arm64  
**Auto-build**: On push to main/master branch  

## ✅ Verification

After setup, verify the image is available:

```bash
# Check if image exists (after first GitHub Actions run)
docker pull ghcr.io/aiulian25/soundwave:latest

# Or check GitHub Packages
# Visit: https://github.com/yourusername?tab=packages
```

## 🎯 Benefits

1. **Zero-config for users** - Just `docker compose up -d`
2. **Automatic updates** - CI/CD builds on every push
3. **Multi-platform** - Works on Intel and ARM (Apple Silicon, Raspberry Pi)
4. **Version tags** - Can pin to specific versions
5. **Fallback option** - Can build locally if needed
