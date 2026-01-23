#!/bin/bash
# SoundWave Directory Setup Script
# Creates required directories with proper permissions

echo "🎵 SoundWave - Directory Setup"
echo "=============================="

# Create directories
echo "Creating directories..."
mkdir -p ./audio ./cache ./data

# Set permissions (user 1000:1000 for Docker container)
echo "Setting permissions..."
sudo chown -R 1000:1000 ./audio ./cache ./data

echo ""
echo "✅ Directories created successfully!"
echo ""
echo "You can now start SoundWave with:"
echo "  docker compose up -d"
echo ""
