.PHONY: setup demo dev api web test build privacy docker

PYTHON ?= python3

setup:
	$(PYTHON) -m venv .venv
	.venv/bin/python -m pip install -r requirements-dev.txt
	npm --prefix web ci

demo:
	.venv/bin/python scripts/bootstrap_demo.py

api:
	PM_VAULT_ROOT="$${PM_VAULT_ROOT:-$$(pwd)/vault}" .venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8765 --reload

web:
	npm --prefix web run dev

test:
	.venv/bin/python -m pytest
	npm --prefix web run test

test-e2e:
	npm --prefix web run test:e2e

build:
	npm --prefix web run build

privacy:
	.venv/bin/python scripts/privacy_scan.py --all-files

docker:
	docker compose up --build
