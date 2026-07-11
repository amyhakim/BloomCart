.PHONY: app frontend backend

stop:
	docker compose down -v

start:
	docker compose up --build

restart: stop start
