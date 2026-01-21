#!/bin/bash
# SoundWave Quick Setup for Docker Image Users
# Run this once before starting the containers

echo "=== SoundWave Setup ==="

# Create required directories
echo "Creating directories..."
mkdir -p ./audio ./cache ./data

# Set permissions for container user (1000:1000)
echo "Setting permissions..."
if command -v sudo &> /dev/null; then
    sudo chown -R 1000:1000 ./audio ./cache ./data 2>/dev/null || chown -R 1000:1000 ./audio ./cache ./data
else
    chown -R 1000:1000 ./audio ./cache ./data 2>/dev/null || echo "Warning: Could not set ownership. You may need to run: sudo chown -R 1000:1000 ./audio ./cache ./data"
fi
chmod -R 755 ./audio ./cache ./data

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Now run:"
echo "  docker compose -f docker-compose.prod.yml pull"
echo "  docker compose -f docker-compose.prod.yml up -d"
echo ""
echo "Default login: admin / soundwave"
echo "(Edit SW_USERNAME and SW_PASSWORD in docker-compose.prod.yml to customize)"
