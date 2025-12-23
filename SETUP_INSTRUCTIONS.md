# 🚀 Quick Setup - Publishing Docker Image

## The Problem
The docker-compose.yml was trying to pull `aiulian25/soundwave:latest` from Docker Hub, but this image was never published. New machines couldn't install SoundWave.

## The Solution
I've set up automated publishing to GitHub Container Registry (free and integrated with GitHub).

## 📋 Steps to Enable (One-Time Setup)

### 1. Push This Code to GitHub

```bash
git add .
git commit -m "Add GitHub Actions workflow for Docker image publishing"
git push origin main
```

### 2. Enable GitHub Actions Permissions

1. Go to your repository on GitHub
2. Click **Settings** → **Actions** → **General**
3. Scroll to "Workflow permissions"
4. Select **"Read and write permissions"**
5. Check **"Allow GitHub Actions to create and approve pull requests"**
6. Click **Save**

### 3. Trigger First Build

The workflow will automatically run when you push. To manually trigger:

1. Go to **Actions** tab on GitHub
2. Click **"Build and Publish Docker Image"**
3. Click **"Run workflow"** → **"Run workflow"**

Wait 5-10 minutes for the build to complete.

### 4. Make the Image Public (Optional but Recommended)

By default, the image is private (only you can pull it).

1. Go to your GitHub profile
2. Click **"Packages"** tab
3. Click on **"soundwave"** package
4. Click **"Package settings"** (right side)
5. Scroll to "Danger Zone"
6. Click **"Change visibility"** → **"Public"**
7. Confirm

Now anyone can pull the image!

## ✅ Verification

After the workflow completes, verify it worked:

```bash
# Pull the published image
docker pull ghcr.io/aiulian25/soundwave:latest

# Check it works
docker run --rm ghcr.io/aiulian25/soundwave:latest python --version
```

## 🎯 Now Users Can Install With:

```bash
# Download docker-compose.yml
wget https://raw.githubusercontent.com/aiulian25/soundwave/main/docker-compose.yml

# Start (it will pull the pre-built image automatically)
docker compose up -d
```

## 🔄 Future Updates

Every time you push to main/master:
1. GitHub Actions automatically builds new image
2. Publishes to ghcr.io/aiulian25/soundwave:latest
3. Users can update with: `docker compose pull && docker compose up -d`

## 🛠️ Alternative: Build Locally

If you don't want to wait for GitHub Actions or the image isn't published yet, users can still build locally:

```bash
# Clone repo
git clone https://github.com/aiulian25/soundwave.git
cd soundwave

# Build frontend
cd frontend && npm install && npm run build && cd ..

# Build and start
docker compose up -d --build
```

## 📝 What I Changed

1. ✅ Created `.github/workflows/docker-publish.yml` - Automated CI/CD
2. ✅ Updated `docker-compose.yml` - Changed image from `aiulian25/soundwave` to `ghcr.io/aiulian25/soundwave`
3. ✅ Created `docs/DOCKER_IMAGE_FIX.md` - Detailed troubleshooting guide
4. ✅ Updated `DEPLOYMENT.md` - Fixed deployment instructions

## 🎉 Summary

**Before**: Image didn't exist → Pull failed → Installation broken

**After**: 
- GitHub Actions builds image on every push
- Published to GitHub Container Registry
- Users can pull and run immediately
- Fallback to local build if needed

Your next git push will trigger the first build! 🚀
