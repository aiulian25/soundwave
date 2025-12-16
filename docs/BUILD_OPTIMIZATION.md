# Docker Build Optimization Results

## Improvements Made

### 1. Multi-Stage Build
- **Before**: Single-stage with build-essential in final image
- **After**: Separate builder stage for compilation
- **Benefit**: 
  - Removed build-essential (80MB+) from final image
  - Cleaner separation of build vs runtime dependencies

### 2. Optimized APT Install  
- Added `--no-install-recommends` flag
- Prevents installing 200+ suggested packages with ffmpeg

## Build Time Comparison

| Version | Time | Notes |
|---------|------|-------|
| Original | 6m 15s (375s) | Single stage, all packages |
| Multi-stage | 5m 40s (341s) | **9% faster**, smaller image |
| + no-recommends | Expected: ~3-4m | Skips GUI/X11 packages |

## Bottleneck Analysis

**Current slowest step**: FFmpeg installation (326s / 96%)
- Installs 287 packages including full X11/Mesa/Vulkan stack
- Most are unnecessary for headless audio processing
- `--no-install-recommends` should skip ~200 optional packages

## Build Time Breakdown

```
Stage 1 (Builder): 37s
├── apt-get build-essential: ~10s
└── pip install: 27s

Stage 2 (Runtime): 327s  ← BOTTLENECK
├── apt-get ffmpeg: 326s (installing 287 pkgs!)
└── Other steps: 1s
```

## Next Optimizations

1. ✅ Multi-stage build
2. ✅ Use --no-install-recommends  
3. Consider: Pre-built base image with ffmpeg
4. Consider: BuildKit cache mounts for apt/pip
5. Consider: Minimal ffmpeg build from source

## Estimated Final Time

With `--no-install-recommends`: **3-4 minutes** (50% improvement)
