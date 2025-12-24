# SoundWave - Supported Audio Formats

## Overview
SoundWave's ID3 service provides comprehensive support for 15+ audio formats including high-resolution DSD files.

## Supported Formats

### Lossy Formats

| Format | Extension | Tag Format | Cover Art | Notes |
|--------|-----------|------------|-----------|-------|
| MP3 | `.mp3` | ID3v2 | ✅ APIC | Most common format |
| MP4/M4A | `.m4a`, `.mp4`, `.m4b`, `.m4p` | iTunes | ✅ covr | Apple format |
| OGG Vorbis | `.ogg`, `.oga` | Vorbis Comments | ✅ Base64 | Open format |
| Opus | `.opus` | Vorbis Comments | ✅ Base64 | Low latency codec |
| Musepack | `.mpc` | APEv2 | ✅ Binary | High quality lossy |

### Lossless Formats

| Format | Extension | Tag Format | Cover Art | Notes |
|--------|-----------|------------|-----------|-------|
| FLAC | `.flac` | Vorbis Comments | ✅ Picture | Most popular lossless |
| WavPack | `.wv` | APEv2 | ✅ Binary | Hybrid lossless/lossy |
| Monkey's Audio | `.ape` | APEv2 | ✅ Binary | High compression |
| AIFF | `.aiff`, `.aif`, `.aifc` | ID3v2 | ✅ APIC | Apple Interchange |
| WAV | `.wav` | ID3v2 | ✅ APIC | Uncompressed PCM |

### High-Resolution DSD Formats

| Format | Extension | Tag Format | Cover Art | Sample Rates | Notes |
|--------|-----------|------------|-----------|--------------|-------|
| DSF | `.dsf` | ID3v2 | ✅ APIC | DSD64, DSD128, DSD256 | Sony DSD Stream File |
| DSDIFF | `.dff` | ID3v2 | ✅ APIC | DSD64, DSD128, DSD256 | Philips DSD Interchange |

## DSD Sample Rates

| Rate | Frequency | Description |
|------|-----------|-------------|
| DSD64 | 2.8224 MHz | Standard DSD, SACD quality |
| DSD128 | 5.6448 MHz | Double DSD, 2x SACD |
| DSD256 | 11.2896 MHz | Quad DSD, 4x SACD |
| DSD512 | 22.5792 MHz | 8x SACD (rarely used) |

## Tag Format Details

### ID3v2 (MP3, DSF, DFF, AIFF, WAV)
- **Frames**: TIT2 (title), TPE1 (artist), TALB (album), TPE2 (album artist), TDRC (year), TCON (genre), TRCK (track), TPOS (disc)
- **Cover Art**: APIC frame with encoding, MIME type, description, and binary data
- **Encoding**: UTF-8 (encoding=3)

### MP4/iTunes Tags (M4A, MP4, M4B)
- **Atoms**: ©nam (title), ©ART (artist), ©alb (album), aART (album artist), ©day (year), ©gen (genre), trkn (track), disk (disc)
- **Cover Art**: covr atom with MP4Cover format (JPEG or PNG)
- **Encoding**: UTF-8

### Vorbis Comments (FLAC, OGG, Opus)
- **Tags**: title, artist, album, albumartist, date, genre, tracknumber, discnumber
- **Cover Art**: 
  - FLAC: Native Picture block
  - OGG/Opus: Base64-encoded metadata_block_picture
- **Encoding**: UTF-8
- **Case Insensitive**: Field names are case-insensitive

### APEv2 (WavPack, APE, Musepack)
- **Tags**: Title, Artist, Album, Album Artist, Year, Genre, Track, Disc
- **Cover Art**: Binary item "Cover Art (Front)"
- **Encoding**: UTF-8
- **Case Sensitive**: Field names are case-sensitive

## Feature Comparison

| Feature | ID3v2 | MP4 | Vorbis | APEv2 |
|---------|-------|-----|--------|-------|
| Multiple Values | ✅ | ✅ | ✅ | ✅ |
| Embedded Lyrics | ✅ | ✅ | ✅ | ❌ |
| ReplayGain | ✅ | ❌ | ✅ | ✅ |
| Cover Art | ✅ | ✅ | ✅ | ✅ |
| Unicode | ✅ | ✅ | ✅ | ✅ |
| Compression | ❌ | ❌ | ❌ | ✅ |

## Usage Examples

