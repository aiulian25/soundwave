# Quick Sync - Adaptive Streaming

## Overview

Quick Sync is an adaptive streaming system that automatically adjusts audio quality based on network speed and system resources for optimal playback experience.

## Features

### Adaptive Quality Selection
- **Auto Mode**: Automatically selects optimal quality based on network and system
- **Manual Modes**: Low (64kbps), Medium (128kbps), High (256kbps), Ultra (320kbps)
- **Real-time Monitoring**: Continuous network speed and system resource monitoring
- **Smart Buffer Management**: Dynamic buffer sizing based on connection quality

### Network Speed Detection
- Measures download speed using CDN test file
- Caches results for 5 minutes to reduce overhead
- Speed thresholds:
  - Ultra: 5+ Mbps
  - High: 2-5 Mbps
  - Medium: 1-2 Mbps
  - Low: 0.5-1 Mbps

### System Resource Monitoring
- CPU usage monitoring
- Memory usage tracking
- Automatic quality adjustment under high system load
- Prevents playback issues during heavy resource usage

### Smart Preferences
- **Prefer Quality**: Upgrades quality when system resources allow
- **Adapt to System**: Downgrades quality under heavy CPU/memory load
- **Apply to Downloads**: Uses Quick Sync settings for downloaded audio

## Architecture

### Backend Components

#### QuickSyncService (`audio/quick_sync_service.py`)
Core service for adaptive streaming logic.

**Key Methods:**
```python
get_system_resources() -> Dict
    Returns CPU, memory, disk usage

measure_network_speed(test_url: str, timeout: int) -> float
    Measures download speed in Mbps
    
get_recommended_quality(user_preferences: Dict) -> Tuple[str, Dict]
    Returns quality level and settings based on network/system
    
get_buffer_settings(quality: str, network_speed: float) -> Dict
    Returns optimal buffer configuration
    
get_quick_sync_status(user_preferences: Dict) -> Dict
    Complete status with network, system, quality info
```

**Quality Presets:**
```python
QUALITY_PRESETS = {
    'low': {'bitrate': 64, 'buffer_size': 5, 'preload': 'metadata'},
    'medium': {'bitrate': 128, 'buffer_size': 10, 'preload': 'auto'},
    'high': {'bitrate': 256, 'buffer_size': 15, 'preload': 'auto'},
    'ultra': {'bitrate': 320, 'buffer_size': 20, 'preload': 'auto'},
    'auto': {'bitrate': 0, 'buffer_size': 0, 'preload': 'auto'},
}
```

#### API Views (`audio/views_quick_sync.py`)

**QuickSyncStatusView**
- GET `/api/audio/quick-sync/status/`
- Returns current status and user preferences

**QuickSyncPreferencesView**
- GET/POST `/api/audio/quick-sync/preferences/`
- Manage user Quick Sync preferences

**QuickSyncTestView**
- POST `/api/audio/quick-sync/test/`
- Run manual network speed test

**QuickSyncQualityPresetsView**
- GET `/api/audio/quick-sync/presets/`
- Get available quality presets and thresholds

### Frontend Components

#### QuickSyncContext (`context/QuickSyncContext.tsx`)
React context providing Quick Sync state management.

**Provided Values:**
```typescript
interface QuickSyncContextType {
  status: QuickSyncStatus | null;
  preferences: QuickSyncPreferences | null;
  loading: boolean;
  updatePreferences: (prefs: Partial<QuickSyncPreferences>) => Promise<void>;
  runSpeedTest: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}
```

**Status Interface:**
```typescript
interface QuickSyncStatus {
  network: {
    speed_mbps: number;
    status: 'excellent' | 'good' | 'fair' | 'poor';
  };
  system: {
    cpu_percent: number;
    memory_percent: number;
    status: 'low_load' | 'moderate_load' | 'high_load';
  };
  quality: {
    level: 'low' | 'medium' | 'high' | 'ultra' | 'auto';
    bitrate: number;
    description: string;
    auto_selected: boolean;
  };
  buffer: {
    buffer_size: number;
    preload: string;
    max_buffer_size: number;
    rebuffer_threshold: number;
  };
}
```

#### QuickSyncSettings Component (`components/QuickSyncSettings.tsx`)
Settings page UI for Quick Sync configuration.

**Features:**
- Real-time network speed and system resource display
- Quality mode selector (Auto/Ultra/High/Medium/Low)
- Preference toggles (prefer quality, adapt to system, apply to downloads)
- Manual speed test button
- Buffer settings information
- Visual status indicators with color-coded alerts

## Usage

### Backend Setup

1. Install dependencies:
```bash
pip install psutil>=5.9.0
```

2. URLs are automatically included in `audio/urls.py`

### Frontend Setup

1. Wrap app with QuickSyncProvider in `main.tsx`:
```tsx
import { QuickSyncProvider } from './context/QuickSyncContext';

<QuickSyncProvider>
  <AppWithTheme />
</QuickSyncProvider>
```

2. Import QuickSyncSettings in SettingsPage:
```tsx
import QuickSyncSettings from '../components/QuickSyncSettings';

<QuickSyncSettings />
```

### Using Quick Sync in Audio Player

