#!/bin/bash

# Exit on error
set -e

echo "--- Running Backend Security Audit ---"
# Activate virtual environment
source .venv/bin/activate
# Run pip-audit
pip-audit -r backend/requirements.txt

echo "\n--- Running Frontend Security Audit ---"
# Navigate to the frontend directory
cd frontend
# Run npm audit
npm audit
