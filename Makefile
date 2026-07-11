.PHONY: app frontend backend

app: frontend backend

frontend:
	docker compose down -v frontend
	docker compose up frontend --build

backend:
	docker compose down -v backend
	docker compose up backend --build
