.PHONY: stop start restart

stop:
	docker compose down -v

start:
	docker compose up --build

restart: stop start
