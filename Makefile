.PHONY: help build up down logs shell migrate frontend backend clean scan security-scan

help:
	@echo "SoundWave - Available Commands"
	@echo "================================"
	@echo "make build     - Build Docker images"
	@echo "make up        - Start all services"
	@echo "make down      - Stop all services"
	@echo "make logs      - View logs"
	@echo "make shell     - Open Django shell"
	@echo "make migrate   - Run database migrations"
	@echo "make frontend  - Install frontend dependencies"
	@echo "make backend   - Install backend dependencies"
	@echo "make clean     - Clean up containers and volumes"
	@echo "make scan          - Quick image vulnerability scan (trivy/grype/hadolint)"
	@echo "make security-scan - Full security suite (code, deps, config, secrets, SBOM, image)"

build:
	docker-compose build

up:
	docker-compose up -d
	@echo "SoundWave is starting..."
	@echo "Access at: http://localhost:123456"

down:
	docker-compose down

logs:
	docker-compose logs -f soundwave

shell:
	docker-compose exec soundwave python backend/manage.py shell

migrate:
	docker-compose exec soundwave python backend/manage.py migrate

frontend:
	cd frontend && npm install

backend:
	cd backend && pip install -r requirements.txt

clean:
	docker-compose down -v
	rm -rf audio/ cache/ es/ redis/
	@echo "Cleaned up all data volumes"

IMAGE_TAG ?= soundwave:latest

scan:
	@echo "=== Scanning Docker image for vulnerabilities ==="
	@command -v trivy >/dev/null 2>&1 && trivy image --exit-code 1 --severity HIGH,CRITICAL $(IMAGE_TAG) || echo "trivy not found — install: https://aquasecurity.github.io/trivy"
	@command -v grype >/dev/null 2>&1 && grype $(IMAGE_TAG) --fail-on high || echo "grype not found — install: https://github.com/anchore/grype"
	@command -v hadolint >/dev/null 2>&1 && hadolint Dockerfile || echo "hadolint not found — install: https://github.com/hadolint/hadolint"
	@echo "=== Scan complete ==="

# Full security suite — mirrors SECURITY_ASSESSMENT.md §8 and the CI security-scan workflow.
# Reports are written to ./security-reports (gitignored). Pass ARGS for options, e.g.
#   make security-scan ARGS="--report-only"   or   make security-scan ARGS="--no-image"
security-scan:
	@bash scripts/security-scan.sh $(ARGS)