```tsx
import { useQuickSync } from '../context/QuickSyncContext';

const Player = () => {
  const { status, preferences } = useQuickSync();
  
  // Use recommended quality
  const quality = status?.quality.level || 'medium';
  const bitrate = status?.quality.bitrate || 128;
  
  // Use buffer settings
  const bufferSize = status?.buffer.buffer_size || 10;
  const preload = status?.buffer.preload || 'auto';
  
  return (
    <audio
      preload={preload}
      // Apply quality settings to audio source
    />
  );
};
```

## Quality Decision Logic

### Auto Mode Flow

1. **Measure Network Speed**
   - Download 1MB test file from CDN
   - Calculate speed in Mbps
   - Cache result for 5 minutes

2. **Check System Resources**
   - Get CPU and memory usage
   - Determine system load status

3. **Select Base Quality**
   - Based on network speed thresholds
   - Ultra (5+ Mbps) → High (2-5 Mbps) → Medium (1-2 Mbps) → Low (0.5-1 Mbps)

4. **Adjust for System Load**
   - If CPU > 80% or Memory > 85%: Downgrade by 1 level
   - If CPU < 30% and Memory < 50% and prefer_quality: Upgrade by 1 level

5. **Apply Buffer Settings**
   - Larger buffer for slower connections
   - Smaller buffer for fast connections
   - Rebuffer threshold at 30% of buffer size

## Configuration

### User Preferences

Stored in Django cache with key `quick_sync_prefs_{user_id}`:

```python
{
    'mode': 'auto',  # auto, low, medium, high, ultra
    'prefer_quality': True,  # Prefer higher quality when possible
    'adapt_to_system': True,  # Adjust based on CPU/memory
    'auto_download_quality': False,  # Apply to downloads
}
```

### Cache Keys

- `quick_sync_network_speed`: Network speed (5 min TTL)
- `quick_sync_system_resources`: System resources (5 min TTL)
- `quick_sync_prefs_{user_id}`: User preferences (no TTL)

## Performance Considerations

### Network Speed Testing
- Uses 1MB download to minimize overhead
- Cached for 5 minutes
- Falls back to 2.0 Mbps on error
- Uses Cloudflare speed test endpoint

### System Resource Monitoring
- Uses psutil for accurate metrics
- 1-second CPU measurement interval
- Cached for 5 minutes
- Minimal performance impact

### API Rate Limiting
- Status endpoint called every 5 minutes
- Manual speed test requires user action
- Preferences cached indefinitely

## Troubleshooting

### Network Speed Detection Issues

**Problem**: Speed test fails or returns unrealistic values

**Solutions:**
- Check CDN availability (speed.cloudflare.com)
- Verify network connectivity
- Increase timeout value (default 5s)
- Use custom test_url parameter

### System Resource Monitoring Issues

**Problem**: CPU/memory values incorrect

**Solutions:**
- Ensure psutil is installed
- Check system permissions
- Verify /proc filesystem access (Linux)

### Quality Not Adapting

**Problem**: Quality doesn't change despite network/system changes

**Solutions:**
- Clear cache: `cache.delete('quick_sync_network_speed')`
- Verify preferences: mode should be 'auto'
- Check adapt_to_system is enabled
- Run manual speed test

## API Reference

### GET /api/audio/quick-sync/status/
Returns Quick Sync status and preferences.

**Response:**
```json
{
  "status": {
    "network": {
      "speed_mbps": 3.5,
      "status": "good"
    },
    "system": {
      "cpu_percent": 25.0,
      "memory_percent": 60.0,
      "status": "low_load"
    },
    "quality": {
      "level": "high",
      "bitrate": 256,
      "description": "High quality - best experience",
      "auto_selected": true
    },
    "buffer": {
      "buffer_size": 15,
      "preload": "auto",
      "max_buffer_size": 30,
      "rebuffer_threshold": 4.5
    }
  },
  "preferences": {
    "mode": "auto",
    "prefer_quality": true,
    "adapt_to_system": true,
    "auto_download_quality": false
  }
}
```

### POST /api/audio/quick-sync/preferences/
Update user preferences.

**Request Body:**
```json
{
  "mode": "auto",
  "prefer_quality": true,
  "adapt_to_system": true,
  "auto_download_quality": false
}
```

### POST /api/audio/quick-sync/test/
Run network speed test.

**Response:**
```json
{
  "network_speed_mbps": 4.2,
  "system_resources": {
    "cpu_percent": 30.0,
    "memory_percent": 55.0
  },
  "recommended_quality": "high",
  "timestamp": 1702656789.123
}
```

### GET /api/audio/quick-sync/presets/
Get quality presets and thresholds.

**Response:**
```json
{
  "presets": {
    "low": {"bitrate": 64, "buffer_size": 5, "preload": "metadata"},
    "medium": {"bitrate": 128, "buffer_size": 10, "preload": "auto"},
    "high": {"bitrate": 256, "buffer_size": 15, "preload": "auto"},
    "ultra": {"bitrate": 320, "buffer_size": 20, "preload": "auto"}
  },
  "thresholds": {
    "ultra": 5.0,
    "high": 2.0,
    "medium": 1.0,
    "low": 0.5
  }
}
```

## Future Enhancements

- [ ] ABR (Adaptive Bitrate) streaming with HLS/DASH
- [ ] Bandwidth prediction using historical data
- [ ] Quality switching mid-playback
- [ ] Network type detection (WiFi/Cellular/Ethernet)
- [ ] Offline quality presets
- [ ] Per-device quality preferences
- [ ] Analytics and quality metrics
- [ ] Multi-CDN support for speed testing
