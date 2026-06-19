#!/bin/bash
# SoundWave Directory Setup Script
# Creates required directories with proper permissions

echo "🎵 SoundWave - Directory Setup"
echo "=============================="

# Create directories
echo "Creating directories..."
mkdir -p ./audio ./cache ./data

# Create cookies.txt if it doesn't exist (required by the read-only container mount).
# Seed it from the template so it has the proper Netscape header. cookies.txt is
# gitignored (DEP-02); add real YouTube cookies to it locally if needed.
if [ ! -f ./cookies.txt ]; then
    if [ -f ./cookies.txt.example ]; then
        cp ./cookies.txt.example ./cookies.txt
    else
        touch ./cookies.txt
    fi
    echo "Created cookies.txt (add YouTube cookies here if needed)"
fi

# Set permissions (user 1000:1000 for Docker container)
echo "Setting permissions..."
sudo chown -R 1000:1000 ./audio ./cache ./data

echo ""
echo "✅ Directories created successfully!"
echo ""
echo "You can now start SoundWave with:"
echo "  docker compose up -d"
echo ""
