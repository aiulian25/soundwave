#!/bin/bash
set -e

echo "🎨 SoundWave Logo Update Script"
echo "================================"
echo ""

# Paths
PROJECT_ROOT="/home/iulian/projects/zi-tube/soundwave"
SOURCE_LOGO="$PROJECT_ROOT/frontend/public/img/logo.png"
ICONS_DIR="$PROJECT_ROOT/frontend/public/img/icons"
FAVICON_PATH="$PROJECT_ROOT/frontend/public/favicon.ico"

# Check if source logo exists
if [ ! -f "$SOURCE_LOGO" ]; then
    echo "❌ Error: Logo not found at $SOURCE_LOGO"
    echo ""
    echo "Please save your new logo image to:"
    echo "   $SOURCE_LOGO"
    echo ""
    echo "The logo should be the circular SoundWave logo with:"
    echo "  - Play button in center"
    echo "  - Concentric circles"
    echo "  - Sound wave indicators"
    echo "  - 'soundwave' text below"
    echo "  - Teal/turquoise and dark blue colors"
    exit 1
fi

echo "✅ Source logo found"
echo ""

# Create icons directory if it doesn't exist
mkdir -p "$ICONS_DIR"

echo "📱 Generating PWA icons..."

# Generate various icon sizes
sizes=(72 96 128 144 152 192 384 512)

for size in "${sizes[@]}"; do
    output="$ICONS_DIR/icon-${size}x${size}.png"
    echo "  → Generating ${size}x${size}..."
    convert "$SOURCE_LOGO" -resize ${size}x${size} -background none -gravity center -extent ${size}x${size} "$output"
done

echo ""
echo "🎭 Generating maskable icons (with padding)..."

# Maskable icons need padding (safe zone)
convert "$SOURCE_LOGO" -resize 154x154 -background none -gravity center -extent 192x192 "$ICONS_DIR/icon-192x192-maskable.png"
convert "$SOURCE_LOGO" -resize 410x410 -background none -gravity center -extent 512x512 "$ICONS_DIR/icon-512x512-maskable.png"

echo ""
echo "🌐 Generating favicon..."

# Generate favicon.ico with multiple sizes
convert "$SOURCE_LOGO" \
    \( -clone 0 -resize 16x16 \) \
    \( -clone 0 -resize 32x32 \) \
    \( -clone 0 -resize 48x48 \) \
    -delete 0 -alpha on -background none "$FAVICON_PATH"

echo ""
echo "✅ All icons generated successfully!"
echo ""
echo "📋 Generated files:"
echo "   - PWA icons (72x72 to 512x512)"
echo "   - Maskable icons (192x192, 512x512)"
echo "   - Favicon (multi-size ICO)"
echo ""
echo "🔄 Next steps:"
echo "   1. Rebuild the frontend: cd frontend && npm run build"
echo "   2. Restart the app to see changes"
echo ""
echo "✨ Logo updated everywhere:"
echo "   ✓ Login page"
echo "   ✓ Sidebar"
echo "   ✓ Splash screen"
echo "   ✓ PWA home screen"
echo "   ✓ Browser tab"
echo "   ✓ Notifications"
echo ""
