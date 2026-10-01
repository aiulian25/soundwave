#!/bin/bash
# SoundWave Directory Setup Script
# Creates required directories with proper permissions

echo "🎵 SoundWave - Directory Setup"
echo "=============================="

# Create directories
echo "Creating directories..."
mkdir -p ./audio ./cache ./data

# Create cookies.txt if it doesn't exist, seeded from the template so it has the proper
# Netscape header. Downloads need real YouTube cookies in it (README: YouTube Cookies).
# cookies.txt is gitignored (DEP-02).
if [ ! -f ./cookies.txt ]; then
    if [ -f ./cookies.txt.example ]; then
        cp ./cookies.txt.example ./cookies.txt
    else
        touch ./cookies.txt
    fi
    echo "Created cookies.txt: add your YouTube cookies before downloading (README: YouTube Cookies)"
fi

# Set permissions (user 1000:1000 for Docker container). The container writes YouTube's
# refreshed session back into cookies.txt, and the file is a credential, hence 600.
echo "Setting permissions..."
sudo chown -R 1000:1000 ./audio ./cache ./data ./cookies.txt
sudo chmod 600 ./cookies.txt

echo ""
echo "✅ Directories created successfully!"
echo ""
echo "You can now start SoundWave with:"
echo "  docker compose up -d"
echo ""