### Read Tags from Any Format

```python
from audio.id3_service import ID3TagService

service = ID3TagService()

# Works with any supported format
for format in ['.mp3', '.m4a', '.flac', '.dsf', '.dff', '.ogg', '.wv']:
    tags = service.read_tags(f'/path/to/audio{format}')
    print(f"{format}: {tags}")
```

### Write Tags to Any Format

```python
tags = {
    'title': 'Song Title',
    'artist': 'Artist Name',
    'album': 'Album Name',
    'year': '2024',
    'genre': 'Jazz',
    'track_number': 5,
}

# Works with any supported format
for format in ['.mp3', '.m4a', '.flac', '.dsf']:
    service.write_tags(f'/path/to/audio{format}', tags)
```

### Embed Cover Art in Any Format

```python
with open('/path/to/cover.jpg', 'rb') as f:
    image_data = f.read()

# Works with all formats
service.embed_cover_art('/path/to/audio.dsf', image_data, 'image/jpeg')
service.embed_cover_art('/path/to/audio.flac', image_data, 'image/jpeg')
service.embed_cover_art('/path/to/audio.mp3', image_data, 'image/jpeg')
```

### DSD-Specific Properties

```python
# DSF and DFF files include additional properties
tags = service.read_tags('/path/to/audio.dsf')
print(f"Sample Rate: {tags['sample_rate']} Hz")  # 2822400 (DSD64)
print(f"Channels: {tags['channels']}")  # 2 (stereo)
print(f"Bits per Sample: {tags['bits_per_sample']}")  # 1 (DSD)
print(f"Format: {tags['format']}")  # DSF
```

## Format Detection

The service automatically detects the format based on file extension:

```python
service = ID3TagService()
print(service.SUPPORTED_FORMATS)

# Output:
# {
#   '.mp3': 'MP3',
#   '.m4a': 'MP4',
#   '.flac': 'FLAC',
#   '.ogg': 'OGG',
#   '.opus': 'OPUS',
#   '.wv': 'WAVPACK',
#   '.ape': 'APE',
#   '.mpc': 'MUSEPACK',
#   '.dsf': 'DSF',
#   '.dff': 'DSDIFF',
#   '.aiff': 'AIFF',
#   '.wav': 'WAVE',
# }
```

## Best Practices

1. **Use appropriate MIME types for cover art**:
   - JPEG: `'image/jpeg'` (recommended for photos)
   - PNG: `'image/png'` (recommended for graphics/logos)

2. **Check format support before processing**:
   ```python
   if path.suffix.lower() in service.SUPPORTED_FORMATS:
       tags = service.read_tags(path)
   ```

3. **Handle missing tags gracefully**:
   ```python
   tags = service.read_tags(file_path)
   if tags:
       title = tags.get('title', 'Unknown Title')
   ```

4. **DSD files**: Remember that DSD files (DSF, DFF) use 1-bit encoding at very high sample rates (2.8+ MHz).

5. **FLAC vs DSF**: 
   - FLAC: PCM-based, wider software support, smaller file size
   - DSF: Native DSD, higher fidelity for DSD sources, larger files

## Limitations

- **WAV**: Limited tag support (ID3 chunks not universally supported)
- **OGG/Opus**: Cover art stored as base64 (larger than binary)
- **APE**: Windows-centric format, limited Linux support
- **DSD**: Large file sizes (1-bit @ 2.8+ MHz = ~5.6 Mbps for DSD64)

## Performance Notes

- **Read operations**: Fast for all formats (~1-5ms per file)
- **Write operations**: Vary by format:
  - Fastest: Vorbis comments (~5ms)
  - Fast: ID3v2, MP4 (~10ms)
  - Moderate: APEv2 (~20ms)
- **Cover art embedding**: Adds ~50-100ms depending on image size
- **DSD files**: Slower due to large file sizes (100MB+ common)

## References

- ID3v2.4: http://id3.org/id3v2.4.0-structure
- MP4 atoms: https://developer.apple.com/library/archive/documentation/QuickTime/QTFF/
- Vorbis Comments: https://www.xiph.org/vorbis/doc/v-comment.html
- APEv2: https://wiki.hydrogenaud.io/index.php?title=APEv2_specification
- DSF: https://dsd-guide.com/sites/default/files/white-papers/DSFFileFormatSpec_E.pdf
- Mutagen docs: https://mutagen.readthedocs.io/
