.PHONY: help build up down logs shell migrate frontend backend clean

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
