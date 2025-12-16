#!/bin/bash

# Script to create placeholder PWA icons
# For production, use proper icon generator tools

ICON_DIR="frontend/public/img"
mkdir -p "$ICON_DIR"

echo "Creating placeholder PWA icons..."
echo "Note: For production, generate proper icons using:"
echo "  - https://www.pwabuilder.com/imageGenerator"
echo "  - https://realfavicongenerator.net/"
echo ""

# Function to create SVG placeholder icon
create_svg_icon() {
    local size=$1
    local file="$ICON_DIR/icon-${size}x${size}.png"
    
    # Create SVG with ImageMagick if available
    if command -v convert &> /dev/null; then
        convert -size ${size}x${size} xc:"#1976d2" \
                -fill white \
                -font Arial-Bold \
                -pointsize $((size/4)) \
                -gravity center \
                -annotate +0+0 "SW\n${size}" \
                "$file"
        echo "✓ Created $file"
    else
        echo "✗ ImageMagick not found. Skipping $file"
        echo "  Install: sudo apt-get install imagemagick (Linux)"
        echo "           brew install imagemagick (Mac)"
    fi
}

# Check if ImageMagick is available
if ! command -v convert &> /dev/null; then
    echo ""
    echo "ImageMagick not found!"
    echo "Please install ImageMagick to generate placeholder icons:"
    echo ""
    echo "Linux:   sudo apt-get install imagemagick"
    echo "Mac:     brew install imagemagick"
    echo "Windows: Download from https://imagemagick.org/script/download.php"
    echo ""
    echo "Or use online tools to generate icons:"
    echo "  - https://www.pwabuilder.com/imageGenerator"
    echo "  - https://realfavicongenerator.net/"
    exit 1
fi

# Create all required icon sizes
create_svg_icon 72
create_svg_icon 96
create_svg_icon 128
create_svg_icon 144
create_svg_icon 152
create_svg_icon 192
create_svg_icon 384
create_svg_icon 512

echo ""
echo "✓ Placeholder icons created successfully!"
echo ""
echo "IMPORTANT: Replace these with proper app icons before deploying to production."
echo ""
